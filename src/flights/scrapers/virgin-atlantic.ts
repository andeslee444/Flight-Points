/**
 * Virgin Atlantic Award Search Scraper
 * 
 * Uses VA's GraphQL API at /flights/search/api/graphql
 * Shows SkyTeam partner availability: Delta, Air France, KLM, Korean Air, etc.
 * 
 * Approach: Playwright loads the search results page, which:
 *   1. Establishes Akamai session cookies
 *   2. Makes the GraphQL SearchOffers call
 *   We intercept that response for structured data.
 * 
 * Alternatively, once we have valid cookies, we can call the API directly.
 * 
 * Points shown are Virgin Atlantic Flying Club points.
 * 
 * Created: 2026-02-16
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext } from 'playwright';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

chromium.use(StealthPlugin());

const RATE_LIMIT_MS = 3000;

const AIRLINE_NAMES: Record<string, string> = {
  'DL': 'Delta',
  'AF': 'Air France',
  'KL': 'KLM',
  'KE': 'Korean Air',
  'VS': 'Virgin Atlantic',
  'CI': 'China Airlines',
  'AM': 'Aeromexico',
  'GA': 'Garuda Indonesia',
  'MU': 'China Eastern',
  'SV': 'Saudi Arabian Airlines',
  'VN': 'Vietnam Airlines',
  'SU': 'Aeroflot',
  'OK': 'Czech Airlines',
  'RO': 'TAROM',
  'ME': 'MEA',
  'AR': 'Aerolineas Argentinas',
};

function buildSearchUrl(params: SearchParams): string {
  // VA search results URL format
  const cabin = params.cabin === 'first' ? 'first' : params.cabin === 'business' ? 'upper' : 'economy';
  return `https://www.virginatlantic.com/flights/search/results?origin=${params.origin}&destination=${params.destination}&departure=${params.date}&ADT=1&cabin=${cabin}&tripType=ONE_WAY&awardSearch=true`;
}

// The GraphQL query used by VA's frontend
const SEARCH_QUERY = `query SearchOffers($request: FlightOfferRequestInput!) {
  searchOffers(request: $request) {
    result {
      slice {
        flightsAndFares {
          flight {
            segments {
              airline { code name __typename }
              flightNumber
              operatingAirline { code name __typename }
              origin { code cityName airportName __typename }
              destination { code cityName airportName __typename }
              duration
              departure
              arrival
              stopCount
              bookingClass
              __typename
            }
            duration
            origin { code __typename }
            destination { code __typename }
            departure
            arrival
            __typename
          }
          fares {
            availability
            id
            price {
              awardPoints
              tax
              amountIncludingTax
              currency
              __typename
            }
            fareSegments {
              cabinName
              bookingClass
              isSaverFare
              __typename
            }
            available
            fareFamilyType
            availableSeatCount
            isSaverFare
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

function buildGraphQLPayload(params: SearchParams) {
  return {
    operationName: 'SearchOffers',
    variables: {
      request: {
        pos: null,
        parties: null,
        flightSearchRequest: {
          searchOriginDestinations: [
            {
              origin: params.origin,
              destination: params.destination,
              departureDate: params.date,
            },
          ],
          bundleOffer: false,
          awardSearch: true,
          calendarSearch: false,
          flexiDateSearch: false,
          nonStopOnly: false,
          currentTripIndexId: '0',
          checkInBaggageAllowance: false,
          carryOnBaggageAllowance: false,
          refundableOnly: false,
        },
        customerDetails: [
          { custId: 'ADT_0', ptc: 'ADT' },
        ],
      },
    },
    query: SEARCH_QUERY,
  };
}

interface VAFare {
  availability: string;
  price: { awardPoints: number; tax: number; currency: string };
  fareSegments: Array<{ cabinName: string; bookingClass: string; isSaverFare: boolean }>;
  available: boolean;
  fareFamilyType: string;
  availableSeatCount: number;
  isSaverFare: boolean;
}

interface VASegment {
  airline: { code: string; name: string };
  flightNumber: string;
  operatingAirline: { code: string; name: string };
  origin: { code: string };
  destination: { code: string };
  duration: string;
  departure: string;
  arrival: string;
  stopCount: number;
}

interface VAFlightAndFare {
  flight: {
    segments: VASegment[];
    duration: string;
    origin: { code: string };
    destination: { code: string };
    departure: string;
    arrival: string;
  };
  fares: VAFare[];
}

function parseVAResponse(data: any, params: SearchParams): FlightResult[] {
  const results: FlightResult[] = [];

  try {
    const flightsAndFares: VAFlightAndFare[] =
      data?.data?.searchOffers?.result?.slice?.flightsAndFares || [];

    for (const ff of flightsAndFares) {
      const flight = ff.flight;
      const segments = flight.segments || [];
      const firstSeg = segments[0];
      if (!firstSeg) continue;

      // Get the operating airline
      const airlineCode = firstSeg.operatingAirline?.code || firstSeg.airline?.code || 'VS';
      const airlineName = AIRLINE_NAMES[airlineCode] || firstSeg.operatingAirline?.name || firstSeg.airline?.name || airlineCode;

      // Build flight number string
      const flightNumbers = segments.map(s => `${s.airline?.code || ''}${s.flightNumber}`).join('/');

      // Parse fares - find business/first class fares
      for (const fare of ff.fares) {
        if (!fare.available || fare.availability === 'SOLD_OUT') continue;

        // Determine cabin from fare
        const cabinName = fare.fareSegments?.[0]?.cabinName?.toLowerCase() || '';
        let cabin: 'economy' | 'business' | 'first' = 'economy';
        if (cabinName.includes('upper') || cabinName.includes('business') || fare.fareFamilyType?.includes('BUSINESS')) {
          cabin = 'business';
        } else if (cabinName.includes('first') || fare.fareFamilyType?.includes('FIRST')) {
          cabin = 'first';
        }

        // Filter to requested cabin
        if (cabin !== params.cabin) continue;

        const isSaver = fare.isSaverFare || fare.fareSegments?.some(fs => fs.isSaverFare);

        results.push({
          source: 'virgin-atlantic',
          airline: airlineName,
          flightNumber: flightNumbers,
          origin: flight.origin?.code || params.origin,
          destination: flight.destination?.code || params.destination,
          departureDate: params.date,
          departureTime: formatTime(flight.departure),
          arrivalTime: formatTime(flight.arrival),
          duration: formatDuration(flight.duration),
          stops: segments.length - 1,
          cabin,
          pointsRequired: fare.price?.awardPoints || 0,
          pointsProgram: 'Virgin Atlantic Flying Club',
          taxesAndFees: fare.price?.tax || 0,
          awardType: isSaver ? 'saver' : 'partner',
          scrapedAt: new Date().toISOString(),
          bookingUrl: buildSearchUrl(params),
        });
      }
    }
  } catch (err: any) {
    console.error('[VirginAtlantic] Error parsing response:', err.message);
  }

  return results;
}

function formatTime(isoString: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return isoString;
  }
}

function formatDuration(dur: string): string {
  if (!dur) return '';
  // VA returns ISO 8601 duration like "PT13H25M"
  const match = dur.match(/PT(\d+)H(?:(\d+)M)?/);
  if (match) return `${match[1]}h ${match[2] || '0'}m`;
  return dur;
}

export async function searchVirginAtlantic(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('virgin-atlantic', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[VirginAtlantic] Cache hit');
    return cached;
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const rawProxy = process.env.PROXY_URL || '';
    const proxyServer = rawProxy.startsWith('socks') ? rawProxy : '';
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-http2',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-first-run',
      ],
      ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    });

    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    const page = await context.newPage();

    // Cookie warming: visit homepage first
    console.log('[VirginAtlantic] Warming cookies on virginatlantic.com...');
    try {
      await page.goto('https://www.virginatlantic.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000 + Math.random() * 2000);
      try {
        const cookieBtn = page.locator('#onetrust-accept-btn-handler');
        if (await cookieBtn.isVisible({ timeout: 3000 })) {
          await cookieBtn.click();
          await page.waitForTimeout(1000);
        }
      } catch {}
      await page.evaluate(() => window.scrollBy(0, Math.random() * 300));
      await page.waitForTimeout(1000 + Math.random() * 1000);
    } catch (e: any) {
      console.log(`[VirginAtlantic] Cookie warming issue (continuing): ${e.message}`);
    }

    // Intercept the GraphQL API response
    const graphqlResponses: any[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('graphql') && url.includes('search')) {
        try {
          const json = await response.json();
          if (json?.data?.searchOffers) {
            graphqlResponses.push(json);
          }
        } catch {}
      }
    });

    const url = buildSearchUrl(params);
    console.log(`[VirginAtlantic] Searching: ${params.origin} → ${params.destination} on ${params.date} (${params.cabin})`);
    console.log(`[VirginAtlantic] URL: ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Accept cookies if prompted
    try {
      const cookieBtn = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept All")');
      if (await cookieBtn.isVisible({ timeout: 3000 })) {
        await cookieBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {}

    // Wait for results to load
    await page.waitForTimeout(RATE_LIMIT_MS);
    
    try {
      await page.waitForSelector('[class*="flight"], [class*="result"], [data-testid*="flight"]', { timeout: 30000 });
    } catch {
      console.log('[VirginAtlantic] No flight result selectors found, checking API intercepts...');
    }

    await page.waitForTimeout(3000);

    let results: FlightResult[] = [];

    // Method 1: Parse intercepted GraphQL responses
    if (graphqlResponses.length > 0) {
      console.log(`[VirginAtlantic] Got ${graphqlResponses.length} GraphQL responses`);
      for (const resp of graphqlResponses) {
        results.push(...parseVAResponse(resp, params));
      }
    }

    // Method 2: If no API intercept, try making the GraphQL call directly with the page's cookies
    if (results.length === 0) {
      console.log('[VirginAtlantic] No API intercept results, trying direct GraphQL call...');
      try {
        const apiResult = await page.evaluate(async (payload) => {
          const resp = await fetch('/flights/search/api/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          return resp.json();
        }, buildGraphQLPayload(params));

        if (apiResult?.data?.searchOffers) {
          results = parseVAResponse(apiResult, params);
        }
      } catch (err: any) {
        console.log('[VirginAtlantic] Direct GraphQL call failed:', err.message);
      }
    }

    // Method 3: DOM fallback
    if (results.length === 0) {
      console.log('[VirginAtlantic] Trying DOM parsing fallback...');
      const pageContent = await page.content();
      
      if (pageContent.includes('SOLD_OUT') || pageContent.includes('no availability')) {
        console.log('[VirginAtlantic] No availability for this route/date');
      } else if (pageContent.includes('captcha') || pageContent.includes('challenge')) {
        console.log('[VirginAtlantic] Blocked by bot detection');
      } else {
        console.log('[VirginAtlantic] Could not parse results. Page length:', pageContent.length);
      }
    }

    if (results.length > 0) {
      setCache(cacheKey, results);
    }

    console.log(`[VirginAtlantic] Found ${results.length} results`);
    return results;

  } catch (error: any) {
    console.error('[VirginAtlantic] Scraper error:', error.message);
    return [];
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Direct API search - requires valid session cookies from a previous browser session.
 * Much faster than full browser scrape but cookies expire.
 */
export async function searchVirginAtlanticAPI(
  params: SearchParams,
  cookies: string,
): Promise<FlightResult[]> {
  try {
    const payload = buildGraphQLPayload(params);
    const response = await fetch('https://www.virginatlantic.com/flights/search/api/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Origin': 'https://www.virginatlantic.com',
        'Referer': 'https://www.virginatlantic.com/flights/search/results',
        'Cookie': cookies,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[VirginAtlantic API] HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    return parseVAResponse(data, params);
  } catch (err: any) {
    console.error('[VirginAtlantic API] Error:', err.message);
    return [];
  }
}

export default { searchVirginAtlantic, searchVirginAtlanticAPI };
