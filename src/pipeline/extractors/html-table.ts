import * as cheerio from 'cheerio'
import { cleanText } from '../normalize.ts'

/**
 * A generic reader for HTML pricing tables.
 *
 * Providers lay pricing out in incompatible ways, so this normalises the two
 * structural quirks that actually matter:
 *
 *  1. Multi-row headers with colspans. OpenAI groups columns under "Short
 *     context" / "Long context" spanning four sub-columns each. Header rows are
 *     expanded across their colspan and joined top-to-bottom, so that table
 *     yields flat headers like "Short context Input" and "Long context Output".
 *  2. Transposed tables. Google publishes one table per model with the price
 *     labels down the first column, so `caption` (the nearest preceding
 *     heading) carries the model name.
 *
 * Extractors then locate columns by regex against header text rather than by
 * index, so a provider inserting a column doesn't shift everything by one.
 */

/** A parsed table, produced by either the HTML or the markdown reader. */
export interface SourceTable {
  /** Nearest enclosing heading, or <caption>. */
  caption: string
  /**
   * Heading breadcrumb for the table, nearest first — e.g.
   * ["Standard", "Gemini 3 Pro", "Models"].
   *
   * Essential where the nearest heading is a pricing *tier* rather than the
   * model: Google nests four tier tables ("Standard", "Batch", "Flex",
   * "Priority") under each model's heading, so the model name is one or more
   * levels further up.
   */
  captionPath: string[]
  /**
   * Bare text lines standing immediately above the table, nearest first — the
   * rendered tab labels, e.g. ["Standard", "Prices per 1M tokens."].
   *
   * Deliberately separate from `captionPath` rather than folded into it.
   * `captionPath` is a *heading* breadcrumb and is read positionally: Google
   * recovers a model name from an ancestor heading, so mixing loose text into
   * it would shift those indices and break that extractor silently.
   *
   * Load-bearing because a tier is often stated nowhere else. OpenAI renders
   * Standard/Batch/Flex/Fast as tabs; the markdown emits the tab label as a
   * loose line and then a generic heading, so ten of its sixteen tables are
   * captioned "Grouped Pricing Table data" and four of those are non-standard
   * tiers. Reading headings alone admitted batch, fast-mode and fine-tuning
   * rates as standard per-token prices.
   */
  labels: string[]
  /** Flattened header labels, one per column, colspans expanded. */
  headers: string[]
  rows: string[][]
}

type AnyCheerio = cheerio.Cheerio<never>

export function parseTables(html: string): SourceTable[] {
  const $ = cheerio.load(html)
  const tables: SourceTable[] = []

  // Walk headings and tables in document order, maintaining a heading stack,
  // so each table gets the full h1..h6 breadcrumb enclosing it.
  const stack: Array<{ level: number; text: string }> = []

  for (const node of $('h1, h2, h3, h4, h5, h6, table').toArray()) {
    const tag = node.tagName?.toLowerCase()
    if (!tag) continue

    if (tag === 'table') {
      const $table = $(node) as unknown as AnyCheerio
      const parsed = parseOneTable($, $table, [...stack].reverse().map((s) => s.text))
      if (parsed) tables.push(parsed)
      continue
    }

    const level = Number.parseInt(tag.slice(1), 10)
    if (!Number.isFinite(level)) continue
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
    stack.push({ level, text: cleanText($(node).text()) })
  }

  return tables
}

function parseOneTable(
  $: cheerio.CheerioAPI,
  $table: AnyCheerio,
  headingPath: string[],
): SourceTable | null {
  const allRows: Array<{ cells: string[]; allHeaderCells: boolean; inThead: boolean }> = []

  $table.find('tr').each((_i, tr) => {
    const $tr = $(tr)
    const cells: string[] = []
    let cellCount = 0
    let headerCellCount = 0

    $tr.find('th, td').each((_j, cellEl) => {
      const $cell = $(cellEl)
      const text = cellText($, $cell as unknown as AnyCheerio)
      const colspan = Math.min(Number.parseInt($cell.attr('colspan') ?? '1', 10) || 1, 32)
      for (let k = 0; k < colspan; k++) cells.push(text)
      cellCount++
      if (cellEl.tagName?.toLowerCase() === 'th') headerCellCount++
    })

    if (cells.length === 0) return

    allRows.push({
      cells,
      allHeaderCells: cellCount > 0 && headerCellCount === cellCount,
      inThead: $tr.closest('thead').length > 0,
    })
  })

  if (allRows.length === 0) return null

  // Leading rows that are entirely <th> (or live in <thead>) form the header
  // stack. Always take at least one row so a <td>-only table still parses.
  let headerRowCount = 0
  while (
    headerRowCount < allRows.length &&
    (allRows[headerRowCount].inThead || allRows[headerRowCount].allHeaderCells)
  ) {
    headerRowCount++
  }
  if (headerRowCount === 0) headerRowCount = 1

  const headerRows = allRows.slice(0, headerRowCount)
  const bodyRows = allRows.slice(headerRowCount).map((r) => r.cells)

  const width = Math.max(...allRows.map((r) => r.cells.length))
  const headers: string[] = []
  for (let col = 0; col < width; col++) {
    const parts: string[] = []
    for (const row of headerRows) {
      const text = row.cells[col]
      // Skip blanks and repeats — a group label spanning 4 columns shouldn't
      // produce "Short context Short context Input".
      if (text && !parts.includes(text)) parts.push(text)
    }
    headers.push(parts.join(' ').trim())
  }

  const rows = bodyRows.filter((cells) => cells.some((c) => c.length > 0))
  if (rows.length === 0 || headers.every((h) => !h)) return null

  const explicitCaption = cleanText($table.find('caption').first().text())
  const captionPath = explicitCaption ? [explicitCaption, ...headingPath] : headingPath

  // The HTML reader has no loose-text equivalent: where a tier is a tab, the
  // unselected tabs are not in the document at all. Markdown supplies labels.
  return { caption: captionPath[0] ?? '', captionPath, labels: [], headers, rows }
}

/** First breadcrumb entry matching `pattern`, searching nearest-first. */
export function findInPath(table: SourceTable, pattern: RegExp): string | null {
  return table.captionPath.find((entry) => pattern.test(entry)) ?? null
}

/**
 * Pricing tiers that are not comparable to a vendor's standard rate.
 *
 * Batch is typically 50% off and asynchronous; Flex/Priority trade latency for
 * price. Mixing one vendor's batch rate into a table of another's standard
 * rate would make the comparison wrong, so these tables are skipped entirely.
 * Tracking them as separate tiers is a later milestone.
 */
export const NON_STANDARD_TIER =
  /\b(batch|flex|priority|provisioned|scale tier|fast (mode|pricing)|fine[- ]?tun\w*)\b/i

export function isNonStandardTier(table: SourceTable): boolean {
  return evidence(table).some((entry) => NON_STANDARD_TIER.test(entry))
}

/** The vendor's own word for its list price, as opposed to a discounted tier. */
const STANDARD_TIER = /\b(standard|on[- ]demand|pay[- ]as[- ]you[- ]go|list price)\b/i

/**
 * Every string that may carry tier or unit evidence for a table, nearest first.
 *
 * Headings and tab labels are both statements by the vendor about what the
 * table contains, so both count. Prices are deliberately *not* consulted:
 * inferring a tier from the numbers would let a genuine 50% price cut be
 * reclassified as a batch table, which is the inversion this whole feature
 * exists to prevent.
 */
function evidence(table: SourceTable): string[] {
  return [...table.labels, ...table.captionPath]
}

export type PricingTier = 'standard' | 'non_standard' | 'unknown'

/**
 * Which commercial tier a table's prices belong to.
 *
 * Only `standard` may be catalogued. `unknown` is a rejection, not a default —
 * assuming standard in the absence of evidence is exactly how batch and
 * fast-mode rates entered the catalogue as headline prices, and how one model
 * came to record three different prices inside thirty minutes.
 *
 * `soleTable` is the one escape hatch: a provider whose document contains no
 * tier vocabulary anywhere has only ever published one price, and rejecting it
 * would take that provider out of the catalogue entirely — trading one
 * truthfulness failure for another. It MUST be decided from the whole document,
 * never from a table's position in it, or it reintroduces order-dependence.
 */
export function classifyTier(
  table: SourceTable,
  options: { soleTable?: boolean } = {},
): PricingTier {
  const found = evidence(table)
  if (found.some((entry) => NON_STANDARD_TIER.test(entry))) return 'non_standard'
  if (found.some((entry) => STANDARD_TIER.test(entry))) return 'standard'
  return options.soleTable ? 'standard' : 'unknown'
}

/**
 * True when a document states no pricing tier anywhere, so its tables cannot be
 * distinguished by tier and there is nothing to confuse.
 */
export function hasNoTierVocabulary(tables: SourceTable[]): boolean {
  return !tables.some((table) =>
    evidence(table).some((entry) => NON_STANDARD_TIER.test(entry) || STANDARD_TIER.test(entry)),
  )
}

export type PricingUnit = 'per_token' | 'per_image' | 'per_second' | 'per_character' | 'per_hour' | 'per_request' | 'unknown'

/** Units a vendor quotes that are not price-per-token, longest match first. */
const UNIT_PATTERNS: Array<[RegExp, PricingUnit]> = [
  [/per (image|generated image)\b|\/ ?image\b/i, 'per_image'],
  [/per (second|minute)\b|\/ ?(sec|min)\b/i, 'per_second'],
  [/per character\b|\/ ?char\b/i, 'per_character'],
  [/per hour\b|\/ ?hour\b|\/ ?hr\b/i, 'per_hour'],
  [/per (request|call)\b/i, 'per_request'],
  [/per (1m |1,000,000 |million )?tokens?\b|\/ ?mtok\b|per 1k tokens\b/i, 'per_token'],
]

/**
 * What a table's prices are charged against.
 *
 * Column headers win over the surrounding prose, because a section introduced
 * as "Prices per 1M tokens unless noted" then goes on to note otherwise. Only
 * `per_token` may be catalogued: a per-image or fine-tuning-per-hour rate sat
 * in the catalogue as though it were a token price, and fed a token-price
 * trend on the front page.
 */
export function classifyUnit(table: SourceTable): PricingUnit {
  for (const source of [table.headers.join(' '), ...evidence(table)]) {
    for (const [pattern, unit] of UNIT_PATTERNS) {
      if (pattern.test(source)) return unit
    }
  }
  return 'unknown'
}

/**
 * Read a cell's text with element boundaries preserved as whitespace.
 *
 * Cheerio's `.text()` concatenates descendants with no separator, so markup
 * like `Claude Sonnet 5<span>(through August 31, 2026)</span>` collapses to
 * "Claude Sonnet 5(through August 31, 2026)" — gluing two words together and
 * breaking any word-boundary matching downstream. Inserting spaces around
 * every child element keeps tokens separate; cleanText collapses the excess.
 */
function cellText($: cheerio.CheerioAPI, $cell: AnyCheerio): string {
  const $clone = $cell.clone() as unknown as AnyCheerio
  $clone.find('br').replaceWith(' ')
  $clone.find('*').each((_i, child) => {
    $(child).before(' ').after(' ')
  })
  return cleanText($clone.text())
}

/** Index of the first header matching `pattern`, or -1. */
export function findColumn(headers: string[], pattern: RegExp): number {
  return headers.findIndex((header) => pattern.test(header))
}

/**
 * Index of the first header matching `pattern` but NOT `exclude`.
 * Needed to separate "Input" from "Cached input" — the former matches both.
 */
export function findColumnExcluding(headers: string[], pattern: RegExp, exclude: RegExp): number {
  return headers.findIndex((header) => pattern.test(header) && !exclude.test(header))
}

export function cell(row: string[], index: number): string | null {
  if (index < 0 || index >= row.length) return null
  return row[index] || null
}
