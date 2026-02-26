/**
 * Drizzle ORM client for Vercel/Next.js reads.
 *
 * The daemon write path continues to use the raw pg pool in db.ts.
 * This module is exclusively for the Next.js app/ directory on Vercel.
 * Do NOT import from this file in daemon code (src/flights/flight-daemon.ts,
 * scrapers/, etc.) — it would bleed Vercel-only dependencies into daemon builds.
 *
 * Usage (Next.js app route):
 *   import { getDrizzle } from '@/flights/db-drizzle';
 *   const db = getDrizzle();
 *   const rows = await db.select().from(priceHistory).where(...);
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './db-schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDrizzle(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 5, // lower limit for Vercel serverless cold starts
  });
  _db = drizzle(pool, { schema });
  return _db;
}
