/**
 * Cathay Pacific Asia Miles Award Search Scraper
 *
 * Cathay Pacific requires Asia Miles login for award search — no guest search.
 * 
 * Strategy (in priority order):
 *   1. seats.aero API — CX metal visible via `qantas` and `qatar` sources (no login needed)
 *   2. Playwright login-based scraper — requires CATHAY_MEMBER_ID + CATHAY_PASSWORD env vars
 *      - Logs into cathaypacific.com, fills award search form
 *      - Intercepts `milesInfo` API responses + window.pageBom for flight data
 *      - Based on reverse-engineering from flightplan-tool/flightplan CX engine
 *
 * Coverage: CX-operated flights + oneworld partner awards
 * Alliance: oneworld (complements AA scraper for Asia routes)
 * Key routes: JFK→HKG, JFK→NRT (via HKG), HKG→NRT, LAX→HKG
 *
 * Created: 2026-02-16
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext, Page } from 'playwright';
import { FlightResult, SearchParams, CabinCode } from '../types.js';
import { getCached, setCache } from './cache.js';

chromium.use(StealthPlugin());

// ============================================================
// CONFIGURATION
// ============================================================

const CX_AWARD_URL = 'https://www.cathaypacific.com/cx/en_US/book-a-trip/redeem-flights/redeem-flight-awards.html';
const SEATS_AERO_API = 'https://seats.aero/partnerapi';

const CABIN_MAP: Record<CabinCode, string> = {
  economy: 'Y',
  business: 'C',
  first: 'F',
};

// seats.aero cabin field mapping
const SEATS_CABIN_FIELD: Record<CabinCode, { available: string; airlines: string; miles: string; seats: string }> = {
  economy: { available: 'YAvailable', airlines: 'YAirlines', miles: 'YMileageCost', seats: 'YRemainingSeats' },
  business: { available: 'JAvailable', airlines: 'JAirlines', miles: 'JMileageCost', seats: 'JRemainingSeats' },
  first: { available: 'FAvailable', airlines: 'FAirlines', miles: 'FMileageCost', seats: 'FRemainingSeats' },
};

const MAX_RETRIES = 2;
const PAGE_TIMEOUT = 30000;

// ============================================================
// SEATS.AERO APPROACH (Primary — no login needed)
// ============================================================

/**
 * Search for CX availability via seats.aero API.
 * CX metal shows up in `qantas` and `qatar` sources.
 * Filters results to only include entries with CX in the airline list.
 */
async function searchViaSeatsAero(params: SearchParams): Promise<FlightResult[]> {
  const apiKey = process.env.SEATS_AERO_API_KEY;
  if (!apiKey) {
    console.log('[cathay] No SEATS_AERO_API_KEY — skipping seats.aero');
    return [];
  }

  const cabinField = SEATS_CABIN_FIELD[params.cabin || 'business'];
  const results: FlightResult[] = [];

  // Query both qantas and qatar sources (they show CX metal)
  for (const source of ['qantas', 'qatar']) {
    try {
      const url = new URL(`${SEATS_AERO_API}/search`);
      url.searchParams.set('origin_airport', params.origin);
      url.searchParams.set('destination_airport', params.destination);
      url.searchParams.set('cabin', params.cabin === 'first' ? 'first' : params.cabin === 'business' ? 'business' : 'economy');
      url.searchParams.set('source', source);
      if (params.date) {
        url.searchParams.set('start_date', params.date);
        url.searchParams.set('end_date', params.date);
      }

      const resp = await fetch(url.toString(), {
        headers: { 'Partner-Authorization': apiKey },
      });

      if (!resp.ok) {
        console.log(`[cathay] seats.aero ${source} returned ${resp.status}`);
        continue;
      }

      const data = await resp.json() as any;
      for (const entry of data.data || []) {
        const airlines = entry[cabinField.airlines] || '';
        const available = entry[cabinField.available];

        // Only include if CX is in the airline list for the requested cabin
        if (!available || !airlines.includes('CX')) continue;

        results.push({
          airline: 'CX',
          flightNumber: `CX (via ${source})`, // seats.aero doesn't provide flight numbers
          origin: entry.Route?.OriginAirport || params.origin,
          destination: entry.Route?.DestinationAirport || params.destination,
          departureDate: entry.Date || params.date,
          departureTime: `${entry.Date}T00:00:00`,
          arrivalTime: `${entry.Date}T23:59:59`,
          duration: '', // Not available from seats.aero
          stops: -1, // Unknown
          cabin: params.cabin || 'business',
          pointsRequired: parseInt(entry[cabinField.miles]) || 0,
          taxesAndFees: 0,
          source: `seats.aero/${source}`,
          scrapedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error(`[cathay] seats.aero ${source} error:`, err);
    }
  }

  return results;
}

// ============================================================
// PLAYWRIGHT LOGIN APPROACH (Secondary — needs credentials)
// ============================================================

/**
 * Search CX award availability directly on cathaypacific.com.
 * Requires CATHAY_MEMBER_ID and CATHAY_PASSWORD environment variables.
 * 
 * Flow:
 * 1. Navigate to award search page
 * 2. Login with Asia Miles credentials
 * 3. Fill search form (origin, destination, date, cabin)
 * 4. Intercept milesInfo API response + window.pageBom for flight data
 * 5. Parse results
 */
async function searchViaCathayWebsite(params: SearchParams): Promise<FlightResult[]> {
  const memberId = process.env.CATHAY_MEMBER_ID;
  const password = process.env.CATHAY_PASSWORD;

  if (!memberId || !password) {
    console.log('[cathay] No CATHAY_MEMBER_ID/CATHAY_PASSWORD — skipping website scraper');
    return [];
  }

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
    });

    const page = await context.newPage();

    // Collect milesInfo API responses
    const milesInfoData: any[] = [];
    page.on('response', async (response) => {
      try {
        if (response.url().includes('milesInfo')) {
          const contentLength = parseInt(response.headers()['content-length'] || '0');
          if (contentLength > 0) {
            const json = await response.json();
            milesInfoData.push(json);
          }
        }
      } catch {}
    });

    // Navigate to award search page
    await page.goto(CX_AWARD_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(3000);

    // Login
    console.log('[cathay] Logging in...');
    try {
      await page.waitForSelector('#account-login #username, li.member-section', { timeout: 10000 });
    } catch {
      // May already be on the search page or login form might be different
      console.log('[cathay] Login form not found — page may have changed');
      return [];
    }

    // Check if already logged in
    const isLoggedIn = await page.$('li.member-section');
    if (!isLoggedIn) {
      await page.fill('#account-login #username', memberId);
      await page.fill('#account-login #password', password);
      await page.waitForTimeout(500);

      // Check "remember me" if unchecked
      const rememberChecked = await page.$('#account-login #checkRememberMe:checked');
      if (!rememberChecked) {
        await page.click('label[for=checkRememberMe]').catch(() => {});
      }

      await page.click('#account-login button.btn-primary');
      await page.waitForTimeout(5000);

      // Check for login errors
      const errorText = await page.textContent('div.global-error-wrap li').catch(() => '');
      if (errorText && errorText.includes('incorrect')) {
        throw new Error('Invalid Cathay credentials');
      }

      // Check for captcha
      const captcha = await page.$('#captcha-container');
      if (captcha) {
        throw new Error('Captcha detected — bot blocked');
      }
    }

    // Fill search form
    console.log('[cathay] Filling search form...');
    const cabin = CABIN_MAP[params.cabin || 'business'];

    // Set origin
    await page.click('#input-origin');
    await page.fill('#input-origin', params.origin);
    await page.waitForTimeout(1000);
    await page.click(`#results-origin li:first-child`).catch(() =>
      page.keyboard.press('Enter')
    );

    // Set destination
    await page.click('#input-destination');
    await page.fill('#input-destination', params.destination);
    await page.waitForTimeout(1000);
    await page.click(`#results-destination li:first-child`).catch(() =>
      page.keyboard.press('Enter')
    );

    // Set one-way
    await page.click('#tab-itinerary-type-oneway span').catch(() => {});
    await page.waitForTimeout(500);

    // Set date
    await setSearchDate(page, params.date);

    // Set cabin class
    await page.selectOption('#select-cabin', cabin).catch(() => {});

    // Submit
    await page.click('button.btn-facade-search');
    await page.waitForTimeout(8000);

    // Check for "no flights available"
    const errorMsg = await page.textContent('span.label-error').catch(() => '');
    if (errorMsg && errorMsg.includes('no flights available')) {
      console.log('[cathay] No flights available');
      return [];
    }

    // Extract flight data from page
    const pageData = await page.evaluate(() => {
      const w = window as any;
      return {
        pageBom: w.pageBom || null,
        tiersListOutbound: w.tiersListOutbound || null,
        tiersListInbound: w.tiersListInbound || null,
      };
    });

    const flights = parseCathayResults(pageData, milesInfoData, params);
    return flights;

  } catch (err) {
    console.error('[cathay] Website scraper error:', err);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

async function setSearchDate(page: Page, dateStr: string): Promise<void> {
  // Parse date: YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number);
  const targetMonth = `${year}-${String(month).padStart(2, '0')}`;

  // Open date picker
  await page.click('div.travel-dates-ow-wrapper button:nth-of-type(1)').catch(() => {});
  await page.waitForTimeout(500);

  // Navigate to correct month
  for (let i = 0; i < 24; i++) {
    const currentMonth = await page.textContent('.ui-datepicker-title').catch(() => '');
    if (!currentMonth) break;

    // Check if we're on the right month
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const targetMonthName = monthNames[month - 1];
    if (currentMonth.includes(targetMonthName) && currentMonth.includes(String(year))) {
      break;
    }

    await page.click('.ui-datepicker-next').catch(() => {});
    await page.waitForTimeout(300);
  }

  // Click the day
  await page.click(`td[data-handler="selectDay"] a:text("${day}")`).catch(() =>
    page.click(`a.ui-state-default:text-is("${day}")`).catch(() => {})
  );
  await page.waitForTimeout(500);
}

function parseCathayResults(
  pageData: any,
  milesInfo: any[],
  params: SearchParams
): FlightResult[] {
  const results: FlightResult[] = [];

  // Parse from tiersListOutbound (structured flight data)
  if (pageData?.tiersListOutbound) {
    for (const tier of Object.values(pageData.tiersListOutbound) as any[]) {
      if (!tier || !Array.isArray(tier)) continue;
      for (const flight of tier) {
        try {
          results.push({
            airline: flight.marketingAirline || 'CX',
            flightNumber: flight.flightNumber || 'CX???',
            origin: flight.origin || params.origin,
            destination: flight.destination || params.destination,
            departureDate: params.date,
            departureTime: flight.departureDate || params.date,
            arrivalTime: flight.arrivalDate || params.date,
            duration: flight.duration ? String(flight.duration) : '',
            stops: flight.stopCount ?? 0,
            cabin: params.cabin || 'business',
            pointsRequired: flight.miles || 0,
            taxesAndFees: flight.tax || 0,
            source: 'cathay-website',
            scrapedAt: new Date().toISOString(),
          });
        } catch {}
      }
    }
  }

  // Parse from pageBom (fallback)
  if (results.length === 0 && pageData?.pageBom) {
    const bom = Array.isArray(pageData.pageBom) ? pageData.pageBom : [pageData.pageBom];
    for (const bomEntry of bom) {
      if (!bomEntry?.flights) continue;
      for (const flight of bomEntry.flights) {
        try {
          results.push({
            airline: flight.airline || 'CX',
            flightNumber: flight.flightNo || 'CX???',
            origin: flight.depAirport || params.origin,
            destination: flight.arrAirport || params.destination,
            departureDate: params.date,
            departureTime: flight.depDateTime || params.date,
            arrivalTime: flight.arrDateTime || params.date,
            duration: flight.duration ? String(flight.duration) : '',
            stops: flight.stops || 0,
            cabin: params.cabin || 'business',
            pointsRequired: 0,
            taxesAndFees: 0,
            source: 'cathay-website',
            scrapedAt: new Date().toISOString(),
          });
        } catch {}
      }
    }
  }

  // Merge miles info
  if (milesInfo.length > 0) {
    const mergedMiles = milesInfo.reduce((acc, curr) => ({
      ...acc,
      ...(curr.milesInfo || curr),
    }), {});

    for (const flight of results) {
      const key = flight.flightNumber;
      if (mergedMiles[key]) {
        flight.pointsRequired = mergedMiles[key].miles || flight.pointsRequired;
        flight.taxesAndFees = mergedMiles[key].tax || flight.taxesAndFees;
      }
    }
  }

  return results;
}

// ============================================================
// MAIN EXPORT
// ============================================================

export async function searchCathay(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = `cathay:${params.origin}-${params.destination}:${params.date}:${params.cabin}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  console.log(`[cathay] Searching ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);

  // Try seats.aero first (reliable, no login)
  let flights = await searchViaSeatsAero(params);

  // If no seats.aero results, try direct website scraping
  if (flights.length === 0) {
    flights = await searchViaCathayWebsite(params);
  }

  if (flights.length > 0) {
    setCache(cacheKey, flights);
  }

  console.log(`[cathay] Found ${flights.length} results`);
  return flights;
}

export const cathayScraper = {
  name: 'cathay',
  search: searchCathay,
};
