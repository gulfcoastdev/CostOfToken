import type { Modality, NormalizedModel } from '@/lib/types.ts'
import { cleanDescription, inferTags } from '../normalize.ts'
import type { Extractor } from './types.ts'

const SOURCE_URL = 'https://docs.x.ai/docs/models'

/**
 * xAI's docs are a React Server Components app that embeds the full model
 * catalogue — prices, context window, modalities, aliases — as JSON inside the
 * flight payload. Reading that is far more reliable than scraping rendered
 * markup, so this extractor decodes the payload and pulls the model objects
 * out directly.
 *
 * Units: prices are integers in 1e-4 USD per 1M tokens. Verified against the
 * rendered pricing page, where grok-4.5's promptTextTokenPrice of 20000 is
 * displayed as "$2.00 / 1M tokens" and its long-context 40000 as "$4.00".
 */
const PRICE_UNITS_PER_USD_PER_MILLION = 10_000

interface XaiModel {
  name?: string
  description?: string
  inputModalities?: string[]
  outputModalities?: string[]
  promptTextTokenPrice?: string | number
  promptTextTokenPriceLongContext?: string | number
  cachedPromptTokenPrice?: string | number
  cachedPromptTokenPriceLongContext?: string | number
  completionTextTokenPrice?: string | number
  completionTokenPriceLongContext?: string | number
  maxPromptLength?: number
  aliases?: string[]
  features?: { reasoning?: boolean }
}

export const xaiExtractor: Extractor = {
  providerSlug: 'xai',
  sourceKind: 'scrape',
  sourceUrl: SOURCE_URL,

  async extract(ctx): Promise<NormalizedModel[]> {
    const html = await ctx.fetchText(SOURCE_URL)
    const payload = decodeFlightPayload(html)
    const raw = extractModelObjects(payload)

    const models = new Map<string, NormalizedModel>()

    for (const entry of raw) {
      const modelId = entry.name?.trim()
      if (!modelId) continue

      const input = toUsdPerMillion(entry.promptTextTokenPrice)
      const output = toUsdPerMillion(entry.completionTextTokenPrice)
      if (input === null && output === null) continue

      const longInput = toUsdPerMillion(entry.promptTextTokenPriceLongContext)
      const longOutput = toUsdPerMillion(entry.completionTokenPriceLongContext)

      const modality = toModalities(entry.inputModalities, entry.outputModalities)
      const tags = new Set(inferTags(modelId))
      if (entry.features?.reasoning) tags.add('reasoning')
      // Declared by the catalogue, not guessed from the model's name.
      if (modality.includes('vision')) tags.add('vision')

      models.set(modelId, {
        providerSlug: 'xai',
        modelId,
        displayName: modelId,
        description: cleanDescription(entry.description),
        contextWindow: typeof entry.maxPromptLength === 'number' ? entry.maxPromptLength : null,
        maxOutputTokens: null,
        // The long-context tier kicks in above 128k on xAI's published tiers.
        longContextThreshold: longInput !== null || longOutput !== null ? 128_000 : null,
        modality,
        tags: [...tags].sort(),
        isActive: true,
        pricing: {
          inputPrice: input,
          cachedInputPrice: toUsdPerMillion(entry.cachedPromptTokenPrice),
          outputPrice: output,
          longInputPrice: longInput,
          longCachedInputPrice: toUsdPerMillion(entry.cachedPromptTokenPriceLongContext),
          longOutputPrice: longOutput,
          currency: 'USD',
          sourceUrl: SOURCE_URL,
          sourceKind: 'scrape',
          raw: entry,
        },
      })
    }

    return [...models.values()]
  },
}

/** Declared by xAI's own catalogue, unlike the name-based inference elsewhere. */
function toModalities(input?: string[], output?: string[]): Modality[] {
  const all = [...(input ?? []), ...(output ?? [])].map((m) => m.toLowerCase())
  const modality = new Set<Modality>(['text'])
  if (all.includes('image')) modality.add('vision')
  if (all.includes('audio')) modality.add('audio')
  if (all.includes('video')) modality.add('video')
  return [...modality]
}

function toUsdPerMillion(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return numeric / PRICE_UNITS_PER_USD_PER_MILLION
}

/**
 * Concatenate and unescape the `self.__next_f.push([1,"..."])` chunks that
 * carry the RSC payload. The chunks are JS string literals, so they are
 * decoded with JSON.parse to resolve \" and \\ escapes correctly.
 */
export function decodeFlightPayload(html: string): string {
  const chunks: string[] = []
  const pattern = /self\.__next_f\.push\(\[1,\s*(".*?")\]\)/gs

  for (const match of html.matchAll(pattern)) {
    try {
      chunks.push(JSON.parse(match[1]) as string)
    } catch {
      // A chunk that isn't a well-formed literal is skipped rather than
      // failing the whole extraction.
    }
  }
  return chunks.join('')
}

const MARKER = '"promptTextTokenPrice"'
const MAX_OBJECT_CHARS = 20_000

/**
 * Scan for balanced JSON objects carrying a price key.
 *
 * The payload is not valid JSON as a whole (it's a stream of framed values),
 * so objects are brace-matched out of the text. The scan runs forward while
 * tracking string state, because a `}` inside a string value — model
 * descriptions contain them — makes any backwards brace count wrong.
 *
 * Every object enclosing a match is a candidate, including the arrays and
 * wrappers around it, so results are filtered to those holding the price key
 * as a *direct* property. That is what distinguishes a model from its parent.
 */
export function extractModelObjects(payload: string): XaiModel[] {
  const results: XaiModel[] = []
  const seen = new Set<string>()
  const openStack: number[] = []

  let inString = false
  let escaped = false

  for (let i = 0; i < payload.length; i++) {
    const char = payload[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') {
      openStack.push(i)
      continue
    }
    if (char !== '}') continue

    const start = openStack.pop()
    if (start === undefined) continue

    const length = i + 1 - start
    if (length > MAX_OBJECT_CHARS) continue

    const objectText = payload.slice(start, i + 1)
    if (!objectText.includes(MARKER)) continue

    try {
      const parsed = JSON.parse(objectText) as XaiModel
      if (
        parsed &&
        typeof parsed === 'object' &&
        Object.hasOwn(parsed, 'promptTextTokenPrice') &&
        parsed.name &&
        !seen.has(parsed.name)
      ) {
        seen.add(parsed.name)
        results.push(parsed)
      }
    } catch {
      // Not a self-contained object (a fragment of the stream); skip it.
    }
  }

  return results
}
