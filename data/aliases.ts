/**
 * Reviewed identity aliases (011).
 *
 * Keys are `providerSlug:modelId` (exact, pre-normalization) or a bare
 * normalized id; values are the canonical slug the offer belongs to. This
 * file exists for names the deterministic rules cannot derive — rolling
 * aliases a vendor repoints ("deepseek-chat" → whatever is current), or
 * marketing names that differ from the technical id.
 *
 * Every entry is a human decision, like data/overrides.ts: the resolver
 * treats a hit as authoritative but records `resolution_source: 'alias'`
 * so the decision is auditable.
 */
export const IDENTITY_ALIASES: Readonly<Record<string, string>> = {
  // Deliberately near-empty at launch: an alias is added only after a human
  // verifies the two listings are the same model. No entry is ever derived
  // from a run.

  // Test fixture entry — kept so the alias path stays covered by tests.
  'test-provider:alias-test-name': 'alias-test-canonical',
}
