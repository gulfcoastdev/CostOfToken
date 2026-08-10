import type { Modality, NormalizedModel } from '@/lib/types.ts'

/**
 * Parsing helpers shared by every extractor.
 *
 * Providers publish prices in wildly different units — per 1K tokens, per 1M
 * tokens, occasionally per single token — and in different currencies. Every
 * extractor funnels its scraped strings through here so that what reaches the
 * database is always "amount per 1,000,000 tokens" plus an explicit currency.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '¥': 'CNY',
  '￥': 'CNY',
  '€': 'EUR',
  '£': 'GBP',
}

export interface ParsedMoney {
  value: number
  currency: string
}

/**
 * Pull a monetary amount out of a table cell.
 *
 * Returns `{ value: 0 }` for explicit free tiers and `null` for cells that
 * carry no price at all ("N/A", "—", "Not available"). The distinction
 * matters: 0 is a real price, null means "this model has no such tier".
 */
export function parseMoney(input: string | null | undefined): ParsedMoney | null {
  if (!input) return null

  const text = input.replace(/ /g, ' ').trim()
  if (!text) return null

  if (/^(n\/?a|—|–|-{1,2}|not applicable|not available|unavailable)$/i.test(text)) {
    return null
  }

  if (/\bfree\b/i.test(text) && !/\d/.test(text)) {
    return { value: 0, currency: 'USD' }
  }

  // Currency from an explicit symbol, or an ISO code appearing anywhere.
  let currency = 'USD'
  const symbol = Object.keys(CURRENCY_SYMBOLS).find((s) => text.includes(s))
  if (symbol) {
    currency = CURRENCY_SYMBOLS[symbol]
  } else {
    const iso = text.match(/\b(USD|CNY|RMB|EUR|GBP)\b/i)
    if (iso) currency = iso[1].toUpperCase() === 'RMB' ? 'CNY' : iso[1].toUpperCase()
  }

  // First number in the cell. Ranges ("$1.00 - $2.00") take the low end;
  // tiered pricing is modelled explicitly via the long-context columns.
  const match = text.match(/-?\d[\d,]*(?:\.\d+)?/)
  if (!match) return null

  const value = Number.parseFloat(match[0].replace(/,/g, ''))
  if (!Number.isFinite(value) || value < 0) return null

  return { value, currency }
}

/**
 * Rescale a price to per-1M tokens based on the unit named in the surrounding
 * text (a column header or the cell itself).
 */
export function toPerMillionTokens(value: number, unitText: string | null | undefined): number {
  if (!unitText) return value
  const unit = unitText.toLowerCase()

  // Order matters: check the larger units first so "1M" doesn't match "1".
  if (/\b(1\s*m|million|1,000,000|1000000|mtok|mtoken)\b/.test(unit)) return value
  if (/\b(1\s*k|thousand|1,000|1000|ktok|ktoken)\b/.test(unit)) return value * 1_000
  if (/per\s+token\b/.test(unit)) return value * 1_000_000

  // No recognisable unit — assume the provider's page already quotes per-1M,
  // which is now the near-universal convention.
  return value
}

/**
 * Like `parseMoney`, but requires the cell to actually look like money.
 *
 * Pricing pages mix price tables with token-count tables ("Additional input
 * tokens: 325 tokens"). A permissive parser turns that 325 into $325/1M, which
 * passes every plausibility check and silently poisons the data. Requiring a
 * currency symbol or code — or an explicit "free" — is what separates the two.
 */
export function parseMoneyStrict(input: string | null | undefined): ParsedMoney | null {
  if (!input) return null
  const text = input.replace(/ /g, ' ').trim()

  const hasCurrency = /[$¥￥€£]/.test(text) || /\b(USD|CNY|RMB|EUR|GBP)\b/i.test(text)
  const isFree = /\bfree\b/i.test(text) && !/\d/.test(text)
  if (!hasCurrency && !isFree) return null

  return parseMoney(text)
}

/** Convenience: parse a cell and rescale it in one step. */
export function parsePricePerMillion(
  cell: string | null | undefined,
  unitText?: string | null,
  { strict = true }: { strict?: boolean } = {},
): ParsedMoney | null {
  const money = strict ? parseMoneyStrict(cell) : parseMoney(cell)
  if (!money) return null
  return { value: toPerMillionTokens(money.value, unitText), currency: money.currency }
}

/**
 * Parse a token count written as "200K", "1M", "128,000", or "1,048,576".
 */
export function parseTokenCount(input: string | null | undefined): number | null {
  if (!input) return null
  const text = input.replace(/ /g, ' ').trim()

  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*([kmKM])?\b/)
  if (!match) return null

  const base = Number.parseFloat(match[1].replace(/,/g, ''))
  if (!Number.isFinite(base) || base <= 0) return null

  const suffix = match[2]?.toLowerCase()
  const value = suffix === 'm' ? base * 1_000_000 : suffix === 'k' ? base * 1_000 : base

  return Math.round(value)
}

const TAG_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(opus|pro\b|max\b|ultra|flagship|gpt-5(?!\S*mini)|grok-\d)\b/i, 'flagship'],
  [/\b(flash|lite|mini|nano|haiku|turbo|fast|air|speed)\b/i, 'fast'],
  [/\b(o[1-9]\b|reason|thinking|think\b|r1\b)\b/i, 'reasoning'],
  [/\b(vision|vl\b|image|visual)\b/i, 'vision'],
  [/\b(cod(e|er|ing)|dev\b)\b/i, 'coding'],
  [/\b(audio|voice|speech|tts|realtime)\b/i, 'audio'],
  [/\b(legacy|deprecated|preview|beta)\b/i, 'preview'],
]

/** Best-effort tags from a model's name. Extractors may override or extend. */
export function inferTags(...sources: Array<string | null | undefined>): string[] {
  const haystack = sources.filter(Boolean).join(' ')
  const tags = new Set<string>()
  for (const [pattern, tag] of TAG_PATTERNS) {
    if (pattern.test(haystack)) tags.add(tag)
  }
  return [...tags].sort()
}

/** Best-effort modality from a model's name and description. */
export function inferModality(...sources: Array<string | null | undefined>): Modality[] {
  const haystack = sources.filter(Boolean).join(' ').toLowerCase()
  const modality = new Set<Modality>(['text'])
  if (/\b(vision|vl\b|multimodal|image input|visual)\b/.test(haystack)) modality.add('vision')
  if (/\b(audio|voice|speech|tts|realtime)\b/.test(haystack)) modality.add('audio')
  if (/\b(video)\b/.test(haystack)) modality.add('video')
  if (/\b(image generation|imagen|image out)\b/.test(haystack)) modality.add('image')
  return [...modality]
}

/** Collapse whitespace and strip footnote markers from scraped table text. */
export function cleanText(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Reject scrapes that parsed into nonsense before they reach the database.
 *
 * A layout change on a provider's page typically yields either no price at
 * all or an absurd one (a context window read as a dollar amount). Both are
 * worse than keeping yesterday's value, so both are filtered here.
 */
const MAX_PLAUSIBLE_PRICE_PER_MILLION = 10_000

export interface ValidationResult {
  ok: boolean
  reason?: string
}

export function validateModel(model: NormalizedModel): ValidationResult {
  if (!model.modelId || !model.modelId.trim()) {
    return { ok: false, reason: 'empty model_id' }
  }
  if (model.modelId.length > 200) {
    return { ok: false, reason: `model_id implausibly long (${model.modelId.length} chars)` }
  }

  const { inputPrice, outputPrice } = model.pricing
  if (inputPrice === null && outputPrice === null) {
    return { ok: false, reason: 'no input or output price parsed' }
  }

  const priceFields: Array<[string, number | null]> = [
    ['input', model.pricing.inputPrice],
    ['cached_input', model.pricing.cachedInputPrice],
    ['output', model.pricing.outputPrice],
    ['long_input', model.pricing.longInputPrice],
    ['long_cached_input', model.pricing.longCachedInputPrice],
    ['long_output', model.pricing.longOutputPrice],
  ]

  for (const [name, value] of priceFields) {
    if (value === null) continue
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, reason: `${name} price is not a valid amount (${value})` }
    }
    if (value > MAX_PLAUSIBLE_PRICE_PER_MILLION) {
      return { ok: false, reason: `${name} price ${value} exceeds sanity ceiling` }
    }
  }

  if (model.contextWindow !== null && model.contextWindow > 100_000_000) {
    return { ok: false, reason: `context window ${model.contextWindow} is implausible` }
  }

  return { ok: true }
}
