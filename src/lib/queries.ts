import { unstable_cache } from 'next/cache'
import { sql } from './db.ts'

/**
 * Cache a read, falling back to reading directly when there is no cache.
 *
 * `unstable_cache` requires Next's request scope and throws an invariant
 * without it, which makes every cached function unusable — and untestable —
 * from a plain script. Degrading to an uncached read keeps the same function
 * working in tests, CLI scripts and the pipeline, while production still gets
 * the cache.
 */
function cachedRead<Args extends unknown[], Result>(
  read: (...args: Args) => Promise<Result>,
  keys: string[],
  options: { revalidate: number; tags: string[] },
): (...args: Args) => Promise<Result> {
  const wrapped = unstable_cache(read, keys, options)

  return async (...args: Args) => {
    try {
      return await wrapped(...args)
    } catch (error) {
      if (error instanceof Error && /incrementalCache/i.test(error.message)) {
        return read(...args)
      }
      throw error
    }
  }
}
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
  description: string | null
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
export const getPrices = cachedRead(getPricesUncached, ['prices'], {
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
    // The uncached variant on purpose: this function is itself wrapped in
    // unstable_cache, and a cached function awaiting another cached function
    // deadlocks Next's data cache — the request simply never resolves.
    lastUpdated: await getLastUpdatedUncached(),
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

// ---------------------------------------------------------------------------
// Feed events — the read model behind /feed.xml
// ---------------------------------------------------------------------------

export type FeedEventKind = 'model_added' | 'price_change'

export const FEED_EVENT_KINDS: readonly FeedEventKind[] = ['model_added', 'price_change']

export function isFeedEventKind(value: string): value is FeedEventKind {
  return (FEED_EVENT_KINDS as readonly string[]).includes(value)
}

/** USD per 1M tokens, standard tier, in the shape the feed renders. */
export interface FeedPrices {
  input: number | null
  cachedInput: number | null
  output: number | null
  longInput: number | null
  longOutput: number | null
}

export interface FeedEvent {
  kind: FeedEventKind
  /**
   * Unique and stable for the life of the row: the `price_history` id for a
   * change, the model's uuid for an addition. Feed readers dedupe on the guid
   * built from this, so it must never be derived from mutable data — a guid
   * that shifts re-announces an old event to every subscriber.
   */
  id: string
  occurredAt: string
  provider: string
  providerName: string
  modelId: string
  displayName: string
  /** Scraped from vendor pages: untrusted, escaped and capped before rendering. */
  description: string | null
  contextWindow: number | null
  currency: string
  sourceUrl: string | null
  sourceKind: SourceKind | null
  /** Values after the event. */
  prices: FeedPrices
  /** Values before a change; null for an addition. */
  previous: FeedPrices | null
}

export interface FeedFilters {
  provider?: string[]
  kind?: FeedEventKind
  limit: number
}

interface FeedRecord {
  kind: FeedEventKind
  event_id: string
  occurred_at: Date
  provider: string
  provider_name: string
  model_id: string
  display_name: string
  description: string | null
  context_window: number | null
  currency: string | null
  source_url: string | null
  source_kind: SourceKind | null
  input_price: number | null
  cached_input_price: number | null
  output_price: number | null
  long_input_price: number | null
  long_output_price: number | null
  prev_input_price: number | null
  prev_cached_input_price: number | null
  prev_output_price: number | null
  prev_long_input_price: number | null
  prev_long_output_price: number | null
}

/** Cached for the same reason as getProviderModels, and tagged with it. */
export const getFeedEvents = cachedRead(getFeedEventsUncached, ['feed-events'], {
  revalidate: 300,
  tags: ['prices'],
})

/**
 * The site's changelog, assembled from what the database already records.
 *
 * Two things count as news, and both are already stored. A model appearing is
 * `models.created_at` — there is no separate announcement to read. A price
 * moving is a `price_history` row, and since the history trigger only fires
 * when a value actually changed, every row is a real event rather than the
 * residue of a re-scrape.
 */
async function getFeedEventsUncached(filters: FeedFilters): Promise<FeedEvent[]> {
  const records = await sql<FeedRecord[]>`
    with hist as (
      select h.id, h.model_id, h.recorded_at, h.currency, h.source_url, h.source_kind,
             h.input_price, h.cached_input_price, h.output_price,
             h.long_input_price, h.long_output_price,
             row_number()                     over w as seq,
             lag(h.input_price)               over w as prev_input_price,
             lag(h.cached_input_price)        over w as prev_cached_input_price,
             lag(h.output_price)              over w as prev_output_price,
             lag(h.long_input_price)          over w as prev_long_input_price,
             lag(h.long_output_price)         over w as prev_long_output_price
        from price_history h
      -- Ordered by (recorded_at, id), not recorded_at alone: one pipeline run
      -- can write several rows inside the same transaction timestamp, and the
      -- bigserial id is the only total order available then.
      window w as (partition by h.model_id order by h.recorded_at asc, h.id asc)
    ),
    events as (
      select 'price_change'::text as kind,
             h.id::text           as event_id,
             h.recorded_at        as occurred_at,
             p.slug               as provider,
             p.name               as provider_name,
             m.model_id, m.display_name, m.description, m.context_window,
             h.currency, h.source_url, h.source_kind,
             h.input_price, h.cached_input_price, h.output_price,
             h.long_input_price, h.long_output_price,
             h.prev_input_price, h.prev_cached_input_price, h.prev_output_price,
             h.prev_long_input_price, h.prev_long_output_price
        from hist h
        join models m    on m.id = h.model_id
        join providers p on p.id = m.provider_id
       -- seq > 1 excludes each model's first history row. The history trigger
       -- fires on insert as well as update, so that row is written by the same
       -- statement that creates the model's price — publishing it would
       -- announce one real event twice, as an addition and as a change from
       -- nothing.
       where h.seq > 1
         and (h.input_price        is distinct from h.prev_input_price
           or h.cached_input_price is distinct from h.prev_cached_input_price
           or h.output_price       is distinct from h.prev_output_price
           or h.long_input_price   is distinct from h.prev_long_input_price
           or h.long_output_price  is distinct from h.prev_long_output_price)

      union all

      -- Launch prices come from the model's first history row where there is
      -- one, so an addition reports what the model cost when it appeared
      -- rather than what it costs today.
      select 'model_added'::text as kind,
             m.id::text          as event_id,
             m.created_at        as occurred_at,
             p.slug              as provider,
             p.name              as provider_name,
             m.model_id, m.display_name, m.description, m.context_window,
             coalesce(launch.currency, pr.currency, 'USD')       as currency,
             coalesce(launch.source_url, pr.source_url)          as source_url,
             coalesce(launch.source_kind, pr.source_kind)        as source_kind,
             coalesce(launch.input_price, pr.input_price)               as input_price,
             coalesce(launch.cached_input_price, pr.cached_input_price) as cached_input_price,
             coalesce(launch.output_price, pr.output_price)             as output_price,
             coalesce(launch.long_input_price, pr.long_input_price)     as long_input_price,
             coalesce(launch.long_output_price, pr.long_output_price)   as long_output_price,
             null::numeric as prev_input_price,
             null::numeric as prev_cached_input_price,
             null::numeric as prev_output_price,
             null::numeric as prev_long_input_price,
             null::numeric as prev_long_output_price
        from models m
        join providers p on p.id = m.provider_id
        left join prices pr on pr.model_id = m.id
        left join lateral (
          select ph.currency, ph.source_url, ph.source_kind, ph.input_price,
                 ph.cached_input_price, ph.output_price, ph.long_input_price,
                 ph.long_output_price
            from price_history ph
           where ph.model_id = m.id
           order by ph.recorded_at asc, ph.id asc
           limit 1
        ) launch on true
    )
    select * from events
     where (${filters.provider?.length ? sql`provider = any(${filters.provider})` : sql`true`})
       and (${filters.kind ? sql`kind = ${filters.kind}` : sql`true`})
     -- kind and event_id break ties deterministically. The initial catalog
     -- import gave hundreds of models an identical created_at, and an order
     -- that shuffles between fetches makes a reader re-render what it has
     -- already shown.
     order by occurred_at desc, kind asc, event_id desc
     limit ${filters.limit}
  `

  return records.map(toFeedEvent)
}

function toFeedEvent(record: FeedRecord): FeedEvent {
  return {
    kind: record.kind,
    id: record.event_id,
    occurredAt: record.occurred_at.toISOString(),
    provider: record.provider,
    providerName: record.provider_name,
    modelId: record.model_id,
    displayName: record.display_name,
    description: record.description ?? null,
    contextWindow: record.context_window,
    currency: record.currency ?? 'USD',
    sourceUrl: record.source_url,
    sourceKind: record.source_kind,
    prices: {
      input: record.input_price,
      cachedInput: record.cached_input_price,
      output: record.output_price,
      longInput: record.long_input_price,
      longOutput: record.long_output_price,
    },
    previous:
      record.kind === 'price_change'
        ? {
            input: record.prev_input_price,
            cachedInput: record.prev_cached_input_price,
            output: record.prev_output_price,
            longInput: record.prev_long_input_price,
            longOutput: record.prev_long_output_price,
          }
        : null,
  }
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
/**
 * A Map cannot survive the data cache — it serialises to `{}` — so the cached
 * layer stores entries as an array and the Map is rebuilt on the way out.
 */
const getPriceTrendEntries = cachedRead(
  async (days?: number, points?: number) => [...(await getPriceTrendsUncached(days, points))],
  ['price-trends'],
  { revalidate: 300, tags: ['prices'] },
)

export async function getPriceTrends(days = 90, points = 6): Promise<Map<string, PriceTrend>> {
  return new Map(await getPriceTrendEntries(days, points))
}

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
export const getProviderModels = cachedRead(getProviderModelsUncached, ['provider-models'], {
  revalidate: 300,
  tags: ['prices'],
})

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

export const getLastUpdated = cachedRead(getLastUpdatedUncached, ['last-updated'], {
  revalidate: 300,
  tags: ['prices'],
})

async function getLastUpdatedUncached(): Promise<string | null> {
  const [row] = await sql<Array<{ updated_at: Date | null }>>`
    select max(updated_at) as updated_at from prices
  `
  return row?.updated_at ? row.updated_at.toISOString() : null
}

export const getProviders = cachedRead(getProvidersUncached, ['providers'], {
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
    // Coalesced rather than passed through: a database that has not had the
    // description column added yet returns rows without the field at all, and
    // an undefined here would drop the key from every API response.
    description: record.description ?? null,
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
