import type { NormalizedModel } from '@/lib/types.ts'
import { inferModality, inferTags, parsePricePerMillion } from '../normalize.ts'
import { cell, findColumn, findColumnExcluding } from './html-table.ts'
import { parseMarkdownTables } from './markdown-table.ts'
import type { Extractor } from './types.ts'

const PAGE_URL = 'https://docs.z.ai/guides/overview/pricing'
/** Markdown rendering: 3KB instead of 277KB, and prices unescaped by the reader. */
const SOURCE_URL = `${PAGE_URL}.md`

/**
 * Zhipu's international docs publish a flat USD table:
 *   Model | Input | Cached Input | Cached Input Storage | Output
 *
 * The z.ai (international) page is used rather than open.bigmodel.cn because
 * it quotes USD; the mainland page quotes CNY and would need an FX rate to be
 * comparable.
 */
export const zhipuExtractor: Extractor = {
  providerSlug: 'zhipu',
  sourceKind: 'scrape',
  sourceUrl: SOURCE_URL,

  async extract(ctx): Promise<NormalizedModel[]> {
    const markdown = await ctx.fetchText(SOURCE_URL)
    const tables = parseMarkdownTables(markdown)
    const models = new Map<string, NormalizedModel>()

    for (const table of tables) {
      const modelCol = findColumn(table.headers, /^\s*model\s*$/i)
      if (modelCol < 0) continue

      const inputCol = findColumnExcluding(table.headers, /input/i, /cach|storage/i)
      const cachedCol = findColumnExcluding(table.headers, /cached input/i, /storage/i)
      const outputCol = findColumnExcluding(table.headers, /output/i, /cach|storage/i)
      if (inputCol < 0 && outputCol < 0) continue

      const unitHint = table.headers.join(' ')

      for (const row of table.rows) {
        const displayName = cell(row, modelCol)
        if (!displayName) continue

        const modelId = displayName.toLowerCase().replace(/\s+/g, '-')
        // First table wins — see the note in openai.ts on tier tabs.
        if (models.has(modelId)) continue

        const input = parsePricePerMillion(cell(row, inputCol), unitHint)
        const output = parsePricePerMillion(cell(row, outputCol), unitHint)
        if (!input && !output) continue

        const cached = parsePricePerMillion(cell(row, cachedCol), unitHint)

        models.set(modelId, {
          providerSlug: 'zhipu',
          modelId,
          displayName,
          contextWindow: null,
          maxOutputTokens: null,
          longContextThreshold: null,
          description: null, // the pricing page carries no prose; enrichment fills it
          modality: inferModality(displayName),
          tags: inferTags(displayName),
          isActive: true,
          pricing: {
            inputPrice: input?.value ?? null,
            cachedInputPrice: cached?.value ?? null,
            outputPrice: output?.value ?? null,
            longInputPrice: null,
            longCachedInputPrice: null,
            longOutputPrice: null,
            currency: input?.currency ?? output?.currency ?? 'USD',
            sourceUrl: PAGE_URL,
            sourceKind: 'scrape',
            raw: { caption: table.caption, headers: table.headers, row },
          },
        })
      }
    }

    return [...models.values()]
  },
}
