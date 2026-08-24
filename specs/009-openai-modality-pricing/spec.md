# Feature Specification: OpenAI Modality-Grouped Pricing Tables

**Feature Branch**: `009-openai-modality-pricing`

**Created**: 2026-08-25

**Status**: Draft

**Input**: User description: "Fix the OpenAI pricing extractor's handling of OpenAI's new 'Grouped Pricing Table' format (a Modality column with one row per modality per model, Audio listed first). Today the extractor's 'first listing wins' dedupe stores the Audio row's prices as the model's headline rate ($32 instead of $4 for gpt-realtime) and the output column header 'Output / cost' doesn't match the column regex, so output_price is null for ~14 realtime/audio models. Required behavior: when a table has a Modality column, prefer the Text modality row as the model's headline per-token pricing; preserve the other modality rows' prices (audio, image) so that information is not lost; and parse the 'Output / cost' header as the output price column. Non-Modality tables keep current behavior."

## Background

OpenAI's pricing page now presents realtime and audio models in a grouped
table with a **Modality** column — one row per modality per model, with the
Audio row listed first:

| Model | Modality | Input | Cached input | Output / cost |
| --- | --- | --- | --- | --- |
| gpt-realtime | Audio | $32.00 | $0.40 | $64.00 |
| gpt-realtime | Text | $4.00 | $0.40 | $16.00 |
| gpt-realtime | Image | $5.00 | $0.50 | - |

The extractor's "first row per model wins" rule, written for the old layout,
now stores whichever modality OpenAI happens to list first. Between the runs
of 2026-08-22 and 2026-08-23 that winner flipped from Text to Audio, which
published 8x–16.7x phantom "price changes" for 14 models, triggered
unsettled-price alerts, and left the site showing audio-token rates as the
headline price. Separately, the new column header "Output / cost" is not
recognised, so these models' output prices are published as unknown.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Headline price is the text-token rate (Priority: P1)

A visitor comparing model prices sees gpt-realtime listed at its text-token
rate ($4.00 input / $16.00 output per 1M tokens), the same basis every other
model on the site is priced on — not the audio-token rate ($32.00), which is a
different unit of consumption.

**Why this priority**: Wrong headline prices are live on the site today for
14 models, off by 8x–16.7x. This is the incident.

**Independent Test**: Run the extractor against a captured copy of the current
pricing page and assert the stored input/output prices for gpt-realtime equal
the Text row's values.

**Acceptance Scenarios**:

1. **Given** a pricing table with a Modality column where the Audio row
   precedes the Text row, **When** the extractor runs, **Then** the model's
   headline input, cached-input and output prices are the Text row's values.
2. **Given** the same table on two consecutive runs, **When** OpenAI reorders
   the modality rows between runs, **Then** the extracted headline prices do
   not change and no price-history entry is created.

---

### User Story 2 - Output prices are captured (Priority: P2)

A visitor viewing any realtime/audio model sees its output price populated
rather than blank.

**Why this priority**: All 14 affected models currently publish no output
price at all; a missing number is less harmful than a wrong one (so P2 behind
Story 1) but still a visible gap.

**Independent Test**: Run the extractor against the captured page and assert
gpt-realtime's output price is $16.00 (the Text row's "Output / cost" value).

**Acceptance Scenarios**:

1. **Given** a table whose output column is headed "Output / cost", **When**
   the extractor runs, **Then** that column is read as the output price.
2. **Given** a table whose output column is headed "Output" (old layout),
   **When** the extractor runs, **Then** behaviour is unchanged.

---

### User Story 3 - Non-text modality rates are preserved (Priority: P3)

Someone investigating a model's full cost (or a future feature displaying
audio pricing) can find the Audio and Image rows' rates attached to the
model's stored pricing record, rather than having that information silently
discarded.

**Why this priority**: Data preservation for audit and future use; no visitor-
facing surface changes yet.

**Independent Test**: Run the extractor against the captured page and assert
the stored record's raw data contains the Audio and Image rows' prices for
gpt-realtime.

**Acceptance Scenarios**:

1. **Given** a model with Audio, Text and Image rows, **When** the extractor
   runs, **Then** every modality row's prices are retained in the model's
   stored raw pricing data, labelled by modality.
2. **Given** a model appearing in a Modality table, **When** its stored record
   is inspected later, **Then** it is evident which modality supplied the
   headline price.

---

### Edge Cases

- A model in a Modality table with **no Text row** (e.g. a TTS model whose
  only per-token row is Audio, or tts-1 priced per 1M characters): the model
  must not inherit another modality's price as its headline rate. If no Text
  row exists, no headline per-token price is published for the fields the Text
  row would have supplied (a missing price beats a wrong one), while the other
  modality rows are still preserved in raw data.
- A Text row whose cells are all "-" (no per-token text price): treated the
  same as a missing Text row for the affected fields.
- Tables **without** a Modality column: behaviour is byte-for-byte identical
  to today, including the first-listing-wins rule for models repeated across
  separate tables.
- A model appearing both in a Modality table and later in a plain table (or
  vice versa): the first table encountered still wins, as today.
- Modality labels are matched case-insensitively ("Text", "text", "Text tokens").

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a pricing table contains a Modality column, the system MUST
  select the Text modality row as the source of the model's headline
  per-million-token prices (input, cached input, output), regardless of the
  order in which modality rows appear.
- **FR-002**: When a model in a Modality table has no Text row with a usable
  per-token price, the system MUST leave the corresponding headline price
  fields unknown rather than substituting another modality's values.
- **FR-003**: The system MUST recognise "Output / cost" (and the existing
  "Output") as the output-price column heading.
- **FR-004**: The system MUST preserve all modality rows' prices for a model
  in that model's stored raw pricing data, labelled by modality, so no
  scraped rate is lost.
- **FR-005**: Tables without a Modality column MUST be processed exactly as
  they are today.
- **FR-006**: The extracted result MUST be stable under reordering of
  modality rows within a table: reordering alone MUST NOT produce a price
  change or a price-history entry.
- **FR-007**: The fix MUST be verified against the real current OpenAI
  pricing page content (captured as a test fixture), reproducing the observed
  fault (Audio row winning, output price null) before the fix and the correct
  values after it.

### Key Entities

- **Modality-grouped pricing table**: a source table with a Modality column;
  a (model, modality) pair identifies a row. Text is the headline modality.
- **Headline pricing**: the per-1M-token prices published for a model —
  today sourced from exactly one row; under this spec, from the Text row.
- **Preserved modality rates**: the non-headline rows' prices, retained in
  the model's stored raw pricing data with their modality labels.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the next pipeline run, all 14 affected OpenAI
  realtime/audio models publish their text-token rates as headline prices
  (e.g. gpt-realtime $4.00 input, gpt-realtime-mini $0.60 input).
- **SC-002**: All affected models publish a non-blank output price matching
  their Text row (e.g. gpt-realtime $16.00 output).
- **SC-003**: Zero phantom price-change alerts caused by modality-row
  reordering in subsequent runs (reordering produces no history entries).
- **SC-004**: Every modality row scraped from a grouped table is recoverable
  from the model's stored raw data (100% of rows preserved).
- **SC-005**: Extraction results for every other provider and every
  non-Modality OpenAI table are unchanged.

## Assumptions

- The Text modality row is the correct comparable basis for headline pricing,
  because every other model on the site is priced per 1M text tokens.
- Displaying audio/image rates in the UI or API is out of scope; this feature
  only stops the data loss. A future feature can surface the preserved data.
- The stored raw pricing data (already carried with each price row) is an
  acceptable home for preserved modality rates; no schema change is needed.
- Existing prod rows holding audio-rate headline prices will self-correct on
  the next pipeline run after deployment; no manual data repair is planned,
  though the run will legitimately record one more price-history entry as
  prices return to text rates.
- OpenAI's markdown rendering of the pricing page remains the source; the
  grouped-table format observed on 2026-08-25 is the format to support.
