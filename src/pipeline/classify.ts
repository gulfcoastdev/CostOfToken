import type { Classification, ModelType, NormalizedModel } from '@/lib/types.ts'

/**
 * What kind of thing a model is.
 *
 * The governing rule is that **a name never decides anything on its own**. The
 * catalogue already carries a column that was populated by inferring from
 * model names, and it is wrong often enough that the project's own
 * documentation forbids displaying it: `gpt-image-1` is recorded there as a
 * text-only model, as are `gemini-embedding` and `glm-ocr`. Repeating that
 * mistake in a new column would be worse than having no column, because this
 * one decides what appears in the cheapest ranking.
 *
 * So a name pattern is treated as a *hint* that must be corroborated by
 * independent evidence — the shape of the vendor's own pricing. Where the two
 * agree, the type is recorded. Where they disagree, the model is flagged for a
 * person and left untyped. Flagged is a valid, honest outcome; a plausible
 * guess is not.
 *
 * Evidence that was considered and rejected is documented in
 * specs/003-model-classification/research.md — notably OpenRouter's declared
 * output modalities, which are reliable but useless here because its catalogue
 * contains only text generators, and vendor page section headings, which exist
 * but are semantically empty ("Grouped Pricing Table data").
 */

/**
 * Name hints, most specific first — `speech-to-text` must beat `speech`, and
 * `-audio` must not swallow `gpt-audio` before `realtime` has been considered.
 * Order matters: the first match wins.
 */
const TYPE_HINTS: Array<{ pattern: RegExp; type: ModelType }> = [
  { pattern: /speech[-_]?to[-_]?text|transcrib|whisper|\basr\b/i, type: 'asr' },
  { pattern: /embed/i, type: 'embedding' },
  { pattern: /moderation|guard/i, type: 'moderation' },
  { pattern: /\bocr\b/i, type: 'ocr' },
  { pattern: /realtime|[-_]audio\b|\baudio[-_]/i, type: 'realtime' },
  { pattern: /\btts\b|text[-_]?to[-_]?speech|[-_]speech\b/i, type: 'tts' },
  { pattern: /\bveo\b|\bsora\b|video/i, type: 'video_gen' },
  { pattern: /image/i, type: 'image_gen' },
  { pattern: /rerank/i, type: 'other' },
]

function hintFor(modelId: string): { pattern: RegExp; type: ModelType } | null {
  return TYPE_HINTS.find((hint) => hint.pattern.test(modelId)) ?? null
}

export interface ClassificationOverride {
  model_type?: ModelType
}

export function classifyModel(
  model: NormalizedModel,
  override?: ClassificationOverride,
): Classification {
  // Rule 1 — a person checked the provider's documentation and wrote it down.
  // Always wins, and is never overwritten by a later run.
  if (override?.model_type) {
    return {
      modelType: override.model_type,
      status: 'confirmed',
      source: 'manual',
      note: null,
    }
  }

  const hint = hintFor(model.modelId)
  const { inputPrice, outputPrice } = model.pricing
  // A model that bills for output tokens is billing for generated text. That
  // is the independent signal the name hints are checked against.
  const billsForOutput = outputPrice !== null
  const billsForInput = inputPrice !== null

  // Rule 2 — the hint and the billing agree. Two independent signals.
  if (hint && !billsForOutput) {
    return { modelType: hint.type, status: 'confirmed', source: 'derived', note: null }
  }

  // Rule 3 — the hint and the billing disagree, so nothing decides it. This is
  // where the image, OCR and some speech models land: their ids say one thing
  // and their pricing says another.
  if (hint && billsForOutput) {
    return {
      modelType: null,
      status: 'needs_review',
      source: null,
      note:
        `Name suggests ${hint.type} (matched ${hint.pattern.source}), but the model has an ` +
        `output price, which a non-generative model normally lacks. Confirm against the ` +
        `provider's documentation and record the decision in data/overrides.ts.`,
    }
  }

  // Rule 4 — no non-chat signal, and priced like a generator on both sides.
  if (billsForInput && billsForOutput) {
    return { modelType: 'general', status: 'confirmed', source: 'derived', note: null }
  }

  // Rule 5 — not enough to say. Deliberately not 'general': a model with no
  // output price is not a cheap text generator, it is a different kind of
  // thing, and guessing here is exactly what puts a moderation endpoint at the
  // top of a cheapest-models ranking.
  return {
    modelType: null,
    status: 'needs_review',
    source: null,
    note: billsForOutput
      ? 'No usable signal: no input price and no name hint.'
      : 'No output price and no name hint, so the model produces no billable generated text but its kind is unclear.',
  }
}
