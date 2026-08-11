/**
 * The models shown in the "Popular models" panel by default.
 *
 * This is a curated editorial list, not a computed one. There is no honest way
 * to derive "what people actually use" from pricing data — usage isn't in it —
 * so rather than dress a guess up as a ranking, the default is stated plainly
 * here and every visitor can override it by pinning their own.
 *
 * Keep it broad: a flagship and a cheap option from the major providers beats
 * ten variants of one family. Ids that no longer exist are skipped silently,
 * so a model disappearing from a vendor's page degrades the list rather than
 * breaking the panel.
 *
 * Order is preserved as written.
 */
export const DEFAULT_FEATURED_MODEL_IDS: readonly string[] = [
  'gpt-5.6-sol', // OpenAI flagship
  'claude-opus-5', // Anthropic flagship
  'gemini-3.1-pro-preview', // Google flagship
  'grok-4.5', // xAI flagship
  'claude-fable-5',
  'claude-sonnet-5', // mid-tier workhorse
  'gpt-5.6-luna', // cheap OpenAI
  'gemini-3.6-flash', // cheap Google
  'deepseek-v4-pro',
  'glm-5.2',
]

/**
 * Hard cap on the panel. Its whole purpose is to be scannable at a glance —
 * past ten rows it becomes a second full table and stops being a shortcut.
 */
export const MAX_FEATURED = 10
