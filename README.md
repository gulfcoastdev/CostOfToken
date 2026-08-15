# CostOfToken

Daily-updated LLM API pricing, normalized across providers into one comparable
schema, with a public JSON API.

**Stack:** Next.js (App Router) · Vercel · Supabase Postgres

Everything below is implemented and verified end to end against a real
Postgres — pipeline, API, and the comparison UI. See [Status](#status) for
what is not yet production-ready.

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

### Two databases without mixing them up

Keep the remote under a **different name**, never a second `DATABASE_URL`. Env
files do not merge duplicate keys or warn about them — the last definition
silently wins, so a stray second `DATABASE_URL` makes every "local" command
write to production.

```bash
# .env.local
DATABASE_URL="postgresql://postgres:devpw@127.0.0.1:55432/costoftoken"  # default
SUPABASE_DB_URL="postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:6543/postgres"
```

Every command defaults to `DATABASE_URL` and reaches the remote only with an
explicit `--remote`:

```bash
npm run db:status               # LOCAL
npm run db:status -- --remote   # REMOTE, with row counts
npm run db:push     -- --remote
npm run pipeline:run -- --remote
```

Writes print `LOCAL` or `REMOTE` with the host first, so the target is visible
before anything changes. On Vercel only one URL exists, so the flag is
irrelevant there and the app reads whichever variable is set.

---

## How pricing is collected

Provider pages vary enormously, so extractors are tiered by what each vendor
actually publishes. Verified live on 2026-08-10:

| Provider | Source | How |
| --- | --- | --- |
| OpenAI | first-party | **markdown** (`.md` suffix on the docs URL) |
| Anthropic | first-party | **markdown** (`.md` suffix) |
| Zhipu (GLM) | first-party | **markdown** (`.md` suffix), international USD docs |
| xAI | first-party | **structured JSON** embedded in the docs RSC payload |
| Google | first-party | HTML, one transposed table per model, four tier tables each |
| DeepSeek, Alibaba (Qwen), Moonshot (Kimi), ByteDance, Baidu | secondary | OpenRouter catalogue |

### Prefer markdown over HTML

Several docs sites serve a markdown rendering by appending `.md` to the page
URL (or sending `Accept: text/markdown`). Where it exists, use it — it is not
merely tidier, it is *more correct*:

- **Tiers become structure.** OpenAI's HTML renders Standard / Batch / Flex /
  Fast as tabs. Tab labels aren't headings, so no parser can tell the tiers
  apart — and because only the selected tab is in the document, most rows are
  missing. The markdown has `### Standard pricing data` as a real heading.
- **Coverage.** OpenAI's HTML exposed 13 models; the markdown lists 73.
- **Size.** 20KB instead of 543KB.

Switching Anthropic and Zhipu to markdown produced byte-identical output to
the HTML parser, which is a useful check that the markdown reader is faithful.

Google, DeepSeek and xAI have no `.md`; xAI needs none, as its docs embed the
whole catalogue as JSON.

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

### Anomaly detection

Per-row validation catches implausible values, but the failures this project
actually hit produced entirely plausible rows and reported `ok`:

- OpenAI's HTML exposed 13 of 73 models, because the rest lived in unselected
  tabs. A "successful" run silently dropped 80% of a provider.
- Every OpenAI price was the Priority tier — exactly 2x standard — because four
  tier tables shared a heading and the last one won.

Neither is visible from a status code, an exception, or any single row. They
are only detectable by comparing a run against what the provider looked like
yesterday, which is what [`src/pipeline/anomaly.ts`](src/pipeline/anomaly.ts)
does before anything is written:

| Check | Fires when | Severity |
| --- | --- | --- |
| `coverage_drop` | model count falls below 60% of baseline (85% warns) | block |
| `uniform_price_shift` | ≥80% of changed prices move by the *same* exact factor | block |
| `field_collapse` | a column populated for >50% of models becomes <10% | block |
| `mass_price_change` | over half the models change price, by varying amounts | warn |

A blocking anomaly means **nothing is written** — the provider keeps its last
known-good prices, matching the rule that a failure never replaces good data.
The cron route returns `409`, the CLI exits `2`, and the finding is stored in
`extraction_runs.anomalies`.

The uniformity test is what separates a parsing fault from real news. A vendor
repricing moves models by differing amounts; a scraper that latched onto the
wrong tier moves *every* model by exactly 0.5x or 2x. Genuinely varied changes
warn but still write.

When a flagged change is real, re-run with `--force` (CLI) or `?force=true`
(cron). The anomaly is still recorded, so the override leaves a trail.

```
openai       blocked   scrape   73      0        596ms
  BLOCK coverage_drop: Model count fell 62% (193 → 73). The source layout probably changed.
```

### Data-quality guards

The pipeline's failure mode is quietly publishing wrong numbers, so:

- **A currency symbol is required.** Anthropic's "Bash tool" table has an
  "Additional input tokens" column reading `325 tokens`; a permissive parser
  stored that as $325/1M. Prices must look like money.
- **Sanity ceiling.** Anything above $10,000/1M is rejected as a misparse (a
  context window read as a price).
- **Empty means broken.** An extractor returning zero models is treated as a
  failure, not an empty catalogue — a silent layout change looks identical
  otherwise. Partial collapse is caught by anomaly detection, above.
- **Failures write nothing.** A provider that errors keeps its last known
  prices. Yesterday's price beats a gap or a row of nulls.
- **Zero ≠ null.** A free tier is a real price of `0`; an unavailable tier is
  `null`.

---

## SEO and AI discoverability

The site is a hub-and-spoke tree rather than one page, because a single table
cannot rank for "gemini pricing" or "gpt-5.6-sol cost":

| Route | Targets | Count |
| --- | --- | --- |
| `/` | "LLM API pricing comparison", "cost per token" | 1 |
| `/providers/[slug]` | "Gemini API pricing", "Claude pricing" — the head terms | 10 |
| `/models/[provider]/[model]` | "gpt-5.6-sol pricing" — the long tail | 216 |

Provider pages lead with the **brand**, not the company: the database slug is
`google` but nobody searches for "Google pricing" when they mean Gemini. Common
alternates (`/providers/gemini`, `/providers/claude`, `/providers/qwen`)
permanently redirect to the canonical page so a guessed URL lands and link
equity consolidates instead of splitting.

Every page carries a canonical URL, Open Graph and Twitter tags, and
schema.org JSON-LD as a single `@graph`:

- Home — `WebSite`, `Organization`, `Dataset`, `FAQPage`
- Provider — `BreadcrumbList`, `CollectionPage`, `ItemList`, `FAQPage`
- Model — `BreadcrumbList`, `Product` with per-unit `Offer`s, `WebPage`, `FAQPage`

Token pricing has no standard schema.org unit, so each `Offer` uses a
`UnitPriceSpecification` with an explicit `referenceQuantity` of 1,000,000
tokens. That keeps the markup truthful rather than implying a $5 purchase.

`sitemap.xml` is generated from the database, and `lastModified` comes from
each model's price row rather than the build time — a sitemap that claims
everything changed on every deploy trains crawlers to ignore the field.

### For answer engines

Being the source that gets quoted when someone asks a chatbot what an LLM
costs is worth as much as ranking:

- **`/llms.txt`** — a small plain-text index of the site and its data endpoints.
- **`/llms-full.txt`** — every tracked price as one markdown document (~28KB),
  so a model can ingest the whole dataset in a single fetch instead of crawling
  216 pages. This is the same affordance that makes OpenAI's and Anthropic's
  own pricing readable to *this* project, offered back.
- The `Dataset` schema names the API and markdown dump as distributions, so the
  machine-readable form is discoverable without scraping HTML.
- `robots.ts` **explicitly allows** GPTBot, ClaudeBot, PerplexityBot,
  Google-Extended and others. Blocking them would remove exactly the citations
  worth having.
- FAQ copy is written from the row data, so the visible answer, the structured
  data and the table can never disagree.

Set `NEXT_PUBLIC_SITE_URL` in the deployment environment; canonical tags,
sitemap URLs and OG tags all derive from it.

### Network

`/network` states that this site is part of the Gulf Coast Dev network and
lists the sibling projects, with a link in the footer of every page.

The source site offers a script embed, an iframe and a JSON feed. The JSON is
consumed server-side and rendered with this site's own components: a
third-party script would add a blocking request, shift layout as it sized
itself, and hide the content behind JavaScript where a crawler may never see
it. Reading the feed on the server keeps the page fast, consistent, and
indexable.

The feed is treated as untrusted external data — fields are length-capped and
every URL is verified to be `http(s)` before it reaches an `href`, so a
malformed or compromised feed cannot inject a `javascript:` link. If the feed
is unreachable the page still renders, linking to the network directly.

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

Free to use, including commercially, provided a visible credit links back to
the site — the requirement travels in `meta.attribution` and an
`X-Attribution-Required` header on every response, not just in the docs.

Rate limited to 60 requests/hour per IP (configurable), with higher per-key
limits via the `api_keys` table, behind a site-wide ceiling of 20,000/hour
across all callers. The per-IP limit is useless against abuse spread over many
addresses; the ceiling is what bounds the worst case. Note that most repeat
traffic never reaches the limiter at all, because identical requests are served
from the CDN without invoking the function. Returns `429` with `Retry-After` and
`X-RateLimit-*` headers. Counters live in Postgres — no Redis to provision — and
the limiter **fails open**, since a limiter that 500s would take the whole
public API down with it.

---

## Changelog feed

`/feed.xml` publishes the site's changelog as RSS 2.0: every model added to the
catalogue, and every recorded price move.

```
/feed.xml                          # newest 50 events, both kinds
/feed.xml?provider=anthropic       # one provider (repeatable or comma-separated)
/feed.xml?type=price_change        # or type=model_added
/feed.xml?limit=200                # 1..200, default 50
```

Nothing new is collected for it. A model appearing is `models.created_at`, and
a price move is a `price_history` row — and since the history trigger only
fires when a value actually changed, every row is already a real event rather
than the residue of a re-scrape.

Three details carry the weight:

- **Each model's first history row is excluded.** That row is written by the
  same insert that creates the model's price, so publishing it would announce
  one real event twice — as a new model and as a price change from nothing.
- **Item `guid`s come from immutable database ids**, never from the model page
  URL. Readers dedupe on the guid, so using the link would collapse a model's
  three price changes into one entry, and deriving it from a title or price
  would re-announce old events every time either was corrected.
- **Bad parameters return a valid feed, not a `400`.** A reader has nowhere to
  show an error and will just mark the subscription broken. A genuine failure
  returns `503`, never an empty `200` — readers treat that as "everything was
  withdrawn".

Titles are self-contained, because a reader's list view and a chat webhook both
show the title alone:

```
New model: Anthropic Claude Opus 5 — $5.00 in / $25.00 out per 1M tokens
Moonshot AI (Kimi) Kimi K2.6: input up 64% to $0.950, output up 64% to $4.00 per 1M tokens
```

Discoverable by autodiscovery from any page, from the footer, and from
`/llms.txt`; `/rss.xml` and `/feed` redirect to it. Design notes and the full
contract live in
[`specs/001-model-changelog-feed/`](specs/001-model-changelog-feed/).

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

`maxDuration` is 60s, which is the Hobby ceiling, so it deploys anywhere. A
full run takes about 4 seconds; raise it on a paid plan only if you add many
more providers. Timing out is survivable: providers are written one at a time,
so a truncated run leaves the rest on their last known-good prices.

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

60 tests across four layers, each written for a fault that actually shipped:

- **Parsing** — unit rescaling, currency handling, colspan headers, heading
  breadcrumbs, the xAI payload decoder, and the tier-tab overwrite.
- **Cost logic** — the calculator and comparison maths, extracted from the
  components so it can be tested at all. Covers the two faults that shipped
  from it: models with no output price ranking as the cheapest way to run a
  chat, and prompts larger than the context window ranking above models that
  fit.
- **Database** — real queries against a real database, covering shape,
  filtering, ordering and the `Map` that could not survive the data cache.
- **API routes** — called directly with a `Request`, covering the response
  envelope, attribution, parameter validation, and that headers are
  constructible ASCII (a single em dash there returned 500 for every call).

Database and API suites need `DATABASE_URL` and skip without it. They read only
`DATABASE_URL`, never `SUPABASE_DB_URL`, so the suite cannot reach production.

One test asserts the connection pool size rather than timing it. A pool of one
serialised every concurrent render and took the site down, but a timing test
cannot catch it — verified by reintroducing the bug, which the concurrency test
still passed, because a local database answers fast enough that even serialised
reads finish instantly. The fault needs remote latency to appear, so the
configuration is what gets guarded.

---

## Web UI

Built from the design prototype in [`UIDesign/`](UIDesign/). The page is a
Server Component that reads Postgres directly and hands the full set to a
client component, so every filter and sort is instant with no round trip.

- Provider chips, search, Flagship / Under $1 / 1M+ context toggles, and
  sortable column headings (also reachable from a sort dropdown, which is the
  card view's only sort control)
- A checkbox per row ticks up to three models into `/compare`
- Row expands to the model's description, long-context pricing, source link,
  API id, tags, and a price sparkline
- Filter state is mirrored into the URL, so Copy link / Share reproduce the view

### Popular models panel

216 rows across 9 columns is a lot to land on, so a compact panel sits above
the table with at most 10 models and only the columns that answer "what does
this cost": model, provider, input, output, context.

The default set lives in [`data/featured.ts`](data/featured.ts) and is a
curated editorial list, not a computed one. Usage data isn't in a pricing feed,
so there is no honest way to derive "what's popular" from it — rather than
dress a guess up as a ranking, the default is stated plainly in one file and
every visitor can override it:

- **★ any row** in the main table to pin it (capped at 10, with a notice at the
  limit).
- Choices persist in `localStorage`, so they survive a reload.
- A `?pins=` URL parameter wins over stored preferences, so a shared link shows
  the sender's selection rather than the recipient's.
- **Reset to defaults** clears the override.

Ids that no longer resolve are skipped silently, so a model disappearing from a
vendor's page shortens the panel rather than breaking it.

Four things were changed from the prototype where it would have shipped wrong:

| Prototype | Why it changed |
| --- | --- |
| `Avg` column showed `(input+output)/2`; ranking used `input + 2×output` | Two formulas on one screen made the table look mis-sorted against its own numbers. Now one blended metric drives both. |
| Free models ranked normally | Three Zhipu GLM-Flash models are $0, so they'd hold "Best value" forever. They get a **Free** badge and sit outside the value ranking. |
| Toolbar and table header both `sticky top:0` | They collided. `overflow-x:auto` also makes `overflow-y` compute to `auto`, so the header pinned against the wrapper and hid rows behind it. The table is now its own bounded scroll container. |
| Sticky Input column hardcoded to `left:220px` | Ignored the Rank column's width and any model id wider than 220px. Only Rank and Model are pinned now, at offsets derived from the same spacing token. |

Also added: labels on the search and sort controls, a real `aria-expanded`
toggle button per row (the prototype's rows were mouse-only), and an explicit
body text colour — the prototype left near-black type on its near-black page
background.

The "what that buys you" token counts are rough illustrations and are labelled
as such.

## Roadmap

Planned work and its ordering live in [`BACKLOG.md`](BACKLOG.md).

## Status

**Done and verified:** schema + triggers, all 10 provider extractors,
normalization, enrichment, upsert with history, all API endpoints, rate
limiting, cron auth, per-provider soft-fail, and the comparison UI.

**Known gaps:**
- Anomaly detection compares against the *previous stored state*, so it catches
  regressions but cannot detect a scraper that has been wrong since day one.
- No alerting is wired up. A blocked run surfaces as a `409` and a row in
  `extraction_runs`; something still has to watch for it.
- ByteDance and Baidu resolve to 1 model each — OpenRouter barely carries them.
  Both need first-party extractors, likely browser-driven.
- Context windows are `null` where the metadata catalogue has no exact match
  (10/20 OpenAI, 16/29 Google). `data/overrides.ts` is the intended fix.
- Non-USD pricing is stored in its published currency with no FX conversion;
  the USD international pages are preferred where they exist.
- Batch/Flex/Priority tiers are skipped rather than tracked.
- Price history only starts accumulating once the daily job has run for a
  while, so sparklines are flat on a fresh database. That's honest — there is
  no earlier data — but the 90-day trend only becomes meaningful over time.
