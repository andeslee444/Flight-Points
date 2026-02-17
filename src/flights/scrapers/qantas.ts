/**
 * Qantas Classic Reward Search — Oneworld Partner Backdoor
 * 
 * Qantas shows AA-metal flights as "Classic Flight Rewards" through oneworld.
 * This is a useful backdoor when AA.com is blocked, since Qantas may have
 * different/lighter bot protection.
 * 
 * NOTE: Qantas reward search requires a Qantas Frequent Flyer login to see
 * full results. Without login, it redirects or shows limited data.
 * If you have QFF credentials, set them in env: QANTAS_FF_NUMBER, QANTAS_FF_PASSWORD
 * 
 * Created: 2026-02-16
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { FlightResult, SearchParams, CabinCode, getCacheKey } from '../types.js';
import { getStealthManager } from '../../stealth.js';
import { getCached, setCache } from './cache.js';

const stealth = getStealthManager();

const QANTAS_CABIN_MAP: Record<CabinCode, string> = {
  economy: 'economy',
  business: 'business',
  first: 'first',
};

const AIRLINE_NAMES: Record<string, string> = {
  'AA': 'American Airlines', 'QF': 'Qantas', 'JL': 'Japan Airlines',
  'BA': 'British Airways', 'CX': 'Cathay Pacific', 'QR': 'Qatar Airways',
  'IB': 'Iberia', 'AY': 'Finnair', 'MH': 'Malaysia Airlines',
  'RJ': 'Royal Jordanian', 'AS': 'Alaska Airlines', 'LA': 'LATAM',
};

function buildSearchUrl(params: SearchParams): string {
  // Qantas reward search URL
  const url = new URL('https://www.qantas.com/au/en/book-a-trip/flights.html');
  // The actual search is handled by their SPA, so we'll need to interact with the form
  return url.toString();
}

async function login(page: Page): Promise<boolean> {
  const ffNumber = process.env.QANTAS_FF_NUMBER;
  const ffPassword = process.env.QANTAS_FF_PASSWORD;

  if (!ffNumber || !ffPassword) {
    console.warn('[Qantas] No QFF credentials set (QANTAS_FF_NUMBER, QANTAS_FF_PASSWORD)');
    return false;
  }

  try {
    await page.goto('https://www.qantas.com/au/en/frequent-flyer.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Look for login form
    const loginBtn = page.locator('button:has-text("Log in"), a:has-text("Log in")').first();
    if (await loginBtn.isVisible({ timeout: 5000 })) {
      await loginBtn.click();
      await page.waitForTimeout(2000);
    }

    // Fill credentials
    await page.fill('input[name="memberId"], input[id*="member"], #loyalty-number', ffNumber);
    await page.fill('input[name="password"], input[type="password"]', ffPassword);
    
    const submitBtn = page.locator('button[type="submit"], button:has-text("Log in")').first();
    await submitBtn.click();
    await page.waitForTimeout(5000);

    console.log('[Qantas] Login attempted');
    return true;
  } catch (error) {
    console.warn('[Qantas] Login failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

export async function searchQantas(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('qantas', params);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    await stealth.stealthDelay();

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    context = await browser.newContext(stealth.getContextOptions());
    const page = await context.newPage();
    await page.addInitScript(stealth.getStealthScript());

    console.log(`[Qantas] Searching: ${params.origin} → ${params.destination} on ${params.date} (${params.cabin})`);

    // Login if credentials available
    await login(page);

    // Navigate to flight search
    await page.goto('https://www.qantas.com/au/en/book-a-trip/flights.html', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(2000);

    // Toggle rewards mode
    try {
      const rewardsToggle = page.locator('text=Rewards, label:has-text("Rewards"), [data-testid*="reward"]').first();
      if (await rewardsToggle.isVisible({ timeout: 5000 })) {
        await rewardsToggle.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      console.log('[Qantas] Could not find rewards toggle');
    }

    // Fill origin
    const fromInput = page.locator('input[placeholder*="Departure"], input[aria-label*="Departure"], input[name*="from"]').first();
    await fromInput.click();
    await fromInput.fill(params.origin);
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Fill destination
    const toInput = page.locator('input[placeholder*="Arrival"], input[aria-label*="Arrival"], input[name*="to"]').first();
    await toInput.click();
    await toInput.fill(params.destination);
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Fill date
    const dateInput = page.locator('input[placeholder*="date"], input[aria-label*="date"], input[name*="date"]').first();
    await dateInput.click();
    await dateInput.fill(params.date);
    await page.waitForTimeout(500);

    // Submit search
    const searchBtn = page.locator('button:has-text("Search flights"), button[type="submit"]').first();
    await searchBtn.click();

    // Wait for results
    await page.waitForTimeout(10000);

    // Parse results (Qantas DOM structure is different)
    const results = await page.evaluate((sp) => {
      const flights: any[] = [];
      // Qantas uses various card/row selectors
      const cards = document.querySelectorAll('[class*="flight-card"], [class*="FlightCard"], [class*="flight-option"], [data-testid*="flight"]');

      cards.forEach((card) => {
        const text = card.textContent || '';
        
        const flightMatch = text.match(/([A-Z]{2})\s*(\d{1,4})/g);
        const flightNums = flightMatch || [];

        const milesMatch = text.match(/([\d,]+)\s*(?:pts|points|Qantas Points)/i);
        const miles = milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : 0;

        const timeMatches = text.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi);
        const depTime = timeMatches?.[0] || '';
        const arrTime = timeMatches?.[1] || '';

        const durationMatch = text.match(/(\d+)h\s*(\d+)?m?/);
        const duration = durationMatch ? `${durationMatch[1]}h ${durationMatch[2] || '0'}m` : '';

        const stopsMatch = text.match(/(non-?stop|direct|\d+)\s*stop/i);
        const stops = stopsMatch ? (stopsMatch[1].toLowerCase().includes('non') ? 0 : parseInt(stopsMatch[1]) || 0) : 0;

        const primaryCode = flightNums[0]?.match(/^([A-Z]{2})/)?.[1] || 'QF';

        if (miles > 0) {
          flights.push({
            source: 'qantas',
            airline: primaryCode,
            flightNumber: flightNums.join(', '),
            origin: sp.origin,
            destination: sp.destination,
            departureDate: sp.date,
            departureTime: depTime,
            arrivalTime: arrTime,
            duration,
            stops,
            cabin: sp.cabin,
            pointsRequired: miles,
            pointsProgram: 'Qantas Points',
            taxesAndFees: 0,
            awardType: 'partner',
            scrapedAt: new Date().toISOString(),
          });
        }
      });

      return flights;
    }, { origin: params.origin, destination: params.destination, date: params.date, cabin: params.cabin });

    const typedResults: FlightResult[] = results.map((r: any) => ({
      ...r,
      airline: AIRLINE_NAMES[r.airline] || r.airline,
      bookingUrl: buildSearchUrl(params),
    }));

    if (typedResults.length > 0) {
      setCache(cacheKey, typedResults);
    }

    console.log(`[Qantas] Found ${typedResults.length} results`);
    return typedResults;

  } catch (error) {
    console.error('[Qantas] Error:', error instanceof Error ? error.message : error);
    return [];
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

export default { searchQantas };
