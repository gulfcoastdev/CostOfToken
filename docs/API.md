# CostOfToken API — v1

Base URL: `/api/v1`

All prices are **USD per 1,000,000 tokens** unless a row's `currency` says
otherwise. `null` means the provider publishes no such tier; `0` means it is
genuinely free.

## Attribution — required

The API is free, including for commercial use, on one condition: display a
visible credit linking back wherever the data appears.

```html
Pricing data from <a href="https://www.costoftoken.com">CostOfToken</a>
```

Licensed under [ODC-BY 1.0](https://opendatacommons.org/licenses/by/1-0/).
Every response repeats the requirement in `meta.attribution` and in an
`X-Attribution-Required` header, so it is visible while integrating rather than
only in this document.

## Response envelope

Every successful response shares one shape:

```json
{
  "meta": {
    "version": "v1",
    "count": 3,
    "attribution": {
      "required": true,
      "text": "Pricing data from CostOfToken",
      "url": "https://www.costoftoken.com",
      "license": "https://opendatacommons.org/licenses/by/1-0/"
    },
    "total": 163,
    "limit": 100,
    "offset": 0,
    "updated_at": "2026-08-10T13:08:53.675Z"
  },
  "data": []
}
```

`count` is rows in this page; `total` is rows matching the filter.

Errors:

```json
{ "error": { "code": "invalid_parameter", "message": "..." }, "meta": { "version": "v1" } }
```

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_parameter` | Bad sort key, limit, offset, or numeric filter |
| 404 | `not_found` | Unknown model id |
| 429 | `rate_limited` | Hourly quota exhausted |
| 500 | `internal_error` | Query failed |

---

## `GET /prices`

Current prices for all tracked models.

| Param | Type | Notes |
| --- | --- | --- |
| `provider` | string | Repeatable or comma-separated: `?provider=openai,xai` |
| `type` | enum | Repeatable or comma-separated: `chat`, `embedding`, `moderation`, `tts`, `asr`, `image_gen`, `video_gen`, `ocr`, `realtime`, `other`. Unknown values return `400` |
| `modality` | string | `text`, `vision`, `audio`, `video`, `image` — **unreliable**, see below |
| `tag` | string | `flagship`, `fast`, `reasoning`, `coding`, `vision`, … |
| `q` | string | Substring match on model id or display name |
| `min_input`, `max_input` | number | Bounds on input price per 1M |
| `min_context` | number | Minimum context window in tokens |
| `sort` | enum | `provider`, `model`, `input`, `cached_input`, `output`, `context`, `updated` (default `input`) |
| `order` | enum | `asc` (default) or `desc` |
| `limit` | int | 1–500, default 100 |
| `offset` | int | ≥ 0, default 0 |
| `include_inactive` | bool | `true` to include delisted models |

Models with no price sort last in either direction, rather than clumping at the
top of an ascending sort.

```bash
curl 'https://<host>/api/v1/prices?provider=xai&sort=input&limit=3'
```

### Row fields

| Field | Type | Notes |
| --- | --- | --- |
| `provider`, `provider_name` | string | Slug and display name |
| `model_id`, `display_name` | string | |
| `description` | string \| null | Prose from whoever published it; `null` when no source stated one |
| `input`, `cached_input`, `output` | number \| null | Standard tier, per 1M tokens |
| `long_input`, `long_cached_input`, `long_output` | number \| null | Long-context tier |
| `long_context_threshold` | int \| null | Token count above which the long tier applies |
| `context_window`, `max_output_tokens` | int \| null | |
| `currency` | string | Usually `USD` |
| `tags` | string[] | |
| `modality` | string[] | **Unreliable** — mostly inferred from model names, not declared by vendors. Superseded by `model_type`. Not displayed anywhere on the site; served only so existing callers do not break. |
| `model_type` | string \| null | What kind of model it is. `null` means **not yet determined**, which is different from `other` (determined, none of the known kinds). |
| `classification_status` | string | `confirmed` or `needs_review`. A model is only typed when the evidence supports it — a name pattern alone never decides — so `needs_review` is a real and expected state. |
| `capabilities` | object \| null | What the model accepts and produces, recorded from a declaring source or a human. `null` means unknown; it is never `{}`, which would claim the model has no capabilities. |

### Filtering by model type

The default response is **unfiltered**: it returns every model it returned
before classification existed, non-generative ones included. Dropping models
from a published response would break existing callers, so the filter is
opt-in:

```bash
curl 'https://costoftoken.com/api/v1/prices?type=chat'          # text generators only
curl 'https://costoftoken.com/api/v1/prices?type=embedding,ocr' # several types
```

The site's own table and calculator default to `chat`, because ranking an
embedding or moderation endpoint by cost-per-token compares nothing — before
this existed, a moderation endpoint was the 4th cheapest model listed. Prices
are only comparable within a type: embeddings and moderation models have no
output price at all, and image and speech models are often billed per image or
per second rather than per token.
| `source_url` | string \| null | Document the price was read from |
| `source_kind` | enum | `scrape` = vendor's own page · `api` = reseller catalogue · `catalog` = curated |
| `updated_at` | string | ISO 8601 |

**Check `source_kind` before treating a price as authoritative.** `api` rows come
from OpenRouter, a reseller whose prices can differ from the vendor's own. See
the README for why those providers have no first-party source.

---

## `GET /prices/:model_id`

One model with its latest price. Returns the same row shape in a single-element
`data` array. `404` if unknown.

```bash
curl 'https://<host>/api/v1/prices/grok-4.5'
```

---

## `GET /history/:model_id`

Historical price points, newest first.

| Param | Type | Notes |
| --- | --- | --- |
| `limit` | int | 1–1000, default 365 |

History rows are recorded **only when a price actually changes**, so an
unchanged model returns a single point — its first recording — rather than one
row per day. Gaps between timestamps mean the price held steady.

```json
{
  "meta": { "version": "v1", "count": 2 },
  "data": [
    { "input": 4.0, "output": 6.0, "currency": "USD", "source_kind": "scrape", "recorded_at": "2026-08-10T13:08:53.675Z" },
    { "input": 2.0, "output": 6.0, "currency": "USD", "source_kind": "scrape", "recorded_at": "2026-08-10T13:08:29.689Z" }
  ]
}
```

---

## `GET /providers`

Tracked providers with active model counts — intended for building filter UIs.

```json
{ "meta": { "version": "v1", "count": 10, "total": 10 },
  "data": [{ "slug": "openai", "name": "OpenAI", "pricing_url": "…", "model_count": 20 }] }
```

---

## Cron status codes

`/api/cron/update-prices` returns:

| Status | Meaning |
| --- | --- |
| 200 | at least one provider succeeded |
| 409 | a provider's result was **blocked** by anomaly detection — the scrape ran, but the result was rejected as untrustworthy and previous prices were kept |
| 502 | every provider failed |

Both 409 and 502 are worth alerting on. 409 in particular means the data is
stale-but-correct rather than fresh-but-wrong, which is the safer failure but
still needs a human to look at the extractor.

---

## Rate limiting

- **Anonymous:** 60 requests/hour per IP (set by `RATE_LIMIT_ANON_PER_HOUR`).
- **With an API key:** per-key limit from the `api_keys` table.

Send a key as either header:

```
Authorization: Bearer <key>
X-API-Key: <key>
```

Only a SHA-256 hash of the key is stored. An unrecognised key silently degrades
to anonymous limits rather than erroring, so a rotated key doesn't hard-fail.

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset` (Unix seconds). A `429` adds `Retry-After` in seconds.

Windows are fixed and aligned to the hour, so the quota resets on the hour
rather than rolling.

---

## Caching

Successful responses send `Cache-Control: public, s-maxage=300,
stale-while-revalidate=3600`. Since the underlying data changes once a day, a
cached response is nearly always current.
