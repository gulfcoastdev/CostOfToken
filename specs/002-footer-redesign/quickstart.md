# Quickstart: Validating the Footer Redesign

How to prove the footer works. Scenarios map to acceptance criteria in
[spec.md](./spec.md); structure is defined in
[contracts/footer-contract.md](./contracts/footer-contract.md).

## Prerequisites

```bash
docker start cot-pg      # local Postgres on 55432
npm run dev              # http://localhost:3000
```

---

## 1. Automated content-model checks

```bash
npm test                 # tests/footer.test.ts included
npm run typecheck
```

**Expect**: every internal destination resolves against the real `src/app`
tree, no duplicate targets, every group headed and non-empty, every frozen
destination still present, `/compare` present. (FR-002, FR-012, FR-013)

## 2. Exactly one footer, on every page type

```bash
for p in / /providers /providers/openai /compare /calculator /sources /about \
         /terms /api-docs /models/anthropic/claude-opus-5; do
  n=$(curl -s "http://localhost:3000$p" | grep -o '<footer' | wc -l | tr -d ' ')
  echo "$p → $n"
done
```

**Expect**: `1` for every route. Note `grep -c` counts *lines*, not matches —
use `grep -o | wc -l`, and strip `<script>` blocks before counting text, since
Next echoes rendered content into the RSC payload. (FR-008, SC-007)

## 3. The footer is identical everywhere

```bash
curl -s http://localhost:3000/about | python3 -c "
import sys,re; h=sys.stdin.read()
print(re.search(r'<footer.*?</footer>', h, re.S).group(0))" > /tmp/f-about.html
curl -s http://localhost:3000/terms | python3 -c "
import sys,re; h=sys.stdin.read()
print(re.search(r'<footer.*?</footer>', h, re.S).group(0))" > /tmp/f-terms.html
diff /tmp/f-about.html /tmp/f-terms.html && echo identical
```

**Expect**: `identical`. (FR-008, SC-007)

## 4. Every destination is present and resolves

```bash
curl -s http://localhost:3000/ | python3 -c "
import sys,re
f=re.search(r'<footer.*?</footer>', sys.stdin.read(), re.S).group(0)
for href in re.findall(r'href=\"([^\"]+)\"', f): print(href)" | sort -u > /tmp/hrefs
cat /tmp/hrefs
while read -r h; do
  case \"\$h\" in /*) printf '%s → ' \"\$h\"; curl -s -o /dev/null -w '%{http_code}\n' \
    \"http://localhost:3000\$h\";; esac
done < /tmp/hrefs
```

**Expect**: `/compare` appears in the list; every internal href returns `200`
(or `308` for a redirecting path). Zero `404`s. (FR-002, FR-012, SC-001,
SC-003)

## 5. The error state has a footer

```bash
docker stop cot-pg
curl -s http://localhost:3000/ | grep -o '<footer' | wc -l
docker start cot-pg
```

**Expect**: `1`. Before this feature it was `0` — a reader who hit a failed
page had no way onward. Restart the container afterwards. (FR-009)

## 6. Disclosure survives

```bash
curl -s http://localhost:3000/ > /tmp/home.html
for phrase in "read daily" "Via OpenRouter" "Standard tier only" \
              "confirm against the provider" "trademarks" "Gulf Coast Dev LLC" \
              "attribution"; do
  printf '%s: ' "$phrase"
  python3 -c "
import sys,re
h=open('/tmp/home.html').read()
h=re.sub(r'<script.*?</script>','',h,flags=re.S)
print(h.count('$phrase'))"
done
```

**Expect**: at least `1` for each. (FR-004, FR-005, FR-006, FR-013, SC-004,
SC-008)

## 7. Semantics

Inspect the rendered footer, or run an accessibility checker over any page.

**Expect**: one `<footer>`; a `<nav>` with an accessible name containing only
the link groups; each group a real heading followed by a `<ul>`; disclosure
paragraphs outside the `<nav>`. (FR-010, SC-006)

## 8. Keyboard

Tab from the last page control to the end of the document.

**Expect**: every footer link is reachable in a logical order, focus is
visible on each, and no element traps focus. (SC-006)

## 9. Responsive

Check at 320px, 375px, 768px and 1440px.

**Expect**: no horizontal scrollbar at any width; groups stack in one column
below 640px and sit side by side above it; long labels wrap rather than
overflow. (FR-011, SC-005)

## 10. It still reads as a footer

Look at a full page at desktop width.

**Expect**: the footer is visually subordinate to page content — quieter type
and colour, clearly the end of the page rather than a second homepage.
(FR-014)

---

## Before shipping

```bash
npm test && npm run typecheck && npm run build
```

Then walk one page on a real phone, and confirm the price table on `/` is
unaffected — the explorer's own inline footer was removed separately, and this
feature must not disturb what is left.
