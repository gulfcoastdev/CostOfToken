import type { FeedEvent, FeedPrices } from './queries.ts'
import { absoluteUrl, modelPath, priceText, SITE } from './seo.ts'
import { formatContext } from './format.ts'

/**
 * RSS 2.0 rendering for the site changelog.
 *
 * RSS 2.0 rather than Atom or JSON Feed because it is the format every reader,
 * every "watch this page" service and every chat webhook accepts without
 * configuration — which is the whole point of publishing one.
 *
 * The conventions below are each here because the obvious alternative is
 * subtly wrong; see specs/001-model-changelog-feed/research.md for the long
 * form.
 */

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * XML escaping, applied to every interpolated value in an element or
 * attribute. Ampersands go first: escaping them last would turn the entities
 * this produces into `&amp;lt;`, which mangles output without erroring.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * HTML escaping for text placed inside an item's HTML description.
 *
 * Model descriptions are scraped from vendor pages, so they are external data
 * even though they arrive through our own database. Feed readers render item
 * descriptions as HTML, so unescaped vendor markup would execute in a
 * subscriber's reader.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Wrap HTML in CDATA.
 *
 * `]]>` cannot appear inside a CDATA section, so it is split across two: a
 * single occurrence in a vendor description would otherwise close the section
 * early and corrupt every byte after it.
 */
export function cdata(html: string): string {
  return `<![CDATA[${html.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * RFC 822 in UTC, e.g. `Fri, 14 Aug 2026 12:16:23 +0000`.
 *
 * Hand-formatted for two reasons. `toUTCString()` ends in `GMT`, which is
 * legal per RFC 1123 but which some older feed parsers mishandle, and anything
 * locale-aware would emit month names in the server's language — RFC 822 dates
 * are English-only. A fixed lookup table removes both risks for eight lines.
 */
export function rfc822(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    `${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  )
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const CATEGORY: Record<FeedEvent['kind'], string> = {
  model_added: 'New model',
  price_change: 'Price change',
}

const PRICE_FIELDS: Array<{ key: keyof FeedPrices; label: string }> = [
  { key: 'input', label: 'Input' },
  { key: 'cachedInput', label: 'Cached input' },
  { key: 'output', label: 'Output' },
  { key: 'longInput', label: 'Long-context input' },
  { key: 'longOutput', label: 'Long-context output' },
]

export interface PriceDelta {
  label: string
  from: number | null
  to: number | null
  /** Null where a percentage would be meaningless: from null, or from zero. */
  percent: number | null
}

/** Every field that actually moved, in a fixed order so titles read alike. */
export function priceDeltas(event: FeedEvent): PriceDelta[] {
  const previous = event.previous
  if (!previous) return []

  return PRICE_FIELDS.flatMap(({ key, label }) => {
    const from = previous[key]
    const to = event.prices[key]
    if (from === to) return []

    return [
      {
        label,
        from,
        to,
        percent:
          from !== null && to !== null && from !== 0
            ? // `+ 0` normalises -0, which Math.round returns for a tiny
              // decrease and which compares unequal to 0 under Object.is.
              Math.round(((to - from) / from) * 100) + 0
            : null,
      },
    ]
  })
}

/** "down 67% to $5.00", "now $1.20", "no longer published". */
function describeDelta(delta: PriceDelta): string {
  if (delta.to === null) return 'no longer published'
  if (delta.from === null || delta.percent === null) return `now ${priceText(delta.to)}`
  if (delta.percent === 0) {
    // Too small to round to a whole percent, but still a move — reporting it
    // as "0%" would read as no change at all.
    return `${delta.to > delta.from ? 'up' : 'down'} to ${priceText(delta.to)}`
  }

  return `${delta.percent > 0 ? 'up' : 'down'} ${Math.abs(delta.percent)}% to ${priceText(delta.to)}`
}

/**
 * The item title, which for most subscribers is the entire notification — a
 * reader's list view and a chat webhook both show the title alone. So it
 * carries provider, model and the actual numbers rather than "price updated".
 */
export function itemTitle(event: FeedEvent): string {
  const model = `${event.providerName} ${event.displayName}`

  if (event.kind === 'model_added') {
    if (event.prices.input === null && event.prices.output === null) {
      return `New model: ${model} — pricing not published`
    }

    return (
      `New model: ${model} — ${priceText(event.prices.input)} in / ` +
      `${priceText(event.prices.output)} out per 1M tokens`
    )
  }

  const deltas = priceDeltas(event)
  if (deltas.length === 0) return `${model}: price updated`

  // Readers truncate long titles, so at most three fields are named and the
  // remainder counted.
  const named = deltas.slice(0, 3).map((d) => `${d.label.toLowerCase()} ${describeDelta(d)}`)
  const rest = deltas.length - named.length
  const summary = rest > 0 ? `${named.join(', ')} and ${rest} more` : named.join(', ')

  return `${model}: ${summary} per 1M tokens`
}

/** Vendor prose is trimmed hard: a feed item is a notification, not the page. */
function shortDescription(description: string | null): string | null {
  if (!description) return null

  const text = description.replace(/\s+/g, ' ').trim()
  return text.length <= 400 ? text : `${text.slice(0, 399).trimEnd()}…`
}

function priceList(prices: FeedPrices, contextWindow: number | null): string {
  const rows = PRICE_FIELDS.flatMap(({ key, label }) =>
    prices[key] === null
      ? []
      : [`<li>${label}: ${escapeHtml(priceText(prices[key]))} per 1M tokens</li>`],
  )

  if (contextWindow !== null) {
    rows.push(`<li>Context window: ${escapeHtml(formatContext(contextWindow))} tokens</li>`)
  }

  return rows.length > 0 ? `<ul>${rows.join('')}</ul>` : ''
}

function deltaList(deltas: PriceDelta[]): string {
  const rows = deltas.map((delta) => {
    const change =
      delta.percent === null || delta.percent === 0
        ? ''
        : ` (${delta.percent > 0 ? '+' : ''}${delta.percent}%)`

    return `<li>${delta.label}: ${escapeHtml(priceText(delta.from))} → ${escapeHtml(
      priceText(delta.to),
    )}${change}</li>`
  })

  return `<ul>${rows.join('')}</ul>`
}

/** The item body, as HTML. Every interpolated value is HTML-escaped first. */
export function itemDescription(event: FeedEvent): string {
  const page = absoluteUrl(modelPath(event.provider, event.modelId))
  const name = `${escapeHtml(event.providerName)} ${escapeHtml(event.displayName)}`
  const id = `<code>${escapeHtml(event.modelId)}</code>`
  const blurb = shortDescription(event.description)

  const parts: string[] = []

  if (event.kind === 'model_added') {
    parts.push(`<p><strong>${name}</strong> (${id}) is now tracked on ${SITE.name}.</p>`)
    if (blurb) parts.push(`<p>${escapeHtml(blurb)}</p>`)
    parts.push(priceList(event.prices, event.contextWindow))
  } else {
    parts.push(
      `<p><strong>${name}</strong> (${id}) changed price. All figures are ` +
        `${escapeHtml(event.currency)} per 1M tokens.</p>`,
    )
    parts.push(deltaList(priceDeltas(event)))
    if (blurb) parts.push(`<p>${escapeHtml(blurb)}</p>`)
  }

  const links = [`<a href="${escapeHtml(page)}">Full pricing and history</a>`]
  if (event.sourceUrl) {
    links.push(`<a href="${escapeHtml(event.sourceUrl)}">Provider pricing page</a>`)
  }
  if (event.sourceKind === 'api') {
    // The same caveat the table carries: OpenRouter is a reseller, so its rate
    // is not necessarily the vendor's own.
    links.push('Priced via the OpenRouter catalogue')
  }
  parts.push(`<p>${links.join(' · ')}</p>`)

  return parts.filter(Boolean).join('')
}

/**
 * Built from an immutable database id, never from the model page URL.
 *
 * Readers dedupe on the guid. Using the link would collapse a model's three
 * price changes into one entry; deriving it from a title or a price would
 * re-announce an old event every time either was corrected.
 */
export function itemGuid(event: FeedEvent): string {
  const path = event.kind === 'model_added' ? 'model-added' : 'price-change'
  return absoluteUrl(`/feed/${path}/${event.id}`)
}

function renderItem(event: FeedEvent): string {
  const link = absoluteUrl(modelPath(event.provider, event.modelId))

  return [
    '    <item>',
    `      <title>${escapeXml(itemTitle(event))}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(itemGuid(event))}</guid>`,
    `      <pubDate>${rfc822(new Date(event.occurredAt))}</pubDate>`,
    `      <category>${escapeXml(CATEGORY[event.kind])}</category>`,
    `      <category>${escapeXml(event.providerName)}</category>`,
    `      <description>${cdata(itemDescription(event))}</description>`,
    '    </item>',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface FeedOptions {
  events: FeedEvent[]
  /** Absolute URL of this exact feed, filters included — for atom:link rel=self. */
  selfUrl: string
  title: string
  description: string
  /** Defaults to now; injectable so the document is testable. */
  builtAt?: Date
}

export function renderRss({
  events,
  selfUrl,
  title,
  description,
  builtAt = new Date(),
}: FeedOptions): string {
  const items = events.map(renderItem)

  // The newest item, not the render time: a channel pubDate that moves on
  // every fetch tells a reader the feed changed when it did not.
  const newest = events[0] ? new Date(events[0].occurredAt) : builtAt

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(absoluteUrl('/'))}</link>
    <description>${escapeXml(description)}</description>
    <language>en-us</language>
    <pubDate>${rfc822(newest)}</pubDate>
    <lastBuildDate>${rfc822(builtAt)}</lastBuildDate>
    <ttl>60</ttl>
    <generator>${escapeXml(SITE.name)}</generator>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <copyright>${escapeXml(
      `Open Data Commons Attribution License 1.0 — credit ${absoluteUrl('/')}`,
    )}</copyright>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />
${items.join('\n')}
  </channel>
</rss>
`
}
