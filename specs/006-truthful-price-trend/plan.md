# Implementation Plan: Truthful Price Trend

**Branch**: `006-truthful-price-trend` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-truthful-price-trend/spec.md`

## Summary

A published card told readers that model prices were rising. Every robust reading of the same
data says they were flat to falling. Four independent defects compound to produce that claim,
and this plan fixes all four at the layer each one lives at.

The root cause is that a vendor's pricing document states each table's tier as a rendered tab
label — a bare line of text above the table — and the parser reads only `#` headings. Twelve of
sixteen tables therefore carry a generic caption with no tier evidence, and batch, fast-mode
and fine-tuning rates enter the catalogue as standard per-token prices. Which value survives is
decided by document order, which is why four runs in thirty minutes produced up to three
different prices for one model against unchanged upstream content.

The approach: read the labels the document already publishes and classify tier and unit from
them; resolve duplicate rows by tier rather than by position; reject rather than assume when
the evidence is absent; teach the anomaly detector to see mixed-direction tier shifts; compute
the trend as a median over a basket fixed across sample points; and floor the chart's vertical
scale against the same threshold the badge already uses for "flat".

No schema change, no new dependency, no public API change.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 24, ES modules, `.ts` extensions in import
specifiers

**Primary Dependencies**: Next.js (App Router, Node runtime), `postgres.js`, `cheerio` for the
HTML extractors. **No new runtime dependency** — the median, the ratio check and the range floor
are each a few lines of arithmetic, and Principle V requires they be justified against exactly
that.

**Storage**: PostgreSQL. `db/schema.sql` unchanged — tier and unit are decided before a write
and are not persisted.

**Testing**: `node --test` via `tsx` (`npm test` → `tsx --test tests/*.test.ts`). Extractor and
anomaly suites are pure and need no database. Trend and query suites read `DATABASE_URL` and
skip cleanly without it.

**Target Platform**: Vercel (Node runtime); local Postgres in Docker (`cot-pg`, port 55432)

**Project Type**: Server-rendered web application with a scheduled collection pipeline

**Performance Goals**: No change. The trend is computed in a `useMemo` over rows already in
memory; a median over a few hundred models is immaterial. The parser gains a bounded backward
scan per table — sixteen tables per document.

**Constraints**: Prices are USD per 1,000,000 tokens, standard tier — fixed by the
constitution's Comparability constraint. The collection run must stay inside the platform's
free-tier duration ceiling. A cached read must not await another cached read.

**Scale/Scope**: 230 models across 11 providers; 4 markdown/HTML extractors sharing the parser
being changed; ~400 rows of price history.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design.*

| Principle | Verdict | Evidence |
|---|---|---|
| **I. Truthful Data Over Available Data** (non-negotiable) | **Corrective** | This feature exists to end a standing violation. FR-003 makes an unclassifiable row a rejection rather than an assumption; FR-022 stops non-token rates entering as token prices; FR-017 makes the card say "cannot tell" rather than draw a line. Zero models from an extractor remains a failure, not an empty catalogue. |
| **II. Test-First** (non-negotiable) | **Binding on task order** | Every one of the four defects is a bug fix, so each MUST begin with a test that reproduces it and is observed failing for the right reason. `tasks.md` must interleave test-then-fix per defect, never batch the tests. |
| **III. Test the Layer Where the Fault Lives** | **Pass** | Parsing and tier classification are pure and unit-tested directly against captured document fixtures. The anomaly check is pure comparison logic. The trend statistic is extracted from the component so it can be tested without rendering. The end-to-end guarantee — two runs, no price change — is verified against a real pipeline run in `quickstart.md` S8. |
| **IV. Decisions Documented Where They Live** | **Pass, and load-bearing** | Every rule here looks arbitrary without its incident. The tier-label lookback, the reject-on-unknown rule, the sole-table escape hatch, the median, and the range floor each need a comment naming what broke. The existing extractor comments already carry the ancestor incident and must be updated rather than replaced, since they now describe a superseded mechanism. |
| **V. Simplicity and Earned Dependencies** | **Pass** | No new dependency. The one-formula rule is actively honoured: "flat" keeps a single definition consumed by both badge and chart, rather than the chart growing its own threshold. |
| **VI. Public Surfaces Are Contracts** | **Pass** | No field added, removed or reinterpreted; no URL moved. `prices.raw_data` gains the labels additively. Machine-readable surfaces continue to agree with the rendered page because both read the same corrected values. |
| **VII. Untrusted Input Is Inert** | **Pass** | The new labels are vendor-controlled text and are treated as such: cleaned by the same rules as table cells, length-bounded, and used only for classification — never rendered, never interpolated into SQL, never used to name a column. |

**Comparability constraint**: *"Prices are stored and published as USD per 1,000,000 tokens,
standard tier. Batch, Flex and Priority tiers are excluded rather than blended."* This feature
is the enforcement of that constraint, which is currently not held.

**Gate result: PASS.** No violations to justify; the Complexity Tracking table is empty and has
been removed.

### Post-Phase-1 re-check

Re-evaluated against the Phase 1 design artifacts. Still passing, with three design decisions
that were made specifically to keep it that way:

1. **A separate `labels` field rather than appending to `captionPath`.** Folding loose text
   into the heading breadcrumb would shift the positional reads other extractors depend on —
   Google recovers a model name from an ancestor heading — and would break them silently.
   Principle III: the fault would live in an extractor with no test at that layer.
2. **The sole-table escape hatch is document-scoped, not order-scoped.** Without it, every
   provider that has never published a batch tier would be rejected wholesale, turning a
   truthfulness fix into a catalogue outage — trading one Principle I violation for another.
3. **Amending rather than deleting the order-dependence test.** Principle II forbids weakening
   a test to make a change pass. `tests/extractors.test.ts` asserts *"a repeated model keeps the
   first tier, not the last"*, which encodes the behaviour being removed. It is amended
   deliberately, keeps guarding its original incident (the last table must never win), and the
   amendment is recorded in the contract.

## Project Structure

### Documentation (this feature)

```text
specs/006-truthful-price-trend/
├── plan.md                              # This file
├── spec.md                              # Feature specification
├── research.md                          # Phase 0 — R1..R7, all resolved
├── data-model.md                        # Phase 1 — entities, admission rules
├── quickstart.md                        # Phase 1 — S1..S8 validation scenarios
├── contracts/
│   └── tier-detection-contract.md       # Phase 1 — C1..C6 internal contracts
└── checklists/
    └── requirements.md                  # Spec quality checklist (passing)
```

### Source Code (repository root)

```text
src/
├── pipeline/
│   ├── extractors/
│   │   ├── markdown-table.ts     # C1: capture bare-text labels ahead of each table
│   │   ├── html-table.ts         # SourceTable gains `labels`; tier + unit classifier
│   │   ├── openai.ts             # C3: tier-ranked resolution replaces first-wins
│   │   ├── google.ts             # verify: positional captionPath reads unaffected
│   │   └── ...                   # anthropic, xai, zhipu, openrouter — same verification
│   └── anomaly.ts                # C4: `tier_shaped_shift`, direction-independent
├── lib/
│   ├── queries.ts                # C5: fixed basket; drop trend back-fill
│   └── format.ts                 # single definition of "flat", shared by badge and chart
└── components/
    ├── price-explorer.tsx        # C5: median over fixed basket; insufficiency state
    └── sparkline.tsx             # C6: range floor in both TrendChart and Sparkline

tests/
├── extractors.test.ts            # tier/unit classification, determinism, order-independence
├── anomaly.test.ts               # mixed-direction tier shift blocks; existing cases hold
├── normalize.test.ts             # unit parsing
├── format.test.ts                # the shared flat threshold
└── trend.test.ts                 # NEW — median, fixed basket, type exclusion, insufficiency
```

**Structure Decision**: The existing single-project layout is kept unchanged. The work lands in
three existing areas — the extraction pipeline, the query/aggregation layer, and two
presentation components — matching where each fault actually lives, per Principle III. One new
test file is added for the trend statistic, which requires extracting that logic out of
`price-explorer.tsx` so it can be tested at all; the constitution names that extraction
explicitly ("Logic that matters MUST be extracted out of components so it can be tested").

### Sequencing

The four defects are independent and testable in isolation, but they are not equally urgent.
Order for `/speckit-tasks`:

1. **Tier and unit integrity** (User Story 2, P1) — root cause; every downstream number is
   computed over these values.
2. **Trend statistic and basket** (User Story 1, P1) — the reported defect. Independent of 1;
   deliverable and verifiable on its own.
3. **Anomaly detection** (User Story 3, P2) — prevents recurrence rather than correcting the
   present wrong data.
4. **Chart scaling** (User Story 4, P3) — cheapest, purely presentational, no dependency on
   the other three.

Each carries its own failing-test-first pairing. Nothing in 2, 3 or 4 blocks on 1.

## Risks

| Risk | Mitigation |
|---|---|
| The `labels` lookback picks up explanatory prose as a tier label — a data-residency paragraph repeats above several tables. | Discard prose-length lines; assert against the captured document, which contains exactly that paragraph in exactly that position. |
| Stricter admission drops models the catalogue currently carries, reading as a coverage collapse. | Expected and correct for fine-tuning-only and per-image models. The existing `coverage_drop` check will fire on the first run; verify the drop matches the models intended to be dropped before accepting it, and record the expected count. |
| A fixed basket over 90 days empties the trend card, given four days of stored history. | Expected, and the honest outcome under FR-017. Verified as an outcome in quickstart S7, not treated as a regression. |
| Changing the shared parser affects the other extractors that use it. | `labels` is additive and `captionPath` semantics are untouched; the existing per-extractor tests are the guard, and Google's positional reads are verified explicitly. |
| The 2026-08-11 document state is unrecoverable, so the original flapping cannot be reproduced byte-for-byte. | Recorded in research R2. The mechanism is confirmed against today's document; the determinism and order-independence tests guard the general case rather than one lost snapshot. |
