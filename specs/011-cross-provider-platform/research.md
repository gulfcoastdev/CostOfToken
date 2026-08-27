# Research: Cross-Provider Platform

## D1 — Offers: new table vs existing `models`
**Decision**: `models` rows ARE offers; add `canonical_model_id` + qualifier
columns above them.
**Rationale**: a `models` row is already (provider × model id × price row ×
history) — the offer shape exactly. Reuse preserves price_history keys,
`/api/v1`, pipeline, anomaly/arbiter untouched; migration is additive DDL +
backfill instead of a rewrite.
**Alternatives**: separate `offers` table (rejected: duplicates every
pipeline write path, breaks history keys, months of migration risk for zero
user value).

## D2 — Resolver: code rules + explicit alias data, refuse to guess
**Decision**: deterministic normalization rules (strip `vendor/` prefixes,
`:free`/`:extended` router suffixes, cloud decorations like `us.` and `:0`),
plus a reviewed alias map in `data/aliases.ts`; no confident match → offer
unlinked + flagged.
**Rationale**: mirrors the proven classifier design ("rules refuse to
guess"); auditable (constitution IV); SC-003 tolerates unresolved offers but
not wrong merges — a wrong merge poisons comparisons, the product's core.
**Alternatives**: LLM-based matching (rejected for v1: identity must be
reproducible; can assist *review* later, like the arbiter), fuzzy string
similarity (rejected: 'llama-3.1-70b' vs 'llama-3.3-70b' differ by one char
and must never merge).

## D3 — Canonical slug
**Decision**: kebab family-version-size slug derived once at creation
(e.g. `deepseek-v4-pro`, `llama-3.3-70b`), unique, then immutable —
constitution VI (public identifiers live forever).

## D4 — First router adapter: OpenRouter
**Decision**: promote OpenRouter to a provider (type `router`) reusing the
existing cached catalogue fetch; every listing becomes an offer.
**Rationale**: one adapter instantly makes dozens of models multi-seller,
exercising resolver, comparison, and cheapest-flip end to end with zero new
network sources. It also retires the attribution debt of deepseek/moonshot
"vendor" prices actually coming from OpenRouter.
**Bound**: OpenRouter lists ~300 models; all are ingested (coverage is the
product), model_type classification applies as everywhere.

## D5 — Monitoring events
**Decision**: detect in-pipeline per provider run (offers diff + cheapest
before/after per touched canonical), persist to `monitoring_events`.
**Rationale**: the run already holds baseline + new state; recomputing
cheapest for only touched canonicals is O(changed models). Events are the
alert engine's queue and the future feed's source — durable, run-scoped,
idempotent per (run_id, kind, model_id).

## D6 — Watchlists v1
**Decision**: email + canonical model, unsubscribe via hashed token link;
no accounts. Alert sends reuse the Resend path. Premium/accounts out of
scope (spec assumption).

## D7 — Cloud adapters (Azure/Bedrock/Vertex)
**Decision**: last in the adapter series; launch as curated `catalog`
sources with region qualifiers where no stable machine-readable source
exists; per-region offers, never averaged. Marked openly in provenance.
