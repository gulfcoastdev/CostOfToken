import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NormalizedModel } from '../src/lib/types.ts'
import type { BaselineModel } from '../src/pipeline/anomaly.ts'
import {
  arbitrate,
  diffChanges,
  MAX_JUDGED,
  type ArbiterVerdict,
  type Judge,
  type PriceChange,
} from '../src/pipeline/arbiter.ts'
import { buildAlert } from '../src/lib/alert.ts'
import type { RunSummary } from '../src/pipeline/run.ts'

// ---------------------------------------------------------------------------
// 010-llm-price-arbiter.
//
// The deterministic parser stays the only source of prices; the arbiter only
// judges *changes* before they are written. Its two powers are "let the
// parsed value through" and "hold the stored value" — it can never author a
// number, and it can never take the pipeline down.
// ---------------------------------------------------------------------------

function model(
  modelId: string,
  prices: { input?: number | null; cached?: number | null; output?: number | null },
  raw?: unknown,
): NormalizedModel {
  return {
    providerSlug: 'openai',
    modelId,
    displayName: modelId,
    contextWindow: null,
    maxOutputTokens: null,
    longContextThreshold: null,
    description: null,
    modality: ['text'],
    tags: [],
    isActive: true,
    // Classified so the DB-backed tests' temp rows don't trip the parallel
    // classify-db suite's "every flagged model explains why" audit mid-test.
    classification: { modelType: 'general', status: 'confirmed', source: 'derived', note: 'test fixture' },
    pricing: {
      inputPrice: prices.input ?? null,
      cachedInputPrice: prices.cached ?? null,
      outputPrice: prices.output ?? null,
      longInputPrice: null,
      longCachedInputPrice: null,
      longOutputPrice: null,
      currency: 'USD',
      sourceUrl: 'https://example.test/pricing',
      sourceKind: 'scrape',
      raw,
    },
  }
}

function base(
  modelId: string,
  prices: { input?: number | null; cached?: number | null; output?: number | null },
): BaselineModel {
  return {
    modelId,
    inputPrice: prices.input ?? null,
    cachedInputPrice: prices.cached ?? null,
    outputPrice: prices.output ?? null,
  }
}

const judgeAll =
  (verdict: ArbiterVerdict['verdict'], reason = 'stub'): Judge =>
  async (_system, payload) => {
    const parsed = JSON.parse(payload) as { changes: Array<{ modelId: string }> }
    return parsed.changes.map((c) => ({ modelId: c.modelId, verdict, reason, confidence: 'high' as const }))
  }

// --- diffChanges -----------------------------------------------------------

test('diffChanges reports only existing models whose prices moved', () => {
  const baseline = [base('a', { input: 1, output: 2 }), base('b', { input: 3, output: 6 })]
  const parsed = [
    model('a', { input: 1, output: 2 }), // unchanged
    model('b', { input: 4, output: 6 }), // input moved
    model('c', { input: 9, output: 9 }), // new model: not arbitrated
  ]

  const changes = diffChanges(baseline, parsed)

  assert.deepEqual(
    changes.map((c) => c.modelId),
    ['b'],
  )
  assert.equal(changes[0].stored.inputPrice, 3)
  assert.equal(changes[0].parsed.inputPrice, 4)
})

test('diffChanges treats null vs number as a change, null vs null as none', () => {
  const baseline = [base('a', { input: 1, output: null }), base('b', { input: null })]
  const parsed = [
    model('a', { input: 1, output: 5 }),
    model('b', { input: null, output: null }),
  ]

  const changes = diffChanges(baseline, parsed)
  assert.deepEqual(
    changes.map((c) => c.modelId),
    ['a'],
  )
})

test('diffChanges carries the scraped evidence, capped in size', () => {
  const baseline = [base('a', { input: 4 })]
  const raw = { row: ['a', 'Audio', '$32.00'], filler: 'x'.repeat(10_000) }
  const changes = diffChanges(baseline, [model('a', { input: 32 }, raw)])

  assert.equal(changes.length, 1)
  assert.ok(changes[0].evidence.includes('Audio'), 'evidence must reach the judge')
  assert.ok(changes[0].evidence.length <= 2100, 'evidence is bounded')
})

// --- arbitrate -------------------------------------------------------------

test('a confident real verdict applies the change and says why', async () => {
  const changes = diffChanges([base('a', { input: 1 })], [model('a', { input: 2 })])
  const outcome = await arbitrate(changes, judgeAll('real', 'vendor repriced'))

  assert.equal(outcome.holds.size, 0)
  assert.equal(outcome.anomalies.length, 1)
  assert.equal(outcome.anomalies[0].code, 'arbiter_note')
  assert.match(outcome.anomalies[0].message, /a: applied — vendor repriced/)
})

test('a real verdict at low confidence is held and reported, not applied', async () => {
  const changes = diffChanges([base('a', { input: 1 })], [model('a', { input: 2 })])
  const judge: Judge = async () => [
    { modelId: 'a', verdict: 'real', reason: 'probably a repricing but the page is ambiguous', confidence: 'low' },
  ]

  const outcome = await arbitrate(changes, judge)

  // Only a verdict the judge is sure of may move a published number; doubt
  // informs the operator instead of acting.
  assert.deepEqual([...outcome.holds], ['a'])
  const hold = outcome.anomalies.find((a) => a.code === 'arbiter_hold')!
  assert.match(hold.message, /a: real \(low confidence\) — probably a repricing/)
})

test('misread and unclear verdicts hold the write, one anomaly per model', async () => {
  const changes = diffChanges(
    [base('a', { input: 4 }), base('b', { input: 1 }), base('c', { input: 2 })],
    [model('a', { input: 32 }), model('b', { input: 1.5 }), model('c', { input: 3 })],
  )
  const judge: Judge = async () => [
    { modelId: 'a', verdict: 'misread', reason: 'evidence row is Audio, stored price is Text', confidence: 'high' as const },
    { modelId: 'b', verdict: 'real', reason: 'plausible repricing', confidence: 'high' as const },
    { modelId: 'c', verdict: 'unclear', reason: 'evidence does not show the value', confidence: 'high' as const },
  ]

  const outcome = await arbitrate(changes, judge)

  assert.deepEqual([...outcome.holds].sort(), ['a', 'c'])
  const holds = outcome.anomalies.filter((a) => a.code === 'arbiter_hold')
  assert.equal(holds.length, 2)
  assert.match(holds[0].message, /a: misread — evidence row is Audio/)
  // The details.models shape is what buildAlert already renders.
  const detail = (holds[0].details as { models: Array<{ before: number; after: number }> })
    .models[0]
  assert.equal(detail.before, 4)
  assert.equal(detail.after, 32)
})

test('a verdict for a model the run did not change is ignored', async () => {
  const changes = diffChanges([base('a', { input: 1 })], [model('a', { input: 2 })])
  const judge: Judge = async () => [
    { modelId: 'ghost-model', verdict: 'misread', reason: 'hallucinated', confidence: 'high' as const },
    { modelId: 'a', verdict: 'real', reason: 'fine', confidence: 'high' as const },
  ]

  const outcome = await arbitrate(changes, judge)
  assert.equal(outcome.holds.size, 0)
})

test('a change the response does not cover is written and noted, not held', async () => {
  const changes = diffChanges(
    [base('a', { input: 1 }), base('b', { input: 1 })],
    [model('a', { input: 2 }), model('b', { input: 2 })],
  )
  const judge: Judge = async () => [{ modelId: 'a', verdict: 'real', reason: 'fine', confidence: 'high' as const }]

  const outcome = await arbitrate(changes, judge)

  // Silence from the judge must never hold a write: absence of judgment is
  // not judgment.
  assert.equal(outcome.holds.size, 0)
  assert.ok(
    outcome.anomalies.some((a) => a.code === 'arbiter_note' && /unjudged/.test(a.message)),
    'uncovered changes are called out',
  )
})

test('replay: the 2026-08-22 modality flip is held as a misread', async () => {
  // What production recorded: stored Text rates, parsed Audio rates, and the
  // scraped evidence row saying "Audio" in plain sight.
  const baseline = [base('gpt-realtime', { input: 4, cached: 0.4 })]
  const parsed = [
    model(
      'gpt-realtime',
      { input: 32, cached: 0.4 },
      {
        headers: ['Model', 'Modality', 'Input', 'Cached input', 'Output / cost'],
        row: ['gpt-realtime', 'Audio', '$32.00', '$0.40', '$64.00'],
      },
    ),
  ]

  const changes = diffChanges(baseline, parsed)
  let sawEvidence = false
  const judge: Judge = async (_system, payload) => {
    // The judge must be shown the contradicting evidence to be able to catch
    // this class of fault at all.
    sawEvidence = payload.includes('Audio')
    return [
      {
        modelId: 'gpt-realtime',
        verdict: 'misread',
        reason: 'evidence row is the Audio modality; stored price is the Text rate',
        confidence: 'high' as const,
      },
    ]
  }

  const outcome = await arbitrate(changes, judge)

  assert.ok(sawEvidence, 'raw evidence reaches the judge')
  assert.deepEqual([...outcome.holds], ['gpt-realtime'])

  // And the operator sees the diagnosis in the alert with no alert changes.
  const summary: RunSummary = {
    runId: 'test',
    startedAt: '',
    finishedAt: '',
    durationMs: 0,
    dryRun: false,
    providers: [
      {
        provider: 'openai',
        status: 'ok',
        sourceKind: 'scrape',
        modelsFound: 1,
        modelsRejected: 0,
        modelsChanged: 0,
        durationMs: 0,
        anomalies: outcome.anomalies,
      },
    ],
    totalModels: 1,
    totalChanged: 0,
    ok: true,
    blocked: 0,
  }
  const alert = buildAlert(summary)
  assert.match(alert.body, /arbiter_hold/)
  assert.match(alert.body, /Audio modality/)
})

test('an empty change set asks the judge nothing', async () => {
  let called = false
  const judge: Judge = async () => {
    called = true
    return []
  }
  const outcome = await arbitrate([], judge)
  assert.equal(called, false)
  assert.equal(outcome.holds.size, 0)
  assert.equal(outcome.anomalies.length, 0)
})

// --- upsertProviderModels hold filter (DB-backed) --------------------------

import { after, before, describe } from 'node:test'
import { loadEnv } from '../scripts/load-env.ts'

loadEnv()
process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'
// DATABASE_URL only, never SUPABASE_DB_URL — the suite must not reach prod.
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

describe('held prices survive the upsert', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let sql: typeof import('../src/lib/db.ts').sql
  let closeDb: () => Promise<void>
  let upsert: typeof import('../src/pipeline/upsert.ts')
  let providerId: string

  const SLUG = 'arbiter-test-provider'

  before(async () => {
    ;({ sql, closeDb } = await import('../src/lib/db.ts'))
    upsert = await import('../src/pipeline/upsert.ts')
    const [row] = await sql<Array<{ id: string }>>`
      insert into providers (slug, name, website, pricing_url)
      values (${SLUG}, 'Arbiter Test', 'https://example.test', 'https://example.test/pricing')
      on conflict (slug) do update set name = excluded.name
      returning id
    `
    providerId = row.id
  })

  after(async () => {
    await sql`delete from providers where slug = ${SLUG}`
    await closeDb()
  })

  test('a held model keeps all price fields; a non-held model writes', async () => {
    const seed = [
      model('held-model', { input: 4, cached: 0.4, output: 16 }),
      model('free-model', { input: 1, output: 2 }),
    ].map((m) => ({ ...m, providerSlug: SLUG }))
    await upsert.upsertProviderModels(providerId, seed)

    const rescrape = [
      model('held-model', { input: 32, cached: 0.4, output: 64 }),
      model('free-model', { input: 1.5, output: 3 }),
    ].map((m) => ({ ...m, providerSlug: SLUG, displayName: `${m.modelId} v2` }))

    const result = await upsert.upsertProviderModels(
      providerId,
      rescrape,
      new Set(['held-model']),
    )

    const rows = await sql<
      Array<{ model_id: string; display_name: string; input_price: number; output_price: number }>
    >`
      select m.model_id, m.display_name, pr.input_price, pr.output_price
        from models m
        join prices pr on pr.model_id = m.id
       where m.provider_id = ${providerId}
       order by m.model_id
    `

    const held = rows.find((r) => r.model_id === 'held-model')!
    const free = rows.find((r) => r.model_id === 'free-model')!

    assert.equal(held.input_price, 4, 'held price keeps its stored value')
    assert.equal(held.output_price, 16)
    assert.equal(held.display_name, 'held-model v2', 'model metadata still refreshes')
    assert.equal(free.input_price, 1.5, 'non-held model writes normally')
    assert.equal(result.pricesChanged, 1, 'only the written change is counted')

    const [history] = await sql<Array<{ count: string }>>`
      select count(*) as count from price_history h
        join models m on m.id = h.model_id
       where m.provider_id = ${providerId} and m.model_id = 'held-model'
    `
    assert.equal(Number(history.count), 1, 'a hold writes no history row (only the seed row exists)')
  })

  // Lives in this describe so it runs before after() closes the shared pool —
  // a second describe reusing `sql` after closeDb() hangs the suite.
  test('runPipeline wiring: a misread verdict holds the price and surfaces in the summary', async () => {
    const { readFile } = await import('node:fs/promises')
    const { runPipeline } = await import('../src/pipeline/run.ts')

    const fixture = await readFile(
      new URL('./fixtures/openai-pricing-2026-08-22.md', import.meta.url),
      'utf8',
    )
    const ctxFor = (body: string) => ({
      fetchText: async (url: string) => {
        if (url.includes('platform.openai.com')) return body
        throw new Error('offline test: only the pricing page is served')
      },
    })

    // Establish a fixture baseline (enrichment failure is best-effort).
    await runPipeline({ only: ['openai'], ctx: ctxFor(fixture), judgeFactory: () => null })

    // Re-run with one price altered; the judge calls it a misread.
    const bumped = fixture.replace(
      '| gpt-realtime | Text | $4.00 | $0.40 | $16.00 |',
      '| gpt-realtime | Text | $5.55 | $0.40 | $16.00 |',
    )
    assert.notEqual(bumped, fixture, 'fixture row must exist to alter')

    const summary = await runPipeline({
      only: ['openai'],
      ctx: ctxFor(bumped),
      judgeFactory: () => async () => [
        { modelId: 'gpt-realtime', verdict: 'misread', reason: 'synthetic test hold', confidence: 'high' as const },
      ],
    })

    const openai = summary.providers[0]
    assert.equal(openai.status, 'ok')
    assert.ok(
      openai.anomalies?.some((a) => a.code === 'arbiter_hold' && /synthetic test hold/.test(a.message)),
      'the hold verdict reaches the run summary',
    )

    const [row] = await sql<Array<{ input_price: number }>>`
      select pr.input_price from prices pr
        join models m on m.id = pr.model_id
        join providers p on p.id = m.provider_id
       where p.slug = 'openai' and m.model_id = 'gpt-realtime'
    `
    assert.equal(row.input_price, 4, 'the held price keeps its stored value')
  })
})

// --- failure modes: the arbiter can never take the pipeline down -----------

test('no judge (no API key) writes everything and says so', async () => {
  const changes = diffChanges([base('a', { input: 1 })], [model('a', { input: 2 })])
  const outcome = await arbitrate(changes, null)

  assert.equal(outcome.holds.size, 0)
  assert.equal(outcome.anomalies.length, 1)
  assert.match(outcome.anomalies[0].message, /arbiter unavailable.*OPEN_ROUTER_API_KEY/)
})

test('a throwing judge degrades to write-everything plus a note', async () => {
  const changes = diffChanges([base('a', { input: 1 })], [model('a', { input: 2 })])
  const judge: Judge = async () => {
    throw new Error('api exploded')
  }

  const outcome = await arbitrate(changes, judge)
  assert.equal(outcome.holds.size, 0)
  assert.match(outcome.anomalies[0].message, /arbiter unavailable \(api exploded\)/)
})

test('a null response degrades to write-everything plus a note', async () => {
  const changes = diffChanges([base('a', { input: 1 })], [model('a', { input: 2 })])
  const outcome = await arbitrate(changes, async () => null)

  assert.equal(outcome.holds.size, 0)
  assert.match(outcome.anomalies[0].message, /no usable verdicts/)
})

test('an oversized change set judges the first MAX_JUDGED and notes the rest', async () => {
  const count = MAX_JUDGED + 10
  const baseline = Array.from({ length: count }, (_, i) => base(`m${i}`, { input: 1 }))
  const parsed = Array.from({ length: count }, (_, i) => model(`m${i}`, { input: 2 }))
  const changes = diffChanges(baseline, parsed)

  let judgedCount = 0
  const judge: Judge = async (_system, payload) => {
    const body = JSON.parse(payload) as { changes: PriceChange[] }
    judgedCount = body.changes.length
    return body.changes.map((c) => ({
      modelId: c.modelId,
      verdict: 'misread' as const,
      reason: 'stub',
      confidence: 'high' as const,
    }))
  }

  const outcome = await arbitrate(changes, judge)

  assert.equal(judgedCount, MAX_JUDGED, 'only the cap is sent')
  assert.equal(outcome.holds.size, MAX_JUDGED, 'judged changes can still hold')
  assert.ok(
    outcome.anomalies.some((a) => /judged 40 of 50 changes; 10 written unjudged/.test(a.message)),
    'overflow is written and called out, never held wholesale',
  )
})

test('createOpenRouterJudge is off without an API key', async () => {
  const { createOpenRouterJudge } = await import('../src/pipeline/arbiter.ts')
  const saved = process.env.OPEN_ROUTER_API_KEY
  delete process.env.OPEN_ROUTER_API_KEY
  try {
    assert.equal(createOpenRouterJudge(), null)
  } finally {
    if (saved !== undefined) process.env.OPEN_ROUTER_API_KEY = saved
  }
})
