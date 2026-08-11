import type { NormalizedModel } from '@/lib/types.ts'
import { inferModality, inferTags, parsePricePerMillion } from '../normalize.ts'
import { cell, findColumn, findColumnExcluding, isNonStandardTier } from './html-table.ts'
import { parseMarkdownTables } from './markdown-table.ts'
import type { Extractor } from './types.ts'

const PAGE_URL = 'https://docs.anthropic.com/en/docs/about-claude/pricing'
/** Markdown rendering — smaller, and immune to docs-site markup changes. */
const SOURCE_URL = `${PAGE_URL}.md`

/**
 * Anthropic's table is flat, with prices written "$10 / MTok":
 *   Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes |
 *   Cache Hits & Refreshes | Output Tokens
 *
 * "Cache Hits & Refreshes" is the cached-input equivalent. The two cache-write
 * columns have no counterpart in our schema and are preserved in raw_data.
 */
export const anthropicExtractor: Extractor = {
  providerSlug: 'anthropic',
  sourceKind: 'scrape',
  sourceUrl: SOURCE_URL,

  async extract(ctx): Promise<NormalizedModel[]> {
    const markdown = await ctx.fetchText(SOURCE_URL)
    const tables = parseMarkdownTables(markdown)
    const models = new Map<string, NormalizedModel>()

    for (const table of tables) {
      // "Batch processing" repeats every model at half price and would
      // otherwise overwrite the standard rates parsed from "Model pricing".
      if (isNonStandardTier(table)) continue
      // Tool/bash/computer-use tables also have a Model column, but their
      // numbers are token counts, not prices.
      if (table.captionPath.some((c) => /\btool|bash|computer use\b/i.test(c))) continue

      const modelCol = findColumn(table.headers, /^\s*model\s*$/i)
      if (modelCol < 0) continue

      // "Base Input Tokens" — must not match the cache columns.
      const inputCol = findColumnExcluding(table.headers, /input/i, /cach|writ/i)
      const cachedCol = findColumn(table.headers, /cache hits|cached input|cache read/i)
      const outputCol = findColumnExcluding(table.headers, /output/i, /cach|writ/i)
      const writeCols = table.headers
        .map((h, i) => (/cache writ/i.test(h) ? i : -1))
        .filter((i) => i >= 0)

      if (inputCol < 0 && outputCol < 0) continue

      const unitHint = table.headers.join(' ') || '/ MTok'

      for (const row of table.rows) {
        const displayName = cell(row, modelCol)
        if (!displayName) continue

        // Some rows announce a future repricing ("Claude Sonnet 5 (starting
        // September 1, 2026)") alongside the currently-billed row. `prices`
        // holds what you pay today, so scheduled future rates are skipped —
        // they'd otherwise overwrite the current row under the same id.
        if (/\bstarting\b/i.test(displayName)) continue

        const input = parsePricePerMillion(cell(row, inputCol), unitHint)
        const output = parsePricePerMillion(cell(row, outputCol), unitHint)
        if (!input && !output) continue

        const cached = parsePricePerMillion(cell(row, cachedCol), unitHint)
        const modelId = toModelId(displayName)
        // First table wins — see the note in openai.ts on tier tabs.
        if (models.has(modelId)) continue

        models.set(modelId, {
          providerSlug: 'anthropic',
          modelId,
          displayName,
          contextWindow: null, // supplied by the catalog
          maxOutputTokens: null,
          longContextThreshold: null,
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
            raw: {
              caption: table.caption,
              headers: table.headers,
              row,
              cacheWrites: writeCols.map((i) => ({ header: table.headers[i], value: row[i] })),
            },
          },
        })
      }
    }

    return [...models.values()]
  },
}

/**
 * The pricing page lists display names ("Claude Opus 4.5"), not API ids.
 * Derive a stable slug; data/overrides.ts maps these onto exact API
 * identifiers where they differ.
 *
 * Parenthetical qualifiers — "(retired except on Bedrock and Google Cloud)",
 * "(through August 31, 2026)" — are stripped, since including them would
 * change the model's id the moment Anthropic edits the note.
 */
function toModelId(displayName: string): string {
  return displayName
    .replace(/\(.*?\)/g, ' ')
    // Drop validity-window qualifiers so a repricing announcement doesn't
    // fork one model into two ids.
    .replace(/\b(through|starting|until|from|effective)\b.*$/i, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
