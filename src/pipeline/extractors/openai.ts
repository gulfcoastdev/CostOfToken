import type { NormalizedModel } from '@/lib/types.ts'
import { inferModality, inferTags, parsePricePerMillion, parseTokenCount } from '../normalize.ts'
import {
  cell,
  classifyTier,
  classifyUnit,
  findColumn,
  findColumnExcluding,
  hasNoTierVocabulary,
  type PricingTier,
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
    const candidates = new Map<string, Candidate[]>()

    // Decided once, from the whole document — never per table. A per-table or
    // positional decision would reintroduce the order-dependence this replaced.
    const soleTable = hasNoTierVocabulary(tables)

    for (const table of tables) {
      // Only standard-tier, token-priced text tables. Batch/Flex/Fast mode and
      // fine-tuning are not comparable to other vendors' standard rates;
      // per-image, per-second and per-hour tables use different units entirely.
      //
      // A table stating a non-standard tier is refused outright. A table
      // stating nothing is held as a *candidate* rather than trusted: many
      // sections here are simply untiered (the Daybreak, realtime and
      // transcription models have no tabs at all), and refusing those would
      // drop forty models that do have an unambiguous standard price. What
      // cannot be trusted is an unlabelled table that *disagrees* with another
      // about the same model — that is resolved below, or refused.
      const tier = classifyTier(table, { soleTable })
      if (tier === 'non_standard') continue
      if (classifyUnit(table) !== 'per_token') continue
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

        const input = parsePricePerMillion(cell(row, shortInput), unitHint)
        const output = parsePricePerMillion(cell(row, shortOutput), unitHint)
        if (!input && !output) continue

        const cached = parsePricePerMillion(cell(row, shortCached), unitHint)
        const lInput = parsePricePerMillion(cell(row, longInput), unitHint)
        const lCached = parsePricePerMillion(cell(row, longCached), unitHint)
        const lOutput = parsePricePerMillion(cell(row, longOutput), unitHint)

        const candidate: NormalizedModel = {
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
        }

        const list = candidates.get(modelId) ?? []
        list.push({ tier, isText: isTextRow(row, modelCol, table.headers), model: candidate })
        candidates.set(modelId, list)
      }
    }

    const models: NormalizedModel[] = []
    for (const list of candidates.values()) {
      const resolved = resolve(list)
      if (resolved) models.push(resolved)
    }
    return models
  },
}

interface Candidate {
  tier: PricingTier
  /** The row is the text-modality row of a table that splits by modality. */
  isText: boolean
  model: NormalizedModel
}

/**
 * Pick the one record to catalogue for a model, without consulting position.
 *
 * The rule this replaced was "first table wins". That made the recorded value a
 * function of the order the vendor happened to print its tables in, and when
 * that order shifted, four runs inside thirty minutes recorded three different
 * prices for one model against unchanged upstream content.
 *
 * Order here: a table that positively states the standard tier outranks one
 * that states nothing; within that, the text-modality row outranks the image
 * row, because the catalogue's input price is a text-token price. Anything
 * still disagreeing is genuine ambiguity, and is refused — publishing one of
 * two contradictory numbers is how this defect reached readers.
 */
function resolve(list: Candidate[]): NormalizedModel | null {
  const stated = list.filter((c) => c.tier === 'standard')
  const pool = stated.length > 0 ? stated : list

  const text = pool.filter((c) => c.isText)
  const chosen = text.length > 0 ? text : pool

  const distinct = new Set(chosen.map((c) => priceKey(c.model)))
  if (distinct.size > 1) return null

  return chosen[0].model
}

/** Prices only: two rows agreeing on price are not an ambiguity worth refusing. */
function priceKey(model: NormalizedModel): string {
  const p = model.pricing
  return JSON.stringify([p.inputPrice, p.cachedInputPrice, p.outputPrice, p.longInputPrice, p.longOutputPrice])
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

/**
 * Whether this row is the text-modality row of a table that splits by modality.
 *
 * A table with a Modality column lists a model once per modality — gpt-image-2
 * appears as Image at $8.00 and Text at $5.00. The catalogue stores a text-token
 * price, so the Text row is the one that belongs in it, regardless of which the
 * vendor printed first.
 */
function isTextRow(row: string[], modelCol: number, headers: string[]): boolean {
  const modalityCol = findColumn(headers, /^\s*modality\s*$/i)
  if (modalityCol < 0 || modalityCol === modelCol) return false
  return /^\s*text\s*$/i.test(cell(row, modalityCol) ?? '')
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
