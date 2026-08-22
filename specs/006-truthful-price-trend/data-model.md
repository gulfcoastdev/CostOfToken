# Phase 1 Data Model: Truthful Price Trend

**Feature**: 006-truthful-price-trend | **Date**: 2026-08-22

No database schema change is required by this feature. Every change is to values in flight —
how a source row is classified before it is written, and how stored rows are aggregated for
display. `db/schema.sql` is untouched.

---

## Entities

### SourceTable *(extended)*

A block of rows in a vendor's pricing document. Already exists; gains one field.

| Field | Meaning | Change |
|---|---|---|
| `caption` | Nearest enclosing heading | unchanged |
| `captionPath` | Heading breadcrumb, nearest first | unchanged |
| `headers` | Column names | unchanged |
| `rows` | Cell values | unchanged |
| `labels` | Bare text lines immediately preceding the table's heading, nearest first — the rendered tab labels | **new** |

**Why a separate field rather than appending to `captionPath`**: `captionPath` is documented as
a *heading breadcrumb* and other extractors index into it positionally to recover a model name
from an ancestor heading. Folding loose text into it would shift those positions and silently
break Google, whose model name sits one or more levels above its tier heading. The new field
carries the different kind of evidence separately.

**Validation rules**:

- A label is a non-empty line that is not a table row and not a heading.
- Lookback is bounded; only lines between the previous table (or heading) and this table's
  heading are considered.
- Lines long enough to be prose are discarded, so that an explanatory paragraph — the data
  residency notice repeats above several tables — cannot be read as a label.
- Absence of labels is not an error; it means the source states no tier there.

---

### PricingTier *(new, derived — not persisted)*

The commercial class of a rate. Determined per table, never per row.

| Value | Meaning | Recorded? |
|---|---|---|
| `standard` | On-demand, synchronous, list price | yes |
| `non_standard` | Batch, flex, priority, fast mode, provisioned, scale tier, fine-tuning | no |
| `unknown` | No tier evidence found in headings or labels | no — rejected |

**State determination**, in order:

1. If any heading in `captionPath` or any entry in `labels` matches the non-standard tier
   vocabulary → `non_standard`.
2. Else if any entry names the standard tier explicitly → `standard`.
3. Else if the table is the provider's sole pricing table and no tier vocabulary appears
   anywhere in the document → `standard`.
4. Else → `unknown`.

**Rule 3 exists** so that a provider publishing one untiered table is not rejected wholesale;
without it, every provider that has never had a batch tier would stop reporting. Rule 4 makes
the ambiguous case a rejection rather than an assumption, per FR-003.

`unknown` and `non_standard` both mean "not recorded", but they are distinct so the anomaly
report can say which happened. A provider whose tables all became `unknown` has had its
document restructured; a provider whose tables are all `non_standard` has not.

---

### PricingUnit *(new, derived — not persisted)*

What a rate is charged against. Determined per table.

| Value | Recorded? |
|---|---|
| `per_token` | yes |
| `per_image` / `per_second` / `per_character` / `per_hour` / `per_request` | no |
| `unknown` | no — rejected |

Determined from `labels` (`Prices per 1M tokens.`, `Prices per second.`) and from column
headers, which already carry `/ MTok`, `Price per second`, `$100.00 / hour`. Where the two
disagree, the more specific column header wins, because a table may be introduced as
"per 1M tokens unless noted" and then note otherwise.

---

### PriceRecord *(unchanged shape, stricter admission)*

One model's rates as extracted. The shape is unchanged; what may enter it narrows.

**New admission rules**:

- Tier MUST be `standard` (FR-001, FR-003).
- Unit MUST be `per_token` (FR-022).
- Where several candidate records exist for one model id in one run, exactly one is kept
  (FR-004, FR-007). Selection is by tier, then by unit, then by modality — never by document
  order.
- Where a source lists a model once per modality, the text/token modality is selected
  (FR-023).

**Invariant**: two runs over identical source content produce identical records, including
identical ordering-insensitive selection (FR-005, FR-006).

---

### ProviderRunBaseline *(unchanged)*

A provider's last known-good stored prices, used to judge an incoming run. Already exists as
`BaselineModel`. No change.

---

### Anomaly *(extended)*

Already exists. Gains one code.

| Code | Meaning | Severity | Change |
|---|---|---|---|
| `coverage_drop` | Model count fell materially | warn / block | unchanged |
| `uniform_price_shift` | One dominant ratio across the provider | block | unchanged |
| `mass_price_change` | Many models changed | warn | unchanged |
| `field_collapse` | A column quietly went null | block | unchanged |
| `tier_shaped_shift` | An implausible share of changed models moved by exact tier-shaped ratios, in any mix of directions | block | **new** |

**Detection inputs**: for each model present in both baseline and incoming with a positive
baseline input price, the ratio `after / before`, matched exactly against a fixed set of
commercial multiples. Flags on the share of *changed* models landing on that set, with a floor
on the absolute count so a tiny provider cannot trip it on two models.

**Relationship to `uniform_price_shift`**: both may fire on the same run. `uniform_price_shift`
catches a whole provider moving as one; `tier_shaped_shift` catches a mixed run the older
check is blind to. Neither supersedes the other, and the existing check's behaviour is
unchanged (FR-009).

---

### TrendSeries *(reshaped)*

The ordered aggregate points behind the trend card.

| Aspect | Before | After |
|---|---|---|
| Statistic | Unweighted arithmetic mean | Median (R4) |
| Membership | Whatever models exist at each index | Fixed basket, priced at every sample point (FR-015) |
| Model types | All | Token-priced text types only; `image_gen`, `video_gen`, `tts`, `asr` and other non-token types excluded (FR-014) |
| Scope | `matched` — the reader's filters, not the popular narrowing | unchanged (FR-016) |
| Insufficient data | Drew a line anyway | Reports that it cannot tell (FR-017) |

**Basket eligibility**, all required:

- The model's type is one the catalogue prices per token.
- The model has a non-null input price at every sample point in the window, from real
  observation rather than back-fill.
- The basket has enough members to make a median meaningful.

**Derived**: the reported percentage change is computed from the first and last points of the
median series. The card's existing definition of "flat" remains the single source of truth for
that word, consumed by both the badge and the chart (R7).

---

## What is deliberately not changed

- **`db/schema.sql`** — no column, table, view or index changes. Tier and unit are decided
  before a write and are not persisted; the catalogue continues to store exactly one standard
  per-token price per model, which is what the constitution's Comparability constraint
  requires.
- **`prices.raw_data`** — continues to carry the caption, headers and row. The new labels are
  additionally recorded there, so a future investigation can see what the tier decision was
  made from. This is additive and does not change the column's shape.
- **Public API surface** — no field added, removed, or reinterpreted. Principle VI holds: the
  values behind `input_price` become more trustworthy, but the contract does not move.
- **Stored history** — the rows written between 2026-08-11 and 2026-08-15 are left as they
  are. Out of scope per spec; noted so the omission is explicit.
