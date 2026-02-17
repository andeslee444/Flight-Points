/**
 * Korean Air (KE) SkyTeam Award Search
 * 
 * STATUS: ❌ Direct scraping NOT viable
 * 
 * Korean Air's website (koreanair.com) is protected by Akamai Bot Manager.
 * Award search requires SKYPASS login. No guest search available.
 * seats.aero does NOT have a "korean" source.
 * 
 * WORKAROUND: SkyTeam coverage via Flying Blue + Delta sources on seats.aero
 * - Flying Blue (flyingblue): Shows AF/KL/KE/SkyTeam partner availability with fixed pricing
 * - Delta (delta): Shows DL/SkyTeam availability but with dynamic (expensive) pricing
 * 
 * For Korean Air metal flights specifically:
 * - Flying Blue is the best source (fixed award chart, cheaper than Delta SkyMiles)
 * - Delta shows KE partner space but at Delta's dynamic rates (170k+ for J)
 * 
 * Created: 2026-02-16
 */

import { FlightResult, SearchParams, CabinCode } from '../types.js';
import { getCached, setCache } from './cache.js';

const SEATS_AERO_API_BASE = 'https://seats.aero/partnerapi';

function getApiKey(): string | null {
  return process.env.SEATS_AERO_API_KEY || null;
}

const CABIN_TO_FIELD: Record<string, { avail: string; miles: string; seats: string }> = {
  economy: { avail: 'YAvailable', miles: 'YMileageCost', seats: 'YRemainingSeats' },
  business: { avail: 'JAvailable', miles: 'JMileageCost', seats: 'JRemainingSeats' },
  first: { avail: 'FAvailable', miles: 'FMileageCost', seats: 'FRemainingSeats' },
};

interface SkyTeamAvailability {
  source: 'flyingblue' | 'delta';
  date: string;
  available: boolean;
  miles: number;
  remainingSeats: number;
  origin: string;
  destination: string;
  cabin: string;
}

/**
 * Search SkyTeam award availability via seats.aero Flying Blue + Delta sources.
 * This is the best available proxy for Korean Air / SkyTeam coverage.
 */
export async function searchSkyTeam(params: SearchParams): Promise<SkyTeamAvailability[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[korean-air] No SEATS_AERO_API_KEY set');
    return [];
  }

  const cabin = params.cabin || 'business';
  const fields = CABIN_TO_FIELD[cabin];
  if (!fields) return [];

  const results: SkyTeamAvailability[] = [];

  // Query both Flying Blue and Delta for SkyTeam coverage
  for (const source of ['flyingblue', 'delta'] as const) {
    const cacheKey = `ke-skyteam-${source}-${params.origin}-${params.destination}-${params.date}-${cabin}`;
    const cached = getCached(cacheKey);
    if (cached) {
      results.push(...(cached as SkyTeamAvailability[]));
      continue;
    }

    try {
      const url = new URL(`${SEATS_AERO_API_BASE}/availability`);
      url.searchParams.set('source', source);
      url.searchParams.set('origin_airport', params.origin);
      url.searchParams.set('destination_airport', params.destination);

      const resp = await fetch(url.toString(), {
        headers: { 'Partner-Authorization': apiKey },
      });

      if (!resp.ok) {
        console.warn(`[korean-air] seats.aero ${source} returned ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const items = Array.isArray(data) ? data : data.data || [];

      const sourceResults: SkyTeamAvailability[] = [];
      for (const item of items) {
        // Filter to requested date if specified
        if (params.date && item.Date !== params.date) continue;

        if (item[fields.avail]) {
          sourceResults.push({
            source,
            date: item.Date,
            available: true,
            miles: parseInt(item[fields.miles]) || 0,
            remainingSeats: item[fields.seats] || 0,
            origin: params.origin,
            destination: params.destination,
            cabin,
          });
        }
      }

      setCache(cacheKey, sourceResults, 3600); // 1hr cache
      results.push(...sourceResults);
    } catch (err) {
      console.error(`[korean-air] Error querying ${source}:`, err);
    }
  }

  return results;
}

/**
 * Convert SkyTeam availability to standard FlightResult format.
 * Note: seats.aero cached data doesn't include flight-level detail (flight numbers, times).
 * Results represent date-level availability.
 */
export function toFlightResults(avail: SkyTeamAvailability[]): FlightResult[] {
  return avail.map(a => ({
    airline: a.source === 'flyingblue' ? 'AF/KL/KE' : 'DL/KE',
    flightNumber: 'unknown', // seats.aero cached doesn't include flight numbers
    origin: a.origin,
    destination: a.destination,
    departureTime: `${a.date}T00:00:00Z`,
    arrivalTime: `${a.date}T00:00:00Z`,
    duration: 0,
    stops: -1, // unknown
    cabin: a.cabin as any,
    miles: a.miles,
    taxes: 0,
    seatsAvailable: a.remainingSeats,
    source: `seats.aero/${a.source}`,
  }));
}

// Export as scraper interface
export const koreanAirScraper = {
  name: 'korean-air-skyteam',
  async search(params: SearchParams) {
    const avail = await searchSkyTeam(params);
    return {
      flights: toFlightResults(avail),
      searchedAt: new Date().toISOString(),
      source: 'korean-air-skyteam (via seats.aero flyingblue+delta)',
      error: avail.length === 0 ? 'No SkyTeam availability found (seats.aero cached data)' : undefined,
    };
  },
};
