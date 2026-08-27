# Feature Specification: Routes and Free Doors

**Feature Branch**: `014-routes-and-free-doors`
**Created**: 2026-08-28
**Status**: Draft
**Input**: Operator: flip the unit of comparison from provider catalog to
model + route. "People already picked a model. They want the cheapest legal
door into it — including $0." Routes (:free, promos, discounted hosts) are
first-class rows; list price and street price are separate layers that must
never collapse; free lives in its own strip so $0 doesn't crush the paid
ranking; every promo is a dated event; caveats on every free/promo cell.

## User Scenarios

### US1 - Free routes are ingested and parked separately (P1)
OpenRouter's `:free` variants become offers with a `free` tier: visible on
the model's page in a "Free routes" strip below the paid ranking — never
inside it — with the standing caveat (rotates, rate-limited, confirm before
spend). "Last seen free" falls out of offer deactivation when a free route
leaves the roster.

**Acceptance**: 1) a model with a `:free` route shows it in the strip, not
the paid table; 2) paid ranking is byte-identical to today; 3) the strip
carries the caveat; 4) a free route leaving the roster deactivates the
offer (a durable offer_removed event fires — "left free").

### US2 - Declared promos carry their layer and deadline (P2)
Offers whose source declares a discount (DeepInfra publishes `discount` and
`discount_ends_at`) are `promo`-layered: the row badges "promo · ends
{date}", and the list price stays stored so the two layers never collapse.
Reseller prices without a declared discount stay `list` — we do not guess
that a low price is a promotion.

**Acceptance**: 1) a DeepInfra offer with a declared discount shows the
promo badge + end date and retains the undiscounted list price; 2) no
declared discount → no promo claim; 3) promo start/end shows up as ordinary
price/offer events (dated, chartable later).

### US3 - "Where is it free / discounted" index pages (P3)
`/free`: every active free route — model, door, context, last-checked,
cheapest paid fallback with price. Honest framing: models with no free door
simply are not listed, and the page says a missing model has no production
free API. `/discounts`: every active promo-layered offer with its deadline.
Both pages carry the caveat block and the existing confirm-before-spend
disclaimer.

### Edge Cases
- $0 on a free route is a real price with real strings (rate limits,
  rotation) — never ranked against paid offers.
- Promo end dates in the past: the layer reverts to list at ingestion (the
  source's own dates decide, not ours).
- Free routes are excluded from cheapest-flip detection (a $0 rotating
  route "undercutting" everyone daily is noise, not a recommendation).
- No-train/ZDR and rate-limit-per-door data: not published machine-readably
  anywhere we ingest today — out of scope, backlog with the operator's
  buying-criterion note. Tokenizer/cache-parity caveat ships as copy.

## Requirements
- FR-001: `:free` routes ingest as offers with tier `free`; batch routes
  stay excluded; paid comparisons keep ignoring non-standard tiers.
- FR-002: offers carry a price layer (`list`|`promo`|`free`) and an
  optional promo deadline; promo only when the source declares it.
- FR-003: model pages show the free strip (with caveats) and promo badges.
- FR-004: `/free` and `/discounts` index pages, statically cached like
  every data-backed page, linked from the site nav.
- FR-005: all route changes surface through the existing monitoring
  events; free routes never enter cheapest-flip.

## Success Criteria
- SC-001: a model with a :free door shows it within one run of OpenRouter
  listing it; the paid ranking is unchanged.
- SC-002: DeepInfra's currently-declared discounts appear on /discounts
  with dates, list prices intact underneath.
- SC-003: /free renders only currently-active free routes; a route that
  left the roster disappears within one run and leaves a dated event.

## Assumptions
- OpenRouter catalogue prices are street prices by nature; without a
  declared discount they are layer `list` for that seller (reseller-ness is
  already labelled via provider type + provenance). Promo detection beyond
  declared fields (e.g. diffing OpenRouter's discounted collection page) is
  a follow-up.
- Search-intent copy ("no production free Claude API") lives on /free as
  static copy for now; per-model empty states come with the canonical
  pages of Phase H proper.

## Amendment (2026-08-28, during implementation)
- DeepInfra's payload declares `discount` (multiplier) and
  `discount_ends_at` but a single price set — so promo rows badge the
  declared discount (and date when present) without fabricating an
  undiscounted list figure; the declared fields live in raw provenance.
- Judge model set to `deepseek/deepseek-v4-flash-0731` (operator).
