import { chromium } from 'playwright';
import * as fs from 'fs';

async function main() {
  fs.mkdirSync('data', { recursive: true });
  
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--disable-http2']
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Capture flight search API responses
  page.on('response', async resp => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (url.includes('delta.com') && ct.includes('json') && (url.includes('shop') || url.includes('flight') || url.includes('search') || url.includes('offer'))) {
      try {
        const body = await resp.text();
        if (body.length > 500) {
          console.log(`[DL] ${resp.status()} ${url.substring(0, 120)} (${body.length} bytes)`);
          // Save if it looks like flight data
          if (body.includes('flight') || body.includes('itinerary') || body.includes('miles') || body.includes('SkyMiles')) {
            const filename = `data/delta-api-${Date.now()}.json`;
            fs.writeFileSync(filename, body);
            console.log(`  Saved to ${filename}`);
            console.log(`  Preview: ${body.substring(0, 500)}`);
          }
        }
      } catch {}
    }
  });

  // Navigate to Delta search with miles
  const searchUrl = 'https://www.delta.com/flight-search/search?tripType=ONE_WAY&originCity=JFK&destinationCity=NRT&departureDate=2026-03-15&numOfAdults=1&numOfChildren=0&numOfInfants=0&fareClass=BUSINESS&meetingEventCode=&refundableFlightsOnly=false&nearbyOriginAirports=false&nearbyDestinationAirports=false&awardTravel=true';
  
  console.log('Loading Delta search...');
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // Accept cookies
  const iUnderstand = await page.$('button:has-text("I understand")');
  if (iUnderstand) {
    await iUnderstand.click();
    await page.waitForTimeout(1000);
  }
  
  // Change "Best Fares For" to "Delta One" (Business) if possible
  // The dropdown shows "Delta Main" — we need business class
  try {
    const fareDropdown = await page.$('select[id*="fare"], [data-testid*="fare"]');
    if (fareDropdown) {
      console.log('Found fare dropdown');
    }
  } catch {}
  
  // Click "Find Flights"
  console.log('Clicking Find Flights...');
  const findBtn = await page.$('button:has-text("Find Flights")');
  if (findBtn) {
    await findBtn.click();
    console.log('Clicked! Waiting for results...');
    
    // Wait for flight results
    await page.waitForTimeout(20000);
    
    const bodyText = (await page.textContent('body').catch(() => '')) || '';
    console.log('Body preview:', bodyText.replace(/\s+/g, ' ').substring(0, 800));
    
    await page.screenshot({ path: 'data/delta-results.png', fullPage: true });
    console.log('Screenshot saved');
  } else {
    console.log('No Find Flights button found');
  }
  
  await browser.close();
}

main();
