/** Formatting shared by the server page and the client explorer. */

/**
 * Percentage movement below which a price trend is reported as flat.
 *
 * One definition, three consumers: the badge that says "Flat", the chart that
 * draws the line, and the trend statistic itself. They previously disagreed —
 * the badge read "Flat" and both endpoint labels read the same dollar value
 * while the line drawn between them climbed the full height of the card,
 * because the chart scaled to the series' own range with no floor. A movement
 * of 0.14% filled the box.
 *
 * Keeping the number here is what makes that contradiction impossible rather
 * than merely unlikely (Principle V: one formula per concept).
 */
export const FLAT_PERCENT = 0.5

/** Whether a percentage movement is too small to report as a direction. */
export function isFlat(pct: number): boolean {
  return Math.abs(pct) < FLAT_PERCENT
}

/**
 * Money, matching the convention used across the app and API:
 * `null` has no such tier, `0` is genuinely free.
 */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value === 0) return 'Free'
  return `$${value.toFixed(value < 1 ? 3 : 2)}`
}

/** Token counts as 128K / 1M, which is how vendors quote context windows. */
export function formatContext(tokens: number | null | undefined): string {
  if (!tokens) return '—'
  if (tokens >= 1_000_000) {
    // Round first, then drop a trailing ".0": 1,048,576 and 1,000,000 are the
    // same context window as far as a reader is concerned, so both read "1M".
    const millions = Math.round((tokens / 1_000_000) * 10) / 10
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  return `${Math.round(tokens / 1_000)}K`
}

export function formatCompact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`
  return value.toFixed(0)
}

export function formatCost(value: number): string {
  if (value >= 1000) return `$${formatCompact(value)}`
  if (value === 0) return '$0.00'
  return `$${value.toFixed(2)}`
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const elapsed = Date.now() - new Date(iso).getTime()
  const hours = Math.max(1, Math.round(elapsed / 3_600_000))
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/**
 * The single blended metric used for both the "Blended" column and value
 * ranking.
 *
 * Deliberately one formula, not two: the design prototype displayed
 * `(input + output) / 2` while ranking by `input + 2 × output`, which made the
 * table look mis-sorted — a row could show a lower blended price yet rank
 * below one showing a higher price. A plain mean is a rough proxy for real
 * spend (which depends on your input:output ratio), so it is labelled as such
 * in the UI rather than presented as a true cost.
 */
export function blendedPrice(
  input: number | null | undefined,
  output: number | null | undefined,
): number | null {
  if (input === null || input === undefined) return null
  if (output === null || output === undefined) return null
  return (input + output) / 2
}
