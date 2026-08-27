import { sql } from '@/lib/db.ts'
import type { BaselineModel } from './anomaly.ts'
import { rankOffers, type Offer } from '@/lib/offers.ts'

/**
 * Price-monitoring engine (011).
 *
 * Turns each provider run's diffs into durable events — the alert engine's
 * queue and the changelog's future source. Three offer-level kinds come from
 * comparing the provider's pre-run baseline with what the run wrote; the
 * fourth, cheapest_flip, is the product's headline: the cheapest seller of a
 * canonical model changed. No material change writes nothing — a daily run
 * over unchanged prices must not grow this table.
 */

export interface OfferState {
  modelId: string
  inputPrice: number | null
  cachedInputPrice: number | null
  outputPrice: number | null
}

export interface EventDraft {
  kind: 'price_change' | 'offer_added' | 'offer_removed' | 'cheapest_flip'
  /** Provider-scoped offer id for offer-level events; canonical slug for flips. */
  modelId?: string
  canonicalId?: string
  details: Record<string, unknown>
}

/** Offer-level events for one provider run. Held changes wrote nothing. */
export function detectOfferEvents(
  baseline: BaselineModel[],
  current: OfferState[],
  held: ReadonlySet<string>,
): EventDraft[] {
  const before = new Map(baseline.map((m) => [m.modelId, m]))
  const after = new Map(current.map((m) => [m.modelId, m]))
  const events: EventDraft[] = []

  for (const offer of current) {
    const prior = before.get(offer.modelId)
    if (!prior) {
      events.push({
        kind: 'offer_added',
        modelId: offer.modelId,
        details: { prices: prices(offer) },
      })
      continue
    }
    if (held.has(offer.modelId)) continue

    if (
      prior.inputPrice !== offer.inputPrice ||
      prior.cachedInputPrice !== offer.cachedInputPrice ||
      prior.outputPrice !== offer.outputPrice
    ) {
      events.push({
        kind: 'price_change',
        modelId: offer.modelId,
        details: { before: prices(prior), after: prices(offer) },
      })
    }
  }

  for (const prior of baseline) {
    if (!after.has(prior.modelId)) {
      events.push({
        kind: 'offer_removed',
        modelId: prior.modelId,
        details: { lastPrices: prices(prior) },
      })
    }
  }

  return events
}

function prices(o: {
  inputPrice: number | null
  cachedInputPrice?: number | null
  outputPrice: number | null
}): Record<string, number | null> {
  return {
    inputPrice: o.inputPrice,
    cachedInputPrice: o.cachedInputPrice ?? null,
    outputPrice: o.outputPrice,
  }
}

/** The headline basis for "cheapest": 1M input + 1M output tokens. */
export const HEADLINE_WORKLOAD = { inputTokens: 1_000_000, outputTokens: 1_000_000 }

export interface CheapestState {
  canonicalId: string
  slug: string
  providerSlug: string
  cost: number
}

/**
 * Flips only: the cheapest seller changed. A price move under the same
 * seller is a price_change, not a flip; a first priced offer has no
 * incumbent to switch from.
 */
export function detectCheapestFlips(
  before: CheapestState[],
  after: CheapestState[],
): EventDraft[] {
  const prior = new Map(before.map((s) => [s.canonicalId, s]))
  const flips: EventDraft[] = []

  for (const now of after) {
    const was = prior.get(now.canonicalId)
    if (!was || was.providerSlug === now.providerSlug) continue
    flips.push({
      kind: 'cheapest_flip',
      canonicalId: now.canonicalId,
      details: {
        slug: now.slug,
        workload: 'headline-1m-in-1m-out',
        before: { providerSlug: was.providerSlug, cost: was.cost },
        after: { providerSlug: now.providerSlug, cost: now.cost },
      },
    })
  }

  return flips
}

/**
 * Current cheapest offer per canonical model, for the given canonical ids.
 * Query + pure ranking; called before and after a provider's write.
 */
export async function cheapestByCanonical(canonicalIds: string[]): Promise<CheapestState[]> {
  if (canonicalIds.length === 0) return []

  const rows = await sql<Array<Offer & { canonicalId: string; slug: string }>>`
    select cm.id           as "canonicalId",
           cm.slug         as "slug",
           p.slug          as "providerSlug",
           p.name          as "providerName",
           p.provider_type as "providerType",
           m.model_id      as "modelId",
           m.display_name  as "displayName",
           m.offer_tier    as "offerTier",
           m.offer_region  as "offerRegion",
           pr.input_price        as "inputPrice",
           pr.cached_input_price as "cachedInputPrice",
           pr.output_price       as "outputPrice"
      from canonical_models cm
      join models m on m.canonical_model_id = cm.id and m.is_active
      join providers p on p.id = m.provider_id
      left join prices pr on pr.model_id = m.id
     where cm.id = any(${canonicalIds}::uuid[])
  `

  const byCanonical = new Map<string, { slug: string; offers: Offer[] }>()
  for (const row of rows) {
    const group = byCanonical.get(row.canonicalId) ?? { slug: row.slug, offers: [] }
    group.offers.push(row)
    byCanonical.set(row.canonicalId, group)
  }

  const result: CheapestState[] = []
  for (const [canonicalId, group] of byCanonical) {
    const cheapest = rankOffers(group.offers, HEADLINE_WORKLOAD).priced[0]
    if (cheapest) {
      result.push({
        canonicalId,
        slug: group.slug,
        providerSlug: cheapest.offer.providerSlug,
        cost: cheapest.cost,
      })
    }
  }
  return result
}

/** Canonical ids this provider's offers link to (for scoping flip checks). */
export async function canonicalIdsForProvider(providerId: string): Promise<string[]> {
  const rows = await sql<Array<{ id: string }>>`
    select distinct canonical_model_id as id from models
     where provider_id = ${providerId} and canonical_model_id is not null and is_active
  `
  return rows.map((r) => r.id)
}

/** Persist a run's events. Offer ids are resolved to row uuids per provider. */
export async function recordMonitoringEvents(
  runId: string,
  providerId: string,
  events: EventDraft[],
): Promise<number> {
  if (events.length === 0) return 0

  const offerIds = [
    ...new Set(events.filter((e) => e.modelId).map((e) => e.modelId as string)),
  ]
  const idRows = offerIds.length
    ? await sql<Array<{ id: string; model_id: string; canonical_model_id: string | null }>>`
        select id, model_id, canonical_model_id from models
         where provider_id = ${providerId} and model_id = any(${offerIds})
      `
    : []
  const byModelId = new Map(idRows.map((r) => [r.model_id, r]))

  const rows = events.map((e) => {
    const offer = e.modelId ? byModelId.get(e.modelId) : undefined
    return {
      run_id: runId,
      kind: e.kind,
      canonical_model_id: e.canonicalId ?? offer?.canonical_model_id ?? null,
      model_id: offer?.id ?? null,
      details: sql.json(e.details as never),
    }
  })

  await sql`insert into monitoring_events ${sql(rows)}`
  return rows.length
}
