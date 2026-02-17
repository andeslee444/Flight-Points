import { chromium } from 'playwright';

async function testAPI() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // First, establish session by loading the reward flight finder page
  console.log('Establishing session...');
  await page.goto('https://www.virginatlantic.com/reward-flight-finder', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(5000);

  // Now try calling the API directly from the page context with different payloads
  const tests = [
    // Test 1: Delta carrier, JFK-NRT
    {
      name: 'DL: JFK-NRT (Delta carrier)',
      payload: {
        slice: { origin: 'JFK', destination: 'NRT', departure: '2026-03-01' },
        passengers: ['ADULT'],
        permittedCarriers: ['DL'],
        years: [2026],
        months: ['MARCH'],
      },
    },
    // Test 2: VS carrier, JFK-NRT (in case only VS works)
    {
      name: 'VS: JFK-NRT',
      payload: {
        slice: { origin: 'JFK', destination: 'NRT', departure: '2026-03-01' },
        passengers: ['ADULT'],
        permittedCarriers: ['VS'],
        years: [2026],
        months: ['MARCH'],
      },
    },
    // Test 3: DL, ATL-NRT
    {
      name: 'DL: ATL-NRT',
      payload: {
        slice: { origin: 'ATL', destination: 'NRT', departure: '2026-03-01' },
        passengers: ['ADULT'],
        permittedCarriers: ['DL'],
        years: [2026],
        months: ['MARCH'],
      },
    },
    // Test 4: Any carrier, JFK-NRT
    {
      name: 'Any: JFK-NRT (no carrier filter)',
      payload: {
        slice: { origin: 'JFK', destination: 'NRT', departure: '2026-03-01' },
        passengers: ['ADULT'],
        years: [2026],
        months: ['MARCH'],
      },
    },
    // Test 5: DL, JFK-LHR (known Delta route)
    {
      name: 'DL: JFK-LHR',
      payload: {
        slice: { origin: 'JFK', destination: 'LHR', departure: '2026-03-01' },
        passengers: ['ADULT'],
        permittedCarriers: ['DL'],
        years: [2026],
        months: ['MARCH'],
      },
    },
  ];

  for (const test of tests) {
    console.log(`\n=== ${test.name} ===`);
    try {
      const result = await page.evaluate(async (payload) => {
        const resp = await fetch('/travelplus/reward-seat-checker-api/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          redirect: 'follow',
        });
        const text = await resp.text();
        return { status: resp.status, url: resp.url, body: text.substring(0, 1500) };
      }, test.payload);
      console.log(`Status: ${result.status}`);
      console.log(`URL: ${result.url}`);
      console.log(`Body: ${result.body}`);
    } catch (e: any) {
      console.log(`Error: ${e.message}`);
    }
    await page.waitForTimeout(2000);
  }

  await browser.close();
}

testAPI().catch(e => console.error(e));
