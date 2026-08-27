# Quickstart: LLM Source-Recovery Judge

## 1. Migrate + tests
```sh
npm run db:push        # LOCAL: source_structures + 'llm' source kind
npm test               # incl. tests/recovery.test.ts (stubbed judge)
```

## 2. Forced recovery, live (LOCAL)
Break a parser deliberately and run one provider with the real DeepSeek
judge (OPEN_ROUTER_API_KEY required):
```sh
npx tsx -e "…runPipeline({ only: ['openai'], ctx: <fixture with renamed headers> })"
```
Expect: provider status ok with `recovered` populated; offers carry
source_kind 'llm'; a source_structures row for openai; `llm_recovery`
note in anomalies; a GitHub issue when GITHUB_TOKEN is set (dedup: second
run files nothing).

## 3. Healthy-run guard
`npm run pipeline:run` twice — zero recovery calls, zero memo writes,
provenance stays scrape/api.

## 4. Prod
1. `npm run db:push -- --remote` (schema first)
2. Deploy; set `GITHUB_TOKEN` + optionally `GITHUB_REPO`, keep
   `OPEN_ROUTER_API_KEY`; `ARBITER_MODEL` empty = DeepSeek default.
