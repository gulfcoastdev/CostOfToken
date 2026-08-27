# Data Model: LLM Source-Recovery Judge

```sql
-- Per-provider memory of what the source looks like, written only by
-- recoveries; last_notified_at drives the 7-day issue dedup window.
create table if not exists source_structures (
  provider_slug    text primary key,
  structure        text not null,          -- judge-written description
  change_account   text,                   -- what changed vs the prior memo
  updated_at       timestamptz not null default now(),
  last_notified_at timestamptz
);
alter table source_structures enable row level security;

-- 'llm' becomes a first-class provenance (drop/re-add, model_type pattern)
alter table prices drop constraint if exists prices_source_kind_check;
alter table prices add constraint prices_source_kind_check
  check (source_kind in ('scrape', 'api', 'catalog', 'llm'));
```

## TypeScript

- `SourceKind` union += `'llm'` (types.ts; SOURCE_KINDS array too).
- `RecoveryResult` (recovery.ts): `{ structure: string; structureChanged:
  boolean; changeAccount: string; confidence: 'high'|'low'; models:
  Array<{ modelId; displayName?; inputPrice; cachedInputPrice;
  outputPrice; currency? }> }` — zod-validated LLM output.
- `ProviderResult` gains `recovered?: { models: number; confidence: string }`.
- Anomaly codes += `'llm_recovery'` (warn) → alert email channel.
- `ChatJudge`-style shared fn in llm.ts: `openrouterChat(system, payload,
  jsonSchema) => Promise<unknown | null>`; arbiter and recovery both wrap it.

## Invariants

- Recovery writes pass validateModel + detectAnomalies; a blocking anomaly
  blocks the recovery write like any parse.
- Derived models absent from the page text are the judge's contract
  violation; the prompt forbids it and the replay test asserts page-driven
  ids only.
- `source_structures` rows are only written by recoveries (healthy runs
  never touch it) — SC-002 checks this.
