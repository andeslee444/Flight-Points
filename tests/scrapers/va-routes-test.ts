import { chromium } from 'playwright';

async function testRoutes() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Navigate to reward flight finder to establish session with Akamai
  console.log('Loading reward flight finder via known working route...');
  
  // Use Playwright route interception to capture what we need
  const captured: any[] = [];
  page.on('response', async (resp) => {
    if (resp.url().includes('reward-seat-checker-api') && resp.status() === 200) {
      try {
        const text = await resp.text();
        captured.push(text);
      } catch {}
    }
  });

  await page.goto('https://www.virginatlantic.com/reward-flight-finder/results/month?origin=ATL&destination=LHR&airline=DL&month=03&year=2026', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(10000);

  // Now extract cookies and test various routes via fetch from page context
  const routes = [
    { origin: 'JFK', destination: 'LHR', carrier: 'DL', name: 'JFK-LHR DL' },
    { origin: 'JFK', destination: 'LHR', carrier: 'VS', name: 'JFK-LHR VS' },
    { origin: 'LAX', destination: 'LHR', carrier: 'DL', name: 'LAX-LHR DL' },
    { origin: 'DTW', destination: 'NRT', carrier: 'DL', name: 'DTW-NRT DL' },
    { origin: 'SEA', destination: 'NRT', carrier: 'DL', name: 'SEA-NRT DL' },
    { origin: 'MSP', destination: 'NRT', carrier: 'DL', name: 'MSP-NRT DL' },
    { origin: 'LAX', destination: 'NRT', carrier: 'DL', name: 'LAX-NRT DL' },
    { origin: 'ATL', destination: 'NRT', carrier: 'DL', name: 'ATL-NRT DL' },
    { origin: 'JFK', destination: 'CDG', carrier: 'DL', name: 'JFK-CDG DL' },
    { origin: 'JFK', destination: 'NRT', carrier: 'DL', name: 'JFK-NRT DL' },
    { origin: 'HND', destination: 'DTW', carrier: 'DL', name: 'HND-DTW DL' },
  ];

  for (const route of routes) {
    try {
      const result = await page.evaluate(async ({ origin, destination, carrier }) => {
        const resp = await fetch('/travelplus/reward-seat-checker-api/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slice: { origin, destination, departure: '2026-03-01' },
            passengers: ['ADULT'],
            permittedCarriers: [carrier],
            years: [2026],
            months: ['MARCH'],
          }),
          redirect: 'follow',
        });
        const text = await resp.text();
        return { status: resp.status, hasData: text.length > 100, preview: text.substring(0, 200) };
      }, route);
      
      const status = result.status === 200 ? '✅' : '❌';
      console.log(`${status} ${route.name}: ${result.status} (${result.hasData ? 'has data' : 'empty'}) ${result.preview.substring(0, 80)}`);
    } catch (e: any) {
      console.log(`❌ ${route.name}: ${e.message}`);
    }
    await page.waitForTimeout(1500);
  }

  await browser.close();
}

testRoutes().catch(e => console.error(e));
