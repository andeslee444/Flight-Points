/**
 * Test 4: Let the browser navigate naturally to the search page.
 * The key is NOT calling fetch() programmatically — let Akamai's JS do its thing.
 * Navigate to search URL → wait for FetchFlights to fire naturally.
 */

import { chromium, Browser } from 'playwright';
import * as fs from 'fs';

const ORIGIN = 'JFK';
const DEST = 'NRT';
const DATE = '2026-03-15';
const CABIN = 7;
const DATA_DIR = '/Users/andeslee/Documents/cursor-projects/class-sniper/data';

async function main() {
  console.log('=== United: Natural Navigation + API Intercept ===\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-http2',
      '--no-first-run',
      '--disable-infobars',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // @ts-ignore
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  // Collect flight API responses
  const flightApiResponses: any[] = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/flight/Fetch') || url.includes('/api/flight/fetch')) {
      try {
        const body = await resp.text();
        flightApiResponses.push({ url, status: resp.status(), body });
        console.log(`[FLIGHT API] ${resp.status()} ${url.replace('https://www.united.com', '')} (${body.length}b)`);
        if (resp.status() === 200 && body.length > 500) {
          fs.writeFileSync(`${DATA_DIR}/united-flight-resp-${flightApiResponses.length}.json`, body);
          console.log(`  → Saved response #${flightApiResponses.length}`);
        }
      } catch {}
    }
  });

  // Log request headers for FetchFlights to understand what Akamai wants
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/flight/Fetch')) {
      console.log(`[FLIGHT REQ] ${req.method()} ${url.replace('https://www.united.com', '')}`);
      const headers = req.headers();
      // Log interesting headers
      for (const key of ['cookie', 'x-authorization-api', '__requestverificationtoken', 'x-requested-with']) {
        if (headers[key]) {
          console.log(`  ${key}: ${headers[key].substring(0, 80)}...`);
        }
      }
    }
  });

  // Step 1: Load homepage first (let Akamai sensor run)
  console.log('Step 1: Loading homepage...');
  await page.goto('https://www.united.com/en/us', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Accept cookies
  try {
    const btn = await page.$('button:has-text("Accept cookies")');
    if (btn) { await btn.click(); await page.waitForTimeout(1000); }
  } catch {}

  console.log('Homepage loaded, waiting for Akamai sensor...');
  await page.waitForTimeout(5000);

  // Step 2: Navigate to search page (cash search, no login needed)
  // Using at=1 means award travel. at=2 or removing at means cash.
  // Let's try cash first (no login required)
  const cashSearchUrl = `https://www.united.com/en/us/fsr/choose-flights?f=${ORIGIN}&t=${DEST}&d=${DATE}&tt=1&sc=${CABIN}&px=1&taxng=1&newHP=True&clm=7`;
  console.log(`\nStep 2: Navigating to cash search: ${cashSearchUrl}`);
  await page.goto(cashSearchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  
  // Wait for the page to make API calls
  console.log('Waiting for flight search API calls...');
  
  // Wait up to 30s for a FetchFlights response
  const startWait = Date.now();
  while (flightApiResponses.length === 0 && Date.now() - startWait < 30000) {
    await page.waitForTimeout(2000);
    console.log(`  Waiting... (${Math.round((Date.now() - startWait) / 1000)}s, ${flightApiResponses.length} responses)`);
  }

  // Extra wait
  await page.waitForTimeout(5000);

  // Screenshot
  await page.screenshot({ path: `${DATA_DIR}/united-search-result.png`, fullPage: true });
  console.log('Screenshot saved');

  // Check page content
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  console.log(`\nPage body: ${bodyText.substring(0, 300)}`);

  // Check for "Continue shopping?" modal or "Show flights with money"
  const hasModal = await page.$('text=Continue shopping');
  const hasMoneyBtn = await page.$('button:has-text("Show flights with money")');
  if (hasModal) console.log('Found "Continue shopping?" modal');
  if (hasMoneyBtn) {
    console.log('Found "Show flights with money" button - clicking...');
    await hasMoneyBtn.click();
    await page.waitForTimeout(10000);
    
    await page.screenshot({ path: `${DATA_DIR}/united-after-money-click.png`, fullPage: true });
    console.log('Screenshot after money click saved');
  }

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Flight API responses: ${flightApiResponses.length}`);
  for (const r of flightApiResponses) {
    console.log(`  ${r.status} ${r.url.replace('https://www.united.com', '')} (${r.body.length}b)`);
    if (r.status === 200) {
      try {
        const json = JSON.parse(r.body);
        const trips = json?.data?.Trips || [];
        console.log(`  Trips: ${trips.length}`);
        for (const trip of trips) {
          const flights = trip?.Flights || [];
          console.log(`    Flights: ${flights.length}`);
          for (const f of flights.slice(0, 5)) {
            const segs = f?.Legs || f?.Segments || f?.FlightSegments || [];
            const s0 = segs[0] || {};
            const products = f?.Products || [];
            console.log(`    ${s0.OperatingCarrier || '??'}${s0.FlightNumber || '?'} ${s0.DepartDateTime || ''} products:${products.length}`);
          }
        }
      } catch {}
    }
  }

  // Save all cookies for potential replay
  const cookies = await context.cookies();
  fs.writeFileSync(`${DATA_DIR}/united-cookies.json`, JSON.stringify(cookies, null, 2));
  
  await context.close();
  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
