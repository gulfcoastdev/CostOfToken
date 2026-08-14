import type { PriceRowV1 } from './types.ts'

/**
 * Workload cost maths, kept out of the components that display it.
 *
 * This lived inside the calculator and the comparison page, which meant the
 * one piece of logic most likely to be quietly wrong — and the piece a reader
 * is most likely to trust — could not be tested. Two faults had already
 * shipped from it: models with no output price ranked as the cheapest way to
 * run a chat, and models too small to hold the prompt ranked above ones that
 * could.
 */

export interface Workload {
  /** Tokens sent per request, including any retrieved context. */
  inputTokens: number
  /** Tokens generated per request. */
  outputTokens: number
  requestsPerMonth: number
  /** Share of input that repeats between calls, 0–1. */
  cachedShare: number
}

export type Unusable = 'no-pricing' | 'no-output-pricing'

export interface CostEstimate {
  row: PriceRowV1
  /** Null when the model cannot serve this workload at all. */
  monthly: number | null
  perRequest: number | null
  /** Why it cannot serve the workload, if it cannot. */
  unusable: Unusable | null
  /** Both prices are explicitly zero — not merely unpublished. */
  isFree: boolean
  /** False when the prompt would not fit in the context window. */
  fitsContext: boolean
}

/**
 * Why a model cannot serve a workload, or null if it can.
 *
 * A missing output price means the model does not generate text — embedding,
 * moderation and OCR endpoints. Treating that as zero makes them look like the
 * cheapest way to run a chat, which they cannot do at all.
 */
export function unusableReason(row: PriceRowV1, outputTokens: number): Unusable | null {
  if (row.input === null && row.output === null) return 'no-pricing'
  if (outputTokens > 0 && row.output === null) return 'no-output-pricing'
  return null
}

export function estimateCost(row: PriceRowV1, workload: Workload): CostEstimate {
  const { inputTokens, outputTokens, requestsPerMonth, cachedShare } = workload

  const unusable = unusableReason(row, outputTokens)
  if (unusable) {
    return { row, monthly: null, perRequest: null, unusable, isFree: false, fitsContext: true }
  }

  const inputPrice = row.input ?? 0
  // No published cached rate means cached tokens bill at the normal input
  // price — not free.
  const cachedPrice = row.cached_input ?? inputPrice
  const outputPrice = row.output ?? 0

  const share = Math.min(Math.max(cachedShare, 0), 1)
  const cachedTokens = inputTokens * share
  const freshTokens = inputTokens - cachedTokens

  const perRequest =
    (freshTokens * inputPrice + cachedTokens * cachedPrice + outputTokens * outputPrice) /
    1_000_000

  return {
    row,
    perRequest,
    monthly: perRequest * requestsPerMonth,
    unusable: null,
    isFree: inputPrice === 0 && outputPrice === 0,
    // A model that cannot hold the prompt is the wrong model, not a cheaper
    // one. Reported rather than silently ranked first.
    fitsContext: row.context_window === null || row.context_window >= inputTokens + outputTokens,
  }
}

export interface RankedWorkload {
  /** Priced models, cheapest first, free ones excluded. */
  paid: CostEstimate[]
  /** Genuinely zero-cost models, kept out of the ranking. */
  free: CostEstimate[]
  /** Models that cannot serve this workload, with the reason. */
  unusable: CostEstimate[]
}

/**
 * Rank every model by what the workload would cost.
 *
 * Free models are separated rather than ranked: at zero they win every
 * comparison by default, which tells the reader nothing.
 */
export function rankByWorkload(rows: PriceRowV1[], workload: Workload): RankedWorkload {
  const estimates = rows.map((row) => estimateCost(row, workload))

  return {
    paid: estimates
      .filter((entry) => entry.unusable === null && !entry.isFree)
      .sort((a, b) => (a.monthly ?? 0) - (b.monthly ?? 0)),
    free: estimates.filter((entry) => entry.unusable === null && entry.isFree),
    unusable: estimates.filter((entry) => entry.unusable !== null),
  }
}

export interface Scenario {
  label: string
  input: number
  output: number
  requests: number
}

/**
 * The three request shapes every comparison is priced against.
 *
 * Shared by the curated versus pages and the build-your-own comparison so both
 * answer "which is cheaper" the same way. Which model wins genuinely flips
 * between these three — that flip is the whole point of showing more than one.
 */
export const COMPARISON_SCENARIOS: Scenario[] = [
  { label: 'Chat assistant', input: 1_500, output: 600, requests: 100_000 },
  { label: 'RAG / document Q&A', input: 20_000, output: 500, requests: 30_000 },
  { label: 'Coding agent', input: 30_000, output: 4_000, requests: 20_000 },
]

/**
 * Monthly cost for one model under one scenario, at list price.
 *
 * Caching is deliberately excluded here: the saving depends on how much of a
 * prompt actually repeats, and quoting it inside a head-to-head would bury the
 * difference the page exists to show. It is stated separately instead.
 */
export function scenarioCost(row: PriceRowV1, scenario: Scenario): number | null {
  return estimateCost(row, {
    inputTokens: scenario.input,
    outputTokens: scenario.output,
    requestsPerMonth: scenario.requests,
    cachedShare: 0,
  }).monthly
}

/** Compact money for dense tables: $12.34, $1.2K, $3.45M. */
export function formatCostShort(value: number | null): string {
  if (value === null) return '—'
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1000) return `$${value.toFixed(2)}`
  if (value < 1_000_000) return `$${(value / 1000).toFixed(1)}K`
  return `$${(value / 1_000_000).toFixed(2)}M`
}
