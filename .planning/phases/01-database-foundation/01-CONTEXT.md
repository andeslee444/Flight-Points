# Phase 1: Database Foundation - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Normalize the database schema for time-series price history and alert subscriptions, extend the daemon to write historical data on every scrape cycle, add availability provenance classification to flight results, and scaffold auth tables for future user accounts. PostgreSQL remains the sole integration boundary between Harbor (daemon) and Vercel (frontend).

</domain>

<decisions>
## Implementation Decisions

### Price history granularity
- Store **per-flight rows** — one row per individual flight result per scrape cycle (full fidelity, not aggregated)
- Charts in Phase 4 will aggregate to **daily summaries** — this is a display concern, not a storage concern
- **Retain forever** — no TTL, no pruning. Multi-year trends have value.
- Capture **all flights** from every daemon scrape cycle, not just watched routes. Builds the broadest possible dataset for deal feed, any-route search, and future analysis.

### Availability provenance
- **Only confirmed data** — results must come from real airline booking pages showing actual point prices for specific itineraries
- **Three-tier classification** on the `availabilityType` field: `confirmed`, `calendar`, `estimated` — but only `confirmed` results are stored and shown to users
- **Do not store** calendar-level or estimated data at all. If a scraper can't return real bookable point prices, its results are excluded from the database entirely.
- Current mapping: AA CDP = confirmed (scrapes booking results page), Flying Blue CDP = confirmed (scrapes individual flight prices), Alaska curl_cffi = confirmed (returns real prices), Delta/VA curl_cffi = confirmed (GraphQL with real prices), Google Flights = confirmed (cash prices). Cathay AFR API = calendar (only availability codes, no real prices) — **excluded**.
- The `NON_BOOKABLE_SOURCES` filter already excludes `ana-estimated` and `ana-chart` — extend this pattern to all non-confirmed scrapers.

### Claude's Discretion
- Exact Drizzle schema column types and indexes for price_history table
- Alert_subscriptions table design (will be used in Phase 6 — just needs to exist)
- Better Auth table schema (follow their standard PostgreSQL adapter)
- How to integrate Drizzle alongside the existing raw `pg` pool

</decisions>

<specifics>
## Specific Ideas

- "We don't need estimates, we need real, hard data about how much points the itinerary requires" — user is emphatic about data quality over coverage
- The existing `NON_BOOKABLE_SOURCES` filter pattern should be extended to a scraper-level `availabilityType` field in the registry, so confirmed/excluded is declared once per scraper, not checked per result

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-database-foundation*
*Context gathered: 2026-02-26*
