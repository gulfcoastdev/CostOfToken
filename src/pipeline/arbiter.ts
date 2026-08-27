import { z } from 'zod'
import { hasJudgeKey, openrouterChat } from './llm.ts'
import type { NormalizedModel } from '@/lib/types.ts'
import type { Anomaly, BaselineModel } from './anomaly.ts'

/**
 * LLM arbiter for price changes (spec 010).
 *
 * The deterministic extractors are correct until a vendor restructures a
 * page, and then they are wrong *plausibly* — the 2026-08-22 incident wrote
 * audio-token rates as text prices for 14 models while the scraped evidence
 * row literally said "Audio". This module judges each price *change* before
 * it is written, using exactly the evidence the run already has in hand.
 *
 * Two hard limits on its authority, by design:
 *  - it never authors a number — its only powers are "let the parsed value
 *    through" and "hold the stored value";
 *  - it can never take the pipeline down — every failure mode (no key, API
 *    error, malformed response, oversized change set) degrades to today's
 *    behaviour plus a note in the alert. `arbitrate` does not throw.
 */

export interface PriceFields {
  inputPrice: number | null
  cachedInputPrice: number | null
  outputPrice: number | null
}

export interface PriceChange {
  modelId: string
  stored: PriceFields
  parsed: PriceFields
  /** JSON of the scraped raw evidence, capped — see EVIDENCE_CHARS. */
  evidence: string
}

export interface ArbiterVerdict {
  modelId: string
  verdict: 'real' | 'misread' | 'unclear'
  reason: string
  /**
   * The judge's own certainty. Only a high-confidence "real" is applied;
   * doubt informs the operator instead of moving a published number.
   */
  confidence: 'high' | 'low'
}

/**
 * The judgment call, injected so every decision path is testable without a
 * network. `null` means "no usable verdicts" — the caller degrades gracefully.
 */
export type Judge = (systemPrompt: string, payload: string) => Promise<ArbiterVerdict[] | null>

export interface ArbiterOutcome {
  /** Model ids whose price rows must keep their stored values. */
  holds: Set<string>
  /** arbiter_hold / arbiter_note entries, ready for ProviderResult.anomalies. */
  anomalies: Anomaly[]
}

/**
 * One request judges at most this many changes. A whole-catalogue repricing
 * is exactly when a blanket hold would be wrongest, so the overflow is
 * written unjudged and said out loud rather than truncated silently.
 */
export const MAX_JUDGED = 40

/** Per-model evidence budget; beyond this the JSON is cut with a marker. */
const EVIDENCE_CHARS = 2_000

/** Page-text budget for the whole request. */
export const PAGE_TEXT_CHARS = 30_000

/**
 * Existing models whose headline price fields moved. New models are not
 * arbitrated (nothing stored to hold), and metadata-only updates never reach
 * here. Comparison basis is the three fields the baseline query returns —
 * the same basis anomaly detection uses.
 */
export function diffChanges(
  baseline: BaselineModel[],
  parsed: NormalizedModel[],
): PriceChange[] {
  const byId = new Map(baseline.map((m) => [m.modelId, m]))
  const changes: PriceChange[] = []

  for (const model of parsed) {
    const before = byId.get(model.modelId)
    if (!before) continue

    const stored: PriceFields = {
      inputPrice: before.inputPrice,
      cachedInputPrice: before.cachedInputPrice,
      outputPrice: before.outputPrice,
    }
    const next: PriceFields = {
      inputPrice: model.pricing.inputPrice,
      cachedInputPrice: model.pricing.cachedInputPrice,
      outputPrice: model.pricing.outputPrice,
    }

    if (
      stored.inputPrice === next.inputPrice &&
      stored.cachedInputPrice === next.cachedInputPrice &&
      stored.outputPrice === next.outputPrice
    ) {
      continue
    }

    changes.push({
      modelId: model.modelId,
      stored,
      parsed: next,
      evidence: capJson(model.pricing.raw),
    })
  }

  return changes
}

function capJson(value: unknown): string {
  const json = value === undefined ? 'null' : JSON.stringify(value)
  return json.length > EVIDENCE_CHARS ? `${json.slice(0, EVIDENCE_CHARS)}…[truncated]` : json
}

const SYSTEM_PROMPT = `You judge price changes scraped from LLM vendors' pricing pages before they are published on a price-comparison site.

The site's prices are USD per 1,000,000 TEXT tokens, STANDARD tier (never batch, flex, priority, audio, image, per-character, or per-hour rates). For each submitted change you receive the currently stored prices, the newly parsed prices, and the raw scraped evidence (table headers, row cells, labels) the parser read — plus, when available, an excerpt of the source page.

Classify each change:
- "real": the vendor genuinely changed this price; the evidence supports the new value as a standard per-1M-text-token rate.
- "misread": the parser read the wrong thing — a different modality's row (e.g. the row says Audio or Image), a different tier (batch/flex/priority, often an exact 0.25x/0.5x/2x/4x multiple), a different unit (per character, per minute, per image, per hour), or the wrong column. Say which, quoting the evidence.
- "unclear": the evidence does not show enough to decide.

Also state your confidence in the verdict:
- "high": the evidence clearly and directly supports it — you can point at the cell or row that proves it.
- "low": you are inferring or the evidence is ambiguous.

Only a high-confidence "real" verdict is applied automatically; everything else is held for a human. Be honest about doubt.

Judge every change you are given, by its exact modelId. Reasons must be one line.`

/**
 * Judge a change set. Never throws; an unusable judge or response degrades
 * to "write everything, say so".
 */
export async function arbitrate(
  changes: PriceChange[],
  judge: Judge | null,
  pageText?: string | null,
): Promise<ArbiterOutcome> {
  if (changes.length === 0) return { holds: new Set(), anomalies: [] }

  if (!judge) {
    return {
      holds: new Set(),
      anomalies: [
        note(
          `arbiter unavailable (no OPEN_ROUTER_API_KEY); ${changes.length} change(s) written unjudged`,
        ),
      ],
    }
  }

  const judged = changes.slice(0, MAX_JUDGED)
  const overflow = changes.length - judged.length

  const payload = JSON.stringify({
    pageExcerpt: pageText ? pageText.slice(0, PAGE_TEXT_CHARS) : undefined,
    changes: judged,
  })

  let verdicts: ArbiterVerdict[] | null = null
  try {
    verdicts = await judge(SYSTEM_PROMPT, payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      holds: new Set(),
      anomalies: [
        note(`arbiter unavailable (${message}); ${changes.length} change(s) written unjudged`),
      ],
    }
  }

  if (!verdicts) {
    return {
      holds: new Set(),
      anomalies: [
        note(`arbiter returned no usable verdicts; ${changes.length} change(s) written unjudged`),
      ],
    }
  }

  const changeById = new Map(judged.map((c) => [c.modelId, c]))
  const holds = new Set<string>()
  const anomalies: Anomaly[] = []
  const covered = new Set<string>()

  for (const v of verdicts) {
    const change = changeById.get(v.modelId)
    // A verdict on a model this run didn't change judges nothing we asked
    // about — hallucinated ids must not hold anything.
    if (!change || covered.has(v.modelId)) continue
    covered.add(v.modelId)

    if (v.verdict === 'real' && v.confidence === 'high') {
      // Applied — and the operator is told why, per decision, not in bulk.
      anomalies.push(note(`${v.modelId}: applied — ${v.reason}`))
      continue
    }

    const label = v.verdict === 'real' ? 'real (low confidence)' : v.verdict
    holds.add(v.modelId)
    anomalies.push({
      code: 'arbiter_hold',
      severity: 'warn',
      message: `${v.modelId}: ${label} — ${v.reason}`,
      details: {
        verdict: v.verdict,
        reason: v.reason,
        models: [
          {
            modelId: v.modelId,
            before: change.stored.inputPrice,
            after: change.parsed.inputPrice,
            ratio: ratio(change.stored.inputPrice, change.parsed.inputPrice),
          },
        ],
      },
    })
  }

  // Silence from the judge is not judgment: an uncovered change is written.
  const uncovered = judged.length - covered.size
  if (uncovered > 0) {
    anomalies.push(note(`arbiter left ${uncovered} of ${judged.length} change(s) unjudged; written as-is`))
  }
  if (overflow > 0) {
    anomalies.push(
      note(`arbiter judged ${judged.length} of ${changes.length} changes; ${overflow} written unjudged`),
    )
  }

  return { holds, anomalies }
}

function note(message: string): Anomaly {
  return { code: 'arbiter_note', severity: 'warn', message, details: {} }
}

function ratio(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before === 0) return null
  return Math.round((after / before) * 10_000) / 10_000
}

const VERDICT_SCHEMA = z.object({
  verdicts: z.array(
    z.object({
      modelId: z.string(),
      verdict: z.enum(['real', 'misread', 'unclear']),
      reason: z.string(),
      confidence: z.enum(['high', 'low']),
    }),
  ),
})

const VERDICT_WIRE_SCHEMA = {
  name: 'price_change_verdicts',
  schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            modelId: { type: 'string' },
            verdict: { type: 'string', enum: ['real', 'misread', 'unclear'] },
            reason: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'low'] },
          },
          required: ['modelId', 'verdict', 'reason', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['verdicts'],
    additionalProperties: false,
  },
} as const

/**
 * The arbiter's judge over the shared OpenRouter client (llm.ts — DeepSeek
 * by default). Returns null when unconfigured so the whole feature is off
 * (today's behaviour) without a key.
 */
export function createOpenRouterJudge(): Judge | null {
  if (!hasJudgeKey()) return null

  return async (systemPrompt, payload) => {
    const raw = await openrouterChat(systemPrompt, payload, VERDICT_WIRE_SCHEMA)
    if (raw === null) return null
    const parsed = VERDICT_SCHEMA.safeParse(raw)
    return parsed.success ? parsed.data.verdicts : null
  }
}
