import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTieredCell } from '../src/pipeline/extractors/google.ts'
import { openaiExtractor, splitModelQualifier } from '../src/pipeline/extractors/openai.ts'
import {
  createOpenRouterExtractor,
  resetOpenRouterCache,
} from '../src/pipeline/extractors/openrouter.ts'
import { parseMarkdownTables } from '../src/pipeline/extractors/markdown-table.ts'
import { findInPath, isNonStandardTier, parseTables } from '../src/pipeline/extractors/html-table.ts'
import { decodeFlightPayload, extractModelObjects } from '../src/pipeline/extractors/xai.ts'

test('parseTables expands colspan group headers into flat column names', () => {
  // OpenAI's shape: a group header row spanning sub-columns.
  const html = `
    <table>
      <thead>
        <tr><th></th><th colspan="2">Short context</th><th colspan="2">Long context</th></tr>
        <tr><th>Model</th><th>Input</th><th>Output</th><th>Input</th><th>Output</th></tr>
      </thead>
      <tbody>
        <tr><td>gpt-x</td><td>$1.00</td><td>$2.00</td><td>$3.00</td><td>$4.00</td></tr>
      </tbody>
    </table>`

  const [table] = parseTables(html)
  assert.deepEqual(table.headers, [
    'Model',
    'Short context Input',
    'Short context Output',
    'Long context Input',
    'Long context Output',
  ])
  assert.deepEqual(table.rows[0], ['gpt-x', '$1.00', '$2.00', '$3.00', '$4.00'])
})

test('parseTables builds a heading breadcrumb for nested tier tables', () => {
  // Google's shape: tier tables nested under a model heading.
  const html = `
    <h1>Pricing</h1>
    <h2>Gemini 3 Pro</h2>
    <h3>Standard</h3>
    <table><tr><th></th><th>Paid Tier</th></tr><tr><td>Input price</td><td>$2.00</td></tr></table>
    <h3>Batch</h3>
    <table><tr><th></th><th>Paid Tier</th></tr><tr><td>Input price</td><td>$1.00</td></tr></table>`

  const [standard, batch] = parseTables(html)

  assert.deepEqual(standard.captionPath, ['Standard', 'Gemini 3 Pro', 'Pricing'])
  assert.equal(findInPath(standard, /gemini/i), 'Gemini 3 Pro')
  assert.equal(isNonStandardTier(standard), false)

  assert.equal(isNonStandardTier(batch), true)
})

test('parseTables keeps nested elements from fusing into one word', () => {
  // Regression guard: cheerio's .text() produced "Claude Sonnet 5through
  // August 31, 2026", which broke word-boundary matching downstream.
  const html = `
    <table>
      <tr><th>Model</th><th>Input</th></tr>
      <tr><td>Claude Sonnet 5<span>(through August 31, 2026)</span></td><td>$2.00</td></tr>
    </table>`

  const [table] = parseTables(html)
  assert.equal(table.rows[0][0], 'Claude Sonnet 5 (through August 31, 2026)')
})

test('parseTieredCell splits standard from long-context pricing', () => {
  const tiered = parseTieredCell(
    '$1.25 (prompts <= 200k tokens) $2.50 (prompts > 200k tokens)',
    'Paid Tier, per 1M tokens in USD',
  )
  assert.deepEqual(tiered, { standard: 1.25, long: 2.5, threshold: 200_000 })

  // Two amounts with no threshold marker are not a long-context tier.
  assert.deepEqual(parseTieredCell('$1.25', 'per 1M tokens'), {
    standard: 1.25,
    long: null,
    threshold: null,
  })
  assert.deepEqual(parseTieredCell('Not available', 'per 1M tokens'), {
    standard: null,
    long: null,
    threshold: null,
  })
  assert.deepEqual(parseTieredCell('Free of charge', 'per 1M tokens'), {
    standard: 0,
    long: null,
    threshold: null,
  })
})

test('xAI flight payload decoding recovers model objects', () => {
  const model = {
    name: 'grok-test',
    promptTextTokenPrice: '20000',
    completionTextTokenPrice: '60000',
    maxPromptLength: 500_000,
  }
  // Mimic Next's RSC streaming format: JS string literals inside push() calls.
  const chunk = JSON.stringify(`a:${JSON.stringify({ models: [model] })}\n`)
  const html = `<script>self.__next_f.push([1,${chunk}])</script>`

  const payload = decodeFlightPayload(html)
  const [found] = extractModelObjects(payload)

  assert.equal(found.name, 'grok-test')
  assert.equal(found.promptTextTokenPrice, '20000')
  // Verified against the rendered page: 20000 units renders as "$2.00 / 1M".
  assert.equal(Number(found.promptTextTokenPrice) / 10_000, 2)
  assert.equal(Number(found.completionTextTokenPrice) / 10_000, 6)
})

test('xAI object extraction survives braces inside string values', () => {
  const model = {
    name: 'grok-braces',
    description: 'has a } brace and a { brace in text',
    promptTextTokenPrice: '12500',
  }
  const chunk = JSON.stringify(`a:${JSON.stringify([model])}\n`)
  const html = `<script>self.__next_f.push([1,${chunk}])</script>`

  const [found] = extractModelObjects(decodeFlightPayload(html))
  assert.equal(found.name, 'grok-braces')
})

test('a repeated model keeps the first tier, not the last', async () => {
  // Regression guard: OpenAI renders Standard/Batch/Flex/Priority as four
  // tables with identical headers under one heading. The tier name is a tab,
  // not a heading, so the breadcrumb can't tell them apart — and keying by
  // model id meant the last table won, storing Priority (2x standard) as the
  // headline price.
  // The markdown source names its tiers, but this guards the case where two
  // tables still collide — e.g. a tier heading we don't recognise.
  const md = [
    '## Flagship models',
    '',
    '| Model | Input | Output |',
    '| --- | --- | --- |',
    '| gpt-x | $5.00 | $30.00 |',
    '',
    '| Model | Input | Output |',
    '| --- | --- | --- |',
    '| gpt-x | $10.00 | $60.00 |',
  ].join('\n')

  const models = await openaiExtractor.extract({ fetchText: async () => md })

  assert.equal(models.length, 1)
  assert.equal(models[0].pricing.inputPrice, 5)
  assert.equal(models[0].pricing.outputPrice, 30)
})

test('markdown tables carry heading breadcrumbs and unescape cells', () => {
  const md = [
    '# Pricing',
    '',
    '### Standard pricing data',
    '',
    '| Model | Input | Output |',
    '| --- | --- | --- |',
    '| gpt-x | $5.00 | $30.00 |',
    '| GLM-5.2 | \\$1.4 | \\$4.4 |',
    '| [Claude Opus 5](https://example.com) | $5 / MTok | $25 / MTok |',
    '',
    '### Batch pricing data',
    '',
    '| Model | Input | Output |',
    '| --- | --- | --- |',
    '| gpt-x | $2.50 | $15.00 |',
  ].join('\n')

  const [standard, batch] = parseMarkdownTables(md)

  assert.deepEqual(standard.captionPath, ['Standard pricing data', 'Pricing'])
  assert.deepEqual(standard.headers, ['Model', 'Input', 'Output'])
  // Escaped dollars (Zhipu) and links around model names (Anthropic).
  assert.deepEqual(standard.rows[1], ['GLM-5.2', '$1.4', '$4.4'])
  assert.equal(standard.rows[2][0], 'Claude Opus 5')

  assert.equal(isNonStandardTier(standard), false)
  assert.equal(isNonStandardTier(batch), true)
})

test('splitModelQualifier separates the id from its context qualifier', () => {
  // The qualifier states the long-context threshold, which is published
  // nowhere else on the page.
  assert.deepEqual(splitModelQualifier('gpt-5.5 (<272K context length)'), {
    modelId: 'gpt-5.5',
    threshold: 272_000,
  })
  assert.deepEqual(splitModelQualifier('gpt-5.6-sol'), {
    modelId: 'gpt-5.6-sol',
    threshold: null,
  })
})

/**
 * OpenRouter suffixes a model id with the routing tier it is priced under.
 * Those rates are not comparable to a vendor's standard rate, which is the one
 * thing this table promises, so they must not become rows.
 */
function catalogue(models: Array<Record<string, unknown>>) {
  // The catalogue is memoised for the life of a run, so without this the
  // second test in this file would silently extract the first one's fixture.
  resetOpenRouterCache()
  return {
    fetchText: async () => JSON.stringify({ data: models }),
  }
}

function orModel(id: string, prompt: string, completion: string) {
  return { id, name: id, context_length: 200_000, pricing: { prompt, completion } }
}

test('the OpenRouter extractor skips batch-tier ids', async () => {
  // Batch is asynchronous and typically half price. Publishing it beside
  // another vendor's standard rate is exactly the comparison this project
  // refuses to make — and it arrives looking like an ordinary model.
  const ctx = catalogue([
    orModel('minimax/minimax-m3', '0.0000003', '0.0000012'),
    orModel('minimax/minimax-m3:batch', '0.00000015', '0.0000006'),
  ])

  const models = await createOpenRouterExtractor('minimax', ['minimax']).extract(ctx)

  assert.deepEqual(
    models.map((m) => m.modelId),
    ['minimax-m3'],
  )
})

test('the OpenRouter extractor skips free-tier ids', async () => {
  // A ":free" id is the same model under a rate-limited free route, and it
  // usually has a paid twin in the catalogue. Importing it would list the
  // model twice and claim one of them costs nothing.
  const ctx = catalogue([
    orModel('minimax/minimax-m3', '0.0000003', '0.0000012'),
    orModel('minimax/minimax-m3:free', '0', '0'),
  ])

  const models = await createOpenRouterExtractor('minimax', ['minimax']).extract(ctx)

  assert.deepEqual(
    models.map((m) => m.modelId),
    ['minimax-m3'],
  )
})

test('the OpenRouter extractor keeps capability variants, which are not tiers', async () => {
  // ":thinking" is a different model with its own real price, not a discount
  // on an existing one, so it stays.
  const ctx = catalogue([
    orModel('qwen/qwen-plus-2025-07-28', '0.0000004', '0.0000012'),
    orModel('qwen/qwen-plus-2025-07-28:thinking', '0.0000004', '0.0000012'),
  ])

  const models = await createOpenRouterExtractor('alibaba', ['qwen']).extract(ctx)

  assert.deepEqual(models.map((m) => m.modelId).sort(), [
    'qwen-plus-2025-07-28',
    'qwen-plus-2025-07-28:thinking',
  ])
})

test('every fallback extractor names a provider we actually define', async () => {
  // The registry and the provider list are edited separately; a slug that
  // exists in one and not the other silently produces a provider with no
  // models, or models the site cannot attribute.
  const { FALLBACK_EXTRACTORS, FIRST_PARTY_EXTRACTORS } = await import(
    '../src/pipeline/extractors/index.ts'
  )
  const { isKnownProvider } = await import('../src/pipeline/providers.ts')

  for (const extractor of [...FIRST_PARTY_EXTRACTORS, ...FALLBACK_EXTRACTORS]) {
    assert.ok(isKnownProvider(extractor.providerSlug), `unknown provider ${extractor.providerSlug}`)
  }
})

test('minimax is tracked', async () => {
  const { PROVIDER_BY_SLUG } = await import('../src/pipeline/providers.ts')
  const { ALL_EXTRACTORS } = await import('../src/pipeline/extractors/index.ts')

  assert.ok(PROVIDER_BY_SLUG.has('minimax'), 'minimax is missing from PROVIDERS')
  assert.ok(
    ALL_EXTRACTORS.some((e) => e.providerSlug === 'minimax'),
    'minimax has no extractor',
  )
})
