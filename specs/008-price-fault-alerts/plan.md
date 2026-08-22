# Implementation Plan: Price Fault Alerts

**Branch**: `008-price-fault-alerts` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-price-fault-alerts/spec.md`

## Summary

Two faults reached readers this fortnight and neither was noticed. Both had the same shape — a price recorded, then re-recorded differently a few hours later — and the existing plausibility checks have no eye for it. Separately, when those checks *do* fire they block correctly and then tell nobody.

This adds one check and one notifier, both small, both extensions of what exists.

The check: teach the baseline *when* each model's price last moved, then refuse a run in which an implausible share of a provider's recently-changed models are changing again. The notifier: from the cron route, which already holds the run summary, send one email per run when something was blocked or failed.

No schema change. No new npm dependency. No stored alert state. No `data-model.md`
either: nothing persists, and the only shapes that move are two field additions
described in research R4 and R5 — writing a document to say so would be ceremony.

**One finding changed the design.** A share-based check catches the first incident
(99% of a provider's models flapping) but *cannot* catch the second, which was a
single model — 7% of its provider, far below any threshold deepseek's normal churn
allows. The separating signal is not magnitude but **exactness**: of 23 legitimate
rapid re-changes measured over 14 days, the ratios are untidy (0.9975, 0.8625,
1.3034 …) and exactly one lands on a clean commercial multiple — the incident
itself, 0.440 → 0.220. So the check has two triggers, not one. See research R2–R4.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 24, ES modules, `.ts` import specifiers

**Primary Dependencies**: Next.js (App Router, Node runtime), `postgres.js`. **No new runtime dependency.** Email goes out via `fetch` to the provider's HTTP API — Principle V requires a new dependency be justified against the simplest correct alternative, and one `fetch` call is that alternative. `RESEND_API_KEY` and `ALERT_EMAIL_TO` are configuration, not dependencies.

**Storage**: PostgreSQL. `db/schema.sql` **unchanged** — the check reads `price_history.recorded_at`, which already exists and is already indexed by `price_history_model_time_idx (model_id, recorded_at)`. Alerts are derived from the run summary and never stored.

**Testing**: `node --test` via `tsx`. The new check is pure comparison logic and needs no database. The alert body builder is pure. The send path is asserted by configuration, not by sending.

**Target Platform**: Vercel (Node runtime), daily cron

**Performance Goals**: The baseline query gains a join against `price_history` for one provider's models. Covered by the existing composite index. The run must stay inside the free-tier duration ceiling — it currently takes ~30s against prod, so there is ample headroom.

**Constraints**: A send failure must never change a run's outcome. The email must never carry a secret, connection string or database host. Thresholds must not refuse the six reseller-backed providers, whose churn is 3–5× first-party.

**Scale/Scope**: 11 providers, 222 active models, ~1 run/day.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design.*

| Principle | Verdict | Evidence |
|---|---|---|
| **I. Truthful Data Over Available Data** (non-negotiable) | **Reinforcing** | The whole feature is Principle I's "Bulk plausibility MUST be checked before writing, not only per row." FR-005 keeps the existing contract: a refused run writes nothing and the provider keeps last known-good prices. Nothing here invents or infers a value. |
| **II. Test-First** (non-negotiable) | **Binding on task order** | The new check is a bug fix in the sense that matters — it exists because two specific incidents got through. Both must be encoded as failing tests, reproducing the real shapes, before the check is written. |
| **III. Test the Layer Where the Fault Lives** | **Pass, with one sanctioned exception** | The check is pure and unit-tested directly. The alert body builder is pure and unit-tested directly. The *send* cannot be observed without either mocking `fetch` or emailing someone from CI, so its wiring is asserted as configuration — which the constitution explicitly sanctions, provided the test says why in a comment. |
| **IV. Decisions Documented Where They Live** | **Pass, load-bearing** | Every threshold here is a judgement about a specific provider's real churn. Each constant must carry the number it was chosen against, or it will be "simplified" into uselessness. |
| **V. Simplicity and Earned Dependencies** | **Pass** | No new dependency; `fetch` is built in. No stored alert state, no dedup table, no dashboard. The check reuses the existing `Anomaly` shape and the existing block/force machinery rather than introducing a parallel path. |
| **VI. Public Surfaces Are Contracts** | **Pass** | No `/api/v1` change. The cron route's existing status contract (502 all-failed, 409 blocked, 200 ok) is unchanged — notification is a side effect, not a new status. |
| **VII. Untrusted Input Is Inert; Production Is Guarded** | **Pass, and directly engaged** | The email body is an outbound surface built from vendor-scraped model names and captions. It must be length-capped and escaped for its destination, exactly as the feed already does for the same data. FR-015 forbids secrets in the body; the recipient and key come from env and are never echoed. |

**Gate result: PASS.** No violations to justify; Complexity Tracking removed.

### Post-Phase-1 re-check

Still passing. Three decisions were made specifically to keep it that way:

1. **The check reads `lastChangedAt` from the baseline, not from a fresh query inside the detector.** `detectAnomalies` is pure and provider-agnostic today, and that is what makes it testable without a database (Principle III). Passing the timestamp in as data preserves that; querying inside it would not.
2. **Notification is fired from the cron route, not from `runPipeline`.** The pipeline is used by the CLI too, and the CLI must not email. Keeping the notifier at the route boundary means the "who notifies" question has one answer, and the CLI's silence is by construction rather than by flag.
3. **The alert body builder is separate from the sender.** The body is pure and fully testable; the sender is a `fetch` wrapper with nothing worth testing. Splitting them is what lets FR-013/FR-014/FR-015 be asserted at all.

## Project Structure

### Documentation (this feature)

```text
specs/008-price-fault-alerts/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — thresholds derived from 14 days of real churn
├── quickstart.md        # Phase 1 — validation scenarios
└── checklists/
    └── requirements.md  # Spec quality checklist (passing)
```

### Source Code (repository root)

```text
src/
├── pipeline/
│   ├── anomaly.ts            # + `unsettled_price` code and its check
│   ├── upsert.ts             # baseline query gains lastChangedAt
│   └── run.ts                # unchanged — already carries anomalies per provider
├── lib/
│   └── alert.ts              # NEW — pure body builder + fetch sender, no-ops unconfigured
└── app/api/cron/
    └── update-prices/route.ts  # calls the notifier after the run, best-effort

tests/
├── anomaly.test.ts           # + the two incident shapes, + the negative cases
└── alert.test.ts             # NEW — body content, redaction, when-to-send
```

**Structure Decision**: Existing single-project layout, unchanged. The work lands in three files that already exist plus one new library module. `src/lib/alert.ts` rather than `src/pipeline/` because it describes a run rather than participating in one, and because the cron route — not the pipeline — is its only caller.

### Sequencing

1. **Notification** (User Story 1, P1) — delivers value against the checks that *already* exist, independent of any new detection. Ship first.
2. **The unsettled-price check** (User Story 2, P1) — the new detection. Independent of 1, but only visible once 1 exists.

Neither blocks the other. Each carries its own failing-test-first pairing.

## Risks

| Risk | Mitigation |
|---|---|
| The threshold refuses a busy reseller-backed provider on every run, and the alert gets ignored. | The single largest risk, and SC-004 makes it a first-class criterion. Phase 0 derives thresholds from 14 days of real per-provider churn rather than from intuition; quickstart replays real history against the check before it ships. |
| Vendor-supplied model names reach an outbound email unescaped. | The feed already solves this for the same data; reuse its escaping and length caps rather than writing new ones (Principle V, one formula per concept). |
| A send failure fails the run. | FR-017. The route already wraps housekeeping and revalidation in `.catch(() => {})` for exactly this reason; the notifier follows that established pattern and logs. |
| The email is huge when everything blocks at once. | FR-018 — cap the examples and state what was omitted. Silent truncation would read as "that was all of it". |
| Adding a join to the baseline query slows the run. | Covered by the existing `(model_id, recorded_at)` index; one provider's models per call. Verify in quickstart against prod-sized data. |
| `RESEND_API_KEY` leaks into a log or the email body. | The sender never echoes config; the body builder is pure and has no access to it. Asserted directly in `tests/alert.test.ts`. |
