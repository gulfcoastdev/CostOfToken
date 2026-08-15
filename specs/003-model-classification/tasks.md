---

description: "Task list for Model Type and Capability Classification"
---

# Tasks: Model Type and Capability Classification

**Input**: Design documents from `/specs/003-model-classification/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/classification-contract.md](./contracts/classification-contract.md),
[quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution v1.0.0 Principle II is non-negotiable: the
test task precedes its implementation task and **MUST be observed failing for
the right reason** first. A "MUST FAIL" task is not done until you have run it
and seen it fail.

**Organization**: Grouped by user story so each ships independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no incomplete dependency
- **[Story]**: US1–US5 from spec.md

## Path Conventions

| File | Layer | Database |
|------|-------|----------|
| `tests/classify.test.ts` | Pure rules | No |
| `tests/classify-db.test.ts` | Whole-catalogue assertions | Yes — skips without `DATABASE_URL` |
| `tests/api.test.ts` (existing) | Route contract | Yes |

---

## Phase 1: Setup

- [X] T001 Add `ModelType`, `ClassificationStatus` and `Classification` to `src/lib/types.ts`, plus the new fields on `NormalizedModel` and `PriceRowV1` — the contract the failing tests are written against (no behaviour, so nothing can fail on it)
- [X] T002 [P] Extend `ModelOverride` in `data/overrides.ts` with optional `model_type` and `capabilities`, documenting that a manual entry is never overwritten by the pipeline

---

## Phase 2: Foundational (Blocking)

**⚠️ Blocks every user story.**

- [X] T003 Add the additive columns to `db/schema.sql` — `model_type` (nullable, checked against the enum), `classification_status` (default `needs_review`), `classification_source`, `classification_note`, `capabilities` (jsonb) — and append `model_type`, `classification_status`, `capabilities` to `v_current_prices`. Comment why they append rather than insert mid-list
- [X] T004 Run `npm run db:push` against the local database and confirm re-running it is a no-op
- [X] T005 Write failing tests for rule precedence in `tests/classify.test.ts` — a manual override wins over every other signal and reports `source: 'manual'`; `needs_review` never carries a type; `confirmed` never carries a null type; `note` is non-null whenever status is `needs_review`. **MUST FAIL**
- [X] T006 Write failing tests for the evidence rules in `tests/classify.test.ts`, using the catalogue's real awkward cases — `gemini-embedding` (pattern + no output price → `embedding`, confirmed), `gpt-image-1` (pattern + has output price → null, `needs_review`), `glm-ocr` (same shape, OCR), `gpt-realtime` (audio, no output price → `realtime`), a plain chat model (no pattern + both prices → `chat`), and a model with neither price (→ `needs_review`, never `chat`). **MUST FAIL**
- [X] T007 Implement `classifyModel()` in `src/pipeline/classify.ts` — the ordered rule list from data-model.md, pure, with the reasoning at the call site for why a name pattern alone is never sufficient. Greens T005–T006
- [X] T008 Run `npm test` and `npm run typecheck`; both MUST pass before any user story begins

**Checkpoint**: the classifier is correct in isolation, and nothing is wired up.

---

## Phase 3: User Story 1 - "Cheapest" means something (Priority: P1) 🎯 MVP

**Goal**: the default table and every cost ranking contain only text generators.

**Independent Test**: sort the default table by price ascending; every model in
the top ten can generate text. Quickstart scenarios 2, 3.

**⚠️ Ships together with US2** — see the note at the end of this phase.

### Tests for User Story 1

- [X] T009 [P] [US1] Write failing whole-catalogue tests in `tests/classify-db.test.ts` — every active model is either typed or flagged; no model is `confirmed` with a null type; the counts land near the measured baseline (~193 chat, ~15 confirmed non-chat, ~17 flagged). **MUST FAIL**
- [X] T010 [US1] Write a failing test in `tests/classify-db.test.ts` that no cost ranking contains a model whose `model_type` is not `chat`, and that a model with no output price never appears in a cheapest ranking. **MUST FAIL**

### Implementation for User Story 1

- [X] T011 [US1] Call `classifyModel()` from `src/pipeline/normalize.ts` so every normalized model carries a classification
- [X] T012 [US1] Persist type, status, source and note in `src/pipeline/upsert.ts`, and never let a `derived` result overwrite a `manual` one (contract P2)
- [X] T013 [US1] Run `npm run pipeline:run` locally; confirm the counts match T009's expectations and that a second run reports zero classification changes (contract P1)
- [X] T014 [US1] Add an optional `modelType` filter to `getPrices()` and the value/trend reads in `src/lib/queries.ts`, whitelisted against the enum and parameterised
- [X] T015 [US1] Default the home page's read to `chat` in `src/app/page.tsx`, and default every ranking in `src/lib/cost.ts` and the calculator to chat-only. Greens T010
- [X] T016 [US1] Run quickstart scenarios 2 and 3

**Checkpoint**: the cheapest ranking is honest. Do **not** ship without US2 —
alone this hides 32 models with no way to reach them.

---

## Phase 4: User Story 2 - Find the non-chat models on purpose (Priority: P1)

**Goal**: every non-chat model stays reachable, priced and compared within its
own type.

**Independent Test**: reach the embedding models from the main table without
knowing a URL. Quickstart scenarios 4, 5, 6.

### Tests for User Story 2

- [X] T017 [P] [US2] Write a failing test in `tests/classify-db.test.ts` that no model was deleted or deactivated by classification — the active count is unchanged and every previously active model id is still present. **MUST FAIL**

### Implementation for User Story 2

- [X] T018 [US2] Add a model-type control to `src/components/price-explorer.tsx` listing every type present in the data plus the review set, with the active filter stated so a reader is never silently shown a subset
- [X] T019 [US2] Show, wherever a non-chat type is displayed, that its pricing is not comparable to chat pricing — required by FR-010 and true: embeddings and moderation have no output price at all
- [X] T020 [US2] When a search matches nothing in the current type but matches a model in another, tell the reader where it is rather than returning empty (FR-012)
- [X] T021 [US2] Confirm every model page still resolves, including for non-chat models (FR-011). Greens T017
- [X] T022 [US2] Run quickstart scenarios 4, 5 and 6

**Checkpoint**: US1 + US2 together are shippable. This is the real MVP.

---

## Phase 5: User Story 4 - Uncertain classifications get reviewed (Priority: P2)

Sequenced before US3 because the review queue is what resolves the 17 flagged
models, and US3's display depends on knowing what they are.

**Independent Test**: a model whose signals disagree appears on the review list
rather than being assigned a type. Quickstart scenarios 8, 9.

### Tests for User Story 4

- [ ] T023 [P] [US4] Write a failing test in `tests/classify.test.ts` that a flagged model's `note` names the pattern that fired and why it was not trusted, so the queue is actionable without opening a vendor page. **MUST FAIL**

### Implementation for User Story 4

- [ ] T024 [US4] Implement `scripts/classify-review.ts` and wire `npm run classify:review` — list each flagged model with provider, id, prices, the hint that fired and the reason it was not trusted; support `--json`
- [ ] T025 [US4] Work the queue: for each of the ~17 flagged models, check the provider's own documentation and record the decision in `data/overrides.ts` with a `notes` line citing the source. Do **not** guess — leave anything still unclear flagged
- [ ] T026 [US4] Re-run the pipeline and confirm manual decisions are applied and survive a second run (contract P2)
- [ ] T027 [US4] Run quickstart scenarios 8 and 9

**Checkpoint**: the flagged set is resolved or honestly still flagged.

---

## Phase 6: User Story 3 - Know what a model can do (Priority: P2)

Capabilities are **recorded, never derived** (research R5). This phase surfaces
what is known and nothing more.

**Independent Test**: five models of different kinds show capabilities matching
their providers' documentation, and models with unknown capabilities claim
nothing.

### Tests for User Story 3

- [ ] T028 [P] [US3] Write a failing test in `tests/classify.test.ts` that capabilities are only ever populated from a declaring source or an override, and that absence is `null` rather than an empty object implying "none". **MUST FAIL**

### Implementation for User Story 3

- [ ] T029 [US3] Carry declared input modalities from the OpenRouter catalogue into `capabilities` for the models it covers — the one genuinely declared source available (research R1)
- [ ] T030 [US3] Display type and known capabilities on the model page and in the expanded table row, rendering an absent capability as unstated rather than as a negative claim
- [ ] T031 [US3] Remove the untrustworthy `modality` values from display paths so a stale guess cannot outlive the new field (FR-016)

---

## Phase 7: User Story 5 - Programmatic consumers can filter by type (Priority: P3)

### Tests for User Story 5

- [ ] T032 [P] [US5] Write failing tests in `tests/api.test.ts` — `/api/v1/prices` with no new parameters returns the same model count as before the change (including all 32 non-chat); `?type=embedding` returns only embeddings; a repeated/comma-separated `type` works; an unknown type returns `400` with the existing error envelope. **MUST FAIL**

### Implementation for User Story 5

- [ ] T033 [US5] Add `model_type`, `classification_status` and `capabilities` to the API row shape in `src/lib/queries.ts` and `src/lib/types.ts`, additively
- [ ] T034 [US5] Add the `type` parameter to `src/app/api/v1/prices/route.ts`, validated against the enum, defaulting to no filter. Greens T032
- [ ] T035 [US5] Document the new field and parameter in `docs/API.md` and `/api-docs`, stating plainly that the default response is unchanged
- [ ] T036 [US5] Run quickstart scenario 7

---

## Phase 8: Polish

- [ ] T037 [P] Document classification in `README.md` — the rule table, why a name alone never decides, and how to work the review queue
- [ ] T038 [P] Add a completed entry to `BACKLOG.md`, noting that capability derivation and quality scores are deliberately separate
- [ ] T039 Run quickstart scenario 10 (re-running changes nothing) and spot-check 20 classified models against provider documentation (SC-005)
- [ ] T040 Run the full gate set: `npm test`, `npm run typecheck`, `npm run build`

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** blocks everything
- **US1** and **US2** are both P1 and ship together — US1 alone hides 32 models
- **US4** before **US3**: the review queue resolves what US3 displays
- **US5** depends only on Foundational; can run parallel with US2–US4
- **Polish** last

### Parallel Opportunities

- T002 alongside T001
- T009 and T017 (`classify-db.test.ts`) alongside pure-rule work in `classify.test.ts`
- T032 (`api.test.ts`) alongside all of US2–US4
- T037 and T038 are different files

Same-file tasks are never marked `[P]`, which is why the `classify.test.ts`
tasks run sequentially.

---

## Implementation Strategy

**MVP = Phases 1–4** (Setup, Foundational, US1, US2). That is the honest
minimum: the cheapest ranking is fixed *and* every hidden model is reachable.
Shipping US1 alone would trade one wrong answer for another.

Then US4 (resolve the flagged set) → US3 (show capabilities) → US5 (API) →
Polish.

### Notes

- Every "MUST FAIL" task means running it and seeing the failure. A test that
  has never failed proves nothing.
- Do not guess a model's type to clear the queue. Flagged is a valid outcome.
- Do not stop `npm run dev` or the `cot-pg` container as cleanup.
