# Feature Specification: Price Fault Alerts

**Feature Branch**: `008-price-fault-alerts`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Detect bad price data before it is published, and email me when something looks wrong. Keep it as simple as possible — extend what already exists rather than building a new system."

## Context

Two faults reached readers in the last two weeks, and in both cases the system behaved as though nothing had happened.

1. A parser recorded the wrong pricing tier, so 73 of 74 models from one provider carried wrong prices for eleven days. One model sat in production at eight times its real rate.
2. A model was catalogued at one price and recorded at half that price nine hours later. That is not a vendor repricing twice in a day — it is an upstream source changing its number underneath us.

Bulk plausibility checking already exists and already does the right thing when it fires: it blocks the write and the provider keeps its last known-good prices. Two things are missing. It has no check for a price that will not settle, which is the shape *both* incidents took. And when it does fire, nothing tells a human — the finding is recorded and then sits there.

This feature adds the missing flag and the missing notification. It deliberately does not build a monitoring system, and deliberately does not add new ways to block: on the operator's instruction, price changes are reported for a human to judge rather than refused automatically. The existing blocking checks are left exactly as they are.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The operator finds out (Priority: P1)

The person responsible for the catalogue learns, without going looking, that a run found something worth a second look. The message tells them which provider, what tripped, and enough example prices to judge whether it was a real vendor change or a parser fault.

**Why this priority**: The detection that already exists is worth little while its findings are invisible. This story converts every existing check — and every future one — from a silent record into something acted upon. It delivers value even if no new check is ever added.

**Independent Test**: Build a message from a synthetic run outcome and assert its content and its send/no-send decision. Testable without adding any new detection.

**Acceptance Scenarios**:

1. **Given** a run in which one provider is blocked, **When** the run finishes, **Then** exactly one message is sent, naming that provider, the check that fired, and its explanation.
2. **Given** a run in which several providers are blocked or fail, **When** the run finishes, **Then** still exactly one message is sent, covering all of them.
3. **Given** a run in which nothing blocked, failed, or was flagged, **When** the run finishes, **Then** no message is sent.
4. **Given** a run whose only finding is a non-blocking flag, **When** the run finishes, **Then** a message is still sent — the operator asked to be told.
5. **Given** notification is not configured, **When** any run finishes, **Then** the run completes normally and sends nothing.
6. **Given** a message is sent, **When** it is read, **Then** it contains no credential, connection string, or database host.

---

### User Story 2 - A price that will not settle is reported (Priority: P1)

A model whose price moved very recently and is moving again gets flagged and reported. It is not refused: price changes are ordinary, and deciding which are wrong is the operator's job, not the system's.

**Why this priority**: This is the shape both incidents took, and no existing check sees it. Equal to Story 1 because detection without notification is invisible, and notification without this check would not have caught either incident.

**Independent Test**: Present a run in which a model changes again shortly after its previous change, and confirm it is flagged, reported, and still written.

**Acceptance Scenarios**:

1. **Given** a model that changed again shortly after its previous change, **When** the run is checked, **Then** it is flagged as a warning and appears in that run's message.
2. **Given** any such flag, **When** the run completes, **Then** the prices are still written — flagging never blocks.
3. **Given** a provider with no recorded prior change, **When** its prices change, **Then** nothing is flagged.
4. **Given** a run in which several models are flagged, **When** the message is sent, **Then** each appears with its before and after price and how long apart the two changes were.
5. **Given** an existing blocking check fires in the same run, **When** the run completes, **Then** it still blocks exactly as it does today.

---

### Edge Cases

- Sending the message fails — the network is down, or the provider rejects it. The run's own outcome must not change, and the failure must be visible somewhere.
- The run fails so badly that no per-provider outcome exists. The operator must still be told something happened.
- Every provider blocks at once, so the message would be enormous. It must stay readable and must not be truncated silently.
- The same model is flagged on consecutive runs. The operator should not be worn down by identical messages, but must not be left unaware either.
- A model appears in the incoming run but has no stored history, so "when did it last change" has no answer.
- A model's price returns to exactly what it was two runs ago — a flap that nets to zero.
- Notification is configured with an address that no longer exists.
- The scheduled run and a manual run happen close together.

## Requirements *(mandatory)*

### Functional Requirements

**Detection**

- **FR-001**: The system MUST flag, as a non-blocking warning, any model whose price changed again shortly after its previous change.
- **FR-002**: Flagging MUST NOT block the write. Price changes are ordinary; the operator decides what is wrong, not the system. *(Revised 2026-08-22 on the operator's instruction: "model changes happen. Just monitor them and let me know.")*
- **FR-003**: The system MUST NOT flag where a provider has no recorded prior change to compare against — a first change is not suspicious.
- **FR-004**: The system MUST know, per model, when its price last actually moved, in order to make that judgement.
- **FR-005**: The existing blocking checks MUST keep their current behaviour exactly, including writing nothing when they fire.
- **FR-006**: The existing operator override MUST continue to work unchanged.
- **FR-007**: Detection MUST remain shape-based and free of per-provider configuration, so a newly added provider inherits it.
- **FR-008**: Every existing check MUST continue to fire exactly as it does today.

**Notification**

- **FR-009**: The system MUST send exactly one message per run, never one per fault.
- **FR-010**: The system MUST send a message when any provider is refused, when any provider fails outright, or when the run as a whole fails.
- **FR-011**: The system MUST send a message when any non-blocking warning fired, including the new flag — the operator asked to be told, not protected from knowing.
- **FR-012**: The system MUST NOT send a message for a run in which nothing blocked, nothing failed, and nothing was flagged.
- **FR-013**: The message MUST identify each affected provider, the check that fired, and its explanation.
- **FR-014**: The message MUST include example models with their before and after prices, enough to judge whether the change was real.
- **FR-015**: The message MUST NOT contain credentials, connection strings, or the database host.
- **FR-016**: Notification MUST be configuration-driven and MUST do nothing when unconfigured, so a fresh clone and local runs send nothing.
- **FR-017**: A failure to send MUST NOT change the outcome of the run, and MUST itself be recorded where an operator can find it.
- **FR-018**: Where the number of findings would make the message unreadable, the message MUST say what it left out rather than truncating silently.

### Key Entities

- **Run outcome**: What happened to each provider in one collection run — succeeded, refused, or failed — together with the findings that led there. Already exists; this feature reads it.
- **Model price baseline**: A provider's currently-stored prices, used to judge an incoming run. Already exists; gains knowledge of *when* each price last moved.
- **Finding**: One detected fault or warning, with a code, a severity, an explanation, and supporting detail. Already exists; gains one code.
- **Alert**: The single message describing one run's refusals and failures. New, and deliberately derived entirely from the run outcome rather than stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator learns of a refused or failed run without checking logs or dashboards.
- **SC-002**: A price recorded at one value and re-recorded shortly afterwards is reported to the operator within one run.
- **SC-003**: Both past incidents would have been reported on the day they happened.
- **SC-004**: No run is blocked by the new flag — providers whose prices genuinely move often keep publishing normally.
- **SC-005**: One run produces at most one message.
- **SC-006**: A run in which nothing blocked, failed, or was flagged produces no message.
- **SC-007**: With notification unconfigured, runs behave exactly as they do today.
- **SC-008**: A message contains enough to decide "real vendor change or fault" without opening the database.
- **SC-009**: No message ever contains a secret or a database host.

## Assumptions

- **Churn varies enormously by provider, and thresholds must survive that.** 84 of 222 catalogued models come from a reseller rather than first-party sources, and those providers change price 3–5× as often as first-party ones — 72 changes in a fortnight for the busiest, against 15 and 7 for the quietest. A threshold tuned to a quiet provider would refuse the busy ones on every run, which would be worse than no check at all: an alert that always fires is an alert nobody reads.
- **"Recently" is measured in hours, not days.** Both incidents re-recorded a price within a day of the previous one. A window of roughly a day is assumed; the plan may refine it against real history.
- **Notification is sent from the scheduled run**, which already knows the outcome of every provider. See Out of Scope for manual runs.
- **The operator is a single person**, so one recipient is sufficient and no routing, escalation or on-call rota is needed.
- **A message not arriving is an acceptable failure mode** for this feature. Guaranteeing delivery, or noticing that a run never happened at all, is the separately-specified dead-man's switch.
- **Repeated identical alerts are tolerated for now.** Suppressing them needs stored state, which this feature deliberately avoids; if it becomes a nuisance it is a follow-up.

## Out of Scope

- **A dead-man's switch for the scheduled run never firing.** Already specified in `BACKLOG.md`. It is the complement to this work — this feature reports faults a run found, that one reports a run that never happened — and it cannot live in the same place, because a watcher inside the thing it watches shares its failure mode.
- **Notifying from manual command-line runs.** Those bypass the scheduled path entirely. A related gap was found while writing this: a command-line run also does not refresh the site's caches, so the published site can serve stale prices for up to half an hour after one. Both belong to the same follow-up and should be recorded rather than fixed here.
- **Extending the tier and unit classification to the remaining extractors.** The fault that caused the first incident is currently guarded for one provider only. Worth doing, and its own change.
- **Distinguishing reseller-sourced prices from first-party ones.** 84 models are currently indistinguishable from first-party in the data, which the constitution requires be caveated. Its own change.
- **Alert history, dashboards, acknowledgement or muting.** Deliberately no stored alert state.
