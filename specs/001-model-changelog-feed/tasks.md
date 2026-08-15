---

description: "Task list for the Model Changelog Feed"
---

# Tasks: Model Changelog Feed

**Input**: Design documents from `/specs/001-model-changelog-feed/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/feed-endpoint.md](./contracts/feed-endpoint.md),
[quickstart.md](./quickstart.md)

**Tests**: REQUIRED, not optional. Constitution v1.0.0 Principle II
(Test-First) is non-negotiable: for every behaviour below, the test task
precedes its implementation task and **MUST be observed failing for the right
reason** before the implementation is written. A task that says "MUST FAIL"
is not complete until you have run it and seen it fail.

**Organization**: Tasks are grouped by user story so each story can be
implemented, tested and shipped independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on incomplete work
- **[Story]**: US1–US4, mapping to the user stories in spec.md
- Exact file paths are given in every task

## Path Conventions

Single Next.js project at the repository root: `src/lib`, `src/app`,
`src/components`, `tests/`. Test files are split by fault layer, per
Constitution Principle III:

| File | Layer | Needs a database |
|------|-------|------------------|
| `tests/feed.test.ts` | Pure rendering — dates, escaping, titles, deltas, document | No |
| `tests/feed-query.test.ts` | Event derivation against real Postgres | Yes — skips without `DATABASE_URL` |
| `tests/feed-route.test.ts` | Route handler invoked with a real `Request` | Yes — skips without `DATABASE_URL` |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The type contract the tests are written against, plus fixtures.

Type declarations come before tests deliberately, and this is not a Principle
II violation: they declare no behaviour, so no test can fail on them. They are
the contract the failing tests are expressed in.

- [X] T001 Declare the feed read-model types in `src/lib/queries.ts` — `FeedEventKind`, `FEED_EVENT_KINDS`, `isFeedEventKind()`, `FeedPrices`, `FeedEvent`, `FeedFilters`, matching the field table in `data-model.md`
- [X] T002 [P] Create `tests/feed-fixtures.ts` exporting a `feedEvent(overrides?: Partial<FeedEvent>): FeedEvent` builder with sane defaults (Anthropic / claude-opus-5, input 5, output 25, context 200000, `sourceKind: 'scrape'`), following the local-builder style of `tests/cost.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Everything that is not specific to an event kind — date
formatting, escaping, and the RSS channel document itself.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Write failing tests for `rfc822()` in `tests/feed.test.ts` — asserts the RFC 822 grammar `Day, DD Mon YYYY HH:MM:SS +0000`, UTC conversion, a numeric offset rather than the literal `GMT`, and English day/month names when the process locale is set to a non-English one. **MUST FAIL**
- [X] T004 Write failing tests for escaping in `tests/feed.test.ts` — `escapeXml()` covers `& < > " '`; HTML escaping leaves vendor markup inert (`<img onerror=…>` → `&lt;img …`); `cdata()` splits an embedded `]]>` across two sections so the document is not truncated. **MUST FAIL**
- [X] T005 Implement `rfc822()`, `escapeXml()`, `escapeHtml()` and `cdata()` in `src/lib/feed.ts` to green T003–T004, with the file-level comment recording why RFC 822 is hand-formatted (research.md R5) and why escaping precedes CDATA (R6)
- [X] T006 Write failing tests for the channel document in `tests/feed.test.ts` — `renderRss({ events: [], … })` emits the XML declaration, `<rss version="2.0">` with the atom namespace, and the required channel children (`title`, `link`, `description`, `language`, `pubDate`, `lastBuildDate`, `ttl`, `generator`, `docs`, `copyright`, `atom:link rel="self"`); `pubDate` equals the newest event's date and falls back to build time when empty; `lastBuildDate` is build time. **MUST FAIL**
- [X] T007 Implement `renderRss()` in `src/lib/feed.ts` — channel head, item loop, injectable `builtAt` for testability
- [X] T008 Run `npm test` and `npm run typecheck`; both MUST pass before any user story begins

**Checkpoint**: `renderRss([])` produces a valid, empty RSS 2.0 document.

---

## Phase 3: User Story 1 - Learn about a new model without checking the site (Priority: P1) 🎯 MVP

**Goal**: `/feed.xml` serves entries for models newly added to the catalog,
each carrying provider, model, prices, context window and description.

**Independent Test**: Subscribe a reader to `/feed.xml`, add a model, and
confirm one entry appears naming the provider and model with its input and
output price and its description. Quickstart scenarios 1, 2, 3 and 5.

### Tests for User Story 1 ⚠️

- [X] T009 [P] [US1] Write failing database tests for `getFeedEvents()` in `tests/feed-query.test.ts` — skips without `DATABASE_URL` and reads only that variable (never `SUPABASE_DB_URL`); asserts every returned row matches the `FeedEvent` shape, that `model_added` events exist, that results are ordered `occurredAt` descending, that the `limit` is honoured, and that launch prices come from the model's first history row rather than the current `prices` row. **MUST FAIL**
- [X] T010 [US1] Write failing tests for addition titles in `tests/feed.test.ts` — `New model: Anthropic Claude Opus 5 — $5.00 in / $25.00 out per 1M tokens`; a model with no published price reads `pricing not published`; a `0` price reads `free`, never `$0.00` or blank. **MUST FAIL**
- [X] T011 [US1] Write failing tests for addition bodies and guids in `tests/feed.test.ts` — body contains the description, a price list omitting null tiers, the formatted context window, and a link to the model page; `itemGuid()` is `…/feed/model-added/{uuid}`, unique per event and unchanged when the title or prices change. **MUST FAIL**
- [X] T012 [P] [US1] Write failing route tests in `tests/feed-route.test.ts` — `GET /feed.xml` returns 200, `content-type: application/rss+xml; charset=utf-8`, `cache-control` containing `s-maxage=1800`, all header values ASCII-only, at least one `<item>`, and a 503 with a plain-text body when the catalog read throws. **MUST FAIL**

### Implementation for User Story 1

- [X] T013 [US1] Implement `getFeedEvents()` in `src/lib/queries.ts` — the `model_added` branch only (models ⋈ providers, `left join lateral` for the first history row, falling back to `prices`), the `cachedRead` wrapper (`revalidate: 300`, tag `prices`), record→`FeedEvent` mapping, and `order by occurred_at desc, kind asc, event_id desc`. Greens T009
- [X] T014 [US1] Implement `itemTitle()`, `itemDescription()`, `itemGuid()`, `priceList()` and `shortDescription()` (400-char cap) for the `model_added` branch in `src/lib/feed.ts`, reusing `priceText` from `src/lib/seo.ts` and `formatContext` from `src/lib/format.ts` rather than restating price formatting. Greens T010–T011
- [X] T015 [US1] Implement `src/app/feed.xml/route.ts` — `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, calls `getFeedEvents({ limit: 50 })`, renders via `renderRss`, sets the content-type, cache-control and ASCII `x-attribution-required` headers, and catches read failures into a 503 with `cache-control: no-store`. Greens T012
- [X] T016 [US1] Run quickstart scenarios 1, 2, 3 and 5 against `npm run dev`; confirm guid stability across two fetches and no duplicate guids

**Checkpoint**: A working feed of new models — shippable on its own.

---

## Phase 4: User Story 2 - Notice a price change on a model already in use (Priority: P1)

**Goal**: The feed also carries an entry for every recorded price move, stating
the previous value, the new value and the size of the change.

**Independent Test**: Record a price change and confirm one entry appears
stating both old and new price and the percentage. Quickstart scenarios 4 and 6.

### Tests for User Story 2 ⚠️

- [X] T017 [P] [US2] Write failing database tests for price-change derivation in `tests/feed-query.test.ts` — a model's **first** history row produces no `price_change` event (only the addition), a model with N history rows produces N−1 change events, `previous` is populated for changes and null for additions, and simultaneous moves across several price fields yield exactly one event. **MUST FAIL**
- [X] T018 [US2] Write failing tests for `priceDeltas()` in `tests/feed.test.ts` — one entry per field that moved and none for unchanged fields; `percent` is null when `from` is null or zero; a withdrawn price yields `to: null`; sub-1% moves round to 0 without being dropped. **MUST FAIL**
- [X] T019 [US2] Write failing tests for change titles and bodies in `tests/feed.test.ts` — `Anthropic Claude Opus 5: input down 67% to $5.00 per 1M tokens`; multi-field titles join with commas; more than three changed fields collapse to "and N more"; a withdrawn price reads `no longer published`; the body lists `$15.00 → $5.00 (-67%)` per field; a `sourceKind: 'api'` event carries the OpenRouter reseller caveat. **MUST FAIL**

### Implementation for User Story 2

- [X] T020 [US2] Extend `getFeedEvents()` in `src/lib/queries.ts` with the `hist` CTE — `row_number()` and `lag()` of each price column partitioned by `model_id` ordered by `(recorded_at, id)` — and union in the `price_change` branch filtered to `seq > 1` plus an `is distinct from` guard, with `null::numeric` casts for the five `prev_*` columns in the addition branch. Comment why the first row is excluded (double-announce). Greens T017
- [X] T021 [US2] Implement `priceDeltas()` and `describeDelta()` in `src/lib/feed.ts` over the fixed field order Input / Cached input / Output / Long-context input / Long-context output. Greens T018
- [X] T022 [US2] Implement the `price_change` branch of `itemTitle()` and `itemDescription()` plus `deltaList()` and the `<category>` mapping in `src/lib/feed.ts`. Greens T019
- [X] T023 [US2] Run quickstart scenarios 4 and 6; confirm no model shows both an addition and a change entry at the same timestamp

**Checkpoint**: Both event kinds live; the feed is feature-complete for P1.

---

## Phase 5: User Story 3 - Follow only the providers I care about (Priority: P2)

**Goal**: `provider`, `type` and `limit` narrow the feed, and bad input never
breaks a subscription.

**Independent Test**: Request a provider-limited feed and confirm every entry
belongs to it. Quickstart scenarios 7 and 8.

### Tests for User Story 3 ⚠️

- [X] T024 [P] [US3] Write failing database tests for filters in `tests/feed-query.test.ts` — `provider` accepts multiple slugs, `kind` restricts to one event type, an unknown provider returns an empty array rather than throwing, and `limit` is applied after filtering. **MUST FAIL**
- [X] T025 [P] [US3] Write failing route tests for parameters in `tests/feed-route.test.ts` — repeated and comma-separated `provider`; `type=model_added` excludes changes; `limit` defaults to 50, clamps at 200 and rejects non-integers by falling back to the default; `?limit=abc&type=bogus` still returns 200; an unknown provider returns a valid feed with zero items; `atom:link rel="self"` echoes only honoured filters; the channel title reflects the active filters. **MUST FAIL**

### Implementation for User Story 3

- [X] T026 [US3] Add the optional `provider = any($1)` and `kind = $2` predicates to `getFeedEvents()` in `src/lib/queries.ts`, parameterised — never interpolated (Constitution VII). Greens T024
- [X] T027 [US3] Implement parameter parsing in `src/app/feed.xml/route.ts` — split/trim/lower-case `provider`, validate `type` through `isFeedEventKind`, clamp `limit` to 1..200 before it reaches SQL, ignore anything unrecognised, and build the self URL and channel title from the honoured filters only. Greens T025
- [X] T028 [US3] Run quickstart scenarios 7 and 8

**Checkpoint**: Filtered subscriptions work; malformed ones degrade gracefully.

---

## Phase 6: User Story 4 - Discover the feed exists (Priority: P3)

**Goal**: A reader given only the site address finds the feed; a visitor sees a
link to it.

**Independent Test**: Point a reader at `http://localhost:3000/` and confirm it
offers the feed. Quickstart scenario 9.

- [X] T029 [P] [US4] Add RSS autodiscovery to `src/app/layout.tsx` via `metadata.alternates.types['application/rss+xml']`, titled "CostOfToken — new models and price changes"
- [X] T030 [P] [US4] Add a "Changelog feed" link to the footer nav in `src/components/site-chrome.tsx`, alongside the existing `llms.txt` link
- [X] T031 [P] [US4] List the feed under the "## Data" section of `src/app/llms.txt/route.ts` as a machine-readable surface
- [X] T032 [P] [US4] Add permanent redirects from `/rss.xml` and `/feed` to `/feed.xml` in `next.config.ts`, with a comment noting these are the paths readers guess
- [X] T033 [US4] Run quickstart scenario 9; confirm the `<link rel="alternate">` is present on a page other than the home page

**Checkpoint**: The feed is discoverable by humans, readers and crawlers.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T034 [P] Document the feed in `README.md` — a short section after "Public API" covering the address, the two event kinds, the filters and the guid-stability guarantee
- [X] T035 [P] Add a completed entry for the changelog feed to `BACKLOG.md`, matching the existing `- [x] **Title** — done` style
- [X] T036 Run quickstart scenario 10 — set a model description containing markup, confirm a reader shows it as text, then revert the row (Constitution VII)
- [X] T037 Run quickstart scenario 11 — stop `cot-pg`, confirm `/feed.xml` returns 503 rather than an empty 200, restart it. Do **not** leave the container stopped
- [X] T038 Run the full gate set: `npm test`, `npm run typecheck`, `npm run build` — all three MUST pass, and any skipped gate MUST be stated in the completion report
- [ ] T039 After deploying, validate the production `/feed.xml` with the W3C Feed Validator (zero errors, SC-002) and subscribe one real reader as a smoke test

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on T001 for types — BLOCKS every user story
- **US1 (Phase 3)**: depends on Foundational. No dependency on other stories
- **US2 (Phase 4)**: depends on Foundational; extends the query and renderer US1 created, so it runs after US1 in practice
- **US3 (Phase 5)**: depends on US1 (the route and query it filters)
- **US4 (Phase 6)**: depends on US1 only — the route must exist to be linked. Fully parallel with US2 and US3
- **Polish (Phase 7)**: depends on all shipped stories

### Within Each Story

- The test task MUST be written and **observed failing** before its implementation task
- Query before renderer before route — the route calls both
- Story complete and independently verified before moving to the next priority

### Parallel Opportunities

Same-file tasks are never marked `[P]`, which is why the pure-rendering tests
run sequentially: they all live in `tests/feed.test.ts`. Parallelism is
therefore mostly *across* the three test files and the source modules.

- **Phase 1**: T002 runs alongside T001
- **Phase 3**: T009 (`feed-query.test.ts`) and T012 (`feed-route.test.ts`) run alongside the `feed.test.ts` tasks T010–T011
- **Phase 5**: T024 and T025 are different files — run together
- **Phase 6**: T029–T032 touch four different files — all four run together
- **Phase 7**: T034 and T035 are different files

### Parallel Example: User Story 1

```bash
# Different files, no shared dependencies — write these failing tests together:
Task: "Database tests for getFeedEvents in tests/feed-query.test.ts"      # T009
Task: "Route tests for GET /feed.xml in tests/feed-route.test.ts"         # T012

# Then, in Phase 6, four independent discovery edits at once:
Task: "Autodiscovery in src/app/layout.tsx"                               # T029
Task: "Footer link in src/components/site-chrome.tsx"                     # T030
Task: "Feed entry in src/app/llms.txt/route.ts"                           # T031
Task: "Redirects in next.config.ts"                                       # T032
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 US1
2. **STOP and VALIDATE**: quickstart 1, 2, 3, 5 pass; the feed carries real
   new-model entries with stable guids
3. Shippable here — a changelog of new models is a complete product

### Incremental Delivery

1. Setup + Foundational → a valid empty document
2. **US1** → new-model entries → validate → ship (MVP)
3. **US2** → price-change entries → validate → ship (both P1 stories done)
4. **US3** → filtered subscriptions → validate → ship
5. **US4** → discovery → validate → ship

### Notes

- `[P]` means different files with no incomplete dependency
- Every "MUST FAIL" task requires actually running it and seeing the failure —
  a test that has never failed proves nothing (Constitution II)
- Commit after each task or logical group
- Do not stop `npm run dev` or the `cot-pg` container as cleanup
- Verification is empirical: a passing typecheck is not a verified feature
