repo: gulfcoastdev/CostOfToken
branch: main

## Last sync
date: 2026-08-11T02:31:11Z

### Updated in this project
- Built the designed comparison-table UI (page.tsx is still an unstyled placeholder in the repo) as a Design Component prototype
- Matched the app's data shape: provider/model/input/cached/output/context/source_kind fields, money() formatting convention, per-1M-token pricing
- Used realistic placeholder data for 18 models across the repo's 10 providers (real pipeline/DB not wired up in this pass)

## Screen map
| Project screen | Repo files referenced |
| --- | --- |
| LLM Pricing Tracker.dc.html | src/app/page.tsx, src/lib/types.ts, src/lib/queries.ts, data/overrides.ts, README.md |
