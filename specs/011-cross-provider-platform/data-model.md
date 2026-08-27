# Data Model: Cross-Provider Platform

All DDL additive and idempotent in `db/schema.sql`. RLS enabled on every new
table. `models` ≡ offers (see research D1).

```sql
-- providers: what kind of seller this is
alter table providers add column if not exists provider_type text not null default 'vendor'
  check (provider_type in ('vendor', 'cloud', 'router'));

-- canonical_models: the identity users follow
create table if not exists canonical_models (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,          -- public, immutable once created
  display_name text not null,
  family       text,                          -- e.g. 'llama', 'deepseek', 'gpt'
  model_type   text,                          -- same domain as models.model_type
  created_at   timestamptz not null default now()
);

-- models (offers): identity link + offer qualifiers
alter table models add column if not exists canonical_model_id uuid references canonical_models(id);
alter table models add column if not exists resolution_source text
  check (resolution_source is null or resolution_source in ('rule', 'alias', 'manual'));
alter table models add column if not exists resolution_note text;
alter table models add column if not exists offer_tier text not null default 'standard';
alter table models add column if not exists offer_region text;         -- null = global/default

-- monitoring_events: durable per-run detections
create table if not exists monitoring_events (
  id                 bigserial primary key,
  run_id             uuid not null,
  kind               text not null check (kind in
                       ('price_change', 'offer_added', 'offer_removed', 'cheapest_flip')),
  canonical_model_id uuid references canonical_models(id),
  model_id           uuid references models(id) on delete set null,  -- the offer
  details            jsonb not null default '{}'::jsonb,
  recorded_at        timestamptz not null default now()
);

-- watchlist_subscriptions: email-based follows (v1, no accounts)
create table if not exists watchlist_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  canonical_model_id uuid not null references canonical_models(id) on delete cascade,
  unsubscribe_hash   text not null,          -- sha256 of the token; plaintext only in the email
  created_at         timestamptz not null default now(),
  unique (email, canonical_model_id)
);
```

Indexes: `models(canonical_model_id)`, `monitoring_events(canonical_model_id,
recorded_at desc)`, `monitoring_events(run_id)`,
`watchlist_subscriptions(canonical_model_id)`.

## Semantics

- **Backfill**: resolver links every active offer; an offer with no
  confident canonical stays `canonical_model_id = null` + flagged via
  `resolution_note` (query: unresolved offers report).
- **cheapest_flip details**: `{ before: {providerSlug, modelId, inputPrice,
  outputPrice}, after {…}, workload: 'headline' }`.
- **price_change details**: mirrors the existing per-model before/after
  shape used by anomaly `details.models`.
- **History**: `price_history` untouched — already per offer.
- **Deactivation**: offer deactivation (existing `is_active`) triggers
  `offer_removed`; canonical rows are never deleted while offers reference
  them.
- **Comparison basis**: only `offer_tier = 'standard'` offers compete for
  cheapest; region-qualified offers compete with the qualifier displayed.

## TypeScript shapes (src/lib/types.ts additions)

```ts
type ProviderType = 'vendor' | 'cloud' | 'router'
interface CanonicalRef { id: string; slug: string; displayName: string }
interface Resolution { canonicalSlug: string | null; source: 'rule'|'alias'|null; note: string | null }
// NormalizedModel gains optional: canonicalSlug hint (adapter may suggest), offerTier, offerRegion
```
