import { unstable_cache } from 'next/cache'
import { sql } from './db.ts'
import type { HistoryPointV1, PriceRowV1, SourceKind } from './types.ts'

/** Read models for the public API and the comparison table. */

export interface PriceFilters {
  provider?: string[]
  modality?: string
  tag?: string
  search?: string
  minInput?: number
  maxInput?: number
  minContext?: number
  includeInactive?: boolean
  sort?: SortKey
  direction?: 'asc' | 'desc'
  limit: number
  offset: number
}

/**
 * Sortable columns, whitelisted. The value is interpolated into the query as
 * an identifier, so it must never come straight from user input.
 */
const SORT_COLUMNS = {
  provider: 'provider',
  model: 'model_id',
  input: 'input_price',
  cached_input: 'cached_input_price',
  output: 'output_price',
  context: 'context_window',
  updated: 'updated_at',
} as const

export type SortKey = keyof typeof SORT_COLUMNS

export function isSortKey(value: string): value is SortKey {
  return Object.hasOwn(SORT_COLUMNS, value)
}

interface PriceRecord {
  provider: string
  provider_name: string
  model_id: string
  display_name: string
  input_price: number | null
  cached_input_price: number | null
  output_price: number | null
  long_input_price: number | null
  long_cached_input_price: number | null
  long_output_price: number | null
  context_window: number | null
  max_output_tokens: number | null
  long_context_threshold: number | null
  currency: string | null
  modality: string[]
  tags: string[]
  source_url: string | null
  source_kind: SourceKind | null
  updated_at: Date | null
  total_count: string | number
}

export interface PricesPage {
  rows: PriceRowV1[]
  total: number
  lastUpdated: string | null
}

/** Cached for the same reason as getProviderModels. */
export const getPrices = unstable_cache(getPricesUncached, ['prices'], {
  revalidate: 300,
  tags: ['prices'],
})

async function getPricesUncached(filters: PriceFilters): Promise<PricesPage> {
  const sortColumn = SORT_COLUMNS[filters.sort ?? 'input']
  const direction = filters.direction === 'desc' ? sql`desc` : sql`asc`

  // Models with no price sort last in either direction rather than clumping at
  // the top of an ascending price sort.
  const records = await sql<PriceRecord[]>`
    select *, count(*) over () as total_count
      from v_current_prices
     where (${filters.includeInactive ?? false} or is_active)
       and (${filters.provider?.length ? sql`provider = any(${filters.provider})` : sql`true`})
       and (${filters.modality ? sql`${filters.modality} = any(modality)` : sql`true`})
       and (${filters.tag ? sql`${filters.tag} = any(tags)` : sql`true`})
       and (${
         filters.search
           ? sql`(model_id ilike ${'%' + filters.search + '%'} or display_name ilike ${
               '%' + filters.search + '%'
             })`
           : sql`true`
       })
       and (${filters.minInput !== undefined ? sql`input_price >= ${filters.minInput}` : sql`true`})
       and (${filters.maxInput !== undefined ? sql`input_price <= ${filters.maxInput}` : sql`true`})
       and (${
         filters.minContext !== undefined ? sql`context_window >= ${filters.minContext}` : sql`true`
       })
     order by ${sql(sortColumn)} ${direction} nulls last, provider asc, model_id asc
     limit ${filters.limit} offset ${filters.offset}
  `

  const total = records.length > 0 ? Number(records[0].total_count) : await countPrices(filters)

  return {
    rows: records.map(toPriceRow),
    total,
    lastUpdated: await getLastUpdated(),
  }
}

/** Only needed when a page is empty, since the windowed count is unavailable then. */
async function countPrices(filters: PriceFilters): Promise<number> {
  const [row] = await sql<Array<{ count: string }>>`
    select count(*) as count from v_current_prices
     where (${filters.includeInactive ?? false} or is_active)
       and (${filters.provider?.length ? sql`provider = any(${filters.provider})` : sql`true`})
  `
  return Number(row?.count ?? 0)
}

export async function getModel(modelId: string): Promise<PriceRowV1 | null> {
  const [record] = await sql<PriceRecord[]>`
    select *, 1 as total_count
      from v_current_prices
     where model_id = ${modelId}
     order by is_active desc
     limit 1
  `
  return record ? toPriceRow(record) : null
}

export async function getHistory(modelId: string, limit = 365): Promise<HistoryPointV1[]> {
  const rows = await sql<
    Array<{
      input_price: number | null
      cached_input_price: number | null
      output_price: number | null
      long_input_price: number | null
      long_output_price: number | null
      currency: string
      source_kind: SourceKind | null
      recorded_at: Date
    }>
  >`
    select h.input_price, h.cached_input_price, h.output_price,
           h.long_input_price, h.long_output_price, h.currency,
           h.source_kind, h.recorded_at
      from price_history h
      join models m on m.id = h.model_id
     where m.model_id = ${modelId}
     order by h.recorded_at desc
     limit ${limit}
  `

  return rows.map((r) => ({
    input: r.input_price,
    cached_input: r.cached_input_price,
    output: r.output_price,
    long_input: r.long_input_price,
    long_output: r.long_output_price,
    currency: r.currency,
    source_kind: r.source_kind,
    recorded_at: r.recorded_at.toISOString(),
  }))
}

export interface PriceTrend {
  /** Evenly spaced input-price samples, oldest first. */
  series: number[]
  /** When the price last actually moved, or null if it has never changed. */
  lastChangedAt: string | null
  changeCount: number
}

/**
 * Build evenly spaced price series for every model.
 *
 * `price_history` only records a row when a price actually moves — that's what
 * keeps a daily re-scrape from growing the table — so there are no
 * evenly-spaced samples to read. The series is reconstructed by step
 * interpolation: each sample takes the last price recorded at or before that
 * date, which is exactly what the price was on that day.
 *
 * Samples before a model's first recording are back-filled with its earliest
 * known price. That's an assumption, not data — it renders as a flat line,
 * which honestly reflects "we weren't tracking it yet" rather than inventing
 * a change.
 */
export const getPriceTrends = unstable_cache(getPriceTrendsUncached, ['price-trends'], {
  revalidate: 300,
  tags: ['prices'],
})

async function getPriceTrendsUncached(
  days = 90,
  points = 6,
): Promise<Map<string, PriceTrend>> {
  const rows = await sql<
    Array<{ model_id: string; input_price: number | null; recorded_at: Date }>
  >`
    select m.model_id, h.input_price, h.recorded_at
      from price_history h
      join models m on m.id = h.model_id
     order by m.model_id, h.recorded_at asc
  `

  const byModel = new Map<string, Array<{ price: number | null; at: number }>>()
  for (const row of rows) {
    const list = byModel.get(row.model_id) ?? []
    list.push({ price: row.input_price, at: row.recorded_at.getTime() })
    byModel.set(row.model_id, list)
  }

  const now = Date.now()
  const windowMs = days * 24 * 60 * 60 * 1000
  const sampleTimes = Array.from({ length: points }, (_, i) =>
    points === 1 ? now : now - windowMs + (windowMs * i) / (points - 1),
  )

  const trends = new Map<string, PriceTrend>()

  for (const [modelId, history] of byModel) {
    const usable = history.filter((h) => h.price !== null) as Array<{ price: number; at: number }>
    if (usable.length === 0) continue

    const series = sampleTimes.map((time) => {
      let value = usable[0].price // back-fill before first observation
      for (const point of usable) {
        if (point.at <= time) value = point.price
        else break
      }
      return value
    })

    let lastChangedAt: string | null = null
    let changeCount = 0
    for (let i = 1; i < usable.length; i++) {
      if (usable[i].price !== usable[i - 1].price) {
        changeCount++
        lastChangedAt = new Date(usable[i].at).toISOString()
      }
    }

    trends.set(modelId, { series, lastChangedAt, changeCount })
  }

  return trends
}

export interface ModelRef {
  provider: string
  modelId: string
  updatedAt: string | null
}

/** Every indexable model, for sitemap generation and static params. */
export async function getAllModelRefs(): Promise<ModelRef[]> {
  const rows = await sql<
    Array<{ provider: string; model_id: string; updated_at: Date | null }>
  >`
    select p.slug as provider, m.model_id, pr.updated_at
      from models m
      join providers p on p.id = m.provider_id
      left join prices pr on pr.model_id = m.id
     where m.is_active
     order by p.slug, m.model_id
  `
  return rows.map((r) => ({
    provider: r.provider,
    modelId: r.model_id,
    updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  }))
}

/** One model resolved within its provider, so ids that repeat across vendors stay distinct. */
export async function getModelForProvider(
  provider: string,
  modelId: string,
): Promise<PriceRowV1 | null> {
  const [record] = await sql<PriceRecord[]>`
    select *, 1 as total_count
      from v_current_prices
     where provider = ${provider} and model_id = ${modelId}
     limit 1
  `
  return record ? toPriceRow(record) : null
}

/** Cheapest and most expensive comparable models, for contextual copy on detail pages. */
/**
 * Cached across requests.
 *
 * Every model page renders its provider's full model list to show siblings and
 * find a cheaper alternative. With Next prefetching links, opening one provider
 * page fires renders for all of its models at once — 73 for OpenAI — and each
 * was independently querying every row of that provider. A crawler walking the
 * sitemap does the same thing, and the database work starved every other page
 * on the site until it timed out.
 *
 * The data changes once a day, so serving a burst of renders from one cached
 * result costs nothing in freshness.
 */
export const getProviderModels = unstable_cache(
  getProviderModelsUncached,
  ['provider-models'],
  { revalidate: 300, tags: ['prices'] },
)

async function getProviderModelsUncached(provider: string): Promise<PriceRowV1[]> {
  const records = await sql<PriceRecord[]>`
    select *, count(*) over () as total_count
      from v_current_prices
     where provider = ${provider} and is_active
     -- The provider's own page order first; anything without a recorded
     -- position falls to the end rather than jumping to the top.
     order by source_rank asc nulls last, input_price asc nulls last
  `
  return records.map(toPriceRow)
}

export const getLastUpdated = unstable_cache(getLastUpdatedUncached, ['last-updated'], {
  revalidate: 300,
  tags: ['prices'],
})

async function getLastUpdatedUncached(): Promise<string | null> {
  const [row] = await sql<Array<{ updated_at: Date | null }>>`
    select max(updated_at) as updated_at from prices
  `
  return row?.updated_at ? row.updated_at.toISOString() : null
}

export const getProviders = unstable_cache(getProvidersUncached, ['providers'], {
  revalidate: 300,
  tags: ['prices'],
})

async function getProvidersUncached(): Promise<
  Array<{ slug: string; name: string; pricing_url: string | null; model_count: number }>
> {
  const rows = await sql<
    Array<{ slug: string; name: string; pricing_url: string | null; model_count: string }>
  >`
    select p.slug, p.name, p.pricing_url, count(m.id) filter (where m.is_active) as model_count
      from providers p
      left join models m on m.provider_id = p.id
     group by p.slug, p.name, p.pricing_url
     order by p.name
  `
  return rows.map((r) => ({ ...r, model_count: Number(r.model_count) }))
}

function toPriceRow(record: PriceRecord): PriceRowV1 {
  return {
    provider: record.provider,
    provider_name: record.provider_name,
    model_id: record.model_id,
    display_name: record.display_name,
    input: record.input_price,
    cached_input: record.cached_input_price,
    output: record.output_price,
    context_window: record.context_window,
    max_output_tokens: record.max_output_tokens,
    long_context_threshold: record.long_context_threshold,
    long_input: record.long_input_price,
    long_cached_input: record.long_cached_input_price,
    long_output: record.long_output_price,
    currency: record.currency ?? 'USD',
    modality: record.modality ?? [],
    tags: record.tags ?? [],
    source_url: record.source_url,
    source_kind: record.source_kind ?? 'catalog',
    updated_at: record.updated_at ? record.updated_at.toISOString() : null,
  }
}
