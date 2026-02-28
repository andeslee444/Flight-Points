---
phase: 01-database-foundation
plan: 01
subsystem: database
tags: [drizzle-orm, drizzle-kit, postgresql, aws-rds, better-auth, migrations]

# Dependency graph
requires: []
provides:
  - "price_history table on AWS RDS with normalized per-flight columns and composite index"
  - "alert_subscriptions table on AWS RDS with user_id, origin, destination, cabin, channel, contact"
  - "Better Auth tables (user, session, account, verification) on AWS RDS"
  - "Drizzle ORM schema in src/flights/db-schema.ts with full TypeScript types"
  - "Drizzle client singleton in src/flights/db-drizzle.ts (getDrizzle()) for Next.js/Vercel reads"
  - "Migration files tracked in git under drizzle/migrations/"
  - "Custom migration runner drizzle/migrate.ts handling AWS RDS SSL"
affects:
  - 01-02: daemon needs price_history table to write to
  - 01-03: scraper registry reads availabilityType from this plan's schema decisions
  - 04-price-history-charts: reads price_history via getDrizzle()
  - 06-auth: Better Auth tables exist, ready for wiring

# Tech tracking
tech-stack:
  added:
    - "drizzle-orm@0.45.1 — Drizzle ORM for typed PostgreSQL queries"
    - "drizzle-kit@0.31.9 — Drizzle schema migration generator"
  patterns:
    - "Drizzle schema defined in src/flights/db-schema.ts, referenced by drizzle.config.ts"
    - "drizzle-kit generate → SQL files in drizzle/migrations/ → drizzle/migrate.ts applies them"
    - "Daemon uses raw pg pool (db.ts); Next.js/Vercel uses Drizzle client (db-drizzle.ts) — separate paths"
    - "SSL for AWS RDS: strip sslmode from URL, use { rejectUnauthorized: false } in Pool constructor"

key-files:
  created:
    - "src/flights/db-schema.ts — Drizzle schema: priceHistory, alertSubscriptions, user, session, account, verification"
    - "src/flights/db-drizzle.ts — getDrizzle() singleton for Vercel/Next.js reads"
    - "drizzle/drizzle.config.ts — drizzle-kit config pointing at db-schema.ts"
    - "drizzle/migrations/0000_material_nocturne.sql — SQL migration for all 6 new tables"
    - "drizzle/migrate.ts — Custom migration runner with RDS SSL handling"
  modified:
    - "package.json — Added drizzle-orm (dependency) and drizzle-kit (devDependency)"

key-decisions:
  - "drizzle-kit CLI cannot pass ssl: {rejectUnauthorized: false} to pg driver — workaround is custom migrate.ts using raw pg Pool with SSL disabled cert check, same pattern as existing db.ts"
  - "Better Auth tables added manually (standard pg adapter schema) since @better-auth/cli requires an auth.ts config that doesn't exist until Phase 6"
  - "price_history uses text for departure_date (YYYY-MM-DD string) not DATE type — consistent with existing FlightResult.departureDate field format"
  - "db-drizzle.ts is Vercel-only; daemon continues using raw pg pool in db.ts — strict boundary prevents daemon/Vercel dependency bleeding"

patterns-established:
  - "Migration pattern: drizzle-kit generate creates SQL, drizzle/migrate.ts applies it — use this for all future schema changes"
  - "SSL pattern: always strip sslmode from DATABASE_URL and use ssl: {rejectUnauthorized: false} in Pool options"
  - "Separation of concerns: db.ts = daemon writes (raw pg), db-drizzle.ts = Next.js reads (Drizzle ORM)"

requirements-completed: [INFR-01, INFR-04, INFR-05]

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 1 Plan 1: Database Foundation - Schema, Migrations, and Drizzle Client Summary

**Drizzle ORM schema with price_history and alert_subscriptions tables migrated to AWS RDS, plus Better Auth scaffold tables and a getDrizzle() client for future Vercel reads**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-26T08:32:50Z
- **Completed:** 2026-02-26T08:35:25Z
- **Tasks:** 2
- **Files modified:** 5 created, 1 modified

## Accomplishments
- Installed drizzle-orm and drizzle-kit, defined schema with all required tables in src/flights/db-schema.ts
- Generated SQL migration (0000_material_nocturne.sql) with 6 tables and 2 composite indexes
- Applied migrations to AWS RDS — price_history, alert_subscriptions, user, session, account, verification all live
- Created db-drizzle.ts as the typed Drizzle client singleton for future Next.js/Vercel reads

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Drizzle, define schema, generate migrations** - `5d282c3` (feat)
2. **Task 2: Apply migrations to AWS RDS and create Drizzle client** - `9cb1542` (feat)

**Plan metadata:** (pending final commit)

## Files Created/Modified
- `src/flights/db-schema.ts` — Drizzle schema: priceHistory, alertSubscriptions, user, session, account, verification tables with indexes
- `src/flights/db-drizzle.ts` — getDrizzle() Drizzle singleton for Vercel/Next.js reads, max 5 connections
- `drizzle/drizzle.config.ts` — drizzle-kit configuration pointing at db-schema.ts with SSL options
- `drizzle/migrations/0000_material_nocturne.sql` — SQL migration for all 6 tables
- `drizzle/migrations/meta/` — drizzle-kit migration metadata (snapshot + journal)
- `drizzle/migrate.ts` — Custom migration runner with AWS RDS SSL handling
- `package.json` — Added drizzle-orm@0.45.1 and drizzle-kit@0.31.9

## Decisions Made
- **drizzle-kit CLI SSL workaround:** drizzle-kit migrate cannot pass ssl options through the config properly on this version; wrote drizzle/migrate.ts using raw pg Pool (same rejectUnauthorized: false pattern as db.ts)
- **Better Auth tables added manually:** @better-auth/cli requires an auth.ts config that doesn't exist until Phase 6; used the standard Better Auth PostgreSQL adapter schema directly
- **departure_date as text:** Kept as TEXT (YYYY-MM-DD) to match existing FlightResult type, not DATE — avoids timezone conversion issues
- **Strict daemon/Vercel boundary:** db-drizzle.ts is explicitly for Next.js only — importing it from daemon code is prohibited by comment; daemon keeps raw pg pool in db.ts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Custom migration runner for AWS RDS SSL**
- **Found during:** Task 2 (Apply migrations)
- **Issue:** `drizzle-kit migrate` ignores the `ssl` config property and fails with `SELF_SIGNED_CERT_IN_CHAIN` on AWS RDS. The RDS pg_hba.conf requires SSL — cannot disable it.
- **Fix:** Created `drizzle/migrate.ts` using drizzle-orm's programmatic `migrate()` function with a raw `pg.Pool` configured with `ssl: { rejectUnauthorized: false }` — same pattern as the existing `db.ts`
- **Files modified:** drizzle/migrate.ts (new), drizzle/drizzle.config.ts (updated with ssl options as fallback for future drizzle-kit versions)
- **Verification:** `[migrate] Migrations applied successfully` — all 6 tables confirmed on RDS
- **Committed in:** 9cb1542 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — drizzle-kit SSL incompatibility)
**Impact on plan:** Fix was necessary and self-contained. drizzle/migrate.ts is a better long-term solution anyway (explicit SSL config, not CLI-dependent).

## Issues Encountered
- drizzle-kit CLI does not properly forward ssl options from drizzle.config.ts to the pg driver — resolved by custom migrate.ts runner (see Deviations above)

## User Setup Required
None - no external service configuration required. DATABASE_URL was already set in .env and credentials confirmed working.

## Next Phase Readiness
- price_history table exists and ready for daemon to write to (Plan 02)
- alert_subscriptions table exists for Phase 6 auth wiring
- Better Auth tables provisioned early — no schema migration needed in Phase 6
- getDrizzle() client ready for Next.js app/ directory usage in Phase 3 (frontend)
- drizzle/migrate.ts can be reused for all future schema migrations

---
*Phase: 01-database-foundation*
*Completed: 2026-02-26*

## Self-Check: PASSED

All created files verified:
- FOUND: src/flights/db-schema.ts
- FOUND: src/flights/db-drizzle.ts
- FOUND: drizzle/drizzle.config.ts
- FOUND: drizzle/migrations/0000_material_nocturne.sql
- FOUND: drizzle/migrate.ts

All commits verified:
- FOUND: 5d282c3 (Task 1 - schema, migrations generated)
- FOUND: 9cb1542 (Task 2 - migrations applied, Drizzle client created)
- FOUND: 0ed11fc (Plan metadata - SUMMARY.md, STATE.md, ROADMAP.md)
