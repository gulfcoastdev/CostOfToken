import type { NormalizedModel } from '@/lib/types.ts'

/**
 * Detects scraper failures that don't throw.
 *
 * Every failure this project actually hit reported `ok`:
 *
 *  - OpenAI's HTML exposed 13 of 73 models, because the rest lived in
 *    unselected tabs. A "successful" run silently dropped 80% of a provider.
 *  - Every OpenAI price was the Priority tier — exactly 2x standard — because
 *    four tier tables shared a heading and the last one won.
 *
 * Neither is visible from a status code, an exception, or a per-row sanity
 * check: each individual price was plausible. They are only detectable by
 * comparing a run against what the provider looked like yesterday.
 *
 * The checks are deliberately shape-based rather than threshold-tuned per
 * provider, so a new provider inherits them for free.
 */

export type AnomalyCode =
  | 'coverage_drop'
  | 'uniform_price_shift'
  | 'mass_price_change'
  | 'field_collapse'

export type AnomalySeverity = 'warn' | 'block'

export interface Anomaly {
  code: AnomalyCode
  severity: AnomalySeverity
  message: string
  details: Record<string, unknown>
}

/** The provider's currently-stored state, used as the comparison baseline. */
export interface BaselineModel {
  modelId: string
  inputPrice: number | null
  cachedInputPrice: number | null
  outputPrice: number | null
}

export interface AnomalyOptions {
  /** Below this many baseline models, comparisons are too noisy to be useful. */
  minBaselineModels?: number
  /** Fraction of the baseline below which coverage loss blocks the write. */
  coverageBlockRatio?: number
  /** Fraction below which coverage loss is worth a warning. */
  coverageWarnRatio?: number
}

const DEFAULTS = {
  minBaselineModels: 5,
  coverageBlockRatio: 0.6,
  coverageWarnRatio: 0.85,
} satisfies Required<AnomalyOptions>

export function detectAnomalies(
  baseline: BaselineModel[],
  incoming: NormalizedModel[],
  options: AnomalyOptions = {},
): Anomaly[] {
  const config = { ...DEFAULTS, ...options }
  const anomalies: Anomaly[] = []

  // A provider with no history yet has nothing to compare against. Silence is
  // correct here — flagging every first run would train people to ignore this.
  if (baseline.length < config.minBaselineModels) return anomalies

  anomalies.push(...checkCoverage(baseline, incoming, config))

  const byId = new Map(baseline.map((m) => [m.modelId, m]))
  const overlap = incoming
    .map((model) => ({ model, before: byId.get(model.modelId) }))
    .filter((pair): pair is { model: NormalizedModel; before: BaselineModel } => !!pair.before)

  anomalies.push(...checkPriceShift(overlap))
  anomalies.push(...checkFieldCollapse(overlap))

  return anomalies
}

function checkCoverage(
  baseline: BaselineModel[],
  incoming: NormalizedModel[],
  config: Required<AnomalyOptions>,
): Anomaly[] {
  const ratio = incoming.length / baseline.length
  if (ratio >= config.coverageWarnRatio) return []

  const missing = new Set(baseline.map((m) => m.modelId))
  for (const model of incoming) missing.delete(model.modelId)

  const details = {
    before: baseline.length,
    after: incoming.length,
    retained: Number(ratio.toFixed(3)),
    sampleMissing: [...missing].slice(0, 10),
  }

  const percent = Math.round((1 - ratio) * 100)

  if (ratio < config.coverageBlockRatio) {
    return [
      {
        code: 'coverage_drop',
        severity: 'block',
        message: `Model count fell ${percent}% (${baseline.length} → ${incoming.length}). The source layout probably changed.`,
        details,
      },
    ]
  }

  return [
    {
      code: 'coverage_drop',
      severity: 'warn',
      message: `Model count fell ${percent}% (${baseline.length} → ${incoming.length}).`,
      details,
    },
  ]
}

/**
 * Catch a whole provider moving by one common factor.
 *
 * A vendor repricing genuinely moves some models by varying amounts. A parser
 * that latched onto the wrong tier moves *every* model by exactly the same
 * ratio — 0.5x for batch, 2x for priority. That uniformity is the signal.
 */
function checkPriceShift(
  overlap: Array<{ model: NormalizedModel; before: BaselineModel }>,
): Anomaly[] {
  if (overlap.length < 3) return []

  const ratios: number[] = []
  let comparable = 0

  for (const { model, before } of overlap) {
    const after = model.pricing.inputPrice
    if (before.inputPrice === null || after === null) continue
    if (before.inputPrice <= 0) continue
    comparable++
    // 4dp keeps 0.5x/2x exact while tolerating float noise.
    const ratio = Number((after / before.inputPrice).toFixed(4))
    if (ratio !== 1) ratios.push(ratio)
  }

  if (comparable < 3 || ratios.length === 0) return []

  const changedFraction = ratios.length / comparable
  if (changedFraction < 0.5) return []

  const counts = new Map<number, number>()
  for (const ratio of ratios) counts.set(ratio, (counts.get(ratio) ?? 0) + 1)

  let modalRatio = 1
  let modalCount = 0
  for (const [ratio, count] of counts) {
    if (count > modalCount) {
      modalRatio = ratio
      modalCount = count
    }
  }

  const uniformity = modalCount / ratios.length
  const details = {
    comparable,
    changed: ratios.length,
    changedFraction: Number(changedFraction.toFixed(3)),
    modalRatio,
    uniformity: Number(uniformity.toFixed(3)),
  }

  if (uniformity >= 0.8 && modalCount >= 3) {
    return [
      {
        code: 'uniform_price_shift',
        severity: 'block',
        message:
          `${modalCount} of ${ratios.length} changed prices moved by exactly ${modalRatio}x. ` +
          'A uniform factor across a provider is the signature of parsing the wrong pricing tier, not a repricing.',
        details,
      },
    ]
  }

  return [
    {
      code: 'mass_price_change',
      severity: 'warn',
      message: `${ratios.length} of ${comparable} models changed price in one run.`,
      details,
    },
  ]
}

/**
 * Catch a column quietly disappearing.
 *
 * If a provider renames "Cached input" the column lookup returns -1 and every
 * value silently becomes null. Prices stay plausible, so nothing else notices.
 */
function checkFieldCollapse(
  overlap: Array<{ model: NormalizedModel; before: BaselineModel }>,
): Anomaly[] {
  if (overlap.length < 5) return []

  const fields = [
    {
      name: 'cached_input_price',
      before: (b: BaselineModel) => b.cachedInputPrice,
      after: (m: NormalizedModel) => m.pricing.cachedInputPrice,
    },
    {
      name: 'output_price',
      before: (b: BaselineModel) => b.outputPrice,
      after: (m: NormalizedModel) => m.pricing.outputPrice,
    },
  ]

  const anomalies: Anomaly[] = []

  for (const field of fields) {
    const populatedBefore = overlap.filter((p) => field.before(p.before) !== null).length
    const populatedAfter = overlap.filter((p) => field.after(p.model) !== null).length

    const beforeRatio = populatedBefore / overlap.length
    const afterRatio = populatedAfter / overlap.length

    if (beforeRatio >= 0.5 && afterRatio <= 0.1) {
      anomalies.push({
        code: 'field_collapse',
        severity: 'block',
        message: `${field.name} was populated for ${populatedBefore}/${overlap.length} models and is now ${populatedAfter}. The column was probably renamed or moved.`,
        details: {
          field: field.name,
          populatedBefore,
          populatedAfter,
          total: overlap.length,
        },
      })
    }
  }

  return anomalies
}

export function hasBlocking(anomalies: Anomaly[]): boolean {
  return anomalies.some((a) => a.severity === 'block')
}

export function summarize(anomalies: Anomaly[]): string {
  return anomalies.map((a) => `[${a.severity}] ${a.code}: ${a.message}`).join(' | ')
}
