---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-02-28T00:37:34.423Z"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 14
  completed_plans: 14
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-26)

**Core value:** Users instantly know whether a points redemption is a good deal — and never miss an incredible one.
**Current focus:** Phase 4 — Price History Charts

## Current Position

Phase: 4 of 6 (Price History Charts)
Plan: 3 of 3 in current phase (complete)
Status: Phase 4 in progress — Transfer bonus config, enrichment, and FlightResultCard label complete
Last activity: 2026-02-28 — Plan 04-03 complete (lib/transfer-bonuses.ts, EnrichedDeal.transferBonuses, amber bonus label on FlightResultCard)

Progress: [████████░░] 56% (Phase 1 complete, Phase 2 complete, Phase 3 complete, Phase 4 Plans 1-3 complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: ~6 min
- Total execution time: ~30 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 4 | ~20 min | ~5 min |
| 02-app-shell-deal-feed | 1 | ~10 min | ~10 min |

**Recent Trend:**
- Last 5 plans: 01-01, 01-02, 01-03, 01-04, 02-01
- Trend: Steady

*Updated after each plan completion*
| Phase 01-database-foundation P01 | 3 | 2 tasks | 7 files |
| Phase 01-database-foundation P02 | 4 | 2 tasks | 3 files |
| Phase 02-app-shell-deal-feed P01 | 10 | 2 tasks | 22 files |
| Phase 02-app-shell-deal-feed P02 | 6 | 2 tasks | 8 files |
| Phase 02-app-shell-deal-feed P03 | 2 | 2 tasks | 4 files |
| Phase 03-search-value-assessment P01 | 3 | 2 tasks | 10 files |
| Phase 03-search-value-assessment P02 | 8 | 2 tasks | 6 files |
| Phase 03-search-value-assessment P03 | 2 | 2 tasks | 3 files |
| Phase 03-search-value-assessment P04 | 1 | 2 tasks | 4 files |
| Phase 04-price-history-charts P01 | 6 | 2 tasks | 6 files |
| Phase 04-price-history-charts P02 | 2 | 2 tasks | 2 files |
| Phase 04-price-history-charts P03 | 2 | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [02-01]: tsconfig.json is now the Next.js config (moduleResolution: bundler); daemon uses tsconfig.daemon.json via -p flag
- [02-01]: monitor.ts excluded from Next.js tsconfig include — transitive imports to scrapers with pre-existing type errors would break Next.js build
- [02-01]: vercel.json explicitly sets buildCommand: next build — prevents Vercel from running npm run build (daemon tsc)
- [02-01]: shadcn/ui components.json pre-created manually to avoid interactive shadcn init prompts
- [Roadmap]: Phase 4 (price history charts) intentionally delayed 3-4 weeks after Phase 1 — chart needs accumulated data to be meaningful
- [Roadmap]: SSE live search (Phase 5) runs on Harbor Express proxy, never on Vercel serverless — Python scrapers can't run on Vercel
- [Roadmap]: availabilityType field added to FlightResult in Phase 1 — retrofitting after UI is built is painful
- [Roadmap]: Alert emails must include scrape timestamp and "verify before transferring" copy — non-reversible points transfers are the primary trust risk
- [01-04]: availabilityType is optional on FlightResult — confirmed status is registry-level (Plan 02), not per-result
- [01-04]: AvailabilityType exported as type alias so ScraperRegistryEntry can reuse without duplicating union literal
- [Phase 01-database-foundation]: drizzle-kit CLI SSL workaround: custom migrate.ts with pg Pool rejectUnauthorized:false bypasses drizzle-kit SSL bug against AWS RDS
- [Phase 01-database-foundation]: db-drizzle.ts is Vercel-only (getDrizzle() for Next.js reads); daemon continues using raw pg pool in db.ts — strict boundary prevents dep bleeding
- [01-03]: Used pointsRequired (not milesRequired) in flightMatchesSubscription — plan spec had wrong field name; auto-fixed
- [01-03]: checkAlerts placed after writeToWebCache, before existing WhatsApp send block — both consume allResults from same cycle; scanTime reused as cycleId
- [Phase 01-02]: r.pointsRequired/r.taxesAndFees used in history-writer.ts (plan template had wrong field names milesRequired/taxesUSD)
- [Phase 01-02]: scraperKey='daemon' with 'confirmed' for daemon's history writes — daemon uses legacy batch scrapers not in SCRAPER_REGISTRY
- [Phase 01-02]: cathay is the only 'calendar' scraper — AFR API returns H/L/NA availability codes only, no real point prices
- [Phase 02-02]: Helper functions copied from monitor.ts into lib/enrichment.ts to avoid transitive daemon import chain
- [Phase 02-02]: webpack chosen over Turbopack for production build — experimental.extensionAlias resolves NodeNext .js→.ts imports; Turbopack cannot handle this
- [Phase 02-02]: amex-mr used as default program perspective for deal feed — most popular transferable currency, plan 03 adds program filter
- [Phase 02-03]: Client-side filtering via Zustand — RSC passes full deals array once, FilterBar and DealFeed share store without prop drilling
- [Phase 02-03]: Two distinct empty states: DB empty ('check back soon') vs filter mismatch ('broaden your search') prevent user confusion
- [Phase 03-search-value-assessment]: getSearchResults uses ANY() SQL for multi-airport comma-separated queries
- [Phase 03-search-value-assessment]: coverage.ts uses hardcoded strings not SCRAPER_REGISTRY import to prevent daemon transitive deps
- [Phase 03-search-value-assessment]: SearchForm uses initialValues prop (from RSC) not useSearchParams() — avoids Suspense boundary requirement
- [Phase 03-search-value-assessment]: Build verification requires npx next build --webpack (not default Turbopack) — Turbopack cannot resolve .js->ts extensionAlias
- [03-03]: FlightResultCard imports EnrichedDeal from lib/enrichment directly; cashSavings() derives from CPP * points / 100 — taxes already on EnrichedDeal
- [03-03]: SearchResults is 'use client' to support metro dedup toggle in Plan 03-04 without refactoring boundary
- [03-04]: METRO_GROUPS constant copied into search-results.tsx (not imported from live-scraper.ts) to avoid daemon transitive deps
- [03-04]: CoverageNotices is a Server Component — data is static from lib/coverage.ts, no client state needed
- [03-04]: Metro dedup defaults to collapsed (showAllAirports=false) — clean view by default, toggle to expand
- [04-01]: INTERVAL '1 day' * ${days} syntax for parameterized SQL — avoids sql.raw() injection risk while keeping Drizzle parameterization
- [04-01]: Multi-airport from/to params in history route take only first airport for v1 (split on comma) — matches getSearchResults() pattern
- [04-01]: availability_type = 'confirmed' filter in getPriceHistory() SQL — ensures only real live deal history, not estimated/calendar data
- [04-01]: Chart CSS vars added to @theme inline block (not @layer base) — required for Tailwind 4 CSS variable system
- [04-02]: ChartTooltip from shadcn chart.tsx used (not raw Tooltip from recharts) — ChartTooltipContent calls useChart() which requires ChartContext provider in ChartContainer
- [04-02]: Server Component fetches getPriceHistory; Client Component renders AreaChart — clean SSR/CSR boundary, no extra client fetch
- [04-02]: primaryFrom/primaryTo split on comma for multi-airport params before history query — consistent with getSearchResults() ANY() SQL pattern
- [04-03]: ACTIVE_TRANSFER_BONUSES starts empty with commented example — avoids including potentially-expired bonuses at launch; maintainer adds current bonuses before deploying
- [04-03]: transferBonuses cross-references transferFrom list — only shows bonus if CC program already has transfer path to the airline
- [04-03]: FlightResultCard shows best bonus only (highest bonusPct) when multiple apply — avoids cluttering card with multiple promotional labels

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 2]: Pre-existing TypeScript errors in cathay.ts and korean-air.ts need cleanup — they appear as warnings in Vercel build output. Plan 02 or a cleanup plan should fix these.
- [Phase 1]: Turkish Airlines API scraper is written but untested — needs API credentials (TK_API_KEY, TK_API_SECRET) from developer.apim.turkishairlines.com before integration testing
- [Phase 5]: Vercel-to-Harbor SSE proxy buffering fix (X-Accel-Buffering header) has low-confidence documentation — validate in Vercel preview deployment early in Phase 5
- [Phase 6]: Better Auth pg adapter + Next.js 16 integration is medium confidence — research during Phase 6 planning
- [Ongoing]: Star Alliance coverage gap (Aeroplan/United blocked by Gigya reCAPTCHA) — UI must disclose "Star Alliance: Limited coverage"
- [Ongoing]: Flying Blue session expires ~hourly and returns [] not error — LOGIN_REQUIRED structured error + auto-relogin path needed before Flying Blue is included in user-facing alerts

## Session Continuity

Last session: 2026-02-28
Stopped at: Completed 04-03-PLAN.md — transfer bonus config, EnrichedDeal.transferBonuses, amber bonus label on FlightResultCard
Resume file: None
