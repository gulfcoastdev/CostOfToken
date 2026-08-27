# Implementation Plan: Cross-Provider Price Comparison Platform

**Branch**: `011-cross-provider-platform` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)

## Summary

The pivotal insight that keeps this tractable: **the existing `models` table
already is the offer table.** A row is one provider selling one model with
one price row and its own history — exactly the offer shape. So the platform
is built by *adding identity above* (canonical models + resolver) rather
than rewriting storage: existing data, price history, `/api/v1`, the
pipeline, anomaly detection, and the arbiter all survive unchanged. New
tables: `canonical_models`, `monitoring_events`, `watchlist_subscriptions`;
new columns on `models` (canonical link + offer qualifiers) and `providers`
(provider type). Everything ships in the mandated order as phases A–H.

## Technical Context

**Language/Version**: TypeScript 5.7, Node 24, Next.js 15 App Router,
postgres.js against Supabase Postgres. No new runtime dependencies.

**Storage**: additive, idempotent DDL in `db/schema.sql` (project
convention). Local first (`npm run db:push`), prod manually
(`npm run db:push -- --remote`) BEFORE deploying reading code — the
project's standing migration rule.

**Testing**: `node --test` via tsx; resolver and comparison are pure logic
(unit), monitoring/watchlists are DB-backed suites that skip without
`DATABASE_URL`.

**Existing assets reused**: extractor framework + 11 working sources;
OpenRouter's full-catalogue fetch (`openrouter.ts` already downloads every
OpenRouter listing and caches it per run) becomes the first router
*provider*; anomaly detection, LLM arbiter, alert sender, classification
review pattern (rules refuse to guess → flag → review script).

## Phases (mandated build order)

**A — Normalized data model** (this is the foundation; everything else reads it)
- `providers.provider_type`: `vendor | cloud | router` (existing rows: vendor).
- `canonical_models`: id, slug (stable, public), display_name, family,
  model_type; RLS enabled.
- `models` (≡ offers) gains: `canonical_model_id` (nullable FK),
  `resolution_source` (`rule | manual`) + `resolution_note`, and offer
  qualifiers `offer_tier` (default `'standard'`) and `offer_region`
  (nullable). Nullable-by-default = existing rows valid before backfill.
- `monitoring_events`: run_id, kind (`price_change | offer_added |
  offer_removed | cheapest_flip`), canonical_model_id, model_id, details
  jsonb, recorded_at; RLS.
- `watchlist_subscriptions`: email, canonical_model_id, unsubscribe token
  (hashed), created_at, unique(email, canonical_model_id); RLS.
- price_history untouched — it is already per-offer.

**B — Model identity resolver**
- `src/pipeline/resolve.ts`: pure rules — normalize provider ids (strip
  `vendor/` prefixes, cloud id decorations, router suffixes like `:free`),
  derive canonical slug candidates; an explicit alias table in
  `data/aliases.ts` for names rules can't derive. Refuse-to-guess: no
  confident match → offer stays unlinked + flagged (classifier precedent).
- Pipeline step after classification: ensure canonical rows, link offers.
- Backfill: on first run every existing model becomes/links a canonical
  model (single-offer canonicals are the degenerate case and cost nothing).

**C — Provider adapters (one by one)**
- C1: OpenRouter as a real router provider — the existing catalogue fetch
  ingests every OpenRouter listing as offers (instant multi-seller data for
  DeepSeek/Llama/etc.). C2+: Together, Fireworks, Groq, DeepInfra,
  Cerebras, Mistral, Cohere (public pricing pages/APIs, one adapter each,
  same Extractor interface). C9+: Azure, Bedrock, Vertex (curated `catalog`
  source where no stable machine source; regions as offer qualifiers).
- The deepseek/moonshot-via-OpenRouter attribution debt is retired when C1
  lands (their listings become OpenRouter offers; vendor adapters move to
  first-party sources in C2+).

**D — Comparison engine**: `src/lib/offers.ts` — per canonical model:
offers with prices, cheapest standard-tier offer (workload-cost ranking
reuses `src/lib/cost.ts`), savings vs vendor-direct. Pure + query layer.

**E — Price-monitoring engine**: in the pipeline after upsert — diff
offers per canonical model against pre-run state; write monitoring_events
(price_change from existing pricesChanged detection; offer_added/removed;
cheapest_flip by comparing cheapest-before vs cheapest-after).

**F — Alert engine**: subscriptions → on monitoring events for followed
canonicals send price-drop / provider-switch mail (reuse Resend sender);
weekly digest via existing cron; signed unsubscribe route.

**G — Public API**: `/api/v1` untouched; add `canonical` + `offers`
fields additively where cheap; new `/api/v1/models/{canonical}/offers`,
`/comparisons`, `/events` endpoints following the existing envelope,
attribution, and rate-limit conventions.

**H — Web app (last)**: model pages become canonical pages with offer
tables and cheapest callout; calculator ranks offers; watch/follow UI;
charts per offer.

## Constitution Check

PASS across principles: additive idempotent schema (ops constraint);
truthfulness per offer (I); test-first per phase (II); pure logic unit
tested, DB behaviour DB-tested (III); refuse-to-guess resolver documented
(IV); no new dependencies (V); `/api/v1` backward compatible, canonical
slugs stable-for-life (VI); RLS on all new tables, watchlist emails never
in client payloads, unsubscribe tokens hashed (VII). The `models`-is-offers
decision avoids a rewrite and preserves history — simplest correct thing.

## Project Structure

```text
db/schema.sql                 # +canonical_models, monitoring_events, watchlist_subscriptions, new columns
src/pipeline/resolve.ts       # NEW resolver (rules + ensure/link step)
data/aliases.ts               # NEW explicit alias map (reviewed, like overrides.ts)
src/pipeline/extractors/openrouter-provider.ts  # NEW C1 router adapter
src/pipeline/monitor.ts       # NEW event detection (phase E)
src/lib/offers.ts             # NEW comparison queries (phase D)
src/pipeline/run.ts           # wire resolve + monitor steps
tests/resolve.test.ts, tests/offers.test.ts, tests/monitor.test.ts
```

## Delivery note

Phases are shippable independently; A–B must deploy (with the manual prod
migration) before C's offers can link. This implementation pass targets
A → E; F–H follow as their own task groups.
