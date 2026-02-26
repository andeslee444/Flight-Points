/**
 * Flight Award Search Types
 * Created: 2026-02-16
 */

export type AvailabilityType = 'confirmed' | 'calendar' | 'estimated';

export interface FlightResult {
  source: string; // 'united' | 'google' | 'aeroplan'
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  cabin: 'economy' | 'business' | 'first';

  // Award pricing
  pointsRequired?: number;
  pointsProgram?: string;
  taxesAndFees?: number;
  awardType?: 'saver' | 'everyday' | 'partner';

  // Cash pricing
  cashPrice?: number;

  // Calculated
  centsPerPoint?: number;

  // Transfer info
  transferFrom?: string;
  transferTo?: string;
  transferRatio?: string;

  // Metadata
  scrapedAt: string;
  bookingUrl?: string;

  // Extended fields (populated by monitor/daemon, optional for scrapers)
  id?: string;
  cabinDisplay?: string;
  program?: string;
  programDisplay?: string;
  transferPath?: string;
  cpp?: number;
  dealRating?: 'hot' | 'good' | 'fair' | 'unknown';
  direct?: boolean;
  route?: string;
  lastSeen?: string;

  // Availability provenance — single source of truth for confirmed vs excluded data.
  // Set at the scraper registry level (SCRAPER_REGISTRY.availabilityType) rather than
  // per-result. Optional because existing scrapers inherit 'confirmed' from the registry entry.
  availabilityType?: AvailabilityType;
}

export interface PriceHistory {
  route: string; // "JFK-NRT"
  cabin: string;
  dataPoints: Array<{
    date: string;
    travelDate: string;
    pointsRequired: number;
    program: string;
    cashPrice: number;
    centsPerPoint: number;
  }>;
}

export interface SearchParams {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
  cabin: 'economy' | 'business' | 'first';
  passengers?: number;
}

export type CabinCode = 'economy' | 'business' | 'first';

// United cabin class codes
export const UNITED_CABIN_CODES: Record<CabinCode, number> = {
  economy: 1,
  business: 7, // sc=7, clm=7
  first: 8,
};

// Cache key helper
export function getCacheKey(source: string, params: SearchParams): string {
  return `${source}:${params.origin}-${params.destination}:${params.date}:${params.cabin}`;
}
