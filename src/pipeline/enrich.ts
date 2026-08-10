import type { NormalizedModel } from '@/lib/types.ts'
import { MODEL_OVERRIDES, type ModelOverride } from '../../data/overrides.ts'
import type { ExtractorContext } from './extractors/types.ts'

/**
 * Post-extraction enrichment.
 *
 * Vendor pricing pages list prices but usually not context windows, so those
 * are filled in from two places, in increasing order of authority:
 *
 *   1. A secondary catalogue (OpenRouter), matched on exact normalised model
 *      id. Only *metadata* is taken from it — never a price. Prices stay
 *      first-party.
 *   2. data/overrides.json, hand-curated, which wins over everything.
 *
 * Matching is exact-after-normalisation on purpose. Fuzzy matching across
 * vendors silently attaches one model's context window to another, which is
 * worse than leaving the field null.
 */

const METADATA_SOURCE = 'https://openrouter.ai/api/v1/models'

interface MetadataEntry {
  contextWindow: number | null
  maxOutputTokens: number | null
}

/** Strip punctuation and case so "GPT-5.6 Sol" and "gpt-5.6-sol" compare equal. */
export function normalizeKey(providerSlug: string, modelId: string): string {
  return `${providerSlug}:${modelId.toLowerCase().replace(/[^a-z0-9]/g, '')}`
}

async function loadMetadataCatalogue(
  ctx: ExtractorContext,
): Promise<Map<string, MetadataEntry>> {
  const index = new Map<string, MetadataEntry>()

  const body = await ctx.fetchText(METADATA_SOURCE)
  const parsed = JSON.parse(body) as {
    data?: Array<{
      id: string
      name?: string
      context_length?: number | null
      top_provider?: { max_completion_tokens?: number | null }
    }>
  }

  for (const entry of parsed.data ?? []) {
    if (!entry.id) continue
    const [vendor, ...rest] = entry.id.split('/')
    const modelId = rest.join('/')
    if (!modelId) continue

    const slug = VENDOR_TO_SLUG[vendor.replace(/^~/, '').toLowerCase()]
    if (!slug) continue

    const metadata: MetadataEntry = {
      contextWindow: entry.context_length ?? null,
      maxOutputTokens: entry.top_provider?.max_completion_tokens ?? null,
    }

    // Index under the model id and, separately, its display name, since
    // vendors that publish only display names (Anthropic) need the latter.
    index.set(normalizeKey(slug, modelId), metadata)
    if (entry.name) {
      const displayOnly = entry.name.replace(/^[^:]+:\s*/, '')
      const key = normalizeKey(slug, displayOnly)
      if (!index.has(key)) index.set(key, metadata)
    }
  }

  return index
}

const VENDOR_TO_SLUG: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  'x-ai': 'xai',
  xai: 'xai',
  deepseek: 'deepseek',
  qwen: 'alibaba',
  alibaba: 'alibaba',
  moonshotai: 'moonshot',
  moonshot: 'moonshot',
  'z-ai': 'zhipu',
  zhipu: 'zhipu',
  bytedance: 'bytedance',
  baidu: 'baidu',
}

const OVERRIDE_INDEX = new Map<string, ModelOverride>(
  MODEL_OVERRIDES.map((entry) => [normalizeKey(entry.provider, entry.model_id), entry]),
)

export interface EnrichmentReport {
  metadataSourceOk: boolean
  contextWindowsFilled: number
  overridesApplied: number
  error?: string
}

export async function enrichModels(
  models: NormalizedModel[],
  ctx: ExtractorContext,
): Promise<{ models: NormalizedModel[]; report: EnrichmentReport }> {
  const report: EnrichmentReport = {
    metadataSourceOk: false,
    contextWindowsFilled: 0,
    overridesApplied: 0,
  }

  let catalogue = new Map<string, MetadataEntry>()
  const needsMetadata = models.some((m) => m.contextWindow === null)

  if (needsMetadata) {
    try {
      catalogue = await loadMetadataCatalogue(ctx)
      report.metadataSourceOk = true
    } catch (error) {
      // Enrichment is best-effort; a missing context window must never fail a
      // run that produced good prices.
      report.error = error instanceof Error ? error.message : String(error)
    }
  }

  const enriched = models.map((model) => {
    const key = normalizeKey(model.providerSlug, model.modelId)
    let next = model

    if (next.contextWindow === null || next.maxOutputTokens === null) {
      const metadata =
        catalogue.get(key) ?? catalogue.get(normalizeKey(model.providerSlug, model.displayName))
      if (metadata) {
        const contextWindow = next.contextWindow ?? metadata.contextWindow
        if (contextWindow !== next.contextWindow) report.contextWindowsFilled++
        next = {
          ...next,
          contextWindow,
          maxOutputTokens: next.maxOutputTokens ?? metadata.maxOutputTokens,
        }
      }
    }

    const override = OVERRIDE_INDEX.get(key)
    if (override) {
      report.overridesApplied++
      next = {
        ...next,
        displayName: override.display_name ?? next.displayName,
        contextWindow: override.context_window ?? next.contextWindow,
        maxOutputTokens: override.max_output_tokens ?? next.maxOutputTokens,
        longContextThreshold: override.long_context_threshold ?? next.longContextThreshold,
        modality: override.modality ?? next.modality,
        tags: override.tags ?? next.tags,
        isActive: override.is_active ?? next.isActive,
      }
    }

    return next
  })

  return { models: enriched, report }
}
