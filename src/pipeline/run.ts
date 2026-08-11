import { randomUUID } from 'node:crypto'
import type { NormalizedModel } from '@/lib/types.ts'
import { type Anomaly, detectAnomalies, hasBlocking } from './anomaly.ts'
import { enrichModels } from './enrich.ts'
import { getExtractors } from './extractors/index.ts'
import { resetOpenRouterCache } from './extractors/openrouter.ts'
import type { ExtractorContext } from './extractors/types.ts'
import { fetchText } from './http.ts'
import { validateModel } from './normalize.ts'
import {
  deactivateMissingModels,
  ensureProviders,
  getProviderBaseline,
  logExtractionRun,
  upsertProviderModels,
} from './upsert.ts'

export interface ProviderResult {
  provider: string
  status: 'ok' | 'partial' | 'failed' | 'skipped' | 'blocked'
  sourceKind: string
  modelsFound: number
  modelsRejected: number
  modelsChanged: number
  durationMs: number
  error?: string
  rejections?: string[]
  anomalies?: Anomaly[]
}

export interface RunSummary {
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  dryRun: boolean
  providers: ProviderResult[]
  totalModels: number
  totalChanged: number
  ok: boolean
  /** Providers whose results were rejected by anomaly detection. */
  blocked: number
}

export interface RunOptions {
  /** Restrict the run to these provider slugs. */
  only?: string[]
  /** Extract and validate but write nothing. */
  dryRun?: boolean
  /** Injected for tests. */
  ctx?: ExtractorContext
  /**
   * Write even when anomaly detection blocks. For when a flagged change is
   * genuinely real — a vendor really did halve its prices.
   */
  force?: boolean
}

const defaultContext: ExtractorContext = {
  fetchText: (url, init) => fetchText(url, { headers: init?.headers }),
}

/**
 * Run the daily extraction.
 *
 * Every provider is isolated: an extractor that throws, times out, or returns
 * nothing marks only its own provider failed and leaves that provider's last
 * known prices in place. Yesterday's price is far more useful than a gap, and
 * silently replacing good data with nulls is the worst outcome — so a failed
 * provider writes no rows at all.
 */
export async function runPipeline(options: RunOptions = {}): Promise<RunSummary> {
  const { only, dryRun = false, ctx = defaultContext, force = false } = options

  const runId = randomUUID()
  const startedAt = new Date()
  resetOpenRouterCache()

  const extractors = getExtractors(only)
  const providerIds = dryRun ? new Map<string, string>() : await ensureProviders()
  const results: ProviderResult[] = []

  // Sequential on purpose: a handful of providers per day is not worth the
  // risk of hammering vendor docs sites in parallel from one IP.
  for (const extractor of extractors) {
    const providerStart = Date.now()
    const base: ProviderResult = {
      provider: extractor.providerSlug,
      status: 'failed',
      sourceKind: extractor.sourceKind,
      modelsFound: 0,
      modelsRejected: 0,
      modelsChanged: 0,
      durationMs: 0,
    }

    try {
      const raw = await extractor.extract(ctx)

      if (raw.length === 0) {
        // An empty result is indistinguishable from a layout change that broke
        // the parser, so it is treated as a failure, not an empty catalogue.
        throw new Error('extractor returned no models (source layout may have changed)')
      }

      const { models: enriched } = await enrichModels(raw, ctx)

      const valid: NormalizedModel[] = []
      const rejections: string[] = []
      for (const model of enriched) {
        const check = validateModel(model)
        if (check.ok) valid.push(model)
        else rejections.push(`${model.modelId}: ${check.reason}`)
      }

      base.modelsFound = valid.length
      base.modelsRejected = rejections.length
      if (rejections.length > 0) base.rejections = rejections.slice(0, 10)

      if (valid.length === 0) {
        throw new Error(`all ${rejections.length} extracted models failed validation`)
      }

      if (!dryRun) {
        const providerId = providerIds.get(extractor.providerSlug)
        if (!providerId) throw new Error(`provider ${extractor.providerSlug} is not registered`)

        // Compare against what's already stored before overwriting it. This is
        // the only place a silent scraper failure is detectable: each
        // individual price looks plausible, and only the shape of the change
        // across the whole provider gives it away.
        const baseline = await getProviderBaseline(providerId)
        const anomalies = detectAnomalies(baseline, valid)
        if (anomalies.length > 0) base.anomalies = anomalies

        if (hasBlocking(anomalies) && !force) {
          // Keep the last known-good prices rather than publishing a result we
          // have concrete reason to distrust. Re-run with force to override.
          base.status = 'blocked'
          base.error = anomalies
            .filter((a) => a.severity === 'block')
            .map((a) => a.message)
            .join(' ')
        } else {
          const { pricesChanged } = await upsertProviderModels(providerId, valid)
          base.modelsChanged = pricesChanged
          await deactivateMissingModels(
            providerId,
            valid.map((m) => m.modelId),
          )
          base.status = rejections.length > 0 ? 'partial' : 'ok'
        }
      } else {
        base.status = rejections.length > 0 ? 'partial' : 'ok'
      }
    } catch (error) {
      base.status = 'failed'
      base.error = error instanceof Error ? error.message : String(error)
    }

    base.durationMs = Date.now() - providerStart
    results.push(base)

    if (!dryRun) {
      try {
        await logExtractionRun({
          runId,
          providerSlug: base.provider,
          status: base.status,
          sourceKind: base.sourceKind,
          modelsFound: base.modelsFound,
          modelsChanged: base.modelsChanged,
          durationMs: base.durationMs,
          error: base.error ?? null,
          anomalies: base.anomalies,
        })
      } catch {
        // Never let logging failure mask a successful extraction.
      }
    }
  }

  const finishedAt = new Date()

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    dryRun,
    providers: results,
    totalModels: results.reduce((sum, r) => sum + r.modelsFound, 0),
    totalChanged: results.reduce((sum, r) => sum + r.modelsChanged, 0),
    ok: results.some((r) => r.status === 'ok' || r.status === 'partial'),
    blocked: results.filter((r) => r.status === 'blocked').length,
  }
}
