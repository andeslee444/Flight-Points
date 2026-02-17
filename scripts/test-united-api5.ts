/**
 * Test 5: Use system Chrome (not Playwright's Chromium) + persistent context
 * This should have a real Chrome TLS fingerprint and better bot evasion.
 */

import { chromium, Browser } from 'playwright';
import * as fs from 'fs';

const ORIGIN = 'JFK';
const DEST = 'NRT';
const DATE = '2026-03-15';
const CABIN = 7;
const DATA_DIR = '/Users/andeslee/Documents/cursor-projects/class-sniper/data';

async function main() {
  console.log('=== Test 5: System Chrome + Persistent Context ===\n');

  // Use persistent context with system Chrome
  const userDataDir = '/tmp/united-chrome-profile';
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome', // Use system Chrome!
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--disable-infobars',
    ],
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Collect responses
  const flightResponses: any[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/flight/Fetch')) {
      const headers = req.headers();
      console.log(`[REQ] ${req.method()} ${req.url().replace('https://www.united.com', '')}`);
      // Log all headers
      for (const [k, v] of Object.entries(headers)) {
        if (k.startsWith('x-') || k === 'cookie' || k === 'authorization' || k === '__requestverificationtoken') {
          console.log(`  ${k}: ${(v as string).substring(0, 100)}...`);
        }
      }
    }
  });

  page.on('response', async (resp) => {
    if (resp.url().includes('/api/flight/Fetch')) {
      try {
        const body = await resp.text();
        flightResponses.push({ url: resp.url(), status: resp.status(), body });
        console.log(`[RESP] ${resp.status()} ${resp.url().replace('https://www.united.com', '')} (${body.length}b)`);
        if (resp.status() === 200 && body.length > 200) {
          fs.writeFileSync(`${DATA_DIR}/united-chrome-resp.json`, body);
        }
      } catch {}
    }
  });

  // Step 1: Homepage
  console.log('Loading homepage with system Chrome...');
  await page.goto('https://www.united.com/en/us', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000); // Let Akamai sensor fully initialize

  // Accept cookies
  try {
    const btn = await page.$('button:has-text("Accept cookies")');
    if (btn) { await btn.click(); await page.waitForTimeout(1000); }
  } catch {}

  // Check _abck cookie
  const cookies = await context.cookies();
  const abck = cookies.find(c => c.name === '_abck');
  console.log(`_abck present: ${!!abck}`);
  if (abck) {
    // A valid _abck typically has "~" separators and ends with valid flag
    console.log(`_abck value (first 60): ${abck.value.substring(0, 60)}`);
    console.log(`_abck length: ${abck.value.length}`);
  }

  // Step 2: Navigate to search
  const searchUrl = `https://www.united.com/en/us/fsr/choose-flights?f=${ORIGIN}&t=${DEST}&d=${DATE}&tt=1&sc=${CABIN}&px=1&taxng=1&newHP=True&clm=7`;
  console.log(`\nNavigating to search...`);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Wait for results
  console.log('Waiting for search results...');
  const start = Date.now();
  while (!flightResponses.some(r => r.status === 200) && Date.now() - start < 30000) {
    await page.waitForTimeout(2000);
    console.log(`  ${Math.round((Date.now() - start)/1000)}s... (${flightResponses.length} responses)`);
  }
  await page.waitForTimeout(3000);

  // Check for modals
  const moneyBtn = await page.$('button:has-text("Show flights with money")');
  if (moneyBtn) {
    console.log('Clicking "Show flights with money"...');
    await moneyBtn.click();
    await page.waitForTimeout(10000);
  }

  await page.screenshot({ path: `${DATA_DIR}/united-chrome-search.png`, fullPage: true });

  // Page content
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  console.log(`\nPage: ${bodyText.substring(0, 300)}`);

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Flight responses: ${flightResponses.length}`);
  for (const r of flightResponses) {
    console.log(`  ${r.status} (${r.body.length}b)`);
    if (r.status === 200) {
      try {
        const json = JSON.parse(r.body);
        const trips = json?.data?.Trips || [];
        console.log(`  ${trips.length} trips`);
        for (const t of trips) {
          console.log(`  ${t.Flights?.length || 0} flights`);
        }
      } catch {}
    }
  }

  await context.close();
  console.log('Done!');
}

main().catch(console.error);
