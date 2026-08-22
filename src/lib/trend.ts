import type { ModelType } from './types.ts'

/**
 * The blended price trend, computed so that it cannot report a direction the
 * data does not support.
 *
 * The incident this exists to prevent: the front page told readers prices were
 * rising 0.14% while the median catalogue price was unchanged (0.680 then,
 * 0.680 now) and movers split 10 down against 8 up. Three separate properties
 * of the old computation combined to produce that claim.
 *
 *  1. It was an unweighted arithmetic **mean** over every matched model. The
 *     distribution is strongly right-skewed — median 0.68 against mean 3.96 —
 *     so the mean never described the typical model even with clean data, and
 *     two models landing on a corrupted doubled value were enough to set its
 *     direction.
 *  2. It **mixed units**. An image-generation model, priced per image, was the
 *     single largest contributor to the reported rise, inside a card a reader
 *     takes as the price of tokens.
 *  3. Its **membership varied per sample point**, so a model joining or leaving
 *     the catalogue was indistinguishable from a price movement.
 *
 * Extracted out of the component so it can be tested at all, which the
 * constitution requires of logic that matters.
 */

/**
 * Model types whose price is quoted per token, and so belong in a token-price
 * trend.
 *
 * An allowlist rather than a blocklist: a model type we have not considered is
 * excluded until someone decides it belongs, which is the safe direction. An
 * unclassified model (`null`) is excluded for the same reason — "we do not know
 * what this is priced in" is not a licence to assume tokens.
 */
const TOKEN_PRICED_TYPES: readonly ModelType[] = ['general', 'ocr', 'realtime', 'moderation']

/**
 * Below this many models a median says more about the sample than the market.
 *
 * Reporting nothing is the honest answer at that size, and the card says so.
 */
export const TREND_MIN_BASKET = 5

export interface TrendInput {
  modelType: ModelType | string | null | undefined
  series: number[] | null | undefined
}

export type TrendResult =
  | { kind: 'series'; series: number[]; pct: number; basketSize: number }
  | { kind: 'insufficient'; basketSize: number }

/**
 * The median input price at each sample point, over a basket held constant
 * across every point.
 *
 * Returns `insufficient` rather than a figure when the basket cannot support
 * one. That is a distinct state from "nothing moved", because a reader must be
 * able to tell "prices are flat" from "we cannot tell you".
 */
export function computeTrend(rows: readonly TrendInput[]): TrendResult {
  const eligible = rows.filter(
    (row): row is TrendInput & { series: number[] } =>
      isTokenPriced(row.modelType) && isUsableSeries(row.series),
  )

  // A fixed basket means every member must be priced at every sample point.
  // Series of differing length describe different windows, so the longest
  // common window is the only one every member can honestly be compared over.
  const points = modalLength(eligible.map((row) => row.series.length))
  const basket = eligible.filter((row) => row.series.length === points)

  if (points < 2 || basket.length < TREND_MIN_BASKET) {
    return { kind: 'insufficient', basketSize: basket.length }
  }

  const series = Array.from({ length: points }, (_, index) =>
    median(basket.map((row) => row.series[index])),
  )

  const first = series[0]
  const last = series[series.length - 1]
  const pct = first > 0 ? ((last - first) / first) * 100 : 0

  return { kind: 'series', series, pct, basketSize: basket.length }
}

function isTokenPriced(type: TrendInput['modelType']): boolean {
  return typeof type === 'string' && (TOKEN_PRICED_TYPES as readonly string[]).includes(type)
}

/**
 * A series is usable only if every point is a real, positive observation.
 *
 * `0` is a genuinely free price elsewhere in this codebase, but a zero here
 * would make the percentage change undefined and is far more likely to be a
 * gap than a giveaway, so it is left out of the basket rather than reasoned
 * about.
 */
function isUsableSeries(series: TrendInput['series']): series is number[] {
  return (
    Array.isArray(series) &&
    series.length >= 2 &&
    series.every((value) => Number.isFinite(value) && value > 0)
  )
}

/** The most common series length — the window the most models share. */
function modalLength(lengths: number[]): number {
  const counts = new Map<number, number>()
  for (const length of lengths) counts.set(length, (counts.get(length) ?? 0) + 1)

  let best = 0
  let bestCount = 0
  for (const [length, count] of counts) {
    // Ties break toward the longer window, so the result cannot depend on the
    // order rows happened to arrive in.
    if (count > bestCount || (count === bestCount && length > best)) {
      best = length
      bestCount = count
    }
  }
  return best
}

/** Middle value, averaging the two middles on an even count. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}
