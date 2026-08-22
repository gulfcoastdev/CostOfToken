import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NormalizedModel } from '../src/lib/types.ts'
import {
  type BaselineModel,
  detectAnomalies,
  hasBlocking,
} from '../src/pipeline/anomaly.ts'

function baseline(count: number, input = 1, output = 4): BaselineModel[] {
  return Array.from({ length: count }, (_, i) => ({
    modelId: `model-${i}`,
    inputPrice: input,
    cachedInputPrice: input / 10,
    outputPrice: output,
  }))
}

function incoming(
  count: number,
  input: number | null = 1,
  output: number | null = 4,
  cached: number | null = 0.1,
): NormalizedModel[] {
  return Array.from({ length: count }, (_, i) => ({
    providerSlug: 'test',
    modelId: `model-${i}`,
    displayName: `Model ${i}`,
    contextWindow: 128_000,
    maxOutputTokens: null,
    longContextThreshold: null,
    description: null,
    modality: ['text'] as NormalizedModel['modality'],
    tags: [],
    isActive: true,
    pricing: {
      inputPrice: input,
      cachedInputPrice: cached,
      outputPrice: output,
      longInputPrice: null,
      longCachedInputPrice: null,
      longOutputPrice: null,
      currency: 'USD',
      sourceUrl: null,
      sourceKind: 'scrape' as const,
    },
  }))
}

test('an unchanged run raises nothing', () => {
  assert.deepEqual(detectAnomalies(baseline(20), incoming(20)), [])
})

test('a new provider with no baseline raises nothing', () => {
  // Otherwise every first run would alert, which trains people to ignore it.
  assert.deepEqual(detectAnomalies([], incoming(50)), [])
  assert.deepEqual(detectAnomalies(baseline(3), incoming(1)), [])
})

test('coverage collapse blocks the write', () => {
  // The real failure: OpenAI's HTML exposed 13 of 73 models because the rest
  // sat in unselected tabs, and the run still reported ok.
  const found = detectAnomalies(baseline(73), incoming(13))
  const drop = found.find((a) => a.code === 'coverage_drop')

  assert.ok(drop, 'expected a coverage_drop anomaly')
  assert.equal(drop.severity, 'block')
  assert.equal(hasBlocking(found), true)
  assert.match(drop.message, /82%/)
})

test('a mild coverage dip warns but still writes', () => {
  const found = detectAnomalies(baseline(20), incoming(16))
  const drop = found.find((a) => a.code === 'coverage_drop')

  assert.ok(drop)
  assert.equal(drop.severity, 'warn')
  assert.equal(hasBlocking(found), false)
})

test('a uniform price multiple blocks the write', () => {
  // The other real failure: every OpenAI price was exactly 2x standard,
  // because the Priority tier table overwrote the standard one.
  const found = detectAnomalies(baseline(20, 5, 30), incoming(20, 10, 60))
  const shift = found.find((a) => a.code === 'uniform_price_shift')

  assert.ok(shift, 'expected a uniform_price_shift anomaly')
  assert.equal(shift.severity, 'block')
  assert.equal(shift.details.modalRatio, 2)
  assert.match(shift.message, /exactly 2x/)
})

test('a batch-tier swap is caught the same way', () => {
  const found = detectAnomalies(baseline(20, 10, 50), incoming(20, 5, 25))
  const shift = found.find((a) => a.code === 'uniform_price_shift')

  assert.ok(shift)
  assert.equal(shift.details.modalRatio, 0.5)
})

test('a genuine repricing of varied sizes is not blocked', () => {
  // A real vendor repricing moves models by different amounts. Only uniformity
  // indicates a parsing fault, so this must stay writable.
  const before = baseline(20, 1, 4)
  const after = incoming(20)
  after.forEach((model, i) => {
    model.pricing.inputPrice = 1 * (1 + (i % 7) * 0.03)
  })

  const found = detectAnomalies(before, after)
  assert.equal(hasBlocking(found), false)
  assert.ok(found.some((a) => a.code === 'mass_price_change'))
})

test('a column quietly going null blocks the write', () => {
  // If a provider renames "Cached input", the column lookup returns -1 and
  // every value silently becomes null while prices stay plausible.
  const found = detectAnomalies(baseline(20), incoming(20, 1, 4, null))
  const collapse = found.find((a) => a.code === 'field_collapse')

  assert.ok(collapse, 'expected a field_collapse anomaly')
  assert.equal(collapse.severity, 'block')
  assert.equal(collapse.details.field, 'cached_input_price')
})

test('models added, not removed, raises nothing', () => {
  // Going 13 -> 73 is the fix landing, not a fault.
  assert.equal(hasBlocking(detectAnomalies(baseline(13), incoming(73))), false)
})

// ---------------------------------------------------------------------------
// 006-truthful-price-trend: mixed-direction tier shifts.
//
// checkPriceShift was built on the assumption stated in its own docstring —
// that a mis-latched tier moves *every* model by exactly the same ratio. That
// held while a whole page shared one tier. It stopped holding when the tier
// became a property of each table: one run then took some models from the
// batch table (0.5x) and others from the fast-mode table (2x), no single ratio
// dominated, uniformity fell below threshold, and nothing blocked.
// ---------------------------------------------------------------------------

/** Half the models doubled, half halved — a per-table tier mix-up. */
function mixedTierShift(count: number): NormalizedModel[] {
  return incoming(count).map((model, i) => ({
    ...model,
    pricing: { ...model.pricing, inputPrice: i % 2 === 0 ? 2 : 0.5 },
  }))
}

test('a mixed-direction tier shift blocks the write', () => {
  const found = detectAnomalies(baseline(20), mixedTierShift(20))
  const shift = found.find((a) => a.code === 'tier_shaped_shift')

  assert.ok(shift, 'a run split between 2x and 0.5x must be caught')
  assert.equal(shift.severity, 'block')
  assert.ok(hasBlocking(found))
})

test('a mixed-direction tier shift is caught even when no single ratio dominates', () => {
  // Three tiers at once: standard, batch (0.5x) and fast mode (2x). The modal
  // ratio here accounts for a third of the changes, nowhere near uniformity.
  const models = incoming(30).map((model, i) => ({
    ...model,
    pricing: { ...model.pricing, inputPrice: [1, 0.5, 2][i % 3] },
  }))

  const found = detectAnomalies(baseline(30), models)
  assert.ok(found.some((a) => a.code === 'tier_shaped_shift' && a.severity === 'block'))
})

test('a genuine repricing of varied sizes is not caught as a tier shift', () => {
  // Real repricings land on untidy numbers. Exact halves and doubles are the
  // signal; these are not.
  const varied = [0.87, 1.13, 0.94, 1.05, 0.78, 1.22, 0.91, 1.08, 0.83, 1.17]
  const models = incoming(10).map((model, i) => ({
    ...model,
    pricing: { ...model.pricing, inputPrice: varied[i] },
  }))

  const found = detectAnomalies(baseline(10), models)
  assert.ok(!found.some((a) => a.code === 'tier_shaped_shift'))
})

test('a tiny provider cannot trip the tier check by coincidence', () => {
  // Two models halving is a plausible price cut, not evidence of a parser bug.
  const models = incoming(6).map((model, i) => ({
    ...model,
    pricing: { ...model.pricing, inputPrice: i < 2 ? 0.5 : 1 },
  }))

  const found = detectAnomalies(baseline(6), models)
  assert.ok(!found.some((a) => a.code === 'tier_shaped_shift'))
})

test('the existing uniform-shift check still fires and still blocks', () => {
  // Regression guard on behaviour deliberately kept: a whole provider moving by
  // one ratio must keep raising the original code, not be silently reclassified.
  const found = detectAnomalies(baseline(10), incoming(10, 2))
  assert.ok(found.some((a) => a.code === 'uniform_price_shift' && a.severity === 'block'))
})

// ---------------------------------------------------------------------------
// 008-price-fault-alerts: a price that will not settle.
//
// Measured over 14 days of production history: 23 price changes landed within
// 24 hours of that model's previous change. Genuine churn is untidy — ratios
// like 0.9975, 0.8625, 1.3034, mostly from a reseller quoting per-token
// decimals. Exactly one of the 23 landed on a clean commercial multiple, and
// that one was the fault: 0.440 -> 0.220 after nine hours.
//
// This flags, it does not block. Price changes are ordinary and the operator
// decides which are wrong: "model changes happen. Just monitor them and let
// me know."
// ---------------------------------------------------------------------------

function baselineAt(count: number, input: number, hoursAgo: number | null): BaselineModel[] {
  const at = hoursAgo === null ? null : new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
  return Array.from({ length: count }, (_, i) => ({
    modelId: `model-${i}`,
    inputPrice: input,
    cachedInputPrice: input / 10,
    outputPrice: input * 4,
    lastChangedAt: at,
  }))
}

test('a price that moved again within the window is flagged, not blocked', () => {
  const found = detectAnomalies(baselineAt(10, 1, 9), incoming(10, 0.5))
  const flag = found.find((a) => a.code === 'unsettled_price')

  assert.ok(flag, 'a re-change inside the window must be flagged')
  assert.equal(flag.severity, 'warn', 'flagging must never block a write')
  assert.equal(hasBlocking(found.filter((a) => a.code === 'unsettled_price')), false)
})

test('the second incident is caught: one model, exact half, nine hours later', () => {
  const before = baselineAt(15, 0.44, 9)
  const after = incoming(15, 0.44).map((m, i) =>
    i === 0 ? { ...m, pricing: { ...m.pricing, inputPrice: 0.22 } } : m,
  )

  const flag = detectAnomalies(before, after).find((a) => a.code === 'unsettled_price')
  assert.ok(flag, 'a single model re-pricing inside the window must still be reported')

  const models = (flag.details as { models: Array<{ modelId: string; ratio: number }> }).models
  assert.equal(models.length, 1)
  assert.equal(models[0].ratio, 0.5, 'the exact multiple is what marks it as a likely parser fault')
})

test('a first-ever change is not flagged', () => {
  // No recorded prior change means nothing to be suspicious about.
  const found = detectAnomalies(baselineAt(10, 1, null), incoming(10, 0.5))
  assert.ok(!found.some((a) => a.code === 'unsettled_price'))
})

test('a change outside the window is not flagged', () => {
  // Two legitimate changes were measured at exactly 24h apart, which is what a
  // daily cron produces. The boundary must be exclusive or every steady daily
  // repricing would be reported.
  const found = detectAnomalies(baselineAt(10, 1, 24), incoming(10, 0.5))
  assert.ok(!found.some((a) => a.code === 'unsettled_price'))
})

test('an unchanged price inside the window is not flagged', () => {
  const found = detectAnomalies(baselineAt(10, 1, 2), incoming(10, 1))
  assert.ok(!found.some((a) => a.code === 'unsettled_price'))
})

test('flagging does not disturb the existing blocking checks', () => {
  // Regression guard: a uniform 2x shift must still block, and must still be
  // reported under its own code rather than absorbed into the new one.
  const found = detectAnomalies(baselineAt(10, 1, 2), incoming(10, 2))
  assert.ok(found.some((a) => a.code === 'uniform_price_shift' && a.severity === 'block'))
  assert.ok(hasBlocking(found))
})
