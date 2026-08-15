# Phase 1 Data Model: Model Type and Capability Classification

Additive changes to `models`, plus the enum and the read shape. No table is
created, no column is dropped, nothing is backfilled destructively.

---

## `model_type` (enum, as a check constraint)

| Value | Means |
|-------|-------|
| `general` | Generates text in response to a prompt. The default view |
| `embedding` | Returns vectors |
| `moderation` | Returns classifications, not content |
| `tts` | Text to speech |
| `asr` | Speech to text |
| `image_gen` | Generates images |
| `video_gen` | Generates video |
| `ocr` | Extracts text from images or documents |
| `realtime` | Streaming/bidirectional speech-to-speech sessions |
| `other` | A real kind we have no bucket for |

`null` is distinct from `other`: **null means not yet determined**, `other`
means determined and none of the above. That distinction is the whole reason
the column is nullable — the existing `modality` column has a non-null default
and therefore cannot express doubt, which is part of why it is untrustworthy.

---

## New columns on `models`

| Column | Type | Notes |
|--------|------|-------|
| `model_type` | `text`, nullable, checked against the enum | Null until determined |
| `classification_status` | `text` not null, default `'needs_review'` | `confirmed` \| `needs_review` |
| `classification_source` | `text`, nullable | `manual` \| `derived` — how the type was reached |
| `classification_note` | `text`, nullable | Why review is needed, for the queue |
| `capabilities` | `jsonb`, nullable | Recorded, never derived. Null means unknown |

**Rules**

- `classification_status = 'confirmed'` requires a non-null `model_type`.
- `model_type IS NULL` implies `classification_status = 'needs_review'`.
- `classification_source = 'manual'` MUST NOT be overwritten by a later
  automatic run (FR-006).
- `capabilities` is written only from a declaring source or a human record.
  Absence is represented as `null`, never as an empty object implying "none".

### View

`v_current_prices` gains `model_type`, `classification_status` and
`capabilities`, **appended at the end** of the select list — `create or replace
view` can only add columns at the end, and the schema file must stay
re-runnable against a deployed database. The file already carries this warning
for the `description` column.

---

## `capabilities` shape

Recorded when known:

```json
{
  "input": ["text", "image"],
  "output": ["text"],
  "features": ["reasoning", "tool_use"]
}
```

| Key | Meaning |
|-----|---------|
| `input` | Kinds the model accepts |
| `output` | Kinds it produces |
| `features` | Notable abilities: `reasoning`, `coding`, `vision`, `tool_use` |

A missing key means unknown, not empty. Nothing in the UI may render an
absent capability as a negative claim ("no vision") — only as unstated.

---

## Classification input

The pure classifier takes what the pipeline already has:

| Field | Used for |
|-------|----------|
| `modelId` | Non-chat name patterns (never sufficient alone) |
| `providerSlug` | Looking up a manual override |
| `pricing.inputPrice` / `outputPrice` | Price-shape evidence |
| declared modalities, where a source provides them | Confirming `general` |

Output:

```ts
{
  modelType: ModelType | null
  status: 'confirmed' | 'needs_review'
  source: 'manual' | 'derived' | null
  note: string | null
}
```

---

## Rule table

First match wins. See [research R2](./research.md#r2--the-rules).

| # | Condition | `modelType` | `status` | `source` |
|---|-----------|-------------|----------|----------|
| 1 | Manual override present | override's | `confirmed` | `manual` |
| 2 | Non-chat pattern **and** no output price | matched type | `confirmed` | `derived` |
| 3 | Non-chat pattern **and** output price present | `null` | `needs_review` | `null` |
| 4 | No non-chat pattern **and** input and output both priced | `general` | `confirmed` | `derived` |
| 5 | Otherwise | `null` | `needs_review` | `null` |

### Non-chat patterns

Matched against `model_id`, case-insensitive, each mapping to one type:

| Pattern | Type |
|---------|------|
| `embed` | `embedding` |
| `moderation`, `guard` | `moderation` |
| `tts`, `speech` (not `speech-to`) | `tts` |
| `whisper`, `transcribe`, `asr`, `speech-to-text` | `asr` |
| `image` | `image_gen` |
| `video`, `veo`, `sora` | `video_gen` |
| `ocr` | `ocr` |
| `realtime`, `-audio` | `realtime` |
| `rerank` | `other` |

A pattern is a *hint*. Rules 2 and 3 decide whether the hint is trusted.

---

## Expected outcome on today's catalogue

Measured 2026-08-15, 225 active models:

| Bucket | Count | Examples |
|--------|------:|----------|
| `general`, confirmed | ~193 | the bulk of the catalogue |
| Non-chat, confirmed (rule 2) | 15 | `text-embedding-3-small`, `omni-moderation-latest`, `gpt-realtime`, `tts-1`, `gemini-embedding` |
| Flagged (rule 3) | 17 | `gpt-image-1`, `gemini-3-pro-image`, `glm-ocr`, `gemini-2.5-flash-preview-tts` |

The 17 flagged are a one-time human pass through `data/overrides.ts`. That is
the honest result: each has a non-chat name but also an output price, so the
two signals disagree and nothing may decide it automatically.

---

## Validation rules, collected

Asserted by tests before the code exists:

1. A manual override always wins, whatever the other signals say.
2. Non-chat pattern + no output price yields that type, `confirmed`.
3. Non-chat pattern + output price yields `null` and `needs_review`.
4. No non-chat pattern + both prices yields `general`, `confirmed`.
5. A model with neither price is `needs_review`, never `general`.
6. Across the whole catalogue, every model is typed or flagged — no model has
   `model_type IS NULL` with `classification_status = 'confirmed'`.
7. No cost ranking contains a model whose `model_type` is not `general`.
8. `/api/v1/prices` with no new parameters returns the same model count as
   before the change.
