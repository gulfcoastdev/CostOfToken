import type { NormalizedModel } from '@/lib/types.ts'
import { inferModality, inferTags, parsePricePerMillion } from '../normalize.ts'
import { cell, findColumn, parseTables } from './html-table.ts'
import type { Extractor } from './types.ts'

const PAGE_URL = 'https://www.together.ai/pricing'

/**
 * Together AI (011 C2): server-rendered pricing tables.
 *
 * Only tables headed Model/Input/Output carry per-token chat rates; the
 * page's other tables price per-megapixel, per-image, per-minute or a
 * single blended figure, none of which belongs in a per-1M-token catalogue.
 *
 * Two quirks:
 *  - the input cell can carry two figures — "$0.30 $0.06 (cached)" — the
 *    second being the cached-input rate;
 *  - rows are display names, not API ids. The offer id is the slugified
 *    name, which the resolver then matches against other sellers where the
 *    slug lines up ("MiniMax M3" → minimax-m3) and flags where it doesn't —
 *    an honest partial link beats an invented id.
 */
export const togetherExtractor: Extractor = {
  providerSlug: 'together',
  sourceKind: 'scrape',
  sourceUrl: PAGE_URL,

  async extract(ctx): Promise<NormalizedModel[]> {
    const html = await ctx.fetchText(PAGE_URL)
    const tables = parseTables(html)
    const models = new Map<string, NormalizedModel>()

    for (const table of tables) {
      const headerText = table.headers.join(' ').toLowerCase()
      if (/per (mp|image|minute|second|character)|\/ ?(mp|image|min|sec)\b/.test(headerText)) {
        continue
      }

      const modelCol = findColumn(table.headers, /^\s*model\s*$/i)
      const inputCol = findColumn(table.headers, /^\s*input\s*$/i)
      const outputCol = findColumn(table.headers, /^\s*output\s*$/i)
      // Single-price tables (embeddings, rerank, ASR) are not per-token
      // chat rates; both columns must exist.
      if (modelCol < 0 || inputCol < 0 || outputCol < 0) continue

      for (const row of table.rows) {
        const name = cell(row, modelCol)
        if (!name) continue

        const inputCell = cell(row, inputCol) ?? ''
        const { price: input, cached } = splitCachedCell(inputCell)
        const output = parsePricePerMillion(cell(row, outputCol))
        if (!input && !output) continue

        const modelId = slugify(name)
        if (!modelId || models.has(modelId)) continue

        models.set(modelId, {
          providerSlug: 'together',
          modelId,
          displayName: name,
          description: null,
          contextWindow: null,
          maxOutputTokens: null,
          longContextThreshold: null,
          modality: inferModality(name),
          tags: inferTags(name),
          isActive: true,
          pricing: {
            inputPrice: input?.value ?? null,
            cachedInputPrice: cached?.value ?? null,
            outputPrice: output?.value ?? null,
            longInputPrice: null,
            longCachedInputPrice: null,
            longOutputPrice: null,
            currency: 'USD',
            sourceUrl: PAGE_URL,
            sourceKind: 'scrape',
            raw: { headers: table.headers, row, page: PAGE_URL },
          },
        })
      }
    }

    return [...models.values()]
  },
}

/** "$0.30 $0.06 (cached)" → input $0.30, cached $0.06. */
function splitCachedCell(text: string): {
  price: ReturnType<typeof parsePricePerMillion>
  cached: ReturnType<typeof parsePricePerMillion>
} {
  const cachedMatch = text.match(/(\$[\d.,]+)\s*\(cached\)/i)
  const main = cachedMatch ? text.replace(cachedMatch[0], '') : text
  return {
    price: parsePricePerMillion(main),
    cached: cachedMatch ? parsePricePerMillion(cachedMatch[1]) : null,
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
