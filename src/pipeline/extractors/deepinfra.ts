import type { NormalizedModel } from '@/lib/types.ts'
import { cleanDescription, inferModality, inferTags } from '../normalize.ts'
import type { Extractor } from './types.ts'

const SOURCE_URL = 'https://api.deepinfra.com/models/list'
const PAGE_URL = 'https://deepinfra.com/pricing'

/**
 * DeepInfra (011 C2): an inference host with a public, unauthenticated JSON
 * catalogue — the best kind of source, no HTML to break.
 *
 * Prices arrive as US *cents per single token* (`cents_per_input_token`
 * 9e-06 = $0.09/1M). The cached rate is a multiplier on the input price,
 * not a price. Only `pricing.type === 'tokens'` entries are comparable to
 * the per-1M-token catalogue; per-image/video/second rates stay out, as do
 * deprecated models.
 */

interface DeepInfraModel {
  model_name?: string
  type?: string
  description?: string | null
  max_tokens?: number | null
  deprecated?: number | null
  pricing?: {
    type?: string
    cents_per_input_token?: number
    cents_per_output_token?: number
    rate_per_input_token_cached?: number | null
    /** Declared discount multiplier; the one price set is the charged one. */
    discount?: number | null
    discount_ends_at?: string | null
  }
}

/**
 * 014: promo only when the seller DECLARES it, and only while the seller's
 * own end date (if any) is in the future. A low price is never inferred to
 * be a promotion.
 */
function promoLayer(pricing: NonNullable<DeepInfraModel['pricing']>): {
  priceLayer: 'list' | 'promo'
  promoEndsAt: string | null
} {
  if (typeof pricing.discount !== 'number' || pricing.discount <= 0) {
    return { priceLayer: 'list', promoEndsAt: null }
  }
  const ends = pricing.discount_ends_at ?? null
  if (ends && Date.parse(ends) <= Date.now()) return { priceLayer: 'list', promoEndsAt: null }
  return { priceLayer: 'promo', promoEndsAt: ends }
}

/** cents/token → USD per 1M tokens, rounded to the numeric(12,6) column. */
function centsPerTokenToPerMillion(cents: number | undefined): number | null {
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents < 0) return null
  return Math.round(cents * 10_000 * 1e6) / 1e6
}

export const deepinfraExtractor: Extractor = {
  providerSlug: 'deepinfra',
  sourceKind: 'api',
  sourceUrl: SOURCE_URL,

  async extract(ctx): Promise<NormalizedModel[]> {
    const body = await ctx.fetchText(SOURCE_URL)
    const parsed = JSON.parse(body) as DeepInfraModel[]
    if (!Array.isArray(parsed)) return []

    const models = new Map<string, NormalizedModel>()

    for (const entry of parsed) {
      const modelId = entry.model_name
      if (!modelId) continue
      if (entry.deprecated) continue
      if (entry.pricing?.type !== 'tokens') continue

      const input = centsPerTokenToPerMillion(entry.pricing.cents_per_input_token)
      const output = centsPerTokenToPerMillion(entry.pricing.cents_per_output_token)
      if (input === null && output === null) continue

      const cachedRate = entry.pricing.rate_per_input_token_cached
      const cached =
        input !== null && typeof cachedRate === 'number' && cachedRate > 0
          ? Math.round(input * cachedRate * 1e6) / 1e6
          : null

      const { priceLayer, promoEndsAt } = promoLayer(entry.pricing)

      models.set(modelId, {
        providerSlug: 'deepinfra',
        modelId,
        displayName: modelId,
        description: cleanDescription(entry.description),
        contextWindow: entry.max_tokens ?? null,
        maxOutputTokens: null,
        longContextThreshold: null,
        modality: inferModality(modelId),
        tags: inferTags(modelId),
        isActive: true,
        priceLayer,
        promoEndsAt,
        pricing: {
          inputPrice: input,
          cachedInputPrice: cached,
          outputPrice: output,
          longInputPrice: null,
          longCachedInputPrice: null,
          longOutputPrice: null,
          currency: 'USD',
          sourceUrl: PAGE_URL,
          sourceKind: 'api',
          raw: entry,
        },
      })
    }

    return [...models.values()]
  },
}
