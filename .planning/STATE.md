---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
last_updated: "2026-02-27T22:00:40Z"
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 7
  completed_plans: 5
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-26)

**Core value:** Users instantly know whether a points redemption is a good deal — and never miss an incredible one.
**Current focus:** Phase 2 — App Shell + Deal Feed

## Current Position

Phase: 2 of 6 (App Shell + Deal Feed)
Plan: 1 of 3 in current phase (complete)
Status: Phase 2 Plan 1 complete — Next.js scaffold deployed to Vercel
Last activity: 2026-02-27 — Plan 02-01 complete (Next.js 16 scaffold + Vercel deployment)

Progress: [████░░░░░░] 40% (Phase 1 complete, Phase 2 Plan 1 complete)

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

Last session: 2026-02-27
Stopped at: Completed 02-01-PLAN.md — Next.js 16 scaffold + Vercel deployment complete
Resume file: None
