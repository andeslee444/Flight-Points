/**
 * Singapore Airlines KrisFlyer Award Search Scraper
 *
 * SQ award search REQUIRES KrisFlyer login — no guest access.
 * Free account: https://www.singaporeair.com/en_UK/ppsclub-krisflyer/registration-form/
 *
 * STRATEGY (ranked):
 * 1. Playwright login + network interception — login, search, capture API responses
 * 2. Partner backdoor — ANA scraper shows SQ metal on Star Alliance awards
 * 3. Award chart estimates — static pricing as last resort
 *
 * KEY FINDINGS (2026-02-16):
 * - singaporeair.com/en_UK/us/home#/book/redeemflights requires login
 * - The "Redeem flights" radio button triggers login modal immediately
 * - developer.singaporeair.com has flight booking API but requires partner API key
 * - apigw.singaporeair.com/api/v1/commercial/flightavailability/get is for cash flights only
 * - seats.aero and roame.travel have cracked SQ scraping (as of Feb 2025)
 * - SQ website described as "too complicated" for scraping by seats.aero initially
 *
 * SWEET SPOTS (KrisFlyer miles, one-way Saver):
 * - SQ Suites (First) SIN→US: 92K-119K
 * - SQ Business SIN→US: 62K-85K
 * - SQ Economy SIN→US: 28K-38K
 * - SQ Business SIN→Japan: 48K-62K
 *
 * REQUIREMENTS:
 * - SQ_KRISFLYER_ID + SQ_KRISFLYER_PASSWORD env vars
 * - Free KrisFlyer signup
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
// CONSTANTS
// ============================================================

const SQ_HOME = 'https://www.singaporeair.com/en_UK/us/home';
const SQ_LOGIN_URL = 'https://www.singaporeair.com/en_UK/us/home#/book/bookflight';
const SQ_REDEEM_URL = 'https://www.singaporeair.com/en_UK/us/home#/book/redeemflights';

const CABIN_MAP: Record<CabinCode, string> = {
  economy: 'Economy',
  business: 'Business',
  first: 'First / Suites',
};

// SQ cabin class codes for the search form
const SQ_CABIN_CODES: Record<CabinCode, string> = {
  economy: 'Y',
  business: 'C',
  first: 'F',
};

const PAGE_TIMEOUT = 45000;
const SEARCH_TIMEOUT = 30000;

// ============================================================
// KrisFlyer Award Chart (one-way Saver, as of Nov 2025)
// https://www.singaporeair.com/content/dam/sia/web-assets/pdfs/ppsclub-krisflyer/krisflyer/progupdates/awardcharts/
// ============================================================

export const SQ_AWARD_CHART: Record<string, Record<string, { saver: number; advantage: number }>> = {
  // Zone 1 (within Southeast Asia)
  'SEA-SEA': {
    economy: { saver: 12000, advantage: 15000 },
    business: { saver: 25000, advantage: 31500 },
    first: { saver: 36000, advantage: 45000 },
  },
  // SIN → Japan/Korea
  'SIN-NorthAsia': {
    economy: { saver: 22000, advantage: 27500 },
    business: { saver: 48000, advantage: 62000 },
    first: { saver: 66000, advantage: 82500 },
  },
  // SIN → US (West Coast)
  'SIN-USWest': {
    economy: { saver: 28000, advantage: 38000 },
    business: { saver: 62000, advantage: 85000 },
    first: { saver: 92000, advantage: 119000 },
  },
  // SIN → US (East Coast)
  'SIN-USEast': {
    economy: { saver: 33000, advantage: 42000 },
    business: { saver: 73000, advantage: 92000 },
    first: { saver: 107000, advantage: 128500 },
  },
  // SIN → Europe
  'SIN-Europe': {
    economy: { saver: 30000, advantage: 37500 },
    business: { saver: 62000, advantage: 85000 },
    first: { saver: 92000, advantage: 119000 },
  },
  // SIN → Australia
  'SIN-Australia': {
    economy: { saver: 18000, advantage: 23000 },
    business: { saver: 42000, advantage: 53000 },
    first: { saver: 58000, advantage: 72500 },
  },
  // US → Japan (via SIN or direct — SQ doesn't fly JFK-NRT direct)
  'US-Japan': {
    economy: { saver: 35000, advantage: 45000 },
    business: { saver: 80000, advantage: 100000 },
    first: { saver: 107000, advantage: 128500 },
  },
};

// Airport zone mapping
const US_WEST = new Set(['LAX', 'SFO', 'SEA', 'SJC']);
const US_EAST = new Set(['JFK', 'EWR', 'IAD', 'IAH', 'ORD']);
const JAPAN_KOREA = new Set(['NRT', 'HND', 'KIX', 'ICN', 'GMP']);
const AUSTRALIA = new Set(['SYD', 'MEL', 'BNE', 'PER', 'ADL', 'AKL']);
const EUROPE = new Set(['LHR', 'CDG', 'FRA', 'MUC', 'FCO', 'BCN', 'AMS', 'ZRH', 'CPH', 'BRU', 'IST']);
const SEA = new Set(['SIN', 'BKK', 'KUL', 'CGK', 'MNL', 'SGN', 'HAN']);

function getZone(airport: string): string {
  if (SEA.has(airport)) return 'SEA';
  if (US_WEST.has(airport)) return 'USWest';
  if (US_EAST.has(airport)) return 'USEast';
  if (JAPAN_KOREA.has(airport)) return 'NorthAsia';
  if (AUSTRALIA.has(airport)) return 'Australia';
  if (EUROPE.has(airport)) return 'Europe';
  return 'Unknown';
}

function getChartKey(origin: string, destination: string): string | null {
  const oz = getZone(origin);
  const dz = getZone(destination);
  
  // Try direct key
  const key1 = `${oz}-${dz}`;
  const key2 = `${dz}-${oz}`;
  const key3 = `SIN-${dz}`;
  const key4 = `SIN-${oz}`;
  
  if (SQ_AWARD_CHART[key1]) return key1;
  if (SQ_AWARD_CHART[key2]) return key2;
  if (SQ_AWARD_CHART[key3]) return key3;
  if (SQ_AWARD_CHART[key4]) return key4;
  
  // Special case: US-Japan routing
  if ((oz.startsWith('US') && dz === 'NorthAsia') || (dz.startsWith('US') && oz === 'NorthAsia')) {
    return 'US-Japan';
  }
  
  return null;
}

// ============================================================
// AWARD CHART ESTIMATOR (no login needed)
// ============================================================

export function estimateAwardCost(
  origin: string,
  destination: string,
  cabin: CabinCode,
): { saver: number; advantage: number } | null {
  const key = getChartKey(origin, destination);
  if (!key) return null;
  const zone = SQ_AWARD_CHART[key];
  if (!zone) return null;
  return zone[cabin] || null;
}

// ============================================================
// PLAYWRIGHT-BASED SCRAPER (login required)
// ============================================================

interface SQApiResponse {
  url: string;
  status: number;
  body: any;
}

async function loginToKrisFlyer(page: Page): Promise<boolean> {
  const kfId = process.env.SQ_KRISFLYER_ID;
  const kfPass = process.env.SQ_KRISFLYER_PASSWORD;

  if (!kfId || !kfPass) {
    console.warn('[SQ] Missing SQ_KRISFLYER_ID or SQ_KRISFLYER_PASSWORD env vars');
    return false;
  }

  // Navigate to SQ homepage
  await page.goto(SQ_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
  await page.waitForTimeout(2000);

  // Click "Redeem flights" which triggers login modal
  const redeemRadio = page.locator('input[type="radio"]').filter({ hasText: /redeem/i });
  const redeemLabel = page.locator('text=Redeem flights');
  
  try {
    await redeemLabel.click({ timeout: 5000 });
  } catch {
    // Try clicking the radio directly
    try {
      await redeemRadio.click({ timeout: 5000 });
    } catch {
      console.warn('[SQ] Could not find Redeem flights button');
      return false;
    }
  }

  await page.waitForTimeout(2000);

  // Fill login form
  try {
    const emailField = page.locator('input[placeholder*="KrisFlyer"], input[placeholder*="Email"], input[name*="membership"], input[type="text"]').first();
    await emailField.fill(kfId, { timeout: 5000 });

    const passwordField = page.locator('input[type="password"]').first();
    await passwordField.fill(kfPass, { timeout: 5000 });

    // Click login button
    const loginBtn = page.locator('button:has-text("LOG IN"), button:has-text("Log in")').first();
    await loginBtn.click({ timeout: 5000 });

    // Wait for login to complete
    await page.waitForTimeout(5000);

    // Check if login succeeded by looking for the search form
    const bodyText = await page.textContent('body') || '';
    if (bodyText.includes('Log in') && !bodyText.includes('Hi,')) {
      console.warn('[SQ] Login may have failed');
      return false;
    }

    console.log('[SQ] Login successful');
    return true;
  } catch (err: any) {
    console.warn('[SQ] Login error:', err.message);
    return false;
  }
}

async function performAwardSearch(
  page: Page,
  params: SearchParams,
  apiResponses: SQApiResponse[],
): Promise<FlightResult[]> {
  // After login, we should be on the booking page with "Redeem flights" selected
  // Fill search form
  
  // Clear and fill origin
  const fromField = page.locator('input[placeholder*="From"], input[aria-label*="From"]').first();
  await fromField.click();
  await fromField.fill('');
  await fromField.type(params.origin, { delay: 100 });
  await page.waitForTimeout(1000);
  // Select from autocomplete dropdown
  await page.locator(`text=${params.origin}`).first().click().catch(() => {
    page.keyboard.press('Enter');
  });
  await page.waitForTimeout(500);

  // Fill destination
  const toField = page.locator('input[placeholder*="To"], input[aria-label*="To"]').first();
  await toField.click();
  await toField.fill('');
  await toField.type(params.destination, { delay: 100 });
  await page.waitForTimeout(1000);
  await page.locator(`text=${params.destination}`).first().click().catch(() => {
    page.keyboard.press('Enter');
  });
  await page.waitForTimeout(500);

  // Fill date
  const dateField = page.locator('input[placeholder*="Depart"], input[aria-label*="Depart"]').first();
  await dateField.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  
  // Navigate calendar to correct month and click date
  // Date format: YYYY-MM-DD
  const [year, month, day] = params.date.split('-').map(Number);
  // This is simplified — the actual calendar navigation would need to be more robust
  await page.waitForTimeout(1000);

  // Select cabin class
  const cabinField = page.locator('input[aria-label*="Class"], select[name*="cabin"]').first();
  await cabinField.click().catch(() => {});
  await page.waitForTimeout(500);

  // Click search
  const searchBtn = page.locator('button:has-text("Search"), button[type="submit"]').first();
  await searchBtn.click({ timeout: 5000 });

  // Wait for results
  await page.waitForTimeout(10000);

  // Parse intercepted API responses for flight data
  return parseApiResponses(apiResponses, params);
}

function parseApiResponses(responses: SQApiResponse[], params: SearchParams): FlightResult[] {
  const flights: FlightResult[] = [];

  for (const resp of responses) {
    try {
      const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
      
      // Look for flight availability data in various response shapes
      // SQ's API response structure is unknown — we'll log and adapt
      const flightArrays = findFlightArrays(data);
      
      for (const flight of flightArrays) {
        const result = mapToFlightResult(flight, params);
        if (result) flights.push(result);
      }
    } catch {
      // Skip unparseable responses
    }
  }

  return flights;
}

function findFlightArrays(data: any, depth = 0): any[] {
  if (depth > 5) return [];
  if (Array.isArray(data)) {
    // Check if this looks like a flight array
    if (data.length > 0 && data[0] && (
      data[0].flightNumber || data[0].flight || data[0].segments ||
      data[0].departureDate || data[0].miles || data[0].mileage
    )) {
      return data;
    }
  }
  if (data && typeof data === 'object') {
    for (const key of Object.keys(data)) {
      const result = findFlightArrays(data[key], depth + 1);
      if (result.length > 0) return result;
    }
  }
  return [];
}

function mapToFlightResult(raw: any, params: SearchParams): FlightResult | null {
  try {
    return {
      source: 'singapore',
      airline: raw.airline || raw.carrier || 'SQ',
      flightNumber: raw.flightNumber || raw.flight || `SQ${raw.flightNo || ''}`,
      origin: raw.origin || raw.departure?.airport || params.origin,
      destination: raw.destination || raw.arrival?.airport || params.destination,
      departureDate: params.date,
      departureTime: raw.departureTime || raw.departure?.time || '',
      arrivalTime: raw.arrivalTime || raw.arrival?.time || '',
      duration: raw.duration || '',
      stops: raw.stops ?? raw.numberOfStops ?? 0,
      cabin: params.cabin,
      pointsRequired: raw.miles || raw.mileage || raw.points || raw.milesRequired,
      pointsProgram: 'KrisFlyer',
      taxesAndFees: raw.taxes || raw.tax || raw.surcharge,
      awardType: raw.awardType || (raw.isSaver ? 'saver' : 'everyday'),
      scrapedAt: new Date().toISOString(),
      bookingUrl: `https://www.singaporeair.com/en_UK/us/home#/book/redeemflights`,
    };
  } catch {
    return null;
  }
}

// ============================================================
// MAIN SEARCH FUNCTION
// ============================================================

export async function searchSingaporeAirlines(params: SearchParams): Promise<{
  flights: FlightResult[];
  source: string;
  method: 'playwright' | 'estimate' | 'partner';
  error?: string;
}> {
  // Check cache
  const cacheKey = `sq:${params.origin}-${params.destination}:${params.date}:${params.cabin}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return { flights: cached as FlightResult[], source: 'singapore-cached', method: 'playwright' };
  }

  // Try Playwright approach if credentials available
  if (process.env.SQ_KRISFLYER_ID && process.env.SQ_KRISFLYER_PASSWORD) {
    try {
      const result = await searchWithPlaywright(params);
      if (result.flights.length > 0) {
        setCache(cacheKey, result.flights);
        return result;
      }
    } catch (err: any) {
      console.warn('[SQ] Playwright search failed:', err.message);
    }
  }

  // Fallback: award chart estimate
  const estimate = estimateAwardCost(params.origin, params.destination, params.cabin);
  if (estimate) {
    const estimatedFlight: FlightResult = {
      source: 'singapore-estimate',
      airline: 'SQ',
      flightNumber: 'SQ???',
      origin: params.origin,
      destination: params.destination,
      departureDate: params.date,
      departureTime: '',
      arrivalTime: '',
      duration: '',
      stops: params.origin === 'SIN' || params.destination === 'SIN' ? 0 : 1,
      cabin: params.cabin,
      pointsRequired: estimate.saver,
      pointsProgram: 'KrisFlyer',
      awardType: 'saver',
      scrapedAt: new Date().toISOString(),
      bookingUrl: SQ_REDEEM_URL,
    };

    return {
      flights: [
        estimatedFlight,
        { ...estimatedFlight, source: 'singapore-estimate', pointsRequired: estimate.advantage, awardType: 'everyday' as any },
      ],
      source: 'singapore-estimate',
      method: 'estimate',
    };
  }

  return { flights: [], source: 'singapore', method: 'estimate', error: 'No route mapping found' };
}

async function searchWithPlaywright(params: SearchParams): Promise<{
  flights: FlightResult[];
  source: string;
  method: 'playwright';
}> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const apiResponses: SQApiResponse[] = [];

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
    });

    const page = await context.newPage();

    // Intercept all API responses
    page.on('response', async (resp) => {
      const url = resp.url();
      const ct = resp.headers()['content-type'] || '';
      if (ct.includes('json') && (
        url.includes('api') || url.includes('flight') || url.includes('search') ||
        url.includes('award') || url.includes('redemption') || url.includes('availability') ||
        url.includes('apigw')
      )) {
        try {
          const body = await resp.text();
          if (body.length > 100) {
            console.log(`[SQ API] ${resp.status()} ${url.substring(0, 120)}`);
            apiResponses.push({ url, status: resp.status(), body });
          }
        } catch {}
      }
    });

    // Login
    const loggedIn = await loginToKrisFlyer(page);
    if (!loggedIn) {
      throw new Error('KrisFlyer login failed');
    }

    // Perform search
    const flights = await performAwardSearch(page, params, apiResponses);

    await context.close();

    return { flights, source: 'singapore', method: 'playwright' };
  } finally {
    await browser.close();
  }
}

// ============================================================
// SCRAPER EXPORT (matches AirlineScraper interface)
// ============================================================

export const singaporeScraper = {
  name: 'singapore',
  search: searchSingaporeAirlines,
};

export default singaporeScraper;
