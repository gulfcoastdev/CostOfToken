# Implementation Plan: Model Type and Capability Classification

**Branch**: `003-model-classification` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-model-classification/spec.md`

## Summary

Give every model a `model_type`, default the table and calculator to `general`,
and keep everything else reachable.

The classifier is deliberately small: a short list of ordered rules over
evidence the pipeline already has. Where the rules disagree or say nothing, the
model is **flagged, not guessed** — which is the whole point, since guessing
from names is exactly how the existing `modality` column became untrustworthy.

Capabilities are **recorded, not derived**. A capability is stored when a
source declares it or a person writes it down; otherwise it stays unknown.
Building anything that infers capabilities is explicitly out of scope and can
be a later pass.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js runtime, Next.js 15 App Router

**Primary Dependencies**: `postgres` 3.4. No new dependencies.

**Storage**: Postgres — additive columns on `models`, plus the flattened read view. `db/schema.sql` stays idempotent and new view columns append at the end.

**Testing**: `node --test` via `tsx`. Classifier rules are pure functions over a model record, so they unit-test without a database; the filtering behaviour gets database-backed tests.

**Target Platform**: Vercel serverless.

**Project Type**: Web service + server-rendered site (single project).

**Performance Goals**: Classification runs inside the existing pipeline; no extra network calls, no measurable added runtime.

**Constraints**: No guessing — a name pattern alone never determines a type. The public API's default response must not change (Constitution VI). No model may be deleted or lose its URL.

**Scale/Scope**: 225 active models. Measured today: 193 with no non-chat signal, 32 with one.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against `.specify/memory/constitution.md` **v1.0.0**.

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Truthful Data Over Available Data** | PASS | The feature exists to stop the site making a false claim (a moderation endpoint ranked 4th cheapest). A name pattern alone never types a model; conflicting or absent evidence produces `needs_review` with a null type, never a plausible-looking guess. The untrustworthy `modality` values are not grandfathered in. |
| **II. Test-First (NON-NEGOTIABLE)** | PASS | Every classifier rule is a pure function tested before it exists, using the real catalogue's awkward cases as fixtures — `gpt-image-1` (image, but has an output price), `gemini-embedding` (embedding, no output price), `glm-ocr` (OCR, has an output price). Filtering behaviour is tested against the real database. |
| **III. Test the Layer Where the Fault Lives** | PASS | Three layers: rules as pure units; type assignment across the whole catalogue against real Postgres; the API's default-response guarantee via a route test, because that is a contract fault no unit test would catch. |
| **IV. Decisions Are Documented Where They Live** | PASS | The rule table and its ordering carry the reason at the call site, including why "no non-chat signal + priced for input and output" is evidence of a text generator rather than an assumption. |
| **V. Simplicity and Earned Dependencies** | PASS | No dependencies, no inference engine, no ML. One ordered rule list, one enum, one nullable column, one review script. Capability derivation is explicitly deferred rather than half-built. |
| **VI. Public Surfaces Are Contracts** | PASS | `model_type` and `capabilities` are additive fields; the `type` filter is opt-in. A caller sending no new parameters receives exactly the models it received before (FR-014, SC-007), guarded by a test. No model loses its URL. |
| **VII. Untrusted Input Is Inert; Production Is Guarded** | PASS | The new filter value is whitelisted against the enum rather than interpolated. Classification reads only data already in the pipeline. |

**Post-Phase 1 re-check**: PASS — no gate moved. The design adds no dependency,
no network call and no breaking change.

### Test-first ordering (Principle II)

| Behaviour | Test task | Then implementation |
|-----------|-----------|---------------------|
| Rule precedence: manual override wins | `tests/classify.test.ts` | `src/pipeline/classify.ts` |
| Non-chat pattern + no output price → typed | `tests/classify.test.ts` | same |
| Non-chat pattern + has output price → `needs_review`, type null | `tests/classify.test.ts` | same |
| No non-chat signal + priced both ways → `general` | `tests/classify.test.ts` | same |
| Whole catalogue: every model typed or flagged | `tests/classify-db.test.ts` | pipeline wiring |
| API default response unchanged; `type` filter works | `tests/api.test.ts` | route + query changes |

## Project Structure

### Documentation (this feature)

```text
specs/003-model-classification/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── checklists/requirements.md
├── contracts/
│   └── classification-contract.md   # Phase 1
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
db/schema.sql                     # EDIT — model_type, classification columns; view append
data/overrides.ts                 # EDIT — model_type/capabilities become overridable
src/
├── lib/
│   ├── types.ts                  # EDIT — ModelType, ClassificationStatus, fields on PriceRowV1
│   └── queries.ts                # EDIT — type filter; default-chat for site reads
├── pipeline/
│   ├── classify.ts               # NEW — the ordered rules, pure
│   ├── normalize.ts              # EDIT — call the classifier
│   └── upsert.ts                 # EDIT — persist type + status
├── app/
│   ├── api/v1/prices/route.ts    # EDIT — additive `type` param
│   └── page.tsx                  # EDIT — default to chat, expose the type control
└── components/
    └── price-explorer.tsx        # EDIT — type selector, "showing chat models" affordance

scripts/
└── classify-review.ts            # NEW — list models needing review

tests/
├── classify.test.ts              # NEW — rules, pure
└── classify-db.test.ts           # NEW — whole-catalogue assertions
```

**Structure Decision**: Classification lives in `src/pipeline/` beside
`normalize.ts` and `anomaly.ts`, because it is a step in producing a correct
catalogue rather than a display concern. The rules are pure so they test
without a database, matching how `anomaly.ts` is already structured and tested.

## Complexity Tracking

> No Constitution Check violations to justify. Table intentionally omitted.
