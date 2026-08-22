import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { computeTrend, TREND_MIN_BASKET } from '../src/lib/trend.ts'
import { isFlat } from '../src/lib/format.ts'

/**
 * 006-truthful-price-trend.
 *
 * The incident: the front page reported "prices up 0.14%" while the median
 * catalogue price was unchanged (0.680 then, 0.680 now) and movers split 10
 * down against 8 up. The rise came entirely from an unweighted mean over ~230
 * models, two of which had landed on a corrupted doubled value on the last
 * scrape. One of those two was an image-generation model, priced per image,
 * inside a card a reader takes as the price of tokens.
 */

/** A model with a flat series at `price` across `points` samples. */
function flatModel(price: number, points = 6, modelType = 'general') {
  return { modelType, series: Array.from({ length: points }, () => price) }
}

/** A model that starts at `from` and ends at `to`, stepping at the last sample. */
function movedModel(from: number, to: number, points = 6, modelType = 'general') {
  const series = Array.from({ length: points }, (_, i) => (i === points - 1 ? to : from))
  return { modelType, series }
}

test('the trend is unmoved by a handful of corrupted extreme values', () => {
  // Twenty typical models sitting still, and two expensive ones that appear to
  // have doubled. This is the shape of the reported defect.
  const rows = [
    ...Array.from({ length: 20 }, () => flatModel(0.68)),
    movedModel(4, 8),
    movedModel(2, 4),
  ]

  const result = computeTrend(rows)
  assert.equal(result.kind, 'series')
  if (result.kind !== 'series') return

  assert.ok(isFlat(result.pct), `expected no material change, got ${result.pct}%`)
  assert.equal(result.series[0], result.series[result.series.length - 1])
})

test('non-token-priced model types are excluded from the basket', () => {
  const rows = [
    ...Array.from({ length: 10 }, () => flatModel(0.68)),
    // An image model doubling must not reach a token-price trend at all.
    movedModel(4, 8, 6, 'image_gen'),
    movedModel(4, 8, 6, 'video_gen'),
    movedModel(4, 8, 6, 'tts'),
  ]

  const result = computeTrend(rows)
  assert.equal(result.kind, 'series')
  if (result.kind !== 'series') return

  assert.equal(result.basketSize, 10, 'only the token-priced models count')
  assert.ok(isFlat(result.pct))
})

test('a model without a price at every sample point is excluded, not back-filled', () => {
  // Back-filling a newcomer with its earliest known price is an assumption, not
  // data. Under a fixed basket the honest answer is to leave it out, so that a
  // change in *who is counted* cannot present as a change in price.
  const rows = [
    ...Array.from({ length: 10 }, () => flatModel(1)),
    { modelType: 'general', series: [50, 50] }, // shorter series: joined late
    { modelType: 'general', series: null },
  ]

  const result = computeTrend(rows)
  assert.equal(result.kind, 'series')
  if (result.kind !== 'series') return

  assert.equal(result.basketSize, 10)
  assert.deepEqual(result.series, [1, 1, 1, 1, 1, 1])
})

test('a basket too small to be meaningful reports insufficiency, not a number', () => {
  const rows = Array.from({ length: TREND_MIN_BASKET - 1 }, () => flatModel(1))

  const result = computeTrend(rows)
  assert.equal(result.kind, 'insufficient')

  // Distinguishable from a genuine zero-change result: a reader must be able to
  // tell "nothing moved" from "we cannot tell".
  const real = computeTrend(Array.from({ length: TREND_MIN_BASKET }, () => flatModel(1)))
  assert.equal(real.kind, 'series')
})

test('an empty catalogue reports insufficiency rather than drawing a line', () => {
  assert.equal(computeTrend([]).kind, 'insufficient')
})

test('a genuine broad price cut is still reported', () => {
  // The statistic must be resistant to outliers without being deaf to signal.
  const rows = Array.from({ length: 20 }, () => movedModel(1, 0.5))

  const result = computeTrend(rows)
  assert.equal(result.kind, 'series')
  if (result.kind !== 'series') return

  assert.ok(result.pct < -40, `expected a large fall, got ${result.pct}%`)
})

test('the trend is computed over the reader filters, not the popular scope', () => {
  // Asserted against the source rather than the rendered output: the scope
  // choice is a wiring decision inside a client component's useMemo, and the
  // constitution sanctions asserting configuration where the behaviour cannot
  // be observed reliably (Principle III).
  //
  // This is a regression guard on behaviour being deliberately KEPT, not a
  // red-green pair — price-explorer.tsx documents at its trend memo that the
  // trend is a statement about prices, not about which rows the page opened on.
  const source = readFileSync(new URL('../src/components/price-explorer.tsx', import.meta.url), 'utf8')
  const memo = source.match(/const trendResult = useMemo\(([\s\S]{0,500}?)\n\s*\)\n/)

  assert.ok(memo, 'expected a trend memo in price-explorer.tsx')
  assert.match(memo[1], /\bmatched\b/, 'the trend must read `matched`')
  assert.doesNotMatch(memo[1], /\bfiltered\b/, 'the trend must not narrow to the popular scope')
})
