# Phase 0 Research: Footer Redesign

No `NEEDS CLARIFICATION` markers survived the Technical Context — the stack is
fixed and the footer needs no data. The open questions were about structure,
semantics and how to test presentation honestly.

---

## R1 — Where does the footer get rendered?

**Decision**: Once, from the root layout, beside `SiteNav`. Every page's own
`<SiteFooter />` is removed.

**Rationale**: It is currently rendered by ten pages individually. That
repetition is not hypothetical debt — it has already failed twice. The home
page ended up with a different, smaller footer of its own, and the
error/empty state (`SetupNotice`) still renders none at all, so a reader who
lands on a failed page has no navigation out of it.

Moving it to the layout makes FR-008 (identical everywhere) and FR-009 (present
on error states) structural rather than something each new page has to
remember. It is also exactly how `SiteNav` already works, so the layout gains
no new concept.

**Alternatives considered**:

- *Keep per-page rendering and add a lint rule or a test that every page
  includes it.* Rejected: it enforces the repetition instead of removing it,
  and a test that greps page source is a proxy for the real property.
- *Keep it in `PageShell`.* Better than per-page, but `PageShell` is not used
  by the home page or the error state — the two places that were missing a
  footer. It would fix neither.

**Consequence to handle**: the footer currently sits *inside* `PageShell`, so
it inherits that container's width and padding. In the layout it needs its own
container matching `max-w-[1120px] px-5`, or it will run full-bleed against the
viewport edge on wide screens.

---

## R2 — What are the groups?

**Decision**: Three labelled groups, then a disclosure block, then a publisher
line.

| Group | Contains | Why it is a group |
|-------|----------|-------------------|
| **Prices** | All models, Providers, Compare, Calculator | The product surfaces — what a reader came for |
| **Developers** | API docs, JSON API, Changelog feed, `llms.txt`, Markdown table | Everything machine-readable, in one identifiable set (FR-003) |
| **About** | How prices are collected, About, Terms, Contact | Provenance, identity and the legal surface |

**Rationale**: Three groups fit a single row on desktop and stack cleanly on a
phone, and each heading answers "which group would that be in?" without
reading its links (SC-002). The split is by *reader intent* rather than by page
type, which is why the calculator sits with prices rather than with tools —
someone wanting a number does not think of it as a tool.

`/compare` is included, which fixes the concrete defect motivating the work:
it is reachable from the top navigation but absent from the footer today.

**Alternatives considered**:

- *Four or five groups* (splitting tools from prices, or legal from about).
  Rejected: with ~12 destinations, five groups average two links each, which
  reads as decoration rather than structure.
- *Two groups* (readers / developers). Rejected: it forces provenance and
  legal text under a heading that fits neither, and provenance is the thing
  this site most needs to be findable.

---

## R3 — Semantics and accessibility

**Decision**: One `<footer>` landmark containing a `<nav>` with an accessible
name, each group a heading followed by a `<ul>` of links, disclosure as
ordinary prose paragraphs outside the nav.

**Rationale**: Screen reader users navigate by landmark and by heading. A flat
row of anonymous links gives them neither — which is what exists today, and is
why FR-010 requires the grouping to be conveyed structurally rather than by
visual styling alone. Keeping the disclosure prose *outside* the `<nav>` matters
too: a navigation landmark stuffed with paragraphs is noise when a user jumps
to it expecting links.

Group headings are real headings rather than styled `<div>`s so they appear in
a heading-list navigation. They sit below the page's own content headings in
level.

**Alternatives considered**: `aria-label` on each list instead of visible
headings — rejected, because SC-002 wants a *sighted* reader to be able to pick
a group by its heading too. Visible headings serve both.

---

## R4 — Responsive behaviour

**Decision**: A CSS grid that is one column on narrow screens and three across
at the small breakpoint upward, using the site's existing Tailwind utilities.
No JavaScript, no width detection.

**Rationale**: Deciding layout in JavaScript would need the viewport during a
server render, which is the mistake the price explorer's comment already
documents (first paint wrong, then flips). CSS handles it. The site's existing
breakpoint conventions are reused rather than new ones invented.

FR-011 and SC-005 make the failure mode explicit: no horizontal scrolling from
320px up. Long labels wrap; nothing is set to a fixed width.

**Alternatives considered**: Collapsible accordion groups on mobile. Rejected
as unearned interactivity — the whole footer is roughly a dozen links, and a
tap to reveal a link list is worse than scrolling past it.

---

## R5 — What is *not* added

**Decision**: No newsletter signup, no social links, no site map page, no
"back to top" control, and no change to the top navigation.

**Rationale**: The spec's assumptions record the first two: there is no social
presence to link and no mailing list to join, so both would be placeholders.
The top navigation is excluded because changing two navigation surfaces at once
makes it impossible to attribute a behaviour change to either. YAGNI applies
(Principle V) — the footer's job is to work, not to grow.

---

## R6 — How presentation gets verified without a DOM test stack

**Decision**: Split the footer into a *content model* (a plain data module) and
a *renderer*. Unit-test the content model; verify the rendering empirically
through the quickstart, fetching real pages.

The content model tests are the ones that catch real regressions:

- every internal destination resolves to a route that exists, checked against
  the actual `src/app` tree rather than a hand-maintained list (FR-012, SC-003)
- every destination present before the redesign is still present, against a
  frozen list (FR-013, SC-008)
- required destinations are present, `/compare` named explicitly (FR-002)
- no duplicate targets; every group has a heading and at least one link

**Rationale**: The project has no jsdom, no Testing Library and no browser
runner, and adding one to assert that a `<ul>` contains an `<li>` would be a
large new dependency for weak coverage — Principle V. Meanwhile the faults that
have actually occurred in this area are all content-model faults: a missing
destination, a duplicated footer, a link to a page that moved. Those are
exactly what the data module makes testable.

This is the same move `src/lib/cost.ts` already represents in this codebase —
logic extracted out of a component *so that it can be tested at all*.

**Alternatives considered**:

- *Add jsdom + Testing Library.* Reconsider if the site grows genuinely
  interactive components that need it; not warranted for static markup.
- *Snapshot the rendered HTML of one page.* Rejected: it fails on every
  unrelated copy edit, which trains people to regenerate snapshots without
  reading them.

---

## R7 — Guarding "lose nothing"

**Decision**: Freeze today's footer inventory as an explicit constant in the
test file, and assert the new model is a superset.

**Rationale**: A redesign's characteristic failure is silent subtraction — a
caveat dropped because it did not fit the new layout, or a link lost in
regrouping. FR-013 and SC-008 exist for that reason, and an assertion against a
frozen list is the only way to hold it. The frozen list is deliberately in the
test rather than in the source, so deleting a destination requires deliberately
editing a list labelled "what we promised not to lose".

Today's inventory, for the record: All models (`/`), Providers (`/providers`),
Cost calculator (`/calculator`), Data sources (`/sources`), API (`/api-docs`),
About (`/about`), Terms (`/terms`), `llms.txt`, Changelog feed (`/feed.xml`),
plus the network link and contact email. Disclosure: the collection note with
its OpenRouter caveat and standard-tier exclusion, the "confirm before
committing spend" warning, the trademark/independence statement, and the
copyright line.
