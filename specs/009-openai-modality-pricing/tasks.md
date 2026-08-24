# Tasks: OpenAI Modality-Grouped Pricing Tables

**Input**: Design documents from `/specs/009-openai-modality-pricing/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: REQUIRED — constitution Principle II (Test-First) is non-negotiable:
every test below must be written first and observed failing for the right
reason before its implementation task starts.

**Organization**: All three stories live in the same two files
(`src/pipeline/extractors/openai.ts`, `tests/extractors.test.ts`), so tasks
are sequential — no [P] markers except documentation. Stories remain
independently *testable*: each has its own assertions against the shared
fixture.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Verify the fault reproduces from the checked-in fixture: run
      `npm test`, then confirm by inspection of
      `tests/fixtures/openai-pricing-2026-08-22.md` (lines ~246–335) that the
      grouped tables list Audio rows first and use the "Output / cost"
      header. No new fixture needed; record fixture line ranges in the test
      comments added later.

*(No Phase 2 Foundational — the extractor and fixture already exist; nothing blocks the stories.)*

---

## Phase 3: User Story 1 — Headline price is the text-token rate (Priority: P1) 🎯 MVP

**Goal**: A model in a Modality-column table gets its headline
input/cached/output prices from its Text row, regardless of row order.

**Independent Test**: `npm test` — new assertions that gpt-realtime extracts
input 4 / cached 0.4 (not 32) from the fixture, plus an order-reversal case.

- [X] T002 [US1] In tests/extractors.test.ts, write failing tests (new
      describe block referencing this spec, 009): (a) from the fixture,
      `gpt-realtime` has inputPrice 4 and cachedInputPrice 0.4 and
      `gpt-audio-1.5` has inputPrice 2.5; (b) a synthetic Modality table with
      Audio listed before Text yields the Text row's prices, and the same
      table with rows reversed yields identical results (FR-006); (c) a
      synthetic Modality table where the model has no Text row (e.g. only
      Audio "$32.00") yields no borrowed headline input price (FR-002 —
      model admitted only if a Text-row field parsed; otherwise absent);
      (d) a plain table without a Modality column still behaves
      first-listing-wins (reuse existing duplicated-table shape, FR-005).
      Run `npm test` and confirm (a)–(c) fail for the right reason (Audio row
      currently wins) and (d) passes.
- [X] T003 [US1] Amend the two existing assertions in
      tests/extractors.test.ts that encode the faulty behaviour —
      `gpt-image-2` inputPrice 8 → 5 (Text row; also assert
      cachedInputPrice 1.25 and outputPrice null since its Text output cell
      is "-") and `gpt-audio` inputPrice 32 → 2.5 — rewriting the adjacent
      comment to state why first-listing-wins was abandoned for modality
      tables (the 2026-08-22/23 Audio/Text flip-flop incident). Keep the
      "no invented identifiers" assertion unchanged. Run `npm test`, confirm
      these now fail for the right reason.
- [X] T004 [US1] Implement Text-row selection in
      src/pipeline/extractors/openai.ts: detect a Modality column
      (`findColumn(table.headers, /^\s*modality\s*$/i)`); when present, group
      body rows by model id (via `splitModelQualifier`), pick the row whose
      Modality cell is Text (case-insensitive, tolerate "Text tokens") as
      the source of input/cached/output; keep the existing admission guard
      (skip the model if no Text-row price parsed) and the existing
      cross-table first-listing-wins dedupe. Non-Modality tables must not
      touch the new code path. Replace the now-wrong "the numbers OpenAI
      leads with" comment with the real decision and incident (constitution
      IV). Run `npm test` until T002/T003 pass and everything else stays
      green.

**Checkpoint**: fixture-driven headline prices correct; `npx tsx
scripts/inspect.ts openai` shows gpt-realtime in=4.000.

---

## Phase 4: User Story 2 — Output prices are captured (Priority: P2)

**Goal**: "Output / cost" is recognised as the output-price column.

**Independent Test**: `npm test` — gpt-realtime outputPrice is 16 from the
fixture (currently null).

- [X] T005 [US2] In tests/extractors.test.ts, add failing assertions:
      `gpt-realtime` outputPrice 16, `gpt-audio` outputPrice 10 (fixture uses
      "Output / cost"); and a synthetic old-style table with plain "Output"
      header still parses (regression guard). Run and confirm the first two
      fail because outputPrice is null.
- [X] T006 [US2] In src/pipeline/extractors/openai.ts widen the shortOutput
      pattern to `/short context.*output|^output\s*(\/\s*cost)?$/i` (keep it
      anchored — the anchor is what keeps per-minute/per-image columns out;
      say so in a comment). Run `npm test` until green.

**Checkpoint**: all 14 realtime/audio models have non-null output prices in
`scripts/inspect.ts openai` output.

---

## Phase 5: User Story 3 — Non-text modality rates are preserved (Priority: P3)

**Goal**: Every modality row's prices survive into `pricing.raw.modalities`,
labelled, with `raw.headlineModality` naming the headline source.

**Independent Test**: `npm test` — raw payload for gpt-realtime carries
3 modality entries with parsed prices.

- [X] T007 [US3] In tests/extractors.test.ts, add failing assertions per
      data-model.md: for fixture `gpt-realtime`, `pricing.raw.modalities` has
      entries for audio/text/image in document order with parsed
      inputPrice 32/4/5, outputPrice 64/16/null, each carrying its raw `row`
      cells; `raw.headlineModality === 'text'`; and a non-Modality table's
      raw payload still carries `row` (unchanged shape, FR-005). Confirm
      failure (raw currently has a single `row`).
- [X] T008 [US3] In src/pipeline/extractors/openai.ts, for Modality tables
      build `raw.modalities` (modality label lowercased, raw row, parsed
      input/cached/output via the same `parsePricePerMillion` + unitHint) and
      `raw.headlineModality`; keep `caption`, `labels`, `headers`, `page`;
      leave the non-Modality raw shape untouched. Run `npm test` until green.

**Checkpoint**: all three stories' assertions green together.

---

## Phase 6: Polish & Validation

- [X] T009 Run the full quickstart validation
      (specs/009-openai-modality-pricing/quickstart.md): `npm test`,
      `npx tsx scripts/inspect.ts openai` against the live page (expect
      gpt-realtime in=4.000 out=16.000, model count not reduced), then
      `npm run pipeline:run` against LOCAL (banner must say LOCAL) twice —
      second run must add zero price_history rows for the affected models
      (FR-006/SC-003). Leave `cot-pg` and any dev server running afterwards.
- [X] T010 [P] Note the deliberately-out-of-scope tts-1 per-character unit
      issue (research.md D4) in BACKLOG.md so the gap is documented rather
      than silent (constitution IV).
- [X] T011 Run `npm run typecheck` and `npm run lint`; fix anything the
      change introduced.

---

## Dependencies & Execution Order

- T001 → T002 → T003 → T004 (US1 complete) → T005 → T006 (US2 complete) →
  T007 → T008 (US3 complete) → T009 → T011. T010 anytime after T004.
- US2 and US3 are testable independently but share files with US1, so run
  sequentially. Red-before-green ordering within each story is mandatory.

## Implementation Strategy

MVP is US1 (correct headline prices — the live incident). US2 fills the
missing output prices; US3 preserves the discarded rates. Ship all three
together in one deploy; prod self-corrects on the next scheduled run.
