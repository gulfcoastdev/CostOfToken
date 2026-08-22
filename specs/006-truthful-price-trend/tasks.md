---

description: "Task list for 006-truthful-price-trend"
---

# Tasks: Truthful Price Trend

**Input**: Design documents from `/specs/006-truthful-price-trend/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: REQUIRED, and required *first*. Constitution Principle II is non-negotiable: "Every bug fix MUST begin with a test that reproduces the bug and fails for the right reason." All four defects here are bug fixes. Every `[TEST]` task below MUST be run and **observed failing for the stated reason** before its paired implementation task begins. A test that passes before the fix proves nothing and means the test is wrong.

**Organization**: Grouped by user story. Stories are independent — US1, US3 and US4 do not block on US2 or on each other.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1..US4, mapping to the user stories in spec.md

---

## Phase 1: Setup

- [X] T001 Save the OpenAI pricing document fetched on 2026-08-22 as a committed test fixture at `tests/fixtures/openai-pricing-2026-08-22.md`, so tier detection is tested against real source rather than a hand-written approximation. Kept byte-verbatim; provenance recorded in `tests/fixtures/README.md` rather than a header comment, so nothing prepended can change what the parser sees.
- [X] T002 [P] Record the current gate baseline: run `npm test`, `npm run typecheck` and `npm run build`, and note the passing test count in the task notes below, so any later regression is attributable.
- [X] T003 [P] Record the pre-change extraction baseline for OpenAI — model count and the stored price for `gpt-image-2`, `o4-mini-2025-04-16` and `gpt-5.3-codex` — so the expected coverage drop in T014 can be verified as intended rather than accidental.

**Checkpoint**: Fixture committed, baselines recorded.

---

## Phase 2: Foundational

No task in this feature blocks all four user stories. The parser change is scoped to US2; the shared "flat" threshold is shared only between US1 and US4 and is created in US4, which is the cheaper story and can ship first if desired.

This phase is intentionally empty. Proceed directly to the story phases.

---

## Phase 3: User Story 2 — Only standard-tier prices enter the catalogue (P1)

**Goal**: The catalogue records exactly one value per model — the standard, on-demand, per-token rate — regardless of how the source document is laid out, and identically on every run.

**Independent test**: Extract twice from identical fixture content and compare; extract from reordered content and compare; confirm non-standard and non-token tables contribute nothing. No database, no UI.

### Tests first

- [X] T004 [TEST] [US2] In `tests/extractors.test.ts`, add a test asserting the parser captures the bare text lines preceding a table's heading as `labels`, nearest first, against the T001 fixture. MUST fail: the parser has no such field. *(C1)*
- [X] T005 [TEST] [P] [US2] In `tests/extractors.test.ts`, add a test asserting the data-residency paragraph that repeats above several tables in the fixture is NOT captured as a label. MUST fail for the same reason as T004. *(C1, prose-length rule)*
- [X] T006 [TEST] [P] [US2] In `tests/extractors.test.ts`, add a test asserting tier classification of every table in the T001 fixture: the batch image table, the batch video table, the fast-mode code table and the batch fine-tuning table are all `non_standard` despite generic captions. MUST fail: today only the three tables with a tier word in their own heading are detected. *(C2, FR-002)*
- [X] T007 [TEST] [P] [US2] In `tests/extractors.test.ts`, add a test asserting a table with no tier evidence anywhere classifies as `unknown` and records nothing — and that a provider whose document contains no tier vocabulary at all still classifies its sole table as `standard`. MUST fail. *(C2 sole-table rule, FR-003)*
- [X] T008 [TEST] [P] [US2] In `tests/extractors.test.ts`, add a test asserting unit classification: per-image, per-second and per-hour tables are refused, and a model appearing only in fine-tuning tables is omitted entirely. Assert specifically that `o4-mini-2025-04-16` is absent and `gpt-image-2` carries no per-token price. MUST fail: both are currently extracted. *(FR-022, FR-023)*
- [X] T009 [TEST] [P] [US2] In `tests/extractors.test.ts`, add a determinism test — extracting twice from byte-identical fixture content yields deep-equal records — and an order-independence test — extracting from content whose table blocks are reordered yields deep-equal records. The second MUST fail: resolution is currently first-wins. *(FR-005, FR-006, SC-001)*
- [X] T010 [TEST] [US2] Amend, deliberately and with a comment recording why, the existing test *"a repeated model keeps the first tier, not the last"* in `tests/extractors.test.ts`. Its scenario — two colliding tables under an unrecognised heading — now resolves to `unknown` and records nothing. The amended test MUST still guard the original incident: the last table must never win. Per Principle II this is an amendment, not a weakening; state that in the comment. *(contract Compatibility section)*

### Implementation

- [X] T011 [US2] Add the `labels` field to `SourceTable` in `src/pipeline/extractors/html-table.ts` and populate it in `parseMarkdownTables` in `src/pipeline/extractors/markdown-table.ts` with the bounded, cleaned, prose-filtered backward scan. Do NOT touch `captionPath` semantics — Google reads it positionally. Comment why the field is separate. Makes T004, T005 pass.
- [X] T012 [US2] Add tier and unit classification to `src/pipeline/extractors/html-table.ts`, reading headings and labels, returning `standard` / `non_standard` / `unknown` and the pricing unit. Keep `NON_STANDARD_TIER` as the single tier vocabulary — one definition, per Principle V. Comment the reject-on-unknown rule and the sole-table escape hatch with the incident each prevents. Makes T006, T007 pass.
- [X] T013 [US2] Replace the first-wins guard in `src/pipeline/extractors/openai.ts` with tier-ranked resolution — by tier, then unit, then modality, never by document order — and refuse non-standard and non-token rows. Update the existing block comment: it currently describes the superseded mechanism, and Principle IV requires it describe the live one. Makes T008, T009, T010 pass.
- [X] T014 [US2] Run the extractor against the T001 fixture and compare the model list to the T003 baseline. Confirm every dropped model is one intended to be dropped (fine-tuning-only, per-image, per-second). Record the expected count so the `coverage_drop` warning on the first real run is recognisable as intended.
- [X] T015 [P] [US2] Verify the other extractors are unaffected: run the full `tests/extractors.test.ts` suite and confirm `google.ts`, `anthropic.ts`, `xai.ts`, `zhipu.ts` and `openrouter.ts` still pass, with Google's positional `captionPath` reads explicitly checked.

**Checkpoint**: Extraction is deterministic, order-independent, and admits only standard per-token rates. SC-001, SC-002, SC-005 satisfied at the extraction layer.

---

## Phase 4: User Story 1 — A reader is not told prices rose when they did not (P1)

**Goal**: The published trend reports a direction the data supports, or reports that it cannot tell.

**Independent test**: Feed a catalogue whose typical model is unchanged but where two expensive models carry corrupted doubled values; the reported direction must not read as a rise. Does not depend on US2.

### Tests first

- [X] T016 [TEST] [US1] Create `tests/trend.test.ts` with a test asserting the trend statistic is unmoved by a small number of extreme values — typical model unchanged, two expensive models doubled, expected result "no material change". MUST fail: the unweighted mean reports a rise. *(FR-013, SC-004)*
- [X] T017 [TEST] [P] [US1] In `tests/trend.test.ts`, assert non-token-priced model types (`image_gen`, `video_gen`, `tts`, `asr`) are excluded from the basket. MUST fail: all types currently contribute. *(FR-014, SC-005)*
- [X] T018 [TEST] [P] [US1] In `tests/trend.test.ts`, assert basket membership is identical at every sample point, and that a model present at only some sample points changes the reported figure not at all. MUST fail: membership currently varies per index. *(FR-015)*
- [X] T019 [TEST] [P] [US1] In `tests/trend.test.ts`, assert that a basket too small or too sparse yields an explicit insufficiency result rather than a number — and that the result is distinguishable from a genuine zero-change result. MUST fail: no such state exists. *(FR-017, SC-008)*
- [X] T020 [TEST] [P] [US1] In `tests/trend.test.ts`, assert the series is computed over the reader's active filters and not narrowed by the popular scope, preserving the intent documented at `price-explorer.tsx:490`. Expected to PASS immediately — this is a regression guard on behaviour being kept, so note in a comment that it is a guard rather than a red-green pair. *(FR-016)*

### Implementation

- [X] T021 [US1] Extract the trend computation out of `src/components/price-explorer.tsx` into a testable pure function in `src/lib/` — the constitution requires logic that matters be extracted from components so it can be tested at all. Keep it reading `matched`, not `filtered`.
- [X] T022 [US1] Implement the median statistic and the fixed, type-restricted basket in that function, plus the explicit insufficiency result. Comment why the mean was replaced, citing the measured mean/median disagreement. Makes T016–T019 pass.
- [X] T023 [US1] In `src/lib/queries.ts`, stop back-filling a model's series for sample points before its first observation for trend purposes — under a fixed basket those models are excluded instead. Keep the back-fill's existing comment intact where it still applies, and note where it no longer does.
- [X] T024 [US1] Render the insufficiency state in the trend card in `src/components/price-explorer.tsx` — a plain statement that there is not enough history to say, never an empty or flat line standing in for absent data. *(FR-017)*

**Checkpoint**: The trend cannot report a direction the data does not support. SC-004, SC-005, SC-008 satisfied.

---

## Phase 5: User Story 3 — Bulk implausibility blocks the write (P2)

**Goal**: A run in which an implausible share of models moved by exact tier-shaped ratios is blocked, whether or not those ratios agree in direction.

**Independent test**: Present a baseline and an incoming run mixing exact 2× and exact 0.5× moves; confirm it blocks. Pure comparison logic.

### Tests first

- [X] T025 [TEST] [US3] In `tests/anomaly.test.ts`, add a test asserting a run where a quarter or more of changed models moved by exact tier-shaped ratios in *mixed* directions raises a blocking `tier_shaped_shift`. MUST fail: uniformity falls below the existing 0.8 threshold and nothing fires. *(FR-008, SC-003)*
- [X] T026 [TEST] [P] [US3] In `tests/anomaly.test.ts`, assert a genuine repricing of varied, non-tier-shaped sizes does NOT fire the new check. *(FR-010)*
- [X] T027 [TEST] [P] [US3] In `tests/anomaly.test.ts`, assert a provider with very few changed models cannot trip the new check by coincidence. *(C4 minimum evidence)*
- [X] T028 [TEST] [P] [US3] In `tests/anomaly.test.ts`, assert every existing anomaly test still passes unchanged — `uniform_price_shift`, `coverage_drop`, `field_collapse`, and the unchanged-run and new-provider cases. Expected to PASS immediately; a regression guard. *(FR-009, FR-011)*

### Implementation

- [X] T029 [US3] Add the `tier_shaped_shift` code and its direction-independent check to `src/pipeline/anomaly.ts`, alongside `checkPriceShift` rather than replacing it. Update the module docstring: it states the superseded assumption that a mis-latched tier moves *every* model by one ratio, and Principle IV requires it describe the live mechanism. Makes T025–T027 pass.
- [X] T030 [US3] Confirm a blocking `tier_shaped_shift` writes nothing and records its finding through the existing mechanism in `src/pipeline/upsert.ts` and `src/pipeline/run.ts`, and that the existing operator override still applies. *(FR-012)*

**Checkpoint**: The detector sees the class of failure that produced this feature. SC-003 satisfied.

---

## Phase 6: User Story 4 — A near-flat trend looks flat (P3)

**Goal**: The drawn line, the badge and the endpoint labels on the trend card cannot contradict one another.

**Independent test**: Render with a series differing by a fraction of a percent; the line must read as flat. Pure presentation; no dependency on US1, US2 or US3.

### Tests first

- [X] T031 [TEST] [US4] In `tests/format.test.ts`, add a test asserting a single exported definition of the "flat" threshold exists and is the one the badge uses. MUST fail: the threshold is currently a bare literal inside `TrendCard`. *(C6, Principle V one-formula rule)*
- [X] T032 [TEST] [P] [US4] Create `tests/sparkline.test.ts` asserting that a series whose values differ by well under the flat threshold produces drawn coordinates spanning a negligible fraction of the chart height, in both `TrendChart` and `Sparkline`. MUST fail: both stretch any non-zero range to full height. *(FR-018, FR-019, SC-007)*
- [X] T033 [TEST] [P] [US4] In `tests/sparkline.test.ts`, assert a genuinely large movement still spans most of the chart height, and that a perfectly flat series renders without dividing by zero. *(FR-021)*
- [X] T034 [TEST] [P] [US4] In `tests/sparkline.test.ts`, assert the endpoints of a series whose two ends format to the same displayed price are drawn at the same height — the exact contradiction visible in the reported screenshot. *(FR-020, SC-006)*

### Implementation

- [X] T035 [US4] Export the single flat-threshold definition from `src/lib/format.ts` and consume it in `TrendCard` in `src/components/price-explorer.tsx` in place of the inline literal. Makes T031 pass.
- [X] T036 [US4] Floor the scaling range in both `TrendChart` and `Sparkline` in `src/components/sparkline.tsx`, relative to the series' own level so it holds from $0.06 to $30 per million tokens. Replace the `|| max * 0.1 || 1` fallback, which only catches a perfectly flat series. Comment the incident: a 0.14% move drawn as a full-height climb, contradicting the card's own badge. Makes T032–T034 pass.

**Checkpoint**: The card cannot contradict itself. SC-006, SC-007 satisfied.

---

## Phase 7: Polish & Cross-Cutting

- [X] T037 Run the full gate: `npm test`, `npm run typecheck`, `npm run build`. All three must pass. Any gate not run must be stated explicitly in the completion report with its reason — reporting complete when a gate did not run is a governance violation.
- [X] T038 [P] Work through `quickstart.md` S1–S7 against a running app (`npm run dev`). Leave the dev server running.
- [X] T039 Run `npm run pipeline:dry`, confirm it writes nothing and reports a plausible OpenAI model count against the T014 expectation. Then `npm run pipeline:run` twice against the LOCAL database, confirming the banner reads `LOCAL` and that the **second run records zero price changes** — the direct measurement of SC-001. *(quickstart S8)*
- [X] T040 [P] Update `README.md` where it describes price collection, and add to `BACKLOG.md` the two items this feature deliberately leaves undone: restating the price history corrupted between 2026-08-11 and 2026-08-15, and the 90-day axis drawn from four days of data if T022's insufficiency state has not already resolved it. Principle IV: a known gap stated plainly beats an undocumented one.
- [X] T041 Re-read the trend card in the browser and confirm against the original report — a reader asking "are prices going up or down?" gets an answer the data supports, or an explicit statement that there is not enough data to say. *(SC-008)*

---

## Dependencies

```text
Phase 1 (Setup) ──┬──> US2 (P1)  Phase 3   [T001 fixture required]
                  ├──> US1 (P1)  Phase 4   [independent]
                  ├──> US3 (P2)  Phase 5   [independent]
                  └──> US4 (P3)  Phase 6   [independent]
                                    │
                            Phase 7 (Polish) — after all
```

- **T001 blocks US2 only.** US1, US3 and US4 need no fixture.
- **Within each story**: every `[TEST]` task blocks its paired implementation task, and must be observed failing first.
- **No story blocks another.** They touch disjoint files: US2 in `src/pipeline/extractors/`, US1 in `src/lib/` and `price-explorer.tsx`, US3 in `src/pipeline/anomaly.ts`, US4 in `src/components/sparkline.tsx` and `src/lib/format.ts`.
- **One shared file**: US1 (T024) and US4 (T035) both touch `price-explorer.tsx`, in different regions. Sequence them if worked concurrently.

## Parallel Opportunities

- **T002, T003** — both baselines, together.
- **T005–T009** — five independent test tasks in `extractors.test.ts`; write together, then run as one failing suite.
- **T017–T020** — four independent test tasks in `trend.test.ts`.
- **T026–T028** — three independent test tasks in `anomaly.test.ts`.
- **T032–T034** — three independent test tasks in `sparkline.test.ts`.
- **Whole stories**: US1, US3 and US4 can proceed concurrently with US2 and with each other.

## Implementation Strategy

**MVP**: Phase 1 + Phase 3 (US2). Root cause fixed, catalogue stops ingesting non-standard and non-token rates. This alone ends the standing Principle I violation, independent of anything the chart does.

**Cheapest visible win**: Phase 6 (US4) is six tasks, purely presentational, and removes the self-contradiction the reader actually saw. It can ship before US2 if a fast correction is wanted.

**Full delivery**: all four phases plus polish. Note that US2 fixes the future and does not repair the prices already stored between 2026-08-11 and 2026-08-15 — the trend keeps reading those rows until a clean run overwrites them, which T039 performs locally.

---

## Task Notes

*(Fill T002 and T003 baselines here during execution.)*

- **T002 gate baseline**: 175 tests, 6 suites, 0 fail. `typecheck` clean.
- **T003 extraction baseline**: OpenAI 74 models. `gpt-image-2`=8.00 (per-image rate), `o4-mini-2025-04-16`=4.00 (fine-tuning rate), `gpt-5.3-codex`=1.75.
- **T014 expected coverage drop**: 71 -> 65 from the fixture. Exactly 6 models dropped, all fine-tuning-only and appearing in no other table: `o4-mini-2025-04-16`, `gpt-4.1-2025-04-14`, `gpt-4.1-mini-2025-04-14`, `gpt-4.1-nano-2025-04-14`, `gpt-4o-2024-08-06`, `gpt-4o-mini-2024-07-18`. All intended. `gpt-image-2` stays but corrects 8.00 -> 5.00 (Image row -> Text row). Sora (per-second), `gpt-5.4-cyber` (no published prices) and the transcription models were already absent before this change. Expect a ~8% `coverage_drop` **warn** on the first real run — below the 0.6 block ratio, so it will not block.
