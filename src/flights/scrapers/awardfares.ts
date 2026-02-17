/**
 * AwardFares Scraper
 * 
 * AwardFares (awardfares.com) is an award flight aggregator covering 16+ programs
 * and 150+ airlines. It has a freemium model with limited free searches.
 * 
 * Architecture: React SPA behind Cloudflare. The frontend makes XHR calls to
 * internal API endpoints. We replicate those calls.
 * 
 * Known endpoints (discovered via browser network tab):
 *   - POST https://awardfares.com/api/search — main search
 *   - GET  https://awardfares.com/api/config  — programs/airlines config
 * 
 * Auth: Cookie-based session after login. Free tier gets ~5 searches/day.
 *       Pro ($9.99/mo) gets unlimited. Gold ($19.99/mo) adds alerts.
 * 
 * Status: EXPERIMENTAL — Cloudflare blocks simple fetch. Needs browser automation
 *         or session cookie extraction.
 * 
 * Created: 2026-02-16
 */

import { FlightResult, SearchParams, CabinCode } from '../types.js';
import { getCached, setCache } from './cache.js';

// ============================================================
// CONFIGURATION
// ============================================================

const AWARDFARES_BASE = 'https://awardfares.com';

// Session cookie from browser — set via env: AWARDFARES_SESSION
function getSessionCookie(): string | null {
  return process.env.AWARDFARES_SESSION || null;
}

const CABIN_MAP: Record<CabinCode, string> = {
  economy: 'economy',
  business: 'business',
  first: 'first',
};

// AwardFares program codes
const PROGRAM_MAP: Record<string, string> = {
  'united': 'UA',
  'aeroplan': 'AC',
  'ana': 'NH',
  'singapore': 'SQ',
  'turkish': 'TK',
  'ba-avios': 'BA',
  'american': 'AA',
  'delta': 'DL',
  'air-france-klm': 'AF',
  'emirates': 'EK',
  'qantas': 'QF',
  'alaska': 'AS',
  'lifemiles': 'AV',
  'etihad': 'EY',
};

// ============================================================
// API METHODS
// ============================================================

interface AwardFaresSearchParams {
  from: string;
  to: string;
  date: string;
  cabin: string;
  programs?: string[];
}

/**
 * Search AwardFares via their internal API.
 * Requires a valid session cookie (extract from browser after logging in).
 */
async function apiSearch(params: AwardFaresSearchParams): Promise<any> {
  const session = getSessionCookie();
  if (!session) {
    throw new Error('AWARDFARES_SESSION not set. Log into awardfares.com in a browser and extract the session cookie.');
  }

  // AwardFares uses a hash-based URL scheme for searches:
  // https://awardfares.com/search?from=JFK&to=NRT&date=2026-03-15&cabin=business
  // The actual data comes from XHR to their API
  
  const searchUrl = `${AWARDFARES_BASE}/api/search`;
  
  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': session,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': AWARDFARES_BASE,
      'Referer': `${AWARDFARES_BASE}/search`,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      origin: params.from,
      destination: params.to,
      date: params.date,
      cabin: params.cabin,
      programs: params.programs || [],
    }),
  });

  if (response.status === 403) {
    throw new Error('AwardFares: Cloudflare blocked request. Need fresh session cookie or browser automation.');
  }
  
  if (response.status === 401) {
    throw new Error('AwardFares: Session expired. Re-extract cookie from browser.');
  }

  if (!response.ok) {
    throw new Error(`AwardFares API error: ${response.status}`);
  }

  return response.json();
}

// ============================================================
// PUBLIC SEARCH
// ============================================================

export async function searchAwardFares(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = `awardfares:${params.origin}-${params.destination}:${params.date}:${params.cabin}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const data = await apiSearch({
      from: params.origin,
      to: params.destination,
      date: params.date,
      cabin: CABIN_MAP[params.cabin],
    });

    const results = parseResults(data, params);
    if (results.length > 0) {
      setCache(cacheKey, results);
    }
    return results;
  } catch (error) {
    console.error('[AwardFares] Search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

function parseResults(data: any, params: SearchParams): FlightResult[] {
  const results: FlightResult[] = [];
  const items = Array.isArray(data) ? data : (data?.results || data?.flights || data?.data || []);

  for (const item of items) {
    try {
      results.push({
        source: 'awardfares',
        airline: item.airline || item.carrier || item.operating_carrier || 'Unknown',
        flightNumber: item.flight_number || item.flightNumber || '',
        origin: item.origin || item.from || params.origin,
        destination: item.destination || item.to || params.destination,
        departureDate: item.date || item.departure_date || params.date,
        departureTime: item.departure_time || item.departureTime || '',
        arrivalTime: item.arrival_time || item.arrivalTime || '',
        duration: item.duration || '',
        stops: item.stops ?? 0,
        cabin: params.cabin,
        pointsRequired: item.miles || item.points || item.mileage_cost,
        pointsProgram: item.program || item.loyalty_program || 'Unknown',
        taxesAndFees: item.taxes || item.tax,
        awardType: 'saver',
        scrapedAt: new Date().toISOString(),
        bookingUrl: item.booking_url || `${AWARDFARES_BASE}/search`,
      });
    } catch {
      // skip
    }
  }

  return results;
}

// ============================================================
// ALTERNATIVE: URL-based search (no API, just construct search URL)
// ============================================================

/**
 * Generate AwardFares search URL for manual use or browser automation.
 */
export function getSearchUrl(params: SearchParams): string {
  const cabin = CABIN_MAP[params.cabin];
  return `${AWARDFARES_BASE}/search?from=${params.origin}&to=${params.destination}&date=${params.date}&cabin=${cabin}`;
}

export default { searchAwardFares, getSearchUrl };
