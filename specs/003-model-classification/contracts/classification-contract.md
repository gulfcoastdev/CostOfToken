# Contract: Classification, filtering and the public API

---

## The classifier

```ts
export type ModelType =
  | 'general' | 'embedding' | 'moderation' | 'tts' | 'asr'
  | 'image_gen' | 'video_gen' | 'ocr' | 'realtime' | 'other'

export interface Classification {
  modelType: ModelType | null
  status: 'confirmed' | 'needs_review'
  source: 'manual' | 'derived' | null
  note: string | null
}

export function classifyModel(model: NormalizedModel): Classification
```

**Guarantees**

| # | Rule |
|---|------|
| K1 | Pure — no I/O, no clock, no network. Same input, same output |
| K2 | Never returns a non-null `modelType` with `status: 'needs_review'` |
| K3 | Never returns `null` `modelType` with `status: 'confirmed'` |
| K4 | A name pattern alone never produces a `confirmed` type |
| K5 | A manual override always wins, and always reports `source: 'manual'` |
| K6 | `note` is non-null whenever `status` is `needs_review` |

---

## Persistence

**Guarantees**

| # | Rule |
|---|------|
| P1 | A re-run with unchanged inputs produces no classification change |
| P2 | A `manual` classification is never overwritten by a `derived` one |
| P3 | Classification never deletes or deactivates a model |
| P4 | `capabilities` is written only from a declared source or an override; never inferred |

---

## Site views

| Surface | Default | Escape |
|---------|---------|--------|
| Main table | `model_type = 'general'` | Type control lists every type present, plus the review set |
| Calculator / value rankings | `model_type = 'general'` only | none — ranking a non-generator by token cost is meaningless |
| Model page | unchanged; shows its type | — |

**Guarantees**

- The applied filter is visible; the reader is never silently shown a subset.
- Searching for a model outside the current view reports that it exists
  elsewhere rather than returning nothing (FR-012).
- Every model keeps its page and URL (FR-011).

---

## `GET /api/v1/prices`

**Unchanged by default.** A caller sending no new parameters receives exactly
the models it received before this feature — including the 32 non-chat ones.
Constitution VI forbids the alternative.

**Added**

| Parameter | Values | Behaviour |
|-----------|--------|-----------|
| `type` | any `ModelType`, repeatable/comma-separated | Restricts to those types. Unknown value → `400`, matching the existing `sort` behaviour |

**Added response fields** (additive, on every row):

```json
{
  "model_type": "chat",
  "classification_status": "confirmed",
  "capabilities": null
}
```

`capabilities: null` means unknown. It is never `{}`, which would imply "none".

---

## Review queue

```bash
npm run classify:review          # list models needing review
npm run classify:review -- --json
```

Prints each flagged model with provider, id, prices, the pattern that hinted a
type, and why it was not trusted — enough to decide without opening the vendor
page in most cases. Decisions are written to `data/overrides.ts`, which is
already the project's home for human corrections and is never overwritten by
the pipeline.

---

## Out of scope

Deriving capabilities, quality scores and rankings, per-image or per-second
price normalisation, and any change to model page layout.
