# Contract: Tier and Unit Admission

**Feature**: 006-truthful-price-trend

This is the internal contract between the document parser, the tier/unit classifier, and every
extractor. It is not a public API surface — no `/api/v1` field, response envelope, or exported
identifier changes. It is written as a contract because four extractors depend on it and a
change here silently changes what the catalogue contains.

---

## C1. Parser → classifier

The parser MUST supply, for every table it emits, the bare text lines that precede that table's
heading, nearest first, in addition to the existing heading breadcrumb.

**Guarantees**:

- Heading breadcrumb semantics are unchanged. Existing positional reads of it (Google's model
  name lives above its tier heading) continue to resolve identically.
- A table with no preceding bare text yields an empty list, never an error.
- The lines are cleaned by the same rules as table cells, so escaped characters and link
  markup cannot leak into a tier decision.
- Prose-length lines are excluded, so a repeated explanatory paragraph is not mistaken for a
  label.

**Non-guarantee**: the parser does not interpret the lines. It reports what is there; the
classifier decides what it means.

---

## C2. Classifier → extractor

Given a table, the classifier MUST return exactly one tier of `standard`, `non_standard`,
`unknown`, and exactly one unit of `per_token`, a named non-token unit, or `unknown`.

**Guarantees**:

- Deterministic: the same table yields the same verdict every time.
- Order-independent: the verdict does not depend on the table's position in the document, nor
  on any table seen before or after it, except for the sole-table rule below.
- Evidence is drawn from headings and labels only, never from the prices themselves. A
  classifier that reasoned from values could reclassify a real 50% price cut as a batch table.
- Absence of evidence yields `unknown`, never `standard`.

**Sole-table rule**: where a provider's document contains no tier vocabulary anywhere, its
single pricing table is `standard`. This prevents providers that have never published a batch
tier from being rejected wholesale. It is the one document-scoped judgement in the classifier
and MUST be evaluated from the whole document, not from table order.

---

## C3. Extractor → pipeline

An extractor MUST emit at most one record per model id per run, and that record MUST be
`standard` tier and `per_token` unit.

**Guarantees**:

- **Determinism** (FR-005): two runs over byte-identical source content emit identical records.
- **Order independence** (FR-006): two runs over source content differing only in the order of
  its tables emit identical records.
- **No silent downgrade** (FR-003): a model appearing only in non-standard or non-token tables
  is omitted entirely. It is never recorded at a non-standard rate.
- **Single value** (FR-007): duplicate candidates are resolved by tier, then unit, then
  modality — never by document order.

**Failure mode**: an extractor that can positively classify no table returns zero models. Per
Principle I and the existing pipeline contract, zero models is a failure, not an empty
catalogue, and the provider keeps its last known-good prices.

---

## C4. Anomaly detector → pipeline

The detector MUST report a blocking anomaly when an implausible share of a provider's changed
models moved by exact tier-shaped ratios, regardless of whether those ratios agree in
direction.

**Guarantees**:

- Existing codes are unchanged in meaning, severity, and firing conditions (FR-009). A run
  that blocks today still blocks.
- Provider-agnostic and shape-based (FR-011): no per-provider configuration, so a new provider
  inherits the check.
- A genuine repricing of varied, non-tier-shaped sizes does not fire it (FR-010).
- A blocking anomaly writes nothing and records its finding (FR-012), via the existing
  mechanism. The existing operator override continues to apply.

**Minimum evidence**: the check does not fire below a floor on the absolute number of changed
models, so a provider with two models cannot trip it by coincidence.

---

## C5. Query → trend card

The trend series MUST be computed as a median over a basket fixed across all sample points, and
MUST report insufficiency rather than a figure when the basket cannot support one.

**Guarantees**:

- Only model types the catalogue prices per token contribute (FR-014).
- Basket membership is identical at every sample point (FR-015), so a membership change cannot
  present as a price change.
- The series continues to be computed over the reader's active filters rather than the narrowed
  popular scope (FR-016), preserving the existing documented intent.
- Where the basket is too small or too sparse, the card states that it cannot tell (FR-017). It
  does not draw an empty line, a zero line, or a flat line standing in for absent data.

**Consumers**: the trend card's line, badge, and endpoint labels all derive from this one
series and one definition of "flat", so they cannot contradict one another (FR-020).

---

## C6. Chart rendering

Both the trend chart and the per-model indicator MUST bound the range they scale against, so a
movement below the card's own flat threshold is drawn as visually negligible, while a large
movement stays clearly legible.

**Guarantees**:

- The threshold is the same value the badge uses to decide "flat" — one definition, two
  consumers, per Principle V's one-formula-per-concept rule.
- The floor is relative to the series' level, so it holds across a catalogue spanning
  $0.06 to $30 per million tokens.
- A perfectly flat series continues to render without dividing by zero.

---

## Compatibility

| Surface | Impact |
|---|---|
| `db/schema.sql` | none |
| `/api/v1` envelope and fields | none |
| `llms.txt`, `llms-full.txt`, feeds, sitemap, JSON-LD | none structurally; values become more trustworthy |
| `prices.raw_data` | additive — records the labels the tier decision was made from |
| Exported extractor interface | additive — one field on the table type |

**Existing test requiring deliberate amendment**: `tests/extractors.test.ts` asserts *"a
repeated model keeps the first tier, not the last"*, encoding the order-dependence this feature
removes. Per Principle II a test may not be weakened to make a change pass, so it must be
amended deliberately: the scenario it guards — two colliding tables under an unrecognised tier
heading — now resolves to `unknown` and records nothing, rather than silently taking the first.
The amended test MUST continue to guard against the original incident, that the *last* table
must never win.
