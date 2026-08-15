# Contract: `GET /feed.xml`

The site's public changelog as RSS 2.0. Anonymous, unauthenticated, and
intended to be polled by feed readers.

---

## Request

```
GET /feed.xml[?provider=…][&type=…][&limit=…]
```

| Parameter | Type | Default | Rules |
|-----------|------|---------|-------|
| `provider` | repeatable, or comma-separated | all providers | Provider slugs, lower-cased and trimmed (`?provider=openai,anthropic`) |
| `type` | `model_added` \| `price_change` | both | Anything else is ignored |
| `limit` | integer | `50` | Clamped to `1..200`; non-integers ignored |

**Invalid input is never an error** (FR-015). An unparseable `limit`, an
unknown `type`, or a provider slug that does not exist yields a valid feed —
empty in the last case — not a `4xx`. A feed reader cannot show a user an
error page; it just marks the subscription broken.

---

## Response

### Success — `200`

| Header | Value |
|--------|-------|
| `content-type` | `application/rss+xml; charset=utf-8` |
| `cache-control` | `public, s-maxage=1800, stale-while-revalidate=86400` |
| `x-attribution-required` | `Pricing data from CostOfToken: https://costoftoken.com` (ASCII only) |

### Failure — `503`

Returned when the catalog cannot be read (FR-019). `content-type:
text/plain; charset=utf-8`, `cache-control: no-store`. Never an empty `200`:
readers treat that as "the publisher withdrew everything".

---

## Document structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>CostOfToken — new models and price changes</title>
    <link>https://costoftoken.com/</link>
    <description>…</description>
    <language>en-us</language>
    <pubDate>Fri, 14 Aug 2026 12:16:23 +0000</pubDate>
    <lastBuildDate>Fri, 14 Aug 2026 18:02:00 +0000</lastBuildDate>
    <ttl>60</ttl>
    <generator>CostOfToken</generator>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <copyright>Open Data Commons Attribution License 1.0 — credit https://costoftoken.com/</copyright>
    <atom:link href="https://costoftoken.com/feed.xml" rel="self" type="application/rss+xml" />
    <item>…</item>
  </channel>
</rss>
```

### Channel rules

- `pubDate` is the **newest item's** date, not render time — a channel date
  that moves on every fetch tells readers the feed changed when it did not.
- `lastBuildDate` is render time.
- `atom:link rel="self"` echoes the request URL including **only the filters
  that were honoured**, so it names the document actually served.
- `title` reflects the active filters (e.g. `CostOfToken — openai, new models`).

### Item rules

| Element | Content |
|---------|---------|
| `title` | Self-contained (FR-010) — see the two shapes below |
| `link` | The model's page: `/models/{provider}/{model_id}`, URL-encoded per segment |
| `guid` | `isPermaLink="false"`, `…/feed/model-added/{uuid}` or `…/feed/price-change/{history_id}`. Immutable, unique |
| `pubDate` | RFC 822, UTC, numeric offset: `Fri, 14 Aug 2026 12:16:23 +0000` |
| `category` | Two: `New model` \| `Price change`, and the provider name |
| `description` | HTML in `CDATA`; every interpolated value HTML-escaped first |

Items appear newest first. Several items may share a `link` — a model with
three price changes has three items — which is exactly why the `guid` is not
the link (FR-008).

---

## Title formats (FR-010)

**Addition**

```
New model: Anthropic Claude Opus 5 — $5.00 in / $25.00 out per 1M tokens
New model: Foo AI Bar-1 — pricing not published
```

**Price change** — up to three fields named, the rest counted

```
Anthropic Claude Opus 5: input down 67% to $5.00 per 1M tokens
OpenAI GPT-5: input down 67% to $5.00, output up 20% to $30.00 per 1M tokens
DeepSeek V4: input now $0.270, cached input no longer published per 1M tokens
```

---

## Sample item

```xml
<item>
  <title>Anthropic Claude Opus 5: input down 67% to $5.00, output down 40% to $15.00 per 1M tokens</title>
  <link>https://costoftoken.com/models/anthropic/claude-opus-5</link>
  <guid isPermaLink="false">https://costoftoken.com/feed/price-change/1487</guid>
  <pubDate>Fri, 14 Aug 2026 12:16:23 +0000</pubDate>
  <category>Price change</category>
  <category>Anthropic</category>
  <description><![CDATA[<p><strong>Anthropic Claude Opus 5</strong> (<code>claude-opus-5</code>) changed price. All figures are USD per 1M tokens.</p><ul><li>Input: $15.00 → $5.00 (-67%)</li><li>Output: $25.00 → $15.00 (-40%)</li></ul><p><a href="https://costoftoken.com/models/anthropic/claude-opus-5">Full pricing and history</a> · <a href="https://docs.anthropic.com/en/docs/about-claude/pricing">Provider pricing page</a></p>]]></description>
</item>
```

---

## Guarantees

1. **Idempotent identity** — an event's `guid` never changes, so a reader
   announces it exactly once (FR-007, SC-003).
2. **Self-describing changes** — a price-change item always carries both the
   old and the new value (FR-003, SC-004).
3. **One event, one item** — simultaneous moves across several price fields
   produce a single item (FR-004); a model's first recorded price produces only
   the addition item (FR-005).
4. **Inert content** — vendor text is escaped, never active (FR-016).
5. **Bounded and shared** — at most 200 items, and every subscriber to a given
   URL is served from one cached document for 30 minutes (FR-013, FR-021).

---

## Discovery contract (FR-020)

| Surface | Change |
|---------|--------|
| `<head>` of every page | `<link rel="alternate" type="application/rss+xml" title="CostOfToken — new models and price changes" href="/feed.xml">`, via `metadata.alternates.types` in `src/app/layout.tsx` |
| Site footer | Visible "Changelog feed" link |
| `/llms.txt` | Listed among the machine-readable data surfaces |
| `/rss.xml`, `/feed` | Permanent redirects to `/feed.xml` — the paths readers guess |
