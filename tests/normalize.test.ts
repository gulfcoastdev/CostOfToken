import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NormalizedModel } from '../src/lib/types.ts'
import {
  inferTags,
  parseMoney,
  parseMoneyStrict,
  parsePricePerMillion,
  parseTokenCount,
  toPerMillionTokens,
  validateModel,
} from '../src/pipeline/normalize.ts'

test('parseMoney reads the formats vendors actually publish', () => {
  assert.deepEqual(parseMoney('$10 / MTok'), { value: 10, currency: 'USD' })
  assert.deepEqual(parseMoney('$12.50 / MTok'), { value: 12.5, currency: 'USD' })
  assert.deepEqual(parseMoney('$1.4'), { value: 1.4, currency: 'USD' })
  assert.deepEqual(parseMoney('¥2.00'), { value: 2, currency: 'CNY' })
  assert.deepEqual(parseMoney('1.25 USD'), { value: 1.25, currency: 'USD' })
  assert.deepEqual(parseMoney('$1,250.00'), { value: 1250, currency: 'USD' })
})

test('parseMoney separates "no price" from "free"', () => {
  // A free tier is a real price of zero; an absent tier is null. Collapsing
  // the two would show unavailable models as free.
  assert.deepEqual(parseMoney('Free'), { value: 0, currency: 'USD' })
  assert.equal(parseMoney('N/A'), null)
  assert.equal(parseMoney('—'), null)
  assert.equal(parseMoney('Not available'), null)
  assert.equal(parseMoney(''), null)
  assert.equal(parseMoney(null), null)
})

test('parseMoneyStrict rejects token counts that look like numbers', () => {
  // Regression guard: Anthropic's "Bash tool" table has an "Additional input
  // tokens" column whose "325 tokens" was being stored as $325/1M.
  assert.equal(parseMoneyStrict('325 tokens'), null)
  assert.equal(parseMoneyStrict('286 tokens'), null)
  assert.equal(parseMoneyStrict('200000'), null)
  assert.deepEqual(parseMoneyStrict('$325'), { value: 325, currency: 'USD' })
  assert.deepEqual(parseMoneyStrict('Free'), { value: 0, currency: 'USD' })
})

test('toPerMillionTokens rescales from the unit named in the header', () => {
  assert.equal(toPerMillionTokens(1.5, 'Price per 1M tokens'), 1.5)
  assert.equal(toPerMillionTokens(1.5, '$ / MTok'), 1.5)
  assert.equal(toPerMillionTokens(0.0015, 'per 1K tokens'), 1.5)
  assert.equal(toPerMillionTokens(0.0000015, 'per token'), 1.5)
  // Unlabelled columns are assumed to already be per-1M, the modern default.
  assert.equal(toPerMillionTokens(1.5, ''), 1.5)
})

test('parsePricePerMillion combines parsing and rescaling', () => {
  assert.deepEqual(parsePricePerMillion('$0.003', 'per 1K tokens'), {
    value: 3,
    currency: 'USD',
  })
  assert.equal(parsePricePerMillion('325 tokens', 'per 1M tokens'), null)
})

test('parseTokenCount handles K/M suffixes and separators', () => {
  assert.equal(parseTokenCount('200K'), 200_000)
  assert.equal(parseTokenCount('1M'), 1_000_000)
  assert.equal(parseTokenCount('128,000'), 128_000)
  assert.equal(parseTokenCount('1,048,576'), 1_048_576)
  assert.equal(parseTokenCount('200k tokens'), 200_000)
  assert.equal(parseTokenCount('unknown'), null)
})

test('inferTags derives tags from model names', () => {
  assert.ok(inferTags('claude-opus-4.5').includes('flagship'))
  assert.ok(inferTags('gemini-3-flash').includes('fast'))
  assert.ok(inferTags('gpt-5.4-nano').includes('fast'))
  assert.ok(inferTags('qwen3-vl-plus').includes('vision'))
})

function model(overrides: Partial<NormalizedModel['pricing']> = {}): NormalizedModel {
  return {
    providerSlug: 'test',
    modelId: 'test-model',
    displayName: 'Test Model',
    contextWindow: 128_000,
    maxOutputTokens: null,
    longContextThreshold: null,
    description: null,
    modality: ['text'],
    tags: [],
    isActive: true,
    pricing: {
      inputPrice: 1,
      cachedInputPrice: null,
      outputPrice: 2,
      longInputPrice: null,
      longCachedInputPrice: null,
      longOutputPrice: null,
      currency: 'USD',
      sourceUrl: null,
      sourceKind: 'scrape',
      ...overrides,
    },
  }
}

test('validateModel accepts well-formed rows', () => {
  assert.equal(validateModel(model()).ok, true)
  // Zero is a legitimate price for a free model.
  assert.equal(validateModel(model({ inputPrice: 0, outputPrice: 0 })).ok, true)
})

test('validateModel rejects rows a broken parser would produce', () => {
  // A context window misread as a price.
  assert.equal(validateModel(model({ inputPrice: 200_000 })).ok, false)
  // Nothing parsed at all.
  assert.equal(validateModel(model({ inputPrice: null, outputPrice: null })).ok, false)
  assert.equal(validateModel(model({ inputPrice: Number.NaN })).ok, false)
  assert.equal(validateModel(model({ outputPrice: -5 })).ok, false)

  const noId = model()
  noId.modelId = ''
  assert.equal(validateModel(noId).ok, false)
})
