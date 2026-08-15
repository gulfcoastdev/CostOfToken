# Phase 0 Research: Model Type and Capability Classification

Findings are from the live catalogue and live provider sources on 2026-08-15,
not from memory.

---

## R1 — What evidence is actually available?

**Checked, and mostly disappointing:**

| Candidate source | Verdict |
|------------------|---------|
| OpenRouter `architecture.output_modalities` | **Declared and reliable — but useless here.** Every one of the ~460 catalogue entries outputs `text` only. OpenRouter carries no embedding, image or speech models at all, so it can confirm "chat" for the models it covers and can never identify a non-chat one. |
| OpenRouter `architecture.input_modalities` | Declared and reliable. Good evidence for vision/audio/file *inputs* on covered models. |
| Vendor page section headings | **Checked and rejected.** The extractors do capture a heading breadcrumb (`captionPath`), and it works for tier detection — but OpenAI's markdown headings are `### Grouped Pricing Table data` and `### Pricing Table data`. Structurally present, semantically empty. |
| Price shape | **Strong signal.** A model with no output price produces no billable generated content. All 5 embedding models, the moderation model, all 6 realtime models and 3 of 6 TTS models have none. |
| Model id patterns | Weak on its own. This is precisely how the existing `modality` column became wrong. |
| Human decision | Authoritative, and `data/overrides.ts` already exists for exactly this kind of correction. |

**Consequence**: every non-chat model in the catalogue comes from a
**first-party** extractor (OpenAI, Google, Zhipu), because the OpenRouter
fallback only carries text generators. There is no declared-modality feed for
them. So the classifier works from price shape, name patterns and human
decisions — and must be honest about which of those it used.

---

## R2 — The rules

**Decision**: One ordered list. First match wins.

| # | Condition | Result | Confidence |
|---|-----------|--------|------------|
| 1 | A human decision exists in `data/overrides.ts` | that type | `manual` |
| 2 | Non-chat name pattern **and** no output price | that type | `derived` |
| 3 | Non-chat name pattern **and** an output price exists | `null` type, flagged | `needs_review` |
| 4 | No non-chat signal **and** priced for both input and output | `chat` | `derived` |
| 5 | Anything else | `null` type, flagged | `needs_review` |

**Rationale**: Rules 2 and 3 are the heart of it. A name pattern alone never
decides — it must be corroborated by the price shape, which is independent
evidence produced by the vendor's own billing. Where the two agree, that is two
independent signals and the type is recorded. Where they conflict, the model is
flagged for a person rather than being assigned whichever signal we happened to
trust more.

Rule 4 is the one that looks like an assumption and is not: a model priced for
input *and* output tokens is billing for generated text, which is what a text
generator does. Combined with the absence of any non-chat signal, that is
evidence, not a default.

**What this yields today**, from the live catalogue:

- **15 auto-typed non-chat**: the embeddings, moderation, realtime and TTS
  models that have no output price.
- **17 flagged for review**: the image models, `glm-ocr`, and the Google TTS
  and native-audio models — all of which have an output price, so the name
  pattern stands alone and is not trusted.
- **~193 typed `chat`**.

Seventeen flagged models is a tractable one-time human pass through
`overrides.ts`, and it is the honest outcome. Guessing them would reproduce the
exact fault this feature exists to fix.

**Alternatives considered**:

- *Trust the name pattern outright.* Rejected — it is how `gpt-image-1` came to
  be recorded as a text-only model with a `vision` tag.
- *Call an authoritative provider API* (e.g. Google's ListModels, which
  publishes `supportedGenerationMethods`). Genuinely better evidence, but it
  needs per-provider credentials and a new integration per vendor. Worth
  revisiting; not worth blocking a fix for a live wrong ranking.

---

## R3 — What the default view filters on

**Decision**: The site's default views show `model_type = 'chat'`. Models that
are flagged are **not** in the default view, and are reachable alongside the
other types.

**Rationale**: The default view drives the cheapest ranking, which is the thing
currently broken. Including unclassified models there would leave the bug
half-fixed. Excluding them is safe because rule 4 types the overwhelming
majority of genuine chat models confidently — the flagged set is 17 models,
all of which have real non-chat signals.

**Guard**: FR-012 requires that a reader searching for a model outside the
current view is told where it is, rather than shown an empty result. Without
that, hiding flagged models would look like deleting them.

---

## R4 — Where classification is stored

**Decision**: Columns on `models`: `model_type` (nullable, checked against the
enum), `classification_status`, `classification_source`. Appended to the
flattened view at the end.

**Rationale**: One row per model already exists and the type is a property of
the model, not of its price. Nullable is deliberate — "not yet determined" must
be representable, which is the difference between this and the `modality`
column that has a non-null default and therefore cannot express doubt.

`db/schema.sql` is idempotent and re-runnable, and the file's own comment
records why new view columns must be appended rather than inserted mid-list:
`create or replace view` can only add columns at the end.

**Alternatives considered**: A separate `model_classification` table. Rejected —
one-to-one with `models`, no history requirement, and it would need a join in
every read for no benefit.

---

## R5 — Capabilities

**Decision**: Out of scope as a derivation. The schema carries the fields, a
source may declare them (OpenRouter's input modalities), a person may record
them in `overrides.ts`, and otherwise they stay unknown.

**Rationale**: Explicit direction, and it is right. There is no reliable
automatic source for capabilities across first-party providers, and building a
half-trustworthy inference engine would recreate the `modality` problem one
column over. Type classification delivers the P1 outcome on its own and does
not need capabilities to land first.

---

## R6 — Not breaking the public API

**Decision**: `/api/v1/prices` returns the same models as before for callers
sending no new parameters. `model_type` and `capabilities` are additive fields;
`?type=` is opt-in. Only the site's own views default to chat.

**Rationale**: Constitution VI — no incompatible change to a published contract
within a version. Dropping 32 models from the default response would silently
change what every existing integration receives. A route test guards it.

**Alternatives considered**: Defaulting the API to chat with `?type=all` to
opt out. Rejected as a breaking change; revisit at `v2` if ever.

---

## R7 — Testing

**Decision**: Rules are pure functions over a model record, unit-tested with
the catalogue's genuinely awkward cases as fixtures. Two database-backed
assertions cover the whole catalogue: every model is either typed or flagged,
and no cost ranking contains a model that cannot produce the priced output.
One route test guards the API default.

**Rationale**: The faults worth catching are a rule mis-ordering (unit), a
model falling through every rule (catalogue-wide), and a contract break
(route) — Principle III, each at its own layer. The awkward fixtures come from
real data rather than invention: `gpt-image-1` (non-chat with an output price),
`gemini-embedding` (non-chat without one), `glm-ocr` (OCR that does emit text),
`gpt-realtime` (audio, no output price).
