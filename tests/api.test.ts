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


  test('GET /prices exposes model_type without changing the default set', async () => {
    /*
     * The contract half of this feature. The site's own views default to chat
     * models, but silently dropping 32 models from what existing integrations
     * already receive would be a breaking change to a published response —
     * Constitution VI. Type is additive; the filter is opt-in.
     */
    const response = await prices.GET(request('https://example.test/api/v1/prices?limit=500'))
    const body = await response.json()

    assert.equal(response.status, 200)
    const types = new Set(body.data.map((row: { model_type: string | null }) => row.model_type))
    assert.ok(types.size > 1, 'the default response must still contain non-chat models')
    assert.ok(types.has('general'))

    for (const row of body.data) {
      assert.ok('model_type' in row, `${row.model_id} is missing model_type`)
      assert.ok('classification_status' in row)
      // Null means unknown. An empty object would claim the model has no
      // capabilities, which is a different and false statement.
      assert.notEqual(row.capabilities, {}, `${row.model_id} capabilities must be null, not {}`)
    }
  })

  test('GET /prices filters by type', async () => {
    const response = await prices.GET(
      request('https://example.test/api/v1/prices?type=embedding&limit=50'),
    )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.ok(body.data.length > 0, 'expected embedding models')
    for (const row of body.data) {
      assert.equal(row.model_type, 'embedding')
    }
  })

  test('GET /prices accepts several types, comma-separated or repeated', async () => {
    const comma = await prices.GET(
      request('https://example.test/api/v1/prices?type=embedding,moderation&limit=50'),
    )
    const repeated = await prices.GET(
      request('https://example.test/api/v1/prices?type=embedding&type=moderation&limit=50'),
    )

    const a = await comma.json()
    const b = await repeated.json()
    assert.equal(a.data.length, b.data.length)
    for (const row of a.data) {
      assert.ok(['embedding', 'moderation'].includes(row.model_type))
    }
  })

  test('GET /prices rejects an unknown type', async () => {
    // Loud rejection is right here, unlike the feed: an API caller is a
    // programmer who can read the error and fix the request.
    const response = await prices.GET(request('https://example.test/api/v1/prices?type=nonsense'))
    const body = await response.json()

    assert.equal(response.status, 400)
    assert.equal(body.error.code, 'invalid_parameter')
    assert.match(body.error.message, /type/i)
  })
})

describe('rate limiting', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let closeDb: () => Promise<void>

  before(async () => {
    ;({ closeDb } = await import('../src/lib/db.ts'))
  })

  after(async () => {
    await closeDb()
  })

  test('a caller is blocked after exceeding its own limit', async () => {
    process.env.RATE_LIMIT_ANON_PER_HOUR = '3'
    process.env.RATE_LIMIT_GLOBAL_PER_HOUR = '100000'
    const { checkRateLimit } = await import('../src/lib/rate-limit.ts')

    // A distinct address so the count is not shared with other tests.
    const ip = `198.51.100.${Math.ceil(Math.random() * 250)}`
    const call = () =>
      checkRateLimit(new Request('https://example.test/api/v1/prices', {
        headers: { 'x-forwarded-for': ip },
      }))

    const results = [await call(), await call(), await call(), await call()]

    assert.deepEqual(
      results.map((r) => r.allowed),
      [true, true, true, false],
      'the fourth request should be refused',
    )
    assert.equal(results[3].remaining, 0)
    assert.ok(results[3].retryAfterSeconds > 0)
  })

  test('the site-wide ceiling blocks even a caller under its own limit', async () => {
    /*
     * The protection a per-IP limit cannot provide. Abuse spread across many
     * addresses never trips an individual limit, and on a free plan the
     * consequence is the project being paused rather than a bill.
     */
    process.env.RATE_LIMIT_ANON_PER_HOUR = '100000'
    process.env.RATE_LIMIT_GLOBAL_PER_HOUR = '1'
    const { checkRateLimit } = await import('../src/lib/rate-limit.ts')

    // Every call from a different address, so no individual limit is reached.
    const call = (n: number) =>
      checkRateLimit(new Request('https://example.test/api/v1/prices', {
        headers: { 'x-forwarded-for': `203.0.113.${n}` },
      }))

    await call(1)
    const blocked = await call(2)

    assert.equal(blocked.allowed, false, 'the global ceiling should refuse this')
    assert.equal(blocked.globalLimited, true)
    // Its own limit was nowhere near reached, which is the point.
    assert.equal(blocked.limit, 100000)
  })
})

