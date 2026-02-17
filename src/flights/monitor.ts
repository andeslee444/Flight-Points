/**
 * Award Flight Monitor — Core Engine
 * 
 * Uses our OWN scrapers (Playwright-based) to search airline award availability.
 * No seats.aero dependency — we scrape united.com, aa.com, delta.com, etc. directly.
 * 
 * Architecture:
 *   searchFlights(params)
 *     → Get transfer partners for user's program
 *     → Determine relevant scrapers (united for Star Alliance, aa for oneworld, etc.)
 *     → Run scrapers in parallel with timeout
 *     → Fetch cash prices from Google Flights
 *     → Calculate CPP
 *     → Deduplicate by flight number + date
 *     → Sort and return
 * 
 * Created: 2026-02-16
 * Rewritten: 2026-02-16 — removed seats.aero, added own scrapers
 */

import * as fs from 'fs';
import * as path from 'path';
import { POINTS_PROGRAMS, getTransferPartnersForProgram, type TransferPartner } from './transfer-partners';
import { searchAll } from './scrapers/index';
import type { FlightResult as ScraperFlightResult, SearchParams as ScraperSearchParams } from './types';

// ============================================================
// TYPES
// ============================================================

export interface FlightSignup {
  type: 'route';
  from: string;           // "JFK, EWR, LGA"
  to: string;             // "NRT, HND"
  class: string;          // "Business", "First", "Either"
  program: string;        // "Amex Membership Rewards"
  airlines: string[];
  continuous: boolean;
  startDate: string;
  endDate: string;
  flexible: boolean;
  alertMethod: string;
  contact: string;
  timestamp: string;
}

export interface FlightResult {
  id: string;
  source: string;         // "united" | "aa" | "delta" | "ba-avios" | etc
  airline: string;
  flightNumber?: string;
  origin: string;
  destination: string;
  departureDate: string;
  cabin: string;          // "economy" | "business" | "first"
  cabinDisplay: string;   // "Business", "First Class"
  points: number;
  taxes: number;          // in USD
  program: string;        // Which loyalty program to book through
  programDisplay: string;
  transferPath: string;   // "Transfer 90K Amex MR → ANA Mileage Club"
  cashPrice?: number;     // Comparable cash price
  cpp?: number;           // Cents per point
  dealRating: 'hot' | 'good' | 'fair' | 'unknown';
  direct: boolean;
  stops: number;
  route: string;          // "JFK → NRT"
  bookingUrl?: string;
  lastSeen: string;
  departureTime?: string;
  arrivalTime?: string;
  duration?: string;
  awardType?: string;
}

export interface SearchParams {
  origins: string[];       // ["JFK", "EWR", "LGA"]
  destinations: string[];  // ["NRT", "HND"]
  cabin: string;           // "business" | "first" | "any"
  programSlug: string;     // "amex-mr"
  startDate?: string;
  endDate?: string;
}

// ============================================================
// RESULT PROCESSING
// ============================================================

function cabinDisplayName(cabin: string): string {
  const map: Record<string, string> = {
    economy: 'Economy', premium_economy: 'Premium Economy',
    business: 'Business', first: 'First Class',
  };
  return map[cabin] || cabin;
}

function computeDealRating(cpp: number | undefined): 'hot' | 'good' | 'fair' | 'unknown' {
  if (!cpp) return 'unknown';
  if (cpp >= 3.0) return 'hot';
  if (cpp >= 1.5) return 'good';
  return 'fair';
}

/**
 * Convert scraper FlightResult[] into our monitor FlightResult[] with
 * transfer path info, CPP calculation, and deal ratings.
 */
function processScraperResults(
  scraperResults: ScraperFlightResult[],
  cashPrices: ScraperFlightResult[],
  programSlug: string,
): FlightResult[] {
  const partners = getTransferPartnersForProgram(programSlug);
  const results: FlightResult[] = [];

  // Build a cash price lookup: origin-dest-cabin → lowest cash price
  const cashLookup = new Map<string, number>();
  for (const cp of cashPrices) {
    if (cp.cashPrice && cp.cashPrice > 0) {
      const key = `${cp.origin}-${cp.destination}-${cp.cabin}`;
      const existing = cashLookup.get(key);
      if (!existing || cp.cashPrice < existing) {
        cashLookup.set(key, cp.cashPrice);
      }
    }
  }

  for (const sr of scraperResults) {
    if (!sr.pointsRequired || sr.pointsRequired <= 0) continue;

    // Find the transfer partner that matches this scraper's program
    const partner = findPartnerForSource(sr.source, sr.pointsProgram, partners);

    const ratio = partner?.ratio || 1;
    const pointsNeeded = Math.ceil(sr.pointsRequired * ratio);
    const programName = POINTS_PROGRAMS.find(p => p.slug === programSlug)?.name || programSlug;
    const transferTarget = partner?.program || sr.pointsProgram || sr.source;

    const transferPath = partner
      ? `Transfer ${pointsNeeded.toLocaleString()} ${programName} → ${transferTarget}`
      : `Book via ${sr.pointsProgram || sr.source} (${sr.pointsRequired.toLocaleString()} miles)`;

    // Get cash price for CPP calculation
    const cashKey = `${sr.origin}-${sr.destination}-${sr.cabin}`;
    const cashPrice = cashLookup.get(cashKey) || estimateCashPrice(sr.origin, sr.destination, sr.cabin);
    const cpp = cashPrice ? ((cashPrice * 100 - (sr.taxesAndFees || 0) * 100) / sr.pointsRequired) : undefined;

    results.push({
      id: `${sr.source}-${sr.flightNumber || sr.origin + sr.destination}-${sr.departureDate}-${sr.cabin}`,
      source: sr.source,
      airline: sr.airline,
      flightNumber: sr.flightNumber || undefined,
      origin: sr.origin,
      destination: sr.destination,
      departureDate: sr.departureDate,
      cabin: sr.cabin,
      cabinDisplay: cabinDisplayName(sr.cabin),
      points: sr.pointsRequired,
      taxes: sr.taxesAndFees || 0,
      program: partner?.programCode || sr.source,
      programDisplay: transferTarget,
      transferPath,
      cashPrice,
      cpp: cpp ? Math.round(cpp * 10) / 10 : undefined,
      dealRating: computeDealRating(cpp),
      direct: sr.stops === 0,
      stops: sr.stops >= 0 ? sr.stops : -1,
      route: `${sr.origin} → ${sr.destination}`,
      bookingUrl: sr.bookingUrl,
      lastSeen: new Date().toISOString(),
      departureTime: sr.departureTime,
      arrivalTime: sr.arrivalTime,
      duration: sr.duration,
      awardType: sr.awardType,
    });
  }

  // Sort by CPP descending (best deals first)
  results.sort((a, b) => (b.cpp || 0) - (a.cpp || 0));
  return results;
}

/**
 * Find the transfer partner that matches a scraper source.
 */
function findPartnerForSource(source: string, program: string | undefined, partners: TransferPartner[]): TransferPartner | undefined {
  // Direct match by source → programCode
  const sourceToCode: Record<string, string[]> = {
    'united': ['united'],
    'aa': ['american', 'ba-avios'],
    'delta': ['delta', 'air-france-klm'],
    'ba-avios': ['ba-avios'],
    'aeroplan': ['aeroplan'],
    'ana': ['ana'],
    'ana-estimated': ['ana'],
  };

  const codes = sourceToCode[source] || [];
  for (const code of codes) {
    const match = partners.find(p => p.programCode === code);
    if (match) return match;
  }

  // Try matching by program name
  if (program) {
    const match = partners.find(p =>
      p.program.toLowerCase().includes(program.toLowerCase()) ||
      program.toLowerCase().includes(p.programCode)
    );
    if (match) return match;
  }

  return undefined;
}

// ============================================================
// CASH PRICE ESTIMATES (fallback when Google Flights unavailable)
// ============================================================

function estimateCashPrice(origin: string, destination: string, cabin: string): number | undefined {
  const routes: Record<string, Record<string, number>> = {
    'US-JP': { economy: 1200, premium_economy: 2500, business: 8000, first: 20000 },
    'US-EU': { economy: 800, premium_economy: 1800, business: 4000, first: 10000 },
    'US-SEA': { economy: 1000, premium_economy: 2200, business: 6000, first: 15000 },
    'US-ME': { economy: 900, premium_economy: 2000, business: 6000, first: 14000 },
    'US-AU': { economy: 1200, premium_economy: 2800, business: 8000, first: 18000 },
    'default': { economy: 800, premium_economy: 2000, business: 5000, first: 12000 },
  };

  const jpAirports = new Set(['NRT', 'HND', 'KIX', 'NGO', 'FUK', 'CTS']);
  const euAirports = new Set(['LHR', 'CDG', 'FRA', 'AMS', 'FCO', 'MAD', 'BCN', 'MUC', 'ZRH', 'VIE', 'CPH', 'OSL', 'ARN', 'HEL', 'DUB', 'LIS', 'IST']);
  const seaAirports = new Set(['SIN', 'BKK', 'HKG', 'ICN', 'TPE', 'MNL', 'KUL', 'SGN', 'HAN']);
  const meAirports = new Set(['DOH', 'DXB', 'AUH', 'JED', 'RUH']);
  const auAirports = new Set(['SYD', 'MEL', 'BNE', 'PER', 'AKL']);

  let routeType = 'default';
  if (jpAirports.has(destination) || jpAirports.has(origin)) routeType = 'US-JP';
  else if (euAirports.has(destination) || euAirports.has(origin)) routeType = 'US-EU';
  else if (seaAirports.has(destination) || seaAirports.has(origin)) routeType = 'US-SEA';
  else if (meAirports.has(destination) || meAirports.has(origin)) routeType = 'US-ME';
  else if (auAirports.has(destination) || auAirports.has(origin)) routeType = 'US-AU';

  return routes[routeType]?.[cabin];
}

function getBookingUrl(programCode: string, origin: string, destination: string, date: string): string {
  const urls: Record<string, string> = {
    'united': `https://www.united.com/en/us/fsr/choose-flights?f=${origin}&t=${destination}&d=${date}&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7`,
    'aeroplan': `https://www.aircanada.com/aeroplan/redeem/availability/outbound?org0=${origin}&dest0=${destination}&departureDate0=${date}&ADT=1&tripType=O&lang=en-CA`,
    'american': `https://www.aa.com/booking/search?locale=en_US&pax=1&type=OneWay&searchType=Award&origin=${origin}&destination=${destination}&departDate=${date}`,
    'ba-avios': `https://www.britishairways.com/travel/book/public/en_us?from=${origin}&to=${destination}&depDate=${date}&cabin=J&adult=1&type=AVIOS`,
    'delta': `https://www.delta.com/flight-search/book-a-flight?tripType=ONE_WAY&awardTravel=true&originCity=${origin}&destinationCity=${destination}&departureDate=${date}`,
    'ana': `https://www.ana.co.jp/en/us/amc/award-reservation/`,
    'virgin-atlantic': `https://www.virginatlantic.com/`,
    'singapore': `https://www.singaporeair.com/en_UK/plan-and-book/your-booking/`,
    'turkish': `https://www.turkishairlines.com/en-us/flights/booking/availability/`,
    'emirates': `https://www.emirates.com/us/english/`,
  };
  return urls[programCode] || '#';
}

// ============================================================
// SEARCH ORCHESTRATOR
// ============================================================

export async function searchFlights(params: SearchParams): Promise<FlightResult[]> {
  const allResults: FlightResult[] = [];
  const searchedPairs = new Set<string>();

  // Get transfer partners for this program
  const partners = getTransferPartnersForProgram(params.programSlug);
  if (partners.length === 0) {
    console.log(`⚠️  No transfer partners found for program: ${params.programSlug}`);
  }

  // Map cabin parameter
  const cabinParam = params.cabin === 'any' || params.cabin === 'Either'
    ? 'business'  // default to business for "any"
    : params.cabin === 'Business' ? 'business'
    : params.cabin === 'First' ? 'first'
    : params.cabin.toLowerCase() as 'economy' | 'business' | 'first';

  // Search each origin-destination pair
  for (const origin of params.origins) {
    for (const dest of params.destinations) {
      const key = `${origin}-${dest}`;
      if (searchedPairs.has(key)) continue;
      searchedPairs.add(key);

      // Check rate limit / cache
      if (isRateLimited(key)) {
        console.log(`⏳ Rate limited: ${key}, using cache`);
        const cached = getCachedResults(key, cabinParam);
        allResults.push(...cached);
        continue;
      }

      console.log(`🔍 Scraping: ${origin} → ${dest} (${cabinParam}, ${params.programSlug})`);

      const scraperParams: ScraperSearchParams = {
        origin,
        destination: dest,
        date: params.startDate || getDefaultSearchDate(),
        cabin: cabinParam as 'economy' | 'business' | 'first',
      };

      try {
        const allScraperResults = await searchAll(scraperParams);
        recordRateLimit(key);

        // Separate award vs cash results
        const awards = allScraperResults.filter(r => r.pointsRequired && r.pointsRequired > 0);
        const cashPrices = allScraperResults.filter(r => r.cashPrice && r.cashPrice > 0 && !r.pointsRequired);

        // Deduplicate by flight number + date
        const seen = new Set<string>();
        const deduped = awards.filter(r => {
          const key = `${r.flightNumber}-${r.departureDate}-${r.source}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Process into monitor results with CPP, transfer paths, etc.
        const processed = processScraperResults(deduped, cashPrices, params.programSlug);
        allResults.push(...processed);

        // Cache results
        cacheResults(key, cabinParam, processed);

        console.log(`✅ ${origin} → ${dest}: ${processed.length} results (${deduped.length} raw, deduped from ${awards.length})`);
      } catch (err: any) {
        console.error(`❌ Search failed for ${key}: ${err.message}`);
      }

      // Small delay between route pairs
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Filter by date range if specified
  let filtered = allResults;
  if (params.startDate) {
    filtered = filtered.filter(r => r.departureDate >= params.startDate!);
  }
  if (params.endDate) {
    filtered = filtered.filter(r => r.departureDate <= params.endDate!);
  }

  return filtered;
}

// ============================================================
// HELPERS
// ============================================================

function getDefaultSearchDate(): string {
  // Default to 2 months from now
  const d = new Date();
  d.setMonth(d.getMonth() + 2);
  return d.toISOString().split('T')[0];
}

// ============================================================
// RATE LIMITING & CACHING
// ============================================================

const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

function isRateLimited(key: string): boolean {
  const last = rateLimitMap.get(key);
  if (!last) return false;
  return Date.now() - last < RATE_LIMIT_MS;
}

function recordRateLimit(key: string): void {
  rateLimitMap.set(key, Date.now());
}

const CACHE_DIR = path.join(__dirname, '../../data/flight-cache');

function getCacheKey(pairKey: string, cabin: string): string {
  return `${pairKey}-${cabin || 'any'}`.replace(/[^a-zA-Z0-9-]/g, '_');
}

function cacheResults(pairKey: string, cabin: string, results: FlightResult[]): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${getCacheKey(pairKey, cabin)}.json`);
  fs.writeFileSync(file, JSON.stringify({ timestamp: Date.now(), results }, null, 2));
}

function getCachedResults(pairKey: string, cabin: string): FlightResult[] {
  const file = path.join(CACHE_DIR, `${getCacheKey(pairKey, cabin)}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Date.now() - data.timestamp > 30 * 60 * 1000) return [];
    return data.results || [];
  } catch {
    return [];
  }
}

// ============================================================
// SIGNUP → SEARCH PARAMS CONVERTER
// ============================================================

export function signupToSearchParams(signup: FlightSignup): SearchParams {
  const origins = signup.from.split(',').map(s => s.trim()).filter(Boolean);
  const destinations = signup.to.split(',').map(s => s.trim()).filter(Boolean);

  const programMap: Record<string, string> = {
    'Amex Membership Rewards': 'amex-mr',
    'Chase Ultimate Rewards': 'chase-ur',
    'Capital One Miles': 'capital-one',
    'Citi ThankYou Points': 'citi-typ',
    'Bilt Rewards': 'bilt',
  };

  const programSlug = programMap[signup.program] || signup.program.toLowerCase().replace(/\s+/g, '-');

  let cabin = signup.class?.toLowerCase() || 'any';
  if (cabin === 'either') cabin = 'any';

  return {
    origins,
    destinations,
    cabin,
    programSlug,
    startDate: signup.startDate || undefined,
    endDate: signup.endDate || undefined,
  };
}

// ============================================================
// EXPORTS
// ============================================================

export { estimateCashPrice };
