# CostOfToken

Daily-updated LLM API pricing, normalized across providers into one comparable
schema, with a public JSON API.

**Stack:** Next.js (App Router) · Vercel · Supabase Postgres

Everything below is implemented and verified end to end against a real
Postgres. The designed UI is deliberately still a placeholder — see
[Status](#status).

---

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and CRON_SECRET
npm run db:push                # apply db/schema.sql (idempotent)
npm run pipeline:run           # extract from all providers and populate
npm run dev
```

No database handy? `npm run pipeline:dry` extracts and validates every provider
without writing anything, and needs no `DATABASE_URL`.

### Local Postgres for development

```bash
docker run -d --name cot-pg \
  -e POSTGRES_PASSWORD=devpw -e POSTGRES_DB=costoftoken \
  -p 55432:5432 postgres:16-alpine

# .env.local
DATABASE_URL="postgresql://postgres:devpw@127.0.0.1:55432/costoftoken"
CRON_SECRET="local-dev-secret"
```

---

## How pricing is collected

Provider pages vary enormously, so extractors are tiered by what each vendor
actually publishes. Verified live on 2026-08-10:

| Provider | Source | How |
| --- | --- | --- |
| OpenAI | first-party | HTML table, two-row colspan header (short/long context) |
| Anthropic | first-party | HTML table, `$10 / MTok` cells |
| Google | first-party | HTML, one transposed table per model, four tier tables each |
| xAI | first-party | **structured JSON** embedded in the docs RSC payload |
| Zhipu (GLM) | first-party | HTML table on the international (USD) docs |
| DeepSeek, Alibaba (Qwen), Moonshot (Kimi), ByteDance, Baidu | secondary | OpenRouter catalogue |

**xAI** is the highest-fidelity source: its docs embed a full model catalogue
(prices, context window, modalities, aliases) as JSON. Prices there are
integers in 1e-4 USD per 1M tokens — `20000` renders on xAI's own pricing page
as `$2.00 / 1M tokens`, which is how the divisor was confirmed rather than
guessed.

### About the secondary source

Five providers have no machine-readable first-party pricing: their consoles are
client-rendered, their docs are mainland-only, or the documented URL has moved
(DeepSeek's `quick_start/pricing` now redirects to "Your First API Call").
Those fall back to the OpenRouter catalogue.

**OpenRouter is a reseller, not the vendor.** Its quoted price can differ from
first-party pricing — at time of writing it lists GLM-5.2 at $0.76/1M input
where Zhipu's own page says $1.40/1M. So:

- Fallback rows are tagged `source_kind: "api"` and their `source_url` points at
  OpenRouter, so consumers can see the provenance.
- A fallback never overrides a first-party extractor.
- First-party models also borrow *context windows* from that catalogue when
  their pricing page omits them — metadata only, never a price, and only on an
  exact model-id match. A model that doesn't match keeps `null` rather than
  inheriting a neighbour's number.

### Standard tier only

Vendors publish Batch, Flex, and Priority tiers alongside standard rates. Batch
is typically 50% off and asynchronous. Comparing one vendor's batch price
against another's standard price would make the whole table wrong, so
non-standard tiers are skipped. Tracking them as separate, labelled tiers is a
natural next step.

### Data-quality guards

The pipeline's failure mode is quietly publishing wrong numbers, so:

- **A currency symbol is required.** Anthropic's "Bash tool" table has an
  "Additional input tokens" column reading `325 tokens`; a permissive parser
  stored that as $325/1M. Prices must look like money.
- **Sanity ceiling.** Anything above $10,000/1M is rejected as a misparse (a
  context window read as a price).
- **Empty means broken.** An extractor returning zero models is treated as a
  failure, not an empty catalogue — a silent layout change looks identical
  otherwise.
- **Failures write nothing.** A provider that errors keeps its last known
  prices. Yesterday's price beats a gap or a row of nulls.
- **Zero ≠ null.** A free tier is a real price of `0`; an unavailable tier is
  `null`.

---

## Data model

`providers` → `models` → `prices` (one current row per model), plus append-only
`price_history`, an `extraction_runs` log, and `api_keys` / `api_rate_limits`.

History is written by a **database trigger** on `prices`, not by application
code, so it's recorded no matter what changes a price. The trigger skips writes
where no price field moved — verified: a second identical pipeline run reports
0 changes and adds 0 history rows.

Full DDL: [`db/schema.sql`](db/schema.sql).

---

## Public API

Base URL `/api/v1`. Full reference: [`docs/API.md`](docs/API.md).

```
GET /api/v1/prices                       # all current prices
GET /api/v1/prices?provider=openai       # filter
GET /api/v1/prices/:model_id             # one model
GET /api/v1/history/:model_id            # price history
GET /api/v1/providers                    # providers + model counts
```

```json
{
  "meta": { "version": "v1", "count": 3, "total": 163, "updated_at": "2026-08-10T13:08:53.675Z" },
  "data": [
    {
      "provider": "xai",
      "model_id": "grok-4.5",
      "input": 2.0,
      "cached_input": 0.3,
      "output": 6.0,
      "context_window": 500000,
      "long_context_threshold": 128000,
      "long_input": 4.0,
      "source_kind": "scrape",
      "updated_at": "2026-08-10T13:08:40.970Z"
    }
  ]
}
```

Rate limited to 60 requests/hour per IP (configurable), with higher per-key
limits via the `api_keys` table. Returns `429` with `Retry-After` and
`X-RateLimit-*` headers. Counters live in Postgres — no Redis to provision — and
the limiter **fails open**, since a limiter that 500s would take the whole
public API down with it.

---

## Daily updates

Vercel Cron hits `/api/cron/update-prices` at 06:00 UTC ([`vercel.json`](vercel.json)),
authenticated with `Authorization: Bearer $CRON_SECRET` and compared in constant
time.

Providers run sequentially and fail independently. The route returns `200` with
a per-provider report whenever at least one provider succeeded, and `502` only
if every one failed — so a single broken vendor page doesn't page anyone at 6am.

```bash
npm run pipeline:dry                    # all providers, no writes
npm run pipeline:dry -- --only=xai      # one provider
npx tsx scripts/inspect.ts anthropic    # dump parsed rows to eyeball
```

`maxDuration` is 300s, which requires a Vercel plan above Hobby (60s ceiling).

---

## Corrections

`data/overrides.ts` patches facts a vendor page states wrongly or omits
(context windows, tags, display names), keyed by provider + model id.

Prices are deliberately **not** overridable there: a hand-edited price is
indistinguishable from a fresh scrape once it's in the table, which silently
defeats a freshness tracker. When a price is wrong, fix the extractor.

---

## Tests

```bash
npm test        # parsing, validation, table/payload decoding
npm run typecheck
```

15 tests covering the logic where a silent regression publishes wrong prices:
unit rescaling, currency handling, colspan headers, heading breadcrumbs, and
the xAI payload decoder. They're regression guards for bugs found during
development — including one where a `}` inside a model description corrupted
the brace matcher.

---

## Status

**Done and verified:** schema + triggers, all 10 provider extractors (163 models
live), normalization, enrichment, upsert with history, all API endpoints,
rate limiting, cron auth, per-provider soft-fail.

**Placeholder:** the web UI. `src/app/page.tsx` is an unstyled server-rendered
table that exists to prove the data path end to end. Filters, sorting,
search, the current/historical toggle, and the real design are the next
milestone.

**Known gaps:**
- ByteDance and Baidu resolve to 1 model each — OpenRouter barely carries them.
  Both need first-party extractors, likely browser-driven.
- Context windows are `null` where the metadata catalogue has no exact match
  (10/20 OpenAI, 16/29 Google). `data/overrides.ts` is the intended fix.
- Non-USD pricing is stored in its published currency with no FX conversion;
  the USD international pages are preferred where they exist.
- Batch/Flex/Priority tiers are skipped rather than tracked.
