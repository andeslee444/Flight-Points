/**
 * ExpertFlyer Scraper
 * 
 * ExpertFlyer (expertflyer.com) shows real-time award seat availability
 * by querying GDS systems (Amadeus/Sabre) directly.
 * 
 * Architecture: Server-rendered pages with AJAX updates. Login required.
 * - Basic: $49.99/yr (250 queries/mo, 4 alerts)
 * - Premium: $99.99/yr (unlimited queries, 200 alerts)
 * 
 * The key data ExpertFlyer provides that others don't:
 * - Raw booking class availability (e.g., "I2" = 2 seats in I class on United)
 * - Seat maps
 * - Fare rules
 * 
 * Auth: Cookie-based login session.
 * Set env: EXPERTFLYER_SESSION (cookie string from browser)
 * 
 * Status: EXPERIMENTAL — requires paid account + session cookie extraction.
 * 
 * Created: 2026-02-16
 */

import { FlightResult, SearchParams, CabinCode } from '../types.js';
import { getCached, setCache } from './cache.js';

// ============================================================
// CONFIGURATION
// ============================================================

const EF_BASE = 'https://www.expertflyer.com';

function getSessionCookie(): string | null {
  return process.env.EXPERTFLYER_SESSION || null;
}

// Award booking classes by airline that indicate award availability
const AWARD_CLASSES: Record<string, string[]> = {
  // United: X = saver economy, I = saver business, O = saver first
  'UA': ['X', 'XN', 'I', 'IN', 'O', 'ON'],
  // ANA: O = first, I = business, X = economy (partner awards)
  'NH': ['O', 'I', 'X'],
  // Singapore: X = economy, I = business, O = first (Star Alliance awards)
  'SQ': ['X', 'I', 'O'],
  // Cathay/BA: X = economy, I = business, O = first
  'CX': ['X', 'I', 'O'],
  // AA: not reliably shown in GDS for award classes
  'AA': [],
};

const CABIN_TO_CLASSES: Record<CabinCode, string[]> = {
  economy: ['X', 'XN'],
  business: ['I', 'IN'],
  first: ['O', 'ON'],
};

// ============================================================
// SEARCH
// ============================================================

/**
 * Search ExpertFlyer for award class availability.
 * This checks specific booking classes in the GDS that correspond to award seats.
 */
export async function searchExpertFlyer(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = `expertflyer:${params.origin}-${params.destination}:${params.date}:${params.cabin}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const session = getSessionCookie();
  if (!session) {
    console.log('[ExpertFlyer] EXPERTFLYER_SESSION not set. Skipping.');
    return [];
  }

  try {
    // ExpertFlyer uses a multi-step search:
    // 1. POST search params to get a search ID
    // 2. Poll for results
    const searchId = await initiateSearch(params, session);
    if (!searchId) return [];

    const rawResults = await pollResults(searchId, session);
    const results = parseResults(rawResults, params);

    if (results.length > 0) {
      setCache(cacheKey, results);
    }
    return results;
  } catch (error) {
    console.error('[ExpertFlyer] Search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

async function initiateSearch(params: SearchParams, session: string): Promise<string | null> {
  const classes = CABIN_TO_CLASSES[params.cabin] || ['I'];
  
  // ExpertFlyer award search form submission
  const formData = new URLSearchParams({
    'searchType': 'AWARD',
    'origin': params.origin,
    'destination': params.destination,
    'departDate': formatDate(params.date),
    'cabinClasses': classes.join(','),
    'numPassengers': '1',
    'nonstopOnly': 'false',
  });

  const response = await fetch(`${EF_BASE}/flightSearch.do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': session,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': `${EF_BASE}/flightSearch.do`,
    },
    body: formData.toString(),
    redirect: 'manual',
  });

  // ExpertFlyer redirects to results page with search ID
  const location = response.headers.get('location') || '';
  const match = location.match(/searchId=(\w+)/);
  
  if (match) return match[1];

  // Try parsing from response body
  if (response.ok) {
    const body = await response.text();
    const idMatch = body.match(/searchId['":\s]+['"]?(\w+)/);
    return idMatch ? idMatch[1] : null;
  }

  return null;
}

async function pollResults(searchId: string, session: string, maxAttempts = 10): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const response = await fetch(`${EF_BASE}/flightSearchResults.do?searchId=${searchId}`, {
      headers: {
        'Cookie': session,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/json',
      },
    });

    if (!response.ok) continue;

    const body = await response.text();
    
    // Check if results are ready (not still loading)
    if (body.includes('searchInProgress') || body.includes('loading')) {
      continue;
    }

    return body;
  }

  return null;
}

function parseResults(html: any, params: SearchParams): FlightResult[] {
  if (!html || typeof html !== 'string') return [];

  const results: FlightResult[] = [];

  // ExpertFlyer results are in HTML tables
  // Parse flight rows — look for patterns like:
  // Flight: UA 7 | JFK-NRT | I2 O0 (2 seats in I class, 0 in O)
  const flightPattern = /(?:flight|flt)[^>]*>([A-Z]{2})\s*(\d+)[^<]*<.*?(\d{2}:\d{2}).*?(\d{2}:\d{2}).*?(?:([XIOCDN]\d+)\s*)+/gi;
  
  // Simpler: look for award class availability indicators
  const classPattern = /([A-Z]{2})\s+(\d{1,4})\b.*?([XIOCDN])(\d+)/g;
  let match;

  while ((match = classPattern.exec(html)) !== null) {
    const [, airline, flightNum, bookingClass, seats] = match;
    const seatCount = parseInt(seats);
    
    if (seatCount <= 0) continue;
    
    // Check if this booking class matches our cabin
    const targetClasses = CABIN_TO_CLASSES[params.cabin];
    if (!targetClasses.includes(bookingClass)) continue;

    results.push({
      source: 'expertflyer',
      airline,
      flightNumber: `${airline}${flightNum}`,
      origin: params.origin,
      destination: params.destination,
      departureDate: params.date,
      departureTime: '',
      arrivalTime: '',
      duration: '',
      stops: 0,
      cabin: params.cabin,
      pointsRequired: undefined,
      pointsProgram: `GDS (${bookingClass}${seatCount} avail)`,
      awardType: 'saver',
      scrapedAt: new Date().toISOString(),
      bookingUrl: `${EF_BASE}/flightSearch.do`,
    });
  }

  return results;
}

function formatDate(dateStr: string): string {
  // Convert 2026-03-15 to 03/15/2026 for ExpertFlyer
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

/**
 * Generate ExpertFlyer search URL for manual use.
 */
export function getSearchUrl(params: SearchParams): string {
  return `${EF_BASE}/flightSearch.do`;
}

export default { searchExpertFlyer, getSearchUrl };
