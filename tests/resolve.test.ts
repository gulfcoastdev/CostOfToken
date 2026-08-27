import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeModelId, resolveIdentity } from '../src/pipeline/resolve.ts'

// ---------------------------------------------------------------------------
// 011-cross-provider-platform: model identity resolution.
//
// Two offers merge into one canonical model ONLY when their normalized ids
// are byte-identical or an explicit reviewed alias says so. A wrong merge
// poisons every comparison built on it, so the resolver refuses to guess —
// the classifier's proven design, applied to identity.
// ---------------------------------------------------------------------------

test('router-prefixed ids normalize to the bare model id', () => {
  assert.equal(normalizeModelId('deepseek/deepseek-v4-pro'), 'deepseek-v4-pro')
  assert.equal(normalizeModelId('meta-llama/llama-3.3-70b-instruct'), 'llama-3.3-70b-instruct')
  assert.equal(normalizeModelId('moonshotai/kimi-k2.6'), 'kimi-k2.6')
  assert.equal(normalizeModelId('anthropic/claude-opus-5'), 'claude-opus-5')
})

test('router variant suffixes are stripped into offer qualifiers, not ids', () => {
  assert.equal(normalizeModelId('deepseek/deepseek-v4-pro:free'), 'deepseek-v4-pro')
  assert.equal(normalizeModelId('meta-llama/llama-3.3-70b-instruct:nitro'), 'llama-3.3-70b-instruct')
})

test('cloud id decorations are stripped', () => {
  // Bedrock-style: region prefix, vendor dot-prefix, ":0" version marker.
  assert.equal(normalizeModelId('us.anthropic.claude-sonnet-5:0'), 'claude-sonnet-5')
  assert.equal(normalizeModelId('amazon.nova-pro-v1:0'), 'nova-pro-v1')
})

test('a bare vendor id passes through unchanged', () => {
  assert.equal(normalizeModelId('gpt-5.5'), 'gpt-5.5')
  assert.equal(normalizeModelId('claude-opus-5'), 'claude-opus-5')
})

test('different versions never share an identity', () => {
  const a = resolveIdentity('together', 'meta-llama/llama-3.1-70b-instruct')
  const b = resolveIdentity('groq', 'llama-3.3-70b-instruct')
  assert.ok(a && b)
  assert.notEqual(a.slug, b.slug)
})

test('the same model from different sellers resolves to one slug', () => {
  const direct = resolveIdentity('deepseek', 'deepseek-v4-pro')
  const routed = resolveIdentity('openrouter', 'deepseek/deepseek-v4-pro:free')
  assert.ok(direct && routed)
  assert.equal(direct.slug, routed.slug)
  assert.equal(direct.slug, 'deepseek-v4-pro')
})

test('an explicit alias outranks normalization', () => {
  // data/aliases.ts carries reviewed mappings for names rules cannot derive.
  const resolved = resolveIdentity('test-provider', 'alias-test-name')
  assert.ok(resolved)
  assert.equal(resolved.slug, 'alias-test-canonical')
  assert.equal(resolved.source, 'alias')
})

test('unresolvable names are refused, not guessed', () => {
  assert.equal(resolveIdentity('someprovider', ''), null)
  assert.equal(resolveIdentity('someprovider', '???'), null)
  // A normalized id that still contains separators we do not understand is
  // ambiguous — flag it rather than invent a slug.
  assert.equal(resolveIdentity('someprovider', 'a/b/c/d'), null)
})

test('family is derived from the leading name tokens', () => {
  assert.equal(resolveIdentity('groq', 'llama-3.3-70b-instruct')?.family, 'llama')
  assert.equal(resolveIdentity('openai', 'gpt-5.5')?.family, 'gpt')
  assert.equal(resolveIdentity('anthropic', 'claude-opus-5')?.family, 'claude')
})

test('a canonical hint is normalized like anything else, never trusted raw', () => {
  const resolved = resolveIdentity('openrouter', 'weird-router-name', 'deepseek/deepseek-v4-pro')
  assert.ok(resolved)
  assert.equal(resolved.slug, 'deepseek-v4-pro')
})

// --- resolveProviderOffers (DB-backed) -------------------------------------

import { after, before, describe } from 'node:test'
import { loadEnv } from '../scripts/load-env.ts'

loadEnv()
process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'
// DATABASE_URL only, never SUPABASE_DB_URL — the suite must not reach prod.
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

describe('resolveProviderOffers', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let sql: typeof import('../src/lib/db.ts').sql
  let closeDb: () => Promise<void>
  let providerId: string
  const SLUG = 'resolve-test-provider'

  before(async () => {
    ;({ sql, closeDb } = await import('../src/lib/db.ts'))
    const [row] = await sql<Array<{ id: string }>>`
      insert into providers (slug, name, website, pricing_url, provider_type)
      values (${SLUG}, 'Resolve Test', 'https://example.test', 'https://example.test/p', 'router')
      on conflict (slug) do update set name = excluded.name
      returning id
    `
    providerId = row.id
    await sql`
      insert into models (provider_id, model_id, display_name, is_active,
                          model_type, classification_status, classification_note)
      values
        (${providerId}, 'deepseek/resolve-test-model-v9', 'Resolve Test Model', true, 'general', 'confirmed', 'test'),
        (${providerId}, '???', 'Unresolvable', true, 'general', 'confirmed', 'test')
      on conflict (provider_id, model_id) do update set canonical_model_id = null, resolution_source = null
    `
  })

  after(async () => {
    // Provider first: cascading the models releases the canonical row's FK.
    await sql`delete from providers where slug = ${SLUG}`
    await sql`delete from canonical_models where slug = 'resolve-test-model-v9'`
    await closeDb()
  })

  test('links resolvable offers, creates the canonical row, flags the rest', async () => {
    const { resolveProviderOffers } = await import('../src/pipeline/resolve.ts')

    const outcome = await resolveProviderOffers(providerId)
    assert.equal(outcome.linked, 1)
    assert.equal(outcome.unresolved, 1)

    const [linked] = await sql<Array<{ slug: string; resolution_source: string }>>`
      select cm.slug, m.resolution_source
        from models m join canonical_models cm on cm.id = m.canonical_model_id
       where m.provider_id = ${providerId} and m.model_id = 'deepseek/resolve-test-model-v9'
    `
    assert.equal(linked.slug, 'resolve-test-model-v9')
    assert.equal(linked.resolution_source, 'rule')

    const [flagged] = await sql<Array<{ resolution_note: string | null; canonical_model_id: string | null }>>`
      select resolution_note, canonical_model_id from models
       where provider_id = ${providerId} and model_id = '???'
    `
    assert.equal(flagged.canonical_model_id, null)
    assert.match(flagged.resolution_note ?? '', /unresolved/)

    // Idempotent: a second pass finds nothing new to do.
    const again = await resolveProviderOffers(providerId)
    assert.equal(again.linked, 0)
  })
})
