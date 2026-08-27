import type { Modality, NormalizedModel } from '@/lib/types.ts'
import { cleanDescription, inferTags } from '../normalize.ts'
import type { Extractor, ExtractorContext } from './types.ts'

const SOURCE_URL = 'https://openrouter.ai/api/v1/models'

/**
 * Secondary source for providers whose own pricing pages are not machine
 * readable (client-rendered consoles, mainland-only docs, moved URLs).
 *
 * IMPORTANT: OpenRouter is a reseller, not the vendor. Its quoted price can
 * differ from first-party pricing — at time of writing it lists GLM-5.2 at
 * $0.76/1M input where Zhipu's own page says $1.40/1M. Rows produced here are
 * therefore tagged `source_kind: 'api'` with a source_url pointing at
 * OpenRouter so the UI can disclose the provenance, and the runner only falls
 * back to them for providers that have no first-party extractor.
 */

interface OpenRouterModel {
  id: string
  name?: string
  description?: string | null
  context_length?: number | null
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  top_provider?: { max_completion_tokens?: number | null }
  pricing?: {
    prompt?: string
    completion?: string
    input_cache_read?: string
  }
}

let cache: Promise<OpenRouterModel[]> | null = null

/** Clear the per-run memo so a long-lived process re-fetches on the next run. */
export function resetOpenRouterCache(): void {
  cache = null
}

function loadCatalogue(ctx: ExtractorContext): Promise<OpenRouterModel[]> {
  if (!cache) {
    cache = ctx
      .fetchText(SOURCE_URL)
      .then((body) => {
        const parsed = JSON.parse(body) as { data?: OpenRouterModel[] }
        return Array.isArray(parsed.data) ? parsed.data : []
      })
      .catch((error: unknown) => {
        cache = null // let the next provider retry rather than inherit the failure
        throw error
      })
  }
  return cache
}

/**
 * Build an extractor for one provider, selecting models by the vendor prefix
 * OpenRouter uses in its ids (e.g. "deepseek/deepseek-v4-pro").
 */
export function createOpenRouterExtractor(providerSlug: string, vendors: string[]): Extractor {
  return {
    providerSlug,
    sourceKind: 'api',
    sourceUrl: SOURCE_URL,

    async extract(ctx): Promise<NormalizedModel[]> {
      const all = await loadCatalogue(ctx)
      const models = new Map<string, NormalizedModel>()

      for (const entry of all) {
        if (!entry.id) continue

        const [vendor, ...rest] = entry.id.split('/')
        // A leading "~" marks OpenRouter's floating "latest" aliases.
        const normalizedVendor = vendor.replace(/^~/, '').toLowerCase()
        if (!vendors.includes(normalizedVendor)) continue

        const modelId = rest.join('/') || entry.id
        if (!modelId) continue
        if (isRoutingTier(modelId)) continue

        const input = perTokenToPerMillion(entry.pricing?.prompt)
        const output = perTokenToPerMillion(entry.pricing?.completion)
        if (input === null && output === null) continue

        const modality = toModalities(entry.architecture)
        const tags = new Set(inferTags(modelId, entry.name))
        // The catalogue states which inputs a model accepts, so the vision tag
        // here is declared rather than guessed from the name.
        if (modality.includes('vision')) tags.add('vision')

        models.set(modelId, {
          providerSlug,
          modelId,
          displayName: entry.name?.replace(/^[^:]+:\s*/, '') || modelId,
          description: cleanDescription(entry.description),
          contextWindow: entry.context_length ?? null,
          maxOutputTokens: entry.top_provider?.max_completion_tokens ?? null,
          longContextThreshold: null,
          modality,
          tags: [...tags].sort(),
          isActive: true,
          pricing: {
            inputPrice: input,
            cachedInputPrice: perTokenToPerMillion(entry.pricing?.input_cache_read),
            outputPrice: output,
            longInputPrice: null,
            longCachedInputPrice: null,
            longOutputPrice: null,
            currency: 'USD',
            sourceUrl: SOURCE_URL,
            sourceKind: 'api',
            raw: entry,
          },
        })
      }

      return [...models.values()]
    },
  }
}

/**
 * 011: OpenRouter as a provider in its own right (router type).
 *
 * The factory above borrows OpenRouter's catalogue to price a *vendor*; this
 * extractor ingests the whole catalogue as OpenRouter's own offers — the
 * price a router customer actually pays, listed beside the vendor's direct
 * offer under the same canonical model. Model ids stay in OpenRouter's full
 * form ("deepseek/deepseek-v4-pro") because that is the id its customers
 * use; the resolver, not the adapter, links them to canonical identities.
 */
export function createOpenRouterProviderExtractor(): Extractor {
  return {
    providerSlug: 'openrouter',
    sourceKind: 'api',
    sourceUrl: SOURCE_URL,

    async extract(ctx): Promise<NormalizedModel[]> {
      const all = await loadCatalogue(ctx)
      const models = new Map<string, NormalizedModel>()

      for (const entry of all) {
        if (!entry.id) continue
        // Floating "latest" aliases repoint silently; a row that changes
        // identity under a stable id would corrupt its price history.
        if (entry.id.startsWith('~')) continue
        // 014: :free is a real door people hunt for — a first-class offer,
        // parked in the free tier so $0 never enters the paid ranking.
        // :batch stays out: async billing on the same door, not a door.
        if (/:batch$/i.test(entry.id)) continue
        const isFree = /:free$/i.test(entry.id)

        const input = perTokenToPerMillion(entry.pricing?.prompt)
        const output = perTokenToPerMillion(entry.pricing?.completion)
        if (input === null && output === null) continue

        const modality = toModalities(entry.architecture)
        const tags = new Set(inferTags(entry.id, entry.name))
        if (modality.includes('vision')) tags.add('vision')

        models.set(entry.id, {
          providerSlug: 'openrouter',
          modelId: entry.id,
          displayName: entry.name || entry.id,
          description: cleanDescription(entry.description),
          contextWindow: entry.context_length ?? null,
          maxOutputTokens: entry.top_provider?.max_completion_tokens ?? null,
          longContextThreshold: null,
          modality,
          tags: [...tags].sort(),
          isActive: true,
          offerTier: isFree ? 'free' : 'standard',
          priceLayer: isFree ? 'free' : 'list',
          pricing: {
            inputPrice: input,
            cachedInputPrice: perTokenToPerMillion(entry.pricing?.input_cache_read),
            outputPrice: output,
            longInputPrice: null,
            longCachedInputPrice: null,
            longOutputPrice: null,
            currency: 'USD',
            sourceUrl: SOURCE_URL,
            sourceKind: 'api',
            raw: entry,
          },
        })
      }

      return [...models.values()]
    },
  }
}

/**
 * Routing tiers, which OpenRouter marks with a suffix on the model id.
 *
 * These are not separate models — they are the same model billed under a
 * different route, and their rates are not comparable to a vendor's standard
 * rate, which is the only thing this table publishes:
 *
 *  - `:batch` is asynchronous and typically half price. It arrives looking
 *    like an ordinary model, so nothing but this check keeps a half-price row
 *    out of a table of standard rates. `kimi-k2.7-code:batch` was published
 *    that way before this existed.
 *  - `:free` is a rate-limited free route, and usually has a paid twin in the
 *    catalogue — importing it lists the same model twice and claims one copy
 *    costs nothing, which breaks the promise that 0 means genuinely free.
 *
 * Capability variants such as `:thinking` are deliberately kept: those are
 * different models with their own real prices, not a discount on an existing
 * one.
 */
const ROUTING_TIER_SUFFIX = /:(batch|free)$/i

function isRoutingTier(modelId: string): boolean {
  return ROUTING_TIER_SUFFIX.test(modelId)
}

/** OpenRouter quotes USD per single token as a decimal string. */
function perTokenToPerMillion(value: string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  // Round to 6dp to match the numeric(12,6) column and avoid float dust
  // like 0.0000000799996 * 1e6 = 0.07999960000000001.
  return Math.round(numeric * 1_000_000 * 1e6) / 1e6
}

/** Declared by the catalogue, unlike the name-based inference used elsewhere. */
function toModalities(architecture: OpenRouterModel['architecture']): Modality[] {
  const all = [
    ...(architecture?.input_modalities ?? []),
    ...(architecture?.output_modalities ?? []),
  ].map((m) => m.toLowerCase())

  const modality = new Set<Modality>(['text'])
  if (all.includes('image')) modality.add('vision')
  if (all.includes('audio')) modality.add('audio')
  if (all.includes('video')) modality.add('video')
  return [...modality]
}
