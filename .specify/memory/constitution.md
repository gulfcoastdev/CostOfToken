<!--
SYNC IMPACT REPORT
==================
Version change: (uninstantiated template) → 1.0.0

Rationale: First ratification. Every principle in the shipped template was an
unreplaced [PRINCIPLE_N_NAME] placeholder, so this is an initial adoption
rather than an amendment. Principles are derived from conventions the codebase
already enforces (README.md, db/schema.sql, src/lib/*, tests/*), plus
Test-Driven Development, which the project owner has now made binding.

Modified principles: none (no prior principles existed).

Added sections:
  - Core Principles I–VII
  - Technology and Operational Constraints
  - Development Workflow and Quality Gates
  - Governance

Removed sections: none.

Templates requiring review for consistency:
  ✅ .specify/templates/plan-template.md — "Constitution Check" gate now has
     real content to evaluate against; no template edit required.
  ⚠  specs/001-model-changelog-feed/plan.md — its Constitution Check was
     written against a stand-in table of de-facto conventions while this file
     was still a template. Re-run the gate against these principles; the
     stand-in table maps onto Principles I, III, V, VI and VII, and the
     TDD ordering in Principle II is the item that genuinely changes its
     task plan.

Deferred TODOs: none. RATIFICATION_DATE is the date of this adoption; no
earlier governance document exists in the repository history.
-->

# CostOfToken Constitution

CostOfToken publishes LLM API pricing that other people make spending
decisions with. Everything below follows from that: a wrong number published
confidently is worse than a missing one, and a number nobody can verify is
worth little more.

## Core Principles

### I. Truthful Data Over Available Data (NON-NEGOTIABLE)

The catalogue MUST NOT contain a value the project cannot stand behind.

- A failed extraction MUST write nothing. The provider keeps its last
  known-good prices; yesterday's price beats a gap or a row of nulls.
- An extractor returning zero models MUST be treated as a failure, never as an
  empty catalogue.
- `0` and `null` MUST remain distinct everywhere — in the database, the API,
  the UI and every export. Zero is a real, free price; null is unknown.
- Values MUST NOT be invented, inferred from a name, or borrowed from a
  neighbouring row. A model with no published description has `null`; a
  context window with no exact-match source stays `null`.
- Prices MUST NOT be hand-editable. `data/overrides.ts` may patch metadata
  (context window, tags, display name) but never a price: a hand-edited price
  is indistinguishable from a fresh scrape and silently defeats freshness
  tracking. When a price is wrong, fix the extractor.
- Provenance MUST travel with the data. `source_kind` and `source_url` are
  part of every public representation, and reseller-sourced rows MUST carry
  that caveat wherever they are displayed.
- Bulk plausibility MUST be checked before writing, not only per row. A
  blocking anomaly writes nothing and records its finding.

**Rationale**: Every serious incident in this project's history was a
plausible-looking wrong number, not a crash — 80% of OpenAI's catalogue
silently dropped behind unselected tabs, every price reading exactly 2× because
a tier table shared a heading, `325 tokens` stored as $325/1M. None of these
raise an exception. Only a rule that treats silence as failure catches them.

### II. Test-First (NON-NEGOTIABLE)

Tests MUST be written before the implementation they describe, and MUST be
observed failing before they pass.

- The cycle is Red → Green → Refactor, strictly, for every new behaviour.
- Every bug fix MUST begin with a test that reproduces the bug and fails for
  the right reason. A fix without a failing-first test is incomplete.
- A test MUST fail for the reason it claims. Confirm the failure mode before
  writing the fix; a test that passes against unwritten code proves nothing.
- Where behaviour cannot be observed reliably, the *configuration* MUST be
  asserted instead — and the test MUST say why, in a comment.
- Tests MUST NOT be deleted or weakened to make a change pass. Amend the test
  deliberately, or amend the behaviour.

**Rationale**: A pool size of one serialised every concurrent render and took
the site down, yet a concurrency test still passed against it, because a local
database answers fast enough that even serialised reads finish instantly. That
fault is why configuration assertions are explicitly sanctioned here, and why
"write the test first and watch it fail" is the only reliable way to know a
test can fail at all.

### III. Test the Layer Where the Fault Lives

Unit tests alone MUST NOT be accepted as sufficient coverage for behaviour that
only exists through the real stack.

- **Parsing and pure logic** MUST be unit-tested directly. Logic that matters
  MUST be extracted out of components so it can be tested at all.
- **Database behaviour** MUST be tested against a real Postgres — shape,
  filtering, ordering, caching, and serialisation across the data cache.
- **HTTP behaviour** MUST be tested by invoking route handlers with a real
  `Request`, covering status, envelope, headers and parameter handling.
- Database- and route-backed suites MUST skip cleanly when `DATABASE_URL` is
  unset, so `npm test` works on a fresh clone.
- Test suites MUST read `DATABASE_URL` only, never `SUPABASE_DB_URL`, so the
  suite cannot reach production even when both are configured.

**Rationale**: The failures that reached production were invisible to unit
tests — a connection pool that deadlocked under concurrency, a cached function
awaiting another cached function, a `Map` that could not survive the data
cache, and a single non-ASCII character in an HTTP header that returned 500 for
every API call while the underlying query was perfectly healthy.

### IV. Decisions Are Documented Where They Live

Any choice whose naive alternative looks more obvious MUST carry its reason in
the code, next to the code.

- Comments MUST explain **why**, including what was tried and what broke.
  Restating what the code does is not documentation.
- A non-obvious constant, ordering, cache setting or pool size MUST say why it
  holds that value.
- README and `BACKLOG.md` MUST stay truthful about what is done, what is
  broken, and what is deliberately not built. A known gap stated plainly beats
  an undocumented one.

**Rationale**: Most rules in this codebase look arbitrary until you know the
incident behind them, and an undocumented rule gets "simplified" away by the
next person — including by an AI agent reading only the diff.

### V. Simplicity and Earned Dependencies

The simplest thing that is correct MUST be preferred, and a new dependency MUST
be justified against it.

- A new runtime dependency MUST be justified in the plan's Technical Context.
  Existing counterexamples are load-bearing: rate-limit counters live in
  Postgres rather than Redis, and structured output is built directly rather
  than through a serialisation library.
- Existing helpers MUST be reused rather than reimplemented — price formatting,
  URL construction and attribution have exactly one definition each.
- One formula per concept. Two formulas for the same displayed quantity is a
  defect, not a detail.
- Speculative generality MUST NOT be built. Features are added when a spec
  calls for them.

**Rationale**: A prototype shipped `(input+output)/2` on screen while ranking by
`input + 2×output`, which made the table look mis-sorted against its own
numbers. Duplication of a concept is how a product contradicts itself.

### VI. Public Surfaces Are Contracts

Anything a third party can consume MUST behave as a published contract.

- The `/api/v1` response envelope, field names and value conventions MUST NOT
  change incompatibly within a version. New fields are additive.
- Attribution and licence terms MUST travel in the payload and headers, not
  only in the docs.
- Identifiers exposed to consumers — API ids, canonical URLs, feed guids — MUST
  be stable for the life of the thing they name.
- A URL that ships MUST keep working. Moved paths get a permanent redirect.
- Machine-readable surfaces (JSON API, `llms.txt`, markdown dumps, JSON-LD,
  sitemap, feeds) MUST agree with the rendered page. Copy MUST be generated
  from the same data it describes so the two cannot drift.
- HTTP response headers MUST be ASCII-only.
- Failure modes MUST suit the consumer: a programmer-facing API rejects bad
  input loudly; a background poller receives a valid document or an explicit
  temporary failure, never a silent empty success.

**Rationale**: The point of this project is to be the source that gets cited.
A citation is only as good as the stability of what it points at.

### VII. Untrusted Input Is Inert; Production Is Guarded

All data from outside the process — vendor pages, third-party feeds, request
parameters — MUST be treated as hostile.

- External text MUST be length-capped and escaped for its destination before
  rendering. External URLs MUST be verified as `http(s)` before reaching an
  `href`.
- Values interpolated into SQL identifiers MUST come from a whitelist, never
  from user input.
- Secrets MUST be compared in constant time; mutation endpoints MUST be
  authenticated and excluded from crawling.
- Row Level Security MUST stay enabled on every table, so a leaked key cannot
  read or write directly.
- Protective middleware MUST fail open only where failing closed would be worse
  than the risk, and that choice MUST be documented at the call site.
- Local and remote databases MUST stay separable: `DATABASE_URL` is local,
  the remote lives under a distinct name, and reaching it requires an explicit
  `--remote` flag. Write commands MUST print `LOCAL` or `REMOTE` with the host
  before anything changes.

**Rationale**: Env files silently let the last duplicate key win, so one stray
`DATABASE_URL` would make every "local" command write to production. Separation
by name plus a loud target banner is what makes that mistake impossible rather
than merely unlikely.

## Technology and Operational Constraints

**Stack**: TypeScript on Next.js (App Router) with the Node runtime, Postgres
via `postgres.js`, deployed to Vercel. Tests run on `node --test` through
`tsx`. Schema changes go in `db/schema.sql` and MUST be idempotent — safe to
re-run against an already-deployed database, which means new view columns are
appended rather than inserted mid-list.

**Data access**: Reads live in `src/lib/queries.ts` and go through the shared
cached-read wrapper. A cached read MUST NOT await another cached read — that
deadlocks Next's data cache and the request never resolves. Values that cannot
survive cache serialisation (such as a `Map`) MUST be stored in a serialisable
form and rebuilt on the way out. Connection pool settings are load-bearing and
MUST NOT be reduced without evidence.

**Caching**: Data-backed pages are statically rendered with revalidation where
they can be; routes that vary by request are dynamic with explicit CDN
cache-control. Repeat public traffic MUST be servable without a per-request
database read.

**Scheduled work**: The daily pipeline runs per provider, sequentially, failing
independently. Partial success is success. A run MUST fit inside the platform's
free-tier duration ceiling, and a truncated run MUST leave untouched providers
on their last known-good prices.

**Comparability**: Prices are stored and published as USD per 1,000,000 tokens,
standard tier. Batch, Flex and Priority tiers are excluded rather than blended,
because comparing one vendor's batch rate against another's standard rate makes
the entire table wrong.

## Development Workflow and Quality Gates

**Spec Kit is the entry point.** New features and refactors MUST proceed
`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`.
Source files under `src/` MUST NOT be created or restructured directly from a
request. Trivial fixes and requested debugging are exempt.

**Plans MUST pass the Constitution Check** in `plan.md` before Phase 0, and be
re-checked after Phase 1 design. A violation MUST be either removed or
justified in the plan's Complexity Tracking table with the simpler alternative
named and the reason it was rejected.

**Task ordering MUST honour Principle II.** In `tasks.md`, the test task for a
behaviour MUST precede its implementation task, and MUST be marked as expected
to fail on first run.

**Gates before a change is considered done:**

1. `npm test` — passes, including the suites that require a database
2. `npm run typecheck` — clean
3. `npm run build` — succeeds
4. The feature's `quickstart.md` scenarios verified against a running app

Skipping a gate MUST be stated explicitly in the completion report, with the
reason. Reporting a change as complete when a gate did not run is a governance
violation, not a shortcut.

**Verification is empirical.** A change is "verified" only when it has been
observed working — a test run, a real request, a rendered page. Type-checking
is not verification.

## Governance

This constitution supersedes ad-hoc practice. Where a habit, a prior review
comment, or an agent's default behaviour conflicts with a principle here, the
principle wins.

**Amendments** MUST be made by editing this file, with the Sync Impact Report
at the top updated in the same change, and MUST state their rationale.
Amendments that change what is permitted take effect for work started after
them; work in flight is not retroactively invalidated, but SHOULD be
reconciled where cheap.

**Versioning** follows semantic versioning of the governance itself:

- **MAJOR** — a principle is removed, or redefined incompatibly with work done
  under the previous version
- **MINOR** — a principle or section is added, or guidance materially expanded
- **PATCH** — clarification, wording, or non-semantic refinement

**Compliance review**: every plan records its Constitution Check and every
completion report states which gates ran. Principles I and II are
non-negotiable — a change that violates either is rejected rather than
justified. Violations of the remaining principles MUST be recorded in
Complexity Tracking with the rejected simpler alternative.

**Runtime guidance** for day-to-day development lives in `README.md`
(collection, data model, API, tests) and `BACKLOG.md` (planned work). Those
describe how things are; this file describes what MUST hold.

**Version**: 1.0.0 | **Ratified**: 2026-08-14 | **Last Amended**: 2026-08-14
