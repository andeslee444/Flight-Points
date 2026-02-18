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
import type { FlightResult, SearchParams as ScraperSearchParams } from './types';
import {
  JAPAN_AIRPORTS, EUROPE_AIRPORTS, SEA_AIRPORTS,
  MIDDLE_EAST_AIRPORTS, AUSTRALIA_NZ_AIRPORTS,
} from './airports.js';

// Re-export FlightResult from the canonical types module
export type { FlightResult } from './types';

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

export interface MonitorSearchParams {
  origins: string[];       // ["JFK", "EWR", "LGA"]
  destinations: string[];  // ["NRT", "HND"]
  cabin: string;           // "business" | "first" | "any"
  programSlug: string;     // "amex-mr"
  startDate?: string;
  endDate?: string;
}

// Keep backward compat export
export type SearchParams = MonitorSearchParams;

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
 * Convert scraper FlightResult[] into enriched FlightResult[] with
 * transfer path info, CPP calculation, and deal ratings.
 * Populates the optional extended fields on the base FlightResult type.
 */
function processScraperResults(
  scraperResults: FlightResult[],
  cashPrices: FlightResult[],
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
    const cppVal = cashPrice ? ((cashPrice * 100 - (sr.taxesAndFees || 0) * 100) / sr.pointsRequired) : undefined;

    results.push({
      ...sr,
      id: `${sr.source}-${sr.flightNumber || sr.origin + sr.destination}-${sr.departureDate}-${sr.cabin}`,
      cabinDisplay: cabinDisplayName(sr.cabin),
      program: partner?.programCode || sr.source,
      programDisplay: transferTarget,
      transferPath,
      cashPrice,
      cpp: cppVal ? Math.round(cppVal * 10) / 10 : undefined,
      dealRating: computeDealRating(cppVal),
      direct: sr.stops === 0,
      route: `${sr.origin} → ${sr.destination}`,
      lastSeen: new Date().toISOString(),
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

  let routeType = 'default';
  if (JAPAN_AIRPORTS.has(destination) || JAPAN_AIRPORTS.has(origin)) routeType = 'US-JP';
  else if (EUROPE_AIRPORTS.has(destination) || EUROPE_AIRPORTS.has(origin)) routeType = 'US-EU';
  else if (SEA_AIRPORTS.has(destination) || SEA_AIRPORTS.has(origin)) routeType = 'US-SEA';
  else if (MIDDLE_EAST_AIRPORTS.has(destination) || MIDDLE_EAST_AIRPORTS.has(origin)) routeType = 'US-ME';
  else if (AUSTRALIA_NZ_AIRPORTS.has(destination) || AUSTRALIA_NZ_AIRPORTS.has(origin)) routeType = 'US-AU';

  return routes[routeType]?.[cabin];
}

function getBookingUrl(programCode: string, origin: string, destination: string, date: string, cabin?: string): string {
  // United cabin code mapping: economy→2, premium economy→4, business→5, first→6
  const unitedCabin = cabin === 'F' ? '6' : cabin === 'J' ? '5' : cabin === 'W' ? '4' : '2';

  const urls: Record<string, string> = {
    // Airlines that support pre-filled search params
    'american': `https://www.aa.com/booking/search?locale=en_US&pax=1&type=OneWay&searchType=Award&origin=${origin}&destination=${destination}&departDate=${date}`,
    'united': `https://www.united.com/ual/en/us/flight-search/book-a-flight/results/awd?f=${origin}&t=${destination}&d=${date}&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7&cbm=${unitedCabin}&cbm2=${unitedCabin}`,
    'aeroplan': `https://www.aeroplan.com/aeroplan/redeem/availability/outbound?org0=${origin}&dest0=${destination}&departureDate0=${date}&ADT=1&tripType=O&lang=en-CA`,
    'delta': `https://www.delta.com/flight-search/book-a-flight?tripType=ONE_WAY&awardTravel=true&originCity=${origin}&destinationCity=${destination}&departureDate=${date}&paxCount=1`,
    'jetblue': `https://www.jetblue.com/booking/flights?from=${origin}&to=${destination}&depart=${date}&isMultiCity=false&noOfRoute=1&lang=en&adults=1&children=0&infants=0&shared498=true&fare=award`,
    // Airlines with SPA award pages (no deep-link params)
    'ana': 'https://www.ana.co.jp/en/us/plan-book/',
    'singapore': 'https://www.singaporeair.com/en_UK/us/ppsclub-krisflyer/use-miles/redeem-miles/',
    'ba-avios': 'https://www.britishairways.com/travel/redeem/execclub/_gf/en_us',
    'virgin-atlantic': 'https://www.virginatlantic.com/reward-flights/book',
    'air-france-klm': 'https://www.flyingblue.com/en/spend/flights',
    'turkish': 'https://www.turkishairlines.com/en-us/flights/booking/availability/',
    'emirates': 'https://www.emirates.com/us/english/book/',
    'cathay': 'https://www.cathaypacific.com/cx/en_US/book-a-trip/redeem-flights.html',
    'qatar': 'https://www.qatarairways.com/en-us/privilege-club/use-qmiles/book-flights.html',
    'avianca-lifemiles': 'https://www.lifemiles.com/en/book-flights',
    'alaska': 'https://www.alaskaair.com/shopping/flights?showAward=true',
    'etihad': 'https://www.etihad.com/en-us/guest/flights',
    'iberia': 'https://www.iberia.com/us/avios/',
    'qantas': 'https://www.qantas.com/au/en/book-a-trip/redeem-points/flights.html',
  };
  return urls[programCode] || '#';
}

// ============================================================
// SEARCH ORCHESTRATOR
// ============================================================

export async function searchFlights(params: MonitorSearchParams): Promise<FlightResult[]> {
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
        const { awards: allAwards, cashPrices } = await searchAll(scraperParams, params.programSlug);
        recordRateLimit(key);

        // Deduplicate by flight number + date
        const seen = new Set<string>();
        const deduped = allAwards.filter((r: FlightResult) => {
          const dedupKey = `${r.flightNumber}-${r.departureDate}-${r.source}`;
          if (seen.has(dedupKey)) return false;
          seen.add(dedupKey);
          return true;
        });

        // Process into monitor results with CPP, transfer paths, etc.
        const processed = processScraperResults(deduped, cashPrices, params.programSlug);
        allResults.push(...processed);

        // Cache results
        cacheResults(key, cabinParam, processed);

        console.log(`✅ ${origin} → ${dest}: ${processed.length} results (${deduped.length} raw, deduped from ${allAwards.length})`);
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

export function signupToSearchParams(signup: FlightSignup): MonitorSearchParams {
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
// AIRLINE NAME NORMALIZATION
// ============================================================

const AIRLINE_ALIASES: Record<string, string> = {
  'All Nippon Airways': 'ANA',
  'All Nippon': 'ANA',
  'Japan Airlines': 'JAL',
  'Singapore Airlines': 'Singapore Airlines',
  'British Airways': 'British Airways',
  'Cathay Pacific Airways': 'Cathay Pacific',
  'Cathay Pacific': 'Cathay Pacific',
  'American Airlines': 'American Airlines',
  'United Airlines': 'United Airlines',
  'Delta Air Lines': 'Delta Air Lines',
  'Korean Air Lines': 'Korean Air',
  'Korean Air': 'Korean Air',
  'EVA Air': 'EVA Air',
  'EVA Airways': 'EVA Air',
  'Turkish Airlines': 'Turkish Airlines',
  'Air France': 'Air France',
  'KLM Royal Dutch Airlines': 'KLM',
  'KLM': 'KLM',
  'Lufthansa': 'Lufthansa',
  'Swiss International Air Lines': 'SWISS',
  'SWISS': 'SWISS',
  'Asiana Airlines': 'Asiana Airlines',
  'Qatar Airways': 'Qatar Airways',
  'Emirates': 'Emirates',
  'Etihad Airways': 'Etihad Airways',
  'Etihad': 'Etihad Airways',
  'Philippine Airlines': 'Philippine Airlines',
  'Air Canada': 'Air Canada',
  'Qantas': 'Qantas',
  'Virgin Atlantic': 'Virgin Atlantic',
  'Iberia': 'Iberia',
  'Finnair': 'Finnair',
  'SAS': 'SAS',
  'Scandinavian Airlines': 'SAS',
};

function normalizeAirlineName(name: string): string {
  if (!name) return '';
  // Direct match
  if (AIRLINE_ALIASES[name]) return AIRLINE_ALIASES[name];
  // Case-insensitive match
  const lower = name.toLowerCase();
  for (const [alias, normalized] of Object.entries(AIRLINE_ALIASES)) {
    if (alias.toLowerCase() === lower) return normalized;
  }
  return name;
}

// ============================================================
// EXPORTS
// ============================================================

export { cabinDisplayName, computeDealRating, findPartnerForSource, estimateCashPrice, getBookingUrl, normalizeAirlineName };
