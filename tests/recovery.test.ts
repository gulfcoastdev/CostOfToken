import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveFromSource, type RecoveryChat } from '../src/pipeline/recovery.ts'

// ---------------------------------------------------------------------------
// 012: LLM source recovery. Engages only when the parser failed and page
// text exists; derives prices from the page (never from memory of the
// vendor); low confidence or judge failure degrades to today's behaviour.
// ---------------------------------------------------------------------------

const PAGE = [
  'Realtime models pricing',
  'gpt-realtime — input $4.00, cached $0.40, output $16.00 per 1M tokens',
  'gpt-realtime-mini — input $0.60, cached $0.06, output $2.40 per 1M tokens',
].join('\n')

const BASELINE = [
  { modelId: 'gpt-realtime', inputPrice: 4, cachedInputPrice: 0.4, outputPrice: 16 },
  { modelId: 'gpt-realtime-mini', inputPrice: 0.6, cachedInputPrice: 0.06, outputPrice: 2.4 },
]

const goodJudge: RecoveryChat = async () => ({
  structure: 'prose list of realtime models with per-1M rates',
  structureChanged: true,
  changeAccount: 'tables were replaced by a prose list',
  confidence: 'high',
  models: [
    { modelId: 'gpt-realtime', inputPrice: 4, cachedInputPrice: 0.4, outputPrice: 16 },
    { modelId: 'gpt-realtime-mini', inputPrice: 0.6, cachedInputPrice: 0.06, outputPrice: 2.4 },
  ],
})

const opts = (over: Partial<Parameters<typeof deriveFromSource>[0]> = {}) => ({
  providerSlug: 'openai',
  pricingUrl: 'https://example.test/pricing',
  pageText: PAGE,
  baseline: BASELINE,
  rememberedStructure: null as string | null,
  ...over,
})

test('a high-confidence derivation yields llm-provenance models', async () => {
  const outcome = await deriveFromSource(opts(), goodJudge)

  assert.ok(outcome)
  assert.equal(outcome.confidence, 'high')
  assert.equal(outcome.models.length, 2)
  const m = outcome.models.find((x) => x.modelId === 'gpt-realtime')!
  assert.equal(m.pricing.inputPrice, 4)
  assert.equal(m.pricing.outputPrice, 16)
  assert.equal(m.pricing.sourceKind, 'llm')
  assert.equal(m.providerSlug, 'openai')
  assert.equal(outcome.structureChanged, true)
})

test('models the page does not mention are dropped, not published', async () => {
  const inventing: RecoveryChat = async () => ({
    structure: 's',
    structureChanged: false,
    changeAccount: '',
    confidence: 'high',
    models: [
      { modelId: 'gpt-realtime', inputPrice: 4, cachedInputPrice: null, outputPrice: 16 },
      // Hallucinated from vendor memory — its id is nowhere in the page.
      { modelId: 'gpt-imaginary-9', inputPrice: 1, cachedInputPrice: null, outputPrice: 2 },
    ],
  })

  const outcome = await deriveFromSource(opts(), inventing)
  assert.ok(outcome)
  assert.deepEqual(
    outcome.models.map((m) => m.modelId),
    ['gpt-realtime'],
  )
})

test('low confidence returns the account but no models to write', async () => {
  const unsure: RecoveryChat = async () => ({
    structure: 'page now appears to be a JS shell',
    structureChanged: true,
    changeAccount: 'no visible prices in the served HTML',
    confidence: 'low',
    models: [],
  })

  const outcome = await deriveFromSource(opts(), unsure)
  assert.ok(outcome)
  assert.equal(outcome.confidence, 'low')
  assert.equal(outcome.models.length, 0)
})

test('no page text never consults the judge', async () => {
  let called = false
  const judge: RecoveryChat = async () => {
    called = true
    return null
  }
  const outcome = await deriveFromSource(opts({ pageText: '' }), judge)
  assert.equal(outcome, null)
  assert.equal(called, false)
})

test('a throwing or empty judge degrades to null (todays failure path)', async () => {
  const thrower: RecoveryChat = async () => {
    throw new Error('boom')
  }
  assert.equal(await deriveFromSource(opts(), thrower), null)
  assert.equal(await deriveFromSource(opts(), async () => null), null)
})

test('the remembered structure and known models reach the judge', async () => {
  let payloadSeen = ''
  const judge: RecoveryChat = async (_system, payload) => {
    payloadSeen = payload
    return null
  }
  await deriveFromSource(opts({ rememberedStructure: 'previously: markdown tables' }), judge)
  assert.match(payloadSeen, /previously: markdown tables/)
  assert.match(payloadSeen, /gpt-realtime-mini/)
})

// --- run-level recovery (DB-backed) ----------------------------------------

import { after, before, describe } from 'node:test'
import { loadEnv } from '../scripts/load-env.ts'

loadEnv()
process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

describe('pipeline recovery', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let sql: typeof import('../src/lib/db.ts').sql
  let closeDb: () => Promise<void>

  before(async () => {
    ;({ sql, closeDb } = await import('../src/lib/db.ts'))
  })

  after(async () => {
    // Restore bytedance's real price from the live catalogue and clear the memo.
    await sql`delete from source_structures where provider_slug = 'bytedance'`
    await closeDb()
  })

  test('a broken parser recovers via the judge and writes llm-provenance offers', async () => {
    const { runPipeline } = await import('../src/pipeline/run.ts')

    // bytedance (a one-model provider) is priced via the OpenRouter
    // catalogue; prose instead of JSON makes its extractor throw. The page
    // the run "fetched" is what the judge then reads.
    const prosePage = [
      'ByteDance pricing (redesigned)',
      'ui-tars-1.5-7b now costs $0.10 input / $0.20 output per 1M tokens.',
    ].join('\n')

    const summary = await runPipeline({
      only: ['bytedance'],
      ctx: { fetchText: async () => prosePage },
      judgeFactory: () => null,
      reworkPoster: null,
      recoveryChat: async () => ({
        structure: 'prose paragraphs, one model per line',
        structureChanged: true,
        changeAccount: 'catalogue JSON replaced by prose',
        confidence: 'high',
        models: [
          { modelId: 'ui-tars-1.5-7b', inputPrice: 0.1, cachedInputPrice: null, outputPrice: 0.2 },
        ],
      }),
    })

    const provider = summary.providers[0]
    assert.equal(provider.status, 'partial', 'recovered, not failed')
    assert.deepEqual(provider.recovered, { models: 1, confidence: 'high' })
    assert.ok(
      provider.anomalies?.some((a) => a.code === 'llm_recovery'),
      'recovery is reported through the alert channel',
    )

    const [row] = await sql<Array<{ source_kind: string; input_price: number }>>`
      select pr.source_kind, pr.input_price from prices pr
        join models m on m.id = pr.model_id
        join providers p on p.id = m.provider_id
       where p.slug = 'bytedance' and m.model_id = 'ui-tars-1.5-7b'
    `
    assert.equal(row.source_kind, 'llm', 'provenance says the judge derived it')
    assert.equal(row.input_price, 0.1)

    const [memo] = await sql<Array<{ structure: string }>>`
      select structure from source_structures where provider_slug = 'bytedance'
    `
    assert.match(memo.structure, /prose/)
  })

  test('the second recovery is shown the remembered structure', async () => {
    const { runPipeline } = await import('../src/pipeline/run.ts')

    let remembered = ''
    await runPipeline({
      only: ['bytedance'],
      ctx: { fetchText: async () => 'still prose: ui-tars-1.5-7b $0.10 in / $0.20 out per 1M' },
      judgeFactory: () => null,
      reworkPoster: null,
      recoveryChat: async (_system, payload) => {
        remembered = (JSON.parse(payload) as { rememberedStructure: string | null })
          .rememberedStructure ?? ''
        return {
          structure: 'prose paragraphs, one model per line (unchanged)',
          structureChanged: false,
          changeAccount: '',
          confidence: 'low',
          models: [],
        }
      },
    })

    // The memo written by the previous test's recovery reaches this judge.
    assert.match(remembered, /prose/)

    const [memo] = await sql<Array<{ structure: string }>>`
      select structure from source_structures where provider_slug = 'bytedance'
    `
    assert.match(memo.structure, /unchanged/, 'the memo updates on every recovery')
  })

  test('a healthy run writes no memo and never calls the recovery judge', async () => {
    const { runPipeline } = await import('../src/pipeline/run.ts')
    await sql`delete from source_structures where provider_slug = 'baidu'`

    let called = false
    // baidu parses fine from the real catalogue shape; serve a valid minimal
    // OpenRouter payload so extraction succeeds.
    const catalogue = JSON.stringify({
      data: [
        {
          id: 'baidu/ernie-4.5-vl-424b-a47b',
          name: 'ERNIE',
          pricing: { prompt: '0.0000002', completion: '0.0000004' },
        },
      ],
    })
    await runPipeline({
      only: ['baidu'],
      ctx: { fetchText: async () => catalogue },
      judgeFactory: () => null,
      reworkPoster: null,
      recoveryChat: async () => {
        called = true
        return null
      },
    })

    assert.equal(called, false, 'healthy runs cost zero recovery calls')
    const rows = await sql`select 1 from source_structures where provider_slug = 'baidu'`
    assert.equal(rows.length, 0, 'healthy runs write no memo')
  })

  test('a recovery files one rework issue, deduplicated for a week', async () => {
    const { notifyRework } = await import('../src/pipeline/github.ts')
    await sql`update source_structures set last_notified_at = null where provider_slug = 'bytedance'`

    const posts: Array<{ title: string; body: string }> = []
    const poster = async (title: string, body: string) => {
      posts.push({ title, body })
      return true
    }

    const first = await notifyRework(
      'bytedance',
      { changeAccount: 'catalogue JSON replaced by prose', structure: 'prose', modelsDerived: 1, confidence: 'high' },
      poster,
    )
    assert.equal(first, 'sent')
    assert.equal(posts.length, 1)
    assert.match(posts[0].title, /bytedance/)
    assert.match(posts[0].body, /prose/)

    const second = await notifyRework(
      'bytedance',
      { changeAccount: 'still prose', structure: 'prose', modelsDerived: 1, confidence: 'high' },
      poster,
    )
    assert.equal(second, 'deduped', 'a broken parser files one issue, not one per day')
    assert.equal(posts.length, 1)
  })

  test('notification failure and missing poster degrade without raising', async () => {
    const { notifyRework } = await import('../src/pipeline/github.ts')
    await sql`update source_structures set last_notified_at = null where provider_slug = 'bytedance'`

    const throwing = async () => {
      throw new Error('github down')
    }
    const failed = await notifyRework(
      'bytedance',
      { changeAccount: 'x', structure: 's', modelsDerived: 0, confidence: 'low' },
      throwing,
    )
    assert.equal(failed, 'failed')

    const noted = await notifyRework(
      'bytedance',
      { changeAccount: 'x', structure: 's', modelsDerived: 0, confidence: 'low' },
      null,
    )
    assert.equal(noted, 'noted')
  })

  test('recovery declining leaves todays failure path untouched', async () => {
    const { runPipeline } = await import('../src/pipeline/run.ts')
    const summary = await runPipeline({
      only: ['bytedance'],
      ctx: { fetchText: async () => 'unreadable shell page' },
      judgeFactory: () => null,
      reworkPoster: null,
      recoveryChat: async () => null,
    })
    assert.equal(summary.providers[0].status, 'failed')
  })
})
