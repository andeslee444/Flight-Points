import { chromium } from 'playwright';

async function intercept() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  // Capture ALL requests with full details
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('reward-seat-checker') || url.includes('travelplus')) {
      console.log(`\n=== REQUEST ===`);
      console.log(`${request.method()} ${url}`);
      console.log('Headers:', JSON.stringify(request.headers(), null, 2));
      const post = request.postData();
      if (post) console.log('Body:', post.substring(0, 2000));
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('reward-seat-checker') || url.includes('travelplus')) {
      console.log(`\n=== RESPONSE ===`);
      console.log(`${response.status()} ${url}`);
      try {
        const text = await response.text();
        console.log('Body:', text.substring(0, 3000));
      } catch {}
    }
  });

  // Try ATL-NAS (known Delta nonstop)
  const url = 'https://www.virginatlantic.com/reward-flight-finder/results/month?origin=ATL&destination=LHR&airline=DL&month=03&year=2026';
  console.log('Navigating to:', url);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e: any) {
    console.log('Nav error:', e.message);
  }
  
  await page.waitForTimeout(15000);
  
  // Check page content
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || '');
  console.log('\n=== Page text ===');
  console.log(text);
  
  await browser.close();
}

intercept().catch(e => console.error(e));
