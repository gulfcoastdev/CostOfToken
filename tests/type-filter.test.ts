import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveTypeFilter, type ModelType } from '../src/lib/types.ts'

/**
 * The type filter's behaviour when classification data is absent.
 *
 * This exists because of an outage, and the outage is worth stating plainly:
 * the classification code was deployed while the production database still had
 * no classification columns. Every row came back with `model_type: null`, the
 * explorer's default 'general' selection matched none of them, and a site
 * holding 219 models rendered an empty table. Nothing failed loudly — the API
 * coalesces the missing column to null, so a schema that predates the code is
 * indistinguishable here from data that is merely untyped.
 *
 * The existing suites could not have caught it. They run against a local
 * database that has already had `db:push` applied, so they only ever exercise
 * the migrated combination. These tests exercise the other one.
 */

function rows(...types: Array<ModelType | null>): Array<{ model_type: ModelType | null }> {
  return types.map((model_type) => ({ model_type }))
}

test('an unclassified catalogue shows everything rather than nothing', () => {
  // The unmigrated database: rows present, not one of them typed.
  const unclassified = rows(null, null, null)

  assert.equal(resolveTypeFilter(unclassified, 'general'), 'all')
})

test('a classified catalogue honours the selection', () => {
  const classified = rows('general', 'embedding', 'moderation')

  assert.equal(resolveTypeFilter(classified, 'general'), 'general')
  assert.equal(resolveTypeFilter(classified, 'embedding'), 'embedding')
  assert.equal(resolveTypeFilter(classified, 'all'), 'all')
})

test('a partly classified catalogue still filters', () => {
  /*
   * One typed row is enough to prove the column exists and is populated, which
   * is the only question this fallback asks. Genuinely untyped models are a
   * normal state — classification refuses to guess and flags instead — so they
   * must not disable the filter for everything else.
   */
  const partial = rows('general', null, null)

  assert.equal(resolveTypeFilter(partial, 'general'), 'general')
})

test('an empty result set does not force the filter open', () => {
  /*
   * No rows means a search or provider filter matched nothing, which is a real
   * answer the reader asked for. Falling back to 'all' here would silently
   * widen a deliberate query.
   */
  assert.equal(resolveTypeFilter([], 'general'), 'general')
})
