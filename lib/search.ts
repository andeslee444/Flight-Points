/**
 * Server-side data access for flight search results.
 *
 * Reads flight_cache from PostgreSQL via Drizzle raw SQL, filtered by
 * origin/destination/cabin. Returns enriched deals sorted by CPP descending.
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
import { getDealMaxAgeHours } from './deals';

export interface SearchResultsParams {
  from: string; // comma-separated or single IATA code
  to: string; // comma-separated or single IATA code
  cabin?: string; // 'economy' | 'business' | 'first' | 'any'
  program?: string; // program slug e.g. 'amex-mr'
  date?: string; // YYYY-MM-DD — filter results on or after this date
}

export async function getSearchResults(params: SearchResultsParams): Promise<EnrichedDeal[]> {
  const origins = params.from
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const dests = params.to
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const cabin = params.cabin === 'any' ? null : (params.cabin || 'business');
  const programSlug = params.program || 'amex-mr';

  const db = getDrizzle();
  const maxAgeHours = getDealMaxAgeHours();
  // flight_cache is NOT in Drizzle schema — use raw SQL (same as getTopDeals)
  const result = await db.execute(
    sql`SELECT origin, destination, date, cabin, award_flights, updated_at
        FROM flight_cache
        WHERE origin = ANY(${origins})
        AND destination = ANY(${dests})
        AND updated_at >= NOW() - INTERVAL '1 hour' * ${maxAgeHours}
        ${cabin ? sql`AND cabin = ${cabin}` : sql``}
        ORDER BY updated_at DESC`,
  );

  const programInfo = POINTS_PROGRAMS.find((p) => p.slug === programSlug) || POINTS_PROGRAMS[0];
  const partners = getTransferPartnersForProgram(programSlug);

  const rawFlights: Record<string, unknown>[] = [];

  for (const row of result.rows) {
    const flights = Array.isArray(row.award_flights) ? row.award_flights : [];
    for (const f of flights as Record<string, unknown>[]) {
      if (
        f.pointsRequired &&
        (f.pointsRequired as number) > 0 &&
        !NON_BOOKABLE_SOURCES.has(f.source as string)
      ) {
        rawFlights.push({ ...f, scrapedAt: row.updated_at });
      }
    }
  }

  let deals = rawFlights.map((f) =>
    enrichFlightResult(f, programSlug, partners, programInfo.name),
  );

  // Date filter: only show flights on or after the requested date
  if (params.date) {
    deals = deals.filter((d) => d.departureDate >= params.date!);
  }

  // Sort by CPP descending (best value first), fallback to points ascending
  deals.sort((a, b) => {
    if (a.cpp !== undefined && b.cpp !== undefined) return b.cpp - a.cpp;
    if (a.cpp !== undefined) return -1;
    if (b.cpp !== undefined) return 1;
    return a.pointsRequired - b.pointsRequired;
  });

  return deals;
}
