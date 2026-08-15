import type { FeedEvent, FeedPrices } from '../src/lib/queries.ts'

/**
 * Fixtures for the feed suites.
 *
 * Type-only import on purpose: pulling `queries.ts` in at runtime would drag
 * `next/cache` and the database client into a suite that needs neither.
 */

export const PRICES: FeedPrices = {
  input: 5,
  cachedInput: 0.5,
  output: 25,
  longInput: null,
  longOutput: null,
}

/** A `model_added` event by default; pass overrides for anything else. */
export function feedEvent(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    kind: 'model_added',
    id: '3f7c1e8a-0000-4000-8000-000000000001',
    occurredAt: '2026-08-14T12:16:23.000Z',
    provider: 'anthropic',
    providerName: 'Anthropic',
    modelId: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    description: 'Our most capable model for complex reasoning and coding.',
    contextWindow: 200_000,
    currency: 'USD',
    sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/pricing',
    sourceKind: 'scrape',
    prices: { ...PRICES },
    previous: null,
    ...overrides,
  }
}

/** A `price_change` event: input and output both cut, everything else steady. */
export function priceChangeEvent(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return feedEvent({
    kind: 'price_change',
    id: '1487',
    prices: { input: 5, cachedInput: 0.5, output: 15, longInput: null, longOutput: null },
    previous: { input: 15, cachedInput: 0.5, output: 25, longInput: null, longOutput: null },
    ...overrides,
  })
}
