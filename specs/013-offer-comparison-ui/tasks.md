# Tasks: Cross-Provider Offer Comparison UI

- [X] T001 Failing DB test (tests/offers.test.ts, DB describe):
      getModelOffers returns all active offers for a multi-seller
      canonical with canonical slug; null for unlinked and single-offer
      models; inactive offers excluded.
- [X] T002 Implement getModelOffers in src/lib/queries.ts (cachedRead,
      tag 'offers'); green on T001.
- [X] T003 Build src/components/offer-comparison.tsx (rankOffers +
      HEADLINE_WORKLOAD, cheapest highlight, savings vs vendor, provenance
      + type badges, current-provider marker, unpriced tail).
- [X] T004 Wire section into src/app/models/[provider]/[model]/page.tsx.
- [X] T005 Validate: full suite, typecheck, `next build`, visual check via
      dev server against a 4-seller model (kimi-k3 on moonshot).
