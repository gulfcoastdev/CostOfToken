# Quickstart: Price Fault Alerts

**Feature**: 008-price-fault-alerts

## Prerequisites

```bash
docker ps --format '{{.Names}}' | grep -q cot-pg
```

Notification is unconfigured locally by design — `RESEND_API_KEY` and `ALERT_EMAIL_TO`
are absent from `.env.local`, so nothing is sent and S4 asserts exactly that.

## S1. Gates

```bash
npm test && npm run typecheck && npm run build
```

## S2. The check refuses both incident shapes — SC-003

```bash
npx tsx --test tests/anomaly.test.ts
```

Expected: a run where ≥50% of a provider's models re-change inside the window is
blocked (trigger A, incident 1 at 99%); a run where a single model re-changes by an
exact tier ratio is blocked (trigger B, incident 2 at 0.440 → 0.220 after 9h).

## S3. It does not refuse normal churn — SC-004

Expected, same suite: 3 of 15 models re-changing is **not** blocked — that is
deepseek's worst legitimate run, and the threshold sits 2.5× above it. Untidy
ratios (0.9975, 0.8625, 1.3034) are not blocked at any share. Every existing
anomaly test still passes.

## S4. Notification behaviour — SC-005, SC-006, SC-007, SC-009

```bash
npx tsx --test tests/alert.test.ts
```

Expected: one message per run regardless of how many providers blocked; no message
when only warnings fired; nothing sent when unconfigured; no credential, connection
string or database host anywhere in the body; the body carries example models with
before/after prices; an over-long report states what it omitted rather than
truncating silently.

## S5. Real history replay — SC-004

```bash
npm run pipeline:dry
```

Expected: no provider reports `unsettled_price`. Prices have not moved since the
last run, so nothing is re-changing. This is the sanity check that the thresholds
do not fire on a quiet day.

## S6. End to end against the local database

```bash
npm run pipeline:run    # first run: writes, confirms banner reads LOCAL
npm run pipeline:run    # second run: 0 price changes, no anomalies
```

Expected: the second run records zero changes and raises nothing. A CLI run sends
no email — that is by design (research R5), not a defect.

## Known limitation to verify, not fix

A manual CLI run neither notifies nor invalidates the site's caches. Production
served stale prices for 30 minutes after today's manual run for exactly this
reason. Recorded in `BACKLOG.md`; do not fix it here.
