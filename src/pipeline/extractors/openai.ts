import type { NormalizedModel } from '@/lib/types.ts'
import { inferModality, inferTags, parsePricePerMillion } from '../normalize.ts'
import {
  cell,
  findColumn,
  findColumnExcluding,
  isNonStandardTier,
  parseTables,
  type HtmlTable,
} from './html-table.ts'
import type { Extractor } from './types.ts'

const SOURCE_URL = 'https://platform.openai.com/docs/pricing'

/**
 * OpenAI publishes a two-row header grouping four sub-columns under "Short
 * context" and "Long context". After colspan expansion those become headers
 * like "Short context Input" / "Long context Output", which map directly onto
 * our standard and long-context tiers.
 *
 * "Cache writes" has no column in our schema — it's kept in raw_data.
 */
export const openaiExtractor: Extractor = {
  providerSlug: 'openai',
  sourceKind: 'scrape',
  sourceUrl: SOURCE_URL,

  async extract(ctx): Promise<NormalizedModel[]> {
    const html = await ctx.fetchText(SOURCE_URL)
    const tables = parseTables(html)
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
        const modelId = cell(row, modelCol)
        if (!modelId || looksLikeSectionRow(modelId)) continue

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
          longContextThreshold: lInput || lOutput ? 128_000 : null,
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
            sourceUrl: SOURCE_URL,
            sourceKind: 'scrape',
            raw: { caption: table.caption, headers: table.headers, row },
          },
        })
      }
    }

    return [...models.values()]
  },
}

function isTokenPricingTable(table: HtmlTable): boolean {
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
