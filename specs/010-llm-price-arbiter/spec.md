# Feature Specification: LLM Price-Change Arbiter

**Feature Branch**: `010-llm-price-arbiter`

**Created**: 2026-08-25

**Status**: Draft

**Input**: User description: "Hybrid scraper: deterministic parse + LLM arbiter. When a pipeline run produces price changes, send the changed models' old price, new price, and scraped raw evidence (plus the provider's fetched page text when available in-run) to Claude in one call per run for a per-model verdict: real / misread / unclear. real → write as normal; misread or unclear → keep last known-good price and put the verdict + reason in the existing alert email. LLM unavailable → behave exactly as today plus an 'arbiter unavailable' note. Keep it simple and effective — no over-engineering: single call, one retry max, no new tables, no UI."

## Background

The deterministic extractors are correct until a vendor restructures a page,
and then they are wrong *plausibly*: on 2026-08-22 OpenAI's grouped modality
table flipped row order and 14 models recorded 8x–16.7x phantom changes that
sat in production for two days until a human diagnosed them. The evidence to
catch it was already in hand at write time — the scraped raw row literally
said "Audio" while the previous price was the Text rate. An LLM reading that
evidence at the moment of the change would have blocked the bad write and
named the cause in the same alert email. The deterministic pipeline remains
the only thing that produces prices; the LLM only judges *changes*.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Parser misreads are blocked and diagnosed at write time (Priority: P1)

The site operator receives the daily alert email and, for each price change
the run wanted to make, sees a verdict: the change was judged a real vendor
change (and was written) or a parser misread / unclear (and was **not**
written — the model kept its last known-good price), with a one-line reason
quoting the evidence.

**Why this priority**: This is the feature — wrong prices stop reaching the
public catalogue, and diagnosis latency drops from days to zero.

**Independent Test**: Feed the arbiter a change set replaying the 2026-08-22
incident (old price $4/Text, new price $32 with raw evidence naming Audio);
verify the verdict is "misread", the price write is skipped, and the alert
text carries the verdict and reason.

**Acceptance Scenarios**:

1. **Given** a run whose parsed price for a model differs from the stored
   price and whose raw evidence contradicts the new value (e.g. evidence row
   labelled with another modality/tier), **When** the run completes, **Then**
   the model's stored price is unchanged and the alert email shows
   "misread" with a reason for that model.
2. **Given** a change judged "real" (evidence consistent with a genuine
   vendor change), **When** the run completes, **Then** the new price is
   written exactly as today and the alert lists the verdict.
3. **Given** a change judged "unclear", **When** the run completes, **Then**
   the stored price is kept and the alert marks it "unclear" for human review.
4. **Given** a run with zero price changes, **When** it completes, **Then**
   the arbiter is not consulted at all (no LLM call, no cost).

---

### User Story 2 - The arbiter can never take the pipeline down (Priority: P2)

When the LLM is unreachable, misconfigured, over quota, or returns an
unusable response, the run completes exactly as it does today — all changes
written, existing alerts sent — with a note that the arbiter was unavailable.

**Why this priority**: A judgment layer that can block the daily pipeline is
worse than no judgment layer.

**Independent Test**: Run the pipeline with no API key configured and with a
failing LLM stub; both must produce today's behaviour plus the note.

**Acceptance Scenarios**:

1. **Given** no LLM credentials configured, **When** a run has price changes,
   **Then** every change is written as today and the alert notes "arbiter
   unavailable (no key)".
2. **Given** the LLM call fails (after at most one retry) or returns a
   response that doesn't cover a changed model, **When** the run completes,
   **Then** the uncovered changes are written as today and the alert notes
   the arbiter outcome.
3. **Given** the arbiter errors for one provider, **When** other providers
   run, **Then** they are unaffected (per-provider isolation, matching the
   pipeline's existing failure model).

---

### Edge Cases

- A model whose price change is *held* (misread/unclear) keeps its previous
  price AND its previous metadata freshness semantics — a hold is recorded in
  the run results, not silently.
- New model (no stored price yet): not arbitrated — there is no old value to
  compare; written as today.
- Model disappearing from a provider: unchanged behaviour (out of scope).
- The arbiter judges only price-field changes; metadata-only updates are
  written without consulting it.
- A verdict for a model the run didn't change, or a hallucinated model id, is
  ignored; the genuine changes it failed to cover fall back to "written as
  today + noted" (US2 scenario 2).
- Very large change sets (whole catalogue repriced): evidence payload is
  bounded; if the change set exceeds the bound, the arbiter judges what fits
  and the rest fall back to today's behaviour with a note — a truncated run
  must not block writes wholesale.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After extraction and before prices are written, each provider's
  price *changes* (parsed value differs from stored value for an existing
  model) MUST be submitted for judgment in a single request per provider run,
  carrying per model: the stored price fields, the newly parsed price fields,
  and the scraped raw evidence already captured with the parse; plus the
  provider's fetched source text for the run when it is available in memory,
  bounded in size.
- **FR-002**: The judgment MUST classify each submitted change as exactly one
  of: `real`, `misread`, or `unclear`, each with a one-line reason; `misread`
  reasons MUST point at the evidence (e.g. quote the row or name the
  mismatch).
- **FR-003**: Changes judged `real` MUST be written unchanged. Changes judged
  `misread` or `unclear` MUST NOT have their price fields written — the model
  keeps its last known-good prices — and the hold MUST be visible in the run
  results and alert email with the verdict and reason.
- **FR-004**: If judgment is unavailable for any reason — no credentials, call
  failure after one retry, malformed response, oversized change set, or a
  change the response didn't cover — the affected changes MUST be written
  exactly as they are today, and the alert email MUST say the arbiter was
  unavailable or incomplete for that provider. The pipeline MUST never fail,
  slow past its platform duration ceiling, or hold writes because the arbiter
  is down.
- **FR-005**: The arbiter MUST NOT run when there are no price changes, MUST
  NOT judge brand-new models or metadata-only updates, and MUST NOT alter any
  price value — its only powers are "let the parsed value through" and "hold
  the previous value".
- **FR-006**: Verdicts MUST be recorded in the existing run/alert structures
  (no new tables, no UI).
- **FR-007**: The 2026-08-22 modality incident, replayed as a test case, MUST
  produce `misread` holds for the affected models.

### Key Entities

- **Price change**: an (existing model, stored prices, parsed prices, raw
  evidence) tuple produced by a run — the arbiter's unit of judgment.
- **Verdict**: `real` | `misread` | `unclear` plus a one-line reason,
  attached to one price change.
- **Hold**: a change whose write was skipped; surfaces in run results and the
  alert email.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Replaying the 2026-08-22 flip-flop through the full pipeline
  path yields 0 wrong prices written (today: 14) and a same-run diagnosis in
  the alert.
- **SC-002**: With the arbiter disabled or failing, run outcomes are
  byte-identical to today's except for the "unavailable" note.
- **SC-003**: Runs with no price changes make zero LLM calls; a typical run
  (~20 changes) adds at most a few seconds and stays within the platform
  duration ceiling.
- **SC-004**: Every held change is visible in the alert with a verdict and
  reason — no silent holds.

## Assumptions

- One LLM request per provider with changes (not per model, not per run) is
  the right cost/latency point; a typical day is 0–3 providers with changes.
- The scraped raw evidence stored with each parse (headers, row(s), labels,
  caption — and `modalities` after 009) plus the in-run page text is enough
  context to judge; the arbiter does not re-fetch pages.
- Held prices self-resolve: a real vendor change mis-held as `unclear` will
  reappear as a change on the next run (and the alert already told the human);
  a parser misread held correctly stays held until the extractor is fixed.
  No stored "override the arbiter" mechanism in v1.
- Claude is the judgment provider, configured via an API key in the existing
  environment configuration; absent key = feature off = today's behaviour.
- OpenRouter-sourced providers (deepseek, moonshot, etc.) are arbitrated like
  any other; their routing-driven flip-flops should come back `real` with a
  reason, which is itself useful alert context.

## Amendments (2026-08-26, operator-directed)

- **Judgment provider is OpenAI, not Claude** ("I want to use OpenAI Key not
  Anthropic"): the judge calls OpenAI chat completions with a strict JSON
  response schema via plain fetch (no SDK; the Anthropic SDK dependency was
  removed), gated on `OPENAI_API_KEY`. Model pinned in one constant
  (`gpt-5.5`).
- **Confidence gates application**: every verdict carries
  `confidence: high | low`. Only a high-confidence `real` verdict is applied,
  and each applied change is individually noted in the alert with the judge's
  reason. A `misread`, `unclear`, or low-confidence `real` verdict holds the
  stored price and reports why. FR-002/FR-003 are amended accordingly; all
  failure-mode rules (FR-004) are unchanged.
- **2026-08-28: judge calls go through OpenRouter** ("I want to use
  Open_ROUTER_API"): endpoint is OpenRouter's OpenAI-compatible chat
  completions, gated on `OPEN_ROUTER_API_KEY`; the judge model is
  `ARBITER_MODEL` (OpenRouter id form, default `openai/gpt-5.5`). Verified
  live: a seeded price deviation was judged `real` with the evidence row
  quoted, and applied.
