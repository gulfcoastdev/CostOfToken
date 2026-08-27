# Implementation Plan: Cross-Provider Offer Comparison UI

**Branch**: `013-offer-comparison-ui` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

## Summary
One query, one server component, one section on the existing model page.
No schema changes, no new routes, no new dependencies.

## Design
- **Query** (`src/lib/queries.ts`): `getModelOffers(providerSlug, modelId)`
  → `{ canonicalSlug, displayName, offers: Offer[] } | null`, keyed off the
  viewed model's canonical link; wrapped in `cachedRead` with tag `offers`
  (FR-004; the pattern every read on the page already uses). Null when the
  model is unlinked or has < 2 active offers (FR-003 decided at the query
  so the page does zero work).
- **Ranking**: reuse `rankOffers` + `HEADLINE_WORKLOAD` (FR-002 — one
  formula; the tie-break fix from 011 applies here for free).
- **Component** (`src/components/offer-comparison.tsx`): server component
  table — provider (linked to its page for the model), type badge
  (vendor/cloud/router), input/cached/output, headline workload cost,
  savings vs vendor; cheapest row highlighted; unpriced offers after the
  ranked ones with em-dash gaps; provenance line for api/llm/catalog rows
  (reuse existing source-kind copy). "You are viewing" marker on the
  current provider's row.
- **Page wiring**: new section in
  `src/app/models/[provider]/[model]/page.tsx` after the pricing section.
- **Formatting**: existing helpers in `src/lib/format.ts` only.

## Testing (constitution III — the layer where the fault lives)
- DB-backed test (skips without DATABASE_URL): `getModelOffers` returns
  all offers for a multi-seller canonical, null for single-offer and
  unlinked models, and only active offers.
- Ranking/tie-break/missing-price behaviour already covered by
  tests/offers.test.ts (FR-002 reuses it verbatim).
- Component render: covered indirectly via typecheck + the existing
  build gate (`next build` fails on invalid RSC); no DOM test harness
  exists in this repo and adding one is out of scope.

## Constitution Check
PASS — reuse over reimplementation (V: rankOffers, cachedRead, format
helpers), truthful gaps (I: unknown ≠ zero ≠ hidden), cached reads (ops),
no public API change (VI), no new external input surfaces (VII).
