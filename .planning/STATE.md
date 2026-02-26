# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-26)

**Core value:** Users instantly know whether a points redemption is a good deal — and never miss an incredible one.
**Current focus:** Phase 1 — Database Foundation

## Current Position

Phase: 1 of 6 (Database Foundation)
Plan: 0 of 4 in current phase
Status: Ready to plan
Last activity: 2026-02-26 — Roadmap created, all 37 v1 requirements mapped across 6 phases

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phase 4 (price history charts) intentionally delayed 3-4 weeks after Phase 1 — chart needs accumulated data to be meaningful
- [Roadmap]: SSE live search (Phase 5) runs on Harbor Express proxy, never on Vercel serverless — Python scrapers can't run on Vercel
- [Roadmap]: availabilityType field added to FlightResult in Phase 1 — retrofitting after UI is built is painful
- [Roadmap]: Alert emails must include scrape timestamp and "verify before transferring" copy — non-reversible points transfers are the primary trust risk

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Turkish Airlines API scraper is written but untested — needs API credentials (TK_API_KEY, TK_API_SECRET) from developer.apim.turkishairlines.com before integration testing
- [Phase 5]: Vercel-to-Harbor SSE proxy buffering fix (X-Accel-Buffering header) has low-confidence documentation — validate in Vercel preview deployment early in Phase 5
- [Phase 6]: Better Auth pg adapter + Next.js 16 integration is medium confidence — research during Phase 6 planning
- [Ongoing]: Star Alliance coverage gap (Aeroplan/United blocked by Gigya reCAPTCHA) — UI must disclose "Star Alliance: Limited coverage"
- [Ongoing]: Flying Blue session expires ~hourly and returns [] not error — LOGIN_REQUIRED structured error + auto-relogin path needed before Flying Blue is included in user-facing alerts

## Session Continuity

Last session: 2026-02-26
Stopped at: Roadmap created — ready to begin Phase 1 planning
Resume file: None
