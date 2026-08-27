# Research: LLM Source-Recovery Judge

## D1 — Recovery re-enters the normal pipeline, never bypasses it
High-confidence derivations become ordinary NormalizedModels
(`sourceKind: 'llm'`) fed through enrich → validate → anomaly gates →
arbiter-free upsert. Rationale: the safety net exists precisely for
plausible-wrong data; the LLM is the least-trusted source, so it gets the
most gates, not fewer. Rejected: writing derivations directly (bypass) or
a parallel storage path (duplication).

## D2 — DeepSeek default via the one OpenRouter client
`deepseek/deepseek-v4-pro` (operator's choice; id verified against our own
ingested OpenRouter catalogue). One env (`ARBITER_MODEL`) governs both 010
and 012 judges — two knobs would drift. Rejected: DeepSeek's first-party
API (second key, second client for no gain).

## D3 — Structure memo is judge-written prose in one table
`source_structures(provider_slug, structure, change_account, updated_at,
last_notified_at)`. It orients the next judge call and fills the issue
body; it is NOT a machine grammar (that would be rebuilding the parser in
YAML — the over-complicated-regex trap the operator named). Dedup rides
the same row (`last_notified_at`, 7-day window) instead of a second table.

## D4 — Failure-only engagement
Recovery runs only when extract threw / zero models / all invalid AND page
text was captured. Healthy day = zero calls (FR-005). Blocked-by-anomaly
is NOT recovery-eligible: the parser worked, the data was refused — a
different problem with an existing path (force). Fetch failure = nothing
to read = today's failure unchanged.

## D5 — Issues via one authenticated POST
`POST https://api.github.com/repos/{GITHUB_REPO}/issues` with
`GITHUB_TOKEN`, label `source-rework`; no SDK (Resend precedent). Failure
or missing token degrades to the alert email through the existing anomaly
channel (new codes `llm_recovery`, severity warn). GITHUB_REPO defaults to
`gulfcoastdev/CostOfToken`.

## D6 — 'llm' as a first-class source kind
Extends the existing enum ('scrape','api','catalog') in types + prices
check constraint + UI provenance strings. Rejected: overloading 'catalog'
(hides exactly the provenance the operator must see).

## D7 — Toward self-driving (explicitly future)
Next iteration candidates, out of scope now: judge-authored parser patches
as PRs attached to the rework issue; auto-closing the issue when the
parser succeeds again; structure memos written on healthy runs for drift
prediction. This iteration establishes the memory, the provenance channel,
and the ticket loop those will need.
