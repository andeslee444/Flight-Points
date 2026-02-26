# Phase 1: Database Foundation - Research

**Researched:** 2026-02-26
**Domain:** PostgreSQL schema design, Drizzle ORM, Better Auth, daemon history-writer extension
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Price history granularity:**
- Store per-flight rows — one row per individual flight result per scrape cycle (full fidelity, not aggregated)
- Charts in Phase 4 will aggregate to daily summaries — this is a display concern, not a storage concern
- Retain forever — no TTL, no pruning. Multi-year trends have value.
- Capture all flights from every daemon scrape cycle, not just watched routes. Builds the broadest possible dataset for deal feed, any-route search, and future analysis.

**Availability provenance:**
- Only confirmed data — results must come from real airline booking pages showing actual point prices for specific itineraries
- Three-tier classification on the `availabilityType` field: `confirmed`, `calendar`, `estimated` — but only `confirmed` results are stored and shown to users
- Do not store calendar-level or estimated data at all. If a scraper can't return real bookable point prices, its results are excluded from the database entirely.
- Current mapping: AA CDP = confirmed, Flying Blue CDP = confirmed, Alaska curl_cffi = confirmed, Delta/VA curl_cffi = confirmed, Google Flights = confirmed (cash prices). Cathay AFR API = calendar — EXCLUDED.
- The `NON_BOOKABLE_SOURCES` filter already excludes `ana-estimated` and `ana-chart` — extend this pattern to all non-confirmed scrapers.

### Claude's Discretion
- Exact Drizzle schema column types and indexes for price_history table
- Alert_subscriptions table design (will be used in Phase 6 — just needs to exist)
- Better Auth table schema (follow their standard PostgreSQL adapter)
- How to integrate Drizzle alongside the existing raw `pg` pool

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFR-01 | Normalized price_history table accumulates historical price data from daemon scrape cycles | Schema design section: normalized columns, composite index on (origin, destination, cabin, program, scrape_date) |
| INFR-02 | Daemon history-writer extension appends time-series data on each scrape cycle | Architecture Patterns: history-writer module, confirmed-only filter gate, batch insert pattern |
| INFR-03 | Alert-checker daemon extension compares fresh cache against user alert subscriptions | alert_subscriptions table design; alert-checker is scaffolded in Phase 1, logic in Phase 6 |
| INFR-04 | Frontend deployed to Vercel with Next.js; scrapers remain on Harbor daemon | Next.js scaffold, Vercel deployment, DATABASE_URL as sole integration boundary |
| INFR-05 | PostgreSQL serves as sole integration boundary between Harbor (writes) and Vercel (reads) | DB access pattern: daemon writes via raw pg pool, Vercel reads via Drizzle ORM |
</phase_requirements>

---

## Summary

This phase lays the database foundation for the entire product. Three things must happen: (1) a normalized `price_history` table is created and the daemon writes to it on every scrape cycle; (2) an `alert_subscriptions` table is scaffolded for Phase 6; and (3) Better Auth user/session tables are applied via Drizzle migration so Phase 6 auth work doesn't require schema surgery.

The existing codebase already uses raw `pg` pool with typed query functions in `src/flights/db.ts`. The plan is to introduce Drizzle ORM alongside (not replacing) that raw pool — Drizzle manages migrations and schema definitions, while the daemon continues using the raw pool for its high-throughput write path. The Vercel Next.js frontend will use Drizzle for reads. This avoids a risky rewrite of working daemon code.

The key engineering decision is the `availabilityType` field: the scraper registry must be extended with a per-scraper `availabilityType` declaration (`'confirmed' | 'calendar' | 'estimated'`), and the history-writer must gate on `confirmed` before inserting into `price_history`. This ensures data quality from day one — no estimates, no calendar-level data, only real bookable prices.

**Primary recommendation:** Use Drizzle ORM for schema management and migrations; keep raw `pg` pool for the daemon write path; add `availabilityType` to the scraper registry as the gating mechanism for history writes.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.38.x | Schema definition, type-safe queries, migrations | Official PostgreSQL adapter; works alongside raw pg pool |
| drizzle-kit | ^0.30.x | CLI for generating and applying migrations | Paired with drizzle-orm; `drizzle-kit push` for RDS |
| pg | ^8.13.1 (existing) | Raw PostgreSQL pool for daemon writes | Already in production; no disruption to working code |
| better-auth | ^1.x | Auth table schema for user accounts | Standard PostgreSQL adapter generates tables via migration |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @auth/drizzle-adapter | latest | Connects Better Auth to Drizzle schema | Used in Phase 6 — but tables must exist now |
| next | ^15.x | Frontend framework on Vercel | INFR-04: Next.js app reads from RDS |
| @vercel/postgres | latest | Vercel-managed connection pooling for serverless | Alternative to pg on Vercel — evaluate vs direct pg |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Drizzle ORM | Prisma | Prisma has better docs but heavier binary; Drizzle is lighter and works better alongside raw pg |
| Drizzle ORM | Raw SQL migration files | Raw SQL is fine but loses type safety across daemon + frontend |
| Better Auth | NextAuth | Better Auth has first-class Drizzle adapter and works in Next.js 15; NextAuth v5 is less stable |

**Installation:**
```bash
npm install drizzle-orm better-auth
npm install -D drizzle-kit
# Next.js for frontend (separate workspace or same repo)
npm install next react react-dom
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── flights/
│   ├── db.ts                    # EXISTING: raw pg pool, daemon write functions
│   ├── db-schema.ts             # NEW: Drizzle schema definitions (all tables)
│   ├── db-drizzle.ts            # NEW: Drizzle client instance for Vercel reads
│   ├── history-writer.ts        # NEW: appends price_history rows on each scrape cycle
│   └── scrapers/
│       └── index.ts             # MODIFY: add availabilityType to SCRAPER_REGISTRY entries
drizzle/
│   ├── migrations/              # Generated by drizzle-kit
│   └── drizzle.config.ts        # Drizzle config pointing at DATABASE_URL
web/                             # EXISTING: Express static server (stays as-is)
app/                             # NEW: Next.js app directory (for Vercel deployment)
│   ├── layout.tsx
│   └── page.tsx
```

### Pattern 1: Drizzle Schema Definition (alongside raw pg)

**What:** Define all tables once in `db-schema.ts` using Drizzle's schema DSL. Raw `pg` pool in `db.ts` remains unchanged — daemon uses it directly. Drizzle client in `db-drizzle.ts` is used by the Next.js frontend for reads.

**When to use:** When you need type-safe schema + migrations without rewriting existing code.

```typescript
// src/flights/db-schema.ts
import { pgTable, serial, text, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core';

export const priceHistory = pgTable('price_history', {
  id: serial('id').primaryKey(),
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  cabin: text('cabin').notNull(),           // 'economy' | 'business' | 'first'
  program: text('program').notNull(),        // scraper source key e.g. 'aa-cdp'
  flight_number: text('flight_number'),
  departure_date: text('departure_date').notNull(),  // 'YYYY-MM-DD'
  departure_time: text('departure_time'),
  miles: integer('miles').notNull(),
  cash_price_usd: numeric('cash_price_usd', { precision: 10, scale: 2 }),
  taxes_usd: numeric('taxes_usd', { precision: 10, scale: 2 }),
  availability_type: text('availability_type').notNull().default('confirmed'),
  scrape_cycle_id: text('scrape_cycle_id'),  // ISO timestamp of the cycle
  scraped_at: timestamp('scraped_at').defaultNow().notNull(),
}, (table) => ({
  routeCabinIdx: index('ph_route_cabin_idx').on(
    table.origin, table.destination, table.cabin, table.program, table.departure_date
  ),
  scrapedAtIdx: index('ph_scraped_at_idx').on(table.scraped_at),
}));

export const alertSubscriptions = pgTable('alert_subscriptions', {
  id: serial('id').primaryKey(),
  user_id: text('user_id').notNull(),       // Better Auth user ID
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  cabin: text('cabin').notNull(),
  program: text('program'),                  // null = any program
  max_miles: integer('max_miles'),           // null = any price
  channel: text('channel').notNull(),        // 'email' | 'whatsapp'
  contact: text('contact').notNull(),        // email address or WhatsApp number
  active: text('active').notNull().default('true'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
```

### Pattern 2: Scraper Registry availabilityType Declaration

**What:** Add `availabilityType: 'confirmed' | 'calendar' | 'estimated'` to each entry in `SCRAPER_REGISTRY`. The history-writer reads this field to gate inserts.

**When to use:** Whenever a new scraper is registered — declare once, applied everywhere.

```typescript
// src/flights/scrapers/index.ts (modified SCRAPER_REGISTRY entry shape)
export interface ScraperRegistryEntry {
  search: (params: SearchParams) => Promise<FlightResult[]>;
  availabilityType: 'confirmed' | 'calendar' | 'estimated';
  allianceCoverage?: string;
  fallbackFor?: string[];
}

// Example entries:
// 'aa-cdp': { search: searchAACdp, availabilityType: 'confirmed', allianceCoverage: 'oneworld' }
// 'cathay-curlffi': { search: searchCathayCurlFfi, availabilityType: 'calendar' }  // EXCLUDED from history
```

### Pattern 3: History-Writer Module

**What:** A module called by the daemon after each scrape batch that filters to confirmed results and bulk-inserts into `price_history` using the raw `pg` pool (same pool the daemon already uses).

**When to use:** Called at end of each daemon scrape cycle.

```typescript
// src/flights/history-writer.ts
import { getPool } from './db.js';
import type { FlightResult } from './types.js';

export async function writeHistoryBatch(
  results: FlightResult[],
  scraperKey: string,
  availabilityType: 'confirmed' | 'calendar' | 'estimated',
  cycleId: string,
): Promise<number> {
  // Gate: only confirmed results enter price_history
  if (availabilityType !== 'confirmed') return 0;

  const pool = getPool();
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const r of results) {
      if (!r.milesRequired || !r.origin || !r.destination || !r.departureDate) continue;
      await client.query(
        `INSERT INTO price_history
           (origin, destination, cabin, program, flight_number, departure_date,
            departure_time, miles, taxes_usd, availability_type, scrape_cycle_id, scraped_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,NOW())`,
        [r.origin, r.destination, r.cabin ?? 'unknown', scraperKey,
         r.flightNumber ?? null, r.departureDate, r.departureTime ?? null,
         r.milesRequired, r.taxesUSD ?? null, cycleId],
      );
      inserted++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return inserted;
}
```

### Pattern 4: Drizzle Config and Migrations

**What:** `drizzle.config.ts` at repo root pointing at `DATABASE_URL`. Run `npx drizzle-kit push` to apply schema to AWS RDS without generating migration files, or `npx drizzle-kit generate` + `npx drizzle-kit migrate` for file-tracked migrations.

```typescript
// drizzle/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/flights/db-schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Migration workflow:**
```bash
# Generate SQL migration from schema changes
npx drizzle-kit generate

# Apply to AWS RDS
DATABASE_URL=... npx drizzle-kit migrate

# Or push directly without migration files (simpler for early dev)
DATABASE_URL=... npx drizzle-kit push
```

### Anti-Patterns to Avoid

- **Storing all results regardless of availabilityType:** Calendar/estimated data will pollute time-series queries and make Phase 4 charts meaningless. Gate at the history-writer level, not the query level.
- **Replacing raw pg pool with Drizzle everywhere:** The daemon's write path is high-throughput and battle-tested. Drizzle is for schema management and frontend reads only.
- **Per-result availabilityType checks on individual FlightResult objects:** The filter should be per-scraper, not per-result. Declare once in SCRAPER_REGISTRY, not scattered across results.
- **JSONB blobs in price_history:** The existing `flight_cache` table stores `award_flights` as JSONB. `price_history` must NOT do this — normalized columns only so time-series queries work without JSON extraction.
- **Forgetting to add `scrape_cycle_id`:** Without a cycle ID, you cannot tell which rows came from the same scrape run, which makes debugging and deduplication impossible.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema migrations | Custom SQL scripts run manually | `drizzle-kit generate` + `drizzle-kit migrate` | Tracks migration history, idempotent, reversible |
| Auth table schema | Custom users/sessions tables | Better Auth's `npx @better-auth/cli generate` | Auth table relationships are subtle (sessions, accounts, verifications) |
| Bulk insert batching | Custom chunking logic | PostgreSQL `COPY` or multi-row `VALUES` | pg handles batch inserts efficiently; avoid N+1 individual INSERTs in tight loops |
| Type-safe DB access on Vercel | Raw pg queries with manual typing | Drizzle ORM query builder | Catches column name mismatches at compile time |

**Key insight:** The existing raw pg pool is fine for the daemon. Drizzle's value is in (a) schema-as-code with migration tracking, and (b) type-safe reads in the Next.js frontend. Don't conflate these roles.

---

## Common Pitfalls

### Pitfall 1: Flying Blue session expiry silently returns empty results
**What goes wrong:** Flying Blue CDP scraper returns `[]` instead of an error when session expires (~1 hour). An empty result set passes the `availabilityType === 'confirmed'` gate and results in no history rows being written — this is correct behavior, but the daemon should log a structured `LOGIN_REQUIRED` error rather than silently dropping results.
**Why it happens:** The scraper has no way to distinguish "no flights found" from "session expired" at the Python level without checking the DOM state.
**How to avoid:** Add a `LOGIN_REQUIRED` error type to `FlightResult` or return a structured error from the scraper. The history-writer should log when a confirmed scraper returns 0 results (not just skip silently).
**Warning signs:** Flying Blue rows stop appearing in `price_history` for >1 hour windows.

### Pitfall 2: price_history grows unbounded without a retention strategy
**What goes wrong:** User decided "retain forever" — but at 30-minute cycles with 100+ results per cycle, `price_history` can reach 100M+ rows in months. Queries slow down, RDS costs increase.
**Why it happens:** No partition or index strategy means full table scans for time-series queries.
**How to avoid:** Add composite index on `(origin, destination, cabin, program, departure_date)` and index on `scraped_at`. Consider PostgreSQL table partitioning by month as a Phase 4 concern (when charts are built). For now, the indexes are sufficient.
**Warning signs:** Query time on `price_history` exceeds 500ms for route-specific lookups.

### Pitfall 3: Drizzle push vs migrate confusion in production
**What goes wrong:** `drizzle-kit push` directly modifies the production RDS schema without a migration file. If something goes wrong, there is no rollback path.
**Why it happens:** `push` is convenient for dev but bypasses migration tracking.
**How to avoid:** Use `drizzle-kit generate` + `drizzle-kit migrate` for production schema changes. Keep `push` for local development only. Store migration files in git.
**Warning signs:** Schema drift between `db-schema.ts` and the actual RDS schema.

### Pitfall 4: Better Auth tables conflict with existing schema
**What goes wrong:** Better Auth generates `user`, `session`, `account`, `verification` tables. If any of these names conflict with existing tables, `drizzle-kit push` will error or silently alter wrong tables.
**Why it happens:** The existing schema has `flight_signups` not `users`, so there's no conflict — but verify before running migrations.
**How to avoid:** Run `npx drizzle-kit push --dry-run` first to preview SQL. Check existing RDS table list.
**Warning signs:** Migration errors mentioning table already exists.

### Pitfall 5: Next.js and Express running from the same repo causes module conflicts
**What goes wrong:** Next.js expects `app/` directory at repo root; Express server is at `src/flights/web-server.ts`. If Next.js build picks up `src/` it may try to compile daemon code.
**Why it happens:** Next.js `next build` crawls all imports from `app/` directory — as long as daemon code is not imported from `app/`, it won't be included.
**How to avoid:** Keep `app/` isolated with its own imports. Do not import from `src/flights/` in Next.js pages except `db-drizzle.ts` and `db-schema.ts`. Confirm `tsconfig.json` paths don't bleed across.
**Warning signs:** Vercel build fails with "Module not found" for daemon-only dependencies.

---

## Code Examples

### Drizzle client setup for Next.js (Vercel reads)
```typescript
// src/flights/db-drizzle.ts
// Source: Drizzle ORM official docs — https://orm.drizzle.team/docs/get-started-postgresql
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './db-schema.js';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDrizzle() {
  if (_db) return _db;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 5, // Vercel serverless: lower max connections
  });
  _db = drizzle(pool, { schema });
  return _db;
}
```

### Query price_history for a route (time-series read)
```typescript
// app/api/history/route.ts (Next.js API route on Vercel)
import { getDrizzle } from '@/src/flights/db-drizzle';
import { priceHistory } from '@/src/flights/db-schema';
import { eq, and, gte, desc } from 'drizzle-orm';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const db = getDrizzle();

  const rows = await db
    .select()
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.origin, searchParams.get('origin')!),
        eq(priceHistory.destination, searchParams.get('destination')!),
        eq(priceHistory.cabin, searchParams.get('cabin')!),
        gte(priceHistory.scraped_at, new Date(Date.now() - 90 * 86400000)),
      )
    )
    .orderBy(desc(priceHistory.scraped_at))
    .limit(500);

  return Response.json(rows);
}
```

### SCRAPER_REGISTRY entry with availabilityType
```typescript
// src/flights/scrapers/index.ts (modified registry shape)
export const SCRAPER_REGISTRY: Record<string, ScraperRegistryEntry> = {
  'aa-cdp': {
    search: searchAACdp,
    availabilityType: 'confirmed',
    allianceCoverage: 'oneworld',
  },
  'flying-blue-cdp': {
    search: searchFlyingBlueCdp,
    availabilityType: 'confirmed',
    allianceCoverage: 'skyteam',
  },
  'cathay-curlffi': {
    search: searchCathayCurlFfi,
    availabilityType: 'calendar',  // EXCLUDED from price_history
  },
  'alaska-curlffi': {
    search: searchAlaskaCurlFfi,
    availabilityType: 'confirmed',
  },
};
```

### Better Auth table generation
```bash
# Generate Better Auth schema for PostgreSQL + Drizzle adapter
# Source: https://www.better-auth.com/docs/installation
npx @better-auth/cli generate --adapter drizzle --database postgres

# This outputs schema additions for: user, session, account, verification tables
# Merge into db-schema.ts, then run drizzle-kit migrate
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw SQL migration scripts | drizzle-kit generate + migrate | 2023+ | Schema-as-code, tracked in git, type-safe |
| NextAuth (next-auth) | Better Auth | 2024 | First-class Drizzle adapter, Next.js 15 App Router support |
| Storing all results in JSONB | Normalized columns per flight | Phase 1 decision | Enables time-series queries without JSON extraction |
| flight_cache JSONB blob | price_history normalized rows | Phase 1 | cache = current state, history = append-only time-series |

**Deprecated/outdated:**
- `monitor_scans` table: stores JSONB results blob — this pattern is exactly what `price_history` replaces for time-series data. `monitor_scans` can stay for daemon health tracking but should not be used for price analysis.

---

## Open Questions

1. **Next.js app location in repo**
   - What we know: INFR-04 requires Next.js on Vercel. Current repo has Express at `src/flights/web-server.ts` and static files at `web/public/`.
   - What's unclear: Does Next.js live in this same repo (monorepo approach) or a separate repo? Vercel can deploy from a subdirectory.
   - Recommendation: Add `app/` at repo root (Next.js App Router convention). Vercel can detect this automatically. Keep Express daemon code in `src/flights/`. This is the simplest path.

2. **AWS RDS connection limits from Vercel**
   - What we know: RDS free tier has connection limits. Vercel serverless functions can spike to many concurrent instances.
   - What's unclear: Whether the existing `pg` pool config (max: 10) is safe for serverless cold starts.
   - Recommendation: Use `max: 5` in the Drizzle/Vercel pg pool, or use `@vercel/postgres` which handles connection pooling via PgBouncer. Flag for Phase 3 if connection errors appear.

3. **Better Auth version compatibility with Next.js 15**
   - What we know: STATE.md notes "Better Auth pg adapter + Next.js 16 integration is medium confidence — research during Phase 6 planning."
   - What's unclear: Exact compatibility matrix. Better Auth is relatively new (v1.x).
   - Recommendation: Scaffold Better Auth tables in Phase 1 using their CLI, but don't wire up the auth logic until Phase 6. Tables are stable even if auth code evolves.

---

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/flights/db.ts` — existing raw pg pool pattern, all current tables
- Project codebase: `src/flights/scrapers/index.ts` — SCRAPER_REGISTRY structure to extend
- Project codebase: `package.json` — confirmed pg ^8.13.1, no Drizzle yet
- CONTEXT.md — locked decisions on price_history granularity and availabilityType

### Secondary (MEDIUM confidence)
- Drizzle ORM official docs (https://orm.drizzle.team) — schema DSL, drizzle-kit migration workflow, node-postgres adapter
- Better Auth official docs (https://www.better-auth.com/docs) — PostgreSQL adapter, Drizzle integration, CLI generator

### Tertiary (LOW confidence)
- Connection pooling behavior on Vercel serverless — verify during Phase 3 integration testing
- Better Auth + Next.js 15 exact compatibility — verify during Phase 6

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing pg pool is confirmed; Drizzle is the obvious addition for schema-as-code
- Architecture: HIGH — patterns derived directly from existing codebase structure and locked decisions
- Pitfalls: MEDIUM — Flying Blue session expiry and pg connection limits are known project-specific risks from MEMORY.md and STATE.md; Drizzle push/migrate pitfall is general but well-documented

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (30 days — stable libraries, no fast-moving dependencies)
