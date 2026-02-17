import { chromium } from 'playwright';

async function intercept() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  const apiCalls: { url: string; method: string; status: number; body?: string; reqHeaders?: Record<string,string>; reqBody?: string }[] = [];
  
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('api') || url.includes('graphql') || url.includes('reward') || url.includes('search') || url.includes('availability')) {
      console.log(`>> REQ: ${request.method()} ${url.substring(0, 150)}`);
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json') || url.includes('api') || url.includes('graphql') || url.includes('availability') || url.includes('reward')) {
      let body = '';
      try { body = (await response.text()).substring(0, 3000); } catch {}
      const req = response.request();
      let reqBody = '';
      try { reqBody = req.postData()?.substring(0, 500) || ''; } catch {}
      apiCalls.push({
        url: url.substring(0, 250),
        method: req.method(),
        status: response.status(),
        body,
        reqBody,
      });
    }
  });

  console.log('Navigating to VA reward flight finder...');
  try {
    await page.goto('https://www.virginatlantic.com/reward-flight-finder/results/month?origin=JFK&destination=NRT&airline=DL&month=03&year=2026', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  } catch (e: any) {
    console.log('Navigation error:', e.message);
  }
  
  // Wait for API calls
  await page.waitForTimeout(15000);
  
  console.log(`\n=== Found ${apiCalls.length} API/JSON calls ===\n`);
  for (const call of apiCalls) {
    console.log(`${call.method} ${call.url}`);
    console.log(`  Status: ${call.status}`);
    if (call.reqBody) console.log(`  Req body: ${call.reqBody}`);
    if (call.body && call.body.length > 10) {
      console.log(`  Resp: ${call.body.substring(0, 500)}`);
    }
    console.log('');
  }
  
  // Also dump ALL requests
  console.log('\n=== Page title ===');
  console.log(await page.title());
  console.log('\n=== Page URL ===');
  console.log(page.url());
  
  await browser.close();
}

intercept().catch(e => console.error(e));
