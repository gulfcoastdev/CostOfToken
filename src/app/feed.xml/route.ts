import { renderRss } from '@/lib/feed.ts'
import { getFeedEvents, isFeedEventKind, type FeedFilters } from '@/lib/queries.ts'
import { absoluteUrl, SITE } from '@/lib/seo.ts'

export const runtime = 'nodejs'
/**
 * Dynamic on purpose.
 *
 * The feed accepts filters, and a filtered feed is a different document at a
 * different URL. The CDN keys its cache on the full URL, so each subscription
 * is still served from one cached document for half an hour — well inside the
 * hourly poll a reader makes. Being dynamic also keeps the feed out of the
 * build-time prerender pass, which is where concurrent reads on one database
 * connection deadlocked this project before.
 */
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * GET /feed.xml — the site changelog as RSS 2.0.
 *
 * New models and price changes, newest first. Optional filters: `provider`
 * (repeatable or comma-separated), `type` (model_added | price_change) and
 * `limit` (1..200). See
 * specs/001-model-changelog-feed/contracts/feed-endpoint.md for the contract.
 *
 * Unusable parameters are ignored rather than rejected. A feed reader has
 * nowhere to show a 400 and will simply mark the subscription broken, so
 * serving the unfiltered feed is the more useful failure.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams

  const providers = params
    .getAll('provider')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  const typeParam = params.get('type')?.trim()
  const kind = typeParam && isFeedEventKind(typeParam) ? typeParam : undefined

  // Read as a string first. `Number(null)` is 0, not NaN, so treating a
  // missing parameter as a number silently clamps the feed to a single item.
  const rawLimit = params.get('limit')
  const parsedLimit = rawLimit === null ? Number.NaN : Number(rawLimit)
  const limit = Number.isInteger(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT

  const filters: FeedFilters = {
    provider: providers.length > 0 ? providers : undefined,
    kind,
    limit,
  }

  // Only the parameters that were honoured, so rel=self names the document
  // actually served rather than echoing junk back at the subscriber.
  const self = new URL(absoluteUrl('/feed.xml'))
  for (const provider of providers) self.searchParams.append('provider', provider)
  if (kind) self.searchParams.set('type', kind)
  if (limit !== DEFAULT_LIMIT) self.searchParams.set('limit', String(limit))

  const scope = [
    providers.length > 0 ? providers.join(', ') : null,
    kind === 'model_added' ? 'new models' : kind === 'price_change' ? 'price changes' : null,
  ].filter(Boolean)

  try {
    const events = await getFeedEvents(filters)

    const body = renderRss({
      events,
      selfUrl: self.toString(),
      title:
        scope.length > 0
          ? `${SITE.name} — ${scope.join(', ')}`
          : `${SITE.name} — new models and price changes`,
      description:
        'Every new LLM added to CostOfToken and every price change, as it is recorded. ' +
        'Prices are USD per 1,000,000 tokens, standard tier, normalized across providers.',
    })

    return new Response(body, {
      headers: {
        // Readers that have to guess an encoding tend to guess Latin-1 and
        // mangle model names, so the charset is stated.
        'content-type': 'application/rss+xml; charset=utf-8',
        'cache-control': 'public, s-maxage=1800, stale-while-revalidate=86400',
        // ASCII only: header values are ByteStrings, so anything above U+00FF
        // throws at response construction and takes the endpoint down with it.
        'x-attribution-required': `Pricing data from ${SITE.name}: ${absoluteUrl('/')}`,
      },
    })
  } catch (error) {
    console.error('GET /feed.xml failed', error)
    // Never an empty 200: a reader shows that to its user as "everything was
    // withdrawn". A 503 is understood as temporary, so the subscription
    // survives the outage.
    return new Response('Feed temporarily unavailable.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
