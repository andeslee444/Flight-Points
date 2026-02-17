/**
 * Round 2: deeper probing with longer timeouts, networkidle, and alternative URLs
 */
import { chromium } from 'playwright';

async function testWithNetworkIdle(name: string, url: string, waitMs = 15000) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`URL: ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-http2'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  const jsonApis: { url: string; status: number; size: number; preview: string }[] = [];

  page.on('response', async (response) => {
    const rUrl = response.url();
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json') && !rUrl.includes('.js') && !rUrl.includes('analytics') && !rUrl.includes('tracking') && !rUrl.includes('demdex') && !rUrl.includes('qualtrics') && !rUrl.includes('quantum') && !rUrl.includes('adsrvr')) {
      try {
        const text = await response.text();
        jsonApis.push({ url: rUrl.substring(0, 120), status: response.status(), size: text.length, preview: text.substring(0, 200) });
      } catch {}
    }
  });

  try {
    // Use 'load' event with long timeout
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(waitMs);

    console.log(`Final URL: ${page.url()}`);
    console.log(`Title: ${await page.title()}`);

    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 1500) || '');
    
    // Detect states
    if (bodyText.includes('captcha') || bodyText.includes('Access Denied') || bodyText.includes('blocked')) {
      console.log('⛔ BLOCKED');
    }
    if (bodyText.toLowerCase().includes('sign in') || bodyText.toLowerCase().includes('log in')) {
      console.log('🔒 Login prompt detected');
    }

    // Check for flight-like content
    const flightIndicators = ['miles', 'Miles', 'award', 'nonstop', 'Nonstop', 'stops', 'departure', 'arrival'];
    const found = flightIndicators.filter(i => bodyText.includes(i));
    if (found.length > 0) console.log(`✅ Flight indicators: ${found.join(', ')}`);

    if (jsonApis.length > 0) {
      console.log(`\n📡 Relevant JSON APIs (${jsonApis.length}):`);
      for (const api of jsonApis) {
        console.log(`  [${api.status}] ${api.url} (${api.size} bytes)`);
        if (api.size > 100) console.log(`      ${api.preview.substring(0, 150)}`);
      }
    }

    console.log(`\n📄 Body (500 chars):\n${bodyText.substring(0, 500)}`);

    const ssPath = `/Users/andeslee/Documents/cursor-projects/class-sniper/data/${name.toLowerCase().replace(/\s/g,'-')}-test2.png`;
    await page.screenshot({ path: ssPath, fullPage: false });
    console.log(`📸 ${ssPath}`);

  } catch (error: any) {
    console.error(`❌ ${error.message.substring(0, 200)}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const { mkdirSync } = await import('fs');
  mkdirSync('/Users/andeslee/Documents/cursor-projects/class-sniper/data', { recursive: true });

  // United: try with networkidle and longer wait
  await testWithNetworkIdle('United-award', 
    'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7&st=bestmatches&tqp=A',
    20000
  );

  // United: try the API directly
  await testWithNetworkIdle('United-API',
    'https://www.united.com/api/flight/FetchFlights?client=homescreen',
    5000
  );

  // Alaska: the URL redirected to the search form. Try clicking through.
  // Let's try the Alaska API directly
  await testWithNetworkIdle('Alaska-shopping',
    'https://www.alaskaair.com/shopping/flights?prior=award&tripType=oneway&orig=JFK&dest=NRT&departDate=03%2F15%2F2026&adults=1',
    20000
  );

  // Cathay: try shorter URL
  await testWithNetworkIdle('Cathay-redeem',
    'https://www.cathaypacific.com/cx/en_US/redeem-flights.html',
    15000
  );

  // Singapore: try the booking page directly
  await testWithNetworkIdle('SQ-book',
    'https://www.singaporeair.com/en_UK/plan-and-book/your-booking/',
    10000
  );

  console.log('\n\nDone.');
}

main().catch(console.error);
