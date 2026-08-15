# Feature Specification: Footer Redesign

**Feature Branch**: `002-footer-redesign`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "Redesign the site footer: rework what it contains and how it is organized across all pages, so it works as real site navigation and disclosure rather than one flat row of links."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reach the rest of the site from the bottom of a page (Priority: P1)

Someone finishes reading a model page, a comparison, or the price table and
wants to go somewhere else. They look at the foot of the page and see the
site's destinations grouped by what they are for — browsing prices, running
the tools, understanding the data — rather than an undifferentiated line of
words they have to read end to end.

**Why this priority**: A footer's first job is navigation, and today's is a
single wrapping row of nine links in which the tool that answers most people's
real question (the calculator) has no more prominence than the terms page. It
is also incomplete: the comparison tool is reachable from the top nav but
absent from the footer entirely.

**Independent Test**: From the bottom of any page, confirm every significant
destination on the site is present, that related destinations are visually
grouped, and that each group's purpose is stated.

**Acceptance Scenarios**:

1. **Given** a reader at the foot of any page, **When** they scan the footer,
   **Then** links appear in labelled groups rather than one undifferentiated
   row.
2. **Given** the site's full set of reader-facing destinations, **When** the
   footer is inspected, **Then** every one of them appears — including the
   comparison tool, which is missing today.
3. **Given** a reader looking for a specific destination, **When** they read
   only the group headings, **Then** the heading tells them which group to look
   in without reading every link.

---

### User Story 2 - Judge whether to trust the numbers (Priority: P1)

Someone about to rely on a price wants to know where it came from, how fresh
it is, what it excludes, and who is publishing it. The footer is where that
disclosure belongs, because it is the one part of the page present no matter
what the reader was looking at.

**Why this priority**: The site's core claim is that its numbers are
comparable and current. The caveats that make that claim honest — daily
collection, reseller-sourced rows, standard tier only, confirm before
committing spend — must travel with every page, and they must remain legible
rather than being compressed into a wall of small grey text.

**Independent Test**: Read the footer alone and confirm it answers: where the
data comes from, how often it changes, what it deliberately excludes, who
publishes it, and under what terms it can be reused.

**Acceptance Scenarios**:

1. **Given** a reader on any page, **When** they read the footer, **Then** they
   learn how prices are collected, how often, and that non-standard tiers are
   excluded.
2. **Given** a reader considering reuse of the data, **When** they read the
   footer, **Then** the licence and the attribution requirement are stated with
   a route to the full terms.
3. **Given** a reader unsure whether the site is affiliated with a vendor,
   **When** they read the footer, **Then** the independence and trademark
   statement is present.
4. **Given** a reader who wants the underlying source, **When** they follow the
   disclosure, **Then** they reach the page explaining collection in full.

---

### User Story 3 - Find the machine-readable surfaces (Priority: P2)

A developer, or an AI crawler acting for one, wants the data rather than the
page: the JSON API, the markdown dump, the changelog feed. Today these sit
among human destinations with no indication that they are a different kind of
thing.

**Why this priority**: Being the cited source is an explicit goal of the
project, and these surfaces are how that happens. Grouping them is cheap and
makes the site's machine-readable offer legible at a glance — but the site
works without it, so it ranks below navigation and disclosure.

**Independent Test**: Confirm the footer presents the machine-readable
surfaces as one identifiable set, and that each is reachable from it.

**Acceptance Scenarios**:

1. **Given** a developer scanning the footer, **When** they look for
   programmatic access, **Then** the JSON API, the markdown rendering, the site
   index for language models, and the changelog feed appear together as one
   labelled group.
2. **Given** a reader who does not want any of that, **When** they scan the
   footer, **Then** the group is identifiable and skippable rather than mixed
   into the human navigation.

---

### User Story 4 - Use the footer on a phone (Priority: P2)

A reader on a narrow screen reaches the bottom of the page. The footer stays
readable and tappable rather than collapsing into a dense block of wrapped
links.

**Why this priority**: Mobile is a large share of readers, and the current
flat row wraps into an ambiguous block where it is unclear which links belong
together. Grouping helps here more than anywhere — but only if the groups
degrade sensibly on a narrow screen instead of becoming a long column of
headings.

**Independent Test**: View the footer at a phone width and confirm groups
remain distinguishable, tap targets are adequate, and no horizontal scrolling
is introduced.

**Acceptance Scenarios**:

1. **Given** a reader at a narrow viewport, **When** they reach the footer,
   **Then** groups remain visually distinct and no content is cut off or
   requires sideways scrolling.
2. **Given** a reader at a wide viewport, **When** they reach the footer,
   **Then** the groups use the available width rather than stacking in a single
   column.

---

### User Story 5 - See the same footer everywhere (Priority: P3)

Every page ends the same way, so the footer is somewhere a returning reader
learns to look.

**Why this priority**: Consistency is what makes the footer learnable, and the
site has already been bitten by this — the home page had its own separate
footer variant with a different set of links. Low priority only because it is
now a single component; the requirement is to keep it that way.

**Independent Test**: Visit every route type — home, provider, model,
comparison, calculator, static pages — and confirm the footer is identical.

**Acceptance Scenarios**:

1. **Given** any two pages on the site, **When** their footers are compared,
   **Then** they contain the same groups, links and disclosure.
2. **Given** a page that fails to load its data, **When** it renders its error
   state, **Then** the reader still has a route back into the site.

---

### Edge Cases

- **A page whose data fails to load.** The setup/error state currently renders
  no footer, leaving a reader on a dead end with no navigation at all.
- **A destination that does not yet exist.** The footer must not list a link
  that 404s; adding a page and adding its footer entry are one change.
- **Very narrow screens.** Group headings must not consume so much vertical
  space that the footer becomes a page of its own.
- **Reduced-width text zoom or long link labels.** Labels must wrap rather
  than overflow their group.
- **Assistive technology.** The footer is a navigation landmark with grouped
  lists, not a soup of anonymous links; group headings must be perceivable
  rather than purely visual.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The footer MUST present links in labelled groups organised by
  purpose, rather than as a single undifferentiated row.
- **FR-002**: The footer MUST include every reader-facing destination on the
  site, including the comparison tool, which is absent today.
- **FR-003**: The footer MUST group the machine-readable surfaces — the JSON
  API, the markdown rendering, the language-model site index, and the
  changelog feed — as one identifiable set.
- **FR-004**: The footer MUST state how prices are collected, how often they
  are refreshed, that reseller-sourced rows are marked as such, and that only
  the standard pricing tier is covered.
- **FR-005**: The footer MUST state the licence and the attribution
  requirement, with a route to the full terms.
- **FR-006**: The footer MUST state that the site is independent of the
  providers it lists and that model and company names are used descriptively.
- **FR-007**: The footer MUST identify the publisher and provide a contact
  route.
- **FR-008**: The footer MUST be identical on every page that renders one.
- **FR-009**: The footer MUST render on error and empty states, so a reader
  who lands on one is never left without navigation.
- **FR-010**: Group headings MUST be conveyed to assistive technology, not by
  visual styling alone, and the footer MUST be identifiable as a navigation
  landmark.
- **FR-011**: The footer MUST remain readable and usable from narrow phone
  widths through to wide desktop widths, without introducing horizontal
  scrolling at any width.
- **FR-012**: Every link in the footer MUST resolve to a page that exists.
- **FR-013**: The redesign MUST NOT remove any disclosure the current footer
  makes, and MUST NOT drop any destination it currently links to.
- **FR-014**: The footer MUST visually subordinate itself to page content —
  it is the end of the page, not a second homepage.

### Key Entities

- **Footer group**: A labelled set of related destinations. Has a heading that
  states what the group is for, and an ordered list of links.
- **Destination**: One reachable place on the site — a page, a data surface, or
  an external contact route. Has a label, a target, and the group it belongs
  to.
- **Disclosure**: Standing statements that travel with every page — how the
  data is collected and what it excludes, licence and attribution, publisher
  identity and independence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the site's reader-facing destinations are reachable from
  the footer of any page, verified against the site's own route list.
- **SC-002**: A reader can name which group a given destination belongs to by
  reading group headings alone, without reading individual links.
- **SC-003**: Every footer link resolves — zero broken links, verified across
  every listed destination.
- **SC-004**: The footer answers all five disclosure questions — source,
  frequency, exclusions, publisher, reuse terms — without leaving the page.
- **SC-005**: No page introduces horizontal scrolling at any viewport width
  from 320px upward because of the footer.
- **SC-006**: The footer is reachable and operable by keyboard alone, in a
  logical order, with every group heading announced by a screen reader.
- **SC-007**: Every page type on the site ends with an identical footer,
  including error and empty states.
- **SC-008**: No disclosure or destination present before the redesign is
  missing after it.

## Assumptions

- The footer's content is drawn from destinations and statements that already
  exist. This work does not create new pages, new policies, or new legal text;
  where wording is improved, the meaning is preserved.
- No newsletter signup, social profiles, or contact form are introduced. The
  project has no social presence to link, and an email contact already exists.
- The existing licence terms (free reuse with visible attribution) and the
  existing publisher identity are carried over unchanged.
- The top navigation is out of scope. It is a separate component with a
  different job, and changing both at once would make it impossible to tell
  which change moved which behaviour.
- The compact data-sources note that the price table used to render was
  already folded into the site footer, so this work starts from one footer
  rather than two.
- Visual design follows the site's existing look — the same restrained,
  light-background, text-first treatment used elsewhere. This is a
  reorganisation, not a rebrand.
- Search-engine considerations are secondary: the footer is for readers.
  Existing crawlable links must keep working, but no link is added purely for
  ranking.
