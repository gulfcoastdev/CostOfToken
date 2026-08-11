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

- [ ] **Filter by model type (text, vision, audio, …)**
      *Notes:* the modality filter exists on the home table and the API
      (`?modality=`). What is missing is modality filtering on provider pages
      and any landing page for a modality.

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

## Ongoing rules

1. **Only build dedicated pages for models and comparisons with real search or
   usage demand.** No speculative page farms.
2. **Free models must be clearly separated from paid rankings.**
3. **Ship one useful thing at a time.**
