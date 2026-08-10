import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTieredCell } from '../src/pipeline/extractors/google.ts'
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
