# Phase 0 Research: Model Changelog Feed

No `NEEDS CLARIFICATION` markers survived the Technical Context — the stack,
storage and test runner are fixed by the existing project. The open questions
were all about *how* to derive and publish events. Each is resolved below.

---

## R1 — Where do the events come from?

**Decision**: Derive both event kinds from existing tables. `model_added` comes
from `models.created_at`; `price_change` comes from `price_history` rows,
comparing each row against the previous row for the same model with a `lag()`
window function.

**Rationale**: The database already records exactly these two facts. Crucially,
`record_price_history()` inserts a row *only* when a price field differs from
the previous one — a daily re-scrape of identical numbers writes nothing. That
means every history row is already a real event, and FR-006 ("no entry when
nothing moved") is satisfied by the existing trigger rather than by filtering
after the fact.

**Alternatives considered**:

- *A dedicated `feed_events` table written by the pipeline.* Rejected: it
  duplicates state that the trigger already maintains, needs a backfill for
  everything recorded so far, and introduces a way for the feed to disagree
  with the price history it claims to describe.
- *Diffing successive extraction runs.* Rejected: `extraction_runs` records
  counts and status, not per-model values, so the diff isn't recoverable from
  it.

---

## R2 — How is the "added" event kept from firing twice?

**Decision**: Exclude each model's first `price_history` row from
`price_change` events, using `row_number() over (partition by model_id order by
recorded_at, id) > 1`.

**Rationale**: The history trigger is `after insert or update`, so inserting a
model's initial price writes both the price row and a history row. Without this
exclusion, every new model produces two entries — "New model X" and "X: input
now $5.00" — from one real-world event, breaking FR-005.

Ordering by `(recorded_at, id)` rather than `recorded_at` alone matters: a
pipeline run can write several rows inside the same transaction timestamp, and
`bigserial` id is the only total order available then.

**Alternatives considered**:

- *Compare against `models.created_at` with a time window.* Rejected: any
  threshold is arbitrary and silently wrong at the boundary.
- *Filter on `prev_input_price is null`.* Rejected: a model whose price is
  genuinely withdrawn and later republished would be misclassified.

---

## R3 — Launch prices on a `model_added` entry: current or first-recorded?

**Decision**: Use the model's *first* `price_history` row where one exists,
falling back to the current `prices` row otherwise.

**Rationale**: An entry dated the day a model appeared should state what it
cost then. For a genuinely new model the two are identical, so this only
differs for backfilled entries — where the first-recorded value is the honest
one. The fallback covers models whose price row somehow predates history.

**Alternatives considered**: Reading `prices` only — simpler, but an old
addition entry would quote today's price under an old date, which reads as a
factual error in a reader that keeps entries forever.

---

## R4 — Item identity (`guid`)

**Decision**: `guid` is built from an immutable database id and marked
`isPermaLink="false"`: `/feed/price-change/{price_history.id}` for a change,
`/feed/model-added/{models.id}` for an addition.

**Rationale**: Readers dedupe on `guid`. A guid derived from anything mutable —
title, date, price — re-notifies every subscriber when that value changes,
which is the single most common way a feed becomes annoying (SC-003). A
`bigserial` id and a `uuid` are both immutable for the life of the row.
`isPermaLink="false"` is required because these paths are identifiers, not
pages.

**Alternatives considered**: Using the model page URL as the guid. Rejected
outright — a model with three price changes would collapse into one entry,
since all three share that link (FR-008).

---

## R5 — Date format

**Decision**: Hand-format RFC 822 dates in UTC with a numeric offset:
`Fri, 14 Aug 2026 12:16:23 +0000`.

**Rationale**: RSS 2.0 requires RFC 822 dates, which are English-only.
`toUTCString()` produces `GMT` rather than a numeric offset — legal per RFC
1123 but mishandled by some older parsers — and anything locale-aware would
emit month names no parser recognises. A fixed day/month lookup table costs
eight lines and removes both risks.

**Alternatives considered**: `toUTCString()` (offset form is safer);
`toISOString()` (that is Atom's format, invalid for RSS `pubDate`); a date
library (a dependency for eight lines).

---

## R6 — Escaping and injection safety

**Decision**: Item titles are XML-escaped. Item bodies are HTML, with every
interpolated value HTML-escaped first, then wrapped in `CDATA` whose content
has any `]]>` sequence split across two sections.

**Rationale**: Model descriptions are scraped from vendor pages, so they are
external data even though they reach us through our own database — the same
posture `README.md` already describes for the external JSON feed the site
consumes. Feed readers render item descriptions as HTML, so unescaped markup
from a vendor page would execute in a subscriber's reader (FR-016). The `]]>`
split guards the other failure: one such sequence in a description would
terminate the CDATA section early and corrupt the rest of the document.

**Alternatives considered**: Entity-escaping the whole body instead of using
CDATA — equally safe, but the raw feed becomes unreadable when debugging. A
sanitiser library — a dependency, and escaping is strictly safer than
sanitising here because no vendor markup needs to survive.

---

## R7 — Route placement, caching and filters

**Decision**: A single App Router route handler at `src/app/feed.xml/route.ts`,
`dynamic = 'force-dynamic'`, returning `content-type: application/rss+xml;
charset=utf-8` and `cache-control: public, s-maxage=1800,
stale-while-revalidate=86400`. Filters (`provider`, `type`, `limit`) are query
parameters. The query itself goes through the existing `cachedRead` wrapper
(`revalidate: 300`, tag `prices`).

**Rationale**: Filters make each subscription a distinct URL, and the CDN keys
its cache on the full URL, so every subscriber to a given feed shares one
cached document for 30 minutes — which is what satisfies SC-008/FR-021 without
per-subscriber state. `force-dynamic` also keeps the feed out of the build-time
prerender pass, which is where the documented connection-pool deadlock bit this
project before.

Two layers of caching is deliberate: the CDN layer absorbs subscriber polling,
and the `cachedRead` layer absorbs the rest (cold CDN, previews, tests), while
sharing the `prices` tag so a pipeline run invalidates the feed along with
everything else.

**Alternatives considered**:

- *Statically rendered with `revalidate` (as `/llms.txt` does).* Rejected only
  because it cannot express filters; the unfiltered feed alone would qualify.
- *Separate routes per provider* (`/providers/{slug}/feed.xml`). Rejected for
  now: more route surface for the same result, and it would need
  `generateStaticParams` to stay cached. Reconsider if per-provider feeds prove
  popular.
- *Rate-limiting the feed like `/api/v1/*`.* Rejected: readers poll on a fixed
  schedule and a 429 looks like a broken subscription. CDN caching already
  bounds the real cost.

---

## R8 — Behaviour on bad input and on failure

**Decision**: Unrecognised filters are ignored and the feed is still served
(FR-015). A failed catalog read returns `503` with a plain-text body, never an
empty `200` (FR-019). `rel="self"` echoes only the filters that were actually
honoured.

**Rationale**: A feed reader has no user interface for a `400` — it marks the
subscription broken and often stops polling. An empty but successful feed is
worse than an error, because readers interpret it as the publisher having
withdrawn everything. A `503` is understood as temporary and retried.

**Alternatives considered**: Validating strictly and returning `400`, as
`/api/v1/prices` does. Correct for an API consumed by a programmer who can read
the error; wrong for a document consumed by a background poller.

---

## R9 — Feed format and the initial-import flood

**Decision**: RSS 2.0 only. Default 50 most recent events, maximum 200.

**Rationale**: Confirmed from the live database — 221 models, of which 217
share the initial-import timestamp of 2026-08-11 and 84 have more than one
price-history row. Without a bound, the first fetch would hand a reader 217
simultaneous "new model" entries. Fifty is roughly a fortnight of real activity
at the current rate and is the conventional feed size; the flood recedes as
genuine events accumulate. Publishing only RSS (not Atom or JSON Feed) matches
the spec's assumption: one format that every reader accepts, and one format to
keep correct.

**Alternatives considered**: Suppressing pre-launch additions entirely —
rejected as dishonest, since those models genuinely are in the catalog and a
new subscriber benefits from seeing them; the bound alone solves the volume
problem.

---

## R10 — Testing without an XML parser

**Decision**: No parser dependency. Pure functions (title construction, delta
computation, RFC 822 formatting, escaping, guid derivation) are unit-tested
directly; the rendered document is asserted structurally — required channel
elements present, one `<item>` per event, guids unique, `pubDate` matching the
RFC 822 grammar, no unescaped `&` or stray `]]>`.

**Rationale**: The project has no XML parser and adding one to assert on our own
output is a poor trade. Splitting rendering into pure functions means the
interesting logic is testable without either a parser or a database, and the
document-level assertions catch the failures that actually matter. Full RSS
validation is done once, out of band, against the W3C validator (SC-002).

**Alternatives considered**: Adding `fast-xml-parser` as a dev dependency —
reconsider if the feed grows structurally complex; not warranted for a
flat channel of items.
