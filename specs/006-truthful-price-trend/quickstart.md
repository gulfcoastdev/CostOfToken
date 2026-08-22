# Quickstart: Truthful Price Trend

**Feature**: 006-truthful-price-trend

Runnable checks that prove the feature works. Each scenario maps to a success criterion in
[spec.md](./spec.md). Run them in order; the later ones assume the earlier ones pass.

## Prerequisites

```bash
docker ps --format '{{.Names}}' | grep -q cot-pg   # local Postgres must be up
# if absent, Docker Desktop is probably closed — start it, the container auto-starts
```

`DATABASE_URL` comes from `.env.local` and points at the local container. The database-backed
suites skip cleanly without it, so a fresh clone still runs `npm test`.

**Do not point any of this at the remote database.** Reaching production requires an explicit
`--remote` flag; nothing here should carry one.

---

## S1. The gates

```bash
npm test
npm run typecheck
npm run build
```

All three must pass. `npm run build` runs `db:probe` first, which fails the build against a
database missing columns the code reads — expected to stay green, since this feature adds no
columns.

---

## S2. Tier detection reads the labels — SC-002

```bash
npx tsx --test tests/extractors.test.ts
```

Expected: tables whose tier is named only in preceding bare text are classified correctly.
Against the captured source document, the batch variants of the image, video and fine-tuning
tables and the fast-mode variant of the code-model table are all recognised as non-standard,
where today only the three tables with tier words in their own headings are.

The amended *"a repeated model keeps the first tier"* test must still pass, guarding its
original incident: the last table must never win.

---

## S3. Extraction is deterministic and order-independent — SC-001

```bash
npx tsx --test tests/extractors.test.ts
```

Expected: extracting twice from identical content yields identical records; extracting from
content whose tables are reordered yields identical records. This is the direct guard against
the 2026-08-11 flapping, where four runs in 30 minutes produced up to three different prices
per model against unchanged upstream content.

---

## S4. Incomparable rates are refused — SC-005

Expected, from the same suite: a model appearing only in fine-tuning tables is not recorded at
all, and a per-image or per-second rate is never recorded as a per-token price. Concretely,
`o4-mini-2025-04-16` (fine-tuning only) and `gpt-image-2` (per-image) must not appear with the
per-token rates they currently carry.

---

## S5. Mixed-direction tier shifts block the write — SC-003

```bash
npx tsx --test tests/anomaly.test.ts
```

Expected: a run where a quarter or more of a provider's models moved by exact tier-shaped
ratios is blocked, whether those ratios agree in direction or are mixed. A genuine repricing of
varied sizes is not blocked. Every existing anomaly test still passes.

---

## S6. The trend resists corrupted values — SC-004, SC-008

```bash
npx tsx --test tests/type-filter.test.ts
npm test
```

Expected: given a catalogue whose typical model is unchanged but where two expensive models
carry corrupted doubled values, the trend reports no material change. Against the stored
history this is the difference between the mean's `+0.14%` and the median's `0.00%`, where the
median agrees with the 10-down/8-up split of the movers.

Also expected: no `image_gen` or other non-token-priced model contributes to the series, and
the basket is identical at every sample point.

---

## S7. The card cannot contradict itself — SC-006, SC-007

```bash
npm run dev    # leave it running
```

Open the home page and read the trend card.

Expected:

- The line, the badge, and the two endpoint labels agree. A card whose badge reads flat and
  whose labels show the same value must not draw a pronounced rise.
- A sub-1% movement occupies a negligible share of the chart height; a movement of tens of
  percent is still clearly visible.
- The same holds for the small per-model indicator on the model cards.

**Expected with today's data**: the stored history spans 2026-08-11 to 2026-08-15, so a basket
fixed across a 90-day window will be empty or near-empty and the card should state that it
cannot tell rather than draw a line. That is the correct outcome, not a regression — it is
FR-017 doing its job, and it is what makes the out-of-scope "90-day axis over four days of
data" item resolve itself.

---

## S8. End to end against the real source — SC-001

```bash
npm run pipeline:dry
```

Dry run first: it must report which providers would write, and must not write. Confirm OpenAI
reports a plausible model count and no tier-shaped anomaly.

```bash
npm run pipeline:run     # writes to the LOCAL database
```

Confirm the command prints `LOCAL` and the local host before anything changes. Then run it a
second time:

```bash
npm run pipeline:run
```

Expected: the second run records **zero price changes**, because upstream has not moved. This
is the direct measurement of SC-001 and the closest thing to a reproduction of the original
defect — under the old code, repeated runs against unchanged content produced different prices.

---

## Known limitation to verify, not fix

Prices already stored between 2026-08-11 and 2026-08-15 are corrupted and are **not** repaired
by this feature. Until a clean run overwrites them, the trend reads partly from bad rows.
Confirm the fix prevents recurrence; do not expect the stored history to become correct. The
pipeline is also stale — nothing has recorded since 2026-08-15 — which is tracked separately in
`BACKLOG.md`.
