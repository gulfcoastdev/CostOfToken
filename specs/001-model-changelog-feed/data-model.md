# Phase 1 Data Model: Model Changelog Feed

**No schema change.** Every field the feed needs already exists. This document
describes the read model derived from the existing tables and the in-memory
shape the renderer consumes.

---

## Source tables (existing, unchanged)

| Table | Fields used | Role |
|-------|-------------|------|
| `models` | `id`, `provider_id`, `model_id`, `display_name`, `description`, `context_window`, `created_at` | `created_at` is the "model added" event; the rest is entry content |
| `providers` | `id`, `slug`, `name` | Entry attribution and the `provider` filter |
| `prices` | `model_id`, all price columns, `currency`, `source_url`, `source_kind` | Fallback launch prices when a model has no history row |
| `price_history` | `id`, `model_id`, all price columns, `currency`, `source_url`, `source_kind`, `recorded_at` | One row per material price move; `id` is the event's permanent identity |

Relevant existing guarantees this feature depends on:

- `record_price_history()` writes a row **only** when a price column, or the
  currency, actually differs from the previous value. A re-scrape of identical
  numbers writes nothing. (FR-006 comes free.)
- The same trigger is `after insert or update`, so a model's **first** history
  row is written by the insert that creates its price. That row is excluded
  from price-change events. (FR-005.)
- `price_history.id` is `bigserial` and `models.id` is `uuid`; both are
  immutable for the life of the row, which is what makes stable guids possible.
  (FR-007.)
- Index `price_history_model_time_idx (model_id, recorded_at desc)` already
  supports the per-model ordering the window function needs.

---

## Derived entity: `FeedEvent`

One row of the feed's read model. Produced by `getFeedEvents(filters)` in
`src/lib/queries.ts`; consumed by the pure renderer in `src/lib/feed.ts`.

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `'model_added' \| 'price_change'` | Drives title shape, body shape and `<category>` |
| `id` | `string` | `price_history.id` for a change, `models.id` for an addition. Immutable; unique within its kind |
| `occurredAt` | ISO 8601 string | `price_history.recorded_at` or `models.created_at` → `<pubDate>` |
| `provider` | `string` | Provider slug — used for the model link and the `provider` filter |
| `providerName` | `string` | Human name, used in titles |
| `modelId` | `string` | API identifier, shown as code in the body |
| `displayName` | `string` | Human name, used in titles |
| `description` | `string \| null` | Vendor prose. **Untrusted**: escaped and capped at 400 chars before rendering |
| `contextWindow` | `number \| null` | Shown on addition entries |
| `currency` | `string` | Defaults `'USD'`; stated in price-change bodies |
| `sourceUrl` | `string \| null` | Provider pricing page, linked from the body |
| `sourceKind` | `'scrape' \| 'api' \| 'catalog' \| null` | `'api'` adds the OpenRouter reseller caveat (FR-018) |
| `prices` | `FeedPrices` | Values **after** the event |
| `previous` | `FeedPrices \| null` | Values **before** a change; `null` for an addition |

### `FeedPrices`

USD per 1M tokens, standard tier. Five fields, each `number \| null`:
`input`, `cachedInput`, `output`, `longInput`, `longOutput`.

Value conventions, unchanged from the rest of the site (FR-017):

| Value | Means | Rendered |
|-------|-------|----------|
| `null` | Not published | "not published" |
| `0` | Genuinely free | "free" |
| `n > 0` | USD per 1M tokens | `$5.00` (`$0.150` below $1) |

`long_cached_input_price` exists in the schema but is deliberately omitted:
it is populated for almost no model, and a fifth rarely-moving field would
lengthen titles for no reader benefit.

---

## Derived entity: `PriceDelta`

Computed purely from a `FeedEvent` — never queried. One per price field that
actually moved, in a fixed field order so titles read consistently.

| Field | Type | Notes |
|-------|------|-------|
| `label` | `string` | `Input`, `Cached input`, `Output`, `Long-context input`, `Long-context output` |
| `from` | `number \| null` | Previous value |
| `to` | `number \| null` | New value |
| `percent` | `number \| null` | `null` when meaningless: `from` is `null` or `0` |

Rendering rules:

| Case | Reads as |
|------|----------|
| `from` and `to` known, `percent ≠ 0` | `down 67% to $5.00` |
| `from` and `to` known, rounds to 0% | `down to $4.99` |
| `from` is `null`, or `from` is `0` | `now $5.00` |
| `to` is `null` | `no longer published` |

---

## Query shape

One statement, no round trip per entry:

```
with hist as (
  -- every price_history row, plus lag() of each price column and a
  -- row_number(), both partitioned by model_id ordered by (recorded_at, id)
),
events as (
      -- price_change: hist rows where row_number > 1 and some price column
      --               is distinct from its lag
  union all
      -- model_added: models joined to providers, with launch prices from a
      --              lateral first-history-row, falling back to prices
)
select * from events
 where <optional provider filter> and <optional kind filter>
 order by occurred_at desc, kind asc, event_id desc
 limit <1..200>
```

Both `union all` branches must select the same 22 columns in the same order;
the addition branch supplies `null::numeric` for the five `prev_*` columns.

**Ordering**: `occurred_at desc` is the feed's contract (FR-009). `kind, id`
break ties deterministically — necessary because the initial import gave 217
models an identical `created_at`, and a feed whose order shuffles between
fetches makes readers re-render entries.

**Filters**: `provider = any($1)` and `kind = $2`, both optional; `limit`
clamped to `1..200` before it reaches SQL.

---

## Volume (measured 2026-08-14, local database)

| Quantity | Count |
|----------|-------|
| Models | 221 |
| Models sharing the initial-import timestamp (2026-08-11) | 217 |
| `price_history` rows | 385 |
| Models with more than one history row | 84 |
| Resulting `price_change` events | ~164 |
| Resulting `model_added` events | 221 |

At ~385 total scanned rows the window function is trivially cheap. The table
grows only when prices actually move, so no partitioning or event-table
materialisation is warranted; revisit if `price_history` passes ~100k rows.
