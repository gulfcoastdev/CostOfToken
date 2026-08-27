# Feature Specification: LLM Source-Recovery Judge

**Feature Branch**: `012-llm-source-recovery`

**Created**: 2026-08-28

**Status**: Draft

**Input**: User description: "Add the LLM judge to the pipeline: identify and remember new structure of sites/API changes, create git issues or notify if structure needs to be reworked, and overall be smart enough to derive prices by itself. Use DeepSeek. Operator clarification: 'I prefer it over over-complicated regex, most likely a bit of both be needed. But the ultimate goal — it will be self-driving mode.'"

## Background

Today a broken parser means a stalled provider: prices freeze at last
known-good until a human diagnoses the page change and reworks the
extractor (the August OpenAI incident took two days of human latency; the
010 arbiter closed the *detection* gap but not the *repair* gap). The
operator's direction is a hybrid that trends toward self-driving: cheap
deterministic parsers remain the fast path on healthy days, and an LLM
takes over exactly when they break — reading the page, deriving the prices
itself, remembering what the source looks like now, and filing the rework
ticket a human (or a future automation) picks up. Each pipeline run should
degrade from "parsed" to "LLM-derived, provenance-marked" to "frozen at
last known-good", in that order, and say which happened.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prices survive a broken parser (Priority: P1)

A provider's page is restructured overnight and its parser fails. Instead
of freezing, the run hands the fetched page, the provider's remembered
structure, and its last known models/prices to the LLM judge (DeepSeek),
which derives current prices. High-confidence derivations are published as
that provider's offers, visibly marked as LLM-derived; low confidence
keeps last known-good exactly as today.

**Why this priority**: This is "smart enough to derive prices by itself" —
the feature's core.

**Independent Test**: Feed a recovery run a fixture page and a stub judge;
high-confidence output lands as offers with `llm` provenance, passing the
same validation and anomaly gates as parsed data; low-confidence output
writes nothing.

**Acceptance Scenarios**:

1. **Given** an extractor that throws or returns zero models while the
   source text was fetched, **When** the run completes, **Then** the
   provider's offers reflect the judge's high-confidence derivation,
   marked `llm` in provenance, and the run reports recovery — not failure.
2. **Given** a low-confidence derivation (or the judge unavailable),
   **Then** the provider keeps last known-good prices and reports failure
   exactly as today.
3. **Given** a high-confidence derivation, **Then** it still passes
   through model validation and bulk anomaly detection; a blocked result
   stays blocked (the LLM gets no bypass of the safety gates).
4. **Given** the fetch itself failed (no page text), **Then** there is
   nothing to judge and today's failure path runs unchanged.

---

### User Story 2 - The system remembers each source's structure (Priority: P2)

Every recovery stores/updates a per-provider structure memo (what the
page/API looks like: sections, tables, field names). The next recovery
reads it, so the judge knows what changed rather than starting blind, and
the operator can see the drift history.

**Acceptance Scenarios**:

1. **Given** a first recovery for a provider, **Then** a structure memo is
   stored with the judge's description of the source.
2. **Given** a later recovery, **Then** the judge receives the remembered
   memo, reports whether/how the structure changed, and the memo updates.
3. **Given** healthy runs, **Then** no memos are written and no LLM is
   called (zero cost on healthy days).

---

### User Story 3 - Rework gets a ticket, not a mystery (Priority: P3)

When a recovery runs (the parser is definitionally broken) the system
files a GitHub issue describing the provider, what the structure looks
like now, what changed versus the memo, and that the parser needs rework —
deduplicated so a broken parser files one issue, not one per day. Without
a GitHub token, the same content goes into the existing alert email.

**Acceptance Scenarios**:

1. **Given** a recovery with a GitHub token configured, **Then** an issue
   is created titled for the provider with the change description.
2. **Given** the same provider still broken the next day, **Then** no
   duplicate issue is filed (a re-file happens only after the dedup window).
3. **Given** no token, **Then** the alert email carries the same report.
4. **Given** issue creation fails, **Then** the run is unaffected and the
   alert notes it.

---

### Edge Cases

- LLM-derived offers repeat daily while the parser stays broken: repeated
  identical derivations must not spam price history (existing
  material-change trigger handles this) and must not re-file issues.
- When the parser is fixed and parses again, provenance returns to
  `scrape`/`api` naturally on the next successful run.
- The judge must derive only models it can see in the page text with their
  ids; it must not invent models from memory of the vendor. The baseline
  model list is context for matching, not a template to fill.
- Derived prices are subject to the arbiter? No — recovery and arbiter are
  mutually exclusive paths (arbiter judges parsed diffs; recovery replaces
  parsing). Anomaly gates apply to both.
- Page text is bounded (existing 30KB memory); sources larger than the
  bound recover only what fits — and say so.
- 010 arbiter default judge model switches to DeepSeek; both features use
  one OpenRouter client and one key.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a provider's extraction fails (throw, zero models, all
  invalid) and source text was fetched, the system MUST attempt an LLM
  recovery: derive per-model prices from the source text given the
  remembered structure and the provider's last known models/prices.
- **FR-002**: Only a high-confidence derivation is written; it MUST carry
  `llm` source-kind provenance everywhere source kinds appear, and MUST
  pass the same validation and anomaly gates as parsed results. Low
  confidence or judge failure MUST reproduce today's failure behaviour.
- **FR-003**: The system MUST persist a per-provider structure memo
  (description, updated time), give it to subsequent recoveries, and
  record the judge's account of what changed.
- **FR-004**: Each recovery MUST produce a rework notification: a GitHub
  issue (when configured) with provider, change description, and derived
  result summary — deduplicated within a 7-day window per provider — or
  the equivalent in the existing alert email. Notification failure never
  fails the run.
- **FR-005**: Healthy runs MUST make zero recovery LLM calls and write no
  memos.
- **FR-006**: The default judge model (for 010 and 012) MUST be DeepSeek
  via the existing OpenRouter access, overridable by the existing
  `ARBITER_MODEL` configuration.
- **FR-007**: The run summary and alert MUST state when a provider was
  LLM-recovered, including model count and confidence.

### Key Entities

- **Structure memo**: per-provider record of what the source looks like
  (judge-written description, last change account, timestamps, last
  notification time for dedup).
- **Recovery result**: judge output — structure description, changed?,
  change account, derived models with prices, confidence.
- **Rework notification**: GitHub issue or alert section derived from a
  recovery.

## Success Criteria *(mandatory)*

- **SC-001**: A provider whose parser breaks on a restructured page
  publishes LLM-derived prices (provenance-marked) in the same run, not
  frozen data — when the judge is confident.
- **SC-002**: Zero recovery LLM calls and zero memo writes across a fully
  healthy run.
- **SC-003**: A parser broken for N consecutive days yields exactly one
  rework notification per dedup window, not N.
- **SC-004**: Recovered offers are distinguishable from parsed offers at
  every surface that shows provenance.
- **SC-005**: The 2026-08-22 fixture, mutilated so the parser fails,
  recovers the realtime models' text prices via a stubbed judge in tests.

## Assumptions

- "Self-driving mode" is the trajectory, not this iteration's bar: this
  iteration makes breakage self-healing for prices and self-reporting for
  code; auto-writing parser fixes (e.g. LLM-authored PRs) is a future
  spec.
- DeepSeek via OpenRouter is the default judge for both 010 and 012;
  `ARBITER_MODEL` overrides both.
- GitHub issue creation uses a token + repo from environment
  configuration; absence degrades to the alert email.
- The structure memo is judge-written prose + a small fingerprint, not a
  parseable grammar — it exists to orient the next judge call and the
  human reading the issue.
