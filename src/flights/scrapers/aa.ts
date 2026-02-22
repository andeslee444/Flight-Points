/**
 * American Airlines AAdvantage Award Search Scraper
 * 
 * Uses playwright-extra with stealth plugin to bypass Akamai detection.
 * 
 * Strategy order:
 *   1. Cookie warm (visit aa.com homepage) → Direct URL with slices JSON param
 *   2. Retry with different UA/URL format  
 *   3. Form-based fallback (fill aa.com search form)
 * 
 * Anti-bot mitigations:
 *   - playwright-extra stealth plugin (patches WebGL, WebRTC, navigator, etc.)
 *   - Cookie warming via homepage visit first
 *   - UA rotation between attempts
 *   - Human-like delays between navigations
 *   - Up to 3 retries with exponential backoff
 *   - Caching to reduce scrape frequency
 * 
 * Created: 2026-02-16
 * Updated: 2026-02-16 — playwright-extra stealth, retry logic, form fallback
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Page, BrowserContext, Browser } from 'playwright';
import { FlightResult, SearchParams, CabinCode, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

// Apply stealth plugin globally
chromium.use(StealthPlugin());

// ============================================================
// CONFIGURATION
// ============================================================

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 7000;
const PAGE_LOAD_TIMEOUT = 45000;
const RESULTS_WAIT_TIMEOUT = 25000;
const HUMAN_DELAY_MIN = 1500;
const HUMAN_DELAY_MAX = 4000;

const CABIN_MAP: Record<CabinCode, string> = {
  economy: 'COACH',
  business: 'BUSINESS',
  first: 'FIRST',
};

// User agents to rotate between attempts (updated Feb 2026)
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
];

// ============================================================
// HELPERS
// ============================================================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function humanDelay(): Promise<void> {
  return new Promise(r => setTimeout(r, randomInt(HUMAN_DELAY_MIN, HUMAN_DELAY_MAX)));
}

function retryDelay(attempt: number): Promise<void> {
  const base = BASE_RETRY_DELAY_MS + attempt * 3000;
  const ms = Math.max(3000, base + randomInt(-2000, 3000));
  log('info', `Retry delay: ${ms}ms`);
  return new Promise(r => setTimeout(r, ms));
}

function log(level: 'info' | 'warn' | 'error', ...args: any[]): void {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[AA ${ts}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

// ============================================================
// URL BUILDERS
// ============================================================

function buildUrlV1(params: SearchParams): string {
  const slices = JSON.stringify([{
    orig: params.origin, origNearby: false,
    dest: params.destination, destNearby: false,
    date: params.date,
  }]);
  const url = new URL('https://www.aa.com/booking/search');
  url.searchParams.set('locale', 'en_US');
  url.searchParams.set('pax', String(params.passengers || 1));
  url.searchParams.set('adult', String(params.passengers || 1));
  url.searchParams.set('type', 'OneWay');
  url.searchParams.set('searchType', 'Award');
  url.searchParams.set('cabin', '');
  url.searchParams.set('carriers', 'ALL');
  url.searchParams.set('slices', slices);
  url.searchParams.set('maxAwardSegmentAllowed', '2');
  return url.toString();
}

function buildUrlV2(params: SearchParams): string {
  const slices = JSON.stringify([{
    orig: params.origin, dest: params.destination,
    origNearby: false, destNearby: false, date: params.date,
  }]);
  const url = new URL('https://www.aa.com/booking/search');
  url.searchParams.set('searchType', 'Award');
  url.searchParams.set('type', 'OneWay');
  url.searchParams.set('locale', 'en_US');
  url.searchParams.set('pax', String(params.passengers || 1));
  url.searchParams.set('adult', String(params.passengers || 1));
  url.searchParams.set('cabin', CABIN_MAP[params.cabin] || '');
  url.searchParams.set('carriers', 'ALL');
  url.searchParams.set('slices', slices);
  return url.toString();
}

function buildUrlV3(params: SearchParams): string {
  const slices = JSON.stringify([{
    orig: params.origin, origNearby: false,
    dest: params.destination, destNearby: false,
    date: params.date,
  }]);
  const url = new URL('https://www.aa.com/booking/find-flights');
  url.searchParams.set('locale', 'en_US');
  url.searchParams.set('pax', String(params.passengers || 1));
  url.searchParams.set('adult', String(params.passengers || 1));
  url.searchParams.set('type', 'OneWay');
  url.searchParams.set('searchType', 'Award');
  url.searchParams.set('cabin', '');
  url.searchParams.set('carriers', 'ALL');
  url.searchParams.set('slices', slices);
  return url.toString();
}

const URL_BUILDERS = [buildUrlV1, buildUrlV2, buildUrlV3];

// ============================================================
// BROWSER SETUP
// ============================================================

async function createBrowserAndPage(attempt: number): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const ua = USER_AGENTS[(attempt + randomInt(0, 1)) % USER_AGENTS.length];
  const vp = VIEWPORTS[attempt % VIEWPORTS.length];
  
  log('info', `Attempt ${attempt + 1}: UA=${ua.slice(0, 50)}... VP=${vp.width}x${vp.height}`);

  // Only use SOCKS5 proxies — HTTP proxies get blocked by Akamai and cause SSL issues
  const rawProxy = process.env.PROXY_URL || '';
  const proxyServer = rawProxy.startsWith('socks') ? rawProxy : '';
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-http2',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--no-first-run',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-sandbox',
      '--js-flags=--max-old-space-size=256',
    ],
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
  });

  const context = await browser.newContext({
    viewport: vp,
    userAgent: ua,
    timezoneId: 'America/New_York',
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  const page = await context.newPage();
  return { browser, context, page };
}

// ============================================================
// COOKIE WARMING
// ============================================================

async function warmCookies(page: Page): Promise<boolean> {
  try {
    log('info', 'Warming cookies via aa.com homepage...');
    
    // Use a race — either page loads or we timeout gracefully
    await Promise.race([
      page.goto('https://www.aa.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }),
      new Promise(r => setTimeout(r, 20000)),
    ]);

    // Let Akamai scripts run and set cookies
    await humanDelay();
    
    // Slight scroll to appear human
    await page.evaluate(() => window.scrollBy(0, randomInt(100, 400))).catch(() => {});
    await humanDelay();

    const cookies = await page.context().cookies();
    const akamaiCookies = cookies.filter(c =>
      c.name.startsWith('ak_') || c.name.startsWith('bm_') || c.name === '_abck'
    );
    log('info', `Cookies: ${cookies.length} total, ${akamaiCookies.length} Akamai`);
    return cookies.length > 0;
  } catch (err: any) {
    log('warn', 'Cookie warming failed:', err.message);
    return false;
  }
}

// ============================================================
// PAGE STATE DETECTION
// ============================================================

async function isBlocked(page: Page): Promise<boolean> {
  try {
    const content = await page.content();
    const text = content.toLowerCase();
    return text.includes('access denied') || text.includes('captcha') ||
           text.includes('challenge-platform') || text.includes('reference #') ||
           text.includes('blocked');
  } catch {
    return false;
  }
}

async function hasNoFlights(page: Page): Promise<boolean> {
  try {
    const content = await page.content();
    const text = content.toLowerCase();
    return text.includes('no flights match') || text.includes('no award flights') ||
           text.includes('no results found');
  } catch {
    return false;
  }
}

// ============================================================
// DIRECT URL STRATEGY
// ============================================================

async function tryDirectUrl(page: Page, params: SearchParams, urlBuilder: (p: SearchParams) => string): Promise<FlightResult[]> {
  const url = urlBuilder(params);
  log('info', `Navigating to: ${url.slice(0, 100)}...`);

  // Navigate with race to prevent hanging
  await Promise.race([
    page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('GOTO_TIMEOUT')), PAGE_LOAD_TIMEOUT)),
  ]);

  // Wait for results
  try {
    await page.waitForSelector('.results-grid-container', { timeout: RESULTS_WAIT_TIMEOUT });
    log('info', 'Results container found');
  } catch {
    if (await isBlocked(page)) {
      log('warn', 'Blocked by Akamai');
      throw new Error('BLOCKED');
    }
    if (await hasNoFlights(page)) {
      log('info', 'No flights for this route/date');
      return [];
    }
    // Try waiting a bit more for slow Angular render
    await page.waitForTimeout(8000);
    const hasResults = await page.$('.results-grid-container');
    if (!hasResults) {
      if (await isBlocked(page)) throw new Error('BLOCKED');
      log('warn', 'No results container after extended wait');
      throw new Error('NO_RESULTS');
    }
  }

  // Wait for Angular rendering
  await page.waitForTimeout(randomInt(2000, 4000));
  return parseResultsFromDOM(page, params);
}

// ============================================================
// FORM-BASED SEARCH (FALLBACK)
// ============================================================

async function tryFormSearch(page: Page, params: SearchParams): Promise<FlightResult[]> {
  log('info', 'Trying form-based search fallback...');

  await Promise.race([
    page.goto('https://www.aa.com/homePage.do', { waitUntil: 'domcontentloaded', timeout: 30000 }),
    new Promise(r => setTimeout(r, 30000)),
  ]);
  await humanDelay();

  // Click "Redeem miles"
  for (const sel of ['label[for="awardBooking"]', '#awardBooking', 'text=Redeem miles', 'input[name="awardBooking"]']) {
    try { await page.click(sel, { timeout: 3000 }); log('info', `Clicked redeem: ${sel}`); break; } catch {}
  }
  await humanDelay();

  // One Way
  for (const sel of ['label[for="oneWay"]', '#oneWay', 'text=One way']) {
    try { await page.click(sel, { timeout: 2000 }); break; } catch {}
  }
  await humanDelay();

  // Origin
  for (const sel of ['#reservationFlightSearchForm\\.originAirport', '#originAirport', 'input[name*="origin"]']) {
    try { await page.fill(sel, params.origin, { timeout: 2000 }); await page.keyboard.press('Tab'); break; } catch {}
  }
  await humanDelay();

  // Destination
  for (const sel of ['#reservationFlightSearchForm\\.destinationAirport', '#destinationAirport', 'input[name*="destination"]']) {
    try { await page.fill(sel, params.destination, { timeout: 2000 }); await page.keyboard.press('Tab'); break; } catch {}
  }
  await humanDelay();

  // Date (MM/DD/YYYY)
  const [y, m, d] = params.date.split('-');
  for (const sel of ['#aa-leavingOn', '#departDate', 'input[name*="departDate"]']) {
    try { await page.fill(sel, `${m}/${d}/${y}`, { timeout: 2000 }); await page.keyboard.press('Tab'); break; } catch {}
  }
  await humanDelay();

  // Submit
  for (const sel of ['input[type="submit"]', 'button:has-text("Search")', 'input.btn-book']) {
    try { await page.click(sel, { timeout: 3000 }); log('info', 'Submitted form'); break; } catch {}
  }

  await page.waitForTimeout(10000);
  
  try {
    await page.waitForSelector('.results-grid-container', { timeout: RESULTS_WAIT_TIMEOUT });
  } catch {
    if (await hasNoFlights(page)) return [];
    if (await isBlocked(page)) throw new Error('BLOCKED');
    throw new Error('FORM_NO_RESULTS');
  }

  await page.waitForTimeout(randomInt(2000, 4000));
  return parseResultsFromDOM(page, params);
}

// ============================================================
// DOM PARSER
// ============================================================

async function parseResultsFromDOM(page: Page, params: SearchParams): Promise<FlightResult[]> {
  return page.evaluate((sp) => {
    const flights: any[] = [];
    const rows = document.querySelectorAll('.results-grid-container > .grid-x.grid-padding-x');

    rows.forEach((row) => {
      const originCode = row.querySelector('.origin .city-code')?.textContent?.trim() || sp.origin;
      const destCode = row.querySelector('.destination .city-code')?.textContent?.trim() || sp.destination;
      const depTime = row.querySelector('.origin .flt-times')?.textContent?.trim() || '';
      const arrTime = (row.querySelector('.destination .flt-times')?.textContent?.trim() || '').replace(/\+\d.*$/, '').trim();
      const duration = row.querySelector('.duration')?.textContent?.trim() || '';
      const stopsText = row.querySelector('.stops')?.textContent?.trim() || '';
      const stopsMatch = stopsText.match(/^(\d+)\s*stop/i);
      const stops = stopsText.toLowerCase().includes('nonstop') ? 0 : stopsMatch ? parseInt(stopsMatch[1]) : 0;
      const stopsInfo = stopsText.replace(/^\d+\s*stops?,?\s*/i, '').trim();

      const flightNums = Array.from(row.querySelectorAll('.flight-number'))
        .map(el => el.textContent?.trim().replace(/\s+/g, '') || '').filter(Boolean);

      const operatingAirlines = Array.from(row.querySelectorAll('.leg-info')).map(leg => {
        const m = (leg.textContent || '').match(/Operated by\s+(.+?)(?:\s*$|\s*\n)/i);
        return m?.[1]?.trim() || '';
      }).filter(Boolean);

      const aircraftNames = Array.from(row.querySelectorAll('.aircraft-name'))
        .map(el => el.textContent?.trim() || '').filter(Boolean);

      const cabinPrices: Array<{ cabin: string; miles: number; taxes: number }> = [];
      row.querySelectorAll('.cell.auto.pad-left-xxs.pad-right-xxs').forEach(btn => {
        const text = btn.textContent?.replace(/\s+/g, ' ').trim() || '';
        const cabinMatch = text.match(/^(Main|Economy|Premium Economy|Business|First)/i);
        const milesMatch = text.match(/([\d,.]+)K/);
        const taxMatch = text.match(/\$\s*([\d,.]+)/);
        if (cabinMatch && milesMatch) {
          cabinPrices.push({
            cabin: cabinMatch[1].toLowerCase(),
            miles: parseFloat(milesMatch[1].replace(/,/g, '')) * 1000,
            taxes: taxMatch ? parseFloat(taxMatch[1].replace(/,/g, '')) : 0,
          });
        }
      });

      const primaryAirline = flightNums[0]?.match(/^([A-Z]{2})/)?.[1] || 'AA';
      const airlineNames: Record<string, string> = {
        'AA': 'American Airlines', 'JL': 'Japan Airlines', 'BA': 'British Airways',
        'CX': 'Cathay Pacific', 'QR': 'Qatar Airways', 'QF': 'Qantas',
        'IB': 'Iberia', 'AY': 'Finnair', 'MH': 'Malaysia Airlines',
        'RJ': 'Royal Jordanian', 'AS': 'Alaska Airlines', 'HA': 'Hawaiian Airlines',
      };

      for (const cp of cabinPrices) {
        let cabin: string;
        if (cp.cabin === 'main' || cp.cabin === 'economy') cabin = 'economy';
        else if (cp.cabin === 'business') cabin = 'business';
        else if (cp.cabin === 'first') cabin = 'first';
        else cabin = 'economy';

        flights.push({
          source: 'aa',
          airline: airlineNames[primaryAirline] || primaryAirline,
          flightNumber: flightNums.join(', '),
          origin: originCode, destination: destCode,
          departureDate: sp.date,
          departureTime: depTime, arrivalTime: arrTime,
          duration, stops, cabin,
          pointsRequired: cp.miles,
          pointsProgram: 'AAdvantage',
          taxesAndFees: cp.taxes,
          awardType: primaryAirline === 'AA' ? 'saver' : 'partner',
          scrapedAt: new Date().toISOString(),
          metadata: { stopsInfo, operatingAirlines, aircraftTypes: aircraftNames, allFlightNumbers: flightNums },
        });
      }
    });
    return flights;
  }, { origin: params.origin, destination: params.destination, date: params.date, cabin: params.cabin });
}

// ============================================================
// MAIN SEARCH
// ============================================================

/**
 * Single-search mode (standalone, launches its own browser each attempt).
 */
export async function searchAA(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('aa', params);
  const cached = getCached(cacheKey);
  if (cached) {
    log('info', `Cache hit: ${cacheKey} (${cached.length} results)`);
    return cached;
  }

  log('info', `Search: ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);
  let lastError = '';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let browser: Browser | null = null;

    try {
      if (attempt > 0) {
        log('info', `--- Retry ${attempt + 1}/${MAX_RETRIES} ---`);
        await retryDelay(attempt);
      }

      const ctx = await createBrowserAndPage(attempt);
      browser = ctx.browser;
      const { page } = ctx;

      // Warm cookies
      await warmCookies(page);

      // Try direct URL
      const urlBuilder = URL_BUILDERS[attempt % URL_BUILDERS.length];
      try {
        const results = await tryDirectUrl(page, params, urlBuilder);
        const url = urlBuilder(params);
        const typed: FlightResult[] = results.map((r: any) => ({ ...r, bookingUrl: url }));
        logResults(typed);
        setCache(cacheKey, typed);
        return typed;
      } catch (err: any) {
        lastError = err.message;
        log('warn', `Direct URL failed: ${err.message}`);

        // On last attempt, try form fallback
        if (attempt === MAX_RETRIES - 1 && (err.message === 'BLOCKED' || err.message === 'NO_RESULTS')) {
          try {
            const formPage = await ctx.context.newPage();
            const results = await tryFormSearch(formPage, params);
            const typed: FlightResult[] = results.map((r: any) => ({ ...r, bookingUrl: 'https://www.aa.com/booking/search' }));
            logResults(typed);
            setCache(cacheKey, typed);
            return typed;
          } catch (fErr: any) {
            log('error', 'Form fallback failed:', fErr.message);
            lastError = `direct=${err.message}, form=${fErr.message}`;
          }
        }
      }
    } catch (err: any) {
      lastError = err.message;
      log('error', `Attempt ${attempt + 1} error:`, err.message);
    } finally {
      if (browser) try { await browser.close(); } catch {}
    }
  }

  log('error', `All ${MAX_RETRIES} attempts failed. Last: ${lastError}`);
  return [];
}

// ============================================================
// BATCH / SESSION MODE — reuse one browser for many searches
// ============================================================

export interface AASession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  searchCount: number;
  blocked: boolean;
}

/**
 * Create a long-lived AA session: one browser, warmed cookies, persistent page.
 * Reuse for up to maxSearches before rotating.
 */
export async function createAASession(): Promise<AASession> {
  const attempt = randomInt(0, USER_AGENTS.length - 1);
  const { browser, context, page } = await createBrowserAndPage(attempt);
  log('info', 'Creating AA session — warming cookies...');
  await warmCookies(page);
  // Browse around a bit to look like a real user
  await new Promise(r => setTimeout(r, randomInt(3000, 5000)));
  // Click around on homepage
  await page.evaluate(() => window.scrollBy(0, Math.random() * 600)).catch(() => {});
  await new Promise(r => setTimeout(r, randomInt(2000, 4000)));
  await page.evaluate(() => window.scrollBy(0, Math.random() * 300)).catch(() => {});
  await new Promise(r => setTimeout(r, randomInt(2000, 5000)));
  return { browser, context, page, searchCount: 0, blocked: false };
}

export async function closeAASession(session: AASession): Promise<void> {
  try { await session.browser.close(); } catch {}
}

/**
 * Search using an existing session (shared browser/context).
 * Returns all cabins found (not filtered).
 * Only 1 retry attempt to avoid burning the session.
 */
export async function searchAAWithSession(session: AASession, params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('aa', params);
  const cached = getCached(cacheKey);
  if (cached) {
    log('info', `Cache hit: ${cacheKey} (${cached.length} results)`);
    return cached;
  }

  if (session.blocked) {
    log('warn', 'Session is marked blocked, skipping search');
    return [];
  }

  log('info', `Session search #${session.searchCount + 1}: ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);

  // Reuse the persistent page instead of creating new tabs
  // Navigate back to homepage between searches to look human
  const page = session.page;

  try {
    // For subsequent searches, navigate via homepage first to mimic browsing
    if (session.searchCount > 0) {
      log('info', 'Navigating back to aa.com between searches...');
      await page.goto('https://www.aa.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, randomInt(2000, 4000)));
      // Random scroll
      await page.evaluate(() => window.scrollBy(0, Math.random() * 500)).catch(() => {});
      await new Promise(r => setTimeout(r, randomInt(1000, 2500)));
    }

    const urlBuilder = URL_BUILDERS[session.searchCount % URL_BUILDERS.length];
    session.searchCount++;

    const results = await tryDirectUrl(page, params, urlBuilder);
    const url = urlBuilder(params);
    const typed: FlightResult[] = results.map((r: any) => ({ ...r, bookingUrl: url }));
    logResults(typed);
    setCache(cacheKey, typed);
    return typed;
  } catch (err: any) {
    log('warn', `Session search failed: ${err.message}`);
    if (err.message === 'BLOCKED') {
      session.blocked = true;
      log('error', 'Session blocked by Akamai — will rotate session');
    }
    return [];
  }
}

/**
 * Batch search: creates session(s), searches all params with delays,
 * rotates session if blocked. Returns map of "origin-dest-date" → results.
 */
export async function searchAABatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
  maxPerSession: number = 15,
): Promise<Map<string, FlightResult[]>> {
  const results = new Map<string, FlightResult[]>();
  let session: AASession | null = null;
  let searchesThisSession = 0;

  for (let i = 0; i < paramsList.length; i++) {
    const params = paramsList[i];
    const key = `${params.origin}-${params.destination}-${params.date}`;

    // Create or rotate session
    if (!session || session.blocked || searchesThisSession >= maxPerSession) {
      if (session) {
        log('info', `Closing session after ${searchesThisSession} searches (blocked=${session.blocked})`);
        await closeAASession(session);
        // Wait longer between sessions to let IP cool
        if (session.blocked) {
          const cooldown = randomInt(90000, 150000);
          log('info', `Cooling off for ${(cooldown/1000).toFixed(0)}s after block...`);
          await new Promise(r => setTimeout(r, cooldown));
        }
      }
      session = await createAASession();
      searchesThisSession = 0;
    }

    const flights = await searchAAWithSession(session, params);
    results.set(key, flights);
    searchesThisSession++;

    // Delay between searches (skip after last)
    if (i < paramsList.length - 1) {
      const delay = delayBetweenMs + randomInt(-5000, 10000);
      log('info', `Waiting ${(delay / 1000).toFixed(0)}s before next search...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  if (session) await closeAASession(session);
  return results;
}

function logResults(results: FlightResult[]): void {
  if (results.length === 0) {
    log('info', 'No flights available');
    return;
  }
  const byCabin = results.reduce((acc, r) => { acc[r.cabin] = (acc[r.cabin] || 0) + 1; return acc; }, {} as Record<string, number>);
  log('info', `Found ${results.length} results: ${JSON.stringify(byCabin)}`);
}

export async function searchAACabin(params: SearchParams): Promise<FlightResult[]> {
  return (await searchAA(params)).filter(r => r.cabin === params.cabin);
}

export default { searchAA, searchAACabin };
