import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cdata,
  escapeHtml,
  escapeXml,
  itemDescription,
  itemGuid,
  itemTitle,
  priceDeltas,
  type FeedOptions,
  renderRss,
  rfc822,
} from '../src/lib/feed.ts'
import type { FeedEvent } from '../src/lib/queries.ts'
import { absoluteUrl } from '../src/lib/seo.ts'
import { feedEvent, priceChangeEvent } from './feed-fixtures.ts'

/**
 * Pure rendering tests: no database, no request scope.
 *
 * The RSS document is the product here, and every fault this layer can have is
 * silent — a date a parser rejects, a description that escapes its own element,
 * vendor markup that executes in a subscriber's reader. None of them throw.
 */

// ---------------------------------------------------------------------------
// Dates (RFC 822)
// ---------------------------------------------------------------------------

test('rfc822 emits the RSS date grammar with a numeric offset', () => {
  const formatted = rfc822(new Date('2026-08-14T12:16:23.000Z'))

  assert.equal(formatted, 'Fri, 14 Aug 2026 12:16:23 +0000')
  assert.match(formatted, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$/)
})

test('rfc822 converts to UTC rather than reporting local time', () => {
  // 23:30 in Chicago is the following day in UTC; the date must roll with it.
  assert.equal(rfc822(new Date('2026-08-15T04:30:00.000Z')), 'Sat, 15 Aug 2026 04:30:00 +0000')
})

test('rfc822 pads single-digit day and time components', () => {
  assert.equal(rfc822(new Date('2026-01-05T03:04:05.000Z')), 'Mon, 05 Jan 2026 03:04:05 +0000')
})

test('rfc822 does not use the literal GMT that toUTCString emits', () => {
  // Legal per RFC 1123, but mishandled by older feed parsers — the numeric
  // offset is the safe form, which is why this is not toUTCString(). Asserting
  // the offset is present as well as GMT absent keeps this test able to fail:
  // "contains no GMT" alone is true of every wrong answer, including "".
  const formatted = rfc822(new Date('2026-08-14T12:16:23.000Z'))

  assert.match(formatted, /\+0000$/)
  assert.doesNotMatch(formatted, /GMT/)
})

test('rfc822 emits English day and month names under a non-English locale', () => {
  // RFC 822 dates are English-only. Anything locale-aware would emit month
  // names no feed parser has ever heard of.
  const original = process.env.LC_ALL
  process.env.LC_ALL = 'de_DE.UTF-8'
  try {
    assert.equal(rfc822(new Date('2026-03-01T00:00:00.000Z')), 'Sun, 01 Mar 2026 00:00:00 +0000')
  } finally {
    if (original === undefined) delete process.env.LC_ALL
    else process.env.LC_ALL = original
  }
})

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

test('escapeXml escapes every character that can break an element or attribute', () => {
  assert.equal(escapeXml('a & b'), 'a &amp; b')
  assert.equal(escapeXml('<title>'), '&lt;title&gt;')
  assert.equal(escapeXml('say "hi"'), 'say &quot;hi&quot;')
  assert.equal(escapeXml("it's"), 'it&apos;s')
})

test('escapeXml escapes ampersands before the entities it produces', () => {
  // Escaping in the wrong order yields &amp;lt; — a visible mangling rather
  // than an error, which is exactly the kind of fault that ships.
  assert.equal(escapeXml('&<'), '&amp;&lt;')
})

test('escapeHtml renders vendor markup inert', () => {
  const hostile = '<img src=x onerror="alert(1)"> Hello'

  const escaped = escapeHtml(hostile)

  assert.doesNotMatch(escaped, /<img/)
  assert.match(escaped, /&lt;img/)
  assert.match(escaped, /Hello/)
})

test('cdata wraps content in a single section when it is safe', () => {
  assert.equal(cdata('<p>hi</p>'), '<![CDATA[<p>hi</p>]]>')
})

test('cdata splits an embedded terminator across sections without losing content', () => {
  // One raw ]]> inside a section closes it early and corrupts every byte
  // after it. The fix is to split into two sections — so the guarantee to
  // assert is what a parser reconstructs: no section contains a terminator,
  // and concatenating the sections reproduces the input exactly.
  const sections = [...cdata('a ]]> b').matchAll(/<!\[CDATA\[(.*?)]]>/gs)].map((m) => m[1])

  assert.ok(sections.length > 1, 'expected the terminator to be split across sections')
  for (const section of sections) {
    assert.doesNotMatch(section, /]]>/)
  }
  assert.equal(sections.join(''), 'a ]]> b')
})

// ---------------------------------------------------------------------------
// Channel document
// ---------------------------------------------------------------------------

const BUILT_AT = new Date('2026-08-14T18:02:00.000Z')

function render(events: FeedEvent[] = [], overrides: Partial<FeedOptions> = {}) {
  return renderRss({
    events,
    selfUrl: absoluteUrl('/feed.xml'),
    title: 'CostOfToken — new models and price changes',
    description: 'Every new LLM added and every price change.',
    builtAt: BUILT_AT,
    ...overrides,
  })
}

test('renderRss opens with the XML declaration and an RSS 2.0 root', () => {
  const xml = render()

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'missing XML declaration')
  assert.match(xml, /<rss version="2\.0"[^>]*xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom"/)
  assert.equal(xml.match(/<channel>/g)?.length, 1)
  assert.ok(xml.trimEnd().endsWith('</rss>'))
})

test('renderRss emits every channel element a reader expects', () => {
  const xml = render()

  for (const element of ['title', 'link', 'description', 'language', 'pubDate', 'lastBuildDate',
                         'ttl', 'generator', 'docs', 'copyright']) {
    assert.match(xml, new RegExp(`<${element}>[^<]+</${element}>`), `missing <${element}>`)
  }
  assert.match(xml, /<language>en-us<\/language>/)
  assert.match(xml, new RegExp(`<link>${absoluteUrl('/')}</link>`))
  // rel=self names the exact document served, which is how a reader that was
  // handed the feed indirectly can still find its canonical address.
  assert.match(
    xml,
    /<atom:link href="[^"]+\/feed\.xml" rel="self" type="application\/rss\+xml"\s*\/>/,
  )
  assert.match(xml, /<docs>https:\/\/www\.rssboard\.org\/rss-specification<\/docs>/)
})

test('renderRss escapes channel text rather than emitting it raw', () => {
  const xml = render([], { title: 'Feeds & <Prices>' })

  assert.match(xml, /<title>Feeds &amp; &lt;Prices&gt;<\/title>/)
  assert.doesNotMatch(xml, /<title>Feeds & </)
})

test('renderRss produces no items for an empty event list', () => {
  const xml = render()

  assert.equal(xml.match(/<item>/g), null)
})

test('renderRss dates the channel from the newest item, not the render time', () => {
  // A pubDate that moves on every fetch tells a reader the feed changed when
  // it did not, which is how a feed trains its subscribers to ignore it.
  const xml = render([
    feedEvent({ id: 'a', occurredAt: '2026-08-14T12:16:23.000Z' }),
    feedEvent({ id: 'b', occurredAt: '2026-08-01T09:00:00.000Z' }),
  ])

  assert.match(xml, /<pubDate>Fri, 14 Aug 2026 12:16:23 \+0000<\/pubDate>/)
  assert.match(xml, /<lastBuildDate>Fri, 14 Aug 2026 18:02:00 \+0000<\/lastBuildDate>/)
})

test('renderRss falls back to the build time when there are no events', () => {
  const xml = render()

  assert.match(xml, /<pubDate>Fri, 14 Aug 2026 18:02:00 \+0000<\/pubDate>/)
})

test('renderRss emits exactly one item per event', () => {
  const xml = render([feedEvent({ id: 'a' }), feedEvent({ id: 'b' }), feedEvent({ id: 'c' })])

  assert.equal(xml.match(/<item>/g)?.length, 3)
  assert.equal(xml.match(/<\/item>/g)?.length, 3)
})

// ---------------------------------------------------------------------------
// Items — new models (User Story 1)
// ---------------------------------------------------------------------------

test('itemTitle for an addition names provider, model and both headline prices', () => {
  // The title is the whole notification for a reader's list view and for any
  // chat integration, so it has to stand alone.
  assert.equal(
    itemTitle(feedEvent()),
    'New model: Anthropic Claude Opus 5 — $5.00 in / $25.00 out per 1M tokens',
  )
})

test('itemTitle says pricing is not published rather than inventing a number', () => {
  const event = feedEvent({
    prices: { input: null, cachedInput: null, output: null, longInput: null, longOutput: null },
  })

  assert.equal(itemTitle(event), 'New model: Anthropic Claude Opus 5 — pricing not published')
})

test('itemTitle distinguishes a free price from an unpublished one', () => {
  // Zero is a real price and null is unknown; collapsing them is the single
  // most misleading thing this feed could do.
  const free = feedEvent({
    prices: { input: 0, cachedInput: null, output: 0, longInput: null, longOutput: null },
  })

  assert.match(itemTitle(free), /free in \/ free out/)
  assert.doesNotMatch(itemTitle(free), /\$0/)
})

test('itemTitle formats sub-dollar prices with three decimals', () => {
  const cheap = feedEvent({
    prices: { input: 0.15, cachedInput: null, output: 0.6, longInput: null, longOutput: null },
  })

  assert.match(itemTitle(cheap), /\$0\.150 in \/ \$0\.600 out/)
})

test('itemDescription for an addition carries the vendor description and prices', () => {
  const body = itemDescription(feedEvent())

  assert.match(body, /Claude Opus 5/)
  assert.match(body, /<code>claude-opus-5<\/code>/)
  assert.match(body, /Our most capable model/)
  assert.match(body, /Input: \$5\.00 per 1M tokens/)
  assert.match(body, /Cached input: \$0\.500 per 1M tokens/)
  assert.match(body, /Output: \$25\.00 per 1M tokens/)
  assert.match(body, /Context window: 200K tokens/)
  assert.match(body, /href="[^"]*\/models\/anthropic\/claude-opus-5"/)
})

test('itemDescription omits price tiers the provider does not publish', () => {
  const body = itemDescription(
    feedEvent({
      prices: { input: 5, cachedInput: null, output: 25, longInput: null, longOutput: null },
    }),
  )

  assert.doesNotMatch(body, /Cached input/)
  assert.doesNotMatch(body, /Long-context/)
  assert.doesNotMatch(body, /not published/)
})

test('itemDescription renders vendor markup as text, never as active content', () => {
  const body = itemDescription(feedEvent({ description: '<img src=x onerror="alert(1)"> Fast' }))

  assert.doesNotMatch(body, /<img/)
  assert.match(body, /&lt;img/)
})

test('itemDescription caps a runaway vendor description', () => {
  const body = itemDescription(feedEvent({ description: 'x'.repeat(2000) }))

  assert.ok(body.length < 1500, `body was ${body.length} chars`)
  assert.match(body, /…/)
})

test('itemDescription flags a reseller-sourced price', () => {
  const body = itemDescription(feedEvent({ sourceKind: 'api' }))

  assert.match(body, /OpenRouter/)
})

test('itemGuid is unique per event and carries the event kind', () => {
  const added = itemGuid(feedEvent({ id: 'abc' }))
  const changed = itemGuid(priceChangeEvent({ id: '1487' }))

  assert.match(added, /\/feed\/model-added\/abc$/)
  assert.match(changed, /\/feed\/price-change\/1487$/)
  assert.notEqual(added, changed)
})

test('itemGuid does not move when the title or prices change', () => {
  // Readers dedupe on the guid. One derived from mutable data re-announces an
  // old event to every subscriber the moment a price is corrected.
  const before = itemGuid(feedEvent({ id: 'abc' }))
  const after = itemGuid(
    feedEvent({
      id: 'abc',
      displayName: 'Claude Opus 5.1',
      prices: { input: 99, cachedInput: null, output: 99, longInput: null, longOutput: null },
    }),
  )

  assert.equal(before, after)
})

test('two items about the same model share a link but never a guid', () => {
  const xml = render([
    priceChangeEvent({ id: '1487' }),
    priceChangeEvent({ id: '1488' }),
  ])

  const links = [...xml.matchAll(/<link>([^<]+models[^<]*)<\/link>/g)].map((m) => m[1])
  const guids = [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1])

  assert.equal(links.length, 2)
  assert.equal(links[0], links[1], 'both items are about the same model page')
  assert.equal(new Set(guids).size, 2, 'guids must stay distinct')
})

test('every item guid is marked as not a permalink', () => {
  const xml = render([feedEvent()])

  assert.match(xml, /<guid isPermaLink="false">/)
})

// ---------------------------------------------------------------------------
// Items — price changes (User Story 2)
// ---------------------------------------------------------------------------

test('priceDeltas reports only the fields that moved', () => {
  const deltas = priceDeltas(priceChangeEvent())

  assert.deepEqual(
    deltas.map((d) => d.label),
    ['Input', 'Output'],
  )
  assert.deepEqual(deltas[0], { label: 'Input', from: 15, to: 5, percent: -67 })
  assert.deepEqual(deltas[1], { label: 'Output', from: 25, to: 15, percent: -40 })
})

test('priceDeltas returns nothing for an addition', () => {
  assert.deepEqual(priceDeltas(feedEvent()), [])
})

test('priceDeltas leaves the percentage out when it would be meaningless', () => {
  // From nothing, or from free: there is no base to take a percentage of, and
  // "up 100%" from zero would be an invention.
  const fromNull = priceChangeEvent({
    previous: { input: null, cachedInput: null, output: 25, longInput: null, longOutput: null },
    prices: { input: 5, cachedInput: null, output: 25, longInput: null, longOutput: null },
  })
  const fromZero = priceChangeEvent({
    previous: { input: 0, cachedInput: null, output: 25, longInput: null, longOutput: null },
    prices: { input: 5, cachedInput: null, output: 25, longInput: null, longOutput: null },
  })

  assert.equal(priceDeltas(fromNull)[0].percent, null)
  assert.equal(priceDeltas(fromZero)[0].percent, null)
})

test('priceDeltas records a withdrawn price as a move to null', () => {
  const withdrawn = priceChangeEvent({
    previous: { input: 5, cachedInput: 0.5, output: 25, longInput: null, longOutput: null },
    prices: { input: 5, cachedInput: null, output: 25, longInput: null, longOutput: null },
  })

  const [delta] = priceDeltas(withdrawn)
  assert.equal(delta.label, 'Cached input')
  assert.equal(delta.to, null)
})

test('priceDeltas keeps a sub-1% move rather than dropping it', () => {
  const tiny = priceChangeEvent({
    previous: { input: 5, cachedInput: null, output: 25, longInput: null, longOutput: null },
    prices: { input: 4.99, cachedInput: null, output: 25, longInput: null, longOutput: null },
  })

  const [delta] = priceDeltas(tiny)
  assert.equal(delta.percent, 0)
  assert.equal(delta.to, 4.99)
})

test('itemTitle for a change states direction, size and the new price', () => {
  assert.equal(
    itemTitle(priceChangeEvent()),
    'Anthropic Claude Opus 5: input down 67% to $5.00, output down 40% to $15.00 per 1M tokens',
  )
})

test('itemTitle reports an increase as up', () => {
  const rise = priceChangeEvent({
    previous: { input: 5, cachedInput: 0.5, output: 25, longInput: null, longOutput: null },
    prices: { input: 6, cachedInput: 0.5, output: 25, longInput: null, longOutput: null },
  })

  assert.match(itemTitle(rise), /input up 20% to \$6\.00 per 1M tokens/)
})

test('itemTitle names at most three moved fields and counts the rest', () => {
  const sweeping = priceChangeEvent({
    previous: { input: 10, cachedInput: 1, output: 30, longInput: 20, longOutput: 60 },
    prices: { input: 5, cachedInput: 0.5, output: 15, longInput: 10, longOutput: 30 },
  })

  const title = itemTitle(sweeping)
  assert.match(title, /and 2 more per 1M tokens$/)
  assert.equal(title.match(/down/g)?.length, 3)
})

test('itemTitle says a withdrawn price is no longer published', () => {
  const withdrawn = priceChangeEvent({
    previous: { input: 5, cachedInput: 0.5, output: 25, longInput: null, longOutput: null },
    prices: { input: 5, cachedInput: null, output: 25, longInput: null, longOutput: null },
  })

  assert.match(itemTitle(withdrawn), /cached input no longer published/)
})

test('itemDescription for a change lists old and new side by side', () => {
  const body = itemDescription(priceChangeEvent())

  assert.match(body, /USD per 1M tokens/)
  assert.match(body, /Input: \$15\.00 → \$5\.00 \(-67%\)/)
  assert.match(body, /Output: \$25\.00 → \$15\.00 \(-40%\)/)
  assert.match(body, /href="[^"]*\/models\/anthropic\/claude-opus-5"/)
})

test('itemDescription marks a rise with a plus sign', () => {
  const rise = priceChangeEvent({
    previous: { input: 5, cachedInput: 0.5, output: 25, longInput: null, longOutput: null },
    prices: { input: 6, cachedInput: 0.5, output: 25, longInput: null, longOutput: null },
  })

  assert.match(itemDescription(rise), /\(\+20%\)/)
})

test('a price change is categorised separately from an addition', () => {
  const xml = render([priceChangeEvent(), feedEvent()])

  assert.match(xml, /<category>Price change<\/category>/)
  assert.match(xml, /<category>New model<\/category>/)
})
