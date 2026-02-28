/**
 * Turkish Airlines Miles&Smiles Award Search — Official API Scraper
 *
 * Uses Turkish Airlines' public developer API (no browser, no anti-bot).
 * ~2-5s per search. Returns TK-operated flights with award pricing.
 *
 * API: POST https://api.turkishairlines.com/test/getAvailability
 * Auth: apikey + apisecret headers (register at developer.apim.turkishairlines.com)
 *
 * Also uses:
 *   - getFareFamilyList (with isMilesRequest) to discover award fare families
 *   - calculateAwardMilesWithTax for miles pricing if getAvailability returns cash only
 *
 * NOTE: Response parsing is based on OTA-style structure from Android app data classes.
 * The exact award-specific fields may need iteration after first real API call.
 * Raw response is logged to stderr on first run for discovery.
 *
 * Created: 2026-02-26
 */

import type { FlightResult, SearchParams } from '../types.js';
import { getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const API_BASE = 'https://api.turkishairlines.com/test';
const TK_API_KEY = process.env.TK_API_KEY || '';
const TK_API_SECRET = process.env.TK_API_SECRET || '';

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Convert YYYY-MM-DD → DDMMM (e.g. "2026-03-14" → "14MAR") */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const monthIdx = parseInt(month, 10) - 1;
  return `${parseInt(day, 10).toString().padStart(2, '0')}${MONTH_NAMES[monthIdx]}`;
}

/** Map our cabin codes to TK API cabin values */
function mapCabin(cabin: 'economy' | 'business' | 'first'): string {
  if (cabin === 'business' || cabin === 'first') return 'BUSINESS';
  return 'ECONOMY';
}

/** Parse ISO 8601 duration like "PT10H15M" → "10h 15m" */
function parseDuration(iso: string): string {
  const m = iso.match(/PT(\d+)H(?:(\d+)M)?/);
  if (!m) return '';
  const hours = m[1];
  const mins = m[2] || '0';
  return `${hours}h ${mins}m`;
}

/** Parse datetime like "2026-03-14T09:30:00" → "9:30 AM" */
function formatTime(dt: string): string {
  const m = dt.match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  let h = parseInt(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

function buildBookingUrl(params: SearchParams): string {
  return `https://www.turkishairlines.com/en-int/flights/booking/`;
}

function getAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apikey': TK_API_KEY,
    'apisecret': TK_API_SECRET,
  };
}

/**
 * Call getFareFamilyList to discover award fare families.
 * This helps us understand what TargetSource to use for award searches.
 */
async function getFareFamilyList(origin: string, destination: string): Promise<any> {
  const resp = await fetch(`${API_BASE}/getFareFamilyList`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      portList: [origin, destination],
      isMilesRequest: 'T',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[Turkish-API] getFareFamilyList ${resp.status}: ${text.slice(0, 300)}`);
    return null;
  }

  return resp.json();
}

/**
 * Call calculateAwardMilesWithTax to get miles pricing for a route.
 * Useful if getAvailability only returns cash fares.
 */
async function calculateAwardMiles(
  origin: string,
  destination: string,
  date: string,
  cabin: 'economy' | 'business' | 'first',
): Promise<{ miles: number; tax: number } | null> {
  const [year, month, day] = date.split('-');
  const awardType = cabin === 'economy' ? 'E' : 'B';

  const resp = await fetch(`${API_BASE}/calculateAwardMilesWithTax`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      awardType,
      wantMoreMiles: false,
      isOneWay: true,
      departureOrigin: origin,
      departureDestination: destination,
      departureDateDay: day,
      departureDateMonth: month,
      departureDateYear: year,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    console.error(`[Turkish-API] calculateAwardMiles ${resp.status}`);
    return null;
  }

  const json = await resp.json();

  // Try to extract miles from response — structure TBD
  // Log raw response for discovery
  console.error(`[Turkish-API] calculateAwardMiles raw response: ${JSON.stringify(json).slice(0, 500)}`);

  const miles = json?.data?.totalMiles || json?.data?.requiredMiles || json?.totalMiles || 0;
  const tax = json?.data?.totalTax?.amount || json?.data?.taxAmount || 0;

  if (miles > 0) {
    return { miles, tax };
  }
  return null;
}

/**
 * Normalize OriginDestinationOption to always be an array.
 * The API may return a single object or an array depending on result count.
 */
function normalizeToArray(val: any): any[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * Parse flight segments from OTA response into FlightResult[].
 */
function parseFlights(
  json: any,
  params: SearchParams,
  awardMiles: { miles: number; tax: number } | null,
): FlightResult[] {
  const results: FlightResult[] = [];
  const bookingUrl = buildBookingUrl(params);
  const requestedCabin = params.cabin === 'first' ? 'business' : params.cabin;

  // Navigate the OTA response structure
  const otaResponse = json?.data?.availabilityOTAResponse;
  if (!otaResponse) return results;

  const createRoute = otaResponse.createOTAAirRoute;
  if (!createRoute) return results;

  const ota = createRoute.OTA_AirAvailRS;
  if (!ota) return results;

  const odInfo = ota.OriginDestinationInformation;
  if (!odInfo) return results;

  const odOptions = odInfo.OriginDestinationOptions?.OriginDestinationOption;
  const options = normalizeToArray(odOptions);

  // Extra flight info (pricing, availability)
  const extraInfo = createRoute.extraOTAAvailabilityInfoListType?.extraOTAAvailabilityInfoList;
  const flightInfoList = extraInfo?.extraOTAFlightInfoListType?.extraOTAFlightInfoList || [];
  const flightInfos = normalizeToArray(flightInfoList);

  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const segments = normalizeToArray(option?.FlightSegment);
    if (segments.length === 0) continue;

    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];

    const flightNumber = `TK${firstSeg.FlightNumber || ''}`;
    const origin = firstSeg.DepartureAirport?.LocationCode || params.origin;
    const dest = lastSeg.ArrivalAirport?.LocationCode || params.destination;
    const depTime = firstSeg.DepartureDateTime || '';
    const arrTime = lastSeg.ArrivalDateTime || '';
    const carrier = firstSeg.OperatingAirline?.CompanyShortName || 'TK';
    const stops = parseInt(firstSeg.StopQuantity || '0', 10) + (segments.length - 1);

    // Duration — may be on first segment for direct, or we calculate from times
    let duration = '';
    if (firstSeg.JourneyDuration) {
      duration = parseDuration(firstSeg.JourneyDuration);
    }

    // Determine cabin from booking class availability
    const bookingClasses = normalizeToArray(firstSeg.BookingClassAvail);
    let cabin: 'economy' | 'business' = 'economy';
    for (const bc of bookingClasses) {
      const code = bc.ResBookDesigCode;
      if (['J', 'C', 'D', 'Z'].includes(code) && bc.ResBookDesigStatusCode === 'A') {
        cabin = 'business';
        break;
      }
    }

    // Filter by requested cabin
    if (cabin !== requestedCabin) continue;

    // Check availability from extra info
    const flightInfo = flightInfos[i];
    if (flightInfo && flightInfo.isFullAvailable === false) continue;

    // Try to get miles pricing from the response
    let pointsRequired = 0;
    let taxesAndFees = 0;

    // Check if pricing in the response is miles-based
    const fareBreakdowns = flightInfo?.bookingPriceInfoType?.PTC_FareBreakdowns?.PTC_FareBreakdown;
    if (fareBreakdowns) {
      const breakdowns = normalizeToArray(fareBreakdowns);
      for (const bd of breakdowns) {
        const baseFare = bd?.PassengerFare?.BaseFare;
        const totalFare = bd?.PassengerFare?.TotalFare;
        if (baseFare) {
          const amount = parseFloat(baseFare.Amount || '0');
          const currency = baseFare.CurrencyCode || '';

          // If currency is miles-related (TBD — could be "MILES", "MIL", or numeric)
          if (currency === 'MILES' || currency === 'MIL' || currency === 'TKM') {
            pointsRequired = amount;
            if (totalFare && totalFare.CurrencyCode === 'USD') {
              taxesAndFees = parseFloat(totalFare.Amount || '0');
            }
          }
        }
      }
    }

    // Fallback: use calculateAwardMiles result if no miles in availability response
    if (pointsRequired === 0 && awardMiles) {
      pointsRequired = awardMiles.miles;
      taxesAndFees = awardMiles.tax;
    }

    // Only include if we have some miles pricing
    if (pointsRequired <= 0) continue;

    results.push({
      source: 'turkish',
      airline: carrier === 'TK' ? 'Turkish Airlines' : carrier,
      flightNumber,
      origin,
      destination: dest,
      departureDate: params.date,
      departureTime: formatTime(depTime),
      arrivalTime: formatTime(arrTime),
      duration,
      stops,
      cabin,
      pointsRequired,
      pointsProgram: 'Miles&Smiles',
      taxesAndFees,
      awardType: 'saver',
      scrapedAt: new Date().toISOString(),
      bookingUrl,
    });
  }

  return results;
}

export async function searchTurkishApi(params: SearchParams): Promise<FlightResult[]> {
  if (!TK_API_KEY || !TK_API_SECRET) {
    throw new Error('TK_API_KEY and TK_API_SECRET env vars required (register at developer.apim.turkishairlines.com)');
  }

  const cacheKey = getCacheKey('turkish-api', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[Turkish-API] Cache hit for', cacheKey);
    return cached;
  }

  console.log(`[Turkish-API] Searching ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);

  const tkCabin = mapCabin(params.cabin);
  const tkDate = formatDate(params.date);

  // Build getAvailability request
  const reqBody = {
    requestHeader: {
      channel: 'WEB',
      clientTransactionId: crypto.randomUUID(),
      clientUsername: 'OPENAPI',
    },
    ReducedDataIndicator: false,
    RoutingType: 'O',
    TargetSource: 'PROGRAM_MILES_498',
    PassengerTypeQuantity: [
      { Code: 'adult', Quantity: params.passengers || 1 },
    ],
    OriginDestinationInformation: [{
      DepartureDateTime: {
        Date: tkDate,
        WindowAfter: 'P0D',
        WindowBefore: 'P0D',
      },
      OriginLocation: {
        LocationCode: params.origin,
        MultiAirportCityInd: false,
      },
      DestinationLocation: {
        LocationCode: params.destination,
        MultiAirportCityInd: false,
      },
      CabinPreferences: [{ Cabin: tkCabin }],
    }],
  };

  // Run getAvailability and calculateAwardMiles in parallel
  const [availResp, awardMiles] = await Promise.all([
    fetch(`${API_BASE}/getAvailability`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(15_000),
    }),
    calculateAwardMiles(params.origin, params.destination, params.date, params.cabin),
  ]);

  if (!availResp.ok) {
    const text = await availResp.text().catch(() => '');
    throw new Error(`Turkish API ${availResp.status}: ${text.slice(0, 300)}`);
  }

  const json = await availResp.json();

  // Log raw response for discovery (first time / debugging)
  const rawStr = JSON.stringify(json);
  if (rawStr.length < 5000) {
    console.error(`[Turkish-API] Raw response: ${rawStr}`);
  } else {
    console.error(`[Turkish-API] Raw response (truncated ${rawStr.length} chars): ${rawStr.slice(0, 2000)}`);
  }

  // Check for API-level errors
  if (json.status !== 'SUCCESS' && json.message?.code !== 'TK-0000') {
    const msg = json.message?.description || json.status || 'Unknown error';
    throw new Error(`Turkish API error: ${msg}`);
  }

  const results = parseFlights(json, params, awardMiles);

  console.log(`[Turkish-API] Found ${results.length} ${params.cabin} results`);
  setCache(cacheKey, results);
  return results;
}
