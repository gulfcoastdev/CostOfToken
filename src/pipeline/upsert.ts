import { sql } from '@/lib/db.ts'
import type { NormalizedModel } from '@/lib/types.ts'
import type { Anomaly, BaselineModel } from './anomaly.ts'
import { PROVIDERS } from './providers.ts'

/**
 * Persistence for the daily pipeline.
 *
 * `price_history` is written by a database trigger on `prices`, not from here,
 * so history is recorded no matter which code path changes a price — and the
 * trigger skips rows whose numbers didn't move, keeping a daily re-scrape of
 * unchanged pricing from growing the table by one row per model per day.
 */

export async function ensureProviders(): Promise<Map<string, string>> {
  const rows = await sql<Array<{ id: string; slug: string }>>`
    insert into providers ${sql(
      PROVIDERS.map((p) => ({
        slug: p.slug,
        name: p.name,
        website: p.website,
        pricing_url: p.pricingUrl,
        region: p.region,
      })),
    )}
    on conflict (slug) do update set
      name        = excluded.name,
      website     = excluded.website,
      pricing_url = excluded.pricing_url,
      region      = excluded.region
    returning id, slug
  `
  return new Map(rows.map((r) => [r.slug, r.id]))
}

/**
 * The provider's currently-stored prices, used as the baseline for anomaly
 * detection. Read before the upsert, since the upsert destroys it.
 */
export async function getProviderBaseline(providerId: string): Promise<BaselineModel[]> {
  return await sql<BaselineModel[]>`
    select m.model_id      as "modelId",
           pr.input_price        as "inputPrice",
           pr.cached_input_price as "cachedInputPrice",
           pr.output_price       as "outputPrice"
      from models m
      join prices pr on pr.model_id = m.id
     where m.provider_id = ${providerId}
       and m.is_active
  `
}

export interface UpsertResult {
  modelsWritten: number
  pricesChanged: number
}

/**
 * Upsert one provider's models and prices inside a single transaction, so a
 * provider is never left half-written.
 */
export async function upsertProviderModels(
  providerId: string,
  models: NormalizedModel[],
): Promise<UpsertResult> {
  if (models.length === 0) return { modelsWritten: 0, pricesChanged: 0 }

  return await sql.begin(async (tx) => {
    const modelRows = await tx<Array<{ id: string; model_id: string }>>`
      insert into models ${tx(
        models.map((m) => ({
          provider_id: providerId,
          model_id: m.modelId,
          display_name: m.displayName,
          context_window: m.contextWindow,
          max_output_tokens: m.maxOutputTokens,
          long_context_threshold: m.longContextThreshold,
          modality: m.modality,
          tags: m.tags,
          is_active: m.isActive,
        })),
      )}
      on conflict (provider_id, model_id) do update set
        display_name           = excluded.display_name,
        -- Keep a known context window if this run couldn't determine one.
        context_window         = coalesce(excluded.context_window, models.context_window),
        max_output_tokens      = coalesce(excluded.max_output_tokens, models.max_output_tokens),
        long_context_threshold = coalesce(excluded.long_context_threshold, models.long_context_threshold),
        modality               = excluded.modality,
        tags                   = excluded.tags,
        is_active              = excluded.is_active
      returning id, model_id
    `

    const idByModelId = new Map(modelRows.map((r) => [r.model_id, r.id]))

    const priceRows = models
      .map((m) => {
        const uuid = idByModelId.get(m.modelId)
        if (!uuid) return null
        return {
          model_id: uuid,
          input_price: m.pricing.inputPrice,
          cached_input_price: m.pricing.cachedInputPrice,
          output_price: m.pricing.outputPrice,
          long_input_price: m.pricing.longInputPrice,
          long_cached_input_price: m.pricing.longCachedInputPrice,
          long_output_price: m.pricing.longOutputPrice,
          currency: m.pricing.currency,
          source_url: m.pricing.sourceUrl,
          source_kind: m.pricing.sourceKind,
          raw_data: m.pricing.raw === undefined ? null : sql.json(m.pricing.raw as never),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    if (priceRows.length === 0) {
      return { modelsWritten: modelRows.length, pricesChanged: 0 }
    }

    // Count only rows whose numbers actually moved, not rows touched — a daily
    // re-scrape of unchanged pricing should report zero changes.
    //
    // `excluded` is not in scope in a RETURNING clause, so prior state is
    // captured in a CTE instead. Both CTEs read the same statement snapshot,
    // so `prior` still sees the pre-upsert values.
    const modelUuids = priceRows.map((r) => r.model_id)

    const [summary] = await tx<Array<{ changed: string }>>`
      with prior as (
        select model_id, input_price, cached_input_price, output_price,
               long_input_price, long_cached_input_price, long_output_price, currency
          from prices
         where model_id = any(${modelUuids}::uuid[])
      ),
      upserted as (
        insert into prices ${tx(priceRows)}
        on conflict (model_id) do update set
          input_price             = excluded.input_price,
          cached_input_price      = excluded.cached_input_price,
          output_price            = excluded.output_price,
          long_input_price        = excluded.long_input_price,
          long_cached_input_price = excluded.long_cached_input_price,
          long_output_price       = excluded.long_output_price,
          currency                = excluded.currency,
          effective_date          = current_date,
          source_url              = excluded.source_url,
          source_kind             = excluded.source_kind,
          raw_data                = excluded.raw_data
        returning model_id, input_price, cached_input_price, output_price,
                  long_input_price, long_cached_input_price, long_output_price, currency
      )
      select count(*) filter (
        where p.model_id is null
           or p.input_price             is distinct from u.input_price
           or p.cached_input_price      is distinct from u.cached_input_price
           or p.output_price            is distinct from u.output_price
           or p.long_input_price        is distinct from u.long_input_price
           or p.long_cached_input_price is distinct from u.long_cached_input_price
           or p.long_output_price       is distinct from u.long_output_price
           or p.currency                is distinct from u.currency
      ) as changed
        from upserted u
        left join prior p on p.model_id = u.model_id
    `

    return {
      modelsWritten: modelRows.length,
      pricesChanged: Number(summary?.changed ?? 0),
    }
  })
}

export interface RunLogEntry {
  runId: string
  providerSlug: string
  status: 'ok' | 'partial' | 'failed' | 'skipped' | 'blocked'
  sourceKind: string | null
  modelsFound: number
  modelsChanged: number
  durationMs: number
  error?: string | null
  anomalies?: Anomaly[]
}

export async function logExtractionRun(entry: RunLogEntry): Promise<void> {
  await sql`
    insert into extraction_runs
      (run_id, provider_slug, status, source_kind, models_found, models_changed,
       duration_ms, error, anomalies)
    values (
      ${entry.runId}, ${entry.providerSlug}, ${entry.status}, ${entry.sourceKind},
      ${entry.modelsFound}, ${entry.modelsChanged}, ${entry.durationMs}, ${entry.error ?? null},
      ${entry.anomalies?.length ? sql.json(entry.anomalies as never) : null}
    )
  `
}

/**
 * Mark models that a provider stopped listing as inactive rather than deleting
 * them, so their price history survives and the API can still resolve them.
 */
export async function deactivateMissingModels(
  providerId: string,
  seenModelIds: string[],
): Promise<number> {
  if (seenModelIds.length === 0) return 0
  const rows = await sql<Array<{ id: string }>>`
    update models
       set is_active = false
     where provider_id = ${providerId}
       and is_active
       and model_id <> all(${seenModelIds})
    returning id
  `
  return rows.length
}
