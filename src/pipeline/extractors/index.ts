import { anthropicExtractor } from './anthropic.ts'
import { googleExtractor } from './google.ts'
import { openaiExtractor } from './openai.ts'
import { createOpenRouterExtractor } from './openrouter.ts'
import type { Extractor } from './types.ts'
import { xaiExtractor } from './xai.ts'
import { zhipuExtractor } from './zhipu.ts'

/**
 * Extractor registry.
 *
 * First-party extractors read the vendor's own published pricing. Where a
 * vendor has no machine-readable source (client-rendered consoles, mainland-
 * only docs, or a pricing URL that has moved), a labelled OpenRouter-backed
 * extractor stands in — see openrouter.ts for the provenance caveat.
 */

/** Reads the vendor's own site or API. */
export const FIRST_PARTY_EXTRACTORS: readonly Extractor[] = [
  openaiExtractor,
  anthropicExtractor,
  googleExtractor,
  xaiExtractor,
  zhipuExtractor,
]

/**
 * Reseller-sourced stand-ins, used only for providers absent from the
 * first-party list. Vendor prefixes are OpenRouter's model-id namespaces.
 */
export const FALLBACK_EXTRACTORS: readonly Extractor[] = [
  createOpenRouterExtractor('deepseek', ['deepseek']),
  createOpenRouterExtractor('alibaba', ['qwen', 'alibaba']),
  createOpenRouterExtractor('moonshot', ['moonshotai', 'moonshot']),
  createOpenRouterExtractor('bytedance', ['bytedance', 'doubao']),
  createOpenRouterExtractor('baidu', ['baidu', 'ernie']),
  createOpenRouterExtractor('minimax', ['minimax']),
]

const FIRST_PARTY_SLUGS = new Set(FIRST_PARTY_EXTRACTORS.map((e) => e.providerSlug))

export const ALL_EXTRACTORS: readonly Extractor[] = [
  ...FIRST_PARTY_EXTRACTORS,
  ...FALLBACK_EXTRACTORS.filter((e) => !FIRST_PARTY_SLUGS.has(e.providerSlug)),
]

export function getExtractors(only?: string[]): Extractor[] {
  if (!only || only.length === 0) return [...ALL_EXTRACTORS]
  const wanted = new Set(only)
  return ALL_EXTRACTORS.filter((e) => wanted.has(e.providerSlug))
}

export type { Extractor }
