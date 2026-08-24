# Implementation Plan: OpenAI Modality-Grouped Pricing Tables

**Branch**: `009-openai-modality-pricing` | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-openai-modality-pricing/spec.md`

## Summary

OpenAI's grouped pricing tables list one row per (model, modality) with Audio
first; the extractor's "first listing wins" dedupe therefore publishes
audio-token rates as headline prices and misses the renamed "Output / cost"
column. Fix inside `src/pipeline/extractors/openai.ts` only: when a table has
a Modality column, group its rows by model id, take the Text row as the
headline per-1M-token price, record every modality row (with parsed prices)
in `pricing.raw.modalities`, and widen the output-column regex to accept
"Output / cost". Tables without a Modality column keep the existing code path
untouched.

## Technical Context

**Language/Version**: TypeScript 5.7, Node 24 (`"type": "module"`, run via tsx)

**Primary Dependencies**: none new — pure-function change in the existing
extractor; reuses `parseMarkdownTables`, `parsePricePerMillion`, `findColumn*`

**Storage**: Postgres via postgres.js; no schema change. `prices.raw_data`
(jsonb, write-only audit field, confirmed unconsumed outside
`src/pipeline/upsert.ts:161`) gains a `modalities` array for grouped tables

**Testing**: `node --test` through tsx (`npm test`), unit level per
constitution Principle III ("parsing and pure logic MUST be unit-tested
directly"). Existing fixture `tests/fixtures/openai-pricing-2026-08-22.md`
already contains the grouped tables (Audio-first, "Output / cost" header) and
reproduces the fault

**Target Platform**: Vercel scheduled pipeline (Node runtime)

**Project Type**: web service with a scrape pipeline; this change is confined
to the pipeline extractor layer

**Performance Goals**: none beyond existing — the pipeline run already
finishes in ~11s; grouping rows per table is O(rows)

**Constraints**: headline prices remain USD per 1M tokens, standard tier;
a missing price must stay `null`, never borrowed from another modality row
(constitution Principle I)

**Scale/Scope**: one extractor file, one test file, one fixture already in
place; ~14 affected models in prod self-correct on the next run

## Constitution Check

*GATE: evaluated against constitution v1.0.0 before Phase 0; re-checked after Phase 1.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Truthful data over available data | PASS | Fix replaces a wrong-but-plausible number with the correct one; no-Text-row models get `null`, never a borrowed rate; provenance (`raw.modalities`, `raw.headlineModality`) travels with the data |
| II. Test-first | PASS (binding on tasks) | Bug-fix tests written against the real captured fixture first, observed failing (Audio row wins, output null), then the fix. Two existing assertions (`gpt-audio` = 32, `gpt-image-2` = 8) encode the faulty behaviour and are amended **deliberately**, with the reason in the test comment — not weakened to pass |
| III. Test the layer where the fault lives | PASS | The fault is pure parsing; unit tests against fixture content are the right layer. No DB or route behaviour changes |
| IV. Decisions documented where they live | PASS | The "prefer Text row, why not first-listing" decision and the 2026-08 flip-flop incident get a comment at the selection code, replacing the now-wrong "first listing wins" comment |
| V. Simplicity, earned dependencies | PASS | No new dependency, no new module; one grouping step inside the existing loop |
| VI. Public surfaces are contracts | PASS | API/feed/UI surfaces unchanged; model ids unchanged (no suffixed ids — upheld from the existing design); `raw_data` is not a public surface |
| VII. Untrusted input is inert | PASS | Vendor cells still pass through `parseMoneyStrict`; no new interpolation or rendering of external text |

**Post-Phase-1 re-check**: PASS — design adds no schema change, no new
public surface, no new dependency. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/009-openai-modality-pricing/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/pipeline/extractors/
├── openai.ts            # the fix: Modality-column handling + output regex
├── html-table.ts        # findColumn helpers (unchanged)
└── markdown-table.ts    # table parser (unchanged)

tests/
├── extractors.test.ts   # amended + new modality tests
└── fixtures/
    └── openai-pricing-2026-08-22.md   # already contains grouped tables
```

**Structure Decision**: single-file fix in the existing extractor; no new
modules. `contracts/` is intentionally absent — no externally consumable
interface changes (constitution VI holds because nothing public moves).

## Complexity Tracking

No constitution violations to justify.
