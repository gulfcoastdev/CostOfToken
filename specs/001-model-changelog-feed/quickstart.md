# Quickstart: Validating the Model Changelog Feed

How to prove the feed works end to end. Every scenario maps to acceptance
criteria in [spec.md](./spec.md); the wire format is in
[contracts/feed-endpoint.md](./contracts/feed-endpoint.md).

## Prerequisites

```bash
docker start cot-pg          # local Postgres on 55432 (see README)
npm run db:status            # confirm LOCAL, with row counts
npm run dev                  # http://localhost:3000
```

A populated database is needed for anything past scenario 1 — run
`npm run pipeline:run` if `models` is empty.

---

## 1. The feed is served and well formed

```bash
curl -sS -D- -o /tmp/feed.xml http://localhost:3000/feed.xml | head -5
xmllint --noout /tmp/feed.xml    # if available; otherwise open in a reader
```

**Expect**: `200`, `content-type: application/rss+xml; charset=utf-8`, a
`cache-control` with `s-maxage=1800`, and a document whose root is
`<rss version="2.0">` with one `<channel>`. (FR-001, SC-002)

## 2. Both event kinds are present, newest first

```bash
grep -o '<category>[^<]*</category>' /tmp/feed.xml | sort | uniq -c
grep -o '<pubDate>[^<]*</pubDate>' /tmp/feed.xml | head -5
```

**Expect**: both `New model` and `Price change` categories; `pubDate` values in
descending order, each matching `Day, DD Mon YYYY HH:MM:SS +0000`. (FR-002,
FR-003, FR-009)

## 3. Titles stand alone

```bash
grep -o '<title>[^<]*</title>' /tmp/feed.xml | sed -n '2,6p'
```

**Expect**: every item title names provider, model and the numbers — e.g.
`New model: Anthropic Claude Opus 5 — $5.00 in / $25.00 out per 1M tokens`, or
`… input down 67% to $5.00 per 1M tokens`. No bare "Price updated". (FR-010,
SC-005)

## 4. Price changes carry both values

Open any `Price change` item's `<description>`.

**Expect**: a list reading `Input: $15.00 → $5.00 (-67%)`. A withdrawn price
reads `no longer published`; a free price reads `free`; an unpublished one
reads `not published` — never `0` or a blank. (FR-003, FR-017, SC-004)

## 5. Identity is stable across fetches

```bash
curl -s http://localhost:3000/feed.xml | grep -o '<guid[^>]*>[^<]*</guid>' > /tmp/guids-1
curl -s http://localhost:3000/feed.xml | grep -o '<guid[^>]*>[^<]*</guid>' > /tmp/guids-2
diff /tmp/guids-1 /tmp/guids-2 && echo "stable"
sort /tmp/guids-1 | uniq -d          # must print nothing
```

**Expect**: `stable`, no duplicates, every guid `isPermaLink="false"`. Then
subscribe a real reader (NetNewsWire, Feedly, a Slack RSS integration), refresh
twice, and confirm zero new items on the second refresh. (FR-007, SC-003)

## 6. One event produces one item

```bash
# a model with several price changes has several items sharing one link
grep -c '<item>' /tmp/feed.xml
grep -o '<link>[^<]*models[^<]*</link>' /tmp/feed.xml | sort | uniq -c | sort -rn | head -3
```

**Expect**: repeated links are fine and expected; the guids beside them differ.
No model appears with both an addition item and a price-change item at the same
timestamp. (FR-004, FR-005, FR-008)

## 7. Filters

```bash
curl -s 'http://localhost:3000/feed.xml?provider=anthropic' | grep -c 'Anthropic'
curl -s 'http://localhost:3000/feed.xml?provider=anthropic' | grep -c 'OpenAI'      # 0
curl -s 'http://localhost:3000/feed.xml?type=model_added'  | grep -c 'Price change' # 0
curl -s 'http://localhost:3000/feed.xml?provider=nope'     | grep -c '<item>'       # 0, still 200
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/feed.xml?limit=abc&type=bogus'
```

**Expect**: filtered feeds contain only what was asked for; an unknown provider
gives a valid empty feed; garbage parameters still return `200`. Check that
`atom:link rel="self"` echoes only honoured filters. (FR-014, FR-015, SC-006)

## 8. Bounds

```bash
curl -s 'http://localhost:3000/feed.xml'            | grep -c '<item>'   # 50
curl -s 'http://localhost:3000/feed.xml?limit=5'    | grep -c '<item>'   # 5
curl -s 'http://localhost:3000/feed.xml?limit=9999' | grep -c '<item>'   # 200 max
```

(FR-013)

## 9. Discovery

```bash
curl -s http://localhost:3000/ | grep -o '<link[^>]*application/rss+xml[^>]*>'
curl -s http://localhost:3000/llms.txt | grep -i feed
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/rss.xml
```

**Expect**: an autodiscovery `<link>` in every page's head, the feed listed in
`/llms.txt`, `/rss.xml` and `/feed` permanently redirecting to `/feed.xml`, and
a visible footer link. Then point a reader at `http://localhost:3000/` alone
and confirm it offers the feed. (FR-020, SC-007)

## 10. Untrusted vendor text stays inert

Temporarily set a model description containing markup, then re-fetch:

```sql
update models set description = '<img src=x onerror=alert(1)> Hello'
 where model_id = '<some-model>';
```

**Expect**: the item body contains `&lt;img …` — escaped — and a reader shows
the angle brackets as text. Revert the row afterwards. (FR-016)

## 11. Failure mode

There are two failure paths, and only the second returns `503`. Stopping the
database with a **warm** cache is the common case, and the feed keeps serving:

```bash
docker stop cot-pg
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/feed.xml   # 200, from cache
docker start cot-pg
```

**Expect**: `200` with the last cached document. This is the desired outcome —
a brief outage should not interrupt subscribers — and it is why the cached read
has a 300-second revalidate.

The `503` path is a **cold** cache with no data to fall back on:

```bash
DATABASE_URL='postgresql://postgres:nope@127.0.0.1:1/nope' \
NEXT_PUBLIC_SITE_URL='https://example.test' \
npx tsx --eval "void (async () => {
  const { GET } = await import('$PWD/src/app/feed.xml/route.ts')
  const r = await GET(new Request('https://example.test/feed.xml'))
  console.log(r.status, r.headers.get('cache-control'))
  process.exit(0)
})()"
```

**Expect**: `503 no-store` with a plain-text body — never an empty `200`.
This is the path `tests/feed-route.test.ts` asserts, against a refused
connection rather than a stubbed error. (FR-019)

---

## Automated checks

```bash
npm test              # tests/feed.test.ts — rendering units + database-backed route
npm run typecheck
npm run build
```

The rendering tests run without a database; the route test skips cleanly when
`DATABASE_URL` is unset.

## Before shipping

Deploy, then run the production URL through the
[W3C Feed Validator](https://validator.w3.org/feed/) and confirm zero errors
(SC-002), and subscribe one real reader to `/feed.xml` as a smoke test.
