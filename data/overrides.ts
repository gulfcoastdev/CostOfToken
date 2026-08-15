import type { Capabilities, Modality, ModelType } from '@/lib/types.ts'

/**
 * Hand-curated corrections applied after extraction, keyed by provider +
 * model_id. These win over anything a scraper or the metadata catalogue
 * produced, so use them for facts a page states wrongly or not at all.
 *
 * Prices are deliberately NOT overridable here. A hand-edited price is
 * indistinguishable from a fresh scrape once it lands in the table, and a
 * stale one silently defeats the point of a freshness tracker. When a price is
 * wrong, fix the extractor.
 */
export interface ModelOverride {
  provider: string
  model_id: string
  display_name?: string
  context_window?: number
  max_output_tokens?: number
  long_context_threshold?: number
  /** Replaces whatever prose extraction found. Write it as a fact, not a pitch. */
  description?: string
  modality?: Modality[]
  /**
   * A human decision about what kind of model this is. Always wins over the
   * classifier and is never overwritten by a pipeline run — which is the
   * point: the automatic rules deliberately refuse to guess, so this is where
   * the answer goes once someone has checked the provider's documentation.
   */
  model_type?: ModelType
  /** Recorded, never derived. Omit rather than guessing. */
  capabilities?: Capabilities
  tags?: string[]
  is_active?: boolean
  notes?: string
}

export const MODEL_OVERRIDES: ModelOverride[] = [
  // Example — delete or replace:
  // {
  //   provider: 'anthropic',
  //   model_id: 'claude-opus-4-5',
  //   context_window: 200_000,
  //   tags: ['flagship', 'reasoning'],
  //   notes: 'Context window is not published on the pricing page.',
  // },
]
