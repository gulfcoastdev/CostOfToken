# Implementation Plan: Footer Redesign

**Branch**: `002-footer-redesign` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-footer-redesign/spec.md`

## Summary

Turn the footer from one flat row of nine links into grouped navigation plus
disclosure, and make it structurally impossible for a page to be missing it.

Two changes carry the feature:

1. **Separate the footer's content from its presentation.** The list of groups
   and destinations becomes a plain data module; the component renders it. That
   is what makes the interesting properties testable without a DOM test stack —
   completeness, no duplicates, no broken targets, nothing lost in the
   redesign — which is the only way Principle II applies to a component like
   this.
2. **Render the footer once, from the root layout.** It is currently rendered
   by each of ten pages individually, which is exactly how the home page ended
   up without one and how the error state still has none. Moving it beside
   `SiteNav` in the layout satisfies FR-008 and FR-009 by construction rather
   than by vigilance.

The visual work — three labelled groups, a disclosure block, a publisher
line — follows from those two.

## Technical Context

**Language/Version**: TypeScript 5.7, React 19, Next.js 15 App Router (Server Components)

**Primary Dependencies**: Tailwind CSS v4 (via `@tailwindcss/postcss`; `globals.css` is a bare `@import 'tailwindcss'` with no custom token layer). No new dependencies.

**Storage**: None. The footer is static content; it issues no queries.

**Testing**: `node --test` via `tsx`. The repo has no DOM/component test layer, and this plan does not add one — see research R6.

**Target Platform**: Vercel serverless, server-rendered HTML; readers on phone through desktop.

**Project Type**: Server-rendered site (single Next.js project).

**Performance Goals**: No measurable change. The footer is static markup in a Server Component and adds no client JavaScript.

**Constraints**: No horizontal scrolling at any width from 320px up; keyboard-operable in logical order; group headings perceivable by assistive technology; every listed destination must resolve; no disclosure or destination lost relative to today's footer.

**Scale/Scope**: One component, one data module, one layout change, ten pages to strip a duplicate render from. ~12 destinations across 3 groups.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against `.specify/memory/constitution.md` **v1.0.0**.

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Truthful Data Over Available Data** | PASS | The footer is where the site's honesty about its own data lives. The redesign preserves every existing caveat verbatim in meaning — daily collection, reseller rows marked, standard tier only, confirm before committing spend — and FR-013/SC-008 make "lose nothing" a checked requirement rather than an intention. No new claim is invented. |
| **II. Test-First (NON-NEGOTIABLE)** | PASS *(shapes the design)* | Extracting the content model into a data module is what makes this testable at all: completeness against the real route list, no duplicate targets, required destinations present, and a regression guard listing every pre-redesign destination. Those tests are written and observed failing before the module exists. Presentation is verified empirically per quickstart, and research R6 records why that split is honest rather than convenient. |
| **III. Test the Layer Where the Fault Lives** | PASS | The fault that actually occurred — a page silently missing its footer — is not a unit-testable fault, so it is fixed structurally (render once from the layout) and verified by fetching every route type. Link-target correctness is checked against the filesystem route list, which is where that fault lives. |
| **IV. Decisions Are Documented Where They Live** | PASS | The layout move carries the "ten pages each rendered their own, and one forgot" reason at the call site; the data module carries why content is separated from presentation. |
| **V. Simplicity and Earned Dependencies** | PASS | Zero new dependencies, no DOM test stack, no CSS framework additions, no client JavaScript. One component, one data module. Existing helpers and the site's existing visual language are reused rather than restated. |
| **VI. Public Surfaces Are Contracts** | PASS | Every URL the current footer links to keeps working — this only changes where links are grouped, never their targets. The machine-readable surfaces (JSON API, `/llms.txt`, `/llms-full.txt`, `/feed.xml`) become *more* discoverable, which is the stated goal for those surfaces. |
| **VII. Untrusted Input Is Inert; Production Is Guarded** | PASS | No external input reaches the footer. All targets are authored constants; no user or vendor data is interpolated. Not applicable beyond that. |

**Post-Phase 1 re-check**: PASS — no gate moved during design. Nothing here
requires a schema change, a dependency, a query, or client JavaScript.

### Test-first ordering (Principle II)

`tasks.md` MUST order each behaviour test-before-implementation:

| Behaviour | Test task | Then implementation |
|-----------|-----------|---------------------|
| Every internal destination resolves to a real route | `tests/footer.test.ts` scanning `src/app` | `src/components/footer-links.ts` |
| Nothing lost: every pre-redesign destination still present | `tests/footer.test.ts` frozen list | same module |
| Required destinations present (`/compare` chief among them) | `tests/footer.test.ts` | same module |
| No duplicate targets, every group has a heading and ≥1 link | `tests/footer.test.ts` | same module |

## Project Structure

### Documentation (this feature)

```text
specs/002-footer-redesign/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
├── contracts/
│   └── footer-contract.md  # Phase 1 output — structure, semantics, responsive
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── layout.tsx            # EDIT — render SiteFooter once, beside SiteNav
│   ├── page.tsx              # EDIT — drop its own SiteFooter render
│   ├── about/page.tsx        # EDIT ┐
│   ├── api-docs/page.tsx     # EDIT │
│   ├── calculator/page.tsx   # EDIT │ same one-line removal
│   ├── compare/page.tsx      # EDIT │ on each of the ten pages
│   ├── compare/[pair]/page.tsx           # EDIT │
│   ├── models/[provider]/[model]/page.tsx # EDIT │
│   ├── providers/page.tsx    # EDIT │
│   ├── providers/[slug]/page.tsx # EDIT │
│   ├── sources/page.tsx      # EDIT │
│   └── terms/page.tsx        # EDIT ┘
└── components/
    ├── footer-links.ts       # NEW — groups, destinations, disclosure copy
    └── site-chrome.tsx       # EDIT — SiteFooter renders the data model

tests/
└── footer.test.ts            # NEW — content-model tests, no DOM required
```

**Structure Decision**: Single Next.js project, following the split the repo
already uses — pure logic in a plain module (`src/lib/cost.ts` is the
precedent, extracted from a component precisely so it could be tested),
presentation in the component, page chrome in the layout.

`footer-links.ts` sits in `components/` rather than `lib/` because it is
presentation content — labels and groupings — not domain logic.

### Dependency on unmerged work

This plan assumes `footer-on-home-page` is merged: it removed the price
explorer's separate inline footer and gave the home page the shared one. If
that branch is dropped instead, the layout move in this feature supersedes it
and the explorer's inline footer must still be deleted.

## Complexity Tracking

> No Constitution Check violations to justify. Table intentionally omitted.
