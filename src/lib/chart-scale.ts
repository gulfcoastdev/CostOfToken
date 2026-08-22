import { FLAT_PERCENT } from './format.ts'

/**
 * Vertical scaling shared by the trend chart and the per-model sparkline.
 *
 * Both previously scaled to the series' own min and max:
 *
 *     const range = max - min || max * 0.1 || 1
 *
 * That fallback only catches a *perfectly* flat series. Near-flat is the broken
 * case, and it is the common one: whatever the spread happened to be, the
 * lowest point pinned to the bottom of the box and the highest to the top. A
 * published card drew a 0.14% movement as a full-height climb while its own
 * badge read "Flat" and both its endpoint labels read the same dollar value.
 *
 * The fix is a floor on the range, expressed as a fraction of the series' own
 * level so it holds across a catalogue spanning $0.06 to $30 per million
 * tokens — an absolute floor in dollars would be wrong at one end or the other.
 */

/**
 * Relative movement at which a chart reaches full height.
 *
 * Deliberately far above `FLAT_PERCENT`: everything the badge is willing to
 * call flat must land in the bottom few percent of the box, so the line and the
 * badge cannot disagree. At 20%, a 0.5% movement occupies 2.5% of the height
 * and a halving saturates.
 */
export const FULL_SCALE_PERCENT = 20

/**
 * Map a series to y coordinates, oldest first, larger values higher on screen.
 *
 * `padding` insets the drawing area at both ends, matching the callers' own
 * geometry. Returns the vertical midline for a series with nothing to say.
 */
export function scaleSeries(series: number[], height: number, padding: number): number[] {
  const usable = height - padding * 2
  if (series.length === 0) return []

  const min = Math.min(...series)
  const max = Math.max(...series)

  // The level the movement is relative to. `min` rather than the mean, so a
  // single outlier cannot shrink everything else toward the midline.
  const level = min > 0 ? min : max
  const floor = (level * FULL_SCALE_PERCENT) / 100
  const range = Math.max(max - min, floor)

  // A genuinely flat series has no direction to show; centre it rather than
  // pinning it to an edge, and never divide by zero.
  if (range <= 0) return series.map(() => padding + usable / 2)

  const mid = (min + max) / 2
  return series.map((value) => {
    // Centre the series in the box, then displace by its share of the range.
    // Below full scale this leaves the line sitting in the middle, which is
    // what "barely moved" should look like.
    const offset = ((value - mid) / range) * usable
    const y = padding + usable / 2 - offset
    return clamp(y, padding, height - padding)
  })
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** Documented so the relationship is checkable, not just asserted in prose. */
export const CHART_SCALE_INVARIANT = FULL_SCALE_PERCENT > FLAT_PERCENT
