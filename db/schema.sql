-- CostOfToken — LLM pricing tracker schema
-- Target: Supabase Postgres 15+
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- providers
-- ---------------------------------------------------------------------------

create table if not exists providers (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  website      text,
  pricing_url  text,
  -- 'scrape'  = a working extractor reads the live pricing page
  -- 'catalog' = no machine-readable source yet; curated catalog is authoritative
  source_kind  text not null default 'catalog' check (source_kind in ('scrape', 'api', 'catalog')),
  region       text check (region in ('global', 'cn')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists providers_set_updated_at on providers;
create trigger providers_set_updated_at before update on providers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- models
-- ---------------------------------------------------------------------------

create table if not exists models (
  id                     uuid primary key default gen_random_uuid(),
  provider_id            uuid not null references providers(id) on delete cascade,
  model_id               text not null,          -- API identifier, e.g. 'claude-opus-4-5'
  display_name           text not null,
  context_window         integer check (context_window is null or context_window > 0),
  max_output_tokens      integer check (max_output_tokens is null or max_output_tokens > 0),
  long_context_threshold integer check (long_context_threshold is null or long_context_threshold > 0),
  modality               text[] not null default '{text}',   -- text | vision | audio | video | image
  tags                   text[] not null default '{}',       -- flagship | fast | reasoning | vision | open-weights
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (provider_id, model_id)
);

drop trigger if exists models_set_updated_at on models;
create trigger models_set_updated_at before update on models
  for each row execute function set_updated_at();

-- The position a model occupies on its provider's own pricing page. Vendors
-- list their newest and most important models first, so this is real editorial
-- signal that costs nothing to capture — and beats us guessing an importance
-- ranking from price alone.
alter table models add column if not exists source_rank integer;

-- A short prose summary of what the model is for, captured during extraction.
-- Prices say what a model costs; this is the only field that says what it is,
-- and it is the difference between a comparison page listing three rows of
-- numbers and one a reader can actually decide from.
alter table models add column if not exists description text;

-- ---------------------------------------------------------------------------
-- Classification: what kind of thing a model is.
--
-- Nullable on purpose. `model_type = null` means "not yet determined", which
-- is exactly what the older `modality` column cannot express — it has a
-- non-null default, so a guess and a fact look identical in it. Being able to
-- say "we don't know" is what stops this column going the same way.
--
-- `other` is different from null: it means determined, and none of the known
-- kinds.
alter table models add column if not exists model_type text
  check (model_type is null or model_type in (
    'chat', 'embedding', 'moderation', 'tts', 'asr',
    'image_gen', 'video_gen', 'ocr', 'realtime', 'other'
  ));

alter table models add column if not exists classification_status text not null default 'needs_review'
  check (classification_status in ('confirmed', 'needs_review'));

-- 'manual' is a human decision recorded in data/overrides.ts and is never
-- overwritten by a pipeline run.
alter table models add column if not exists classification_source text
  check (classification_source is null or classification_source in ('manual', 'derived'));

-- Why review is needed: which hint fired and why it was not trusted. Populated
-- whenever classification_status is 'needs_review', so the queue is actionable
-- without reopening the vendor's page.
alter table models add column if not exists classification_note text;

-- What the model accepts, produces and is notably good at. Recorded from a
-- declaring source or a human, never inferred. Null means unknown; an empty
-- object would wrongly imply the model has no capabilities.
alter table models add column if not exists capabilities jsonb;

-- A confirmed classification must actually say something.
alter table models drop constraint if exists models_classification_coherent;
alter table models add constraint models_classification_coherent
  check (classification_status <> 'confirmed' or model_type is not null);

create index if not exists models_type_idx on models (model_type) where is_active;
create index if not exists models_review_idx on models (classification_status)
  where classification_status = 'needs_review';

create index if not exists models_provider_idx on models (provider_id);
create index if not exists models_source_rank_idx on models (provider_id, source_rank);
create index if not exists models_active_idx   on models (is_active) where is_active;
create index if not exists models_tags_idx     on models using gin (tags);
create index if not exists models_modality_idx on models using gin (modality);

-- ---------------------------------------------------------------------------
-- prices — exactly one current row per model
-- ---------------------------------------------------------------------------

create table if not exists prices (
  id                      uuid primary key default gen_random_uuid(),
  model_id                uuid not null unique references models(id) on delete cascade,

  -- USD per 1M tokens. Standard (short-context) tier.
  input_price             numeric(12,6) check (input_price          is null or input_price          >= 0),
  cached_input_price      numeric(12,6) check (cached_input_price   is null or cached_input_price   >= 0),
  output_price            numeric(12,6) check (output_price         is null or output_price         >= 0),

  -- Long-context tier, applies above models.long_context_threshold.
  long_input_price        numeric(12,6) check (long_input_price        is null or long_input_price        >= 0),
  long_cached_input_price numeric(12,6) check (long_cached_input_price is null or long_cached_input_price >= 0),
  long_output_price       numeric(12,6) check (long_output_price       is null or long_output_price       >= 0),

  currency                text not null default 'USD',
  effective_date          date not null default current_date,
  source_url              text,
  -- How this row was produced, so a catalog fallback is never mistaken for a live scrape.
  source_kind             text not null default 'catalog' check (source_kind in ('scrape', 'api', 'catalog')),
  raw_data                jsonb,
  updated_at              timestamptz not null default now()
);

drop trigger if exists prices_set_updated_at on prices;
create trigger prices_set_updated_at before update on prices
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- price_history — append-only, written by trigger on material change only
-- ---------------------------------------------------------------------------

create table if not exists price_history (
  id                      bigserial primary key,
  model_id                uuid not null references models(id) on delete cascade,
  input_price             numeric(12,6),
  cached_input_price      numeric(12,6),
  output_price            numeric(12,6),
  long_input_price        numeric(12,6),
  long_cached_input_price numeric(12,6),
  long_output_price       numeric(12,6),
  currency                text not null default 'USD',
  effective_date          date,
  source_url              text,
  source_kind             text,
  recorded_at             timestamptz not null default now()
);

create index if not exists price_history_model_time_idx
  on price_history (model_id, recorded_at desc);

-- Record history only when a price field actually moved. A daily job that
-- re-scrapes identical numbers must not grow this table by one row per day.
create or replace function record_price_history() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and new.input_price             is not distinct from old.input_price
     and new.cached_input_price      is not distinct from old.cached_input_price
     and new.output_price            is not distinct from old.output_price
     and new.long_input_price        is not distinct from old.long_input_price
     and new.long_cached_input_price is not distinct from old.long_cached_input_price
     and new.long_output_price       is not distinct from old.long_output_price
     and new.currency                is not distinct from old.currency
  then
    return new;
  end if;

  insert into price_history (
    model_id, input_price, cached_input_price, output_price,
    long_input_price, long_cached_input_price, long_output_price,
    currency, effective_date, source_url, source_kind
  ) values (
    new.model_id, new.input_price, new.cached_input_price, new.output_price,
    new.long_input_price, new.long_cached_input_price, new.long_output_price,
    new.currency, new.effective_date, new.source_url, new.source_kind
  );
  return new;
end;
$$;

drop trigger if exists prices_record_history on prices;
create trigger prices_record_history after insert or update on prices
  for each row execute function record_price_history();

-- ---------------------------------------------------------------------------
-- extraction_runs — per-provider success/failure log for the daily job
-- ---------------------------------------------------------------------------

create table if not exists extraction_runs (
  id             bigserial primary key,
  run_id         uuid not null,                  -- groups all providers in one cron invocation
  provider_slug  text not null,
  status         text not null check (status in ('ok', 'partial', 'failed', 'skipped')),
  source_kind    text,
  models_found   integer not null default 0,
  models_changed integer not null default 0,
  duration_ms    integer,
  error          text,
  started_at     timestamptz not null default now()
);

create index if not exists extraction_runs_recent_idx on extraction_runs (started_at desc);
create index if not exists extraction_runs_run_idx    on extraction_runs (run_id);

-- 'blocked' means the extraction succeeded but anomaly detection rejected the
-- result, so nothing was written and the previous prices still stand.
alter table extraction_runs drop constraint if exists extraction_runs_status_check;
alter table extraction_runs add constraint extraction_runs_status_check
  check (status in ('ok', 'partial', 'failed', 'skipped', 'blocked'));

alter table extraction_runs add column if not exists anomalies jsonb;

-- ---------------------------------------------------------------------------
-- api_keys — optional, for raised rate limits
-- ---------------------------------------------------------------------------

create table if not exists api_keys (
  id          uuid primary key default gen_random_uuid(),
  key_hash    text not null unique,        -- sha256 hex of the presented key; plaintext never stored
  name        text not null,
  rate_limit  integer not null default 1000,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

-- ---------------------------------------------------------------------------
-- api_rate_limits — fixed-window counters (Postgres-backed, no Redis needed)
-- ---------------------------------------------------------------------------

create table if not exists api_rate_limits (
  subject      text not null,               -- 'ip:1.2.3.4' or 'key:<uuid>'
  window_start timestamptz not null,        -- truncated to the hour
  count        integer not null default 0,
  primary key (subject, window_start)
);

create index if not exists api_rate_limits_window_idx on api_rate_limits (window_start);

-- Atomically increment and return the new count for the current window.
create or replace function consume_rate_limit(p_subject text, p_window timestamptz)
returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  insert into api_rate_limits (subject, window_start, count)
  values (p_subject, p_window, 1)
  on conflict (subject, window_start)
    do update set count = api_rate_limits.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- v_current_prices — flattened read model for the public API and table
-- ---------------------------------------------------------------------------

create or replace view v_current_prices as
select
  p.slug                    as provider,
  p.name                    as provider_name,
  p.pricing_url             as provider_pricing_url,
  p.region                  as provider_region,
  m.id                      as model_uuid,
  m.model_id,
  m.display_name,
  m.context_window,
  m.max_output_tokens,
  m.long_context_threshold,
  m.modality,
  m.tags,
  m.is_active,
  pr.input_price,
  pr.cached_input_price,
  pr.output_price,
  pr.long_input_price,
  pr.long_cached_input_price,
  pr.long_output_price,
  pr.currency,
  pr.effective_date,
  pr.source_url,
  pr.source_kind,
  pr.updated_at,
  m.source_rank,
  -- Appended last on purpose: `create or replace view` can only add columns to
  -- the end of an existing view's list, so a new field placed mid-list would
  -- make this file fail to re-run against an already-deployed database.
  m.description,
  m.model_type,
  m.classification_status,
  m.capabilities
from models m
  join providers p on p.id = m.provider_id
  left join prices pr on pr.model_id = m.id;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- The app connects as the pooler role and does its own authorization, but RLS
-- is enabled so a leaked Supabase anon key cannot read/write these tables.
-- ---------------------------------------------------------------------------

alter table providers       enable row level security;
alter table models          enable row level security;
alter table prices          enable row level security;
alter table price_history   enable row level security;
alter table api_keys        enable row level security;
alter table api_rate_limits enable row level security;
alter table extraction_runs enable row level security;
