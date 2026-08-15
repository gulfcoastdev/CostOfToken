import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { loadEnv } from '../scripts/load-env.ts'

// `npm test` does not read .env.local on its own, so these suites silently
// skipped and reported success while testing nothing.
loadEnv()

/**
 * Classification across the whole catalogue.
 *
 * The rule tests prove each rule in isolation; these prove that no model falls
 * through all of them, and that the ranking the site is built on no longer
 * contains things that cannot generate text. Neither is visible from a unit
 * test of the rules.
 */

process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'

/*
 * Deliberately only DATABASE_URL, never SUPABASE_DB_URL. By convention
 * DATABASE_URL is the local development database and the remote lives under a
 * separate name reached only with an explicit --remote flag, so the test suite
 * cannot reach production even if someone runs it with both configured.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

const GENERATIVE = 'chat'

describe('classification across the catalogue', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let sql: typeof import('../src/lib/db.ts').sql
  let queries: typeof import('../src/lib/queries.ts')
  let closeDb: () => Promise<void>

  before(async () => {
    ;({ sql, closeDb } = await import('../src/lib/db.ts'))
    queries = await import('../src/lib/queries.ts')
  })

  after(async () => {
    await closeDb()
  })

  test('every active model is either typed or flagged', async () => {
    const rows = await sql<Array<{ model_id: string }>>`
      select model_id from models
       where is_active
         and (model_type is null and classification_status <> 'needs_review'
           or model_type is not null and classification_status = 'needs_review')
    `

    assert.deepEqual(rows.map((r) => r.model_id), [], 'incoherent classification')
  })

  test('a confirmed classification always names a type', async () => {
    const [row] = await sql<Array<{ count: string }>>`
      select count(*) as count from models
       where classification_status = 'confirmed' and model_type is null
    `

    assert.equal(Number(row.count), 0)
  })

  test('every flagged model explains why', async () => {
    // Active models only. A delisted model stopped appearing in its provider's
    // extract, so it never runs through the classifier again and keeps the
    // column's default of 'needs_review' with no note. That is harmless — it
    // is in no view and no ranking — and backfilling prose for models nobody
    // can reach would be busywork.
    const rows = await sql<Array<{ model_id: string }>>`
      select model_id from models
       where is_active
         and classification_status = 'needs_review'
         and (classification_note is null or classification_note = '')
    `

    assert.deepEqual(rows.map((r) => r.model_id), [], 'flagged with no reason recorded')
  })

  test('the non-generative models are actually found', async () => {
    // The bug this feature exists to fix: 32 models that cannot generate text
    // were sitting in the default price ranking. They must now be identified —
    // either typed as something non-chat, or flagged for review.
    const rows = await sql<Array<{ model_id: string; model_type: string | null }>>`
      select model_id, model_type from models
       where is_active
         and model_id ~* 'embed|moderation|tts|whisper|ocr|rerank|guard|image|video|speech|audio|realtime'
         and model_type = ${GENERATIVE}
    `

    assert.deepEqual(
      rows.map((r) => r.model_id),
      [],
      'these look non-generative but were typed as chat',
    )
  })

  test('the cheapest models are all text generators', async () => {
    const page = await queries.getPrices({
      limit: 25,
      offset: 0,
      sort: 'input',
      direction: 'asc',
      modelType: GENERATIVE,
    })

    assert.ok(page.rows.length > 0)
    for (const row of page.rows) {
      assert.equal(row.model_type, GENERATIVE, `${row.model_id} is not a text generator`)
      // A generator that bills nothing for output is not cheap — it is a
      // different kind of thing. This is how a moderation endpoint came to be
      // the 4th cheapest model on the site.
      assert.notEqual(row.output, null, `${row.model_id} has no output price`)
    }
  })

  test('classification deleted nothing', async () => {
    // Reclassifying must never remove a model or take it out of the catalogue;
    // it only changes which view a model appears in.
    const [row] = await sql<Array<{ count: string }>>`select count(*) as count from models where is_active`

    assert.ok(Number(row.count) > 200, `expected the full catalogue, found ${row.count}`)
  })

  test('every model type in use is one the application knows about', async () => {
    const { MODEL_TYPES } = await import('../src/lib/types.ts')
    const rows = await sql<Array<{ model_type: string }>>`
      select distinct model_type from models where model_type is not null
    `

    for (const row of rows) {
      assert.ok(
        (MODEL_TYPES as readonly string[]).includes(row.model_type),
        `unknown type in the database: ${row.model_type}`,
      )
    }
  })
})
