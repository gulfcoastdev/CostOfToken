import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { loadEnv } from '../scripts/load-env.ts'

// `npm test` does not read .env.local on its own, so these suites silently
// skipped and reported success while testing nothing.
loadEnv()

/**
 * Event derivation, against a real database.
 *
 * None of this is observable without one. The window functions that pair each
 * price with its predecessor, the exclusion of a model's first history row,
 * and the ordering that keeps a feed stable between fetches are all properties
 * of the SQL, not of any TypeScript this project could unit-test.
 */

process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'

/*
 * Deliberately only DATABASE_URL, never SUPABASE_DB_URL. By convention
 * DATABASE_URL is the local development database and the remote lives under a
 * separate name reached only with an explicit --remote flag, so the test suite
 * cannot reach production even if someone runs it with both configured.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

describe('feed event derivation', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let queries: typeof import('../src/lib/queries.ts')
  let closeDb: () => Promise<void>

  before(async () => {
    queries = await import('../src/lib/queries.ts')
    ;({ closeDb } = await import('../src/lib/db.ts'))
  })

  after(async () => {
    await closeDb()
  })

  test('getFeedEvents returns rows in the FeedEvent shape', async () => {
    const events = await queries.getFeedEvents({ limit: 25 })

    assert.ok(events.length > 0, 'expected some events in a populated catalog')

    for (const event of events) {
      assert.ok(['model_added', 'price_change'].includes(event.kind), `bad kind ${event.kind}`)
      assert.equal(typeof event.id, 'string')
      assert.ok(event.id.length > 0, 'an event with no id cannot have a stable guid')
      assert.ok(!Number.isNaN(Date.parse(event.occurredAt)), `bad date ${event.occurredAt}`)
      assert.equal(typeof event.provider, 'string')
      assert.ok(event.providerName.length > 0)
      assert.ok(event.modelId.length > 0)
      assert.ok(event.displayName.length > 0)
      assert.ok(event.description === null || typeof event.description === 'string')

      // Prices are numbers or null — never strings, which is how numeric
      // columns arrive from postgres unless explicitly parsed.
      for (const value of Object.values(event.prices)) {
        assert.ok(value === null || typeof value === 'number', `bad price on ${event.modelId}`)
      }
    }
  })

  test('getFeedEvents includes model_added events', async () => {
    const events = await queries.getFeedEvents({ limit: 200 })

    const additions = events.filter((event) => event.kind === 'model_added')
    assert.ok(additions.length > 0, 'expected additions for a catalog with models')

    for (const addition of additions) {
      assert.equal(addition.previous, null, 'an addition has nothing to have changed from')
    }
  })

  test('getFeedEvents orders events newest first', async () => {
    const events = await queries.getFeedEvents({ limit: 100 })

    const times = events.map((event) => Date.parse(event.occurredAt))
    const sorted = [...times].sort((a, b) => b - a)
    assert.deepEqual(times, sorted, 'feed items must be newest first')
  })

  test('getFeedEvents honours the limit', async () => {
    const events = await queries.getFeedEvents({ limit: 3 })

    assert.equal(events.length, 3)
  })

  test('getFeedEvents orders deterministically when timestamps tie', async () => {
    // The initial catalog import gave hundreds of models an identical
    // created_at. Without a tiebreaker their order would shuffle between
    // fetches, and a reader would re-render items it had already seen.
    const first = await queries.getFeedEvents({ limit: 50 })
    const second = await queries.getFeedEvents({ limit: 50 })

    assert.deepEqual(
      first.map((event) => `${event.kind}:${event.id}`),
      second.map((event) => `${event.kind}:${event.id}`),
    )
  })

  test('a model_added event reports the price the model launched at', async () => {
    // Not today's price under an old date: an addition entry is dated when the
    // model appeared, so quoting a later price there would be a factual error
    // in any reader that keeps entries.
    const events = await queries.getFeedEvents({ limit: 200 })
    const addition = events.find((event) => event.kind === 'model_added' && event.prices.input !== null)
    assert.ok(addition, 'expected at least one priced addition')

    const history = await queries.getHistory(addition.modelId, 500)
    if (history.length === 0) return // nothing recorded; the prices row is the only source

    const firstRecorded = history[history.length - 1]
    assert.equal(addition.prices.input, firstRecorded.input)
    assert.equal(addition.prices.output, firstRecorded.output)
  })

  test('a model\'s first recorded price does not also become a price change', async () => {
    /*
     * The history trigger fires on insert as well as update, so a model's
     * first history row is written by the same statement that creates its
     * price. Publishing it would announce one real-world event twice — "new
     * model" and "price changed from nothing" — which is plausible-looking
     * output rather than an error, and so invisible without this test.
     */
    const events = await queries.getFeedEvents({ limit: 500 })

    const byModel = new Map<string, Set<string>>()
    for (const event of events) {
      const kinds = byModel.get(event.modelId) ?? new Set<string>()
      kinds.add(`${event.kind}@${event.occurredAt}`)
      byModel.set(event.modelId, kinds)
    }

    for (const [modelId, stamps] of byModel) {
      const added = [...stamps].filter((s) => s.startsWith('model_added@')).map((s) => s.split('@')[1])
      const changed = [...stamps].filter((s) => s.startsWith('price_change@')).map((s) => s.split('@')[1])
      for (const at of added) {
        assert.ok(!changed.includes(at), `${modelId} announced twice at ${at}`)
      }
    }
  })

  test('price_change events carry the superseded prices', async () => {
    const events = await queries.getFeedEvents({ limit: 500 })
    const changes = events.filter((event) => event.kind === 'price_change')

    assert.ok(changes.length > 0, 'expected price movement in a catalog with history')

    for (const change of changes) {
      assert.ok(change.previous !== null, `${change.modelId} change has no previous prices`)
      const moved = (['input', 'cachedInput', 'output', 'longInput', 'longOutput'] as const).some(
        (key) => change.prices[key] !== change.previous![key],
      )
      assert.ok(moved, `${change.modelId} recorded a change where nothing moved`)
    }
  })

  test('a model with N history rows yields N-1 price changes', async () => {
    // The trigger only writes when a value actually moved, so every row after
    // the first is a real event — and exactly one event.
    const events = await queries.getFeedEvents({ limit: 500 })
    const changes = events.filter((event) => event.kind === 'price_change')
    assert.ok(changes.length > 0)

    const modelId = changes[0].modelId
    const history = await queries.getHistory(modelId, 500)
    const forModel = changes.filter((event) => event.modelId === modelId)

    assert.equal(forModel.length, history.length - 1)
  })

  test('simultaneous moves across several price fields make one event', async () => {
    const events = await queries.getFeedEvents({ limit: 500 })
    const changes = events.filter((event) => event.kind === 'price_change')

    const seen = new Set<string>()
    for (const change of changes) {
      const key = `${change.modelId}@${change.occurredAt}`
      assert.ok(!seen.has(key), `${key} produced more than one item`)
      seen.add(key)
    }
  })

  test('getFeedEvents filters to the named providers', async () => {
    const events = await queries.getFeedEvents({ provider: ['anthropic'], limit: 50 })

    assert.ok(events.length > 0, 'expected events for a provider that is tracked')
    for (const event of events) {
      assert.equal(event.provider, 'anthropic')
    }
  })

  test('getFeedEvents accepts several providers at once', async () => {
    // A generous limit on purpose: the newest N events can all belong to one
    // busy provider, so a small limit would test the ordering rather than the
    // filter and fail for the wrong reason.
    const both = await queries.getFeedEvents({ provider: ['anthropic', 'openai'], limit: 500 })
    const anthropic = await queries.getFeedEvents({ provider: ['anthropic'], limit: 500 })

    const providers = new Set(both.map((event) => event.provider))
    for (const provider of providers) {
      assert.ok(['anthropic', 'openai'].includes(provider), `unexpected provider ${provider}`)
    }
    assert.ok(providers.has('anthropic') && providers.has('openai'), 'expected both providers')
    assert.equal(both.length, anthropic.length + both.filter((e) => e.provider === 'openai').length)
  })

  test('getFeedEvents filters to one event kind', async () => {
    const additions = await queries.getFeedEvents({ kind: 'model_added', limit: 50 })
    const changes = await queries.getFeedEvents({ kind: 'price_change', limit: 50 })

    assert.ok(additions.length > 0 && changes.length > 0)
    assert.ok(additions.every((event) => event.kind === 'model_added'))
    assert.ok(changes.every((event) => event.kind === 'price_change'))
  })

  test('an unknown provider yields no events rather than an error', async () => {
    // A subscription naming a provider that does not exist must degrade to an
    // empty feed; a reader cannot act on an exception.
    const events = await queries.getFeedEvents({ provider: ['not-a-provider'], limit: 50 })

    assert.deepEqual(events, [])
  })

  test('the limit applies after filtering, not before', async () => {
    const events = await queries.getFeedEvents({ kind: 'price_change', limit: 5 })

    assert.equal(events.length, 5)
    assert.ok(events.every((event) => event.kind === 'price_change'))
  })
})
