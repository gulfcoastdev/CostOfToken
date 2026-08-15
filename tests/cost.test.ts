import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimateCost, formatCostShort, rankByWorkload, unusableReason } from '../src/lib/cost.ts'
import type { PriceRowV1 } from '../src/lib/types.ts'

function model(overrides: Partial<PriceRowV1> = {}): PriceRowV1 {
  return {
    provider: 'test',
    provider_name: 'Test',
    model_id: 'test-model',
    display_name: 'Test Model',
    input: 1,
    cached_input: 0.1,
    output: 4,
    context_window: 128_000,
    max_output_tokens: null,
    long_context_threshold: null,
    long_input: null,
    long_cached_input: null,
    long_output: null,
    currency: 'USD',
    description: null,
    modality: ['text'],
    tags: [],
    model_type: 'chat',
    classification_status: 'confirmed',
    capabilities: null,
    source_url: null,
    source_kind: 'scrape',
    updated_at: null,
    ...overrides,
  }
}

const workload = {
  inputTokens: 1_000,
  outputTokens: 1_000,
  requestsPerMonth: 1_000,
  cachedShare: 0,
}

test('cost is input plus output, scaled by volume', () => {
  // 1000 in at $1/1M + 1000 out at $4/1M = $0.005 per request.
  const estimate = estimateCost(model(), workload)
  assert.equal(estimate.perRequest, 0.005)
  assert.equal(estimate.monthly, 5)
})

test('cached share bills part of the input at the cached rate', () => {
  // Half of 1000 input tokens at $0.10/1M instead of $1/1M.
  const estimate = estimateCost(model(), { ...workload, cachedShare: 0.5 })
  const expected = (500 * 1 + 500 * 0.1 + 1000 * 4) / 1_000_000
  assert.equal(estimate.perRequest, expected)
})

test('an unpublished cached rate bills at the full input price, not free', () => {
  const withCache = estimateCost(model(), { ...workload, cachedShare: 1 })
  const without = estimateCost(model({ cached_input: null }), { ...workload, cachedShare: 1 })

  assert.ok(without.perRequest! > withCache.perRequest!)
  // Identical to sending no cached tokens at all.
  assert.equal(without.perRequest, estimateCost(model({ cached_input: null }), workload).perRequest)
})

test('cached share is clamped to a sane range', () => {
  const over = estimateCost(model(), { ...workload, cachedShare: 5 })
  const at = estimateCost(model(), { ...workload, cachedShare: 1 })
  assert.equal(over.perRequest, at.perRequest)

  const under = estimateCost(model(), { ...workload, cachedShare: -3 })
  assert.equal(under.perRequest, estimateCost(model(), { ...workload, cachedShare: 0 }).perRequest)
})

test('models that cannot generate text are unusable, not free', () => {
  // Regression: embedding and moderation endpoints publish no output price.
  // Treating that as zero ranked them as the cheapest way to run a chat.
  const embedding = model({ input: 0.02, output: null })

  assert.equal(unusableReason(embedding, 1_000), 'no-output-pricing')
  const estimate = estimateCost(embedding, workload)
  assert.equal(estimate.monthly, null)
  assert.equal(estimate.isFree, false)
})

test('a model with no output price is usable when nothing is generated', () => {
  const embedding = model({ input: 0.02, output: null })
  const estimate = estimateCost(embedding, { ...workload, outputTokens: 0 })
  assert.equal(estimate.unusable, null)
  assert.ok((estimate.monthly ?? 0) > 0)
})

test('a prompt larger than the context window is flagged, not hidden', () => {
  const small = model({ context_window: 8_000 })
  const estimate = estimateCost(small, { ...workload, inputTokens: 20_000 })
  assert.equal(estimate.fitsContext, false)
  // Still priced — the caller decides what to do with it.
  assert.ok((estimate.monthly ?? 0) > 0)
})

test('an unpublished context window is not treated as too small', () => {
  const unknown = model({ context_window: null })
  assert.equal(estimateCost(unknown, { ...workload, inputTokens: 900_000 }).fitsContext, true)
})

test('free models are separated from the paid ranking', () => {
  // Regression: at zero cost they win every comparison by default.
  const rows = [
    model({ model_id: 'free', input: 0, output: 0 }),
    model({ model_id: 'cheap', input: 0.5, output: 1 }),
    model({ model_id: 'dear', input: 5, output: 20 }),
  ]

  const { paid, free } = rankByWorkload(rows, workload)

  assert.deepEqual(free.map((e) => e.row.model_id), ['free'])
  assert.deepEqual(paid.map((e) => e.row.model_id), ['cheap', 'dear'])
})

test('unusable models are reported separately from both', () => {
  const rows = [
    model({ model_id: 'chat' }),
    model({ model_id: 'embedding', output: null }),
    model({ model_id: 'unpriced', input: null, output: null }),
  ]

  const { paid, unusable } = rankByWorkload(rows, workload)

  assert.deepEqual(paid.map((e) => e.row.model_id), ['chat'])
  assert.deepEqual(
    unusable.map((e) => [e.row.model_id, e.unusable]),
    [
      ['embedding', 'no-output-pricing'],
      ['unpriced', 'no-pricing'],
    ],
  )
})

test('the cheapest model changes with the shape of the workload', () => {
  // The premise of the whole calculator: cheap input with dear output wins for
  // retrieval and loses for generation.
  const inputHeavy = model({ model_id: 'cheap-input', input: 0.1, cached_input: 0.01, output: 30 })
  const outputHeavy = model({ model_id: 'cheap-output', input: 3, cached_input: 0.3, output: 1 })
  const rows = [inputHeavy, outputHeavy]

  const rag = rankByWorkload(rows, {
    inputTokens: 50_000,
    outputTokens: 200,
    requestsPerMonth: 1,
    cachedShare: 0,
  })
  const generation = rankByWorkload(rows, {
    inputTokens: 500,
    outputTokens: 4_000,
    requestsPerMonth: 1,
    cachedShare: 0,
  })

  assert.equal(rag.paid[0].row.model_id, 'cheap-input')
  assert.equal(generation.paid[0].row.model_id, 'cheap-output')
})

test('formatCostShort scales units and keeps small amounts readable', () => {
  assert.equal(formatCostShort(null), '—')
  assert.equal(formatCostShort(0), '$0')
  assert.equal(formatCostShort(0.0004), '$0.0004')
  assert.equal(formatCostShort(12.5), '$12.50')
  assert.equal(formatCostShort(2_400), '$2.4K')
  assert.equal(formatCostShort(3_450_000), '$3.45M')
})
