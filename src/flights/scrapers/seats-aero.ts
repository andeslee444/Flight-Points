/**
 * seats.aero Award Search Scraper
 * 
 * seats.aero is the premier award availability aggregator with an official API.
 * - Pro API: 1,000 calls/day with Pro subscription ($10/mo)
 * - Partner API: commercial access (contact support@seats.aero)
 * - Endpoints: Cached Search, Bulk Availability, Get Trips, Get Routes, Live Search
 * 
 * API Docs: https://developers.seats.aero/
 * Auth: Partner-Authorization header with pro_xxx key
 * 
 * This is the BEST data source — covers United, Aeroplan, Virgin Atlantic,
 * Singapore, ANA, BA Avios, AA, Delta, Emirates, Turkish, Flying Blue, LifeMiles, Qantas.
 * 
 * Created: 2026-02-16
 */

import { FlightResult, SearchParams, CabinCode } from '../types.js';
import { getCached, setCache } from './cache.js';

// ============================================================
// CONFIGURATION
// ============================================================

const SEATS_AERO_API_BASE = 'https://seats.aero/partnerapi';

// Set via environment variable: SEATS_AERO_API_KEY=pro_xxxxxxxxxxxxxxxxxxxxx
function getApiKey(): string | null {
  return process.env.SEATS_AERO_API_KEY || null;
}

// seats.aero source program codes
export const SEATS_AERO_SOURCES = [
  'united', 'aeroplan', 'virginatlantic', 'singapore', 'ana',
  'british_airways', 'american', 'delta', 'emirates', 'turkish',
  'airfrance', 'lifemiles', 'qantas', 'smiles', 'velocity',
  'etihad', 'alaska',
] as const;

type SeatsAeroSource = typeof SEATS_AERO_SOURCES[number];

// Cabin class mapping
const CABIN_MAP: Record<CabinCode, string> = {
  economy: 'economy',
  business: 'business',
  first: 'first',
};

// Source to friendly name
const SOURCE_NAMES: Record<string, string> = {
  'united': 'United MileagePlus',
  'aeroplan': 'Air Canada Aeroplan',
  'virginatlantic': 'Virgin Atlantic',
  'singapore': 'Singapore KrisFlyer',
  'ana': 'ANA Mileage Club',
  'british_airways': 'British Airways Avios',
  'american': 'American AAdvantage',
  'delta': 'Delta SkyMiles',
  'emirates': 'Emirates Skywards',
  'turkish': 'Turkish Miles&Smiles',
  'airfrance': 'Air France/KLM Flying Blue',
  'lifemiles': 'Avianca LifeMiles',
  'qantas': 'Qantas Frequent Flyer',
  'smiles': 'GOL Smiles',
  'velocity': 'Virgin Australia Velocity',
  'etihad': 'Etihad Guest',
  'alaska': 'Alaska Mileage Plan',
};

// ============================================================
// API HELPERS
// ============================================================

async function apiRequest(endpoint: string, params?: Record<string, string>): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('SEATS_AERO_API_KEY not set. Get a Pro subscription at seats.aero and set the environment variable.');
  }

  const url = new URL(`${SEATS_AERO_API_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Partner-Authorization': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (response.status === 429) {
      throw new Error(`seats.aero rate limit exceeded. Remaining: ${remaining}`);
    }
    throw new Error(`seats.aero API error: ${response.status} ${response.statusText}`);
  }

  const remaining = response.headers.get('X-RateLimit-Remaining');
  if (remaining) {
    console.log(`[seats.aero] API calls remaining today: ${remaining}`);
  }

  return response.json();
}

// ============================================================
// SEARCH ENDPOINTS
// ============================================================

/**
 * Cached Search — query pre-cached availability data
 * Fast, no live scraping. Best for initial searches.
 */
export async function cachedSearch(params: SearchParams, source?: SeatsAeroSource): Promise<FlightResult[]> {
  const cacheKey = `seats-aero:${params.origin}-${params.destination}:${params.date}:${params.cabin}:${source || 'all'}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const queryParams: Record<string, string> = {
      origin_airport: params.origin,
      destination_airport: params.destination,
      departure_date: params.date,
      cabin: CABIN_MAP[params.cabin],
    };

    if (source) {
      queryParams.source = source;
    }

    const data = await apiRequest('/search', queryParams);
    const results = parseSeatsAeroResults(data, params);

    if (results.length > 0) {
      setCache(cacheKey, results);
    }

    return results;
  } catch (error) {
    console.error('[seats.aero] Cached search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Bulk Availability — get large dataset from a specific program
 * Good for monitoring routes over date ranges.
 */
export async function bulkAvailability(source: SeatsAeroSource, params?: {
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  cabin?: CabinCode;
}): Promise<FlightResult[]> {
  try {
    const queryParams: Record<string, string> = {
      source,
    };

    if (params?.origin) queryParams.origin_airport = params.origin;
    if (params?.destination) queryParams.destination_airport = params.destination;
    if (params?.startDate) queryParams.start_date = params.startDate;
    if (params?.endDate) queryParams.end_date = params.endDate;
    if (params?.cabin) queryParams.cabin = CABIN_MAP[params.cabin];

    const data = await apiRequest('/availability', queryParams);
    return parseBulkResults(data, source);
  } catch (error) {
    console.error('[seats.aero] Bulk availability error:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Live Search — triggers fresh scrape at seats.aero
 * Slower but most current. Uses POST endpoint.
 * Use sparingly (counts against daily limit).
 */
export async function liveSearch(params: SearchParams, source: SeatsAeroSource): Promise<FlightResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('SEATS_AERO_API_KEY not set.');
  }

  try {
    const url = `${SEATS_AERO_API_BASE}/search`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Partner-Authorization': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        origin_airport: params.origin,
        destination_airport: params.destination,
        departure_date: params.date,
        cabin: CABIN_MAP[params.cabin],
        source,
      }),
    });

    if (!response.ok) {
      throw new Error(`Live search failed: ${response.status}`);
    }

    const data = await response.json();
    return parseSeatsAeroResults(data, params);
  } catch (error) {
    console.error('[seats.aero] Live search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Get Routes — discover available routes for a source
 */
export async function getRoutes(source: SeatsAeroSource): Promise<Array<{ origin: string; destination: string }>> {
  try {
    const data = await apiRequest('/routes', { source });
    return Array.isArray(data) ? data.map((r: any) => ({
      origin: r.origin_airport || r.origin,
      destination: r.destination_airport || r.destination,
    })) : [];
  } catch (error) {
    console.error('[seats.aero] Get routes error:', error instanceof Error ? error.message : error);
    return [];
  }
}

// ============================================================
// RESULT PARSERS
// ============================================================

function parseSeatsAeroResults(data: any, params: SearchParams): FlightResult[] {
  const results: FlightResult[] = [];

  // seats.aero returns array of availability objects
  const items = Array.isArray(data) ? data : (data?.data || data?.results || data?.trips || []);

  for (const item of items) {
    try {
      const source = item.source || item.program || 'unknown';
      const cabin = normalizeCabin(item.cabin || params.cabin);

      results.push({
        source: `seats-aero-${source}`,
        airline: item.airline || item.operating_airline || item.marketing_airline || 'Unknown',
        flightNumber: item.flight_number || item.flights || '',
        origin: item.origin_airport || item.origin || params.origin,
        destination: item.destination_airport || item.destination || params.destination,
        departureDate: item.departure_date || item.date || params.date,
        departureTime: item.departure_time || '',
        arrivalTime: item.arrival_time || '',
        duration: item.duration || '',
        stops: item.stops ?? item.segments ? (item.segments - 1) : 0,
        cabin,
        pointsRequired: item.mileage_cost || item.points || item.miles,
        pointsProgram: SOURCE_NAMES[source] || source,
        taxesAndFees: item.taxes || item.tax_cost || item.fees,
        awardType: item.award_type === 'saver' ? 'saver' : (item.award_type === 'partner' ? 'partner' : 'everyday'),
        scrapedAt: new Date().toISOString(),
        bookingUrl: item.booking_url || `https://seats.aero`,
      });
    } catch {
      // Skip unparseable
    }
  }

  return results;
}

function parseBulkResults(data: any, source: SeatsAeroSource): FlightResult[] {
  const items = Array.isArray(data) ? data : (data?.data || []);

  return items.map((item: any) => ({
    source: `seats-aero-${source}`,
    airline: item.airline || item.operating_airline || 'Unknown',
    flightNumber: item.flight_number || '',
    origin: item.origin_airport || item.origin || '',
    destination: item.destination_airport || item.destination || '',
    departureDate: item.departure_date || item.date || '',
    departureTime: item.departure_time || '',
    arrivalTime: item.arrival_time || '',
    duration: item.duration || '',
    stops: item.stops ?? 0,
    cabin: normalizeCabin(item.cabin),
    pointsRequired: item.mileage_cost || item.points,
    pointsProgram: SOURCE_NAMES[source] || source,
    taxesAndFees: item.taxes || item.tax_cost,
    awardType: 'saver' as const,
    scrapedAt: new Date().toISOString(),
    bookingUrl: `https://seats.aero`,
  })).filter((r: FlightResult) => r.origin && r.destination);
}

function normalizeCabin(cabin: string | undefined): CabinCode {
  if (!cabin) return 'economy';
  const c = cabin.toLowerCase();
  if (c.includes('first') || c === 'f') return 'first';
  if (c.includes('business') || c === 'j' || c === 'c') return 'business';
  return 'economy';
}

// ============================================================
// CONVENIENCE: Multi-source search
// ============================================================

/**
 * Search across all seats.aero sources for a route
 */
export async function searchAllSources(params: SearchParams): Promise<FlightResult[]> {
  return cachedSearch(params); // without source = all sources
}

/**
 * Search specific oneworld sources for a route
 */
export async function searchOneworld(params: SearchParams): Promise<FlightResult[]> {
  const sources: SeatsAeroSource[] = ['british_airways', 'american', 'qantas'];
  const allResults: FlightResult[] = [];

  for (const source of sources) {
    const results = await cachedSearch(params, source);
    allResults.push(...results);
  }

  return allResults;
}

/**
 * Check if API is configured and working
 */
export async function checkApiStatus(): Promise<{ configured: boolean; working: boolean; error?: string }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { configured: false, working: false, error: 'SEATS_AERO_API_KEY not set' };
  }

  try {
    await apiRequest('/routes', { source: 'united' });
    return { configured: true, working: true };
  } catch (error) {
    return { configured: true, working: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export default {
  cachedSearch,
  bulkAvailability,
  liveSearch,
  getRoutes,
  searchAllSources,
  searchOneworld,
  checkApiStatus,
  SEATS_AERO_SOURCES,
};
