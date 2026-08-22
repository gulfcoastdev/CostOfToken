# Phase 0 Research: Truthful Price Trend

**Feature**: 006-truthful-price-trend | **Date**: 2026-08-22

All findings below are empirical, gathered against the source document as published on
2026-08-22 and against the local catalogue (`cot-pg`). Where a conclusion rests on inference
rather than observation, it says so.

---

## R1. How a source table's tier can be determined when its heading does not name it

**Decision**: Extend the caption context a table carries to include the *bare text lines*
that precede its heading, and match the tier vocabulary against that extended context rather
than against headings alone. Bare text is captured as a bounded lookback of the non-empty,
non-table lines immediately above the heading, with prose-length lines discarded so that
explanatory paragraphs cannot be mistaken for a label.

**Rationale**: The tier is already present in the document on every table. It is rendered as
a tab label, which the markdown emits as a loose text line ahead of the table's heading:

| Table heading | Preceding bare text | Actual tier |
|---|---|---|
| `### Standard pricing data` | `Standard` | standard |
| `### Batch pricing data` | `Batch` | batch |
| `### Flex pricing data` | `Flex` | flex |
| `### Fast pricing data` | `Fast mode` | fast (formerly priority) |
| `### Grouped Pricing Table data` (L299) | `Standard` | standard, image |
| `### Grouped Pricing Table data` (L324) | `Batch` | batch, image |
| `### Grouped Pricing Table data` (L363) | `Prices per second.`, `Standard` | standard, per-second |
| `### Grouped Pricing Table data` (L381) | `Batch` | batch, per-second |
| `### Grouped Pricing Table data` (L472) | `Standard` | standard, code models |
| `### Grouped Pricing Table data` (L493) | `Fast mode` | fast |
| `### Pricing Table data` (L535) | `Standard` | standard, fine-tuning |
| `### Pricing Table data` (L559) | `Batch` | batch, fine-tuning |

Nothing needs to be inferred, guessed, or derived from price ratios. The information is
published; the parser simply is not reading the lines it lives on.

Observed today: of 16 parsed tables, only 3 are recognised as non-standard — exactly the
three whose own heading contains a tier word. Twelve generically-captioned tables are all
treated as standard, and four of those are genuinely non-standard.

**Alternatives considered**:

- *Infer the tier from the price ratio against a known-standard sibling row.* Rejected: it
  reasons from the values to their meaning, which is precisely the inversion that lets a real
  50% price cut be silently reclassified as a batch table. It also cannot classify a table
  whose models appear nowhere else.
- *Maintain a list of known generic captions and the tier each one means.* Rejected: the
  caption text is an artefact of the vendor's doc renderer, carries no tier information at
  all, and repeats — "Grouped Pricing Table data" labels ten different tables of four
  different tiers. There is nothing to map.
- *Position-based inference — assume the first table under a heading is standard.* Rejected:
  this is a restatement of the existing "first table wins" rule, which is the bug.
- *Require an explicit per-provider table allowlist.* Rejected: violates Principle V and the
  constitution's requirement that plausibility checks stay provider-agnostic.

---

## R2. Why the recorded value is non-deterministic across runs

**Decision**: Replace order-dependent deduplication with tier-ranked resolution. When one
model appears in several tables, the recorded value is chosen by the tier of the table it
came from, never by the order the tables appear in the document. A model whose only
appearances are in non-standard tables records no price rather than a non-standard one.

**Rationale**: `openai.ts` currently resolves duplicates with a first-wins guard. Combined
with R1's finding — that several non-standard tables are not recognised as such — the
recorded tier becomes a function of document order. That order is stable within a fetch but
was evidently not stable across the fetches of 2026-08-11, which is what produced four
different prices for one model inside 30 minutes against unchanged upstream content.

Today the accident happens to favour standard for most models, because the standard variants
currently appear first. That is why the catalogue is not uniformly wrong, and it is also why
the defect is invisible from the current data alone. The fix must not depend on that ordering
continuing to hold.

**Caveat recorded honestly**: the 2026-08-11 flapping is explained by this mechanism but was
not reproduced directly, because the source document has changed since — it now notes that
"Priority processing was renamed Fast mode on July 30, 2026", and the tier headings present
today may not have been present then. The mechanism is confirmed; the exact document state on
2026-08-11 is not recoverable.

**Alternatives considered**:

- *Sort tables so standard comes first, keeping first-wins.* Rejected: preserves an implicit
  ordering dependency and still silently accepts a non-standard row whenever no standard row
  exists for that model.
- *Last-wins instead of first-wins.* Rejected: the constitution records this exact choice as a
  past incident — the last tier parsed overwrote standard pricing with a 2× rate.

---

## R3. Rates that are not per-token at all

**Decision**: Reject a row whose table is not priced per token, determined from the same
extended caption context established in R1 plus the table's own column headers. Where a
source lists a model once per modality, select the modality the catalogue stores rather than
the first row encountered.

**Rationale**: Two classes of incomparable rate are currently stored as standard per-token
prices:

- `o4-mini-2025-04-16` appears **only** in the fine-tuning tables and is stored at `4.00`, a
  fine-tuning inference rate. Those tables carry a `Training` column priced `$100.00 / hour`.
- `gpt-image-2` is stored at `8.00`, its per-image generation rate, from a table that lists
  each model once per modality (`Image` and `Text` rows).

The per-second video tables are already excluded, but by accident of their column headers
rather than by design: they contain no `Input`/`Output` column, so an unrelated guard drops
them. A table that gained such a column would be ingested.

The unit is stated in the same bare-text context as the tier — `Prices per 1M tokens.`,
`Prices per second.`, `Prices per 1M tokens unless noted.` — so R1's mechanism supplies this
at no additional cost.

**Alternatives considered**:

- *Filter by model type after extraction.* Rejected: classification happens downstream and
  would let a wrong number into the catalogue first, violating Principle I. The row should
  never be recorded.
- *Keep excluding on column headers alone.* Rejected: it is the accident that currently works,
  not a rule.

---

## R4. Which statistic makes the published trend resistant to corrupted values

**Decision**: Compute the trend as a **median** across a fixed basket, not an unweighted mean.

**Rationale**: Measured on the stored history, the two statistics disagree on direction:

| Statistic | Then | Now | Direction |
|---|---|---|---|
| Unweighted mean | 3.9555 | 3.9612 | up 0.14% |
| Median | 0.680 | 0.680 | unchanged |
| Movers, counted | — | — | 10 down, 8 up |

The mean's rise is produced entirely by two models that happened to land on their high tier
on the final scrape. A median over the same data is unmoved by them, and agrees with both the
count of movers and with the typical model. The median also needs no tuning parameter, which a
trimmed mean or winsorised mean would.

The distribution is strongly right-skewed — median 0.68 against mean 3.96 — so the mean was
never describing the typical model even with clean data.

**Alternatives considered**:

- *Trimmed mean.* Rejected under Principle V: it introduces a trim fraction that must be
  chosen and justified, and buys nothing the median does not already give on this data.
- *Volume-weighted index.* Rejected: the project has no usage data, so any weighting would be
  invented — forbidden by Principle I.
- *Keep the mean and merely exclude corrupted models.* Rejected: it relies on detecting every
  corruption, which is the assumption that failed.

---

## R5. Keeping the basket stable across sample points

**Decision**: Restrict the trend basket to models that have a usable price at **every** sample
point in the window, and to token-priced text model types. Models entering or leaving the
catalogue mid-window are excluded from the trend rather than back-filled into it.

**Rationale**: The current series averages whatever models exist at each index, so a change in
membership is indistinguishable from a change in price. Fixing the statistic without fixing
the basket would leave a second, independent route to a fabricated direction.

This interacts with the documented back-fill, which currently pads a model's series with its
earliest known price for sample points before it was first observed. That back-fill is
explicitly labelled in the code as "an assumption, not data". Under a fixed basket it becomes
unnecessary for trend purposes, and excluding those models is the more truthful reading.

**Consequence to surface**: with the stored history spanning only 2026-08-11 to 2026-08-15,
a strictly-applied fixed basket over a 90-day window will be empty or near-empty. That is the
correct outcome under Principle I and is exactly what FR-017 is for — the card must say it
cannot tell, rather than draw a line. This is expected to make the out-of-scope "90-day axis
from four days of history" item resolve itself.

---

## R6. Detecting mixed-direction tier shifts

**Decision**: Add a check that flags on the **share of changed models whose ratio lands on an
exact tier-shaped value**, independent of direction, alongside the existing single-modal-ratio
check. Tier-shaped means a ratio drawn from a small fixed set of exact commercial multiples
(halves and doubles and their compounds), matched exactly rather than approximately.

**Rationale**: `checkPriceShift` blocks only when one modal ratio accounts for ≥80% of the
changes. Its docstring states the assumption it was built on: a mis-latched tier "moves *every*
model by exactly the same ratio". R1 and R2 show that assumption no longer holds, because the
tier is now selected per table — one run can move some models by 2× and others by 0.5×, and
uniformity falls below the threshold with nothing blocked.

Direction-independence is the whole point: a mixed run is *more* suspicious than a uniform
one, not less, because no real repricing moves a third of a catalogue by exact factors of two
in both directions at once.

Exact matching keeps the false-positive rate low. A genuine repricing landing on precisely
2.0000 for a quarter of a provider's catalogue is possible but rare, and the constitution
already provides the escape hatch: a blocking anomaly is overridable by an operator with the
existing force flag.

**Alternatives considered**:

- *Lower the uniformity threshold.* Rejected: it would flag genuine varied repricings, and
  still misses a clean 50/50 split between two tier ratios.
- *Cluster the ratio distribution and flag multi-modality.* Rejected under Principle V as
  more machinery than the problem needs; the suspicious ratios are a known, tiny, fixed set.
- *Alert without blocking.* Rejected: Principle I requires that a failed bulk plausibility
  check write nothing.

---

## R7. Bounding the chart's vertical scale

**Decision**: Floor the range each chart scales against, so the drawn amplitude is proportional
to relative change until that change is large enough to fill the box on its own. The floor is
expressed as a fraction of the series' own level, so it holds at any price magnitude.

**Rationale**: Both charts scale to the series' own min and max with a fallback that only
triggers on a *perfectly* flat series (`max - min || …`). Near-flat is the broken case: a
0.14% move is drawn as a full 76px climb, so the card's line contradicts its own badge and its
own endpoint labels, which both correctly read as unchanged.

The threshold is set to agree with the badge's existing definition of flat, so the two cannot
disagree by construction. That existing definition is the single source of truth for "flat";
duplicating the number in the chart would violate the one-formula-per-concept rule.

**Alternatives considered**:

- *Always scale from zero.* Rejected: it would make every genuine repricing invisible, trading
  a false signal for no signal.
- *Fixed absolute floor in dollars.* Rejected: wrong at both ends of a catalogue spanning
  $0.06 to $30 per million tokens.
- *Hide the chart when flat.* Rejected: the reader asked a question and "flat" is a real
  answer; a flat line is the honest way to give it.

---

## Open items carried into design

- The corrupted prices already stored between 2026-08-11 and 2026-08-15 are **not** corrected
  by this work. The extractor fix prevents recurrence; it does not restate history. The trend
  will continue to read those rows until a clean run overwrites them. Out of scope per spec,
  flagged here so it is not mistaken for done.
- The collection pipeline last recorded on 2026-08-15. Verifying the extractor fix end to end
  requires running it, which will write fresh prices; that run is the first opportunity to
  confirm SC-001 against real upstream content.
