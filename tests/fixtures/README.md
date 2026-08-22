# Test fixtures

## openai-pricing-2026-08-22.md

The markdown rendering of OpenAI's pricing page, captured verbatim on 2026-08-22 from
<https://platform.openai.com/docs/pricing.md>.

Committed byte-for-byte — no header, no edits — because the defect it guards is about what the
document *contains* and where. Prepending anything, even a comment, would change what the
parser sees.

What makes it worth keeping: each table's pricing tier is stated as a bare text line above the
table's heading (the rendered tab label), not in the heading itself. Ten of its sixteen tables
are captioned "Grouped Pricing Table data" and four of those are non-standard tiers. Reading
tiers from headings alone silently admits batch, fast-mode and fine-tuning rates as standard
per-token prices — see specs/006-truthful-price-trend/research.md.
