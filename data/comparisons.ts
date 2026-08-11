/**
 * The model pairings that get a dedicated page.
 *
 * Deliberately hand-picked and short. Generating every possible pairing would
 * produce tens of thousands of near-identical pages, which search engines
 * treat as thin content and which drags down the quality signal of the whole
 * site. A comparison earns a page when people genuinely weigh those two models
 * against each other — check analytics before adding one.
 *
 * Each entry needs `reason` to say what the page is actually for. If the
 * comparison has nothing to say beyond two rows of the main table, it should
 * not be a page.
 */
export interface ComparisonPair {
  /** URL segment: `${a.model}-vs-${b.model}`. Must be unique. */
  slug: string
  a: { provider: string; model: string }
  b: { provider: string; model: string }
  /** The decision this page helps someone make. */
  reason: string
}

export const COMPARISONS: ComparisonPair[] = [
  {
    slug: 'gpt-5.6-sol-vs-claude-opus-5',
    a: { provider: 'openai', model: 'gpt-5.6-sol' },
    b: { provider: 'anthropic', model: 'claude-opus-5' },
    reason:
      'The two frontier models most often shortlisted against each other for work where quality matters more than cost.',
  },
  {
    slug: 'gpt-5.6-luna-vs-gemini-3.6-flash',
    a: { provider: 'openai', model: 'gpt-5.6-luna' },
    b: { provider: 'google', model: 'gemini-3.6-flash' },
    reason:
      'The usual choice for high-volume work, where a small difference per million tokens becomes a large difference per month.',
  },
]

export function findComparison(slug: string): ComparisonPair | null {
  return COMPARISONS.find((pair) => pair.slug === slug.toLowerCase()) ?? null
}

/** Comparisons featuring a given model, for cross-linking from its page. */
export function comparisonsForModel(provider: string, model: string): ComparisonPair[] {
  return COMPARISONS.filter(
    (pair) =>
      (pair.a.provider === provider && pair.a.model === model) ||
      (pair.b.provider === provider && pair.b.model === model),
  )
}
