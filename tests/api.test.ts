import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { loadEnv } from '../scripts/load-env.ts'

// `npm test` does not read .env.local on its own, so these suites silently
// skipped and reported success while testing nothing.
loadEnv()


/**
 * Exercises the route handlers directly, by calling them with a Request.
 *
 * This layer had a failure that no query test would find: a non-ASCII
 * character in a response header. HTTP header values are ByteStrings, so
 * constructing the response threw and every call to /api/v1/prices returned
 * 500 — while the underlying query was perfectly healthy.
 */

process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'
// Keep the limiter out of the way; it is exercised separately below.
process.env.RATE_LIMIT_ANON_PER_HOUR ??= '10000'

/*
 * Deliberately only DATABASE_URL, never SUPABASE_DB_URL. By convention
 * DATABASE_URL is the local development database and the remote lives under a
 * separate name reached only with an explicit --remote flag, so the test suite
 * cannot reach production even if someone runs it with both configured.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

const request = (url: string) =>
  new Request(url, { headers: { 'x-forwarded-for': `10.0.0.${Math.ceil(Math.random() * 250)}` } })

describe('public API', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let prices: typeof import('../src/app/api/v1/prices/route.ts')
  let providers: typeof import('../src/app/api/v1/providers/route.ts')
  let closeDb: () => Promise<void>

  before(async () => {
    prices = await import('../src/app/api/v1/prices/route.ts')
    providers = await import('../src/app/api/v1/providers/route.ts')
    ;({ closeDb } = await import('../src/lib/db.ts'))
  })

  after(async () => {
    await closeDb()
  })

  test('GET /prices returns a well-formed envelope', async () => {
    const response = await prices.GET(request('https://example.test/api/v1/prices?limit=3'))
    assert.equal(response.status, 200)

    const body = (await response.json()) as { meta: Record<string, unknown>; data: unknown[] }
    assert.equal(body.meta.version, 'v1')
    assert.equal(body.data.length, 3)
    assert.equal(body.meta.count, 3)
    assert.ok(typeof body.meta.total === 'number')
  })

  test('every response carries the attribution requirement', async () => {
    const response = await prices.GET(request('https://example.test/api/v1/prices?limit=1'))
    const body = (await response.json()) as { meta: { attribution?: Record<string, unknown> } }

    assert.ok(body.meta.attribution, 'attribution missing from the payload')
    assert.equal(body.meta.attribution.required, true)
    assert.ok(String(body.meta.attribution.url).startsWith('http'))
    assert.ok(String(body.meta.attribution.html).includes('<a href'))
  })

  test('response headers are constructible ASCII', async () => {
    // Regression: an em dash in a header value threw at response construction
    // and returned 500 for every request. Reading the headers back is what
    // proves the response was actually built.
    const response = await prices.GET(request('https://example.test/api/v1/prices?limit=1'))

    const attribution = response.headers.get('x-attribution-required')
    assert.ok(attribution, 'attribution header missing')
    // eslint-disable-next-line no-control-regex
    assert.ok(/^[\x00-\x7F]*$/.test(attribution), `header must be ASCII, got: ${attribution}`)

    assert.ok(response.headers.get('link')?.includes('rel="license"'))
    assert.ok(response.headers.get('x-ratelimit-limit'))
  })

  test('bad parameters are rejected rather than silently ignored', async () => {
    for (const query of ['sort=DROP+TABLE', 'limit=abc', 'limit=0', 'offset=-5', 'min_input=cheap']) {
      const response = await prices.GET(request(`https://example.test/api/v1/prices?${query}`))
      assert.equal(response.status, 400, `expected 400 for ${query}`)

      const body = (await response.json()) as { error?: { code?: string } }
      assert.equal(body.error?.code, 'invalid_parameter')
    }
  })

  test('provider filtering is applied', async () => {
    const list = await providers.GET(request('https://example.test/api/v1/providers'))
    const body = (await list.json()) as { data: Array<{ slug: string; model_count: number }> }
    const target = body.data.find((provider) => provider.model_count > 0)
    if (!target) return

    const response = await prices.GET(
      request(`https://example.test/api/v1/prices?provider=${target.slug}&limit=100`),
    )
    const filtered = (await response.json()) as { data: Array<{ provider: string }> }

    assert.ok(filtered.data.length > 0)
    assert.ok(filtered.data.every((row) => row.provider === target.slug))
  })

  test('an unknown provider returns an empty set, not an error', async () => {
    const response = await prices.GET(
      request('https://example.test/api/v1/prices?provider=not-a-real-provider'),
    )
    assert.equal(response.status, 200)

    const body = (await response.json()) as { data: unknown[]; meta: { total: number } }
    assert.equal(body.data.length, 0)
  })

  test('GET /providers reports model counts as numbers', async () => {
    const response = await providers.GET(request('https://example.test/api/v1/providers'))
    assert.equal(response.status, 200)

    const body = (await response.json()) as { data: Array<{ slug: string; model_count: unknown }> }
    assert.ok(body.data.length > 0)
    // Postgres returns count() as a string; it must be converted before it
    // reaches a consumer doing arithmetic on it.
    assert.ok(body.data.every((row) => typeof row.model_count === 'number'))
  })
})
