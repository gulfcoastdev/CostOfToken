import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  detectOfferEvents,
  detectCheapestFlips,
  type CheapestState,
} from '../src/pipeline/monitor.ts'
import type { BaselineModel } from '../src/pipeline/anomaly.ts'

// ---------------------------------------------------------------------------
// 011: price-monitoring engine. Durable events per run: offers appearing and
// disappearing, prices moving, and — the product's headline — the cheapest
// seller of a model changing. No material change → no events, no noise.
// ---------------------------------------------------------------------------

const base = (modelId: string, input: number | null, output: number | null): BaselineModel => ({
  modelId,
  inputPrice: input,
  cachedInputPrice: null,
  outputPrice: output,
})

const seen = (modelId: string, input: number | null, output: number | null) => ({
  modelId,
  inputPrice: input,
  cachedInputPrice: null as number | null,
  outputPrice: output,
})

test('added, removed and changed offers each produce one event', () => {
  const baseline = [base('stays', 1, 2), base('changes', 1, 2), base('goes', 1, 2)]
  const current = [seen('stays', 1, 2), seen('changes', 1.5, 2), seen('arrives', 9, 9)]

  const events = detectOfferEvents(baseline, current, new Set())

  assert.deepEqual(
    events.map((e) => [e.kind, e.modelId]).sort(),
    [
      ['offer_added', 'arrives'],
      ['offer_removed', 'goes'],
      ['price_change', 'changes'],
    ],
  )
  const change = events.find((e) => e.kind === 'price_change')!
  assert.equal((change.details as { before: { inputPrice: number } }).before.inputPrice, 1)
  assert.equal((change.details as { after: { inputPrice: number } }).after.inputPrice, 1.5)
})

test('a change the arbiter held produces no price_change event', () => {
  const baseline = [base('held', 4, 16)]
  const current = [seen('held', 32, 64)]

  const events = detectOfferEvents(baseline, current, new Set(['held']))
  assert.equal(events.length, 0, 'a held write changed nothing in the catalogue')
})

test('no material change means zero events', () => {
  const baseline = [base('a', 1, 2)]
  assert.deepEqual(detectOfferEvents(baseline, [seen('a', 1, 2)], new Set()), [])
})

test('a cheapest-provider flip is detected with before and after', () => {
  const before: CheapestState[] = [
    { canonicalId: 'c1', slug: 'llama-3.3-70b', providerSlug: 'together', cost: 10 },
  ]
  const after: CheapestState[] = [
    { canonicalId: 'c1', slug: 'llama-3.3-70b', providerSlug: 'groq', cost: 8 },
  ]

  const flips = detectCheapestFlips(before, after)
  assert.equal(flips.length, 1)
  assert.equal(flips[0].kind, 'cheapest_flip')
  const details = flips[0].details as {
    before: { providerSlug: string; cost: number }
    after: { providerSlug: string; cost: number }
  }
  assert.equal(details.before.providerSlug, 'together')
  assert.equal(details.after.providerSlug, 'groq')
})

test('a price move that keeps the same cheapest provider is not a flip', () => {
  const before: CheapestState[] = [
    { canonicalId: 'c1', slug: 's', providerSlug: 'groq', cost: 10 },
  ]
  const after: CheapestState[] = [
    { canonicalId: 'c1', slug: 's', providerSlug: 'groq', cost: 9 },
  ]
  assert.deepEqual(detectCheapestFlips(before, after), [])
})

test('a canonical gaining its first priced offer is not a flip', () => {
  const after: CheapestState[] = [
    { canonicalId: 'c1', slug: 's', providerSlug: 'groq', cost: 9 },
  ]
  // Nothing was cheapest before; there is no switch to recommend yet.
  assert.deepEqual(detectCheapestFlips([], after), [])
})

// --- persistence (DB-backed) -----------------------------------------------

import { after, before, describe } from 'node:test'
import { loadEnv } from '../scripts/load-env.ts'

loadEnv()
process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

describe('recordMonitoringEvents', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let sql: typeof import('../src/lib/db.ts').sql
  let closeDb: () => Promise<void>
  let providerId: string
  const SLUG = 'monitor-test-provider'
  const RUN_ID = '00000000-0000-4000-8000-000000000011'

  before(async () => {
    ;({ sql, closeDb } = await import('../src/lib/db.ts'))
    const [row] = await sql<Array<{ id: string }>>`
      insert into providers (slug, name, website, pricing_url)
      values (${SLUG}, 'Monitor Test', 'https://example.test', 'https://example.test/p')
      on conflict (slug) do update set name = excluded.name
      returning id
    `
    providerId = row.id
    await sql`
      insert into models (provider_id, model_id, display_name, is_active,
                          model_type, classification_status, classification_note)
      values (${providerId}, 'monitored-model', 'Monitored', true, 'general', 'confirmed', 'test')
      on conflict (provider_id, model_id) do nothing
    `
  })

  after(async () => {
    await sql`delete from monitoring_events where run_id = ${RUN_ID}`
    await sql`delete from providers where slug = ${SLUG}`
    await closeDb()
  })

  test('events persist with the offer row resolved by model id', async () => {
    const { recordMonitoringEvents } = await import('../src/pipeline/monitor.ts')

    const written = await recordMonitoringEvents(RUN_ID, providerId, [
      { kind: 'price_change', modelId: 'monitored-model', details: { before: { inputPrice: 1 }, after: { inputPrice: 2 } } },
      { kind: 'offer_removed', modelId: 'not-in-db-anymore', details: {} },
    ])
    assert.equal(written, 2)

    const rows = await sql<Array<{ kind: string; model_id: string | null; details: unknown }>>`
      select kind, model_id, details from monitoring_events
       where run_id = ${RUN_ID} order by kind
    `
    assert.equal(rows.length, 2)
    const change = rows.find((r) => r.kind === 'price_change')!
    assert.ok(change.model_id, 'offer id resolved to the models row')
    assert.equal((change.details as { after: { inputPrice: number } }).after.inputPrice, 2)
    const removed = rows.find((r) => r.kind === 'offer_removed')!
    assert.equal(removed.model_id, null, 'a vanished offer still records, unlinked')
  })
})
