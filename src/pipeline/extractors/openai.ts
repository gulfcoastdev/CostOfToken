import type { NormalizedModel } from '@/lib/types.ts'
import { inferModality, inferTags, parsePricePerMillion, parseTokenCount } from '../normalize.ts'
import {
  cell,
  findColumn,
  findColumnExcluding,
  isStandardTier,
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
      // The page renders Standard / Batch / Flex / Fast mode as tabs, and the
      // markdown emits the tab label as a bare line above the table. Take the
      // standard tab; the others are different products, not our headline rate.
      if (!isStandardTier(table)) continue
      if (!isTokenPricingTable(table)) continue

      const modelCol = findColumn(table.headers, /^\s*model\s*$/i)
      if (modelCol < 0) continue

      const shortInput = findColumnExcluding(
        table.headers,
        /short context.*input|^input$/i,
        /cach/i,
      )
      const shortCached = findColumn(table.headers, /short context.*cached input|^cached input$/i)
      // "Output / cost" is the grouped tables' name for the same column. The
      // pattern stays anchored: a contains-match would admit per-minute and
      // per-image output columns that are not per-token prices.
      const shortOutput = findColumn(table.headers, /short context.*output|^output\s*(\/\s*cost)?$/i)
      const longInput = findColumnExcluding(table.headers, /long context.*input/i, /cach/i)
      const longCached = findColumn(table.headers, /long context.*cached input/i)
      const longOutput = findColumn(table.headers, /long context.*output/i)

      if (shortInput < 0 && shortOutput < 0) continue

      const unitHint = table.headers.join(' ')

      // Realtime/audio and image tables carry a Modality column — one row per
      // modality per model, Audio listed first. Until 009 the first row won
      // ("the numbers OpenAI leads with"), but that order proved to be
      // presentation, not pricing: OpenAI flipped Audio/Text between
      // 2026-08-22 and 2026-08-23 and 14 models recorded 8x–16.7x phantom
      // changes against unchanged prices. The Text row is the headline — the
      // only row priced in the unit the whole catalogue compares on — and the
      // other rows are preserved in raw.modalities rather than discarded.
      const modalityCol = findColumn(table.headers, /^\s*modality\s*$/i)
      if (modalityCol >= 0) {
        extractModalityTable(table, models, { modelCol, modalityCol, shortInput, shortCached, shortOutput, unitHint })
        continue
      }

      for (const row of table.rows) {
        const rawModel = cell(row, modelCol)
        if (!rawModel || looksLikeSectionRow(rawModel)) continue

        // Rows read "gpt-5.5 (<272K context length)". The qualifier belongs in
        // the long-context threshold, not in the id or the display name, where
        // it would leak into headings, tables and page titles.
        const { modelId, threshold } = splitModelQualifier(rawModel)
        if (!modelId) continue

        const input = parsePricePerMillion(cell(row, shortInput), unitHint)
        const output = parsePricePerMillion(cell(row, shortOutput), unitHint)
        if (!input && !output) continue

        const cached = parsePricePerMillion(cell(row, shortCached), unitHint)
        const lInput = parsePricePerMillion(cell(row, longInput), unitHint)
        const lCached = parsePricePerMillion(cell(row, longCached), unitHint)
        const lOutput = parsePricePerMillion(cell(row, longOutput), unitHint)

        // A model can appear more than once — once per modality in the image
        // and audio tables, and again in a family table. First listing wins,
        // so the numbers OpenAI leads with are the ones on the id.
        if (models.has(modelId)) continue

        models.set(modelId, {
          providerSlug: 'openai',
          modelId,
          displayName: modelId,
          contextWindow: null, // not published on the pricing page; supplied by the catalog
          maxOutputTokens: null,
          longContextThreshold: threshold ?? (lInput || lOutput ? 128_000 : null),
          description: null, // the pricing page carries no prose; enrichment fills it
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
            raw: {
              caption: table.caption,
              // Recorded so a later investigation can see what the tier
              // decision was actually made from.
              labels: table.labels,
              headers: table.headers,
              row,
              page: PAGE_URL,
            },
          },
        })
      }
    }

    return [...models.values()]
  },
}





/**
 * Extract models from a table that has a Modality column.
 *
 * Each model spans one row per modality. The Text row supplies the headline
 * prices; a model without a usable Text row is skipped entirely, because an
 * audio or image rate published as the per-token headline is exactly the
 * wrong number this path exists to prevent — absence beats substitution.
 * Every modality row is kept, parsed, in raw.modalities so no scraped rate
 * is lost.
 */
function extractModalityTable(
  table: SourceTable,
  models: Map<string, NormalizedModel>,
  columns: {
    modelCol: number
    modalityCol: number
    shortInput: number
    shortCached: number
    shortOutput: number
    unitHint: string
  },
): void {
  const { modelCol, modalityCol, shortInput, shortCached, shortOutput, unitHint } = columns

  const groups = new Map<string, { threshold: number | null; rows: string[][] }>()
  for (const row of table.rows) {
    const rawModel = cell(row, modelCol)
    if (!rawModel || looksLikeSectionRow(rawModel)) continue
    const { modelId, threshold } = splitModelQualifier(rawModel)
    if (!modelId) continue
    const group = groups.get(modelId) ?? { threshold: null, rows: [] }
    group.threshold ??= threshold
    group.rows.push(row)
    groups.set(modelId, group)
  }

  for (const [modelId, group] of groups) {
    // Cross-table dedupe is unchanged: the first table naming a model wins.
    if (models.has(modelId)) continue

    const parseRow = (row: string[]) => ({
      input: parsePricePerMillion(cell(row, shortInput), unitHint),
      cached: parsePricePerMillion(cell(row, shortCached), unitHint),
      output: parsePricePerMillion(cell(row, shortOutput), unitHint),
    })

    const textRow = group.rows.find((row) => /^text(\s+tokens?)?$/i.test(cell(row, modalityCol) ?? ''))
    if (!textRow) continue

    const { input, cached, output } = parseRow(textRow)
    if (!input && !output) continue

    models.set(modelId, {
      providerSlug: 'openai',
      modelId,
      displayName: modelId,
      contextWindow: null,
      maxOutputTokens: null,
      longContextThreshold: group.threshold,
      description: null,
      modality: inferModality(modelId, table.caption),
      tags: inferTags(modelId, table.caption),
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
          labels: table.labels,
          headers: table.headers,
          // Which row supplied the headline, and every row the model spanned
          // — parsed and raw — so the audio/image rates are recoverable
          // instead of discarded. Document order is kept; it is presentation.
          headlineModality: 'text',
          modalities: group.rows.map((row) => {
            const parsed = parseRow(row)
            return {
              modality: cell(row, modalityCol)?.toLowerCase() ?? '',
              row,
              inputPrice: parsed.input?.value ?? null,
              cachedInputPrice: parsed.cached?.value ?? null,
              outputPrice: parsed.output?.value ?? null,
            }
          }),
          page: PAGE_URL,
        },
      },
    })
  }
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
  // Fine-tuning tables carry a "Training" column priced per hour. Training is a
  // different product, not a discount on inference.
  if (/\btraining\b/.test(headerText)) return false
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
