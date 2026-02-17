/**
 * Test script: probe each airline's URL approach and API intercepts.
 * Run: npx tsx src/flights/scrapers/test-airlines.ts
 */
import { chromium } from 'playwright';

const AIRLINES = [
  {
    name: 'United',
    url: 'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7&st=bestmatches&tqp=A',
  },
  {
    name: 'Delta',
    url: 'https://www.delta.com/flight-search/book-a-flight?tripType=ONE_WAY&awardTravel=true&originCity=JFK&destinationCity=NRT&departureDate=2026-03-15&paxCount=1&cabinType=BUSINESS',
  },
  {
    name: 'Alaska',
    url: 'https://www.alaskaair.com/shopping/flights?prior=award&tripType=oneway&prior=award&orig=JFK&dest=NRT&departDate=03%2F15%2F2026&adults=1&cabinType=Business',
  },
  {
    name: 'Singapore',
    url: 'https://www.singaporeair.com/en_UK/ppsclub-krisflyer/redemption/search-flights/?originStation=JFK&destinationStation=NRT&departureDate=15-03-2026&cabinClass=J&adults=1&tripType=O',
  },
  {
    name: 'Cathay',
    url: 'https://www.cathaypacific.com/cx/en_US/book-a-trip/redeem-flights/search.html?origin=JFK&destination=NRT&departDate=2026-03-15&cabin=business&adults=1&tripType=oneWay',
  },
];

async function testAirline(airline: { name: string; url: string }) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${airline.name}`);
  console.log(`URL: ${airline.url}`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-http2'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  // Track API calls
  const apiCalls: { url: string; status: number; contentType: string; bodyPreview?: string }[] = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    // Only track JSON API calls (not static assets)
    if (ct.includes('json') && !url.includes('.js') && !url.includes('analytics') && !url.includes('tracking')) {
      let bodyPreview = '';
      try {
        const text = await response.text();
        bodyPreview = text.substring(0, 300);
      } catch {}
      apiCalls.push({ url: url.split('?')[0], status: response.status(), contentType: ct, bodyPreview });
    }
  });

  try {
    await page.goto(airline.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(8000);

    const finalUrl = page.url();
    console.log(`Final URL: ${finalUrl}`);

    // Check page state
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');
    const title = await page.title();
    console.log(`Title: ${title}`);

    // Check for blocks
    const blocked = bodyText.includes('captcha') || bodyText.includes('Access Denied') || bodyText.includes('blocked') || bodyText.includes('challenge');
    if (blocked) {
      console.log('⛔ BLOCKED by anti-bot');
    }

    // Check for login requirement
    const loginRequired = bodyText.includes('Sign in') || bodyText.includes('Log in') || bodyText.includes('sign in to continue');
    if (loginRequired) {
      console.log('🔒 Login may be required');
    }

    // Check for results
    const hasResults = bodyText.includes('miles') || bodyText.includes('Miles') || bodyText.includes('points') || bodyText.includes('award');
    if (hasResults) {
      console.log('✅ Possible award results detected');
    }

    // Print API calls
    if (apiCalls.length > 0) {
      console.log(`\n📡 JSON API calls intercepted (${apiCalls.length}):`);
      for (const call of apiCalls.slice(0, 10)) {
        console.log(`  ${call.status} ${call.url}`);
        if (call.bodyPreview) {
          console.log(`      Preview: ${call.bodyPreview.substring(0, 150)}...`);
        }
      }
    } else {
      console.log('\n📡 No JSON API calls intercepted');
    }

    // Print first 500 chars of body
    console.log(`\n📄 Body preview:\n${bodyText.substring(0, 500)}`);

    // Screenshot
    const ssPath = `/Users/andeslee/Documents/cursor-projects/class-sniper/data/${airline.name.toLowerCase()}-test.png`;
    await page.screenshot({ path: ssPath, fullPage: false });
    console.log(`📸 Screenshot: ${ssPath}`);

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  // Ensure data dir exists
  const { mkdirSync } = await import('fs');
  mkdirSync('/Users/andeslee/Documents/cursor-projects/class-sniper/data', { recursive: true });

  for (const airline of AIRLINES) {
    await testAirline(airline);
  }
  
  console.log('\n\nDone testing all airlines.');
}

main().catch(console.error);
