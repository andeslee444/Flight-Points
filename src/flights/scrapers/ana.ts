/**
 * ANA (All Nippon Airways) Mileage Club Award Search Scraper
 *
 * ANA has the best Star Alliance redemption rates and arguably the best
 * first/business class product (The Suite / The Room on 777-300ER).
 *
 * STRATEGY (multi-layer):
 * 1. Award Calendar API (cam.ana.co.jp) — fast, shows 6 months availability
 * 2. Full award search via Playwright (login required) — detailed results
 * 3. Fallback: award chart estimates (no login needed)
 *
 * SWEET SPOTS (ANA miles, one-way):
 * - ANA First US→Japan: 55K-75K (low/high season)
 * - ANA Business US→Japan: 43K-55K
 * - ANA Economy US→Japan: 30K-38K
 * - Round-the-world First: 180K
 *
 * REQUIREMENTS:
 * - ANA_USERNAME (10-digit AMC number) + ANA_PASSWORD env vars
 * - Free signup: https://www.ana.co.jp/en/us/amc/
 *
 * Created: 2026-02-16
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { FlightResult, SearchParams } from '../types.js';
import { getStealthManager } from '../../stealth.js';
import { getCached, setCache } from './cache.js';

// ============================================================
// CONSTANTS & CONFIG
// ============================================================

const ANA_LOGIN_URL = 'https://cam.ana.co.jp/psz/tokutencal/form_e.jsp';
const ANA_CALENDAR_URL = 'https://cam.ana.co.jp/psz/tokutencal/calendar_e.jsp';
const ANA_SEARCH_URL = 'https://www.ana.co.jp/en/jp/guide/reservation/flight-awards/';
const ANA_AWARD_BOOKING = 'https://aswbe-i.ana.co.jp/international_asw/pages/award/search/roundtrip/award_search_roundtrip_input.xhtml';

type CabinCode = 'economy' | 'business' | 'first';

const ANA_CABIN_MAP: Record<CabinCode, string> = {
  economy: 'Y',
  business: 'C',
  first: 'F',
};

// ANA zone mapping for award chart
const JAPAN_AIRPORTS = new Set(['NRT', 'HND', 'KIX', 'NGO', 'FUK', 'CTS', 'OKA', 'ITM']);
const US_AIRPORTS_MAJOR = new Set(['JFK', 'LAX', 'SFO', 'ORD', 'IAH', 'IAD', 'SEA', 'EWR']);
const EUROPE_AIRPORTS = new Set([
  'LHR', 'CDG', 'FRA', 'MUC', 'FCO', 'BCN', 'MAD', 'AMS', 'ZRH', 'VIE',
  'IST', 'BRU', 'DUS', 'MXP', 'LIS', 'CPH', 'ARN', 'OSL', 'HEL',
]);

// ANA 2025-2026 award chart (one-way, ANA miles)
// Reference: https://www.ana.co.jp/en/us/amc/international-flight-awards/2025-2026/
export const ANA_AWARD_CHART = {
  'US-Japan': {
    economy:        { low: 30000, regular: 35000, high: 38000 },
    'premium-eco':  { low: 40000, regular: 46000, high: 49000 },
    business:       { low: 43000, regular: 50000, high: 55000 },
    first:          { low: 55000, regular: 75000, high: 75000 },
  },
  'US-Europe': {
    economy:        { low: 30000, regular: 35000, high: 40000 },
    'premium-eco':  { low: 43000, regular: 50000, high: 55000 },
    business:       { low: 48000, regular: 58000, high: 63000 },
    first:          { low: 62000, regular: 80000, high: 88000 },
  },
  'US-Asia': {
    economy:        { low: 30000, regular: 35000, high: 38000 },
    'premium-eco':  { low: 40000, regular: 46000, high: 49000 },
    business:       { low: 43000, regular: 50000, high: 55000 },
    first:          { low: 55000, regular: 75000, high: 75000 },
  },
  'Japan-Europe': {
    economy:        { low: 25000, regular: 30000, high: 33000 },
    'premium-eco':  { low: 36000, regular: 40000, high: 43000 },
    business:       { low: 38000, regular: 45000, high: 50000 },
    first:          { low: 50000, regular: 65000, high: 75000 },
  },
};

// ANA season calendar (approximate — check ana.co.jp for exact dates)
const LOW_SEASON_MONTHS = [1, 4, 11]; // Jan, Apr, Nov (approx)
const HIGH_SEASON_MONTHS = [3, 7, 8, 12]; // Mar, Jul, Aug, Dec (approx)

const stealth = getStealthManager();

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Search ANA award availability.
 *
 * Flow:
 * 1. Check cache
 * 2. If ANA credentials → try Award Calendar scrape → full search
 * 3. If no credentials → return award chart estimates
 */
export async function searchANA(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = `ana:${params.origin}-${params.destination}:${params.date}:${params.cabin}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const username = process.env.ANA_USERNAME;
  const password = process.env.ANA_PASSWORD;

  if (!username || !password) {
    console.warn('[ANA] No credentials. Set ANA_USERNAME (10-digit AMC#) and ANA_PASSWORD.');
    console.warn('[ANA] Free signup: https://www.ana.co.jp/en/us/amc/');
    console.warn('[ANA] Returning award chart estimates (not actual availability).');
    return getEstimatedAvailability(params);
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({
      ...stealth.getPlaywrightOptions(),
      headless: true, // Use headless for daemon; switch to false only for debugging
    });

    context = await browser.newContext({
      ...stealth.getContextOptions(),
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    const page = await context.newPage();
    await page.addInitScript(stealth.getStealthScript());

    // Intercept API responses for structured data
    const interceptedData: any[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (
        url.includes('/api/') ||
        url.includes('/search') ||
        url.includes('flightResult') ||
        url.includes('calendar') ||
        url.includes('availability')
      ) {
        try {
          const ct = response.headers()['content-type'] || '';
          if (ct.includes('json')) {
            const data = await response.json();
            interceptedData.push({ url, data });
          }
        } catch { /* ignore */ }
      }
    });

    // Step 1: Login via the award calendar page (simplest login form)
    const loggedIn = await loginANA(page, username, password);
    if (!loggedIn) {
      console.warn('[ANA] Login failed. Returning estimates.');
      return getEstimatedAvailability(params);
    }

    // Step 2: Try Award Calendar first (faster, shows 6-month overview)
    let results = await scrapeAwardCalendar(page, params, interceptedData);

    // Step 3: If calendar didn't yield results, try full award search
    if (results.length === 0) {
      results = await performFullAwardSearch(page, params, interceptedData);
    }

    if (results.length > 0) {
      setCache(cacheKey, results);
    } else {
      // Return estimates as fallback
      results = getEstimatedAvailability(params);
    }

    return results;
  } catch (error) {
    console.error('[ANA] Scraper error:', error instanceof Error ? error.message : error);
    return getEstimatedAvailability(params);
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// ============================================================
// LOGIN
// ============================================================

async function loginANA(page: Page, username: string, password: string): Promise<boolean> {
  try {
    console.log('[ANA] Navigating to login...');
    await page.goto(ANA_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await stealth.stealthDelay();

    // The award calendar login page has a simple form
    // ANA Number field (10-digit)
    const amcField = page.locator('input[name="amcMemberNo"], input[name="memberNo"], input[id*="amcNo"], input[id*="memberNo"], input[maxlength="10"]').first();
    const pwField = page.locator('input[type="password"]').first();

    if (await amcField.isVisible({ timeout: 8000 })) {
      console.log('[ANA] Found login form, entering credentials...');
      await amcField.click();
      await stealth.stealthDelay();
      await amcField.fill(username);
      await stealth.stealthDelay();

      await pwField.click();
      await stealth.stealthDelay();
      await pwField.fill(password);
      await stealth.stealthDelay();

      // Find and click login/submit button
      const loginBtn = page.locator(
        'input[type="submit"], input[type="image"][src*="login"], button[type="submit"], ' +
        'a:has-text("Log in"), a:has-text("Login"), input[value*="Login"], input[value*="Log in"]'
      ).first();

      if (await loginBtn.isVisible({ timeout: 5000 })) {
        await loginBtn.click();
      } else {
        // Try submitting the form directly
        await pwField.press('Enter');
      }

      // Wait for navigation
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await stealth.stealthDelay();

      // Check for successful login
      const currentUrl = page.url();
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');

      if (
        bodyText.includes('Calendar') ||
        bodyText.includes('calendar') ||
        bodyText.includes('Award') ||
        bodyText.includes('Welcome') ||
        bodyText.includes('Logout') ||
        bodyText.includes('logout') ||
        currentUrl.includes('calendar') ||
        !currentUrl.includes('form_e.jsp') // navigated away from login
      ) {
        console.log('[ANA] Login successful');
        return true;
      }

      // Check for error messages
      if (bodyText.includes('incorrect') || bodyText.includes('error') || bodyText.includes('invalid')) {
        console.error('[ANA] Login failed: invalid credentials');
        return false;
      }

      // Ambiguous — might still be ok
      console.warn('[ANA] Login status uncertain, continuing...');
      return true;
    }

    console.error('[ANA] Login form not found');
    return false;
  } catch (error) {
    console.error('[ANA] Login error:', error instanceof Error ? error.message : error);
    return false;
  }
}

// ============================================================
// AWARD CALENDAR SCRAPE
// ============================================================

/**
 * Scrape ANA's International Award Calendar.
 * URL: cam.ana.co.jp/psz/tokutencal/calendar_e.jsp
 *
 * The calendar shows availability status for each date using shapes/colors:
 * - Circle (○) = available
 * - Double circle (◎) = wide open
 * - Triangle (△) = limited
 * - Cross (×) = unavailable
 * - Dash (—) = not applicable
 */
async function scrapeAwardCalendar(
  page: Page,
  params: SearchParams,
  interceptedData: any[],
): Promise<FlightResult[]> {
  const results: FlightResult[] = [];

  try {
    console.log('[ANA] Checking Award Calendar...');

    // Navigate to calendar (we should already be here after login)
    const currentUrl = page.url();
    if (!currentUrl.includes('tokutencal')) {
      await page.goto(ANA_CALENDAR_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await stealth.stealthDelay();
    }

    // Select route and cabin on the calendar form
    // The calendar lets you filter by region pair and cabin class
    const regionSelect = page.locator('select[name*="route"], select[name*="area"], select[id*="route"]').first();
    const cabinSelect = page.locator('select[name*="class"], select[name*="cabin"], select[id*="class"]').first();

    if (await regionSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Try to select the route region (e.g., "North America - Japan")
      const routeZone = getRouteZone(params.origin, params.destination);
      const options = await regionSelect.locator('option').allTextContents();
      console.log('[ANA] Calendar route options:', options.join(', '));

      // Find matching option
      const matchOption = options.find(opt => {
        const lower = opt.toLowerCase();
        if (routeZone === 'US-Japan') return lower.includes('north america') && lower.includes('japan');
        if (routeZone === 'US-Europe') return lower.includes('north america') && lower.includes('europe');
        if (routeZone === 'US-Asia') return lower.includes('north america') && lower.includes('asia');
        return false;
      });

      if (matchOption) {
        await regionSelect.selectOption({ label: matchOption });
        await stealth.stealthDelay();
      }
    }

    if (await cabinSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      const cabinOptions = await cabinSelect.locator('option').allTextContents();
      console.log('[ANA] Calendar cabin options:', cabinOptions.join(', '));

      const cabinMatch = cabinOptions.find(opt => {
        const lower = opt.toLowerCase();
        if (params.cabin === 'first') return lower.includes('first');
        if (params.cabin === 'business') return lower.includes('business');
        return lower.includes('economy') && !lower.includes('premium');
      });

      if (cabinMatch) {
        await cabinSelect.selectOption({ label: cabinMatch });
        await stealth.stealthDelay();
      }
    }

    // Submit/refresh calendar if needed
    const submitBtn = page.locator('input[type="submit"], button:has-text("Display"), button:has-text("Search")').first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await stealth.stealthDelay();
    }

    // Parse the calendar grid
    // Look for the target date's availability indicator
    const targetDate = new Date(params.date);
    const targetDay = targetDate.getDate();
    const targetMonth = targetDate.getMonth() + 1;
    const targetYear = targetDate.getFullYear();

    // Get all calendar cells — look for availability symbols
    const calendarHtml = await page.evaluate(() => document.body?.innerHTML || '');

    // Parse availability symbols from calendar
    // ◎ = wide open, ○ = available, △ = limited, × = unavailable
    const availSymbols = ['◎', '○', '△'];
    const datePattern = new RegExp(
      `(?:${targetYear}[/-])?0?${targetMonth}[/-]0?${targetDay}[^]*?(◎|○|△|×|—)`,
      'i'
    );
    const dateMatch = calendarHtml.match(datePattern);

    if (dateMatch) {
      const symbol = dateMatch[1];
      const isAvailable = availSymbols.includes(symbol);

      if (isAvailable) {
        const availability = symbol === '◎' ? 'wide-open' : symbol === '○' ? 'available' : 'limited';
        console.log(`[ANA] Calendar shows ${availability} for ${params.date}`);

        results.push({
          source: 'ana-calendar',
          airline: 'ANA',
          flightNumber: 'NH---',
          origin: params.origin,
          destination: params.destination,
          departureDate: params.date,
          departureTime: '',
          arrivalTime: '',
          duration: '',
          stops: 0,
          cabin: params.cabin,
          pointsRequired: getChartMiles(params),
          pointsProgram: 'ANA Mileage Club',
          awardType: availability === 'wide-open' ? 'saver' : availability === 'available' ? 'saver' : 'everyday',
          scrapedAt: new Date().toISOString(),
          bookingUrl: ANA_SEARCH_URL,
        });
      } else {
        console.log(`[ANA] Calendar shows unavailable (${symbol}) for ${params.date}`);
      }
    }

    // Also try to parse from intercepted API data
    for (const { data } of interceptedData) {
      const apiResults = parseCalendarApiData(data, params);
      results.push(...apiResults);
    }

    // Try scraping calendar table cells directly
    if (results.length === 0) {
      const cellResults = await scrapeCalendarCells(page, params);
      results.push(...cellResults);
    }

    return results;
  } catch (error) {
    console.error('[ANA] Calendar scrape error:', error instanceof Error ? error.message : error);
    return results;
  }
}

/**
 * Scrape calendar by looking at table cells for specific dates.
 */
async function scrapeCalendarCells(page: Page, params: SearchParams): Promise<FlightResult[]> {
  const results: FlightResult[] = [];

  try {
    const targetDate = new Date(params.date);
    const targetDay = targetDate.getDate();

    // Get all td elements that might contain day numbers and availability
    const cells = await page.$$('td');
    for (const cell of cells) {
      const text = await cell.textContent() || '';
      const trimmed = text.trim();

      // Check if this cell contains our target day number
      if (trimmed.includes(String(targetDay))) {
        // Look for availability symbols in the cell or adjacent cells
        const html = await cell.innerHTML();
        const hasAvail = /◎|○|△/.test(html);
        const className = await cell.getAttribute('class') || '';

        // ANA calendar often uses CSS classes for availability status
        const isAvailable = hasAvail ||
          className.includes('avail') ||
          className.includes('open') ||
          className.includes('ok');

        if (isAvailable) {
          results.push({
            source: 'ana-calendar',
            airline: 'ANA',
            flightNumber: 'NH---',
            origin: params.origin,
            destination: params.destination,
            departureDate: params.date,
            departureTime: '',
            arrivalTime: '',
            duration: '',
            stops: 0,
            cabin: params.cabin,
            pointsRequired: getChartMiles(params),
            pointsProgram: 'ANA Mileage Club',
            awardType: 'saver',
            scrapedAt: new Date().toISOString(),
            bookingUrl: ANA_SEARCH_URL,
          });
          break;
        }
      }
    }
  } catch (error) {
    console.error('[ANA] Calendar cell scrape error:', error instanceof Error ? error.message : error);
  }

  return results;
}

function parseCalendarApiData(data: any, params: SearchParams): FlightResult[] {
  const results: FlightResult[] = [];
  if (!data || typeof data !== 'object') return results;

  // Try to find availability data in various shapes
  const dateStr = params.date;
  const entries = data.calendar || data.availability || data.dates || data.result || [];

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const entryDate = entry.date || entry.departureDate || entry.dep_date || '';
      if (entryDate.includes(dateStr) || dateStr.includes(entryDate)) {
        const status = entry.status || entry.availability || entry.avail || '';
        if (['available', 'open', 'wide_open', 'limited', 'O', 'A'].includes(status)) {
          results.push({
            source: 'ana-calendar-api',
            airline: 'ANA',
            flightNumber: entry.flightNumber || 'NH---',
            origin: params.origin,
            destination: params.destination,
            departureDate: params.date,
            departureTime: entry.departureTime || '',
            arrivalTime: entry.arrivalTime || '',
            duration: entry.duration || '',
            stops: entry.stops || 0,
            cabin: params.cabin,
            pointsRequired: entry.miles || entry.mileage || getChartMiles(params),
            pointsProgram: 'ANA Mileage Club',
            awardType: 'saver',
            scrapedAt: new Date().toISOString(),
            bookingUrl: ANA_SEARCH_URL,
          });
        }
      }
    }
  }

  return results;
}

// ============================================================
// FULL AWARD SEARCH (Playwright)
// ============================================================

async function performFullAwardSearch(
  page: Page,
  params: SearchParams,
  interceptedData: any[],
): Promise<FlightResult[]> {
  const results: FlightResult[] = [];

  try {
    console.log('[ANA] Performing full award search...');

    // Navigate to ANA's international award booking page
    await page.goto(ANA_AWARD_BOOKING, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await stealth.stealthDelay();

    // If redirected to a different search page, try the alternate
    if (!page.url().includes('award')) {
      await page.goto(ANA_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await stealth.stealthDelay();
    }

    // Look for the award search form
    // ANA's form typically has: Trip type, Origin, Destination, Date, Cabin, Passengers

    // Try to select one-way if available (ANA historically only did round-trip but added one-way in 2024+)
    const oneWayRadio = page.locator('input[value*="one"], label:has-text("One-way"), input[name*="trip"][value="1"]').first();
    if (await oneWayRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
      await oneWayRadio.click();
      await stealth.stealthDelay();
    }

    // Fill origin
    const originInput = page.locator(
      'input[name*="depAirport"], input[name*="origin"], input[id*="depApo"], ' +
      'input[placeholder*="From"], input[placeholder*="Departure"]'
    ).first();

    if (await originInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await originInput.click();
      await originInput.fill('');
      await stealth.stealthDelay();
      await originInput.type(params.origin, { delay: 80 });
      await stealth.stealthDelay();

      // Wait for autocomplete and select
      const suggestion = page.locator(`text=${params.origin}`).first();
      if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await suggestion.click();
        await stealth.stealthDelay();
      }
    }

    // Fill destination
    const destInput = page.locator(
      'input[name*="arrAirport"], input[name*="dest"], input[id*="arrApo"], ' +
      'input[placeholder*="To"], input[placeholder*="Arrival"]'
    ).first();

    if (await destInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await destInput.click();
      await destInput.fill('');
      await stealth.stealthDelay();
      await destInput.type(params.destination, { delay: 80 });
      await stealth.stealthDelay();

      const suggestion = page.locator(`text=${params.destination}`).first();
      if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await suggestion.click();
        await stealth.stealthDelay();
      }
    }

    // Fill date
    const dateInput = page.locator(
      'input[name*="depDate"], input[name*="date"], input[id*="depDate"], ' +
      'input[placeholder*="Date"], input[type="date"]'
    ).first();

    if (await dateInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dateInput.click();
      await stealth.stealthDelay();

      // ANA uses various date formats — try clearing and typing
      await dateInput.fill('');
      // Try different formats: YYYY/MM/DD, MM/DD/YYYY, YYYY-MM-DD
      const [y, m, d] = params.date.split('-');
      const dateFormats = [
        `${y}/${m}/${d}`,
        `${m}/${d}/${y}`,
        params.date,
      ];

      for (const fmt of dateFormats) {
        await dateInput.fill(fmt);
        const val = await dateInput.inputValue();
        if (val) break;
      }
      await stealth.stealthDelay();
    }

    // Select cabin class
    const cabinSelect = page.locator(
      'select[name*="class"], select[name*="cabin"], select[id*="class"]'
    ).first();

    if (await cabinSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      const cabinVal = ANA_CABIN_MAP[params.cabin];
      try {
        await cabinSelect.selectOption({ value: cabinVal });
      } catch {
        // Try by label
        const labelMap: Record<CabinCode, string> = {
          economy: 'Economy',
          business: 'Business',
          first: 'First',
        };
        await cabinSelect.selectOption({ label: labelMap[params.cabin] }).catch(() => {});
      }
      await stealth.stealthDelay();
    }

    // Submit search — use specific selector to avoid hitting the header's site-wide search toggle
    // Both the award search submit and the header search toggle share class `asw-search__submit`,
    // so we must scope to the award form or use a more specific selector.
    // First, hide the intercepting header search button to prevent click interception.
    await page.evaluate(() => {
      const headerBtn = document.querySelector('input.asw-header-search-box__toggle-btn');
      if (headerBtn) (headerBtn as HTMLElement).style.display = 'none';
    });

    const searchBtn = page.locator(
      'form input[type="submit"][value="Search"], ' +
      'form button[type="submit"]:has-text("Search"), ' +
      'form input[type="submit"]'
    ).first();

    if (await searchBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchBtn.click({ force: true });
    } else {
      // Try pressing Enter on the last filled field
      await page.keyboard.press('Enter');
    }

    // Wait for results to load
    console.log('[ANA] Waiting for search results...');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await stealth.stealthDelay();

    // First try: parse intercepted API responses
    for (const { url, data } of interceptedData) {
      const apiResults = parseSearchApiData(data, params);
      if (apiResults.length > 0) {
        console.log(`[ANA] Found ${apiResults.length} results from API: ${url}`);
        results.push(...apiResults);
      }
    }

    // Second try: scrape the DOM
    if (results.length === 0) {
      const domResults = await scrapeDOMResults(page, params);
      results.push(...domResults);
    }

    return results;
  } catch (error) {
    console.error('[ANA] Full search error:', error instanceof Error ? error.message : error);
    return results;
  }
}

function parseSearchApiData(data: any, params: SearchParams): FlightResult[] {
  const results: FlightResult[] = [];
  if (!data || typeof data !== 'object') return results;

  // Try various data shapes ANA might return
  const flights = data.flights || data.flightList || data.result?.flights || data.data?.flights || [];

  if (Array.isArray(flights)) {
    for (const f of flights) {
      const flightNum = f.flightNumber || f.flight_number || f.fltNo || '';
      const carrier = flightNum.substring(0, 2) || 'NH';
      const miles = f.miles || f.mileage || f.requiredMiles || f.award?.miles || 0;

      if (miles > 0 || f.available || f.seatAvailable) {
        results.push({
          source: 'ana',
          airline: carrier === 'NH' ? 'ANA' : carrier,
          flightNumber: flightNum || 'NH---',
          origin: f.origin || f.depAirport || params.origin,
          destination: f.destination || f.arrAirport || params.destination,
          departureDate: params.date,
          departureTime: f.departureTime || f.depTime || '',
          arrivalTime: f.arrivalTime || f.arrTime || '',
          duration: f.duration || f.flyingTime || '',
          stops: f.stops ?? f.via ?? 0,
          cabin: params.cabin,
          pointsRequired: miles || getChartMiles(params),
          pointsProgram: 'ANA Mileage Club',
          awardType: 'saver',
          scrapedAt: new Date().toISOString(),
          bookingUrl: ANA_AWARD_BOOKING,
        });
      }
    }
  }

  return results;
}

async function scrapeDOMResults(page: Page, params: SearchParams): Promise<FlightResult[]> {
  const results: FlightResult[] = [];

  try {
    const bodyText = await page.evaluate(() => document.body?.innerText || '');

    // Check for no-availability messages
    if (
      bodyText.includes('no seats available') ||
      bodyText.includes('No flights') ||
      bodyText.includes('no available') ||
      bodyText.includes('空席なし')
    ) {
      console.log('[ANA] No availability found on this date');
      return results;
    }

    // Try to find flight result elements using common patterns
    const selectors = [
      'tr[class*="flight"]',
      'div[class*="flight-result"]',
      'div[class*="result-item"]',
      'li[class*="flight"]',
      'div[class*="flightCard"]',
      '.award-result',
      'table.result tbody tr',
    ];

    let cards: any[] = [];
    for (const sel of selectors) {
      cards = await page.$$(sel);
      if (cards.length > 0) {
        console.log(`[ANA] Found ${cards.length} flight cards with selector: ${sel}`);
        break;
      }
    }

    for (const card of cards) {
      try {
        const text = await card.textContent() || '';

        // Extract flight number (NH, UA, LH, SQ, etc.)
        const flightMatch = text.match(/\b(NH|UA|LH|SQ|TK|OS|LX|SK|TP|BR|OZ|TG|SA|ET|CA|AI)\s*(\d{1,4})\b/);
        const flightNumber = flightMatch ? `${flightMatch[1]}${flightMatch[2]}` : '';

        // Extract times
        const timeMatch = text.match(/(\d{1,2}:\d{2})\s*(?:—|–|-|→|~)\s*(\d{1,2}:\d{2})/);

        // Extract miles
        const milesMatch = text.match(/([\d,]+)\s*(?:miles|マイル|Mile)/i);

        // Extract duration
        const durationMatch = text.match(/(\d{1,2})\s*[hH時]\s*(\d{1,2})?\s*[mM分]?/);

        if (flightNumber || timeMatch) {
          results.push({
            source: 'ana',
            airline: flightMatch?.[1] === 'NH' ? 'ANA' : (flightMatch?.[1] || 'ANA'),
            flightNumber: flightNumber || 'NH---',
            origin: params.origin,
            destination: params.destination,
            departureDate: params.date,
            departureTime: timeMatch?.[1] || '',
            arrivalTime: timeMatch?.[2] || '',
            duration: durationMatch ? `${durationMatch[1]}h${durationMatch[2] || '00'}m` : '',
            stops: text.includes('nonstop') || text.includes('直行') ? 0 : text.includes('1 stop') ? 1 : 0,
            cabin: params.cabin,
            pointsRequired: milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : getChartMiles(params),
            pointsProgram: 'ANA Mileage Club',
            awardType: 'saver',
            scrapedAt: new Date().toISOString(),
            bookingUrl: ANA_AWARD_BOOKING,
          });
        }
      } catch { /* skip individual card errors */ }
    }

    // If still no results but page has content, try a broader text parse
    if (results.length === 0 && bodyText.length > 500) {
      console.log('[ANA] Attempting broad text parse...');

      // Look for NH flight numbers anywhere in the page
      const nhMatches = Array.from(bodyText.matchAll(/NH\s*(\d{1,4})/g));
      const seen = new Set<string>();

      for (const match of nhMatches) {
        const fn = `NH${match[1]}`;
        if (seen.has(fn)) continue;
        seen.add(fn);

        results.push({
          source: 'ana',
          airline: 'ANA',
          flightNumber: fn,
          origin: params.origin,
          destination: params.destination,
          departureDate: params.date,
          departureTime: '',
          arrivalTime: '',
          duration: '',
          stops: 0,
          cabin: params.cabin,
          pointsRequired: getChartMiles(params),
          pointsProgram: 'ANA Mileage Club',
          awardType: 'saver',
          scrapedAt: new Date().toISOString(),
          bookingUrl: ANA_AWARD_BOOKING,
        });
      }
    }
  } catch (error) {
    console.error('[ANA] DOM scrape error:', error instanceof Error ? error.message : error);
  }

  return results;
}

// ============================================================
// AWARD CHART ESTIMATES (fallback)
// ============================================================

function getRouteZone(origin: string, destination: string): keyof typeof ANA_AWARD_CHART {
  const o = origin.toUpperCase();
  const d = destination.toUpperCase();

  const oJapan = JAPAN_AIRPORTS.has(o);
  const dJapan = JAPAN_AIRPORTS.has(d);
  const oUS = US_AIRPORTS_MAJOR.has(o) || o.length === 3; // approximate
  const dUS = US_AIRPORTS_MAJOR.has(d) || d.length === 3;
  const oEU = EUROPE_AIRPORTS.has(o);
  const dEU = EUROPE_AIRPORTS.has(d);

  if ((oJapan && !dJapan) || (dJapan && !oJapan)) {
    if (oEU || dEU) return 'Japan-Europe';
    return 'US-Japan';
  }
  if (oEU || dEU) return 'US-Europe';
  return 'US-Asia';
}

function getSeason(dateStr: string): 'low' | 'regular' | 'high' {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  if (LOW_SEASON_MONTHS.includes(month)) return 'low';
  if (HIGH_SEASON_MONTHS.includes(month)) return 'high';
  return 'regular';
}

function getChartMiles(params: SearchParams): number {
  const zone = getRouteZone(params.origin, params.destination);
  const season = getSeason(params.date);
  const chart = ANA_AWARD_CHART[zone];
  const cabinChart = chart[params.cabin as keyof typeof chart];
  if (!cabinChart) return 0;
  return (cabinChart as any)[season] || 0;
}

/**
 * Returns estimated award pricing from ANA's published award chart.
 * Does NOT reflect actual seat availability — just tells you what it would cost.
 */
function getEstimatedAvailability(params: SearchParams): FlightResult[] {
  const zone = getRouteZone(params.origin, params.destination);
  const season = getSeason(params.date);
  const chart = ANA_AWARD_CHART[zone];
  const cabinChart = chart[params.cabin as keyof typeof chart];

  if (!cabinChart) {
    return [{
      source: 'ana-estimated',
      airline: 'ANA',
      flightNumber: 'NH---',
      origin: params.origin,
      destination: params.destination,
      departureDate: params.date,
      departureTime: '',
      arrivalTime: '',
      duration: '',
      stops: 0,
      cabin: params.cabin,
      pointsRequired: 0,
      pointsProgram: 'ANA Mileage Club',
      awardType: 'saver',
      scrapedAt: new Date().toISOString(),
      bookingUrl: ANA_SEARCH_URL,
    }];
  }

  const typedChart = cabinChart as Record<string, number>;

  // Return the seasonal estimate
  return [{
    source: 'ana-estimated',
    airline: 'ANA',
    flightNumber: 'NH---',
    origin: params.origin,
    destination: params.destination,
    departureDate: params.date,
    departureTime: '',
    arrivalTime: '',
    duration: '',
    stops: 0,
    cabin: params.cabin,
    pointsRequired: typedChart[season],
    pointsProgram: 'ANA Mileage Club',
    awardType: season === 'low' ? 'saver' : season === 'high' ? 'everyday' : 'saver',
    scrapedAt: new Date().toISOString(),
    bookingUrl: ANA_SEARCH_URL,
  },
  // Also show all season prices for reference
  ...(['low', 'regular', 'high'] as const)
    .filter(s => s !== season)
    .map(s => ({
      source: 'ana-chart' as string,
      airline: 'ANA',
      flightNumber: 'NH---',
      origin: params.origin,
      destination: params.destination,
      departureDate: params.date,
      departureTime: '',
      arrivalTime: '',
      duration: '',
      stops: 0,
      cabin: params.cabin,
      pointsRequired: typedChart[s],
      pointsProgram: 'ANA Mileage Club',
      awardType: `${s}-season` as any,
      scrapedAt: new Date().toISOString(),
      bookingUrl: ANA_SEARCH_URL,
    })),
  ];
}

// ============================================================
// EXPORTS
// ============================================================

export default { searchANA, ANA_AWARD_CHART };
