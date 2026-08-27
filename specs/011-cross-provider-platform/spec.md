# Feature Specification: Cross-Provider Price Comparison Platform

**Feature Branch**: `011-cross-provider-platform`

**Created**: 2026-08-27

**Status**: Draft

**Input**: User description: "CostOfToken becomes a price comparison and monitoring platform for AI models: compare the same model across direct APIs, cloud platforms, and AI routers; estimate workload costs; follow favorite models; get alerts when prices fall or another provider becomes cheaper. 15 initial providers. Components: provider adapters, model identity resolver, normalized data model (models, providers, offers, price history, watchlists), comparison engine, price-monitoring engine, alert engine, public API, web app. Existing code may be deleted/refactored. Build order: data model first, then backend components one by one, UI last."

## Background

Today CostOfToken tracks one price per (provider, model) — every model belongs
to exactly one seller. The market doesn't work that way: Llama, DeepSeek,
GPT-OSS and even Claude and GPT are sold simultaneously by their vendor, by
cloud platforms (Bedrock, Vertex, Azure), and by inference hosts and routers
(OpenRouter, Together, Fireworks, DeepInfra, Groq, Cerebras) — at prices that
differ by multiples. The unit of value shifts from "what does model X cost"
to "**who sells model X cheapest right now, and tell me when that answer
changes**." That second half — actionable savings, not price display — is the
product's competitive advantage.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One model, every seller (Priority: P1)

A visitor opens a model's page (e.g. DeepSeek V4) and sees every provider
selling it — vendor API, clouds, routers — as comparable offers: input/output
price per 1M tokens, provider type, tier/region qualifiers, with the cheapest
equivalent offer called out. Distinct versions and tiers are never blended
into one row.

**Why this priority**: The normalized offers model is the foundation every
other component (comparison, monitoring, alerts, API, UI) reads from. The
operator mandated data model first.

**Independent Test**: Ingest two providers selling the same model; the
catalogue shows one canonical model with two offers, correctly matched, and a
cheapest-offer determination.

**Acceptance Scenarios**:

1. **Given** DeepSeek V4 sold by DeepSeek's API and by a router, **When**
   both are ingested, **Then** one canonical model exists with two offers,
   each retaining its own provider, prices, and price history.
2. **Given** two different versions (e.g. Llama 3.1 vs Llama 3.3), **When**
   ingested from any providers, **Then** they remain separate canonical
   models — never merged.
3. **Given** an offer with a tier or region qualifier (e.g. Bedrock
   us-east-1, a router's "turbo" variant), **When** displayed or compared,
   **Then** the qualifier stays visible on the offer; qualified offers are
   never silently averaged with unqualified ones.
4. **Given** a model only one provider sells, **When** viewed, **Then** it
   behaves exactly like today's single-provider listing.

---

### User Story 2 - Prices collected from 15 providers (Priority: P2)

The daily collection run gathers models and prices from: OpenAI, Anthropic,
Google (AI Studio + Vertex), Microsoft Azure AI, AWS Bedrock, xAI,
OpenRouter, Together AI, Fireworks AI, DeepInfra, Groq, Cerebras, Mistral
AI, Cohere, DeepSeek — each as an independent adapter that can fail alone.

**Why this priority**: Comparison is only as good as coverage; adapters are
the first backend component after the data model.

**Independent Test**: Each adapter runs standalone against its source and
yields normalized offers; a failing adapter leaves its provider's last
known-good offers untouched.

**Acceptance Scenarios**:

1. **Given** a new provider adapter, **When** its source is reachable,
   **Then** its offers land in the normalized model attributed to it, with
   provenance (source URL/kind) preserved.
2. **Given** one adapter fails, **When** the run completes, **Then** all
   other providers updated and the failure is reported (existing isolation
   semantics).
3. **Given** a provider selling under multiple tiers/regions, **Then**
   each is a distinct offer, subject to the standard-tier headline rule for
   comparisons.

---

### User Story 3 - Identity resolution across providers (Priority: P3)

The same underlying model is recognized across sellers despite different
naming (`deepseek-chat` vs `deepseek/deepseek-v4-pro` vs
`us.deepseek.v4:0`), while different versions, sizes, distillations, and
quantizations stay separate.

**Independent Test**: A fixture of known aliases resolves to the expected
canonical models; ambiguous names are flagged for review rather than
guessed (matching the classifier's refuse-to-guess precedent).

**Acceptance Scenarios**:

1. **Given** provider-specific ids for one model, **Then** all resolve to a
   single canonical model via recorded alias rules.
2. **Given** a name the rules cannot confidently match, **Then** the offer
   is catalogued unmatched and flagged for review — never force-merged.
3. **Given** a resolver correction (split or merge), **Then** offers and
   their histories move with their canonical model without data loss.

---

### User Story 4 - Cheapest equivalent offer + workload cost (Priority: P4)

A user enters their workload (input/output tokens, requests per day or
month) and sees, per model, what each provider would charge and which is
cheapest; model pages show "cheapest offer" and by how much it beats the
vendor's direct price.

**Acceptance Scenarios**:

1. **Given** a workload and a canonical model, **Then** every offer is
   priced for that workload and ranked, standard tier only.
2. **Given** offers with missing fields (no cached price, no output price),
   **Then** they rank only on what they publish — a missing number is never
   treated as zero.

---

### User Story 5 - Price monitoring: changes, new offers, cheapest-flips (Priority: P5)

Every run detects, per canonical model: price changes (existing behaviour,
now per offer), new/removed offers, and **cheapest-provider changes** ("Groq
undercut Together for Llama 3.3 70B").

**Acceptance Scenarios**:

1. **Given** an offer's price drops below the current cheapest, **Then** a
   cheapest-flip event is recorded with before/after providers and prices.
2. **Given** a new provider starts selling a tracked model, **Then** a
   new-offer event is recorded.
3. **Given** no material change, **Then** no events (no daily noise).

---

### User Story 6 - Watchlists and alerts (Priority: P6)

A user follows models and receives alerts: price drop on a followed model,
provider-switch recommendation (cheapest changed), and a weekly summary.

**Acceptance Scenarios**:

1. **Given** a followed model whose cheapest offer changes, **Then** the
   user is notified with old/new provider, prices, and savings.
2. **Given** an unfollowed model changes, **Then** that user is not
   notified.
3. **Given** a user unsubscribes, **Then** no further alerts are sent.

---

### User Story 7 - Public API for offers and comparisons (Priority: P7)

API consumers read normalized models, offers, comparisons, price histories,
and cost estimates. The existing `/api/v1` contract keeps working unchanged;
offer-level data arrives as additive fields and/or new versioned endpoints.

---

### User Story 8 - Web application (Priority: P8, deliberately last)

Model search, provider comparison tables, price charts, workload
calculators, and watchlist management in the web app — rebuilt on the
offers model. Explicitly last per the operator's build order.

---

### Edge Cases

- A router reselling a vendor's own API (OpenRouter listing OpenAI) is a
  distinct offer with its own price — never deduplicated against the vendor.
- Router prices that fluctuate with routing (already observed with
  deepseek/moonshot via OpenRouter) stay offer-scoped; their noise must not
  pollute the canonical model's identity or other offers' histories.
- Cloud offers priced per region: regions are offer qualifiers; comparisons
  use a designated default/cheapest region, stated, not averaged.
- Free-tier or $0 offers: zero is a real price, distinct from unknown.
- A provider delisting a model deactivates its offer; the canonical model
  survives while any offer remains, and history survives regardless.
- Currency: all comparisons in USD per 1M tokens; non-USD sources convert
  at ingestion with the rate recorded (existing zhipu precedent).
- Existing price history predates offers; it must remain reachable as the
  history of the vendor-direct offer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (data model)**: The system MUST represent providers, canonical
  models, offers (provider × canonical model × tier/region qualifier, with
  the full price shape and provenance), per-offer price history, monitoring
  events, and watchlists. Existing per-provider models and their histories
  MUST migrate losslessly into offers.
- **FR-002 (identity)**: Offers MUST link to canonical models through
  recorded, auditable alias resolution; unresolvable names are catalogued
  unlinked and flagged, never guessed. Versions/sizes/quantizations are
  distinct canonical models.
- **FR-003 (adapters)**: Each of the 15 launch providers MUST have an
  independent adapter yielding normalized offers with provenance; adapter
  failure isolation, empty-result-is-failure, anomaly gating, and the LLM
  arbiter continue to apply per provider.
- **FR-004 (comparison)**: The system MUST compute, per canonical model,
  the cheapest equivalent standard-tier offer and per-offer workload costs;
  offers are compared only on fields they publish.
- **FR-005 (monitoring)**: Each run MUST record per-offer price changes,
  offer appearance/removal, and cheapest-provider flips as durable events.
- **FR-006 (alerts)**: Followed-model events MUST produce notifications
  (price drop, provider switch, weekly digest) with per-user opt-out;
  operator fault alerts (existing) remain separate.
- **FR-007 (API)**: `/api/v1` responses MUST remain backward compatible;
  offer-level data is additive or new-versioned. Attribution/licensing
  behaviour carries over.
- **FR-008 (build order)**: Delivery MUST follow: data model → adapters →
  resolver → comparison → monitoring → alerts → API → UI.
- **FR-009 (truthfulness)**: All existing data-quality rules apply per
  offer: null ≠ 0, no invented values, failed adapter writes nothing,
  provenance travels with every price.

### Key Entities

- **Provider**: a seller (vendor API, cloud platform, router/host), typed.
- **Canonical model**: the identity users follow (family, version, size);
  owns offers, events, and watchlist entries.
- **Offer**: one provider's sale of one canonical model with qualifiers
  (tier, region, variant), the full price shape, provenance, active flag.
- **Price history**: append-only per offer (existing history preserved).
- **Monitoring event**: typed record (price_change, offer_added,
  offer_removed, cheapest_flip) per canonical model/offer per run.
- **Watchlist entry**: a user's subscription to a canonical model.

## Success Criteria *(mandatory)*

- **SC-001**: A model sold by ≥3 providers displays all its offers on one
  page with a correct cheapest-offer callout.
- **SC-002**: All 15 launch providers ingest on the daily run; any single
  failure affects only that provider.
- **SC-003**: ≥95% of launch-provider model listings resolve to canonical
  models automatically; 100% of the rest are flagged, none force-merged.
- **SC-004**: A cheapest-provider flip appears as an event in the same run
  that ingested the triggering price.
- **SC-005**: Existing `/api/v1` consumers see no breaking change; existing
  price history remains fully queryable.
- **SC-006**: A followed model's price drop reaches the follower within one
  run cycle of detection.

## Assumptions

- **Phasing**: one spec, delivered as phases in the mandated order; each
  phase ships independently (data model migration first, UI last).
- **Watchlists v1** are email-address-based subscriptions with signed
  unsubscribe links — no full account system yet; accounts/premium arrive
  with revenue features (out of scope here).
- **Revenue features** (premium tiers, subscriptions, data resale,
  affiliates, sponsored placements) are out of scope for this build; the
  data model must simply not preclude them.
- **Azure AI, Bedrock, Vertex adapters** may launch with curated/manual
  price catalogues where no scrapeable/API source is stable, clearly marked
  `catalog` source-kind (existing convention) — truthfulness over coverage.
- **Router fluctuation**: router offers keep the existing arbiter/anomaly
  treatment; a router's price is real for that router.
- **Comparison basis** stays USD per 1M text tokens, standard tier
  (constitution's comparability rule), qualifiers stated.
