# Quickstart: Validating the LLM Price-Change Arbiter

## Prerequisites

- `npm install` (adds `@anthropic-ai/sdk`)
- Local DB (`cot-pg` Docker container) for end-to-end checks
- `ANTHROPIC_API_KEY` in `.env.local` to exercise the live judge; leave it
  unset to verify the off state

## 1. Unit tests

```sh
npm test
```

New suite `tests/arbiter.test.ts` must cover: diff logic (new models and
metadata-only changes excluded), hold/write application per verdict, the
2026-08-22 replay (evidence row says Audio → `misread` hold), every failure
mode in research.md D5 mapping to write-as-today + note, and the
`upsertProviderModels` hold filter (DB-backed, skips without DATABASE_URL).

## 2. Off state (no key)

```sh
ANTHROPIC_API_KEY= npm run pipeline:run
```

Expected: behaviour identical to today; if any provider had changes, its
result carries an `arbiter_note` anomaly saying unavailable (no key), and the
alert (if any) shows it. Zero calls made.

## 3. Live smoke test (LOCAL db)

With a key set, artificially create a change first (e.g. update one openai
price in the local DB), then:

```sh
npm run pipeline:run   # banner must say LOCAL
```

Expected: the run completes within normal time; the provider result carries
either an `arbiter_note` ("judged N real") or `arbiter_hold` entries; a held
model's price in the local DB still shows the pre-run value.

## 4. Duration guard

Compare run duration with and without changes; a no-change run must show no
added latency (arbiter not consulted).
