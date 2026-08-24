# Quickstart: Validating the Modality-Grouped Pricing Fix

## Prerequisites

- `npm install` done; no database needed for the extractor tests.
- Optional (full-stack checks): Docker Desktop running the `cot-pg` container
  and `DATABASE_URL` set in `.env.local` (already the repo default).

## 1. Unit tests (the layer where the fault lives)

```sh
npm test
```

Expected: all suites green, including the new/amended cases in
`tests/extractors.test.ts` driven by
`tests/fixtures/openai-pricing-2026-08-22.md`:

- `gpt-realtime` → input 4, cached 0.4, output 16 (Text row, not Audio's 32/64)
- `gpt-audio` → input 2.5, output 10 (was 32 under the bug)
- `gpt-image-2` → input 5, cached 1.25, output null (Text row output is "-")
- `raw.modalities` for `gpt-realtime` holds 3 entries (audio, text, image)
  with parsed prices; `raw.headlineModality` is `"text"`
- Reversing the Audio/Text row order in a synthetic table changes nothing
- A plain (no Modality column) table still behaves first-listing-wins

## 2. Live-page spot check (no writes)

```sh
npx tsx scripts/inspect.ts openai
```

Expected against the real page: `gpt-realtime` `in=4.000 out=16.000`,
`gpt-realtime-mini` `in=0.600 out=2.400`, `gpt-audio-1.5` `in=2.500`,
and the overall model count still ≥ 65 (no models lost).

## 3. Local end-to-end (writes to LOCAL db only)

```sh
npm run pipeline:run    # banner must say LOCAL
npx tsx scripts/db-status.ts
```

Expected: openai models updated; the 14 realtime/audio models show text-token
rates with non-null output prices; a second consecutive run records zero new
`price_history` rows for them (FR-006).

## 4. Production rollout

Deploy as usual (no migration — no schema change). The next scheduled run
rewrites the 14 models back to text rates; the price-fault alert for that run
will legitimately report those changes once, then settle. Success criteria
SC-001…SC-005 in [spec.md](./spec.md) are checked against that run.
