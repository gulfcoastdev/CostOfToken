# Tasks: Cross-Provider Price Comparison Platform

**Input**: Design documents from `/specs/011-cross-provider-platform/`

**Tests**: REQUIRED — red before green per behavior.

**Organization**: phases follow the operator's mandated build order. Phases
A–E are this implementation pass; F–H are staged for follow-up passes.

## Phase A: Normalized data model (US1) 🎯 Foundation

- [X] T001 [US1] Add DDL to db/schema.sql per data-model.md
      (providers.provider_type, canonical_models, models offer/canonical
      columns, monitoring_events, watchlist_subscriptions, indexes, RLS).
      Idempotent; run `npm run db:push` against LOCAL.
- [X] T002 [US1] Extend src/lib/types.ts (ProviderType, canonical/offer
      fields on NormalizedModel as optional) and providers.ts registry with
      provider_type; ensureProviders writes it.

## Phase B: Identity resolver (US3)

- [X] T003 [US3] Failing tests tests/resolve.test.ts: id normalization
      (vendor/ prefixes, :free/:extended suffixes, cloud decorations
      us./:0), slug derivation, alias map hits, version separation
      (llama-3.1-70b ≠ llama-3.3-70b), refuse-to-guess → unresolved.
- [X] T004 [US3] Implement src/pipeline/resolve.ts + data/aliases.ts;
      green on T003.
- [X] T005 [US3] Failing DB test: resolveOffers pipeline step creates
      canonical rows, links offers, leaves unresolved flagged; backfill
      covers pre-existing rows. Implement the step in upsert/run wiring.

## Phase C: Adapters (US2) — one by one

- [X] T006 [US2] C1 OpenRouter as router provider: provider entry
      (type router) + extractor reusing the cached catalogue fetch; every
      listing an offer with openrouter's prices/provenance; tests with a
      catalogue fixture. Existing deepseek/moonshot vendor adapters keep
      working (attribution debt retired in C2+).
- [ ] T007 [US2] C2+ one task per remaining provider (Together, Fireworks,
      Groq, DeepInfra, Cerebras, Mistral, Cohere; then Azure/Bedrock/Vertex
      as curated catalog sources with regions) — EACH gets source research,
      fixture, failing test, adapter. Staged follow-up; not this pass.

## Phase D: Comparison engine (US4)

- [X] T008 [US4] Failing tests tests/offers.test.ts: cheapest standard-tier
      offer per canonical, workload ranking via existing cost helpers,
      missing-field offers rank only on published fields, single-offer
      degenerate case.
- [X] T009 [US4] Implement src/lib/offers.ts (pure logic + cached queries
      per project data-access rules); green.

## Phase E: Monitoring engine (US5)

- [X] T010 [US5] Failing tests tests/monitor.test.ts: detect offer_added /
      offer_removed / price_change / cheapest_flip from before/after offer
      state; no events when nothing material changed.
- [X] T011 [US5] Implement src/pipeline/monitor.ts + run.ts wiring (after
      upsert, per provider run, touched canonicals only) writing
      monitoring_events; DB test for persistence.
- [X] T012 Validation: quickstart.md steps 1–4 against LOCAL; typecheck;
      full suite; update BACKLOG.md with phase status.

## Phase F: Alert engine (US6) — follow-up pass

- [ ] T013 [US6] Subscription create/unsubscribe route (signed token,
      hashed at rest), event→notification fan-out reusing Resend sender,
      weekly digest cron. Tests first.

## Phase G: Public API (US7) — follow-up pass

- [ ] T014 [US7] Additive canonical/offers fields + new endpoints
      (offers, comparisons, events) with existing envelope/rate limits;
      contract tests proving /api/v1 unchanged.

## Phase H: Web app (US8) — follow-up pass, last by mandate

- [ ] T015 [US8] Canonical model pages with offer tables + cheapest
      callout, calculator over offers, watch UI, per-offer charts.

## Dependencies

A → B → C1 → D → E (this pass). F needs E; G needs D–E; H needs G.
Prod: schema push (`db:push -- --remote`) precedes any deploy of B+.
