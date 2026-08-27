# Feature Specification: Cross-Provider Offer Comparison UI

**Feature Branch**: `013-offer-comparison-ui`
**Created**: 2026-08-28
**Status**: Draft
**Input**: Operator: "More important is UI that should compare the cost of the model across different providers." (Phase H slice of spec 011, pulled ahead of Phase G by operator priority; Phase F deferred.)

## User Scenarios & Testing

### User Story 1 - See every seller of this model on its page (Priority: P1)
A visitor on a model's page sees a "Compare providers" section listing every
active offer of the same canonical model: seller name and kind (vendor /
cloud / router), input, cached-input and output prices, the cost at the
standard comparison workload, and how much each seller saves (or costs)
versus the vendor's direct price. The cheapest offer is visibly called out.
The row for the page's own provider is marked as the one being viewed.

**Acceptance Scenarios**:
1. **Given** a model with ≥2 offers, its page shows all of them ranked
   cheapest-first, with the cheapest highlighted and savings-vs-vendor
   shown where a vendor-direct offer exists.
2. **Given** a model with a single offer (unlinked or sole seller), the
   section does not render — no empty scaffolding.
3. **Given** an offer with a missing price, it is listed after the priced
   offers with its gaps shown as unknown — never treated as zero or hidden.
4. **Given** an offer with non-scrape provenance (reseller api, llm), the
   row carries the existing provenance disclosure.
5. **Given** any offer row, clicking its provider navigates to that
   seller's page for the model.

### Edge Cases
- Only standard-tier offers are compared (existing comparability rule);
  the section states the workload basis (1M input + 1M output tokens).
- Zero prices display as genuinely free, not missing.
- The section must not add a per-request DB read on cached pages (existing
  cached-read discipline).

## Requirements
- **FR-001**: Model pages MUST show all active offers of the model's
  canonical identity with prices, seller kind, workload cost, ranking, and
  cheapest callout, savings vs vendor-direct where applicable.
- **FR-002**: Ranking and tie-breaks MUST use the existing comparison
  engine (011 phase D) — one formula per concept.
- **FR-003**: The section MUST render only when there are ≥2 offers.
- **FR-004**: Reads go through the cached-read layer with its own tag.
- **FR-005**: Provenance and provider-type labelling MUST appear on rows
  whose source is not a first-party scrape.

## Success Criteria
- **SC-001**: A model sold by ≥3 providers shows all sellers on one page
  with the cheapest called out (spec 011 SC-001, now user-visible).
- **SC-002**: No additional database reads on warm cached page loads.
- **SC-003**: Single-offer models render byte-identically to today.

## Assumptions
- Lives on the existing /models/{provider}/{model} pages — no new route;
  a dedicated canonical-model route can come with Phase G/H proper.
- Chart/history-per-offer and calculator-over-offers are later H slices.

## Amendment (2026-08-29, operator-directed)
Home-page offer matrix ("main page should have a table that compares cost
of model per provider… few providers as columns and input/output for each…
few most popular models"): rows are the curated featured list (the honest
popularity proxy this repo already uses), columns fixed to First-party /
OpenRouter / Together AI / DeepInfra, cells input/output per 1M with the
cheapest displayed cell highlighted. Rows appear only when >= 2 of the
columns price the model. getOfferMatrix in queries.ts + OfferMatrix
component; standard tier only; free/promo routes linked via /free and
/discounts instead of crowding cells.
