/** Shared domain types for the pricing pipeline and the public API. */

export type Modality = 'text' | 'vision' | 'audio' | 'video' | 'image'

/** How a price row was obtained. Surfaced in the API so callers can judge freshness. */
export type SourceKind = 'scrape' | 'api' | 'catalog'

export const SOURCE_KINDS: readonly SourceKind[] = ['scrape', 'api', 'catalog']

/**
 * Canonical pricing shape. Every field is USD per 1,000,000 tokens unless
 * `currency` says otherwise — extractors are responsible for converting from
 * whatever unit the provider publishes (per-1K, per-token) before this point.
 */
export interface NormalizedPricing {
  inputPrice: number | null
  cachedInputPrice: number | null
  outputPrice: number | null
  longInputPrice: number | null
  longCachedInputPrice: number | null
  longOutputPrice: number | null
  currency: string
  sourceUrl: string | null
  sourceKind: SourceKind
  raw?: unknown
}

export interface NormalizedModel {
  providerSlug: string
  modelId: string
  displayName: string
  contextWindow: number | null
  maxOutputTokens: number | null
  longContextThreshold: number | null
  modality: Modality[]
  tags: string[]
  isActive: boolean
  pricing: NormalizedPricing
}

export interface ProviderDefinition {
  slug: string
  name: string
  website: string
  pricingUrl: string
  region: 'global' | 'cn'
}

/** Public API row shape (v1). Keys are snake_case per the spec's example payload. */
export interface PriceRowV1 {
  provider: string
  provider_name: string
  model_id: string
  display_name: string
  input: number | null
  cached_input: number | null
  output: number | null
  context_window: number | null
  max_output_tokens: number | null
  long_context_threshold: number | null
  long_input: number | null
  long_cached_input: number | null
  long_output: number | null
  currency: string
  modality: string[]
  tags: string[]
  source_url: string | null
  source_kind: SourceKind
  updated_at: string | null
}

export interface HistoryPointV1 {
  input: number | null
  cached_input: number | null
  output: number | null
  long_input: number | null
  long_output: number | null
  currency: string
  source_kind: SourceKind | null
  recorded_at: string
}
