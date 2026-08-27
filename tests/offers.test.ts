import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cheapestOffer, rankOffers, type Offer } from '../src/lib/offers.ts'

// ---------------------------------------------------------------------------
// 011: comparison engine. The cheapest *equivalent* offer — standard tier,
// compared only on fields an offer actually publishes. A missing number is
// never treated as zero (that would crown an offer cheapest for hiding its
// price).
// ---------------------------------------------------------------------------

function offer(partial: Partial<Offer> & { providerSlug: string }): Offer {
  return {
    providerSlug: partial.providerSlug,
    providerName: partial.providerName ?? partial.providerSlug,
    providerType: partial.providerType ?? 'vendor',
    modelId: partial.modelId ?? 'm',
    displayName: partial.displayName ?? 'm',
    offerTier: partial.offerTier ?? 'standard',
    offerRegion: partial.offerRegion ?? null,
    priceLayer: partial.priceLayer ?? 'list',
    promoEndsAt: partial.promoEndsAt ?? null,
    inputPrice: partial.inputPrice ?? null,
    outputPrice: partial.outputPrice ?? null,
    cachedInputPrice: partial.cachedInputPrice ?? null,
  }
}

const WORKLOAD = { inputTokens: 1_000_000, outputTokens: 1_000_000 }

test('the cheapest standard-tier offer wins on workload cost', () => {
  const offers = [
    offer({ providerSlug: 'vendor', inputPrice: 4, outputPrice: 16 }),
    offer({ providerSlug: 'router', providerType: 'router', inputPrice: 2, outputPrice: 8 }),
    offer({ providerSlug: 'cloud', providerType: 'cloud', inputPrice: 5, outputPrice: 20 }),
  ]

  const cheapest = cheapestOffer(offers, WORKLOAD)
  assert.equal(cheapest?.offer.providerSlug, 'router')
  assert.equal(cheapest?.cost, 10) // 2 + 8 for 1M in / 1M out
})

test('non-standard tiers never compete for cheapest', () => {
  const offers = [
    offer({ providerSlug: 'vendor', inputPrice: 4, outputPrice: 16 }),
    offer({ providerSlug: 'batchy', offerTier: 'batch', inputPrice: 1, outputPrice: 4 }),
    // 014: a $0 free route is parked in its own strip — it must never crush
    // the paid ranking or trigger cheapest-flips.
    offer({ providerSlug: 'freedoor', offerTier: 'free', inputPrice: 0, outputPrice: 0 }),
  ]
  assert.equal(cheapestOffer(offers, WORKLOAD)?.offer.providerSlug, 'vendor')
})

test('an offer missing a needed price is ranked apart, never as free', () => {
  const offers = [
    offer({ providerSlug: 'complete', inputPrice: 4, outputPrice: 16 }),
    offer({ providerSlug: 'no-output', inputPrice: 0.1, outputPrice: null }),
  ]

  const ranked = rankOffers(offers, WORKLOAD)
  assert.equal(ranked.priced[0].offer.providerSlug, 'complete')
  assert.deepEqual(
    ranked.unpriced.map((o) => o.providerSlug),
    ['no-output'],
  )
  assert.equal(cheapestOffer(offers, WORKLOAD)?.offer.providerSlug, 'complete')
})

test('zero is a real price and can win', () => {
  const offers = [
    offer({ providerSlug: 'vendor', inputPrice: 4, outputPrice: 16 }),
    offer({ providerSlug: 'free-host', inputPrice: 0, outputPrice: 0 }),
  ]
  const cheapest = cheapestOffer(offers, WORKLOAD)
  assert.equal(cheapest?.offer.providerSlug, 'free-host')
  assert.equal(cheapest?.cost, 0)
})

test('a single offer is trivially cheapest (degenerate pre-011 case)', () => {
  const only = [offer({ providerSlug: 'vendor', inputPrice: 4, outputPrice: 16 })]
  assert.equal(cheapestOffer(only, WORKLOAD)?.offer.providerSlug, 'vendor')
})

test('no priceable offers means no cheapest, not a fabricated one', () => {
  const offers = [offer({ providerSlug: 'a', inputPrice: null, outputPrice: null })]
  assert.equal(cheapestOffer(offers, WORKLOAD), null)
})

test('savings against the vendor-direct offer are reported', () => {
  const offers = [
    offer({ providerSlug: 'vendor', providerType: 'vendor', inputPrice: 4, outputPrice: 16 }),
    offer({ providerSlug: 'router', providerType: 'router', inputPrice: 2, outputPrice: 8 }),
  ]
  const ranked = rankOffers(offers, WORKLOAD)
  // Vendor pays 20, router 10 → 50% saving vs going direct.
  assert.equal(ranked.vendorDirectCost, 20)
  assert.equal(ranked.priced[0].savingsVsVendor, 0.5)
})

test('equal-cost offers rank deterministically: vendor first, then slug', () => {
  const offers = [
    offer({ providerSlug: 'zrouter', providerType: 'router', inputPrice: 4, outputPrice: 16 }),
    offer({ providerSlug: 'vendor', providerType: 'vendor', inputPrice: 4, outputPrice: 16 }),
    offer({ providerSlug: 'arouter', providerType: 'router', inputPrice: 4, outputPrice: 16 }),
  ]

  // A tie must not flap between runs — 59 phantom cheapest_flip events came
  // from exactly this: same prices, undefined SQL row order. The vendor wins
  // ties (switching sellers for $0.00 savings is not a recommendation), and
  // remaining ties order by slug.
  const ranked = rankOffers(offers, WORKLOAD)
  assert.deepEqual(
    ranked.priced.map((p) => p.offer.providerSlug),
    ['vendor', 'arouter', 'zrouter'],
  )
})

// --- getModelOffers (DB-backed, 013) ---------------------------------------

import { after, before, describe } from 'node:test'
import { loadEnv } from '../scripts/load-env.ts'

loadEnv()
process.env.NEXT_PUBLIC_SITE_URL ??= 'https://example.test'
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)

describe('getModelOffers', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  let sql: typeof import('../src/lib/db.ts').sql
  let closeDb: () => Promise<void>

  before(async () => {
    ;({ sql, closeDb } = await import('../src/lib/db.ts'))
  })

  after(async () => {
    await closeDb()
  })

  test('a multi-seller model returns every active offer of its canonical', async () => {
    const { getModelOffers } = await import('../src/lib/queries.ts')

    // deepseek-v4-pro is sold by deepseek + openrouter (+ more) in the
    // local catalogue built by the pipeline.
    const result = await getModelOffers('deepseek', 'deepseek-v4-pro')

    assert.ok(result, 'the viewed model is linked to a canonical')
    assert.ok(result.offers.length >= 2, `expected multi-seller, got ${result.offers.length}`)
    const sellers = result.offers.map((o) => o.providerSlug)
    assert.ok(sellers.includes('deepseek') && sellers.includes('openrouter'))
    assert.ok(
      result.offers.every((o) => o.inputPrice !== undefined),
      'offers carry the price shape',
    )
  })

  test('a single-offer or unlinked model returns null (no empty section)', async () => {
    const { getModelOffers } = await import('../src/lib/queries.ts')

    // A dated legacy snapshot only OpenAI sells.
    assert.equal(await getModelOffers('openai', 'gpt-4-0613'), null)
    assert.equal(await getModelOffers('openai', 'does-not-exist'), null)
  })
})

describe('getOfferMatrix', { skip: hasDatabase ? false : 'no DATABASE_URL set' }, () => {
  test('featured canonicals become rows with per-seller cells, multi-seller only', async () => {
    const { getOfferMatrix } = await import('../src/lib/queries.ts')

    const rows = await getOfferMatrix(['deepseek-v4-pro', 'no-such-canonical', 'gpt-4-0613'])

    // Unknown slugs and single-seller models are silently skipped — the
    // matrix only earns its place where there is a comparison to show.
    assert.equal(rows.length, 1)
    const row = rows[0]
    assert.equal(row.slug, 'deepseek-v4-pro')
    assert.ok(row.cells['openrouter'], 'openrouter cell present')
    assert.ok(row.cells['first-party'], 'vendor-direct cell present')
    assert.ok(row.cells['first-party'].inputPrice !== undefined)
    assert.ok(row.cheapest, 'a cheapest column is named')
  })
})
