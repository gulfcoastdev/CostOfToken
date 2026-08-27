# Tasks: LLM Price-Change Arbiter

**Input**: Design documents from `/specs/010-llm-price-arbiter/`

**Tests**: REQUIRED (test-first, red before green, per behavior).

**Organization**: sequential — the stories share `arbiter.ts`, `run.ts`,
`upsert.ts`, and one test file.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 `npm install @anthropic-ai/sdk`; confirm `npm test` and
      `npm run typecheck` still pass.

## Phase 3: User Story 1 — Misreads blocked and diagnosed (Priority: P1) 🎯 MVP

**Goal**: change detection → single judged call → real writes / misread+unclear
holds → verdicts in anomalies/alert.

**Independent Test**: `tests/arbiter.test.ts` with an injected judge; the
2026-08-22 replay produces a hold and an `arbiter_hold` anomaly.

- [X] T002 [US1] Write failing tests in tests/arbiter.test.ts for
      `diffChanges(baseline, parsed)`: detects input/cached/output diffs on
      existing models; ignores new models, unchanged models, and
      metadata-only differences; evidence carried from `pricing.raw` and
      JSON-capped at 2KB.
- [X] T003 [US1] Write failing tests for `arbitrate(changes, judge, pageText?)`
      with stub judges: real → no hold + one `arbiter_note` summary;
      misread/unclear → hold + one `arbiter_hold` per model with
      before/after in `details.models`; mixed verdicts; unknown modelId in
      response ignored; a changed model missing from the response is written
      + noted; the 2026-08-22 replay (stored $4 text prices, parsed $32 with
      raw row labelled Audio) asserted end-to-end through diff + a recorded
      prompt-payload check (evidence JSON reaches the judge) with a
      misread-stub judge producing the hold.
- [X] T004 [US1] Implement src/pipeline/arbiter.ts (diffChanges, arbitrate,
      verdict zod schema, anomaly construction) and add
      `'arbiter_hold' | 'arbiter_note'` to AnomalyCode in
      src/pipeline/anomaly.ts. Green on T002/T003.
- [X] T005 [US1] Write failing DB-backed test (skips without DATABASE_URL) in
      tests/arbiter.test.ts: `upsertProviderModels(..., holdPrices)` leaves a
      held model's six price fields and `price_history` untouched while its
      model metadata updates; non-held models write normally.
- [X] T006 [US1] Implement the `holdPrices?: Set<string>` filter in
      src/pipeline/upsert.ts (prices insert only). Green on T005.
- [X] T007 [US1] Wire src/pipeline/run.ts: remembering fetchText wrapper
      (30KB cap per provider iteration); after anomaly gate and only when
      writing (not dryRun, not blocked) and diff non-empty, call arbitrate
      with `createClaudeJudge()`; merge arbiter anomalies into
      `base.anomalies`; pass holds to upsertProviderModels; holds excluded
      from `modelsChanged` counting stays consistent (pricesChanged already
      reflects actual writes). Add a run-level test with injected ctx+judge
      via a test seam (export a `judgeFactory` option on RunOptions,
      defaulting to `createClaudeJudge`).

**Checkpoint**: replay test green; alert body (buildAlert over a synthetic
RunSummary) shows the hold with its reason — assert in test.

## Phase 4: User Story 2 — Arbiter can never take the pipeline down (Priority: P2)

- [X] T008 [US2] Write failing tests: `createClaudeJudge()` returns null-judge
      when ANTHROPIC_API_KEY unset (no client constructed); judge throwing /
      returning null → all changes written + `arbiter_note` unavailable;
      >40 changes → first 40 judged, rest written + noted; arbitrate never
      throws (wrap-all assertion).
- [X] T009 [US2] Implement: key gate, try/catch around the judge call, the
      40-change cap, note wording per research.md D5; client options
      `timeout: 60_000, maxRetries: 1`, model `claude-opus-5`,
      `client.messages.parse` + `zodOutputFormat`, `max_tokens: 16000`.
      Green on T008.

## Phase 6: Polish & Validation

- [X] T010 Run quickstart.md: `npm test`, off-state run
      (`ANTHROPIC_API_KEY= npm run pipeline:run` → today's behaviour + note),
      live smoke test against LOCAL with a seeded price change, and the
      no-change duration check. Leave cot-pg running.
- [X] T011 `npm run typecheck`; update `.env.example` with ANTHROPIC_API_KEY
      and a one-line comment; note the feature in BACKLOG.md ongoing rules if
      applicable.

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011.

## Implementation Strategy

US1 is the MVP (judged holds, verdicts in alerts). US2 hardens failure
modes. Ship together; prod needs ANTHROPIC_API_KEY set in Vercel to turn on.
