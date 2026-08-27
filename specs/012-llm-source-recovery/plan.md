# Implementation Plan: LLM Source-Recovery Judge

**Branch**: `012-llm-source-recovery` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

## Summary

Three small modules on top of what exists. A shared OpenRouter chat helper
(`src/pipeline/llm.ts`, extracted from the 010 arbiter) defaulting to
`deepseek/deepseek-v4-pro` (verified present in our own OpenRouter
catalogue). A recovery module (`src/pipeline/recovery.ts`) that engages
only inside `runPipeline`'s failure path when page text exists: one
structured-output call returns structure description + change account +
derived models + confidence; high confidence re-enters the NORMAL pipeline
path (enrich → validate → anomaly gates → upsert) with
`sourceKind: 'llm'`, so the LLM gets zero bypass of the safety gates. A
notification module (`src/pipeline/github.ts`) files the deduplicated
rework issue or degrades to the existing alert. Structure memos live in a
new `source_structures` table which also carries the dedup timestamp.

## Technical Context

**Language**: TypeScript/Node as before; **no new dependencies** (GitHub
via one fetch POST, the Resend precedent).

**Storage** (additive, idempotent, local then manual prod push):
- `source_structures`: provider_slug pk, structure text, change account,
  updated_at, last_notified_at; RLS.
- `SOURCE_KINDS`/check constraints gain `'llm'` (prices.source_kind check
  must be dropped/re-added — same pattern as model_type's constraint).

**Recovery flow in run.ts**: the current `catch` branch grows one step —
if `lastFetched` is non-empty and a judge exists, `attemptRecovery()`
returns NormalizedModel[] (sourceKind 'llm') or null. Non-null re-enters
the same processing the try-branch uses; to avoid duplicating ~60 lines,
the provider-processing body is extracted into a local function used by
both paths. Null → today's failure handling, byte-identical.

**Judge model**: `ARBITER_MODEL` env, default `deepseek/deepseek-v4-pro`,
shared by 010 arbiter + 012 recovery via llm.ts. (010's default changes
from openai/gpt-5.5 — operator decision.)

**Prompt contract** (structured output, zod-validated):
input = { providerSlug, pageText (30KB), rememberedStructure|null,
knownModels: [{modelId, inputPrice, cachedInputPrice, outputPrice}] };
output = { structure: string, structureChanged: boolean, changeAccount:
string, confidence: 'high'|'low', models: [{modelId, displayName?,
inputPrice, cachedInputPrice, outputPrice, currency}] }. Prompt forbids
inventing models not present in the page text; knownModels is matching
context only. Prices in USD/1M rules stated as in the arbiter prompt.

**Notifications**: `github.ts` — POST /repos/{GITHUB_REPO}/issues with
GITHUB_TOKEN; label `source-rework`. Dedup: skip when
`source_structures.last_notified_at` within 7 days. No token → an
`arbiter_note`-style anomaly (`recovery_note` reuses the anomaly channel:
add codes `llm_recovery` + severity warn) so the alert email carries it.

**Testing**: injected judge everywhere (the 010 pattern); github via
injected fetch-like function; DB suites skip without DATABASE_URL. SC-005
replay: mutilated fixture (headers renamed so the parser yields zero) +
stub judge recovering realtime prices.

## Constitution Check

The one genuine tension: Principle I says values are never invented — 012
publishes LLM-derived numbers. Operator has explicitly directed this
("smart enough to derive prices by itself"); mitigations keep the spirit:
derivations must come from the fetched page text (prompt-enforced, tested
via evidence-required stub), carry `llm` provenance at every surface,
pass the same validation + anomaly gates, and never overwrite a
higher-trust parse (they run only when parsing failed). Everything else:
test-first per behavior (II), pure logic unit-tested / DB behavior
DB-tested (III), decisions documented at the code (IV), no new deps (V),
`llm` source kind is additive on the API surface (VI), RLS on the new
table + tokens only in env (VII).

## Project Structure

```text
db/schema.sql               # + source_structures, 'llm' in source_kind checks
src/lib/types.ts            # SOURCE_KINDS + 'llm'
src/pipeline/llm.ts         # NEW shared OpenRouter chat (extracted from arbiter)
src/pipeline/arbiter.ts     # uses llm.ts; default model → deepseek
src/pipeline/recovery.ts    # NEW attemptRecovery + memo read/write
src/pipeline/github.ts      # NEW createReworkIssue (fetch POST, dedup-aware)
src/pipeline/run.ts         # failure path engages recovery; shared process fn
tests/recovery.test.ts      # NEW
```
