/** Shared domain types for the pricing pipeline and the public API. */

export type Modality = 'text' | 'vision' | 'audio' | 'video' | 'image'

/** How a price row was obtained. Surfaced in the API so callers can judge freshness. */
export type SourceKind = 'scrape' | 'api' | 'catalog' | 'llm'

/**
 * What kind of thing a model is.
 *
 * `other` means determined and none of the above. A **null** type means not yet
 * determined — the distinction the old `modality` column could not express,
 * which is part of why its values are untrustworthy.
 */
export type ModelType =
  /** General-purpose text generation — the role most models play, and the default view. */
  | 'general'
  | 'embedding'
  | 'moderation'
  | 'tts'
  | 'asr'
  | 'image_gen'
  | 'video_gen'
  | 'ocr'
  | 'realtime'
  | 'other'

export const MODEL_TYPES: readonly ModelType[] = [
  'general',
  'embedding',
  'moderation',
  'tts',
  'asr',
  'image_gen',
  'video_gen',
  'ocr',
  'realtime',
  'other',
]

export function isModelType(value: string): value is ModelType {
  return (MODEL_TYPES as readonly string[]).includes(value)
}

/**
 * The type filter to actually apply, given what the data knows.
 *
 * Returns the caller's selection normally, and `'all'` when not one row
 * carries a type. That second case is not "everything happens to be untyped" —
 * it is the shape a database without the classification columns takes by the
 * time it reaches the UI, because the missing column is coalesced to null per
 * row and so looks exactly like a genuine unknown.
 *
 * Without this, the default 'general' selection matches nothing and the site
 * renders an empty table while holding a full catalogue. That is what shipping
 * the classification code ahead of its migration did to production. A filter
 * may narrow the view; it must never be the reason the site looks empty.
 */
export function resolveTypeFilter(
  rows: ReadonlyArray<{ model_type: ModelType | null }>,
  selected: string,
): string {
  // No rows at all says nothing about the schema — there is simply no data to
  // draw a conclusion from, and widening the filter on that basis would
  // override a selection for no reason.
  if (rows.length === 0) return selected

  return rows.some((row) => row.model_type !== null) ? selected : 'all'
}

/** Only general-purpose text generators belong in a cost-per-token ranking. */
export function isGenerative(type: ModelType | null): boolean {
  return type === 'general'
}

export type ClassificationStatus = 'confirmed' | 'needs_review'

/** How a type was reached. `manual` is never overwritten by the pipeline. */
export type ClassificationSource = 'manual' | 'derived'

export interface Classification {
  modelType: ModelType | null
  status: ClassificationStatus
  source: ClassificationSource | null
  /** Non-null whenever status is `needs_review`: what fired, and why it was not trusted. */
  note: string | null
}

/**
 * What a model accepts, produces and is notably good at.
 *
 * Recorded, never derived. A missing key means unknown, not empty — nothing may
 * render an absent capability as a negative claim.
 */
export interface Capabilities {
  input?: string[]
  output?: string[]
  features?: string[]
}

export const SOURCE_KINDS: readonly SourceKind[] = ['scrape', 'api', 'catalog', 'llm']

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
  /**
   * NOT SURFACED IN THE UI. The values here were largely guessed from model
   * names and are wrong often enough not to be shown; the column is kept so
   * the assignment can be rebuilt from sources that actually declare it.
   */
  modality: Modality[]
  /**
   * A sentence or two on what the model is for, as published by whoever
   * described it. Null when no source stated one — never a guess, since an
   * invented summary of a model is worse than no summary.
   */
  description: string | null
  tags: string[]
  isActive: boolean
  /**
   * 011 offer qualifiers. An offer is one provider selling one model; the
   * tier/region qualify it (standard-tier, unqualified-region offers are the
   * comparison basis). Optional so existing extractors change nothing.
   */
  offerTier?: string
  offerRegion?: string | null
  /**
   * Adapter's canonical-identity hint (e.g. a router that publishes the
   * upstream id). The resolver verifies hints with the same rules as
   * anything else — a hint is evidence, not authority.
   */
  canonicalHint?: string | null
  pricing: NormalizedPricing
  /** Assigned by the classifier; null type means not yet determined. */
  classification?: Classification
  /** Recorded only where a source declares it or a person wrote it down. */
  capabilities?: Capabilities | null
}

export interface ProviderDefinition {
  slug: string
  name: string
  website: string
  pricingUrl: string
  region: 'global' | 'cn'
  /** What kind of seller this is. Omitted = 'vendor' (all pre-011 rows). */
  providerType?: ProviderType
}

/** 011: sellers come in three kinds; comparisons label offers by it. */
export type ProviderType = 'vendor' | 'cloud' | 'router'

/** Public API row shape (v1). Keys are snake_case per the spec's example payload. */
export interface PriceRowV1 {
  provider: string
  provider_name: string
  model_id: string
  display_name: string
  description: string | null
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
  /** Unreliable — stored and served, but deliberately not displayed. Superseded by model_type. */
  modality: string[]
  tags: string[]
  /** Null means not yet determined, never "none of the above" — that is `other`. */
  model_type: ModelType | null
  classification_status: ClassificationStatus
  /** Null means unknown. Never `{}`, which would imply the model has no capabilities. */
  capabilities: Capabilities | null
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
