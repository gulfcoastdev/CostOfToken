# Implementation Plan: Model Changelog Feed

**Branch**: `001-model-changelog-feed` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-model-changelog-feed/spec.md`

## Summary

Publish an RSS 2.0 feed at `/feed.xml` carrying two event kinds: a model
appearing in the catalog, and a tracked model's price moving.

No new data collection is needed. Both events are already recorded — a model's
first appearance is `models.created_at`, and every material price move is a
`price_history` row, written by a trigger that fires only when a value actually
changed. The feature is therefore a read model over existing tables plus a
renderer: one SQL query that unions the two event kinds into a single
time-ordered stream, a pure rendering module that turns events into RSS, and a
route handler that joins them and sets the right headers.

The one subtlety that shapes the query: the history trigger also fires on
insert, so a model's *first* history row coincides with its creation. That row
is excluded, otherwise every new model would announce itself twice — once as an
addition and once as a price change from nothing (FR-005).

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js runtime (ESM, `.ts` import specifiers)

**Primary Dependencies**: Next.js 15 App Router (route handler), `postgres` 3.4 (postgres.js). No new dependencies.

**Storage**: Supabase/Postgres — existing `models`, `providers`, `prices`, `price_history` tables. No schema change.

**Testing**: `node --test` via `tsx` (`npm test`), following `tests/*.test.ts`; database-backed suites skip cleanly when `DATABASE_URL` is unset.

**Target Platform**: Vercel serverless (Node runtime), behind the Vercel CDN.

**Project Type**: Web service + server-rendered site (Next.js App Router, single project).

**Performance Goals**: One catalog read per feed URL per 30 minutes regardless of subscriber count (SC-008); feed generation under 500 ms cold.

**Constraints**: Output must validate as RSS 2.0 with zero errors; no new npm dependencies; vendor-supplied text must render inert in readers; reads must not deadlock the shared connection pool (see the cached-read note below).

**Scale/Scope**: ~221 models, ~400 `price_history` rows today, growing by tens per day. Default 50 entries per feed, hard maximum 200.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against `.specify/memory/constitution.md` **v1.0.0** (ratified
2026-08-14). An earlier revision of this plan was checked against a stand-in
table of de-facto conventions, because the constitution was still an
uninstantiated template at the time; that table has been replaced by the real
gates below.

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Truthful Data Over Available Data** | PASS | The feed reports only recorded history; it never reconstructs events that predate the record. `0` renders "free" and `null` renders "not published" (FR-017). Launch prices come from the first history row so an old entry never quotes today's price under an old date (R3). Reseller-sourced rows carry the OpenRouter caveat (FR-018). No new writes at all — this feature is read-only. |
| **II. Test-First (NON-NEGOTIABLE)** | PASS *(binds tasks.md)* | Every behaviour below gets its test written and observed failing first. This is the gate that shapes task ordering: rendering units (titles, deltas, RFC 822, escaping, guids) before `src/lib/feed.ts`; query tests before `getFeedEvents`; route tests before the handler. See "Test-first ordering" below. |
| **III. Test the Layer Where the Fault Lives** | PASS | Three layers, matching the fault classes: pure functions unit-tested with no database; `getFeedEvents` tested against real Postgres (window-function correctness and ordering are not observable otherwise); the handler invoked with a real `Request` for status, `content-type` and filter handling. DB-backed tests skip without `DATABASE_URL` and read only that variable. |
| **IV. Decisions Are Documented Where They Live** | PASS | The three non-obvious choices carry their reason at the call site: why the first history row is excluded (double-announce), why the guid is not the model URL (collapsed entries), why RFC 822 is hand-formatted (`toUTCString` emits `GMT`; locales emit unknown month names). Full reasoning in `research.md`. |
| **V. Simplicity and Earned Dependencies** | PASS | Zero new dependencies — RSS by string building, no XML or feed library, no XML parser in tests (R10). Reuses `priceText`, `absoluteUrl`, `modelPath`, `formatContext` rather than restating price or URL formatting. One query, no per-entry round trip. |
| **VI. Public Surfaces Are Contracts** | PASS | `/feed.xml` is a permanent path with `/rss.xml` and `/feed` redirecting to it. Guids are built from immutable database ids and never change (FR-007). Channel `copyright` plus the ASCII `x-attribution-required` header carry the licence (FR-012). Non-ASCII (`→`, `—`) appears only in the UTF-8 body. Failure mode suits the consumer: a poller gets a valid document or an explicit `503`, never a silent empty success (FR-015, FR-019). |
| **VII. Untrusted Input Is Inert; Production Is Guarded** | PASS | Vendor descriptions are HTML-escaped and capped at 400 chars before rendering, so a reader shows markup as text (FR-016). `]]>` is split so a description cannot terminate a CDATA section. Filters are parameterised (`provider = any($1)`), never interpolated. `limit` is clamped before it reaches SQL. |

**Post-Phase 1 re-check**: PASS — no gate moved during design. Nothing in the
design requires a schema migration, a new dependency, a write path, or a second
database round trip per request.

### Test-first ordering (Principle II)

`tasks.md` MUST order each behaviour test-before-implementation, and each test
task MUST be marked as expected to fail on first run:

| Behaviour | Test task | Then implementation |
|-----------|-----------|---------------------|
| RFC 822 formatting, XML/HTML escaping, `]]>` splitting | `tests/feed.test.ts` | `src/lib/feed.ts` helpers |
| Delta computation and title construction (both kinds, null/zero/withdrawn) | `tests/feed.test.ts` | `priceDeltas`, `itemTitle` |
| Document structure, guid uniqueness and stability | `tests/feed.test.ts` | `renderRss` |
| Event derivation: first-row exclusion, ordering, filters | `tests/feed.test.ts` (DB-backed) | `getFeedEvents` |
| Status, `content-type`, bad-input tolerance, 503 | `tests/feed.test.ts` (DB-backed) | `src/app/feed.xml/route.ts` |

The first-row exclusion deserves its own failing test before the query exists:
it is the one rule whose absence produces plausible-looking output — two
entries per new model — rather than an error.

## Project Structure

### Documentation (this feature)

```text
specs/001-model-changelog-feed/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
├── contracts/
│   └── feed-endpoint.md # Phase 1 output — HTTP + RSS contract
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── feed.xml/
│   │   └── route.ts          # NEW — the feed endpoint; parses filters, sets headers
│   ├── layout.tsx            # EDIT — RSS auto-discovery via metadata.alternates.types
│   └── llms.txt/route.ts     # EDIT — list the feed among machine-readable surfaces
├── components/
│   └── site-chrome.tsx       # EDIT — footer link to the feed
└── lib/
    ├── feed.ts               # NEW — pure rendering: RSS document, titles, bodies, escaping
    ├── queries.ts            # EDIT — getFeedEvents + FeedEvent types
    ├── seo.ts                # reused as-is: absoluteUrl, modelPath, priceText
    └── format.ts             # reused as-is: formatContext

tests/
├── feed-fixtures.ts          # NEW — FeedEvent builder shared by the suites
├── feed.test.ts              # NEW — pure rendering; no database
├── feed-query.test.ts        # NEW — event derivation against real Postgres
└── feed-route.test.ts        # NEW — handler invoked with a real Request

next.config.ts                # EDIT — /rss.xml and /feed redirect to /feed.xml
README.md                     # EDIT — document the feed alongside the JSON API
```

**Structure Decision**: Single Next.js project, matching the existing layout —
data access in `src/lib/queries.ts`, pure logic in a sibling `src/lib` module,
HTTP concerns in an App Router route handler, tests flat in `tests/`. The
directory literally named `feed.xml` is how the App Router expresses a route
whose path contains a dot; the same technique already backs `/llms.txt` and
`/llms-full.txt`.

Splitting rendering (`src/lib/feed.ts`) from data access (`getFeedEvents`) is
what makes most of this feature testable without a database: titles, deltas,
date formatting and escaping are pure functions over a plain `FeedEvent`.

The three test files mirror the three fault layers of Principle III, matching
how the repo already separates `format.test.ts` (pure), `database.test.ts`
(real queries) and `api.test.ts` (real `Request`). Splitting them this way also
lets the failing-test tasks for different layers be written in parallel.

## Complexity Tracking

> No Constitution Check violations to justify. Table intentionally omitted.
