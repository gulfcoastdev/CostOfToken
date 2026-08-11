import type { NormalizedModel } from '@/lib/types.ts'
import { inferModality, inferTags, parsePricePerMillion, parseTokenCount } from '../normalize.ts'
import {
  cell,
  findColumn,
  findColumnExcluding,
  isNonStandardTier,
  type SourceTable,
} from './html-table.ts'
import { parseMarkdownTables } from './markdown-table.ts'
import type { Extractor } from './types.ts'

const PAGE_URL = 'https://platform.openai.com/docs/pricing'
/**
 * OpenAI documents that any docs page is available as markdown by appending
 * `.md`. That rendering is the better source by a wide margin — see the note
 * on the extractor below.
 */
const SOURCE_URL = `${PAGE_URL}.md`

/**
 * Reads the markdown rendering of OpenAI's pricing page rather than the HTML.
 *
 * The HTML renders Standard / Batch / Flex / Fast as tabs. Tab labels are not
 * headings, so a tier carries no structure a parser can see, and only the
 * selected tab's rows are in the document. That cost us twice: the tiers were
 * indistinguishable (the last one parsed silently overwrote standard pricing
 * with Priority, at 2x the real rate), and the page exposed 13 models where
 * the catalogue actually has 34.
 *
 * The markdown has "### Standard pricing data" / "### Batch pricing data" as
 * real headings and lists every row, so both problems disappear. It is also
 * ~26x smaller.
 *
 * "Cache writes" has no column in our schema — it's kept in raw_data.
 */
export const openaiExtractor: Extractor = {
  providerSlug: 'openai',
  sourceKind: 'scrape',
  sourceUrl: SOURCE_URL,

  async extract(ctx): Promise<NormalizedModel[]> {
    const markdown = await ctx.fetchText(SOURCE_URL)
    const tables = parseMarkdownTables(markdown)
    const models = new Map<string, NormalizedModel>()

    for (const table of tables) {
      // Only standard-tier, token-priced text tables. Batch/Flex/Priority are
      // not comparable to other vendors' standard rates; image- and
      // per-minute-priced tables use different units entirely.
      if (isNonStandardTier(table)) continue
      if (!isTokenPricingTable(table)) continue

      const modelCol = findColumn(table.headers, /^\s*model\s*$/i)
      if (modelCol < 0) continue

      const shortInput = findColumnExcluding(
        table.headers,
        /short context.*input|^input$/i,
        /cach/i,
      )
      const shortCached = findColumn(table.headers, /short context.*cached input|^cached input$/i)
      const shortOutput = findColumn(table.headers, /short context.*output|^output$/i)
      const longInput = findColumnExcluding(table.headers, /long context.*input/i, /cach/i)
      const longCached = findColumn(table.headers, /long context.*cached input/i)
      const longOutput = findColumn(table.headers, /long context.*output/i)

      if (shortInput < 0 && shortOutput < 0) continue

      const unitHint = table.headers.join(' ')

      for (const row of table.rows) {
        const rawModel = cell(row, modelCol)
        if (!rawModel || looksLikeSectionRow(rawModel)) continue

        // Rows read "gpt-5.5 (<272K context length)". The qualifier belongs in
        // the long-context threshold, not in the id or the display name, where
        // it would leak into headings, tables and page titles.
        const { modelId, threshold } = splitModelQualifier(rawModel)
        if (!modelId) continue

        // Vendors repeat the same models across pricing tiers. Where the tier
        // is a tab rather than a heading, the breadcrumb can't distinguish
        // them, so the first table wins: it is the default (standard) tier.
        // Without this the last tier parsed silently overwrites the standard
        // rate — OpenAI's Priority table is 2x standard.
        if (models.has(modelId)) continue

        const input = parsePricePerMillion(cell(row, shortInput), unitHint)
        const output = parsePricePerMillion(cell(row, shortOutput), unitHint)
        if (!input && !output) continue

        const cached = parsePricePerMillion(cell(row, shortCached), unitHint)
        const lInput = parsePricePerMillion(cell(row, longInput), unitHint)
        const lCached = parsePricePerMillion(cell(row, longCached), unitHint)
        const lOutput = parsePricePerMillion(cell(row, longOutput), unitHint)

        models.set(modelId, {
          providerSlug: 'openai',
          modelId,
          displayName: modelId,
          contextWindow: null, // not published on the pricing page; supplied by the catalog
          maxOutputTokens: null,
          longContextThreshold: threshold ?? (lInput || lOutput ? 128_000 : null),
          modality: inferModality(modelId, table.caption),
          tags: inferTags(modelId, table.caption),
          isActive: true,
          pricing: {
            inputPrice: input?.value ?? null,
            cachedInputPrice: cached?.value ?? null,
            outputPrice: output?.value ?? null,
            longInputPrice: lInput?.value ?? null,
            longCachedInputPrice: lCached?.value ?? null,
            longOutputPrice: lOutput?.value ?? null,
            currency: input?.currency ?? output?.currency ?? 'USD',
            sourceUrl: PAGE_URL,
            sourceKind: 'scrape',
            raw: { caption: table.caption, headers: table.headers, row, page: PAGE_URL },
          },
        })
      }
    }

    return [...models.values()]
  },
}


/**
 * Separate a model id from its parenthetical qualifier.
 *
 * OpenAI's table labels rows like "gpt-5.5 (<272K context length)". Keeping the
 * qualifier in the id would fork the model the moment the wording changed, but
 * the number in it is the long-context threshold, which the pricing page states
 * nowhere else.
 */
export function splitModelQualifier(raw: string): { modelId: string; threshold: number | null } {
  const match = raw.match(/^\s*([^\s(]+)\s*(?:\((.*)\))?\s*$/)
  if (!match) return { modelId: raw.trim(), threshold: null }

  const modelId = match[1]
  const qualifier = match[2]
  if (!qualifier) return { modelId, threshold: null }

  const contextMatch = qualifier.match(/<\s*([\d.,]+\s*[km]?)\s*context/i)
  return { modelId, threshold: contextMatch ? parseTokenCount(contextMatch[1]) : null }
}

function isTokenPricingTable(table: SourceTable): boolean {
  const headerText = table.headers.join(' ').toLowerCase()
  if (/per (image|minute|second|character)|\/ ?(image|min|sec)\b/.test(headerText)) return false
  return /input|output/.test(headerText)
}

/**
 * Multi-modal tables label rows by modality rather than by model — a row whose
 * first cell is just "Text" or "Image" is a section of the model named in the
 * heading, not a model called "Text".
 */
const SECTION_LABELS =
  /^(text|audio|image|video|speech|transcription|fine[- ]tuning|batch|input|output)(\s+tokens?)?$/i

function looksLikeSectionRow(modelId: string): boolean {
  return SECTION_LABELS.test(modelId.trim())
}
