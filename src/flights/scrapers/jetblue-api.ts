/**
 * JetBlue TrueBlue Award Search — Fast API Scraper
 *
 * Uses JetBlue's public flight search API (no auth, no anti-bot).
 * ~1-2s per search. Returns all cabins (Blue, Blue Plus, Mint, etc.).
 *
 * API: POST https://cb-api.jetblue.com/cb-flight-search/v1/search/NGB
 * Auth: Static Azure APIM subscription key in header
 *
 * Response structure:
 *   data.searchResults[].productOffers[].originAndDestination[] — itinerary parts
 *     .departure.date/.airport, .arrival.date/.airport, .stops, .totalDuration (mins)
 *     .flightSegments[].flightInfo.marketingFlightNumber/.operatingAirlineCode
 *   data.searchResults[].productOffers[].offers[] — fare options
 *     .brand.brandId (AN=Blue, GN=Blue+, EN=Blue Extra, MN=Mint)
 *     .price[] {amount, currency: "FFCURRENCY"|"USD"}
 *     .soldOut, .seatsRemaining.count
 *
 * Created: 2026-02-26
 */

import type { FlightResult, SearchParams } from '../types.js';
import { getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const API_URL = 'https://cb-api.jetblue.com/cb-flight-search/v1/search/NGB';
const API_KEY = 'a5ee654e981b4577a58264fed9b1669c';

// Brand ID → cabin mapping
const BRAND_CABIN: Record<string, 'economy' | 'business'> = {
  DN: 'economy',  // Blue Basic
  AN: 'economy',  // Blue
  GN: 'economy',  // Blue Plus (extra legroom)
  EN: 'economy',  // Blue Extra
  MN: 'business', // Mint
};

function formatTime(dt: string): string {
  // "2026-07-01T07:35:00" → "7:35 AM"
  const m = dt.match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  let h = parseInt(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

function buildBookingUrl(params: SearchParams): string {
  return `https://www.jetblue.com/booking/flights?from=${params.origin}&to=${params.destination}&depart=${params.date}&isMultiCity=false&noOfRoute=1&lang=en&adults=${params.passengers || 1}&children=0&infants=0&roundTripFaresFlag=false&usePoints=true`;
}

export async function searchJetBlueApi(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('jetblue-api', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[JetBlue-API] Cache hit for', cacheKey);
    return cached;
  }

  console.log(`[JetBlue-API] Searching ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);

  const reqBody = {
    awardBooking: true,
    travelerTypes: [{ type: 'ADULT', quantity: params.passengers || 1 }],
    searchComponents: [{
      from: params.origin,
      to: params.destination,
      date: params.date,
    }],
  };

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ocp-apim-subscription-key': API_KEY,
      'Accept': 'application/json',
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`JetBlue API ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  const results: FlightResult[] = [];
  const bookingUrl = buildBookingUrl(params);

  // Response: { status, data: { searchResults: [...] } }
  const searchResults = json?.data?.searchResults || [];

  for (const sr of searchResults) {
    const productOffers = sr?.productOffers || [];

    for (const po of productOffers) {
      // originAndDestination = itinerary parts (legs)
      const legs: any[] = po.originAndDestination || [];
      if (legs.length === 0) continue;

      const firstLeg = legs[0];
      const lastLeg = legs[legs.length - 1];

      // Flight segments within the itinerary
      const segments: any[] = firstLeg.flightSegments || [];
      const firstSeg = segments[0];

      const carrier = firstSeg?.flightInfo?.marketingAirlineCode || firstSeg?.flightInfo?.operatingAirlineCode || 'B6';
      const flightNum = firstSeg?.flightInfo?.marketingFlightNumber || '';
      const origin = firstLeg.departure?.airport || params.origin;
      const dest = lastLeg.arrival?.airport || params.destination;
      const depTime = firstLeg.departure?.date || '';
      const arrTime = lastLeg.arrival?.date || '';
      const stops = firstLeg.stops ?? (segments.length - 1);
      const totalDuration = firstLeg.totalDuration || 0;
      const duration = totalDuration > 0 ? formatDuration(totalDuration) : '';

      // Each offer is a fare/cabin option
      const offers: any[] = po.offers || [];
      for (const offer of offers) {
        if (offer.soldOut) continue;

        const brandId = offer.brand?.brandId || '';
        const cabin = BRAND_CABIN[brandId] || 'economy';

        // Filter by requested cabin
        if (params.cabin !== cabin) continue;

        const prices: any[] = offer.price || [];
        const pointsEntry = prices.find((p: any) => p.currency === 'FFCURRENCY');
        const taxEntry = prices.find((p: any) => p.currency === 'USD');

        const pointsRequired = pointsEntry?.amount || 0;
        const taxesAndFees = taxEntry?.amount || 0;

        if (pointsRequired <= 0) continue;

        results.push({
          source: 'jetblue',
          airline: 'JetBlue',
          flightNumber: `${carrier}${flightNum}`,
          origin,
          destination: dest,
          departureDate: params.date,
          departureTime: formatTime(depTime),
          arrivalTime: formatTime(arrTime),
          duration,
          stops,
          cabin,
          pointsRequired,
          pointsProgram: 'TrueBlue',
          taxesAndFees,
          awardType: 'saver',
          scrapedAt: new Date().toISOString(),
          bookingUrl,
        });
      }
    }
  }

  console.log(`[JetBlue-API] Found ${results.length} ${params.cabin} results`);
  setCache(cacheKey, results);
  return results;
}
