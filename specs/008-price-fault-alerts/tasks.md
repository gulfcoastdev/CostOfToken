---

description: "Task list for 008-price-fault-alerts"
---

# Tasks: Price Fault Alerts

**Input**: Design documents from `/specs/008-price-fault-alerts/`

**Status**: complete. Revised mid-implementation on the operator's instruction — the new check **warns, it does not block**. Task text below still says "refuse" in places; the shipped behaviour is flag-and-report. See spec FR-002.

**Tests**: REQUIRED, and required *first*. Both behaviours here exist because two specific incidents got through, so Principle II applies: each MUST begin with a test reproducing the real shape, observed failing for the right reason.

**Organization**: Two independent P1 stories. Neither blocks the other.

---

## Phase 1: Setup

- [X] T001 Record the gate baseline (`npm test`, `npm run typecheck`) so any regression is attributable.

---

## Phase 2: User Story 1 — The operator finds out (P1)

**Goal**: One email per run when something blocked or failed. Nothing otherwise. Nothing when unconfigured.

**Independent test**: Build an alert from a synthetic run summary and assert its content and its send/no-send decision. No network, no database.

### Tests first

- [X] T002 [TEST] [US1] Create `tests/alert.test.ts` asserting `shouldAlert` is true when any provider is blocked, true when any provider failed, true when the run as a whole failed, and false when the only findings are warnings. MUST fail: no such module. *(FR-009..FR-012)*
- [X] T003 [TEST] [P] [US1] In `tests/alert.test.ts`, assert the body names each affected provider, the anomaly code, its message, and includes example models with before/after prices. *(FR-013, FR-014)*
- [X] T004 [TEST] [P] [US1] In `tests/alert.test.ts`, assert the body contains no credential, connection string or database host — feed it a summary whose fields carry a fake key and a postgres URL and confirm neither appears. *(FR-015, SC-009)*
- [X] T005 [TEST] [P] [US1] In `tests/alert.test.ts`, assert a report with more findings than the cap states what it omitted rather than truncating silently. *(FR-018)*
- [X] T006 [TEST] [P] [US1] In `tests/alert.test.ts`, assert vendor-supplied model names are escaped and length-capped in the body, reusing the feed's helpers rather than new ones. *(Principle VII)*
- [X] T007 [TEST] [P] [US1] In `tests/alert.test.ts`, assert `sendAlert` no-ops and reports "not configured" when the env vars are absent. Configuration assertion — comment must say why the send itself is not observable. *(FR-016, SC-007)*

### Implementation

- [X] T008 [US1] Create `src/lib/alert.ts` with a pure `shouldAlert(summary)`, a pure `buildAlert(summary)` returning subject and body, and a `sendAlert(alert)` that POSTs via `fetch` and no-ops unconfigured. Reuse the feed's escaping/capping helpers. Comment the incident each rule exists for. Makes T002–T007 pass.
- [X] T009 [US1] Call the notifier from `src/app/api/cron/update-prices/route.ts` after `runPipeline`, wrapped so a send failure cannot change the run outcome — matching the existing `pruneRateLimitWindows` / `revalidateTag` pattern. Log the failure. *(FR-017)*
- [X] T010 [US1] Document `RESEND_API_KEY` and `ALERT_EMAIL_TO` in `.env.example` with a note that both absent means silence.

**Checkpoint**: Existing checks stop being invisible. SC-001, SC-005..SC-009 satisfied.

---

## Phase 3: User Story 2 — A price that will not settle is refused (P1)

**Goal**: Refuse a run where prices will not settle, by either trigger, without refusing normal churn.

**Independent test**: Feed baseline + incoming pairs reproducing both incidents and deepseek's worst legitimate run. Pure logic.

### Tests first

- [X] T011 [TEST] [US2] In `tests/anomaly.test.ts`, add trigger A: a provider where ≥50% of active models re-changed inside the window raises a blocking `unsettled_price`. Reproduce incident 1's shape (99% of models). MUST fail: no such code. *(FR-001, SC-003)*
- [X] T012 [TEST] [P] [US2] In `tests/anomaly.test.ts`, add trigger B: a **single** model re-changing inside the window by an exact tier ratio raises a blocking `unsettled_price`. Reproduce incident 2 exactly — 0.440 → 0.220 after 9h. MUST fail. *(FR-001, SC-002)*
- [X] T013 [TEST] [P] [US2] In `tests/anomaly.test.ts`, assert deepseek's worst *legitimate* run does not fire: 3 of 15 models re-changing, with untidy ratios (0.9975, 0.8625, 1.3034). This is the false-positive guard and matters more than the positives. *(FR-002, SC-004)*
- [X] T014 [TEST] [P] [US2] In `tests/anomaly.test.ts`, assert a provider with no recorded prior change does not fire — a first change is not a fault — and that a change at exactly the window boundary does not fire, since two legitimate changes were measured at exactly 24h. *(FR-003, research R4)*
- [X] T015 [TEST] [P] [US2] In `tests/anomaly.test.ts`, assert every existing anomaly test still passes unchanged. Regression guard. *(FR-008)*

### Implementation

- [X] T016 [US2] Add `lastChangedAt` to `BaselineModel` and to `getProviderBaseline` in `src/pipeline/upsert.ts`, reading the newest `price_history.recorded_at` per model. Uses the existing `(model_id, recorded_at)` index. *(FR-004)*
- [X] T017 [US2] Add the `unsettled_price` code and its two-trigger check to `src/pipeline/anomaly.ts`. Each constant MUST carry the measured number it was chosen against — 50% against a legitimate worst of 20%, the exact-ratio set against 23 real rapid re-changes of which one matched. Keep it shape-based and provider-agnostic. Makes T011–T014 pass. *(FR-001..FR-003, FR-007)*
- [X] T018 [US2] Confirm the block flows through the existing write-nothing path and that `force` still overrides. No new code expected — verify and note. *(FR-005, FR-006)*

**Checkpoint**: Both incident shapes refused. SC-002, SC-003, SC-004 satisfied.

---

## Phase 4: Polish

- [X] T019 Run the full gate: `npm test`, `npm run typecheck`, `npm run build`.
- [X] T020 [P] Work through `quickstart.md` S1–S6, including two consecutive local pipeline runs confirming the second records zero changes and raises nothing.
- [X] T021 [P] Add to `BACKLOG.md` the gap found during research: a CLI pipeline run neither notifies nor invalidates caches, which is why production served stale prices for 30 minutes after today's manual run.

---

## Dependencies

```text
T001 ──┬──> US1 (T002..T010)   [independent]
       └──> US2 (T011..T018)   [independent]
                    │
              Phase 4 (T019..T021)
```

- Within each story, every `[TEST]` task blocks its implementation task and must be observed failing first.
- The two stories touch disjoint files. US1: `src/lib/alert.ts`, the cron route. US2: `src/pipeline/anomaly.ts`, `src/pipeline/upsert.ts`.

## Implementation Strategy

**Ship US1 first.** It delivers value against the checks that already exist — today they block correctly and tell nobody. US2 is the new detection and is invisible without it.
