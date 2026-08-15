# Quickstart: Validating Model Classification

Scenarios map to acceptance criteria in [spec.md](./spec.md); rules are in
[data-model.md](./data-model.md#rule-table).

## Prerequisites

```bash
docker start cot-pg
npm run db:push          # applies the additive columns; idempotent
npm run pipeline:run     # classifies as it writes
npm run dev
```

---

## 1. Automated checks

```bash
npm test
npm run typecheck
```

**Expect**: rule precedence, the awkward real-world fixtures, whole-catalogue
coverage, and the API default-response guard all pass.

## 2. The bug is actually fixed

```bash
curl -s 'http://localhost:3000/api/v1/prices?limit=25&sort=input&order=asc' |
  python3 -c "
import json,sys
for r in json.load(sys.stdin)['data']:
    print(f\"{r['model_id']:<34} {r.get('model_type')}\")"
```

**Expect**: no `embedding`, `moderation`, `ocr`, `tts`, `realtime`,
`image_gen` or `video_gen` in the cheapest 25. Before this change,
`omni-moderation-latest` was 4th. (SC-001)

## 3. Every model is typed or flagged

```bash
docker exec -i cot-pg psql "$LOCAL_DB" -c "
select classification_status, model_type, count(*)
  from models where is_active group by 1,2 order by 3 desc;"
```

**Expect**: no row with `classification_status = 'confirmed'` and a null
`model_type`. Roughly 193 `chat`, 15 confirmed non-chat, 17 flagged. (SC-002)

## 4. Nothing was deleted

```bash
docker exec -i cot-pg psql "$LOCAL_DB" -t -c "select count(*) from models where is_active;"
for m in gpt-image-1 gemini-embedding glm-ocr omni-moderation-latest; do
  printf '%s → ' "$m"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/models/openai/$m"
done
```

**Expect**: the same active count as before the run, and every model page still
resolves (use each model's real provider in the path). (SC-004, FR-011)

## 5. Non-chat models are still reachable

Open the main table, switch the type control to Embeddings.

**Expect**: embedding models listed with prices, compared only against each
other, with a note that their pricing is not comparable to chat models.
(US2, FR-009, FR-010)

## 6. Searching for a hidden model tells you where it is

Search the main table for `text-embedding-3-small` while the default chat
filter is applied.

**Expect**: a message that the model exists under another type, not an empty
result. (FR-012, SC-008)

## 7. The API contract did not move

```bash
curl -s 'http://localhost:3000/api/v1/prices?limit=500' |
  python3 -c "import json,sys; d=json.load(sys.stdin); print('total:', d['meta']['total'])"
curl -s 'http://localhost:3000/api/v1/prices?type=embedding&limit=50' |
  python3 -c "
import json,sys
print({r['model_type'] for r in json.load(sys.stdin)['data']})"
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/v1/prices?type=nonsense'
```

**Expect**: the total matches the pre-change count (all 225, non-chat
included); the filtered call returns only `{'embedding'}`; an unknown type
returns `400`. (SC-007, FR-013, FR-014)

## 8. The review queue is usable

```bash
npm run classify:review
```

**Expect**: the flagged models with the hint that fired and why it was not
trusted — e.g. `gpt-image-1 · pattern "image" · has an output price, so the
name is not corroborated`. (FR-005, US4)

## 9. Manual decisions stick

Add an override for one flagged model in `data/overrides.ts`, then:

```bash
npm run pipeline:run -- --only=openai
docker exec -i cot-pg psql "$LOCAL_DB" -c "
select model_id, model_type, classification_source
  from models where model_id = 'gpt-image-1';"
```

**Expect**: `image_gen` / `manual`. Run the pipeline again and confirm it is
unchanged — a derived rule must never overwrite a human decision. (FR-006,
P2)

## 10. Re-running changes nothing

```bash
npm run pipeline:run
npm run pipeline:run
```

**Expect**: the second run reports 0 classification changes. (P1)

---

## Before shipping

```bash
npm test && npm run typecheck && npm run build
```

Spot-check 20 classified models against their providers' own documentation and
confirm zero wrong types (SC-005).
