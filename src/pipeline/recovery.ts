import { z } from 'zod'
import { sql } from '@/lib/db.ts'
import type { NormalizedModel } from '@/lib/types.ts'
import type { BaselineModel } from './anomaly.ts'
import { hasJudgeKey, openrouterChat } from './llm.ts'

/**
 * LLM source recovery (012).
 *
 * When a provider's parser fails but the page was fetched, the judge
 * (DeepSeek via the shared OpenRouter client) reads the page, the
 * remembered structure of this source, and the provider's last known
 * models, and derives current prices itself. This is the operator's
 * "bit of both, trending to self-driving": deterministic parsers stay the
 * cheap fast path; the LLM takes over exactly when they break.
 *
 * Trust rules, in code rather than hope:
 *  - derivations only enter through the NORMAL pipeline (validation +
 *    anomaly gates) with `llm` provenance — never a bypass;
 *  - a derived model whose id is not literally present in the page text is
 *    dropped (memory of a vendor is not evidence);
 *  - low confidence or judge failure returns nothing to write, which is
 *    exactly today's failure behaviour.
 */

export interface RecoveryInput {
  providerSlug: string
  pricingUrl: string
  pageText: string
  baseline: BaselineModel[]
  rememberedStructure: string | null
}

export interface RecoveryOutcome {
  models: NormalizedModel[]
  structure: string
  structureChanged: boolean
  changeAccount: string
  confidence: 'high' | 'low'
}

/** Injected chat call; production default wraps llm.ts. */
export type RecoveryChat = (systemPrompt: string, payload: string) => Promise<unknown | null>

const RESULT_SCHEMA = z.object({
  structure: z.string(),
  structureChanged: z.boolean(),
  changeAccount: z.string(),
  confidence: z.enum(['high', 'low']),
  models: z.array(
    z.object({
      modelId: z.string(),
      displayName: z.string().optional(),
      inputPrice: z.number().nullable(),
      cachedInputPrice: z.number().nullable(),
      outputPrice: z.number().nullable(),
      currency: z.string().optional(),
    }),
  ),
})

const RESULT_WIRE_SCHEMA = {
  name: 'source_recovery',
  schema: {
    type: 'object',
    properties: {
      structure: { type: 'string' },
      structureChanged: { type: 'boolean' },
      changeAccount: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'low'] },
      models: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            modelId: { type: 'string' },
            displayName: { type: 'string' },
            inputPrice: { type: ['number', 'null'] },
            cachedInputPrice: { type: ['number', 'null'] },
            outputPrice: { type: ['number', 'null'] },
            currency: { type: 'string' },
          },
          required: ['modelId', 'inputPrice', 'cachedInputPrice', 'outputPrice'],
          additionalProperties: false,
        },
      },
    },
    required: ['structure', 'structureChanged', 'changeAccount', 'confidence', 'models'],
    additionalProperties: false,
  },
} as const

const SYSTEM_PROMPT = `A deterministic parser for an AI-model price catalogue has FAILED on this provider's pricing source. You are the recovery judge: read the fetched source text and derive the current prices yourself.

Rules:
- Derive ONLY models whose ids you can literally see in the source text, with the prices the text states. Never add a model from memory of the vendor — the known-models list is matching context, not a template to fill.
- Prices are USD per 1,000,000 TEXT tokens, standard tier (never batch/flex/priority/audio/image/per-character rates). Convert stated units (per-1K, per-token) yourself; state currency if not USD.
- A price the text does not state is null. Zero means the text says free.
- Describe the source's current structure in a few sentences (sections, tables, field names) — this is remembered and shown to the next recovery and to the human reworking the parser. If a prior structure description is provided, say what changed.
- confidence "high" ONLY if you are certain the derived prices are the standard per-token rates as stated by the text. Anything ambiguous — mixed tiers, truncated page, rendered-app shell without prices — is "low" with an explanatory changeAccount and no or partial models.`

const clean = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 1e6) / 1e6 : null

/**
 * Pure derivation step: page + memory + baseline → outcome, via the judge.
 * Null means nothing usable (no page, no key, judge failed) — the caller
 * runs today's failure path unchanged.
 */
export async function deriveFromSource(
  input: RecoveryInput,
  chat: RecoveryChat = (system, payload) => openrouterChat(system, payload, RESULT_WIRE_SCHEMA),
): Promise<RecoveryOutcome | null> {
  if (!input.pageText.trim()) return null

  const payload = JSON.stringify({
    provider: input.providerSlug,
    rememberedStructure: input.rememberedStructure,
    knownModels: input.baseline.map((m) => ({
      modelId: m.modelId,
      inputPrice: m.inputPrice,
      cachedInputPrice: m.cachedInputPrice,
      outputPrice: m.outputPrice,
    })),
    sourceText: input.pageText,
  })

  let raw: unknown
  try {
    raw = await chat(SYSTEM_PROMPT, payload)
  } catch {
    return null
  }
  if (raw === null || raw === undefined) return null

  const parsed = RESULT_SCHEMA.safeParse(raw)
  if (!parsed.success) return null
  const result = parsed.data

  const pageLower = input.pageText.toLowerCase()
  const models: NormalizedModel[] = []
  for (const m of result.models) {
    // Evidence check: memory of a vendor is not evidence. An id absent from
    // the page is dropped even at high confidence.
    if (!m.modelId || !pageLower.includes(m.modelId.toLowerCase())) continue

    models.push({
      providerSlug: input.providerSlug,
      modelId: m.modelId,
      displayName: m.displayName || m.modelId,
      contextWindow: null,
      maxOutputTokens: null,
      longContextThreshold: null,
      modality: ['text'],
      description: null,
      tags: [],
      isActive: true,
      pricing: {
        inputPrice: clean(m.inputPrice),
        cachedInputPrice: clean(m.cachedInputPrice),
        outputPrice: clean(m.outputPrice),
        longInputPrice: null,
        longCachedInputPrice: null,
        longOutputPrice: null,
        currency: m.currency || 'USD',
        sourceUrl: input.pricingUrl,
        sourceKind: 'llm',
        raw: { recovery: true, derived: m },
      },
    })
  }

  return {
    models,
    structure: result.structure,
    structureChanged: result.structureChanged,
    changeAccount: result.changeAccount,
    confidence: result.confidence,
  }
}

export function recoveryAvailable(): boolean {
  return hasJudgeKey()
}

/** The remembered structure memo for a provider, or null on first sight. */
export async function getStructureMemo(providerSlug: string): Promise<string | null> {
  const rows = await sql<Array<{ structure: string }>>`
    select structure from source_structures where provider_slug = ${providerSlug}
  `
  return rows[0]?.structure ?? null
}

/** Upsert the memo after a recovery. Healthy runs never call this. */
export async function saveStructureMemo(
  providerSlug: string,
  structure: string,
  changeAccount: string,
): Promise<void> {
  await sql`
    insert into source_structures (provider_slug, structure, change_account, updated_at)
    values (${providerSlug}, ${structure}, ${changeAccount || null}, now())
    on conflict (provider_slug) do update set
      structure = excluded.structure,
      change_account = excluded.change_account,
      updated_at = now()
  `
}
