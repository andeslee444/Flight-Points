/**
 * Server-side data access for the deal feed.
 *
 * Reads flight_cache from PostgreSQL via Drizzle raw SQL (flight_cache is a JSONB
 * table NOT in the Drizzle schema — use getDrizzle().execute() with raw SQL).
 * Enriches with CPP, sweet spot matching, and transfer partner info.
 * Returns top N deals sorted by CPP descending.
 *
 * Safe for Vercel RSC context — no daemon-only imports.
 */

import { getDrizzle } from '@/src/flights/db-drizzle';
import { sql } from 'drizzle-orm';
import {
  enrichFlightResult,
  NON_BOOKABLE_SOURCES,
  type EnrichedDeal,
} from './enrichment';
import {
  POINTS_PROGRAMS,
  getTransferPartnersForProgram,
} from '@/src/flights/transfer-partners';

export type { EnrichedDeal } from './enrichment';

export async function getTopDeals({ limit = 50 }: { limit?: number } = {}): Promise<
  EnrichedDeal[]
> {
  const db = getDrizzle();

  const result = await db.execute(
    sql`SELECT origin, destination, date, cabin, award_flights, updated_at
        FROM flight_cache
        ORDER BY updated_at DESC
        LIMIT 200`,
  );

  // Flatten all award_flights across all cache entries, filtering non-bookable sources
  const rawFlights: Record<string, unknown>[] = [];
  for (const row of result.rows) {
    const flights = Array.isArray(row.award_flights) ? row.award_flights : [];
    for (const f of flights as Record<string, unknown>[]) {
      if (
        f.pointsRequired &&
        (f.pointsRequired as number) > 0 &&
        !NON_BOOKABLE_SOURCES.has(f.source as string)
      ) {
        rawFlights.push(f);
      }
    }
  }

  if (rawFlights.length === 0) {
    return [];
  }

  // Use amex-mr as default program perspective (most popular transfer program)
  const defaultProgram =
    POINTS_PROGRAMS.find((p) => p.slug === 'amex-mr') || POINTS_PROGRAMS[0];
  const defaultPartners = getTransferPartnersForProgram(defaultProgram.slug);

  const deals: EnrichedDeal[] = rawFlights.map((f) =>
    enrichFlightResult(f, defaultProgram.slug, defaultPartners, defaultProgram.name),
  );

  // Sort by CPP descending (best value first), fallback to points ascending
  deals.sort((a, b) => {
    if (a.cpp !== undefined && b.cpp !== undefined) return b.cpp - a.cpp;
    if (a.cpp !== undefined) return -1;
    if (b.cpp !== undefined) return 1;
    return a.pointsRequired - b.pointsRequired;
  });

  // Deduplicate by route+cabin+airline — keep best CPP per combo (already sorted)
  const deduped: EnrichedDeal[] = [];
  const seen = new Set<string>();
  for (const deal of deals) {
    const key = `${deal.origin}-${deal.destination}-${deal.cabin}-${deal.airline}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(deal);
    }
  }

  return deduped.slice(0, limit);
}
