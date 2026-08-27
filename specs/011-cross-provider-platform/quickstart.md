# Quickstart: Cross-Provider Platform (Phases A–E)

## Prerequisites
`npm install` (no new deps), Docker `cot-pg` running, `.env.local` as today.

## 1. Migrate local schema
```sh
npm run db:push          # banner LOCAL; idempotent
```
Expect: canonical_models, monitoring_events, watchlist_subscriptions exist;
models has canonical_model_id/offer_tier/offer_region; providers has
provider_type.

## 2. Unit tests
```sh
npm test
```
New suites: resolve (rules, alias map, refuse-to-guess), offers comparison
(cheapest, workload ranking, missing-field handling), monitor (event
detection incl. cheapest_flip). DB suites skip without DATABASE_URL.

## 3. Pipeline end-to-end (LOCAL)
```sh
npm run pipeline:run
```
Expect: every provider green as before; openrouter appears as its own
provider (type router) with its catalogue as offers; run output/DB shows
canonical linking (unresolved count reported, none force-merged);
monitoring_events has offer_added rows for first-seen offers.

## 4. Multi-offer check
```sql
select cm.slug, count(*) offers from canonical_models cm
  join models m on m.canonical_model_id = cm.id and m.is_active
 group by cm.slug having count(*) > 1 order by offers desc limit 20;
```
Expect: deepseek/llama/qwen-family canonicals with ≥2 offers, and
cheapest_flip/price_change events appearing on subsequent runs when router
prices move.

## 5. Prod rollout (manual, in order)
1. `npm run db:push -- --remote`  (banner REMOTE — schema first, always)
2. Deploy code.
3. Next cron run backfills canonicals and starts writing events.
