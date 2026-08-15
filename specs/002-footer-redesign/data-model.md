# Phase 1 Data Model: Footer Redesign

**No database involvement.** The footer issues no queries. "Data model" here
means the authored content model that `src/components/footer-links.ts` exports
and `SiteFooter` renders — the thing that makes this feature testable.

---

## `FooterLink`

One reachable destination.

| Field | Type | Notes |
|-------|------|-------|
| `label` | `string` | What the reader sees. Sentence case, no trailing punctuation |
| `href` | `string` | Internal path (`/compare`) or absolute URL (contact, network) |
| `external` | `boolean` (optional) | True for off-site targets; renders with `rel="noopener"` and opens in a new tab, matching existing footer behaviour |

**Rules**

- An `href` starting with `/` MUST correspond to a route that exists under
  `src/app` — a `page.tsx` for pages, a `route.ts` for data surfaces.
- No `href` may appear twice anywhere in the footer.
- `label` MUST be non-empty and MUST NOT duplicate another label in the same
  group.

---

## `FooterGroup`

A labelled set of related destinations.

| Field | Type | Notes |
|-------|------|-------|
| `heading` | `string` | Names the group's purpose; must let a reader pick the group without reading its links (SC-002) |
| `links` | `FooterLink[]` | At least one; ordered most-used first |

---

## The inventory

Three groups, twelve destinations. Every entry is a page or surface that
already exists — this feature creates none.

### Prices

| Label | Target | Note |
|-------|--------|------|
| All models | `/` | |
| Providers | `/providers` | |
| Compare models | `/compare` | **New to the footer** — the defect in FR-002 |
| Cost calculator | `/calculator` | |

### Developers

| Label | Target | Note |
|-------|--------|------|
| API documentation | `/api-docs` | |
| Prices JSON | `/api/v1/prices` | The endpoint itself, not just its docs |
| Changelog feed (RSS) | `/feed.xml` | |
| Pricing table (markdown) | `/llms-full.txt` | **New to the footer** |
| llms.txt | `/llms.txt` | |

### About

| Label | Target | Note |
|-------|--------|------|
| How prices are collected | `/sources` | Relabelled from "Data sources" — states what the page answers |
| About | `/about` | |
| Terms | `/terms` | |
| Contact | `mailto:` | External; carried over |

---

## Disclosure

Standing prose, rendered outside the navigation landmark (research R3). Not a
list of links — these are statements the site is obliged to make on every page.

| Block | Content | Source |
|-------|---------|--------|
| **Collection** | Read daily from first-party pricing pages where machine-readable, OpenRouter catalogue otherwise (marked *Via OpenRouter* — a reseller, whose prices can differ from the vendor's own). Standard tier only; batch and priority excluded. Links to `/sources`. | Existing footer, meaning preserved |
| **Caution** | Always confirm against the provider before committing spend. | Existing footer, verbatim |
| **Independence** | Model and company names are trademarks of their respective owners, used descriptively. CostOfToken is independent and not affiliated with any provider listed. | Existing footer, verbatim |
| **Licence** | Free to reuse, including commercially, with a visible credit linking back. ODC-BY 1.0. | Currently only in `/llms.txt` and API responses — **added**, per FR-005 |
| **Publisher** | © year, Gulf Coast Dev LLC, network link, contact email. | Existing footer, meaning preserved |

The licence line is the one genuinely new statement. It is not a new claim:
the API has always returned it in `meta.attribution` and asserted it in an
`X-Attribution-Required` header. FR-005 puts it where a human reading the page
can see it.

---

## The "lose nothing" guard

A frozen list of every destination and disclosure the footer carried before
this feature, asserted as a subset of the new model (research R7, FR-013,
SC-008).

| Frozen destination | Survives as |
|--------------------|-------------|
| `/` "All models" | Prices → All models |
| `/providers` | Prices → Providers |
| `/calculator` | Prices → Cost calculator |
| `/sources` | About → How prices are collected |
| `/api-docs` | Developers → API documentation |
| `/about` | About → About |
| `/terms` | About → Terms |
| `/llms.txt` | Developers → llms.txt |
| `/feed.xml` | Developers → Changelog feed |
| network URL | Publisher line |
| contact email | About → Contact, and publisher line |

Frozen disclosure: collection note, OpenRouter caveat, standard-tier
exclusion, confirm-before-spending warning, trademark/independence statement,
copyright line. Each must still be present, by meaning rather than by exact
string — the test asserts on distinctive phrases, not whole paragraphs, so
copy can be improved without the guard becoming a copy-freeze.

---

## Validation rules, collected

These are what `tests/footer.test.ts` asserts, before the module exists:

1. Every internal `href` resolves to a route present under `src/app`.
2. No `href` appears more than once across all groups.
3. Every group has a non-empty heading and at least one link.
4. Every frozen destination is still present.
5. `/compare` is present (FR-002, named explicitly because it is the defect).
6. The Developers group contains all four machine-readable surfaces (FR-003).
7. Every distinctive disclosure phrase is still present (FR-013).
