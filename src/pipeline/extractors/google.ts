import type { NormalizedModel } from '@/lib/types.ts'
import {
  cleanText,
  inferModality,
  inferTags,
  parseMoney,
  parseTokenCount,
  toPerMillionTokens,
} from '../normalize.ts'
import { cell, findColumn, findInPath, isNonStandardTier, parseTables } from './html-table.ts'
import type { Extractor } from './types.ts'

const SOURCE_URL = 'https://ai.google.dev/gemini-api/docs/pricing'

/**
 * Google's pricing page is transposed: one small table per model, with price
 * labels down the first column and a "Free Tier" / "Paid Tier" column pair.
 * The model name lives in the heading above the table, not in the table.
 *
 * Long-context pricing is expressed inside a single cell, e.g.
 *   "$1.25 (prompts <= 200k tokens) $2.50 (prompts > 200k tokens)"
 * so the paid cell is split into a standard and a long-context tier.
 */
export const googleExtractor: Extractor = {
  providerSlug: 'google',
  sourceKind: 'scrape',
  sourceUrl: SOURCE_URL,

  async extract(ctx): Promise<NormalizedModel[]> {
    const html = await ctx.fetchText(SOURCE_URL)
    const tables = parseTables(html)
    const models = new Map<string, NormalizedModel>()

    for (const table of tables) {
      const paidCol = findColumn(table.headers, /paid tier/i)
      if (paidCol < 0) continue

      // Each model heading contains four tier tables — Standard, Batch, Flex,
      // Priority. Only Standard is comparable across vendors.
      if (isNonStandardTier(table)) continue

      // The nearest heading is the tier name, so the model name comes from
      // further up the breadcrumb.
      const displayName = findInPath(table, /\b(gemini|gemma|imagen|veo)\b/i)
      if (!displayName) continue

      const labelCol = 0
      const unitHint = table.headers[paidCol] // "Paid Tier, per 1M tokens in USD"

      const rowFor = (pattern: RegExp): string | null => {
        const row = table.rows.find((r) => pattern.test(cell(r, labelCol) ?? ''))
        return row ? cell(row, paidCol) : null
      }

      // Prefer the plain text/image/video input row over the audio variant,
      // which is priced separately and is not comparable across providers.
      const inputRow =
        table.rows.find(
          (r) => /input price/i.test(cell(r, labelCol) ?? '') && !/audio/i.test(cell(r, labelCol) ?? ''),
        ) ?? table.rows.find((r) => /input price/i.test(cell(r, labelCol) ?? ''))

      const input = inputRow ? parseTieredCell(cell(inputRow, paidCol), unitHint) : null
      const output = parseTieredCell(rowFor(/output price/i), unitHint)
      if (!input?.standard && !output?.standard) continue

      // "Context caching" is the cache-read price; "storage" rows are per-hour
      // and priced on a different basis, so they're excluded.
      const cachedRow = table.rows.find(
        (r) =>
          /context caching|cached input/i.test(cell(r, labelCol) ?? '') &&
          !/storage/i.test(cell(r, labelCol) ?? ''),
      )
      const cached = cachedRow ? parseTieredCell(cell(cachedRow, paidCol), unitHint) : null

      const modelId = toModelId(displayName)
      // First table wins — see the note in openai.ts on tier tabs.
      if (models.has(modelId)) continue
      const threshold = input?.threshold ?? output?.threshold ?? null

      models.set(modelId, {
        providerSlug: 'google',
        modelId,
        displayName,
        contextWindow: null, // published on the models page, not pricing; catalog supplies it
        maxOutputTokens: null,
        longContextThreshold: threshold,
        modality: inferModality(displayName, table.rows.map((r) => r[labelCol]).join(' ')),
        tags: inferTags(displayName),
        isActive: true,
        pricing: {
          inputPrice: input?.standard ?? null,
          cachedInputPrice: cached?.standard ?? null,
          outputPrice: output?.standard ?? null,
          longInputPrice: input?.long ?? null,
          longCachedInputPrice: cached?.long ?? null,
          longOutputPrice: output?.long ?? null,
          currency: 'USD',
          sourceUrl: SOURCE_URL,
          sourceKind: 'scrape',
          raw: { caption: table.caption, headers: table.headers, rows: table.rows },
        },
      })
    }

    return [...models.values()]
  },
}

interface TieredPrice {
  standard: number | null
  long: number | null
  threshold: number | null
}

/**
 * Split a cell that may carry both a standard and a long-context price.
 *
 * "Free of charge" yields 0; "Not available" yields null. Both appear in the
 * paid column for models that are free-tier-only or unavailable there.
 */
export function parseTieredCell(
  text: string | null | undefined,
  unitHint?: string | null,
): TieredPrice | null {
  const empty: TieredPrice = { standard: null, long: null, threshold: null }
  if (!text) return null

  const cleaned = cleanText(text)
  if (/not available|^n\/?a$/i.test(cleaned)) return empty
  if (/free of charge/i.test(cleaned) && !/\d/.test(cleaned.replace(/\d+\s*[km]?\s*tokens?/gi, ''))) {
    return { standard: 0, long: null, threshold: null }
  }

  const amounts = [...cleaned.matchAll(/[$¥€£]\s*\d[\d,]*(?:\.\d+)?/g)].map((m) => {
    const money = parseMoney(m[0])
    return money ? toPerMillionTokens(money.value, unitHint) : null
  })
  const values = amounts.filter((v): v is number => v !== null)
  if (values.length === 0) return empty

  // A threshold marker ("<= 200k tokens" / "> 200k tokens") means the second
  // amount is the long-context price rather than an unrelated figure.
  const thresholdMatch = cleaned.match(/(?:<=|≤|>|longer than|above)\s*(\d[\d,]*\s*[km]?)\s*tokens?/i)
  const threshold = thresholdMatch ? parseTokenCount(thresholdMatch[1]) : null

  if (values.length >= 2 && threshold) {
    return { standard: values[0], long: values[1], threshold }
  }
  return { standard: values[0], long: null, threshold: null }
}

function toModelId(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
