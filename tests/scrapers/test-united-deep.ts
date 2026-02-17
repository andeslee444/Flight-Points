/**
 * Deep test: United.com - intercept the actual flight search API call
 * The headed browser loads the form correctly. We need to either:
 * 1. Wait for the auto-search to fire, or
 * 2. Click the search button, then intercept the API
 */
import { chromium } from 'playwright';

async function main() {
  const { mkdirSync, writeFileSync } = await import('fs');
  mkdirSync('/Users/andeslee/Documents/cursor-projects/class-sniper/data', { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  // Capture ALL network requests for analysis
  const allApis: { url: string; method: string; status: number; size: number; preview: string }[] = [];

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('united.com') && !url.endsWith('.js') && !url.endsWith('.css') && !url.endsWith('.png') && !url.endsWith('.svg') && !url.endsWith('.woff')) {
      const ct = resp.headers()['content-type'] || '';
      if (ct.includes('json')) {
        try {
          const text = await resp.text();
          allApis.push({
            url: url.substring(0, 150),
            method: resp.request().method(),
            status: resp.status(),
            size: text.length,
            preview: text.substring(0, 300),
          });
          // Log flight-related APIs immediately
          if (url.includes('flight') || url.includes('Flight') || url.includes('search') || url.includes('Search') || url.includes('Fetch')) {
            console.log(`🛫 FLIGHT API: [${resp.status()}] ${resp.request().method()} ${url.substring(0, 120)}`);
            console.log(`   Size: ${text.length}, Preview: ${text.substring(0, 200)}`);
          }
        } catch {}
      }
    }
  });

  const searchUrl = 'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7&st=bestmatches&tqp=A';
  
  console.log('Loading United search page...');
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('Page loaded. Waiting for modal/results...');
  
  // Accept cookies if needed
  try {
    const cookieBtn = await page.$('button:has-text("Accept cookies")');
    if (cookieBtn) { await cookieBtn.click(); console.log('Accepted cookies'); }
  } catch {}

  await page.waitForTimeout(5000);

  // Check what we see
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');
  console.log('\n--- Page state ---');
  console.log(bodyText.substring(0, 600));

  // Look for "Continue shopping?" modal (United shows this for award without login)
  const hasContinueModal = bodyText.includes('Continue shopping');
  const hasSignIn = bodyText.includes('Sign in');
  const hasShowMoney = bodyText.includes('Show flights with money');
  
  console.log(`\nContinue modal: ${hasContinueModal}`);
  console.log(`Sign in prompt: ${hasSignIn}`);
  console.log(`Show with money: ${hasShowMoney}`);

  if (hasShowMoney) {
    console.log('\nClicking "Show flights with money"...');
    try {
      await page.click('button:has-text("Show flights with money")');
      await page.waitForTimeout(10000);
      console.log('Clicked! Waiting for results...');
    } catch (e: any) {
      console.log('Could not click:', e.message);
    }
  } else if (hasContinueModal) {
    // Try any continue/search button
    console.log('\nLooking for continue/search buttons...');
    const buttons = await page.$$eval('button', els => els.map(e => e.textContent?.trim()).filter(Boolean));
    console.log('Available buttons:', buttons.slice(0, 20));
    
    // Try clicking search or find flights
    for (const text of ['Find flights', 'Search', 'Continue', 'Search flights']) {
      try {
        const btn = await page.$(`button:has-text("${text}")`);
        if (btn) {
          console.log(`Clicking "${text}"...`);
          await btn.click();
          await page.waitForTimeout(10000);
          break;
        }
      } catch {}
    }
  }

  // Wait for more API calls
  await page.waitForTimeout(10000);

  // Check final state
  const finalBody = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');
  console.log('\n--- Final page state ---');
  console.log(finalBody.substring(0, 800));

  // Screenshot
  await page.screenshot({ path: '/Users/andeslee/Documents/cursor-projects/class-sniper/data/united-deep.png', fullPage: false });

  // Dump all APIs
  console.log(`\n--- All ${allApis.length} JSON APIs ---`);
  for (const api of allApis) {
    const isInteresting = api.url.includes('flight') || api.url.includes('Flight') || api.url.includes('Fetch') || api.size > 5000;
    if (isInteresting) {
      console.log(`⭐ [${api.status}] ${api.method} ${api.url} (${api.size}b)`);
      console.log(`   ${api.preview.substring(0, 200)}`);
    }
  }

  // Save full API log
  writeFileSync(
    '/Users/andeslee/Documents/cursor-projects/class-sniper/data/united-apis.json',
    JSON.stringify(allApis, null, 2)
  );
  console.log('API log saved to data/united-apis.json');

  await context.close();
  await browser.close();
  console.log('Done.');
}

main().catch(console.error);
