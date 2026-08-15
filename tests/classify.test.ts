import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyModel } from '../src/pipeline/classify.ts'
import type { NormalizedModel } from '../src/lib/types.ts'

/**
 * Classification rules, in isolation.
 *
 * Every fixture below is a real model from the catalogue, chosen because it is
 * awkward. The whole point of this feature is to stop guessing from names —
 * the existing `modality` column records `gpt-image-1` as text-only and
 * `gemini-embedding` as text-only — so the cases that matter are the ones
 * where a name hint is present but not corroborated.
 */

function model(overrides: Partial<NormalizedModel> = {}): NormalizedModel {
  return {
    providerSlug: 'openai',
    modelId: 'gpt-5',
    displayName: 'GPT-5',
    contextWindow: 400_000,
    maxOutputTokens: null,
    longContextThreshold: null,
    modality: ['text'],
    description: null,
    tags: [],
    isActive: true,
    pricing: {
      inputPrice: 1.25,
      cachedInputPrice: 0.125,
      outputPrice: 10,
      longInputPrice: null,
      longCachedInputPrice: null,
      longOutputPrice: null,
      currency: 'USD',
      sourceUrl: null,
      sourceKind: 'scrape',
    },
    ...overrides,
  }
}

/** A model priced for input but producing no billable output. */
function noOutput(overrides: Partial<NormalizedModel> = {}): NormalizedModel {
  const base = model(overrides)
  return { ...base, pricing: { ...base.pricing, outputPrice: null } }
}

// ---------------------------------------------------------------------------
// Coherence — the invariants that make a classification trustworthy
// ---------------------------------------------------------------------------

test('a confirmed classification always carries a type', () => {
  for (const m of [
    model(),
    noOutput({ modelId: 'text-embedding-3-small' }),
    model({ modelId: 'gpt-image-1' }),
  ]) {
    const result = classifyModel(m)
    if (result.status === 'confirmed') {
      assert.notEqual(result.modelType, null, `${m.modelId} confirmed with no type`)
    }
  }
})

test('a flagged classification never carries a type, and always says why', () => {
  const result = classifyModel(model({ modelId: 'gpt-image-1' }))

  assert.equal(result.status, 'needs_review')
  assert.equal(result.modelType, null, 'a flagged model must not be assigned a type')
  assert.ok(result.note && result.note.length > 0, 'a flagged model must explain itself')
})

// ---------------------------------------------------------------------------
// Rule 1 — a human decision wins
// ---------------------------------------------------------------------------

test('a manual override beats every other signal', () => {
  // gpt-image-1 has an output price, so the automatic rules refuse to type it.
  // A person who checked the docs settles it, and that decision is final.
  const result = classifyModel(model({ providerSlug: 'openai', modelId: 'gpt-image-1' }), {
    model_type: 'image_gen',
  })

  assert.equal(result.modelType, 'image_gen')
  assert.equal(result.status, 'confirmed')
  assert.equal(result.source, 'manual')
})

test('a manual override wins even where the rules would have agreed', () => {
  const result = classifyModel(model(), { model_type: 'other' })

  assert.equal(result.modelType, 'other')
  assert.equal(result.source, 'manual')
})

// ---------------------------------------------------------------------------
// Rule 2 — a name hint corroborated by the price shape
// ---------------------------------------------------------------------------

test('a non-chat name with no output price is typed', () => {
  // Two independent signals: the vendor's own billing produces no output
  // charge, and the id says what it is. That is evidence, not a guess.
  const cases: Array<[string, string]> = [
    ['text-embedding-3-small', 'embedding'],
    ['gemini-embedding', 'embedding'],
    ['omni-moderation-latest', 'moderation'],
    ['tts-1-hd', 'tts'],
    ['gpt-realtime', 'realtime'],
    ['whisper-1', 'asr'],
  ]

  for (const [modelId, expected] of cases) {
    const result = classifyModel(noOutput({ modelId }))
    assert.equal(result.modelType, expected, `${modelId} should be ${expected}`)
    assert.equal(result.status, 'confirmed', `${modelId} should be confirmed`)
    assert.equal(result.source, 'derived')
  }
})

// ---------------------------------------------------------------------------
// Rule 3 — a name hint the price shape does not corroborate
// ---------------------------------------------------------------------------

test('a non-chat name WITH an output price is flagged, not typed', () => {
  // These are the models the old column got wrong. The name says one thing and
  // the billing says another, so nothing decides it automatically.
  for (const modelId of ['gpt-image-1', 'gemini-3-pro-image', 'glm-ocr', 'gemini-3.1-flash-tts-preview']) {
    const result = classifyModel(model({ modelId }))

    assert.equal(result.modelType, null, `${modelId} must not be typed on a name alone`)
    assert.equal(result.status, 'needs_review')
    assert.match(result.note ?? '', /output price/i, `${modelId} note should name the conflict`)
  }
})

test('the flag names the hint that fired, so the queue is actionable', () => {
  const result = classifyModel(model({ modelId: 'glm-ocr', providerSlug: 'zhipu' }))

  assert.match(result.note ?? '', /ocr/i)
})

// ---------------------------------------------------------------------------
// Rule 4 — no non-chat signal, and priced like a generator
// ---------------------------------------------------------------------------

test('a model with no non-chat signal and both prices is a text generator', () => {
  // Not an assumption: being billed for output tokens *is* being billed for
  // generated text.
  const result = classifyModel(model())

  assert.equal(result.modelType, 'general')
  assert.equal(result.status, 'confirmed')
  assert.equal(result.source, 'derived')
})

test('a free general-purpose model is still general', () => {
  // Zhipu's GLM Flash models are genuinely $0. Zero is a price, not a missing
  // one — the distinction the whole site rests on.
  const base = model({ modelId: 'glm-4.7-flash', providerSlug: 'zhipu' })
  const free = { ...base, pricing: { ...base.pricing, inputPrice: 0, outputPrice: 0 } }

  assert.equal(classifyModel(free).modelType, 'general')
})

// ---------------------------------------------------------------------------
// Rule 5 — everything else
// ---------------------------------------------------------------------------

test('a model with no output price and no name hint is flagged, never general', () => {
  const result = classifyModel(noOutput({ modelId: 'mystery-model-2' }))

  assert.equal(result.modelType, null)
  assert.equal(result.status, 'needs_review')
})

test('a model with no prices at all is flagged', () => {
  const base = model({ modelId: 'unpriced-thing' })
  const unpriced = { ...base, pricing: { ...base.pricing, inputPrice: null, outputPrice: null } }

  assert.equal(classifyModel(unpriced).status, 'needs_review')
})

// ---------------------------------------------------------------------------
// Capabilities — recorded, never derived
// ---------------------------------------------------------------------------

test('classification does not invent capabilities', () => {
  // The classifier's job is the type. Capabilities come from a declaring
  // source or a person; anything else recreates the modality problem.
  const result = classifyModel(model())

  assert.ok(!('capabilities' in result), 'classifyModel must not produce capabilities')
})
