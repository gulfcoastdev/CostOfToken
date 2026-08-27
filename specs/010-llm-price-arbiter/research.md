# Research: LLM Price-Change Arbiter

## D1 — SDK vs raw fetch
**Decision**: `@anthropic-ai/sdk` with `client.messages.parse` +
`zodOutputFormat` (zod is already a project dependency).
**Rationale**: schema-validated verdicts, typed errors, built-in retry and
timeout — exactly the reliability plumbing the spec's "one retry, never break
the pipeline" rules need; hand-rolling it over fetch is more code, not less.
**Alternatives**: raw fetch (rejected: reimplements retries/validation);
Resend-style single POST (rejected: response parsing is the hard part here).

## D2 — Model
**Decision**: `claude-opus-5`, adaptive thinking (default), structured
output, `max_tokens` 16000.
**Rationale**: the judgment is subtle (tier/modality/unit traps) and runs at
most a few times a day on ~KB payloads — cost is cents/month; accuracy is
the whole feature. No named-model request from the operator, so the default
current recommendation applies.
**Alternatives**: haiku/sonnet for cost (rejected: cost is negligible at
this volume; a wrong `real` verdict publishes a wrong price).

## D3 — Where verdicts live
**Decision**: `Anomaly`-shaped entries (`arbiter_hold` per held model,
`arbiter_note` per provider) on `ProviderResult.anomalies`.
**Rationale**: `shouldAlert` fires on any anomaly and `buildAlert` renders
code/message/`details.models` already; `logExtractionRun` persists the same
array. FR-006 (existing structures) satisfied with two union members.
**Alternatives**: new `verdicts` field on ProviderResult + alert rendering
(rejected: more surface, same information); new table (rejected by spec).

## D4 — How a hold keeps last known-good
**Decision**: `upsertProviderModels(providerId, models, holdPrices?)` filters
held ids out of the `prices` insert; model-row metadata still upserts.
**Rationale**: all six stored price fields survive by not being touched;
no dependence on the history trigger's change detection; `effective_date` and
`updated_at` on the price row honestly stay at the last accepted write.
**Alternatives**: overwrite parsed prices with baseline values (rejected:
baseline carries 3 of 6 fields); drop model from upsert entirely (rejected:
`deactivateMissingModels` semantics and metadata freshness suffer — and the
model list passed to deactivate would need special-casing anyway).

## D5 — Arbiter failure taxonomy (FR-004)
All of these produce "write as today + `arbiter_note`", never a throw:
no `OPENAI_API_KEY`; SDK error after its 1 configured retry;
`parsed_output` null; change set > 40 (only first 40 judged; rest noted);
verdict naming an unknown model id (ignored); changed model missing from
the response (written + noted). Client config: `timeout: 60_000`,
`maxRetries: 1`.

## D6 — Page text
**Decision**: wrap `ctx.fetchText` per provider iteration in `run.ts` to
remember the last body (30KB cap, tail-trimmed), pass to the arbiter.
**Rationale**: the raw evidence row alone catches wrong-row/tier/unit reads
(it caught 2026-08-22: the row said "Audio"), but the page text is what lets
the judge see the row the parser *should* have picked; retention is ~30 lines
in the ctx wrapper vs re-fetching (slow, rude) or persisting pages (scope).

## D7 — When the arbiter does NOT run
No changes for the provider; provider blocked by anomaly detection (nothing
will be written anyway); dry run; new-model-only diffs; metadata-only
updates. Zero LLM calls in all these cases (SC-003, FR-005).
