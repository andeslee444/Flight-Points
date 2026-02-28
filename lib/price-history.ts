/**
 * Server-side query for price history data.
 *
 * Aggregates MIN(miles) per day from price_history table for a given
 * route and cabin. Used by the history API route and server components.
 *
 * Safe for Vercel RSC context — no daemon-only imports.
 */

import { getDrizzle } from '@/src/flights/db-drizzle';
import { sql } from 'drizzle-orm';

export interface HistoryPoint {
  date: string;  // YYYY-MM-DD
  miles: number; // MIN(miles) for that day
}

export async function getPriceHistory(
  origin: string,
  destination: string,
  cabin: string,
  days: number = 30,
): Promise<HistoryPoint[]> {
  const db = getDrizzle();
  const result = await db.execute(
    sql`SELECT
          DATE(scraped_at) AS date,
          MIN(miles)       AS miles
        FROM price_history
        WHERE origin      = ${origin.toUpperCase()}
          AND destination = ${destination.toUpperCase()}
          AND cabin       = ${cabin}
          AND scraped_at >= NOW() - INTERVAL '1 day' * ${days}
          AND availability_type = 'confirmed'
        GROUP BY DATE(scraped_at)
        ORDER BY date ASC`,
  );
  return result.rows.map((r: Record<string, unknown>) => ({
    date: String(r.date).slice(0, 10),
    miles: Number(r.miles),
  }));
}
