# Implementation Plan: LLM Price-Change Arbiter

**Branch**: `010-llm-price-arbiter` | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

## Summary

One new module, `src/pipeline/arbiter.ts`, called from `runPipeline` between
anomaly detection and `upsertProviderModels`: diff the parsed models against
the provider baseline, send the changed set (old prices, new prices, raw
evidence, bounded provider page text) to Claude in a single
structured-output call, and get per-model verdicts. `real` → write as today;
`misread`/`unclear` → the model's price row is excluded from the upsert (all
six price fields keep their stored values; the model row itself still
updates). Verdicts are emitted as `Anomaly`-shaped entries on the existing
`ProviderResult.anomalies`, which means the alert email and `extraction_runs`
log render them with no changes to `alert.ts` or `upsert.ts` logging.

## Technical Context

**Language/Version**: TypeScript 5.7, Node 24, ESM, tsx

**Primary Dependencies**: ONE new runtime dependency — `@anthropic-ai/sdk`
(official SDK; justification: `client.messages.parse` + `zodOutputFormat`
gives schema-validated verdicts against the project's existing `zod`, typed
errors, retries and timeouts — a hand-rolled fetch would reimplement all of
that to save one package). Model: `claude-opus-5`, adaptive thinking
(default — no `thinking` param), `output_config.format` structured output.

**Storage**: no schema change. Held models simply skip the `prices` upsert;
verdicts ride the existing `anomalies` jsonb on `extraction_runs`.

**Testing**: `node --test`. The arbiter takes an injected `judge` function
(the LLM call) so all decision/plumbing logic is unit-testable without
network; the real Claude call lives in one thin function. Replay test for
the 2026-08-22 incident uses the existing fixture-driven change shape.

**Config**: `OPENAI_API_KEY` (SDK's standard variable). Unset → arbiter
off → today's behaviour + note. Client: `timeout` 60_000 ms (TS uses
milliseconds), `maxRetries: 1` (spec: one retry max).

**Constraints**: pipeline duration ceiling — the arbiter adds at most one
LLM call per provider *with changes* (typical day: 0–3), skipped entirely
when a provider has no changes, is blocked, or the run is dry. Evidence is
bounded: at most 40 changes judged per provider (rest fall back to
write-as-today + note), raw evidence ≤ 2KB per model, page text ≤ 30KB.

**Scale/Scope**: ~1 new module (~200 lines), ~30 lines touched in `run.ts`,
~10 in `upsert.ts` (skip-prices set), 2 codes added to `anomaly.ts` union.

## Key design decisions (research inlined — see research.md for alternatives)

1. **Verdicts as anomalies.** `arbiter_hold` (severity `warn`, one per held
   model, reason in message, `details.models` for the price listing) and
   `arbiter_note` (one per provider for real-summaries / unavailable / over-
   budget notes). `shouldAlert` already fires on any anomaly; `buildAlert`
   already renders code, message, and `details.models`. FR-006 with zero new
   surfaces.
2. **Hold = skip the price row.** `upsertProviderModels` gains an optional
   `holdPrices: Set<string>` — held models are filtered out of the `prices`
   insert only. All six stored price fields survive untouched, no
   `price_history` row fires, model metadata still refreshes. (Rejected:
   rewriting parsed values back to baseline — baseline carries only three
   fields, and writing equal values relies on the trigger for silence.)
3. **The changed-set diff lives in the arbiter module** (`diffChanges
   (baseline, parsed)`): existing models only (new models are not
   arbitrated), any of input/cached/output differing (the three fields the
   baseline query already returns — same comparison basis as `anomaly.ts`).
4. **Page text via a remembering ctx.** `runPipeline` wraps `ctx.fetchText`
   to retain the last fetched body per provider iteration (capped 30KB);
   passed to the arbiter as optional context. API-sourced providers
   (OpenRouter) get their JSON slice the same way.
5. **One thin real judge.** `createClaudeJudge()` returns
   `(prompt) => client.messages.parse(...)` with a zod verdict schema
   (`zodOutputFormat`). Everything else takes the judge as a parameter.
   Failure of any kind (missing key, API error after the SDK's 1 retry,
   `parsed_output` null, verdict for unknown model, missing coverage) →
   uncovered changes written as today + `arbiter_note`. The arbiter can
   *never* throw out of `arbitrate()`.
6. **Prompt shape.** System prompt states the catalogue's comparison rule
   (USD per 1M text tokens, standard tier) and the known failure taxonomy
   (wrong tier/modality/unit/row); user content is compact JSON: per change
   `{modelId, stored: {...}, parsed: {...}, evidence: raw}` + optional page
   excerpt. Verdict schema: `{verdicts: [{modelId, verdict: 'real'|'misread'
   |'unclear', reason}]}` with `additionalProperties` constraints via zod.

## Constitution Check

Noted for the record (the operator has explicitly prioritized effectiveness;
the design happens to comply anyway): the LLM never authors a price — its
only powers are pass-through and hold (Principle I); judge is injected so
logic is unit-tested (II, III); the one new dependency is justified above
(V); no public surface changes (VI); vendor text sent outbound is already
redacted/bounded by existing alert cleaning, and the arbiter's inputs stay
server-side (VII). Test-first applies to every behavior below.

## Project Structure

```text
src/pipeline/arbiter.ts        # NEW: diffChanges, arbitrate, createClaudeJudge, verdict schema
src/pipeline/run.ts            # call arbiter before upsert; remembering fetchText wrapper
src/pipeline/upsert.ts         # upsertProviderModels(..., holdPrices?)
src/pipeline/anomaly.ts        # AnomalyCode union += 'arbiter_hold' | 'arbiter_note'
tests/arbiter.test.ts          # NEW: unit tests incl. 2026-08-22 replay
specs/010-llm-price-arbiter/   # spec, plan, research, data-model, quickstart, tasks
```

No `contracts/` — no externally consumable interface changes.
