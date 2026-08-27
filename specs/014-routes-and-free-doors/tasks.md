# Tasks: Routes and Free Doors
- [X] T001 Schema: price_layer + promo_ends_at on models; db:push LOCAL;
      types (NormalizedModel.priceLayer/promoEndsAt, Offer fields); upsert
      writes them.
- [X] T002 Failing tests then: openrouter provider extractor ingests :free
      as offerTier/priceLayer 'free' (batch still skipped; vendor fallback
      extractor still skips both).
- [X] T003 Failing tests then: deepinfra promo layer from declared
      discount fields (future end date → promo; past/absent → list).
- [X] T004 Failing test then: monitor cheapestByCanonical ignores free
      offers.
- [X] T005 UI: promo badge + free strip in offer-comparison.tsx (with
      caveat copy).
- [X] T006 /free and /discounts pages + queries + nav links.
- [X] T007 Validate: suite, typecheck, build, pipeline run, spot-check
      /free and a :free model page; BACKLOG (no-train/ZDR + rate limits +
      OpenRouter discounted-collection diffing deferred).
