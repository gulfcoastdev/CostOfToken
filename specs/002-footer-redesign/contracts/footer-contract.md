# Contract: The site footer

The footer is a UI surface, so its contract is structural and semantic rather
than a wire format. Everything here is observable in the rendered HTML.

---

## Where it renders

Once, from the root layout — **not** per page.

```
<body>
  <SiteNav />          ← already in the layout
  {children}
  <SiteFooter />       ← moves here
  ...
</body>
```

**Guarantees**

- Every route that renders HTML ends with exactly **one** `<footer>`.
- That includes error and empty states (`SetupNotice`), which have none today.
- No page may render its own footer. Ten currently do; all ten stop.

The footer supplies its own container (`max-w-[1120px] px-5`) because it no
longer inherits one from `PageShell`.

---

## Document structure

```html
<footer>
  <nav aria-label="Footer">
    <h2>Prices</h2>          <!-- one per group -->
    <ul><li><a href="/">All models</a></li>…</ul>

    <h2>Developers</h2>
    <ul>…</ul>

    <h2>About</h2>
    <ul>…</ul>
  </nav>

  <p>…collection note, linking /sources…</p>
  <p>…confirm before committing spend…</p>
  <p>…licence and attribution…</p>
  <p>…trademarks / independence…</p>
  <p>© year · publisher · network · contact</p>
</footer>
```

**Requirements**

| # | Rule | Serves |
|---|------|--------|
| C1 | Exactly one `<footer>` landmark per page | FR-008 |
| C2 | Links live in a `<nav>` with an accessible name; disclosure prose sits outside it | FR-010 |
| C3 | Each group is a real heading followed by a `<ul>` — not styled `<div>`s | FR-010, SC-006 |
| C4 | Group headings are visible, not screen-reader-only | SC-002 |
| C5 | Every internal link is a real `<a href>`, crawlable without JavaScript | FR-012 |
| C6 | External links carry `rel="noopener"` | existing behaviour |
| C7 | No client JavaScript is shipped for the footer | Principle V |

---

## Responsive behaviour

| Width | Layout |
|-------|--------|
| < 640px | Groups stack in one column, in source order |
| ≥ 640px | Groups sit side by side across the available width |

**Guarantees**

- No horizontal scrolling at any width from **320px** upward (SC-005).
- Long labels wrap rather than overflow or truncate.
- Nothing is set to a fixed pixel width.

---

## Content contract

The rendered footer must contain, on every page:

**Navigation** — all twelve destinations in
[data-model.md](../data-model.md#the-inventory), grouped as specified.
`/compare` is present (it is absent today, FR-002).

**Disclosure** — five blocks: collection method and exclusions; confirm before
spending; licence and attribution; trademarks and independence; publisher and
contact.

**Nothing lost** — every destination and every disclosure listed in
[the frozen guard](../data-model.md#the-lose-nothing-guard) survives.

---

## Module contract

`src/components/footer-links.ts` exports the content model as data, so it can
be asserted without rendering:

```ts
export interface FooterLink {
  label: string
  href: string
  external?: boolean
}

export interface FooterGroup {
  heading: string
  links: FooterLink[]
}

export const FOOTER_GROUPS: readonly FooterGroup[]
```

**Invariants** (asserted in `tests/footer.test.ts`, written first):

1. Every `href` beginning `/` corresponds to a real route under `src/app`
2. No `href` repeats across groups
3. Every group has a non-empty heading and ≥1 link
4. Every frozen destination is present
5. `/compare` is present
6. The Developers group contains `/api/v1/prices`, `/feed.xml`,
   `/llms-full.txt` and `/llms.txt`

The module contains no JSX and imports nothing from React, so the test suite
loads it without a renderer.

---

## Out of scope

The top navigation, any new page, newsletter or social links, a back-to-top
control, and any change to licence or legal wording. See spec assumptions.
