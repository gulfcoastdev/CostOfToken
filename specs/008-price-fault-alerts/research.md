# Phase 0 Research: Price Fault Alerts

**Feature**: 008-price-fault-alerts | **Date**: 2026-08-22

Every threshold below is derived from 14 days of real production history, not from intuition. The measurements are reproducible from `price_history`.

---

## R1. How often do prices legitimately move twice in a day?

**Measured**: across the whole catalogue over 14 days, **23** price changes landed within 24 hours of that model's previous change.

| provider | rapid re-changes | distinct models | of how many | worst single run |
|---|---|---|---|---|
| deepseek | 15 | 5 | 15 | 3 |
| minimax | 3 | 2 | 8 | 1 |
| moonshot | 3 | 1 | 9 | 1 |
| alibaba | 2 | 2 | 51 | 1 |
| everyone else | 0 | 0 | — | 0 |

**Decision**: rapid re-pricing is normal, and concentrated entirely in the reseller-backed providers. Any check that treats a single rapid re-change as a fault would fire on deepseek most weeks. The busiest legitimate run re-changed **3 models out of 15 — 20% of that provider's catalogue**.

**Threshold**: block when **50% or more** of a provider's active models re-change within the window. That is 2.5× the worst legitimate run observed, and the first incident sat at **99%** (73 of 74 models). The gap either side is wide enough that neither a busy provider nor a real fault sits near the line.

---

## R2. The share-based check does not catch the second incident, and cannot

**Finding, stated plainly**: incident 2 was **one model** — `deepseek-v4-flash-vision-exp`, $0.440 → $0.220 nine hours later. One model out of fifteen is 7%, far below any threshold that deepseek's normal behaviour permits. No share-based rule can separate it from that provider's ordinary churn.

This matters because the spec's Requirement 1, taken alone, would have caught incident 1 decisively and missed incident 2 entirely. Shipping only that check and calling both incidents covered would have been false.

---

## R3. What *does* separate the second incident from normal churn

**Decision**: the conjunction of *rapid re-change* **and** *an exact tier ratio*.

Listing all 23 rapid re-changes with their ratios makes the separation obvious. Genuine churn is untidy:

```
0.9975   0.9023   1.1111   0.8625   0.8361   0.9564   0.9935
1.3034   1.2381   0.7273   1.2000   0.6100   1.6393   0.8331  ...
```

Those are real repricings and float dust from a reseller quoting per-single-token decimals. Against that, exactly **one** of the 23 lands on a clean commercial multiple:

```
DeepSeek V4 Flash Vision Exp   0.440000 -> 0.220000   ratio=0.5000   after 9h
```

**That is the incident.** One hit in 14 days, and the hit is the fault.

**Precision on real history: 1 of 1.** No false positive exists in the measured window, so this may fire on a **single model** without the share requirement — which is exactly what is needed, since incident 2 was a single model.

**Alternatives considered**:

- *Lower the share threshold until incident 2 fires.* Rejected: it would have to drop below 7%, which fires on deepseek continuously. An alert that always fires is an alert nobody reads (SC-004).
- *Flag any rapid re-change of more than some percentage.* Rejected: incident 2 moved 50%, and so did a legitimate alibaba change (0.5275) and a legitimate moonshot one (0.6100). Magnitude alone does not separate them; **exactness** does.
- *Reuse `tier_shaped_shift` as it stands.* Rejected: it requires 3 suspicious ratios and 25% of changed models, so a single-model flap is invisible to it. Relaxing those would break its own false-positive guarantees for the case it was built for.

---

## R4. One check, two triggers

**Decision**: a single anomaly code, `unsettled_price`, with two firing conditions — both meaning "this price will not settle", both blocking.

| Trigger | Fires when | Catches | Worst legitimate observation |
|---|---|---|---|
| **A — mass** | ≥50% of a provider's active models re-changed inside the window | Incident 1 (99%) | 20% |
| **B — exact** | any model re-changed inside the window **by an exact tier ratio** | Incident 2 | 0 in 14 days |

One code rather than two keeps the reporting simple and the anomaly vocabulary small (Principle V). The `details` payload records which trigger fired, so an operator reading the email can tell them apart.

**Window**: 24 hours. Both incidents re-recorded inside that window (30 minutes and 9 hours). The daily cron means a legitimate change and its successor are normally ~24h apart, so the window is deliberately measured as *strictly less than* 24 hours to avoid catching consecutive daily runs. Note two legitimate changes measured at exactly 24h — the boundary is real and must be exclusive.

---

## R5. Where notification fires from

**Decision**: from the cron route, after `runPipeline` returns, best-effort.

**Rationale**: the route already holds the complete summary — per-provider status, anomalies, counts — and already treats a blocked provider as alert-worthy by returning 409. It also already wraps its side effects (`pruneRateLimitWindows`, `revalidateTag`) in catches so they cannot fail a good run; the notifier follows that established pattern rather than inventing one.

Putting it in `runPipeline` instead would email on every CLI run, including local development. Keeping it at the route boundary makes the CLI's silence structural rather than conditional.

**Consequence, recorded honestly**: a manual CLI run notifies nobody. It also does not invalidate caches — a gap found while writing this, and the reason production served stale prices for 30 minutes after today's manual run. Both belong to the same follow-up; neither is fixed here.

---

## R6. Sending email without a dependency

**Decision**: `fetch` to Resend's HTTP API, configured by `RESEND_API_KEY` and `ALERT_EMAIL_TO`. Absent either, the notifier does nothing and says so once in the log.

**Rationale**: Principle V requires a new dependency be justified against the simplest correct alternative. A single JSON POST is that alternative — the SDK would add a package to save perhaps ten lines. The Node runtime is already required for `postgres.js`, so `fetch` is available.

**Body safety**: the body is built from vendor-scraped model names and captions, which Principle VII treats as hostile. It reuses the escaping and length caps the feed already applies to the same data rather than growing a second set. The builder is a pure function with no access to configuration, which is what makes "no secrets in the body" assertable rather than merely intended.

**Alternatives considered**: a Slack webhook (fewer moving parts, but alerts scroll away and the operator asked for email); a GitHub issue (durable per-incident thread, but needs a token with write scope on the repo); SMTP (needs a real dependency).

---

## Open items carried into design

- Thresholds are derived from 14 days of history, of which OpenAI's contribution was purged today, so its baseline is one row per model. The measured legitimate maximum (20%, deepseek) comes from providers unaffected by that purge and is sound; re-check after a fortnight of clean runs.
- Trigger B has one observation supporting it. It is the right shape and cost nothing to add, but its false-positive rate is measured on a single fortnight. If it starts firing on genuine half-price promotions, the answer is to require two models rather than to widen the ratio set.
