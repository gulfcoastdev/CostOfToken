import { IDENTITY_ALIASES } from '../../data/aliases.ts'
import { sql } from '@/lib/db.ts'

/**
 * Model identity resolution (011).
 *
 * Matches the same underlying model across sellers ("deepseek-v4-pro" from
 * DeepSeek's API, "deepseek/deepseek-v4-pro:free" from a router,
 * "us.deepseek.v4:0" from a cloud) while keeping versions, sizes and
 * variants separate. Design mirrors the classifier: deterministic rules
 * that refuse to guess, an explicit reviewed alias map for what rules
 * cannot derive, and unresolved offers flagged — never force-merged,
 * because one wrong merge poisons every comparison built on it.
 *
 * Merging rule: two offers share a canonical model ONLY when their
 * normalized ids are byte-identical, or a reviewed alias says so.
 */

export interface ResolvedIdentity {
  slug: string
  displayName: string
  family: string | null
  source: 'rule' | 'alias'
}

/**
 * Vendor namespaces that appear as prefixes on other sellers' ids —
 * `meta-llama/...` on routers, `anthropic....` on clouds. Stripping them is
 * safe because the remainder is the vendor's own model id.
 */
const VENDOR_PREFIXES = [
  'openai',
  'anthropic',
  'google',
  'meta-llama',
  'meta',
  'mistralai',
  'mistral',
  'deepseek',
  'qwen',
  'moonshotai',
  'moonshot',
  'cohere',
  'x-ai',
  'xai',
  'amazon',
  'microsoft',
  'nvidia',
  'z-ai',
  'zhipu',
  'minimax',
  'baidu',
  'bytedance',
  'alibaba',
]

/** Cloud region prefixes (Bedrock cross-region inference profiles). */
const REGION_PREFIXES = /^(us|eu|apac|us-gov)\./

/** Router variant suffixes — offer qualifiers, not identity. */
const VARIANT_SUFFIXES = /:(free|extended|nitro|floor|online|beta|thinking)$/

/**
 * Reduce a seller-specific id to the vendor's bare model id. Pure text
 * rules only; anything the rules don't recognize passes through unchanged
 * so `resolveIdentity` can refuse it.
 */
export function normalizeModelId(raw: string): string {
  let id = raw.trim().toLowerCase()

  id = id.replace(REGION_PREFIXES, '')
  id = id.replace(VARIANT_SUFFIXES, '')
  // Bedrock version markers: "model-id:0". (Applied after variant suffixes.)
  id = id.replace(/:\d+$/, '')

  // One leading vendor namespace, slash- or dot-separated.
  for (const vendor of VENDOR_PREFIXES) {
    if (id.startsWith(`${vendor}/`)) {
      id = id.slice(vendor.length + 1)
      break
    }
    if (id.startsWith(`${vendor}.`)) {
      id = id.slice(vendor.length + 1)
      break
    }
  }

  return id
}

/**
 * The family users browse by — the leading alphabetic tokens of the id
 * ("llama-3.3-70b" → "llama"). Display metadata only; never part of the
 * merging decision.
 */
function familyOf(slug: string): string | null {
  // First name token only: "claude-opus-5" is family "claude", not
  // "claude-opus" — tiers browse within a family, not beside it.
  const match = slug.match(/^([a-z]+)/)
  return match ? match[1] : null
}

/**
 * Resolve one offer's identity. Returns null when no confident identity
 * exists — the caller catalogues the offer unlinked and flags it.
 */
export function resolveIdentity(
  providerSlug: string,
  modelId: string,
  canonicalHint?: string | null,
): ResolvedIdentity | null {
  const aliased = IDENTITY_ALIASES[`${providerSlug}:${modelId}`] ?? IDENTITY_ALIASES[modelId]
  if (aliased) {
    return { slug: aliased, displayName: aliased, family: familyOf(aliased), source: 'alias' }
  }

  // A hint (e.g. a router publishing its upstream id) is evidence run
  // through the same rules — not an authority taken verbatim.
  const candidate = canonicalHint?.trim() ? canonicalHint : modelId
  const slug = normalizeModelId(candidate)

  // Refuse what the rules did not fully reduce: leftover separators mean an
  // id shape we have never seen, and empty/garbage means nothing to name.
  if (!slug || slug.includes('/') || !/^[a-z0-9][a-z0-9.-]*$/.test(slug)) return null

  return { slug, displayName: slug, family: familyOf(slug), source: 'rule' }
}

export interface ResolveOutcome {
  linked: number
  unresolved: number
}

/**
 * Link one provider's active offers to canonical models, creating canonical
 * rows as needed. Idempotent; also the backfill (pre-011 offers are simply
 * offers that have never been linked). Manual links are never overwritten.
 */
export async function resolveProviderOffers(providerId: string): Promise<ResolveOutcome> {
  const offers = await sql<
    Array<{ id: string; model_id: string; display_name: string; model_type: string | null }>
  >`
    select m.id, m.model_id, m.display_name, m.model_type
      from models m
      join providers p on p.id = m.provider_id
     where m.provider_id = ${providerId}
       and m.is_active
       and m.canonical_model_id is null
       and m.resolution_source is distinct from 'manual'
  `
  if (offers.length === 0) return { linked: 0, unresolved: 0 }

  const [{ slug: providerSlug }] = await sql<Array<{ slug: string }>>`
    select slug from providers where id = ${providerId}
  `

  let linked = 0
  let unresolved = 0

  for (const offer of offers) {
    const identity = resolveIdentity(providerSlug, offer.model_id)

    if (!identity) {
      unresolved++
      await sql`
        update models
           set resolution_note = 'unresolved: no confident identity'
         where id = ${offer.id}
      `
      continue
    }

    // The first offer to name a canonical model also gives it its display
    // name and type; later offers only link.
    const [canonical] = await sql<Array<{ id: string }>>`
      insert into canonical_models (slug, display_name, family, model_type)
      values (${identity.slug}, ${offer.display_name}, ${identity.family}, ${offer.model_type})
      on conflict (slug) do update set slug = excluded.slug
      returning id
    `

    await sql`
      update models
         set canonical_model_id = ${canonical.id},
             resolution_source  = ${identity.source},
             resolution_note    = null
       where id = ${offer.id}
    `
    linked++
  }

  return { linked, unresolved }
}
