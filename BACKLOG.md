# Backlog

Working roadmap. Ordered by priority, not by effort.

---

## Priority 1 — Foundation & high-value wins

- [x] **Fix reliability issues (timeouts / caching)** — done in `bd8517e`.
      Cause was concurrent `unstable_cache` calls sharing one database
      connection, which deadlock silently. Home page reads now run in series;
      a nested cached call and a `Map` that could not survive the data cache
      were fixed with it. All pages now respond in ~0.2s warm.

- [x] **Workload calculator** — done, `/calculator`.
      Input tokens + output tokens × requests per day or month → ranked cost
      list.
      *Notes:* the model pages already have a static version of this (`What X
      costs in practice`), so the maths and formatting helpers exist. The new
      piece is making it interactive and ranking every model by the user's own
      workload rather than by list price. This is the feature most likely to
      make the site the one people bookmark, because it answers the question
      the table only approximates.

- [x] **Changelog feed (RSS)** — done, `/feed.xml`.
      New models and price changes as they are recorded, filterable by provider
      and event kind. Built through Spec Kit; spec, plan and contract live in
      `specs/001-model-changelog-feed/`.
      *Notes:* no new data collection — `models.created_at` and `price_history`
      already hold both event kinds. The subtlety is that the history trigger
      fires on insert too, so each model's first history row is excluded or
      every new model would announce itself twice. Item guids come from
      immutable database ids so a reader announces each event exactly once.
      *Not done:* model retirement produces no entry — the catalogue has no
      deactivation timestamp honest enough to date one with.

- [x] **Top compare pages** — done, both live.
      - `/compare/gpt-5.6-sol-vs-claude-opus-5`
      - `/compare/gpt-5.6-luna-vs-gemini-3.6-flash`
      *Notes:* keep this a bounded, hand-picked set. Generating every pairing
      would be ~46,000 near-identical pages, which search engines filter as
      thin content and which would drag the whole site's quality signal down.
      Each page needs something the table does not already say — cost at a
      realistic workload, context and modality differences, when to pick each.

- [x] **Clear API examples (JS, Python, curl) on the API docs page** — done.
      *Notes:* curl example is already there; JS and Python are missing. Worth
      showing the `meta.attribution` field in the response so integrators see
      the backlink requirement in the example itself.

- [ ] **Filter by model type (text, vision, audio, …)** — blocked on the data.
      *Notes:* the modality filter has been **removed from the UI**. Most values
      were inferred from model names by regex (`inferModality`) and were wrong
      often enough that filtering on them hid models that did qualify — worse
      than no filter. The column, the pipeline writes and the API `?modality=`
      parameter are all still there, so nothing has to be rebuilt; what is
      needed first is a source that *declares* modalities for every provider,
      not just OpenRouter and xAI. Re-enable the UI only after that.

- [x] **Build-your-own comparison** — done. `/compare` takes up to three models,
      shows specs side by side and prices them against three workloads. Ticking
      rows on the home table feeds it, and the selection lives in the URL so a
      comparison can be sent to someone. The curated `/compare/<a>-vs-<b>`
      pages stay — they carry editorial reasoning this cannot.

- [x] **Model descriptions** — done. `models.description`, captured from
      whichever source published one (OpenRouter's catalogue covers most, xAI's
      own catalogue the rest) and never generated. Shown on model pages, in the
      expanded row, and on the comparison page; searchable from the home table.
      An extraction run that finds no description leaves the stored one alone.

- [x] **Mobile overhaul** — done in `ecdfc18`.
      A nine-column table forced sideways into a 390px viewport. Fixed with a
      different presentation rather than a narrower table.

      1. **Cards instead of a wide table** — main list and Popular models,
         below `sm`. Name, provider dot, labelled input / output / blended,
         context, star, and badges (Free, Best value, Flagship, modality,
         Via OpenRouter).
      2. **Input and output always visible** — the whole point. Output used to
         sit off the right edge in both places.
      3. **Modality is pills, not a `<select>`**; sort lives in the pinned
         compact bar; provider pills collapse behind a disclosure that is
         forced open whenever a provider is selected.
      4. **Cards | Table toggle**, remembered in localStorage, defaulting to
         `auto` — resolved by CSS at the breakpoint, not by JS. The table keeps
         its frozen `#` and Model columns.
      5. **44px tap targets**, three-across averages, collapsible
         "What that buys you".

      Nav scrolls instead of wrapping, and Calculator is outlined.

      *Kept honest by:* `model-card.tsx` owns the card, the badges and the
      expanded detail block, and the table row renders that same detail
      component — so the two views cannot drift on best value or source.

      *Still open:* nothing renders these components in a test. The whole
      mobile path is verified by hand only — see "Page render tests" below,
      which this makes materially more valuable than it was.

---

## Priority 2 — SEO & useful pages

- [ ] **Cheapest pages, with free models handled honestly**
      - `/cheapest-llm-api`
      - `/cheapest-coding-models`
      - `/cheapest-vision-models`
      Free models in their own section first, then a ranked list of the
      cheapest **paid** models.
      *Notes:* this rule already exists in the home table — the three Zhipu
      GLM-Flash models are `$0` and are badged Free and excluded from "Best
      value" ranking, because otherwise they own it permanently. Reuse that
      logic rather than reinventing it. Tag coverage needs checking first:
      `coding` and `vision` tags are inferred from model names, so a
      "cheapest coding models" page is only as good as that inference.

- [ ] **Price history pages, only where there is real demand**
      Start with current and previous-generation flagships.
      *Notes:* history only accumulates as the daily job observes changes, so
      these pages are thin until the data builds up. `/api/v1/history/:id`
      already serves the data and model pages already show a table when more
      than one point exists.

- [ ] **Basic price-change alerts (email)**
      *Notes:* `price_history` already records every genuine change, and the
      cron already knows what changed in a run, so the detection half is done.
      The new parts are subscriber storage, an email sender, and unsubscribe
      handling.

---

## Priority 3 — Monetization prep

- [ ] **Keep the core table and basic current API free**

- [ ] **Design a simple Pro tier** — higher rate limits, full history, alerts.
      *Notes:* the `api_keys` table already carries a per-key `rate_limit`, and
      the limiter already honours it, so raised limits are close to working.
      Billing, key issuance and a self-serve page are not built.

- [ ] **Track which models and endpoints get the most usage**
      To decide which pages are worth building.
      *Notes:* this is what decides the "only build what has demand" rule
      below, so it gates most of Priority 2. Analytics covers page demand;
      API endpoint usage is not recorded yet.

---

## Test coverage gaps

The suite covers parsing, cost logic, database reads and API routes. Named here
so the gaps are not mistaken for coverage. None of these are urgent; each is
worth doing when the surface it protects starts changing often.

- [ ] **Page render tests**
      Nothing renders a page and asserts on the output. A broken table, a
      missing price column or a page that throws during render would reach
      production. Needs a running server or a React test renderer; Playwright
      against `next start` would also cover the client behaviour that has no
      tests at all — sorting, filtering, pinning, the calculator inputs.

- [ ] **Write-path tests for the pipeline**
      The upsert, the history trigger and anomaly detection are only ever
      verified by hand against a live database. Their logic is covered
      (`tests/anomaly.test.ts`), but nothing checks that a run actually writes
      what it should, that unchanged prices add no history rows, or that a
      blocked provider leaves existing prices untouched. Wants a disposable
      database per run — the Docker container in the README is the obvious
      fixture.

- [ ] **Cron route tests**
      Auth is verified by hand only. Worth covering: a wrong secret returns
      401, a blocked provider returns 409, an all-failed run returns 502, and
      cache invalidation fires only when something changed.

- [ ] **Extractors against live vendor pages**
      Extractors are tested against fixtures, deliberately: a vendor editing
      their page should not turn CI red. The cost is that a layout change
      surfaces in production first, caught by anomaly detection rather than by
      a test. A scheduled job that runs the extractors against the real pages
      and reports — separately from CI, and never blocking a deploy — would
      close that gap without making the build depend on someone else's website.

- [ ] **Fixture drift**
      The HTML and markdown fixtures in the extractor tests are hand-written
      approximations of vendor pages. If a vendor's real structure drifts far
      enough, the tests keep passing against a shape that no longer exists.
      Capturing periodic real snapshots would keep them honest.

---

## Operational hardening

- [ ] **Turn on Attack Challenge Mode** — Vercel → Project → Firewall.
      Available on Hobby, free, one toggle. It stops distributed abuse *at the
      edge*, before a request ever reaches a function — the layer application
      code cannot provide. The per-IP limit in the app is trivially sidestepped
      by a proxy pool or an IPv6 range, and the site-wide ceiling only bounds
      the damage after the fact; this prevents the traffic arriving.
      *Not a code change — it needs someone in the dashboard.*

      Context: on a free plan the risk is not a bill. Neither Vercel Hobby nor
      Supabase's free tier can charge. Exceeding fair use gets the project
      **paused**, so the failure mode is the site going dark without warning.

- [ ] **Reconsider the limiter failing open**
      If the counter query errors, every request passes unlimited. That is
      deliberate — a limiter that 500s takes the API down with it — but it
      removes protection exactly when the database is already struggling.
      A short in-memory fallback count per instance would narrow the window.

- [ ] **Sliding window instead of fixed**
      Windows align to the hour, so 60 requests at 10:59:59 plus 60 at
      11:00:00 is 120 in two seconds and entirely within the rules. Acceptable
      for a backstop; worth fixing if real abuse ever appears.

- [ ] **Rate limit or cache-protect the pages, not just the API**
      Only the four `/api/v1/*` routes are gated. Pages rely entirely on CDN
      caching — which is effective, but once an entry expires a crawler
      sweeping 216 model pages goes straight to the database. That is close to
      what took the site down during development.

---

## Ongoing rules

1. **Only build dedicated pages for models and comparisons with real search or
   usage demand.** No speculative page farms.
2. **Free models must be clearly separated from paid rankings.**
3. **Ship one useful thing at a time.**
