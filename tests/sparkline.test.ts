import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FLAT_PERCENT } from '../src/lib/format.ts'
import { FULL_SCALE_PERCENT, scaleSeries } from '../src/lib/chart-scale.ts'

/**
 * 006-truthful-price-trend.
 *
 * The incident, visible on the published card: the badge read "Flat", both
 * endpoint labels read the same dollar value, and the line drawn between them
 * climbed most of the height of the card. Both charts scaled to the series'
 * own min and max with a fallback that only triggered on a *perfectly* flat
 * series, so a 0.14% movement filled the box.
 */

const HEIGHT = 100

/** Vertical distance the drawn line covers, as a fraction of the box. */
function drawnSpan(series: number[]): number {
  const ys = scaleSeries(series, HEIGHT, 0)
  return (Math.max(...ys) - Math.min(...ys)) / HEIGHT
}

/** A two-point series moving by `pct` percent. */
function moved(pct: number, level = 4): number[] {
  return [level, level * (1 + pct / 100)]
}

test('a movement below the flat threshold is drawn as visually negligible', () => {
  // 0.14% is the exact movement that was drawn as a full-height climb.
  assert.ok(drawnSpan(moved(0.14)) < 0.05, 'a 0.14% move must not fill the chart')
  assert.ok(drawnSpan(moved(FLAT_PERCENT)) < 0.05, 'anything the badge calls flat must look flat')
})

test('a large movement is still clearly legible', () => {
  assert.ok(drawnSpan(moved(-50)) > 0.9, 'a halving must span the chart')
  assert.ok(drawnSpan(moved(FULL_SCALE_PERCENT)) > 0.9, 'full scale is reached as documented')
  // Mid-range movements stay proportional rather than saturating.
  const half = drawnSpan(moved(FULL_SCALE_PERCENT / 2))
  assert.ok(half > 0.4 && half < 0.6, `expected roughly half height, got ${half}`)
})

test('a perfectly flat series renders without dividing by zero', () => {
  const ys = scaleSeries([3, 3, 3, 3], HEIGHT, 0)
  assert.ok(ys.every((y) => Number.isFinite(y)), 'no NaN or Infinity')
  assert.equal(new Set(ys).size, 1, 'a flat series is a flat line')
})

test('endpoints that display the same price are drawn at the same height', () => {
  // The exact contradiction a reader reported: "$3.00 then" and "$3.00 now"
  // either side of a line that visibly climbed. Two values that round to the
  // same displayed cent must not be a visible movement.
  const ys = scaleSeries([3.8867, 3.8923], HEIGHT, 0)
  assert.ok(Math.abs(ys[0] - ys[1]) < HEIGHT * 0.02, 'sub-cent drift must not read as a rise')
})

test('the scale holds at both ends of the catalogue price range', () => {
  // $0.06 to $30 per million tokens. A floor expressed in dollars would be
  // wrong at one end or the other, so it is relative to the series' level.
  for (const level of [0.06, 0.68, 30]) {
    assert.ok(drawnSpan(moved(0.14, level)) < 0.05, `cheap and dear alike: ${level}`)
    assert.ok(drawnSpan(moved(-50, level)) > 0.9, `a halving is visible at ${level}`)
  }
})

test('the chart cannot contradict the badge by construction', () => {
  // Guard on the relationship rather than the numbers: whatever the badge calls
  // flat must be well inside the chart's full-scale window.
  assert.ok(FULL_SCALE_PERCENT > FLAT_PERCENT * 4, 'flat must be a small fraction of full scale')
})
