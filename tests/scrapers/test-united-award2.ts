import { chromium } from 'playwright';
import * as fs from 'fs';

async function main() {
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

  // Capture the request payload for FetchSSENestedFlights
  let capturedPayload = '';
  page.on('request', req => {
    if (req.url().includes('FetchSSE')) {
      capturedPayload = req.postData() || '';
    }
  });
  
  page.on('response', async resp => {
    if (resp.url().includes('FetchSSE')) {
      try {
        const body = await resp.text();
        fs.writeFileSync('data/united-sse-award.txt', body);
        console.log(`[SSE] ${resp.status()} len=${body.length}`);
        const types = body.match(/"type":"[^"]*"/g) || [];
        const counts: Record<string, number> = {};
        types.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
        console.log('Types:', counts);
        
        // Check for miles pricing
        if (body.includes('miles') || body.includes('Miles') || body.includes('Award')) {
          console.log('*** CONTAINS MILES DATA ***');
        }
      } catch {}
    }
  });

  // Load homepage
  await page.goto('https://www.united.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);

  // First do a cash search to establish session, capture payload format
  console.log('Step 1: Cash search to get session...');
  await page.goto('https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&sc=7&px=1&taxng=1&newHP=True&clm=7', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(15000);
  console.log('Captured payload:', capturedPayload.substring(0, 200));

  // Now try to modify the payload to include AwardTravel: true and re-send via page.evaluate
  console.log('\nStep 2: Replay with AwardTravel=true...');
  if (capturedPayload) {
    const payload = JSON.parse(capturedPayload);
    payload.AwardTravel = true;
    // Remove fare family restrictions
    if (payload.Trips?.[0]?.SearchFiltersIn?.FareFamily) {
      delete payload.Trips[0].SearchFiltersIn.FareFamily;
    }
    
    const result = await page.evaluate(async (payloadStr: string) => {
      try {
        const resp = await fetch('/api/flight/FetchSSENestedFlights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadStr,
          credentials: 'include',
        });
        const text = await resp.text();
        return { status: resp.status, body: text.substring(0, 5000), len: text.length };
      } catch (e: any) {
        return { error: e.message };
      }
    }, JSON.stringify(payload));
    
    console.log('Award SSE result:', JSON.stringify(result).substring(0, 2000));
    if (result && 'body' in result) {
      fs.writeFileSync('data/united-sse-award-direct.txt', result.body);
    }
  }

  // Step 3: Navigate to award URL directly and see if SSE fires
  console.log('\nStep 3: Navigate to award URL...');
  await page.goto('https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // Check page - it might show a modal or search form
  const allText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');
  console.log('Award page text:', allText.substring(0, 500));

  // If there's a "Search" or "Find flights" button, click it
  for (const sel of ['button:has-text("Search")', 'button:has-text("Find flights")', 'button:has-text("Update")']) {
    const btn = await page.$(sel);
    if (btn && await btn.isVisible()) {
      console.log(`Clicking ${sel}...`);
      await btn.click();
      await page.waitForTimeout(15000);
      break;
    }
  }
  
  await page.screenshot({ path: 'data/united-award2.png', fullPage: true });
  await browser.close();
}

main();
