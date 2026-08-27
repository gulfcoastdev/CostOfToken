import { sql } from '@/lib/db.ts'
import type { ProviderType } from '@/lib/types.ts'

/**
 * Comparison engine (011): which seller of a canonical model is cheapest
 * for a given workload, and by how much versus going to the vendor direct.
 *
 * Rules that keep the answer honest:
 *  - only standard-tier offers compete (the catalogue's comparability rule);
 *  - an offer is priced only on fields it publishes — a missing number is
 *    never treated as zero, it moves the offer to the unpriced list;
 *  - zero is a real price and can win.
 */

export interface Offer {
  providerSlug: string
  providerName: string
  providerType: ProviderType
  modelId: string
  displayName: string
  offerTier: string
  offerRegion: string | null
  inputPrice: number | null
  cachedInputPrice: number | null
  outputPrice: number | null
}

export interface OfferWorkload {
  /** Tokens per period; costs come out in USD for the same period. */
  inputTokens: number
  outputTokens: number
}

export interface PricedOffer {
  offer: Offer
  cost: number
  /** Fraction saved vs the vendor-direct offer; null when there is none. */
  savingsVsVendor: number | null
}

export interface RankedOffers {
  /** Cheapest first. */
  priced: PricedOffer[]
  /** Standard-tier offers missing a price the workload needs. */
  unpriced: Offer[]
  /** What the vendor's own standard offer costs, when one is priced. */
  vendorDirectCost: number | null
}

function workloadCost(offer: Offer, workload: OfferWorkload): number | null {
  const needsInput = workload.inputTokens > 0
  const needsOutput = workload.outputTokens > 0
  if (needsInput && offer.inputPrice === null) return null
  if (needsOutput && offer.outputPrice === null) return null

  return (
    ((offer.inputPrice ?? 0) * workload.inputTokens +
      (offer.outputPrice ?? 0) * workload.outputTokens) /
    1_000_000
  )
}

/** Rank one canonical model's offers for a workload. */
export function rankOffers(offers: Offer[], workload: OfferWorkload): RankedOffers {
  const standard = offers.filter((o) => o.offerTier === 'standard')

  const priced: Array<{ offer: Offer; cost: number }> = []
  const unpriced: Offer[] = []
  for (const offer of standard) {
    const cost = workloadCost(offer, workload)
    if (cost === null) unpriced.push(offer)
    else priced.push({ offer, cost })
  }
  // Deterministic order all the way down. Equal-cost ties flapping with SQL
  // row order manufactured 59 phantom cheapest_flip events in one run: the
  // vendor wins ties (switching sellers for $0.00 savings is not a
  // recommendation), remaining ties settle alphabetically.
  const typeRank: Record<string, number> = { vendor: 0, cloud: 1, router: 2 }
  priced.sort(
    (a, b) =>
      a.cost - b.cost ||
      (typeRank[a.offer.providerType] ?? 3) - (typeRank[b.offer.providerType] ?? 3) ||
      a.offer.providerSlug.localeCompare(b.offer.providerSlug),
  )

  const vendorDirect = priced.find((p) => p.offer.providerType === 'vendor')
  const vendorDirectCost = vendorDirect?.cost ?? null

  return {
    priced: priced.map((p) => ({
      ...p,
      savingsVsVendor:
        vendorDirectCost !== null && vendorDirectCost > 0
          ? Math.round((1 - p.cost / vendorDirectCost) * 10_000) / 10_000
          : null,
    })),
    unpriced,
    vendorDirectCost,
  }
}

/** The cheapest standard-tier offer, or null when nothing is priceable. */
export function cheapestOffer(
  offers: Offer[],
  workload: OfferWorkload,
): PricedOffer | null {
  return rankOffers(offers, workload).priced[0] ?? null
}

/**
 * All active offers of one canonical model, by slug. Plain read (no data
 * cache) — callers that need caching wrap it at the query layer alongside
 * the existing cached reads.
 */
export async function getOffersForCanonical(slug: string): Promise<Offer[]> {
  return await sql<Offer[]>`
    select p.slug          as "providerSlug",
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
     where cm.slug = ${slug}
     order by p.slug
  `
}
