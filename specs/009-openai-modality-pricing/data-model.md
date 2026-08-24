# Data Model: OpenAI Modality-Grouped Pricing Tables

No database schema changes. The only shape change is inside the untyped
`pricing.raw` audit payload (`prices.raw_data` jsonb).

## Existing entities (unchanged)

- **NormalizedModel / PricingInfo** (`src/lib/types.ts`): headline price
  fields (`inputPrice`, `cachedInputPrice`, `outputPrice`, long-context
  variants, `currency`, `sourceUrl`, `sourceKind`, `raw`) keep their types.
  For grouped-table models the values now come from the Text row.
- **prices / price_history** (`db/schema.sql`): untouched. The
  material-change trigger gives FR-006 for free — identical extracted values
  produce no history row.

## Changed: `pricing.raw` for grouped-table models

Today (one captured row):

```json
{
  "caption": "Grouped Pricing Table data",
  "labels": ["…"],
  "headers": ["Model", "Modality", "Input", "Cached input", "Output / cost"],
  "row": ["gpt-realtime", "Audio", "$32.00", "$0.40", "$64.00"],
  "page": "https://platform.openai.com/docs/pricing"
}
```

After — `row` is replaced by `modalities` (only in tables that have a
Modality column; non-modality tables keep emitting `row` unchanged):

```json
{
  "caption": "Grouped Pricing Table data",
  "labels": ["…"],
  "headers": ["Model", "Modality", "Input", "Cached input", "Output / cost"],
  "headlineModality": "text",
  "modalities": [
    { "modality": "audio", "row": ["gpt-realtime", "Audio", "$32.00", "$0.40", "$64.00"],
      "inputPrice": 32, "cachedInputPrice": 0.4, "outputPrice": 64 },
    { "modality": "text",  "row": ["gpt-realtime", "Text", "$4.00", "$0.40", "$16.00"],
      "inputPrice": 4, "cachedInputPrice": 0.4, "outputPrice": 16 },
    { "modality": "image", "row": ["gpt-realtime", "Image", "$5.00", "$0.50", "-"],
      "inputPrice": 5, "cachedInputPrice": 0.5, "outputPrice": null }
  ],
  "page": "https://platform.openai.com/docs/pricing"
}
```

### Field rules

- `modality`: the Modality cell, lowercased and trimmed (`"text"`, `"audio"`,
  `"image"`, …). Whatever the vendor writes is preserved in `row`; the
  normalized label is for lookup.
- `headlineModality`: `"text"` when a Text row supplied the headline prices;
  `null` when no usable Text row existed (headline fields are then null).
- Per-modality `inputPrice` / `cachedInputPrice` / `outputPrice`: parsed
  through the same `parsePricePerMillion` as headline prices; `null` when the
  cell does not parse as money. `0` and `null` stay distinct.
- Every body row of the model is preserved — including rows whose prices all
  fail to parse (their parsed fields are null, the raw cells remain).

### Validation / invariants

- FR-002: headline fields are exactly the Text entry's parsed values —
  asserted equal in tests, never sourced from another entry.
- FR-004: `modalities.length` equals the number of table rows for that model.
- FR-006: output is a pure function of table content; row order affects
  neither headline fields nor which entry is headline (`modalities` keeps
  document order, which is presentation, not pricing).

`raw_data` is write-only audit data (single writer `src/pipeline/upsert.ts`,
no readers), so this reshaping breaks no consumer and is not a public
contract.
