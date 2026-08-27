# Backlog

Working roadmap. Ordered by priority, not by effort.

---

## Priority 0 — Cross-provider platform (spec 011, in progress)

- [x] **Phases A–E: data model, resolver, OpenRouter adapter, comparison,
      monitoring** — done. `models` rows are offers; `canonical_models`
      identity sits above them (314 canonicals, 474 linked offers, 87%
      auto-resolved, rest flagged). OpenRouter ingests as a router provider
      (323 offers). `monitoring_events` records price_change / offer_added /
      offer_removed / cheapest_flip per run. NOT YET DEPLOYED — prod needs
      `npm run db:push -- --remote` before this code ships.
- [ ] **Phase C2+: remaining adapters** — Together, Fireworks, Groq,
      DeepInfra, Cerebras, Mistral, Cohere (source research each), then
      Azure/Bedrock/Vertex as curated catalog sources with region qualifiers.
- [ ] **Phase F: alert engine** — watchlist subscriptions (schema exists),
      event fan-out, weekly digest, unsubscribe route.
- [ ] **Phase G: public API** — additive canonical/offers fields + new
      endpoints; /api/v1 stays byte-compatible.
- [ ] **Phase H: web app** — canonical model pages with offer tables,
      cheapest callout, calculator over offers, watch UI. Last by mandate.
- [x] **LLM source-recovery judge (spec 012)** — done, not yet deployed.
      Parser fails → DeepSeek derives prices from the fetched page (written
      with `llm` provenance through the full anomaly gates, never
      deactivating underived models), remembers the source structure in
      `source_structures`, and files a deduped GitHub `source-rework` issue
      (GITHUB_TOKEN) or notes it in the alert. Healthy runs cost zero LLM
      calls. *Self-driving next steps (research.md D7):* judge-authored
      parser-fix PRs attached to the issue; auto-close on parser success;
      drift prediction from healthy-run memos.
- [ ] **GitHub issue filing for source rework** — deferred by operator
      ("let's do email instead"). `createGitHubPoster` in
      src/pipeline/github.ts is built and tested but unwired; rework
      notices currently email the alert address. To enable: wire the
      GitHub poster (or chain email + issue), add a fine-grained
      GITHUB_TOKEN (Issues: read/write on this repo) + optional
      GITHUB_REPO to Vercel, and restore the two vars in .env.example.
- [ ] **Resolver review flow** — 71 unlinked long-tail offers (aion-labs,
      ibm-granite, bytedance-seed, …); extend VENDOR_PREFIXES or add
      aliases after human review; consider a `resolve:review` script like
      classify:review.

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

- [x] **Model type classification** — done.
      Every model carries a `model_type`; the table and calculator default to
      chat, so a moderation endpoint is no longer the 4th cheapest model on the
      site. Rules refuse to guess: a name hint must be corroborated by the
      pricing shape, or the model is flagged. `npm run classify:review`.
      *Notes:* 16 of 17 flagged models resolved from first-party sources;
      `glm-ocr` deliberately still flagged. The public API default is
      unchanged — type is additive and the filter opt-in.
      *Next:* capability derivation is deliberately not built. OpenAI states a
      modality column in its own pricing table and Google describes models in
      prose; an extractor could capture those as declared evidence instead of
      relying on the name/price heuristic.

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

- [x] **Filter by model type** — done, shipped with `model_type`.
      The table and calculator default to `general`; embeddings, moderation,
      TTS, ASR, image, video, OCR and realtime models are one control away and
      labelled as not price-comparable. See "Model types" in the README.
      *Still open, and deliberately separate:* the **modality** filter remains
      removed from the UI. Those values were inferred from model names by regex
      (`inferModality`) and were wrong often enough that filtering on them hid
      models that did qualify — worse than no filter. `model_type` replaces it
      for the "what kind of thing is this" question, but per-model
      *capabilities* (vision, tool use, audio in/out) still need a source that
      **declares** them. Two candidates found while doing 003: OpenAI states a
      modality in its own pricing table's second column (`| gpt-image-1 |
      Image | … |`) and Google describes each model in prose. Capturing those
      in the extractors would give declared evidence instead of a guess.

- [ ] **Quality leaderboards and rankings** — the missing half of "is it worth
      it". The site answers what a model costs and says nothing about whether
      it is any good, so it cannot rank by value, cannot answer "which models
      are good at coding", and cannot show cost-per-quality — which is the
      comparison people actually want.

      *Blocked on licensing, not on effort.* Artificial Analysis is out: their
      free and Pro tiers forbid commercial redistribution. **BenchLM** is the
      preferred source and its data is exactly the right shape —
      `GET https://benchlm.ai/api/data/leaderboard?mode=bench-align-v5` returns
      `overallScore` plus `categoryScores` for agentic, coding, reasoning,
      multimodalGrounded, knowledge, multilingual, instructionFollowing and
      math, with `evidenceStatus` and a methodology version.

      But their terms grant only *"read, link to, quote with attribution, and
      use published downloads **under any license stated with that data**"* —
      and no licence is stated with the data. The payload carries no licence,
      terms, copyright or attribution field. Ingesting it nightly and serving
      it through our own pages and API is closer to republishing a dataset than
      to quoting, which is the same line Artificial Analysis draws.

      *Resolve one of these before building anything:*
      - written permission from BenchLM to redistribute with attribution
      - a stated licence we have not found
      - a decision to treat it as quoting: prominent per-score credit and link,
        no exposure through `/api/v1`, no bulk re-export
      - a different source — Arena Elo via the Hugging Face dataset, which
        carries an explicit licence

      *Other caveats found:* the free export covers **50 models against our
      226**, it keys on display names ("Claude Mythos 5") so matching to our
      `model_id`s is fuzzy work, and **13 of the 50 scores are `estimated`
      rather than `supported`** — which has to be surfaced, not presented as
      measured.

      *Design note:* build against a source-agnostic interface so the ranking
      feature does not hard-code one vendor. Scores are only comparable within
      a `model_type`, so 003 is a prerequisite and is now done.

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

- [ ] **tts-1 / tts-1-hd store a per-character rate as a per-token price**
      Their cells read "$15.00 / 1M characters" — the unit lives in the cell,
      not the header, so `isTokenPricingTable` cannot see it and the value
      enters as $15/1M tokens. Pre-existing before `009-openai-modality-pricing`
      and deliberately left out of its scope (research.md D4); needs cell-level
      unit detection or exclusion of per-character rows.

- [ ] **Restate the price history corrupted between 2026-08-11 and 2026-08-15**
      Left deliberately undone by `006-truthful-price-trend`, which fixed the
      cause but not the record. During that window the OpenAI extractor read
      whichever pricing tier's table happened to come first, so 73 of 74 models
      recorded two or three different prices — batch, fast-mode and fine-tuning
      rates stored as standard per-token prices. Those rows are still in
      `price_history` and still feed anything that reads the past.

      *Why it was not done with the fix.* Deleting published history is not
      obviously right: the rows are a true record of what we recorded, just not
      of what OpenAI charged. Restating them means choosing a correct value for
      a date we never observed correctly, which is inventing data — the thing
      Principle I forbids. Deleting them loses the audit trail of the incident.
      Someone has to decide which is worse; the code cannot.

      *Scope when picked up.* Affects `price_history` rows for provider
      `openai` between those dates. The trend basket already excludes anything
      back-filled, so the blended trend is not reading them today, but the
      per-model sparklines and `changeCount` are.

- [ ] **Redraw the price trend from whatever points exist** — *card is hidden
      until this is done* (`SHOW_TREND_CARD` in `src/components/price-explorer.tsx`).

      The current implementation is overbuilt. It asks for a 90-day window, then
      requires a large enough basket of models each holding a real observation at
      *every* sample point, and reports "not enough price history" whenever that
      fails — which, with a price record that began 2026-08-11, is most of the
      time. A statistic that usually declines to answer is not a feature.

      Two observations are a line. Draw the line between the points that exist,
      label it with the span it covers, and stop there. No minimum basket, no
      fixed-membership requirement, no insufficiency state beyond "we have fewer
      than two points".

      *Keep three things from the current version*, each of which is there for a
      reason and cost real debugging to find:

      - **Median, not mean.** The card once reported prices rising 0.14% while
        the median was unchanged and movers split 10 down against 8 up. The
        distribution is strongly right-skewed — median 0.68 against mean 3.96 —
        so a mean never described the typical model.
      - **Token-priced types only.** An image-generation model, priced per image,
        was once the largest single contributor to a *token* price trend.
      - **The floored chart scale** in `src/lib/chart-scale.ts`. Without it a
        0.14% movement is drawn as a full-height climb, contradicting the card's
        own badge and its own endpoint labels.

      *Do not reintroduce back-fill.* Padding a model's series with its earliest
      known price is an assumption, and averaging assumptions into a market
      statistic is how the original wrong number was produced. Drawing fewer,
      real points is the fix; inventing points to fill a window is not.

      The machinery to delete or simplify lives in `src/lib/trend.ts`
      (`TREND_MIN_BASKET`, the fixed-basket filter, the `insufficient` result)
      and the `backfilled` field in `src/lib/queries.ts`. `tests/trend.test.ts`
      encodes the current behaviour and will need amending with it.

- [ ] **A manual pipeline run neither notifies nor refreshes the site**
      `npm run pipeline:run` calls `runPipeline` directly, bypassing
      `/api/cron/update-prices`. That route is where `revalidateTag`/
      `revalidatePath` live, and now where price alerts are sent from, so a
      CLI run does neither.

      This is not theoretical: on 2026-08-22 a manual run corrected production
      prices and the published site served the old numbers for 30 minutes,
      until the caches expired on their own. The RSS feed served stale items
      for the same reason.

      Keeping the notifier at the route boundary is deliberate — the CLI must
      not email on every local run — so the fix is not "move it into
      runPipeline". Options: a `--notify` flag, or having the CLI hit the cron
      route with `CRON_SECRET` instead of calling the pipeline directly. The
      second is probably right: one path, one set of side effects.

- [ ] **Alert when the daily pipeline stops running**
      Nothing currently notices if the cron stops firing. The site's entire
      claim is up-to-date pricing, so silent staleness is the failure that
      matters most, and it is the one failure no existing check covers.

      *Read the right signal.* `price_history` going quiet is **not** a
      symptom — the trigger only writes when a number actually moves, so days
      of silence there are normal and correct. The field that proves a run
      happened is `prices.updated_at`, which bumps every run because the
      upsert always rewrites `raw_data` and `effective_date`. Monitoring the
      wrong one of these produces false alarms; it already did once.

      *What is already covered.* `/api/cron/update-prices` returns 502 when
      every provider failed, 409 when anomaly detection blocked a result, and
      500 on a crash. Those are non-2xx invocations and land in Vercel's logs.
      Whether anything actually *notifies* on them depends on project
      notification settings — unconfirmed, worth checking in the dashboard
      before building anything.

      *The real blind spot.* None of that fires if the cron simply never runs:
      a paused project, a `vercel.json` that did not deploy, a plan limit, a
      rotated `CRON_SECRET`. All of those produce **silence**, and silence is
      currently indistinguishable from success.

      *Shape of the fix.* A dead-man's switch — alert on the absence of a
      fresh run rather than on a failure event. The watcher has to live
      outside Vercel, or it shares the failure mode it is meant to catch: the
      cron route pings an external service on each success and that service
      raises the alarm when a ping fails to arrive. A cheaper partial is a
      staleness banner on `/sources` when the newest `prices.updated_at` is
      more than ~36h old, but that only helps if someone looks.

      *State when filed (2026-08-19):* production healthy, last run
      2026-08-18 06:50 UTC, 226 models. This is preventive, not a live fire.


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
