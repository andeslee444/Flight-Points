/**
 * British Airways / Avios Award Search Scraper
 * 
 * BA's reward search shows ALL oneworld partner availability:
 * Cathay Pacific, Japan Airlines, Qatar Airways, American Airlines, Qantas
 * 
 * Avios is the currency for: BA, Qatar, Iberia, Aer Lingus
 * Critical for oneworld sweet spots (e.g., Qatar QSuites JFK→DOH = 70K AA miles)
 * 
 * NOTE: BA heavily protects their search with bot detection (Akamai).
 * This scraper uses Playwright with stealth measures.
 *
 * Created: 2026-02-16
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { FlightResult, SearchParams, CabinCode } from '../types.js';
import { getStealthManager } from '../../stealth.js';
import { getCached, setCache } from './cache.js';

// ============================================================
// CONSTANTS
// ============================================================

const BA_SEARCH_URL = 'https://www.britishairways.com/travel/redeem/execclub/';
const BA_REWARD_SEARCH = 'https://www.britishairways.com/flights';

// BA cabin class mapping
const BA_CABIN_MAP: Record<CabinCode, string> = {
  economy: 'M',      // Economy (World Traveller)
  business: 'J',     // Business (Club World)
  first: 'F',        // First
};

// Airline code to name mapping for oneworld partners
const AIRLINE_NAMES: Record<string, string> = {
  'BA': 'British Airways',
  'CX': 'Cathay Pacific',
  'JL': 'Japan Airlines',
  'QR': 'Qatar Airways',
  'AA': 'American Airlines',
  'QF': 'Qantas',
  'IB': 'Iberia',
  'AY': 'Finnair',
  'MH': 'Malaysia Airlines',
  'RJ': 'Royal Jordanian',
  'S7': 'S7 Airlines',
  'UL': 'SriLankan Airlines',
  'AT': 'Royal Air Maroc',
  'EI': 'Aer Lingus',
  'FJ': 'Fiji Airways',
  'NU': 'Japan Transocean Air',
};

const stealth = getStealthManager();

// ============================================================
// MAIN SCRAPER
// ============================================================

export async function searchBAAvios(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = `ba-avios:${params.origin}-${params.destination}:${params.date}:${params.cabin}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    await stealth.stealthDelay();

    const launchOpts = stealth.getPlaywrightOptions();
    browser = await chromium.launch({
      ...launchOpts,
      headless: true,
    });

    const contextOpts = stealth.getContextOptions();
    context = await browser.newContext(contextOpts);

    const page = await context.newPage();

    // Inject stealth scripts
    await page.addInitScript(stealth.getStealthScript());

    // Navigate to BA search
    const searchUrl = buildBASearchUrl(params);
    console.log(`[BA Avios] Searching: ${params.origin} → ${params.destination} on ${params.date} (${params.cabin})`);

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {
      // fallback
      return page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    });

    await stealth.stealthDelay();

    // Accept cookies if prompted
    await acceptCookies(page);

    // Try to intercept API responses
    const results = await scrapeResults(page, params);

    if (results.length > 0) {
      setCache(cacheKey, results);
    }

    return results;
  } catch (error) {
    console.error(`[BA Avios] Error:`, error instanceof Error ? error.message : error);
    return [];
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// ============================================================
// URL BUILDER
// ============================================================

function buildBASearchUrl(params: SearchParams): string {
  const cabin = BA_CABIN_MAP[params.cabin] || 'M';
  const pax = params.passengers || 1;

  // BA's modern search URL format
  const url = new URL('https://www.britishairways.com/travel/book/public/en_us');
  url.searchParams.set('from', params.origin);
  url.searchParams.set('to', params.destination);
  url.searchParams.set('depDate', params.date);
  url.searchParams.set('cabin', cabin);
  url.searchParams.set('adult', String(pax));
  url.searchParams.set('child', '0');
  url.searchParams.set('infant', '0');
  url.searchParams.set('type', 'AVIOS'); // Reward flights
  url.searchParams.set('directFlights', 'false');

  return url.toString();
}

// ============================================================
// SCRAPING
// ============================================================

async function acceptCookies(page: Page): Promise<void> {
  try {
    const acceptBtn = page.locator('button:has-text("Accept"), #acceptCookies, [data-testid="cookie-accept"]');
    if (await acceptBtn.isVisible({ timeout: 3000 })) {
      await acceptBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch {
    // No cookie banner
  }
}

async function scrapeResults(page: Page, params: SearchParams): Promise<FlightResult[]> {
  const results: FlightResult[] = [];

  try {
    // Wait for results to load
    await page.waitForSelector(
      '.flight-list, .flight-result, [class*="FlightCard"], [class*="flight-option"], [data-testid*="flight"]',
      { timeout: 15000 }
    ).catch(() => null);

    // Try multiple selector strategies for BA's frequently changing UI
    const flightCards = await page.$$('.flight-list-item, .flight-result, [class*="FlightCard"], [class*="flight-option"]');

    if (flightCards.length === 0) {
      // Try intercepting XHR/fetch responses with flight data
      return await interceptApiResults(page, params);
    }

    for (const card of flightCards) {
      try {
        const result = await parseFlightCard(card, params);
        if (result) results.push(result);
      } catch {
        // Skip unparseable cards
      }
    }
  } catch (error) {
    console.warn(`[BA Avios] Scrape error, trying API intercept:`, error instanceof Error ? error.message : error);
    return await interceptApiResults(page, params);
  }

  return results;
}

async function parseFlightCard(card: any, params: SearchParams): Promise<FlightResult | null> {
  const text = await card.textContent();
  if (!text) return null;

  // Extract airline code from flight number pattern (e.g., "QR 702", "BA 5")
  const flightMatch = text.match(/\b([A-Z]{2})\s*(\d{1,4})\b/);
  const airlineCode = flightMatch?.[1] || 'BA';
  const flightNumber = flightMatch ? `${flightMatch[1]}${flightMatch[2]}` : 'BA???';

  // Extract times
  const timeMatch = text.match(/(\d{1,2}:\d{2})\s*(?:—|–|-|→)\s*(\d{1,2}:\d{2})/);
  const departureTime = timeMatch?.[1] || '';
  const arrivalTime = timeMatch?.[2] || '';

  // Extract Avios points
  const aviosMatch = text.match(/([\d,]+)\s*(?:Avios|avios|pts)/i);
  const points = aviosMatch ? parseInt(aviosMatch[1].replace(/,/g, '')) : undefined;

  // Extract taxes
  const taxMatch = text.match(/[£$€]([\d,.]+)/);
  const taxes = taxMatch ? parseFloat(taxMatch[1].replace(/,/g, '')) : undefined;

  // Duration
  const durationMatch = text.match(/(\d+)h\s*(\d+)?m?/);
  const duration = durationMatch
    ? `${durationMatch[1]}h ${durationMatch[2] || '0'}m`
    : '';

  // Stops
  const stopsMatch = text.match(/(non-?stop|direct|\d+)\s*stop/i);
  const stops = stopsMatch
    ? (stopsMatch[1].toLowerCase().includes('non') || stopsMatch[1].toLowerCase() === 'direct' ? 0 : parseInt(stopsMatch[1]))
    : 0;

  return {
    source: 'ba-avios',
    airline: AIRLINE_NAMES[airlineCode] || airlineCode,
    flightNumber,
    origin: params.origin,
    destination: params.destination,
    departureDate: params.date,
    departureTime,
    arrivalTime,
    duration,
    stops,
    cabin: params.cabin,
    pointsRequired: points,
    pointsProgram: 'Avios',
    taxesAndFees: taxes,
    awardType: 'saver',
    scrapedAt: new Date().toISOString(),
    bookingUrl: buildBASearchUrl(params),
  };
}

async function interceptApiResults(page: Page, params: SearchParams): Promise<FlightResult[]> {
  const results: FlightResult[] = [];

  // BA often loads flight data via XHR. Try to capture page content as JSON.
  try {
    const pageContent = await page.content();

    // Look for JSON data embedded in page
    const jsonMatch = pageContent.match(/__NEXT_DATA__.*?({.*?})<\/script>/)
      || pageContent.match(/window\.__data\s*=\s*({.*?});/)
      || pageContent.match(/flightResults['"]\s*:\s*(\[.*?\])/);

    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        // Parse the embedded data structure
        const flights = extractFlightsFromJson(data, params);
        results.push(...flights);
      } catch {
        // JSON parse failure
      }
    }

    // If still no results, try evaluating page for visible flight info
    if (results.length === 0) {
      const pageText = await page.evaluate(() => document.body?.innerText || '');

      // Check for common block messages
      if (pageText.includes('unable to process') || pageText.includes('try again') || pageText.includes('captcha')) {
        console.warn('[BA Avios] Likely blocked by bot detection (Akamai).');
        return [];
      }

      if (pageText.includes('no available') || pageText.includes('No flights found')) {
        console.log('[BA Avios] No availability found for this route/date.');
        return [];
      }
    }
  } catch (error) {
    console.warn('[BA Avios] API intercept failed:', error instanceof Error ? error.message : error);
  }

  return results;
}

function extractFlightsFromJson(data: any, params: SearchParams): FlightResult[] {
  const results: FlightResult[] = [];

  // Navigate various possible BA data structures
  const flights = data?.flights || data?.outbound || data?.results || [];
  const flightArray = Array.isArray(flights) ? flights : [];

  for (const flight of flightArray) {
    try {
      const airlineCode = flight.carrier || flight.airlineCode || flight.marketingCarrier || 'BA';
      results.push({
        source: 'ba-avios',
        airline: AIRLINE_NAMES[airlineCode] || airlineCode,
        flightNumber: flight.flightNumber || `${airlineCode}${flight.number || ''}`,
        origin: flight.origin || params.origin,
        destination: flight.destination || params.destination,
        departureDate: params.date,
        departureTime: flight.departureTime || flight.departure || '',
        arrivalTime: flight.arrivalTime || flight.arrival || '',
        duration: flight.duration || flight.journeyTime || '',
        stops: flight.stops ?? flight.numberOfStops ?? 0,
        cabin: params.cabin,
        pointsRequired: flight.avios || flight.points || flight.miles,
        pointsProgram: 'Avios',
        taxesAndFees: flight.tax || flight.taxes || flight.cashAmount,
        awardType: flight.type === 'peak' ? 'everyday' : 'saver',
        scrapedAt: new Date().toISOString(),
        bookingUrl: buildBASearchUrl(params),
      });
    } catch {
      // Skip
    }
  }

  return results;
}

// ============================================================
// ALTERNATIVE: Direct API approach (if BA has accessible endpoints)
// ============================================================

/**
 * BA sometimes exposes internal API endpoints. This attempts a direct API call.
 * Note: This is fragile and may stop working at any time.
 */
export async function searchBAAviosApi(params: SearchParams): Promise<FlightResult[]> {
  try {
    const cabin = BA_CABIN_MAP[params.cabin] || 'M';

    // BA's internal availability API (discovered from network inspection)
    const apiUrl = 'https://api.ba.com/api/flights/avios/search';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': 'https://www.britishairways.com',
        'Referer': 'https://www.britishairways.com/',
      },
      body: JSON.stringify({
        origin: params.origin,
        destination: params.destination,
        departureDate: params.date,
        cabinClass: cabin,
        adults: params.passengers || 1,
        children: 0,
        infants: 0,
        redemption: true,
      }),
    });

    if (!response.ok) {
      console.warn(`[BA Avios API] HTTP ${response.status} — falling back to browser scraper`);
      return searchBAAvios(params);
    }

    const data = await response.json();
    return extractFlightsFromJson(data, params);
  } catch {
    // API not accessible, fall back to browser
    return searchBAAvios(params);
  }
}

export default { searchBAAvios, searchBAAviosApi };
