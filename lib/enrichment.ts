/**
 * Enrichment logic for flight results — ported from src/flights/monitor.ts.
 *
 * This is a pure function layer with NO daemon-only imports (no monitor.ts, scrapers/,
 * flight-daemon.ts, web-server.ts). Safe to use in Next.js / Vercel RSC context.
 *
 * The helper functions (findPartnerForSource, estimateCashPrice, computeDealRating,
 * cabinDisplayName, getBookingUrl) are copied here directly from monitor.ts to avoid
 * transitive import chains that would pull in Playwright/Camoufox into the Next.js build.
 */

import {
  POINTS_PROGRAMS,
  getTransferPartnersForProgram,
  type TransferPartner,
} from '@/src/flights/transfer-partners';
import {
  getBonusesForProgram,
  effectiveBonusCost,
} from './transfer-bonuses';
import {
  getRegion,
  JAPAN_AIRPORTS,
  EUROPE_AIRPORTS,
  SEA_AIRPORTS,
  MIDDLE_EAST_AIRPORTS,
  AUSTRALIA_NZ_AIRPORTS,
} from '@/src/flights/airports';
import { matchSweetSpots, type SweetSpotEntry } from '@/src/flights/sweet-spots';

// ============================================================
// NON-BOOKABLE SOURCE FILTER
// ============================================================

export const NON_BOOKABLE_SOURCES = new Set(['ana-estimated', 'ana-chart']);

// ============================================================
// ENRICHED DEAL TYPE
// ============================================================

export interface EnrichedDeal {
  // Core flight info
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  cabin: string;
  // Points & value
  pointsRequired: number;
  pointsProgram: string;
  points: number; // After transfer ratio
  taxes: number;
  cpp: number | undefined;
  dealRating: 'hot' | 'good' | 'fair' | 'unknown';
  // Display
  cabinDisplay: string;
  route: string;
  direct: boolean;
  // Transfer info
  program: string;
  programDisplay: string;
  transferPath: string;
  transferFrom: string[]; // Credit card program slugs that can transfer
  // Booking
  bookingUrl: string;
  // Sweet spots
  sweetSpot: SweetSpotEntry | null;
  // Region (for filtering in Plan 03)
  region: string; // from getRegion(destination)
  // Transfer bonuses (Phase 4)
  transferBonuses: Array<{
    ccProgram: string;       // CC slug, e.g. 'chase-ur'
    bonusPct: number;        // e.g. 40
    effectiveCost: number;   // Reduced CC points needed
    description: string;     // e.g. '40% Chase UR -> Virgin Atlantic'
  }>;
  // Metadata
  source: string;
  scrapedAt: string;
  id: string; // Unique key for React list rendering
}

// ============================================================
// HELPER FUNCTIONS (copied from monitor.ts — no transitive imports)
// ============================================================

function cabinDisplayName(cabin: string): string {
  const map: Record<string, string> = {
    economy: 'Economy',
    premium_economy: 'Premium Economy',
    business: 'Business',
    first: 'First Class',
  };
  return map[cabin] || cabin;
}

function computeDealRating(cpp: number | undefined): 'hot' | 'good' | 'fair' | 'unknown' {
  if (!cpp) return 'unknown';
  if (cpp >= 3.0) return 'hot';
  if (cpp >= 1.5) return 'good';
  return 'fair';
}

function findPartnerForSource(
  source: string,
  program: string | undefined,
  partners: TransferPartner[],
): TransferPartner | undefined {
  // Try matching by program name first (most accurate)
  if (program) {
    const match = partners.find(
      (p) =>
        p.program.toLowerCase().includes(program.toLowerCase()) ||
        program.toLowerCase().includes(p.programCode),
    );
    if (match) return match;
  }

  // Fallback: map source → programCode(s)
  const sourceToCode: Record<string, string[]> = {
    united: ['united'],
    aa: ['american', 'ba-avios'],
    delta: ['delta', 'air-france-klm'],
    'ba-avios': ['ba-avios'],
    aeroplan: ['aeroplan'],
    ana: ['ana'],
    'ana-estimated': ['ana'],
  };

  const codes = sourceToCode[source] || [];
  for (const code of codes) {
    const match = partners.find((p) => p.programCode === code);
    if (match) return match;
  }

  return undefined;
}

function estimateCashPrice(origin: string, destination: string, cabin: string): number | undefined {
  const routes: Record<string, Record<string, number>> = {
    'US-JP': { economy: 1200, premium_economy: 2500, business: 8000, first: 20000 },
    'US-EU': { economy: 800, premium_economy: 1800, business: 4000, first: 10000 },
    'US-SEA': { economy: 1000, premium_economy: 2200, business: 6000, first: 15000 },
    'US-ME': { economy: 900, premium_economy: 2000, business: 6000, first: 14000 },
    'US-AU': { economy: 1200, premium_economy: 2800, business: 8000, first: 18000 },
    default: { economy: 800, premium_economy: 2000, business: 5000, first: 12000 },
  };

  let routeType = 'default';
  if (JAPAN_AIRPORTS.has(destination) || JAPAN_AIRPORTS.has(origin)) routeType = 'US-JP';
  else if (EUROPE_AIRPORTS.has(destination) || EUROPE_AIRPORTS.has(origin)) routeType = 'US-EU';
  else if (SEA_AIRPORTS.has(destination) || SEA_AIRPORTS.has(origin)) routeType = 'US-SEA';
  else if (MIDDLE_EAST_AIRPORTS.has(destination) || MIDDLE_EAST_AIRPORTS.has(origin))
    routeType = 'US-ME';
  else if (AUSTRALIA_NZ_AIRPORTS.has(destination) || AUSTRALIA_NZ_AIRPORTS.has(origin))
    routeType = 'US-AU';

  return routes[routeType]?.[cabin];
}

function getBookingUrl(
  programCode: string,
  origin: string,
  destination: string,
  date: string,
  cabin?: string,
): string {
  const unitedCabin =
    cabin === 'F' ? '6' : cabin === 'J' ? '5' : cabin === 'W' ? '4' : '2';

  const urls: Record<string, string> = {
    american: `https://www.aa.com/booking/search?locale=en_US&pax=1&type=OneWay&searchType=Award&origin=${origin}&destination=${destination}&departDate=${date}`,
    united: `https://www.united.com/ual/en/us/flight-search/book-a-flight/results/awd?f=${origin}&t=${destination}&d=${date}&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7&cbm=${unitedCabin}&cbm2=${unitedCabin}`,
    aeroplan: `https://www.aeroplan.com/aeroplan/redeem/availability/outbound?org0=${origin}&dest0=${destination}&departureDate0=${date}&ADT=1&tripType=O&lang=en-CA`,
    delta: `https://www.delta.com/flight-search/book-a-flight?tripType=ONE_WAY&awardTravel=true&originCity=${origin}&destinationCity=${destination}&departureDate=${date}&paxCount=1`,
    jetblue: `https://www.jetblue.com/booking/flights?from=${origin}&to=${destination}&depart=${date}&isMultiCity=false&noOfRoute=1&lang=en&adults=1&children=0&infants=0&shared498=true&fare=award`,
    ana: 'https://www.ana.co.jp/en/us/plan-book/',
    singapore: 'https://www.singaporeair.com/en_UK/us/ppsclub-krisflyer/use-miles/redeem-miles/',
    'ba-avios': 'https://www.britishairways.com/travel/redeem/execclub/_gf/en_us',
    'virgin-atlantic': 'https://www.virginatlantic.com/reward-flights/book',
    'air-france-klm': 'https://www.flyingblue.com/en/spend/flights',
    turkish: 'https://www.turkishairlines.com/en-us/flights/booking/availability/',
    emirates: 'https://www.emirates.com/us/english/book/',
    cathay: 'https://www.cathaypacific.com/cx/en_US/book-a-trip/redeem-flights.html',
    qatar: 'https://www.qatarairways.com/en-us/privilege-club/use-qmiles/book-flights.html',
    'avianca-lifemiles': 'https://www.lifemiles.com/en/book-flights',
    alaska: 'https://www.alaskaair.com/shopping/flights?showAward=true',
    etihad: 'https://www.etihad.com/en-us/guest/flights',
    iberia: 'https://www.iberia.com/us/avios/',
    qantas: 'https://www.qantas.com/au/en/book-a-trip/redeem-points/flights.html',
  };
  return urls[programCode] || '#';
}

// ============================================================
// MAIN ENRICHMENT FUNCTION
// ============================================================

export function enrichFlightResult(
  f: Record<string, unknown>,
  programSlug: string,
  partners: TransferPartner[],
  programName: string,
): EnrichedDeal {
  const partner = findPartnerForSource(
    f.source as string,
    f.pointsProgram as string | undefined,
    partners,
  );

  const ratio = partner?.ratio || 1;
  const pointsRequired = (f.pointsRequired as number) || 0;
  const pointsNeeded = Math.ceil(pointsRequired * ratio);
  const transferTarget = partner?.program || (f.pointsProgram as string) || (f.source as string);

  const transferPath = partner
    ? `Transfer ${pointsNeeded.toLocaleString()} ${programName} → ${transferTarget}`
    : `Book via ${(f.pointsProgram as string) || (f.source as string)} (${pointsRequired.toLocaleString()} miles)`;

  const origin = (f.origin as string) || '';
  const destination = (f.destination as string) || '';
  const cabin = (f.cabin as string) || 'economy';
  const date = (f.departureDate as string) || '';
  const taxes = (f.taxesAndFees as number) || 0;

  const cashPrice = estimateCashPrice(origin, destination, cabin);
  const cppVal = cashPrice
    ? (cashPrice * 100 - taxes * 100) / pointsRequired
    : undefined;
  const cpp = cppVal ? Math.round(cppVal * 10) / 10 : undefined;

  const bookingUrl = getBookingUrl(
    partner?.programCode || (f.source as string),
    origin,
    destination,
    date,
    cabin,
  );

  // Sweet spot matching
  const sweetSpots = matchSweetSpots(origin, destination, cabin);
  const sweetSpot = sweetSpots[0] || null;

  // Which credit card programs can transfer to fund this deal
  const transferFrom: string[] = [];
  for (const p of POINTS_PROGRAMS) {
    const programPartners = getTransferPartnersForProgram(p.slug);
    const hasMatch = programPartners.some(
      (pp) =>
        pp.programCode === (partner?.programCode || (f.source as string)) ||
        (f.pointsProgram &&
          (pp.program
            .toLowerCase()
            .includes((f.pointsProgram as string).toLowerCase()) ||
            (f.pointsProgram as string)
              .toLowerCase()
              .includes(pp.programCode))),
    );
    if (hasMatch) {
      transferFrom.push(p.slug);
    }
  }

  // Transfer bonus computation
  const airlineProgramCode = partner?.programCode || (f.source as string);
  const bonuses = getBonusesForProgram(airlineProgramCode);
  const transferBonuses = bonuses
    .filter((b) => transferFrom.includes(b.fromProgram))
    .map((b) => {
      const ccPartner = partners.find((p) => p.programCode === airlineProgramCode);
      const baseRatio = ccPartner?.ratio || 1;
      return {
        ccProgram: b.fromProgram,
        bonusPct: b.bonusPct,
        effectiveCost: effectiveBonusCost(pointsRequired, baseRatio, b.bonusPct),
        description: b.description,
      };
    });

  const id = `${f.source}-${origin}-${destination}-${date}-${(f.departureTime as string) || ''}-${cabin}-${(f.flightNumber as string) || 'nonum'}`;

  return {
    airline: (f.airline as string) || '',
    flightNumber: (f.flightNumber as string) || '',
    origin,
    destination,
    departureDate: date,
    departureTime: (f.departureTime as string) || '',
    arrivalTime: (f.arrivalTime as string) || '',
    duration: (f.duration as string) || '',
    stops: (f.stops as number) || 0,
    cabin,
    pointsRequired,
    pointsProgram: (f.pointsProgram as string) || (f.source as string),
    points: pointsNeeded,
    taxes,
    cpp,
    dealRating: computeDealRating(cppVal),
    cabinDisplay: cabinDisplayName(cabin),
    route: `${origin} → ${destination}`,
    direct: ((f.stops as number) || 0) === 0,
    program: partner?.programCode || (f.source as string),
    programDisplay: transferTarget,
    transferPath,
    transferFrom,
    bookingUrl,
    sweetSpot,
    region: getRegion(destination),
    transferBonuses,
    source: (f.source as string) || '',
    scrapedAt: (f.scrapedAt as string) || new Date().toISOString(),
    id,
  };
}
