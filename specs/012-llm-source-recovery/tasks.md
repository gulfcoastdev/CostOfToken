# Tasks: LLM Source-Recovery Judge

**Input**: Design documents from `/specs/012-llm-source-recovery/`
**Tests**: REQUIRED — red before green per behavior.

## Phase 1: Setup / shared plumbing

- [X] T001 Schema: source_structures table + 'llm' in prices source_kind
      check (db/schema.sql, data-model.md); `npm run db:push` LOCAL.
      Types: SourceKind/SOURCE_KINDS += 'llm'; AnomalyCode += 'llm_recovery'.
- [X] T002 Extract src/pipeline/llm.ts: `openrouterChat(system, payload,
      jsonSchema)` from the arbiter's fetch code; default model
      `deepseek/deepseek-v4-pro` via ARBITER_MODEL; arbiter refactored onto
      it (its tests stay green — the refactor proves the seam).

## Phase 2: US1 — derive prices on parser failure 🎯 MVP

- [X] T003 [US1] Failing tests tests/recovery.test.ts (stub judge):
      high confidence → NormalizedModel[] with sourceKind 'llm' built only
      from page-present model ids; low confidence → null; judge error/no
      key → null; no page text → never calls judge.
- [X] T004 [US1] Implement src/pipeline/recovery.ts (attemptRecovery,
      zod schema, prompt per plan contract). Green on T003.
- [X] T005 [US1] run.ts: extract the provider-processing body into a local
      function; failure path calls attemptRecovery and, when non-null,
      re-enters processing (anomaly gates included) with
      `base.recovered = {models, confidence}`. Failing run-level DB test
      (fixture mutilated so openai parses zero, stub judgeFactory) →
      offers written with source_kind 'llm'; then green. SC-005.

## Phase 3: US2 — structure memory

- [X] T006 [US2] Failing DB tests: first recovery inserts the memo; second
      receives remembered structure in its payload and updates it; healthy
      path writes nothing. Implement memo read/write in recovery.ts.

## Phase 4: US3 — rework notifications

- [X] T007 [US3] Failing tests (injected poster fn): recovery files issue
      with provider/change/derived summary; dedup inside 7-day window via
      source_structures.last_notified_at; poster failure → run unaffected
      + llm_recovery note; no token → note only. Implement
      src/pipeline/github.ts + wiring.

## Phase 5: Validation

- [X] T008 quickstart.md steps 1–3 (incl. one live DeepSeek recovery
      against LOCAL); full suite; typecheck; .env.example (GITHUB_TOKEN,
      GITHUB_REPO, ARBITER_MODEL default note); BACKLOG update
      (self-driving next steps from research D7).

## Dependencies
T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008.
