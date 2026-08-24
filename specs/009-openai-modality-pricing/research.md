# Research: OpenAI Modality-Grouped Pricing Tables

No NEEDS CLARIFICATION markers remained in the Technical Context; research
below records the decisions and the evidence they rest on.

## D1 — Which row is the headline price

**Decision**: In any table with a Modality column, the row whose Modality
cell is Text (case-insensitive, tolerating "Text tokens") supplies the
headline input / cached-input / output prices. Row order is ignored.

**Rationale**: The catalogue's comparability rule is USD per 1M **text**
tokens, standard tier. Audio/image tokens are a different unit of
consumption. Prod history proves order is unstable: run 2026-08-22T15:21
stored the Text rows, run 2026-08-23T06:16 stored the Audio rows for the same
14 models against unchanged upstream prices — first-listing-wins is what
manufactured the 8x–16.7x phantom changes.

**Alternatives considered**:
- *Keep first-listing-wins* ("the numbers OpenAI leads with", the current
  code comment): rejected — the lead row proved to be presentation order, not
  a pricing statement, and it flip-flopped within a day.
- *Suffixed ids per modality* (`gpt-realtime:audio`): rejected previously in
  006 and still rejected — invented public identifiers are surface kept
  forever (constitution VI).
- *Lowest price wins*: rejected — arbitrary and dishonest for models whose
  text row is absent.

## D2 — Where preserved modality rates live

**Decision**: `pricing.raw.modalities`: an array, one entry per modality row,
carrying the modality label, the raw cells, and the parsed per-1M prices;
plus `raw.headlineModality` naming which entry supplied the headline. Stored
via the existing `raw_data` jsonb column.

**Rationale**: `raw_data` already exists for exactly this ("kept in raw_data"
precedent for cache-writes; grep confirms its only writer is
`src/pipeline/upsert.ts:161` and it has no readers) — so no schema change, no
API change, and the data is recoverable for a future audio-pricing surface.

**Alternatives considered**:
- *New columns / new table for per-modality prices*: rejected — speculative
  generality (constitution V); no feature consumes them yet.
- *Discard non-Text rows*: rejected by the user's explicit requirement to
  keep the information.

## D3 — Output column header

**Decision**: Widen the output-column pattern to also match "Output / cost"
exactly (i.e. `^output\s*(/\s*cost)?$` alongside the existing
`short context.*output` arm).

**Rationale**: OpenAI renamed the column in the grouped tables; the current
`^output$` arm misses it, which is why all 14 models publish null output
prices. An anchored optional suffix keeps the strictness that protects
against per-image/per-minute columns (`isTokenPricingTable` still rejects
tables whose headers price other units).

**Alternatives considered**: a looser `/output/` contains-match — rejected;
anchoring is what kept "Output tokens / minute"-style columns out before.

## D4 — Models with no usable Text row

**Decision**: If a grouped-table model has no Text row, or its Text cells
parse to nothing (e.g. "-"), the affected headline fields stay `null`. If the
model has *no* per-token headline price at all from its Text row, it is
admitted only if some headline field parsed; otherwise it is skipped exactly
as the current `if (!input && !output) continue` guard does — but evaluated
against the Text row, not the first row.

**Rationale**: Constitution I — a missing number beats a borrowed one.
Consequences accepted and recorded: `gpt-4o-mini-tts` moves from output=$12
(audio) to input=$0.60/output=null (text); `gpt-image-2` moves from
input=$8 (image) to input=$5/cached=$1.25/output=null (its Text row has "-"
for output). Both are the honest text-token reading, with the audio/image
rates preserved in `raw.modalities`.

**Known pre-existing issue, explicitly out of scope**: `tts-1` / `tts-1-hd`
price per 1M *characters* in the cell text ("$15.00 / 1M characters"); the
unit lives in the cell, not the header, so `isTokenPricingTable` cannot see
it and the value enters as a per-token price. That fault exists today,
predates this feature, and is not altered by it — noted for a follow-up spec.

## D5 — Scope of the change

**Decision**: All logic stays inside `openaiExtractor.extract` (helpers in
the same file). `markdown-table.ts`, `html-table.ts`, `normalize.ts` and
every other extractor are untouched; tables without a Modality column take
the identical code path they do today.

**Rationale**: Only OpenAI publishes this table shape today; generalising the
mechanism into shared helpers before a second consumer exists is speculative
generality (constitution V). FR-005's "byte-for-byte identical" is easiest to
prove when the non-modality path's code is not edited at all.
