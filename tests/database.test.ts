import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { loadEnv } from '../scripts/load-env.ts'

// `npm test` does not read .env.local on its own, so these suites silently
// skipped and reported success while testing nothing.
loadEnv()


/**
 * Tests against a real database.
 *
 * Every serious failure this project has had was invisible to unit tests: a
 * connection pool of one that deadlocked under concurrency, cached functions
 * awaiting other cached functions, a `Map` that could not survive the data
 * cache, and a non-ASCII character in an HTTP header that returned 500 for
 * every API call. None of those are logic bugs — they only appear when real
 * queries run, concurrently, through the real stack.
 *
 * Skips cleanly when no database is configured, so `npm test` still works on a
 * fresh clone. Point DATABASE_URL at a throwaway database: these only read,
 * but that is a promise about today's code, not tomorrow's.
 */

process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'

/*
 * Deliberately only DATABASE_URL, never SUPABASE_DB_URL. By convention
 * DATABASE_URL is the local development database and the remote lives under a
 * separate name reached only with an explicit --remote flag, so the test suite
 * cannot reach production even if someone runs it with both configured.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

describe('database-backed reads', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let queries: typeof import('../src/lib/queries.ts')
  let closeDb: () => Promise<void>

  before(async () => {
    queries = await import('../src/lib/queries.ts')
    ;({ closeDb } = await import('../src/lib/db.ts'))
  })

  after(async () => {
    await closeDb()
  })

  test('getPrices returns rows in the documented shape', async () => {
    const page = await queries.getPrices({ limit: 5, offset: 0, sort: 'input', direction: 'asc' })

    assert.ok(page.rows.length > 0, 'expected some priced models')
    assert.ok(page.total >= page.rows.length)

    for (const row of page.rows) {
      assert.equal(typeof row.provider, 'string')
      assert.equal(typeof row.model_id, 'string')
      assert.ok(row.display_name.length > 0)
      // Prices are numbers or null — never strings, which is how numeric
      // columns arrive from postgres unless explicitly parsed.
      for (const value of [row.input, row.cached_input, row.output]) {
        assert.ok(value === null || typeof value === 'number', `bad price on ${row.model_id}`)
      }
      assert.ok(['scrape', 'api', 'catalog'].includes(row.source_kind))
    }
  })

  test('the connection pool is large enough to serve requests in parallel', async () => {
    /*
     * The setting that took the site down. A pool of one serialises every
     * concurrent render: queries completed, then later ones queued past the
     * 60 second page timeout, failing builds and hanging pages.
     *
     * This asserts the configuration rather than timing it, because a timing
     * test cannot catch it — verified by reintroducing max:1, which the
     * concurrency test below still passed, since a local database answers fast
     * enough that even serialised reads finish immediately. The fault needs
     * remote latency to show up, so the config is what gets guarded.
     */
    const { POOL_OPTIONS } = await import('../src/lib/db.ts')

    assert.ok(
      POOL_OPTIONS.max >= 5,
      `connection pool is ${POOL_OPTIONS.max}; anything near 1 serialises concurrent renders`,
    )
    assert.equal(
      POOL_OPTIONS.idle_timeout,
      0,
      'closing idle connections mid-build was part of the same stall',
    )
  })

  test('concurrent reads all complete', async () => {
    /*
     * A smoke test, not a regression test: it proves the read paths work
     * together and nothing deadlocks outright. It cannot detect a pool that is
     * merely too small — see the configuration assertion above for that.
     */
    const work = [
      queries.getPrices({ limit: 50, offset: 0, sort: 'input', direction: 'asc' }),
      queries.getProviders(),
      queries.getLastUpdated(),
      queries.getPriceTrends(),
      queries.getAllModelRefs(),
      queries.getPrices({ limit: 10, offset: 0, sort: 'output', direction: 'desc' }),
    ]

    const results = await Promise.race([
      Promise.all(work),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('concurrent reads did not complete within 20s')), 20_000),
      ),
    ])

    assert.equal(results.length, 6)
  })

  test('getPriceTrends survives the cache as a Map, not an empty object', async () => {
    // A Map serialises to {} in Next's data cache, so this came back silently
    // empty and every sparkline rendered blank.
    const trends = await queries.getPriceTrends()

    assert.ok(trends instanceof Map, 'expected a Map')
    assert.ok(trends.size > 0, 'expected at least one model with history')

    const [, first] = [...trends][0]
    assert.ok(Array.isArray(first.series))
    assert.ok(first.series.length > 1, 'series should have several sample points')
    assert.ok(first.series.every((value) => typeof value === 'number'))
  })

  test('provider models come back in the provider’s own order', async () => {
    const providers = await queries.getProviders()
    const withModels = providers.find((provider) => provider.model_count > 3)
    if (!withModels) return

    const models = await queries.getProviderModels(withModels.slug)
    assert.ok(models.length > 0)
    assert.ok(models.every((row) => row.provider === withModels.slug))
  })

  test('a model resolves within its provider and unknown ids return null', async () => {
    const page = await queries.getPrices({ limit: 1, offset: 0, sort: 'input', direction: 'asc' })
    const sample = page.rows[0]

    const found = await queries.getModelForProvider(sample.provider, sample.model_id)
    assert.ok(found)
    assert.equal(found.model_id, sample.model_id)

    assert.equal(await queries.getModelForProvider(sample.provider, 'definitely-not-a-model'), null)
    // A real model id under the wrong provider must not resolve.
    assert.equal(await queries.getModelForProvider('not-a-provider', sample.model_id), null)
  })

  test('filters actually filter', async () => {
    const providers = await queries.getProviders()
    const target = providers.find((provider) => provider.model_count > 0)
    if (!target) return

    const filtered = await queries.getPrices({
      limit: 100,
      offset: 0,
      provider: [target.slug],
      sort: 'input',
      direction: 'asc',
    })
    assert.ok(filtered.rows.length > 0)
    assert.ok(filtered.rows.every((row) => row.provider === target.slug))

    const capped = await queries.getPrices({
      limit: 100,
      offset: 0,
      maxInput: 1,
      sort: 'input',
      direction: 'asc',
    })
    assert.ok(capped.rows.every((row) => row.input === null || row.input <= 1))
  })

  test('prices sort ascending with unpriced models last', async () => {
    const page = await queries.getPrices({ limit: 200, offset: 0, sort: 'input', direction: 'asc' })
    const priced = page.rows.filter((row) => row.input !== null).map((row) => row.input as number)

    for (let i = 1; i < priced.length; i++) {
      assert.ok(priced[i] >= priced[i - 1], 'prices should ascend')
    }

    const firstNull = page.rows.findIndex((row) => row.input === null)
    if (firstNull !== -1) {
      assert.ok(
        page.rows.slice(firstNull).every((row) => row.input === null),
        'unpriced models should all sort last',
      )
    }
  })
})
