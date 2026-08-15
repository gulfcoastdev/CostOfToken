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
  /*
   * Classification decisions, worked through `npm run classify:review`.
   *
   * Each of these has a non-chat name AND an output price, so the automatic
   * rules refused to type it — a name alone never decides anything here. Every
   * entry below was checked against the provider's own published page, and the
   * evidence is quoted in `notes` so the decision can be re-checked rather
   * than taken on trust.
   */

  // OpenAI states the modality in its own pricing table's second column, e.g.
  // `| gpt-image-1 | Image | ... |`. That is a first-party declaration, not an
  // inference from the id.
  { provider: 'openai', model_id: 'gpt-image-1', model_type: 'image_gen',
    notes: 'platform.openai.com/docs/pricing.md lists it under modality "Image".' },
  { provider: 'openai', model_id: 'gpt-image-1-mini', model_type: 'image_gen',
    notes: 'platform.openai.com/docs/pricing.md lists it under modality "Image".' },
  { provider: 'openai', model_id: 'gpt-image-1.5', model_type: 'image_gen',
    notes: 'platform.openai.com/docs/pricing.md lists it under modality "Image".' },
  { provider: 'openai', model_id: 'gpt-image-2', model_type: 'image_gen',
    notes: 'platform.openai.com/docs/pricing.md lists it under modality "Image".' },
  { provider: 'openai', model_id: 'chatgpt-image-latest', model_type: 'image_gen',
    notes: 'platform.openai.com/docs/pricing.md lists it under modality "Image".' },
  { provider: 'openai', model_id: 'gpt-4o-transcribe', model_type: 'asr',
    notes: 'platform.openai.com/docs/pricing.md lists it under modality "Transcription".' },
  { provider: 'openai', model_id: 'gpt-4o-mini-transcribe', model_type: 'asr',
    notes: 'platform.openai.com/docs/pricing.md lists it under modality "Transcription".' },
  { provider: 'openai', model_id: 'gpt-4o-transcribe-diarize', model_type: 'asr',
    notes: 'platform.openai.com/docs/pricing.md lists it as "Transcription + diarization".' },

  // Google describes each model in prose on its own pricing page.
  { provider: 'google', model_id: 'gemini-2.5-flash-preview-tts', model_type: 'tts',
    notes: 'ai.google.dev pricing: "Our 2.5 Flash text-to-speech audio model".' },
  { provider: 'google', model_id: 'gemini-2.5-pro-preview-tts', model_type: 'tts',
    notes: 'ai.google.dev pricing: the Pro text-to-speech audio model.' },
  { provider: 'google', model_id: 'gemini-3.1-flash-tts-preview', model_type: 'tts',
    notes: 'ai.google.dev pricing: text-to-speech audio model.' },
  { provider: 'google', model_id: 'gemini-2.5-flash-native-audio', model_type: 'realtime',
    notes: 'ai.google.dev pricing: "Our Live API native audio models".' },
  { provider: 'google', model_id: 'gemini-2.5-flash-image', model_type: 'image_gen',
    notes: 'ai.google.dev pricing: image generation model, billed per generated image.' },
  { provider: 'google', model_id: 'gemini-3-pro-image', model_type: 'image_gen',
    notes: 'ai.google.dev pricing: image generation model.' },
  { provider: 'google', model_id: 'gemini-3.1-flash-image', model_type: 'image_gen',
    notes: 'ai.google.dev pricing: "the Gemini 3.1 Flash Image generation" model.' },
  { provider: 'google', model_id: 'gemini-3.1-flash-lite-image', model_type: 'image_gen',
    notes: 'ai.google.dev pricing: Flash Lite image generation model.' },

  // glm-ocr is deliberately left unclassified: Zhipu's pricing page is not
  // machine readable and nothing first-party was found that states whether it
  // emits text (making it a generator that happens to read images) or is a
  // pure extraction endpoint. Flagged is the honest answer until someone
  // checks. It stays reachable under "Needs review".

  // Example — delete or replace:
  // {
  //   provider: 'anthropic',
  //   model_id: 'claude-opus-4-5',
  //   context_window: 200_000,
  //   tags: ['flagship', 'reasoning'],
  //   notes: 'Context window is not published on the pricing page.',
  // },
]
