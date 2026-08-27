# Data Model: LLM Price-Change Arbiter

No database schema changes. New TypeScript shapes (all in
`src/pipeline/arbiter.ts` unless noted):

```ts
interface PriceChange {
  modelId: string
  stored: { inputPrice: number | null; cachedInputPrice: number | null; outputPrice: number | null }
  parsed: { inputPrice: number | null; cachedInputPrice: number | null; outputPrice: number | null }
  evidence: unknown          // NormalizedModel.pricing.raw, JSON-capped at 2KB
}

type Verdict = 'real' | 'misread' | 'unclear'

interface ArbiterVerdict { modelId: string; verdict: Verdict; reason: string }

interface ArbiterOutcome {
  holds: Set<string>         // modelIds to exclude from the prices upsert
  anomalies: Anomaly[]       // arbiter_hold / arbiter_note entries, ready for ProviderResult
}

type Judge = (systemPrompt: string, payload: string) => Promise<ArbiterVerdict[] | null>
// null = unavailable/malformed; arbitrate() maps null to "write all + note"
```

Zod schema for the LLM response (used with `zodOutputFormat`):
`{ verdicts: Array<{ modelId: string; verdict: enum; reason: string }> }`.

## Changed signatures

- `upsertProviderModels(providerId, models, holdPrices?: Set<string>)`
  (`src/pipeline/upsert.ts`) — held ids skip only the `prices` insert.
- `AnomalyCode` (`src/pipeline/anomaly.ts`) += `'arbiter_hold' | 'arbiter_note'`.

## Anomaly payloads

- `arbiter_hold` — severity `warn`, one per held model.
  `message`: `"<modelId>: <verdict> — <reason>"`;
  `details`: `{ verdict, models: [{ modelId, before, after, ratio }] }`
  (the `models` array reuses `buildAlert`'s existing per-model rendering).
- `arbiter_note` — severity `warn`, one per provider when relevant.
  `message`: e.g. `"arbiter judged 5 changes real"`,
  `"arbiter unavailable (no OPENAI_API_KEY); 21 changes written unjudged"`,
  `"arbiter judged 40 of 57 changes; 17 written unjudged"`.

## Invariants

- `holds ⊆ {changed modelIds}`; a held model appears in exactly one
  `arbiter_hold` anomaly.
- The arbiter never mutates `NormalizedModel` values — parsed prices reach
  the upsert byte-identical or not at all (FR-005).
- With `holds` empty and judge unavailable, the upsert call is identical to
  today's (SC-002).
