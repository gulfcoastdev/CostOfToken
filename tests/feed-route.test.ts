import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { loadEnv } from '../scripts/load-env.ts'

const execFile = promisify(execFileCallback)
const ROUTE_PATH = fileURLToPath(new URL('../src/app/feed.xml/route.ts', import.meta.url))

// `npm test` does not read .env.local on its own, so these suites silently
// skipped and reported success while testing nothing.
loadEnv()

/**
 * The feed route, exercised by calling it with a real Request.
 *
 * This layer holds the faults no rendering test can reach: a media type a
 * reader refuses, a non-ASCII byte in a header (which throws at response
 * construction and 500s the endpoint while the query underneath is perfectly
 * healthy), and the handling of input that a background poller has no way to
 * report back to its user.
 */

process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'

/*
 * Deliberately only DATABASE_URL, never SUPABASE_DB_URL. By convention
 * DATABASE_URL is the local development database and the remote lives under a
 * separate name reached only with an explicit --remote flag, so the test suite
 * cannot reach production even if someone runs it with both configured.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

const request = (url: string) => new Request(url)

describe('GET /feed.xml', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let feed: typeof import('../src/app/feed.xml/route.ts')
  let closeDb: () => Promise<void>

  before(async () => {
    feed = await import('../src/app/feed.xml/route.ts')
    ;({ closeDb } = await import('../src/lib/db.ts'))
  })

  after(async () => {
    await closeDb()
  })

  test('serves a well-formed RSS document', async () => {
    const response = await feed.GET(request('https://example.test/feed.xml'))
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.ok(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
    assert.match(body, /<rss version="2\.0"/)
    assert.ok(body.includes('<item>'), 'expected items for a populated catalog')
  })

  test('declares the media type feed readers expect, with a charset', async () => {
    const response = await feed.GET(request('https://example.test/feed.xml'))

    // Readers that have to guess an encoding tend to guess Latin-1 and mangle
    // model names.
    assert.equal(response.headers.get('content-type'), 'application/rss+xml; charset=utf-8')
  })

  test('is cacheable at the edge so subscriber polling costs one read', async () => {
    const response = await feed.GET(request('https://example.test/feed.xml'))

    const cacheControl = response.headers.get('cache-control') ?? ''
    assert.match(cacheControl, /public/)
    assert.match(cacheControl, /s-maxage=1800/)
  })

  test('every response header is ASCII', async () => {
    // Header values are ByteStrings: one em dash here throws at response
    // construction and takes the whole endpoint down with it.
    const response = await feed.GET(request('https://example.test/feed.xml'))

    for (const [name, value] of response.headers) {
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(value, /[^\x00-\x7F]/, `non-ASCII in header ${name}: ${value}`)
    }
  })

  test('carries the attribution the rest of the data surfaces carry', async () => {
    const response = await feed.GET(request('https://example.test/feed.xml'))
    const body = await response.text()

    assert.match(response.headers.get('x-attribution-required') ?? '', /CostOfToken/)
    assert.match(body, /<copyright>[^<]*Open Data Commons/)
  })

  test('defaults to 50 items', async () => {
    const response = await feed.GET(request('https://example.test/feed.xml'))
    const body = await response.text()

    assert.equal(body.match(/<item>/g)?.length, 50)
  })

  test('names itself in atom:link rel=self', async () => {
    const response = await feed.GET(request('https://example.test/feed.xml'))
    const body = await response.text()

    assert.match(body, /<atom:link href="[^"]*\/feed\.xml" rel="self"/)
  })

  test('reports a temporary failure rather than an empty feed', async () => {
    /*
     * An empty but successful feed reads as "the publisher withdrew
     * everything", and a reader will show exactly that to its user. A 503 is
     * understood as temporary and retried, so the subscription survives.
     *
     * Run in a child process against an unreachable database rather than by
     * stubbing the query: an ES module namespace is frozen, so the export
     * cannot be replaced, and pointing this process at a dead host would
     * poison the connection singleton for every test after it. This exercises
     * the real failure path — a refused connection — rather than a simulated
     * one.
     */
    const script = `
      process.env.DATABASE_URL = 'postgresql://postgres:nope@127.0.0.1:1/nope'
      process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test'
      void (async () => {
        const { GET } = await import(${JSON.stringify(ROUTE_PATH)})
        const response = await GET(new Request('https://example.test/feed.xml'))
        process.stdout.write(JSON.stringify({
          status: response.status,
          cacheControl: response.headers.get('cache-control'),
          body: await response.text(),
        }))
      })()
    `

    const { stdout } = await execFile('npx', ['tsx', '--eval', script], { timeout: 60_000 })
    const result = JSON.parse(stdout)

    assert.equal(result.status, 503)
    assert.doesNotMatch(result.body, /<rss/)
    assert.equal(result.cacheControl, 'no-store')
  })

  test('filters to a single provider', async () => {
    const response = await feed.GET(request('https://example.test/feed.xml?provider=anthropic'))
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.ok(body.includes('<item>'), 'expected some Anthropic events')
    const providers = [...body.matchAll(/<category>([^<]+)<\/category>/g)]
      .map((m) => m[1])
      .filter((c) => c !== 'New model' && c !== 'Price change')
    assert.deepEqual([...new Set(providers)], ['Anthropic'])
  })

  test('accepts providers comma-separated and repeated', async () => {
    const comma = await feed.GET(request('https://example.test/feed.xml?provider=anthropic,openai'))
    const repeated = await feed.GET(
      request('https://example.test/feed.xml?provider=anthropic&provider=openai'),
    )

    assert.equal((await comma.text()).match(/<item>/g)?.length, (await repeated.text()).match(/<item>/g)?.length)
  })

  test('filters to one event kind', async () => {
    const response = await feed.GET(request('https://example.test/feed.xml?type=model_added'))
    const body = await response.text()

    assert.ok(body.includes('<category>New model</category>'))
    assert.doesNotMatch(body, /<category>Price change<\/category>/)
  })

  test('honours an explicit limit and clamps an absurd one', async () => {
    const five = await feed.GET(request('https://example.test/feed.xml?limit=5'))
    const huge = await feed.GET(request('https://example.test/feed.xml?limit=9999'))

    assert.equal((await five.text()).match(/<item>/g)?.length, 5)
    assert.equal((await huge.text()).match(/<item>/g)?.length, 200)
  })

  test('serves a valid feed rather than an error for unusable parameters', async () => {
    // A reader has nowhere to show a 400 — it just marks the subscription
    // broken. Ignoring junk and serving the default feed is the more useful
    // failure.
    const response = await feed.GET(
      request('https://example.test/feed.xml?limit=abc&type=bogus&provider='),
    )
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.match(body, /<rss version="2\.0"/)
    assert.equal(body.match(/<item>/g)?.length, 50)
  })

  test('an unknown provider returns an empty but valid feed', async () => {
    const response = await feed.GET(request('https://example.test/feed.xml?provider=not-a-provider'))
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.match(body, /<\/channel>/)
    assert.equal(body.match(/<item>/g), null)
  })

  test('rel=self echoes only the filters that were honoured', async () => {
    const response = await feed.GET(
      request('https://example.test/feed.xml?provider=anthropic&type=bogus&limit=abc'),
    )
    const body = await response.text()

    const self = body.match(/<atom:link href="([^"]+)"/)?.[1] ?? ''
    assert.match(self, /provider=anthropic/)
    assert.doesNotMatch(self, /type=/)
    assert.doesNotMatch(self, /limit=/)
  })

  test('the channel title names the active filters', async () => {
    const response = await feed.GET(
      request('https://example.test/feed.xml?provider=anthropic&type=price_change'),
    )
    const body = await response.text()

    const title = body.match(/<title>([^<]+)<\/title>/)?.[1] ?? ''
    assert.match(title, /anthropic/)
    assert.match(title, /price changes/)
  })
})
