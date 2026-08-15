# Feature Specification: Model Changelog Feed

**Feature Branch**: `001-model-changelog-feed`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "Add an RSS feed publishing site changelog entries: newly available models (with provider, prices and description) and price changes of existing models. Follow RSS 2.0 conventions."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Learn about a new model without checking the site (Priority: P1)

A developer choosing which LLM to build on wants to know when a new model
becomes available, without visiting the site to look. They subscribe once in
their feed reader. When a model appears, an entry arrives naming the provider
and model, what it costs to run, and what the model is for, and links to the
model's page for the full detail.

**Why this priority**: This is the reason to subscribe at all. New models are
the events people actively wait for, and the entry must carry enough substance
(provider, price, description) to judge relevance without a click. On its own
this is already a shippable feed.

**Independent Test**: Subscribe a feed reader to the feed, add a model to the
catalog, and confirm an entry appears in the reader naming the provider and
model with its input and output price and its description.

**Acceptance Scenarios**:

1. **Given** a subscriber whose reader has already seen the current feed,
   **When** a model new to the catalog is recorded, **Then** the reader shows
   exactly one new entry for it, titled with the provider name, the model name
   and its input and output price.
2. **Given** a new model that has a published description, **When** its entry
   is read, **Then** the entry body contains that description, its prices
   (input, cached input and output where published), its context window, and a
   link to the model's page on the site.
3. **Given** a new model whose provider publishes no price, **When** its entry
   is read, **Then** the entry states that pricing is not published rather than
   showing a zero, a blank or an error.
4. **Given** a subscriber who reads the feed twice with no catalog change in
   between, **When** the second fetch completes, **Then** the reader reports no
   new entries.

---

### User Story 2 - Notice a price change on a model already in use (Priority: P1)

A developer already spending money on a specific model wants to know when its
price moves — in either direction — because it changes their bill and possibly
their model choice. An entry arrives stating the old price, the new price and
the size of the move.

**Why this priority**: Equal in value to new models and the half no vendor
announces reliably. The site already records every price move; this is the only
way a reader learns about one without polling the table.

**Independent Test**: Record a price change for a tracked model and confirm a
single entry appears stating both the previous and the new price and the
percentage difference.

**Acceptance Scenarios**:

1. **Given** a model whose input price falls from $15.00 to $5.00 per 1M
   tokens, **When** the change is recorded, **Then** one entry appears stating
   the old price, the new price and that it is a decrease of about 67%.
2. **Given** a model whose input and output prices both change at the same
   time, **When** the change is recorded, **Then** one entry covers both
   changed prices rather than one entry per price field.
3. **Given** a model re-checked against its provider with no price movement,
   **When** the check completes, **Then** no entry is published.
4. **Given** a model that has just been added to the catalog, **When** its
   first price is recorded, **Then** it produces only the new-model entry and
   not an additional price-change entry.
5. **Given** a price that stops being published, **When** the change is
   recorded, **Then** the entry says the price is no longer published rather
   than reporting a change to zero.

---

### User Story 3 - Follow only the providers I care about (Priority: P2)

A reader who only uses one or two providers wants a feed limited to those, so
the subscription stays signal rather than 200 entries about vendors they will
never use.

**Why this priority**: Valuable but not required for the feed to be useful; the
unfiltered feed ships first and filtering refines it.

**Independent Test**: Request the feed limited to a single provider and confirm
every entry belongs to that provider, and that the same feed unfiltered
contains entries from others.

**Acceptance Scenarios**:

1. **Given** a reader subscribed to a provider-limited feed, **When** a model
   from another provider changes price, **Then** no entry appears in that
   subscription.
2. **Given** a reader subscribed to a feed limited to new models only, **When**
   a tracked model changes price, **Then** no entry appears in that
   subscription.
3. **Given** a subscription that names a provider that does not exist, **When**
   the feed is fetched, **Then** it returns a valid, empty feed rather than an
   error page.

---

### User Story 4 - Discover the feed exists (Priority: P3)

A visitor browsing the site, or a reader application pointed at the site's
address, finds the feed without being told its exact location.

**Why this priority**: A feed nobody can find has no subscribers, but
discovery is worthless before the feed itself works.

**Independent Test**: Point a feed reader at the site's home page address and
confirm it offers the changelog feed for subscription; confirm a visible link
to the feed exists on the site.

**Acceptance Scenarios**:

1. **Given** a feed reader given only the site's home page address, **When** it
   looks for a subscription, **Then** it finds the changelog feed.
2. **Given** a visitor on any page of the site, **When** they look at the site
   footer, **Then** a link to the feed is present.

---

### Edge Cases

- **The initial catalog import.** Every model tracked before the feed existed
  shares one "added" timestamp. The feed must stay readable rather than
  presenting hundreds of simultaneous entries: it publishes a bounded number of
  the most recent events.
- **A model with no price at all.** Entries must render without prices rather
  than being skipped or showing placeholder numbers.
- **A price of zero.** Genuinely free must read as free, and must never be
  confused with unknown.
- **The same model changing price repeatedly.** Each change is its own entry
  and each is distinguishable, even though every one of them links to the same
  model page.
- **Vendor-supplied text containing markup.** Model descriptions come from
  scraped vendor pages; they must be rendered as text in a reader, never
  interpreted as active content.
- **The catalog being briefly unreadable.** The feed must not answer with an
  empty but successful document, which readers interpret as "everything was
  withdrawn"; it signals a temporary failure so the subscription survives.
- **Republishing without new events.** Re-fetching an unchanged feed must not
  cause a reader to re-notify its user.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The site MUST publish a feed of catalog events in RSS 2.0 format
  at a stable, permanent address, served with the media type feed readers
  expect for RSS.
- **FR-002**: The feed MUST contain an entry for each model newly added to the
  catalog, stating the provider, the model name and identifier, its prices
  where published, its context window where known, and its published
  description where one exists.
- **FR-003**: The feed MUST contain an entry for each recorded change to a
  tracked model's price, stating the previous value, the new value, and the
  relative size of the change where both values are known.
- **FR-004**: A price change affecting several price fields at the same moment
  MUST produce exactly one entry covering all of them.
- **FR-005**: The first price recorded for a newly added model MUST NOT produce
  a price-change entry in addition to the new-model entry.
- **FR-006**: A re-check that finds no price movement MUST NOT produce an
  entry.
- **FR-007**: Every entry MUST carry an identifier that is unique across the
  feed and that never changes for that event, so a reader announces each event
  exactly once.
- **FR-008**: Every entry MUST link to the corresponding model's page on the
  site, and multiple entries about the same model MUST remain distinct
  despite sharing that link.
- **FR-009**: Every entry MUST carry the date and time the event occurred,
  formatted as RSS requires, and entries MUST be ordered newest first.
- **FR-010**: Each entry's title MUST be self-contained — naming provider,
  model and the relevant prices — because many readers and chat integrations
  display the title alone.
- **FR-011**: The feed MUST declare its own address, a human-readable title, a
  description, its language, and when it was last built.
- **FR-012**: The feed MUST state the attribution and licence terms under which
  the data may be reused, consistent with the rest of the site's data surfaces.
- **FR-013**: The feed MUST limit itself to a bounded number of the most recent
  events by default, and MUST allow a subscriber to request a larger or smaller
  number up to a defined maximum.
- **FR-014**: The feed MUST allow a subscriber to limit entries to one or more
  named providers, and to limit entries to new models only or price changes
  only.
- **FR-015**: An unrecognised or malformed subscription option MUST result in a
  valid feed rather than an error, since a reader cannot surface an error page
  to its user.
- **FR-016**: Text originating from provider pages MUST be rendered as inert
  text in a subscriber's reader, never as active or executable content.
- **FR-017**: Prices in entries MUST use the same conventions as the rest of
  the site: amounts in USD per 1,000,000 tokens, standard tier, with "free" and
  "not published" clearly distinguished.
- **FR-018**: An entry priced from a reseller catalogue rather than the
  vendor's own page MUST say so, matching the caveat the site's table carries.
- **FR-019**: When the underlying catalog cannot be read, the feed MUST
  respond with a temporary-failure signal rather than an empty successful feed.
- **FR-020**: The feed MUST be discoverable automatically from the site's pages
  by a feed reader given only the site address, and MUST be linked from the
  site's own navigation or footer.
- **FR-021**: The feed's contents MUST be reusable by many subscribers without
  a fresh catalog read per subscriber, so that polling by readers does not
  degrade the site.

### Key Entities

- **Catalog event**: One thing that happened and is worth telling subscribers
  about. Has a kind (model added, price changed), a moment it occurred, the
  model and provider it concerns, and a permanent identity. Derived from what
  the catalog already records rather than authored separately.
- **Model**: The subject of an event. Carries provider, identifier, display
  name, published description, context window and current prices.
- **Price change**: The before and after values of one model's price fields at
  a single moment, including which fields moved and by how much.
- **Feed**: An ordered, bounded, filterable view over catalog events, plus the
  channel-level information a reader needs (title, address, description,
  language, build time, licence).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A subscriber learns of a new model or a price change within one
  day of it being recorded, without visiting the site.
- **SC-002**: The feed validates cleanly against the RSS 2.0 specification with
  zero errors, and is accepted by mainstream feed readers without manual
  configuration.
- **SC-003**: Reading the feed twice with no intervening catalog change causes
  a reader to report zero new entries, on 100% of repeated fetches.
- **SC-004**: Every entry that reports a price change states both the previous
  and the new value; a reader never has to open the site to learn what the
  price was before.
- **SC-005**: 100% of entry titles identify the provider, the model and the
  substance of the event without the body being opened.
- **SC-006**: A subscriber filtering by provider receives entries only for the
  providers requested, verified across every entry in the filtered feed.
- **SC-007**: A feed reader pointed at the site's home address alone finds and
  subscribes to the feed.
- **SC-008**: Repeated polling by subscribers adds no more than a small,
  constant number of catalog reads per hour regardless of subscriber count.

## Assumptions

- The catalog already records everything the feed needs: when a model first
  appeared, and every material price movement with its previous value. No new
  collection work is required, and the feed reports history as recorded rather
  than reconstructing events that predate the record.
- Events that predate the feature — notably the initial import, where the
  entire catalog shares one timestamp — will appear as ordinary "new model"
  entries. The bounded entry count keeps that from overwhelming a reader, and
  the flood recedes as real events accumulate.
- Model retirement or delisting is out of scope for this feature. The catalog
  does not record when a model was withdrawn distinctly enough to date such an
  entry honestly.
- Only the standard pricing tier is covered, matching the rest of the site;
  batch and priority tiers are excluded, as are non-price attribute changes
  (a renamed model or an edited description does not produce an entry).
- One RSS 2.0 feed is published. Atom and JSON Feed are deliberately not
  offered: RSS is accepted everywhere subscribers actually read, and a second
  format is a second thing to keep correct.
- The feed is public and anonymous, like the rest of the site's data surfaces.
  No subscriber accounts, per-user preferences, or email delivery are in scope;
  filtering is expressed in the subscription address itself.
- Entries are in English, matching the site.
