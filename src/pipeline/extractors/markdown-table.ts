import type { SourceTable } from './html-table.ts'

/**
 * Parse pipe tables out of a markdown document.
 *
 * Several vendors serve a markdown rendering of their docs by appending `.md`
 * to the page URL (or sending `Accept: text/markdown`). Where that exists it
 * is strictly better than scraping the HTML:
 *
 *   - Tier labels become real headings. OpenAI's HTML renders Standard, Batch,
 *     Flex and Fast as *tabs*, which carry no structure at all — the markdown
 *     has "### Standard pricing data", so the tier is unambiguous.
 *   - Tabs are only rendered when selected, so the HTML exposes a fraction of
 *     the rows. OpenAI's markdown lists 34 models where the HTML gave 13.
 *   - It is 10-80x smaller and far less prone to breaking on a redesign.
 *
 * Output deliberately matches the HTML parser's `SourceTable`, so extractors
 * locate columns the same way regardless of which format they read.
 */
export function parseMarkdownTables(markdown: string): SourceTable[] {
  const lines = markdown.split(/\r?\n/)
  const tables: SourceTable[] = []
  const headingStack: Array<{ level: number; text: string }> = []

  // Loose text seen since the last table or heading, oldest first. A vendor
  // that renders its pricing tiers as tabs emits the tab label here and then a
  // generic heading, so this is frequently the only statement of the tier.
  let looseText: string[] = []
  // Loose text that preceded the current heading — the label belongs to the
  // heading, and so to every table under it until the next heading.
  let headingText: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop()
      }
      headingStack.push({ level, text: cleanCell(heading[2]) })
      headingText = looseText
      looseText = []
      continue
    }

    if (!isTableRow(line)) {
      const label = asLabel(line)
      if (label) looseText.push(label)
      continue
    }

    // A pipe table is a header row, a separator row, then body rows.
    const separator = lines[i + 1]
    if (!separator || !isSeparatorRow(separator)) continue

    const headers = splitRow(line)
    const rows: string[][] = []

    let cursor = i + 2
    while (cursor < lines.length && isTableRow(lines[cursor])) {
      const cells = splitRow(lines[cursor])
      if (cells.some((c) => c.length > 0)) rows.push(cells)
      cursor++
    }

    if (rows.length > 0) {
      const captionPath = [...headingStack].reverse().map((h) => h.text)
      // Nearest first: text between the heading and this table outranks text
      // that introduced the heading itself.
      const labels = [...looseText, ...headingText].reverse().slice(0, MAX_LABELS)
      tables.push({ caption: captionPath[0] ?? '', captionPath, labels, headers, rows })
    }

    looseText = []
    i = cursor - 1
  }

  return tables
}

/**
 * A tab label is a short noun phrase — "Standard", "Fast mode", "Prices per 1M
 * tokens." A sentence is prose and means nothing about the table.
 *
 * The distinction matters because the same data-residency paragraph repeats
 * above several tables in OpenAI's document; without a length bound it would
 * become tier evidence for all of them.
 */
const MAX_LABEL_LENGTH = 48
const MAX_LABELS = 6

function asLabel(line: string): string | null {
  const text = cleanCell(line)
  if (!text) return null
  // Blockquotes and list items are body copy, never tab labels.
  if (/^[>*+-]\s/.test(line.trimStart())) return null
  if (text.length > MAX_LABEL_LENGTH) return null
  return text
}

function isTableRow(line: string | undefined): boolean {
  if (!line) return false
  return line.trimStart().startsWith('|')
}

/** `| --- | :---: |` — the row that makes a pipe table a table. */
function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return false
  return /^\|?[\s|:-]+\|[\s|:-]*$/.test(trimmed) && trimmed.includes('-')
}

/**
 * Split a row on unescaped pipes.
 *
 * Pipes inside inline code or escaped as `\|` are cell content, not
 * delimiters, so a naive split would shift every column after them.
 */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let escaped = false
  let inCode = false

  for (const char of trimmed) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '`') {
      inCode = !inCode
      current += char
      continue
    }
    if (char === '|' && !inCode) {
      cells.push(cleanCell(current))
      current = ''
      continue
    }
    current += char
  }
  cells.push(cleanCell(current))

  return cells
}

/**
 * Reduce a markdown cell to its text.
 *
 * Vendors escape dollar signs (`\$1.4` on Zhipu) and wrap qualifiers in links
 * (`Claude Mythos 5 ([limited availability](...))` on Anthropic). Both would
 * otherwise leak into model ids and prices.
 */
export function cleanCell(input: string): string {
  return input
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> label
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\\([$*_[\]()|~`])/g, '$1') // unescape \$ \| \* etc.
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
