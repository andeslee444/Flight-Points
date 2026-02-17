/**
 * Round 3: Try HTTP API calls directly (no browser), and headed browser for stubborn ones
 */
import { chromium } from 'playwright';

async function httpProbe(name: string, url: string, method = 'GET', body?: any) {
  console.log(`\n--- HTTP Probe: ${name} ---`);
  console.log(`${method} ${url}`);
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    if (body) headers['Content-Type'] = 'application/json';

    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'follow',
    });
    console.log(`Status: ${resp.status}`);
    console.log(`Content-Type: ${resp.headers.get('content-type')}`);
    const text = await resp.text();
    console.log(`Size: ${text.length}`);
    console.log(`Preview: ${text.substring(0, 500)}`);
  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }
}

async function headedTest(name: string, url: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Headed browser: ${name}`);
  
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const apis: string[] = [];
  page.on('response', async (r) => {
    const ct = r.headers()['content-type'] || '';
    if (ct.includes('json') && r.url().includes(name.toLowerCase().replace('-','').substring(0,5))) {
      try {
        const t = await r.text();
        if (t.length > 200) apis.push(`[${r.status()}] ${r.url().substring(0,100)} (${t.length}b): ${t.substring(0,150)}`);
      } catch {}
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(10000);
    
    console.log(`Final: ${page.url()}`);
    console.log(`Title: ${await page.title()}`);
    
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 800) || '');
    console.log(`Body: ${body.substring(0, 400)}`);
    
    if (apis.length > 0) {
      console.log(`APIs:`);
      apis.forEach(a => console.log(`  ${a}`));
    }
    
    const ss = `/Users/andeslee/Documents/cursor-projects/class-sniper/data/${name.toLowerCase()}-headed.png`;
    await page.screenshot({ path: ss });
    console.log(`Screenshot: ${ss}`);
  } catch (e: any) {
    console.log(`Error: ${e.message.substring(0, 200)}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const { mkdirSync } = await import('fs');
  mkdirSync('/Users/andeslee/Documents/cursor-projects/class-sniper/data', { recursive: true });

  // 1. United API probe - try their actual search API
  await httpProbe('United-SearchAPI',
    'https://www.united.com/api/flight/FetchFlights',
    'POST',
    {
      Trips: [{
        Origin: 'JFK',
        Destination: 'NRT',
        DepartDate: '2026-03-15',
        Cabin: 'BusinessFirst',
        SearchType: 'Award',
      }],
      PaxInfoList: [{ PaxType: 'ADT', DateOfBirth: '', Gender: '' }],
      SearchTypeSelection: 2, // 2 = award
      AwardTravel: true,
      CalendarOnly: false,
    }
  );

  // 2. Alaska API - try their shopping API
  await httpProbe('Alaska-FlightShopping',
    'https://www.alaskaair.com/search/api/flightshopping',
    'POST',
    {
      tripType: 'oneway',
      origin: 'JFK',
      destination: 'NRT',
      departDate: '2026-03-15',
      adults: 1,
      useAward: true,
      cabinType: 'Business',
    }
  );

  // 3. Singapore Airlines - try their API
  await httpProbe('SQ-SearchAPI',
    'https://www.singaporeair.com/api/v2/flights/search',
    'POST',
    {
      originStation: 'JFK',
      destinationStation: 'NRT',
      departureDate: '2026-03-15',
      cabinClass: 'J',
      adults: 1,
      tripType: 'O',
      redemption: true,
    }
  );

  // 4. Cathay Pacific - try their API
  await httpProbe('Cathay-SearchAPI',
    'https://api.cathaypacific.com/afr/search',
    'POST',
    {
      origin: 'JFK',
      destination: 'NRT',
      departDate: '2026-03-15',
      cabin: 'J',
      adults: 1,
      tripType: 'OW',
      searchType: 'REDEMPTION',
    }
  );

  // 5. Try headed browser for United (the timeout airline)
  await headedTest('United',
    'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7'
  );

  console.log('\n\nDone.');
}

main().catch(console.error);
