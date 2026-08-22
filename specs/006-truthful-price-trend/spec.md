# Feature Specification: Truthful Price Trend

**Feature Branch**: `006-truthful-price-trend`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Make the blended price trend truthful" — four linked defects reported from a published chart that showed prices rising while every robust measure of the same data showed them flat-to-down.

## Context

The site publishes a "Blended price trend · 90 days" card. A reader reported it as broken. Investigation against the local catalogue found four independent defects that compound into a published claim that is the opposite of what the data supports:

1. Non-standard pricing tiers are being recorded as standard rates, non-deterministically.
2. The bulk-plausibility check that exists to catch exactly this cannot see it.
3. The trend statistic is an unweighted mean, so a handful of corrupted values set its direction.
4. The chart's vertical scale is unbounded below, so a 0.14% move is drawn as a full-height climb.

Defect 1 is a direct violation of the constitution's Comparability constraint ("Batch, Flex and Priority tiers are excluded rather than blended") and of Principle I ("The catalogue MUST NOT contain a value the project cannot stand behind"). The constitution already names the ancestor of this bug as a past incident: "every price reading exactly 2× because a tier table shared a heading."

### Evidence

Measured against the local catalogue (`cot-pg`) on 2026-08-22:

- Of 74 currently-stored OpenAI models, only 36 came from a source table captioned "Standard pricing data". 31 came from "Grouped Pricing Table data", 6 from "Pricing Table data", and 1 from "Finetuning" — captions containing no tier word.
- Four pipeline runs within 30 minutes on 2026-08-11 recorded 2–3 distinct prices for the same models against the same upstream content. Every recorded value is a clean tier multiple of that model's standard rate — for `gpt-5.6-terra`: 4.00, 2.00, 1.00, 2.00; for `gpt-5.3-codex`: 3.50, 1.75, 0.875, 1.75; for `gpt-image-2`: 4.00, 8.00, 4.00, 8.00. 73 of 74 OpenAI models flapped this way; 75 of 217 models catalogue-wide recorded 2–3 distinct prices inside that single 30-minute window.
- Re-running the current extractor against the source document as published on 2026-08-22 reproduces the mechanism directly. Of 16 tables parsed, only 3 are recognised as non-standard — the three whose own heading names a tier. Twelve tables carrying a generic caption are all treated as standard, and four of those are genuinely non-standard: the batch variant of the image table, the batch variant of the per-second video table, the fast-mode variant of the code-model table, and the batch variant of the fine-tuning table.
- The tier of every table *is* stated in the source, as a bare text line ahead of the table's heading — the rendered tab label. It is not a heading, so nothing in the current reading of the document sees it.
- Which value survives today is decided purely by which table appears first in the document. On the 2026-08-22 document that accident currently favours the standard tier for most models, which is why the catalogue is not uniformly wrong — but the same accident is what produced the flapping on 2026-08-11.
- Two further classes of incomparable rate are being recorded as standard per-token prices: `o4-mini-2025-04-16` appears **only** in the fine-tuning tables and is stored at `4.00`, a fine-tuning rate; `gpt-image-2` is stored at `8.00`, its per-image generation rate, taken from a table that lists each model once per modality.
- Over the stored history, the median catalogue price is unchanged (0.680 then, 0.680 now) and movers split 10 down against 8 up, yet the unweighted mean rises 3.9555 → 3.9612 (+0.14%) — entirely because two corrupted models happened to land on their high tier on the final scrape.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A reader is not told prices rose when they did not (Priority: P1)

A reader opens the site to answer "are model prices going up or down?". The trend card must report a direction that matches what the underlying prices actually did, or report nothing at all. It must never report a direction that a handful of mis-recorded values invented.

**Why this priority**: This is the reported defect and the reason the project exists. A confidently-wrong published number is the single failure mode Principle I is written to prevent. Every other story here is a contributing cause or a cosmetic consequence.

**Independent Test**: Feed the trend a catalogue in which the typical model is unchanged but two expensive models carry corrupted doubled values. The reported direction must not read as a rise. Verified without touching the extractor or the chart.

**Acceptance Scenarios**:

1. **Given** a catalogue where the median price is unchanged and movers split evenly in both directions, **When** the trend is computed, **Then** it reports no material change.
2. **Given** a catalogue where a small number of models carry values corrupted by a large multiple, **When** the trend is computed, **Then** those values do not determine the reported direction.
3. **Given** a catalogue containing models priced in units other than tokens, **When** the trend is computed, **Then** those models are excluded from the series entirely.
4. **Given** the set of models available differs between two sample points, **When** the trend is computed, **Then** the change reported reflects price movement only, not the change in which models were counted.

---

### User Story 2 - Only standard-tier prices enter the catalogue (Priority: P1)

The catalogue stores one comparable number per model: the standard, on-demand, per-token rate. Discounted asynchronous tiers and premium latency tiers must never be recorded in its place, regardless of how the source document is laid out or labelled.

**Why this priority**: Root cause. Every downstream statistic is computed over these values, so no amount of work on the aggregate or the chart produces a truthful result while the inputs are wrong. It is also a standing violation of a non-negotiable principle, independent of whether any chart displays it.

**Independent Test**: Run the extractor twice against identical captured source content and compare the results; then run it against source content whose tier tables carry generic captions. Verified entirely within the extraction layer, with no database and no UI.

**Acceptance Scenarios**:

1. **Given** source content whose tier tables are labelled with explicit tier headings, **When** prices are extracted, **Then** only standard-tier rows are recorded.
2. **Given** source content whose tier tables carry generic captions with no tier word, **When** prices are extracted, **Then** non-standard rows are still not recorded as standard rates.
3. **Given** a row whose tier cannot be positively established as standard, **When** prices are extracted, **Then** the row is rejected rather than recorded.
4. **Given** identical source content processed on two separate occasions, **When** prices are extracted, **Then** both runs produce identical values for every model.
5. **Given** source content in which one model appears in several tier tables, **When** prices are extracted, **Then** exactly one value is recorded for that model and it is the standard-tier value, irrespective of the order the tables appear in the document.
6. **Given** source content in which the order of tier tables differs from a previous fetch, **When** prices are extracted, **Then** the recorded values are unchanged from that previous fetch.

---

### User Story 3 - Bulk implausibility blocks the write (Priority: P2)

Before prices are written, the run is compared against the provider's last known-good state. A run in which an implausible share of models have moved by exact tier-shaped multiples must be blocked and reported, even when those multiples point in different directions.

**Why this priority**: The safety net that should have contained this. Story 2 fixes the known instance; this story is what catches the next variant of it. It is second because it prevents recurrence rather than correcting the present wrong data, and because its value is only observable when something else has already failed.

**Independent Test**: Present the checker with a baseline and an incoming run in which some models moved by exactly 2× and others by exactly 0.5×, and confirm the run is blocked. Pure comparison logic, testable with no source fetch and no database.

**Acceptance Scenarios**:

1. **Given** a run in which a large share of models moved by exactly the same suspicious multiple, **When** the run is checked, **Then** it is blocked and the finding recorded. *(Existing behaviour; must not regress.)*
2. **Given** a run in which a large share of models moved by exact tier-shaped multiples but in differing directions, **When** the run is checked, **Then** it is blocked and the finding recorded.
3. **Given** a genuine repricing in which models move by varied, non-tier-shaped amounts, **When** the run is checked, **Then** it is not blocked.
4. **Given** a blocked run, **When** the write is attempted, **Then** nothing is written and the provider keeps its last known-good prices.

---

### User Story 4 - A near-flat trend looks flat (Priority: P3)

Where the trend has barely moved, the drawn line must look as though it has barely moved. The line, the summary badge and the endpoint labels on the same card must never contradict one another.

**Why this priority**: Cosmetic relative to the others — it exaggerates a signal rather than inventing one — but it is what made the defect visible to a reader, and it is the cheapest of the four to correct. Left unfixed, a correct trend can still be read as a dramatic one.

**Independent Test**: Render the chart with a series whose values differ by a fraction of a percent and confirm the drawn line is visually negligible and consistent with the card's own badge. Pure presentation, testable in isolation.

**Acceptance Scenarios**:

1. **Given** a series whose values differ by well under one percent, **When** the trend chart is drawn, **Then** the line reads as flat.
2. **Given** a series the card summarises as unchanged, **When** the card is rendered, **Then** the drawn line does not depict a pronounced rise or fall.
3. **Given** a series whose endpoint labels display the same value, **When** the card is rendered, **Then** the line's endpoints appear at the same height.
4. **Given** a series with a genuinely large movement, **When** the trend chart is drawn, **Then** that movement remains clearly legible.
5. **Given** any of the above series, **When** the small per-model trend indicator is drawn, **Then** it behaves consistently with the larger chart.

---

### Edge Cases

- A provider publishes only non-standard tiers for a model, so no standard rate can be established — the model carries no price rather than a non-standard one.
- A source document stops using tier headings entirely, so no row can be positively established as standard — the run yields nothing for that provider and is treated as a failure, leaving last known-good prices in place.
- Every model in the trend basket is excluded as non-token-priced, leaving an empty series — the card reports the absence rather than drawing an empty or misleading line.
- A single model is the entire basket, so no robust statistic is meaningful.
- All values in the series are identical, so there is no range to scale against at all.
- A genuine, real repricing happens to move many models by exactly 2× — the run is blocked, and an operator override is required to accept it.
- A model legitimately changes price on the same day it is first observed, so its earliest recorded value is not its "before".
- The corrupted prices already stored in the catalogue remain until a clean run overwrites them; the trend must not be assumed correct merely because the extractor was fixed.

## Requirements *(mandatory)*

### Functional Requirements

**Tier integrity**

- **FR-001**: The system MUST record, for each model, only the standard on-demand per-token rate, and MUST NOT record a batch, flex, priority, provisioned, scale-tier, fine-tuning, or otherwise non-standard rate in its place.
- **FR-002**: The system MUST determine a source table's pricing tier without depending solely on the tier being named in that table's heading.
- **FR-003**: The system MUST reject any row whose tier cannot be positively established as standard, rather than defaulting to treating it as standard.
- **FR-004**: The system MUST resolve a model appearing in multiple source tables to exactly one recorded value, chosen by tier rather than by the order the tables appear in the source document.
- **FR-005**: The system MUST produce identical recorded values across repeated extractions of identical source content.
- **FR-006**: The system MUST produce identical recorded values when the source content is unchanged in substance but its tables appear in a different order.
- **FR-007**: A single extraction run MUST NOT write more than one price for the same model.
- **FR-022**: The system MUST NOT record a rate expressed in any unit other than price per token as though it were a per-token price, including per-image, per-second, per-character and per-hour rates.
- **FR-023**: Where a source lists one model once per modality, the system MUST resolve it to the modality the catalogue stores, rather than to whichever row appears first.

**Bulk plausibility**

- **FR-008**: The system MUST treat a run in which an implausible share of a provider's models moved by exact tier-shaped multiples as a blocking anomaly, whether those multiples are consistent in direction or mixed.
- **FR-009**: The system MUST continue to block a run in which a dominant share of models moved by a single common multiple.
- **FR-010**: The system MUST NOT block a run in which models moved by varied, non-tier-shaped amounts.
- **FR-011**: The system MUST remain shape-based and provider-agnostic in its plausibility checks, so a newly-added provider inherits them without per-provider configuration.
- **FR-012**: A blocked run MUST write nothing and MUST record its finding.

**Trend statistic**

- **FR-013**: The published trend MUST be computed with a statistic that is resistant to a small number of extreme values.
- **FR-014**: The published trend MUST include only models whose price is expressed in the same unit as the trend claims, excluding image-generation and any other non-token-priced model type.
- **FR-015**: The published trend MUST hold its basket of models constant across every sample point, so a change in which models are counted cannot present as a change in price.
- **FR-016**: The published trend MUST continue to be computed over the reader's active filters rather than over the narrowed "popular" display scope, preserving the existing documented intent.
- **FR-017**: Where the basket is too small or too sparse for the trend to be meaningful, the system MUST report that rather than publish a figure.

**Presentation**

- **FR-018**: The trend chart MUST bound its vertical scale so that a movement of well under one percent is drawn as visually negligible.
- **FR-019**: The per-model trend indicator MUST apply the same bounding as the trend chart.
- **FR-020**: The drawn line, the summary badge, and the endpoint labels on the trend card MUST NOT contradict one another.
- **FR-021**: A genuinely large movement MUST remain clearly legible after the scale is bounded.

### Key Entities

- **Price record**: One model's standard per-token input and output rates at a point in time, carrying the source it came from and the tier it was read as. The tier is the attribute this feature makes trustworthy.
- **Pricing tier**: The commercial class of a rate — standard, batch, priority, and so on. Only standard belongs in the catalogue; the others must be identifiable in order to be excluded.
- **Source table**: A block of rows in a vendor's published pricing document, belonging to exactly one tier, whose tier may or may not be stated in its own heading.
- **Provider run baseline**: A provider's last known-good stored prices, used to judge whether an incoming run is plausible.
- **Trend series**: An ordered set of aggregate price points over the trailing window, computed from a fixed basket of comparably-priced models.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Repeated collection runs against unchanged published prices produce zero price changes — the flapping observed on 2026-08-11 (75 of 217 models recording 2–3 distinct values within 30 minutes) does not recur.
- **SC-002**: 100% of stored prices originate from a source block positively established as standard tier; no stored price is a known multiple of its model's standard rate.
- **SC-003**: A collection run in which a quarter or more of a provider's models move by exact tier-shaped multiples is blocked before anything is written, in both same-direction and mixed-direction cases.
- **SC-004**: The published trend direction agrees with the direction indicated by the typical model in its basket, for every historical period the stored data covers.
- **SC-005**: No model priced in units other than tokens contributes to the published token-price trend.
- **SC-006**: A reader shown the trend card cannot find a contradiction between the line, the badge, and the endpoint labels.
- **SC-007**: A movement of under one percent occupies a negligible share of the chart's height, while a movement of tens of percent remains clearly visible.
- **SC-008**: A reader asking "are prices going up or down?" gets an answer supported by the data, or an explicit statement that there is not enough data to say — never an unsupported direction.

## Assumptions

- The reported chart was observed on the deployed site, whose database is separate from the local one used to gather the evidence above. The defects are in code and in the collection pipeline, so they apply to both, but exact figures on the deployed site were not confirmed.
- "Standard tier" retains the meaning fixed by the constitution: USD per 1,000,000 tokens, on-demand, non-batch, non-priority.
- Excluding a model from the trend basket does not remove it from the catalogue, its own page, or the price table — the exclusion is scoped to the aggregate trend statistic only.
- "Well under one percent" is treated as the threshold below which a movement should read as flat, matching the existing badge's own definition of flat; the plan may refine the exact figure so long as badge and chart agree.
- Correcting the extractor does not retroactively correct prices already stored. Whether to purge or restate the corrupted history recorded between 2026-08-11 and 2026-08-15 is a separate decision, noted below.
- The models flagged as flapping outside OpenAI (one DeepSeek, one Moonshot model) are assumed to be genuine price changes rather than instances of this defect, on the basis that their providers' extractors showed no comparable pattern.

## Out of Scope

- **Pipeline staleness alerting.** The collection pipeline last recorded on 2026-08-15, seven days before this spec, so the card's "now" is a week old. Already specified separately in `BACKLOG.md` (commit 4edea44).
- **The 90-day axis drawn from four days of history.** The stored history spans 2026-08-11 to 2026-08-15, so five of the trend's six sample points predate the first observation and are back-filled. The card nonetheless presents itself as 90 days. To be captured as a follow-up if FR-017 does not resolve it.
- **Restating or purging the corrupted price history** already written between 2026-08-11 and 2026-08-15.
- **Tracking non-standard tiers as first-class data.** Excluding them correctly is in scope; storing and displaying them is a later milestone, as the existing code already notes.
