# Feature Specification: Model Type and Capability Classification

**Feature Branch**: `003-model-classification`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "Classify every model by type (chat, embedding, moderation, tts, asr, image_gen, video_gen, ocr, realtime, other) and by capabilities (input/output modalities plus features like reasoning, coding, vision, tool use). Flag uncertain classifications for manual review. The main table and the calculator default to generative chat models, so non-generative types stop polluting cheapest rankings; other types remain reachable via filters or separate sections."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - "Cheapest" means something (Priority: P1)

Someone comparing what an LLM costs sorts by price and sees the cheapest
models for the job they actually have: generating text. Today that list is
led by things that cannot generate text at all.

**Why this priority**: This is the site's central claim — that its numbers are
comparable — and it is currently false at the top of the default view. Of 225
active models, 32 are not text generators, and they win the ranking: a
moderation endpoint is the 4th cheapest model on the site, with an embedding
model and an OCR model close behind. A reader acting on that list is misled
within seconds of arriving.

**Independent Test**: Sort the main table by price ascending and confirm every
model in the top ten can actually generate text in response to a prompt.

**Acceptance Scenarios**:

1. **Given** a reader on the main table, **When** they sort by input price
   ascending, **Then** no embedding, moderation, OCR, speech, image or video
   model appears, because the view defaults to text-generating models.
2. **Given** a reader using the workload calculator, **When** they enter a
   token mix and rank models by cost, **Then** only models that can serve that
   workload are ranked.
3. **Given** a model that has no output price because it does not produce
   text, **When** any cost ranking is computed, **Then** it is excluded rather
   than treated as free or cheap.
4. **Given** the default view, **When** a reader looks at the result count,
   **Then** it is clear that a filter is applied and how to see everything.

---

### User Story 2 - Find the non-chat models on purpose (Priority: P1)

Someone shopping specifically for an embedding model, a transcription model or
an image generator can find them, and compare them against others of the same
kind rather than against chat models.

**Why this priority**: Equal in importance to US1 — hiding these models would
trade one wrong answer for another. The site tracks their prices and they are
genuinely useful; they simply are not comparable to chat models. Both halves
have to ship together or the change is a regression for anyone who came for an
embedding price.

**Independent Test**: With no prior knowledge of the URL, reach the embedding
models from the main table and confirm they are shown together with prices.

**Acceptance Scenarios**:

1. **Given** a reader on the main table, **When** they choose a different model
   type, **Then** models of that type are listed with their prices.
2. **Given** a reader viewing a non-chat type, **When** they compare two models
   of that type, **Then** the comparison is within the type and not against
   chat models.
3. **Given** a model type whose prices are not directly comparable to chat
   models, **When** it is displayed, **Then** the difference is stated rather
   than left for the reader to infer.
4. **Given** an existing link to any model's page, **When** it is followed
   after this change, **Then** it still resolves — no model is removed from the
   site.

---

### User Story 3 - Know what a model can actually do (Priority: P2)

A reader deciding between models wants to know what each one accepts and
produces — text in, text out; images in; audio out — and what it is good for:
reasoning, coding, vision, tool use.

**Why this priority**: This is what turns a price table into a decision. It
ranks below the first two because a wrong price ranking actively misleads,
whereas missing capabilities merely leave the reader to look elsewhere.

**Independent Test**: Pick five models of different kinds and confirm the
capabilities shown match what the provider documents.

**Acceptance Scenarios**:

1. **Given** any model, **When** a reader views it, **Then** the inputs it
   accepts and the outputs it produces are stated.
2. **Given** a model whose capabilities are not known reliably, **When** it is
   displayed, **Then** nothing is claimed about it rather than a guess being
   shown.
3. **Given** a reader filtering for a capability such as vision or tool use,
   **When** they apply that filter, **Then** every result genuinely has it.

---

### User Story 4 - Uncertain classifications get reviewed, not shipped (Priority: P2)

Where the evidence does not clearly determine a model's type, the model is
flagged for a person to decide, instead of being silently assigned a plausible
guess.

**Why this priority**: The existing capability data is exactly what happens
without this: values inferred from model names, wrong often enough that the
project's own documentation says they must not be displayed. A classification
that is confidently wrong is worse than one marked unknown.

**Independent Test**: Introduce a model whose type cannot be determined from
its published evidence and confirm it appears on a review list rather than
being assigned a type.

**Acceptance Scenarios**:

1. **Given** a model whose type cannot be determined confidently, **When**
   classification runs, **Then** it is recorded as needing review rather than
   assigned a type.
2. **Given** models awaiting review, **When** the maintainer looks for them,
   **Then** they are listed together with what is known and why it was
   uncertain.
3. **Given** a model awaiting review, **When** a reader encounters it, **Then**
   it is not presented as a confidently-classified model of any type.
4. **Given** a maintainer's decision about a model, **When** classification
   runs again, **Then** that decision is preserved and not overwritten by a
   fresh guess.

---

### User Story 5 - Programmatic consumers can filter by type (Priority: P3)

Someone using the public data can select models by type and capability instead
of pattern-matching on names, which is what they must do today.

**Why this priority**: Valuable and cheap once the classification exists, but
the reader-facing problem is the urgent one.

**Independent Test**: Request only embedding models from the public data and
confirm the result contains exactly those.

**Acceptance Scenarios**:

1. **Given** a consumer of the public data, **When** they request a single
   model type, **Then** only models of that type are returned.
2. **Given** an existing consumer who sends no new parameters, **When** they
   make the same request as before this change, **Then** they receive the same
   set of models as before, with additional fields.

---

### Edge Cases

- **A model that is genuinely two things.** Some models both converse and
  transcribe audio. Type must not force a false choice; capabilities carry the
  detail.
- **A model whose prices are not per-token at all.** Image and speech models
  are often billed per image, per second or per character, so a per-1M-token
  figure is meaningless for them and must not be presented as comparable.
- **A model with no output price.** All 5 embedding models and the moderation
  model have none, because they return no generated content. Nothing may
  interpret that absence as "free".
- **A newly released model type nobody anticipated.** The classification must
  admit "not one of the known kinds" without a code change and without
  guessing.
- **A model reclassified after being visible.** Its page and any saved link
  keep working; it moves between views rather than disappearing.
- **A provider renaming a model so its name no longer hints at its type.**
  Classification must not silently degrade to the wrong type.
- **The default filter hiding something a reader expected.** A reader who
  searches for a model by name and gets nothing must be told it exists outside
  the current view rather than that it does not exist.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every model MUST carry a type drawn from a defined set: chat,
  embedding, moderation, text-to-speech, speech-to-text, image generation,
  video generation, OCR, realtime, and other.
- **FR-002**: Every model MUST carry its capabilities: the input kinds it
  accepts, the output kinds it produces, and notable features such as
  reasoning, coding, vision and tool use.
- **FR-003**: A capability or type MUST only be recorded when the evidence
  supports it. Guessing from a model's name is not evidence.
- **FR-004**: A model whose type cannot be determined confidently MUST be
  recorded as needing review and MUST NOT be assigned a speculative type.
- **FR-005**: Models needing review MUST be listable, with what is known and
  the reason classification was inconclusive.
- **FR-006**: A human decision about a model's classification MUST persist and
  MUST NOT be overwritten by subsequent automatic classification.
- **FR-007**: The main table MUST default to text-generating models, and MUST
  make both the fact of the filter and the route to other types visible.
- **FR-008**: The cost calculator and every "cheapest" or value ranking MUST
  consider only models that can serve the workload being priced.
- **FR-009**: Models of other types MUST remain reachable, browsable and
  priced, whether by filter or by a separate section.
- **FR-010**: Prices MUST only be compared within a type. Where a type's
  prices are not expressed in the same unit as chat models, that MUST be
  stated wherever those prices appear.
- **FR-011**: No model MUST be removed from the site by this change, and every
  existing model page URL MUST continue to resolve.
- **FR-012**: A reader searching for a model that exists outside the current
  view MUST be told it exists elsewhere rather than shown an empty result.
- **FR-013**: The public data MUST expose each model's type and capabilities,
  and MUST allow selecting by type.
- **FR-014**: The public data's existing default response MUST NOT change for
  callers who send no new parameters; new fields are additive.
- **FR-015**: Classification MUST be re-derivable as the catalogue changes,
  without a person re-checking every model on every run.
- **FR-016**: Where the existing capability data conflicts with newly derived
  classification, the unreliable existing values MUST NOT be preserved merely
  because they are already stored.

### Key Entities

- **Model type**: What kind of thing a model is, from a fixed set, plus
  "other" for kinds not yet anticipated. One per model. Determines which view
  a model appears in and which models it may be compared against.
- **Capability set**: What a model accepts, what it produces, and what it is
  notably good at. Independent of type — two chat models may differ in whether
  they see images or call tools.
- **Classification confidence**: Whether a model's type is settled, and if not,
  why. Distinguishes "known" from "not yet determined", and records whether a
  person or the automatic process decided.
- **Review queue**: The set of models awaiting a human decision, with the
  evidence available for each.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sorting the default table by price returns zero non-text-
  generating models in the top 25, down from at least 3 in the top 10 today.
- **SC-002**: 100% of models carry a type, or are on the review list — no
  model is silently untyped.
- **SC-003**: Every one of the 32 non-generative models currently in the
  default view is reachable in at most two interactions from the main table.
- **SC-004**: Zero models are removed from the site, and 100% of existing
  model page URLs still resolve.
- **SC-005**: Spot-checking 20 classified models against their providers'
  published documentation yields zero incorrect types.
- **SC-006**: No cost ranking anywhere on the site includes a model that
  cannot produce the output being priced.
- **SC-007**: Existing programmatic consumers who send no new parameters
  receive the same set of models as before the change.
- **SC-008**: A reader searching for a model outside the current view is told
  where to find it, in 100% of such searches.

## Assumptions

- **Scope is classification and its consequences**, not a redesign of the
  table or the calculator. Those change only as much as defaulting to one
  model type requires.
- **Nothing is deleted.** Non-chat models stay tracked, priced and linkable.
  The change is about which are shown by default and what they are compared
  against.
- **The public API's default response is unchanged.** Silently dropping 32
  models from what existing callers already receive would be a breaking change
  to a published contract; the type becomes an additional field and an optional
  filter instead. Only the site's own default view changes.
- **The existing modality and tag data is not trustworthy** and is treated as a
  starting hint at best. It was inferred from model names — the project's own
  documentation says so, and spot checks bear it out: an image generation model
  is recorded as text-only, as is an embedding model and an OCR model.
- **Capabilities are recorded, not derived.** This feature does not build
  machinery to infer what a model accepts and produces. A capability is stored
  when a source declares it or a person records it; otherwise it stays unknown
  and the model is flagged. Populating capabilities across the catalogue is a
  separate pass, and the type classification does not wait for it.
- **Quality scores and rankings are out of scope**, and are specified
  separately. This feature only makes it possible to rank within a coherent set
  of models.
- **Model detail page enrichment is out of scope** beyond showing type and
  capabilities where they are already displayed; that page's redesign is
  specified separately.
- **Per-unit pricing for non-token-billed types is out of scope.** Where a
  type is billed per image or per second, this feature states that the figures
  are not comparable rather than converting them.
- **A single type per model** is sufficient, with capabilities carrying the
  nuance for models that do more than one thing.
