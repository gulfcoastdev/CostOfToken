# Implementation Plan: Routes and Free Doors

**Branch**: `014-routes-and-free-doors` | **Spec**: [spec.md](./spec.md)

## Schema (additive, idempotent)
- `models.price_layer text not null default 'list'` check in
  ('list','promo','free'); `models.promo_ends_at timestamptz`.
- No new tables. offer_tier gains the value 'free' (no constraint exists on
  offer_tier — free rides the existing column; rankOffers already compares
  only 'standard').

## Ingestion
- openrouter.ts provider extractor: stop skipping `:free` (keep skipping
  `:batch`); a `:free` listing becomes an offer with modelId kept in full
  (`deepseek/deepseek-v4-pro:free`), offerTier 'free', priceLayer 'free'.
  createOpenRouterExtractor (vendor fallbacks) keeps skipping both — vendor
  tables must not list $0 twins (unchanged behaviour, existing comment).
- deepinfra.ts: when `pricing.discount` is present and `discount_ends_at`
  is in the future, layer 'promo' + promoEndsAt; the *list* prices are the
  undiscounted cents fields when the payload distinguishes them (verify at
  implementation; if the payload only carries one set, store what it states
  and record the discount fields in raw — never invent the other layer).
- NormalizedModel: optional `priceLayer`, `promoEndsAt`; upsert writes both.
- resolve.ts: `:free` suffix already strips for canonical linking, so free
  routes attach to the same canonical as their paid twin.
- monitor.ts: exclude tier 'free' offers from cheapestByCanonical input
  (FR-005); offer add/remove events fire as normal.

## Queries + UI
- offers.ts Offer gains priceLayer/promoEndsAt; getModelOffers unchanged in
  shape. rankOffers untouched (tier filter already parks free).
- offer-comparison.tsx: promo badge ("promo · ends {date}") on promo rows;
  free strip below the table listing tier-'free' offers with the caveat
  line; existing provenance/type badges unchanged.
- New pages: src/app/free/page.tsx and src/app/discounts/page.tsx —
  cachedRead queries (free routes with paid fallback via rankOffers;
  promo offers with deadlines), PageShell, nav links, caveat + disclaimer
  copy. Static with revalidation like other data pages.

## Testing
- extractor tests: :free ingested as free-tier offer (provider extractor),
  still skipped by vendor fallbacks; deepinfra promo layer with declared
  fields, list without.
- monitor test: free offers never appear in cheapest state.
- DB test: free-route queries return active-only.
- Build gate for pages.

## Constitution
Truthful layers (promo only when declared; unknown ≠ invented), free ≠
missing ≠ zero-collapse; reuse (rankOffers, cachedRead, PageShell); events
already dated (V, I). Nav additions are additive surfaces (VI).
