/**
 * Debug script: test united.com with Playwright headed mode
 * Goal: understand what pages/APIs we can access
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // Track all API responses
  const apiCalls: { url: string; status: number; size: number }[] = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/')) {
      apiCalls.push({ url, status: resp.status(), size: 0 });
      console.log(`[API] ${resp.status()} ${url.substring(0, 120)}`);
      
      if (url.includes('FetchFlights') || url.includes('FetchAward')) {
        try {
          const json = await resp.json();
          const { writeFileSync, mkdirSync } = require('fs');
          mkdirSync('data', { recursive: true });
          writeFileSync('data/united-api-response.json', JSON.stringify(json, null, 2));
          console.log('[API] Saved response to data/united-api-response.json');
          console.log('[API] Top keys:', Object.keys(json));
          if (json.data) console.log('[API] data keys:', Object.keys(json.data));
        } catch {}
      }
    }
  });

  // Step 1: Visit homepage
  console.log('Loading homepage...');
  await page.goto('https://www.united.com/en/us', { waitUntil: 'load', timeout: 60000 });
  console.log('Homepage loaded. Cookies:', (await context.cookies()).length);
  await page.waitForTimeout(5000);

  // Step 2: Try direct search URL
  const searchUrl = 'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-04-01&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7';
  console.log('Navigating to search URL...');
  
  try {
    await page.goto(searchUrl, { waitUntil: 'load', timeout: 45000 });
    console.log('Search page loaded!');
  } catch (e: any) {
    console.log('Navigation error:', e.message.substring(0, 200));
    // Try with less strict wait
    console.log('Current URL:', page.url());
  }

  await page.waitForTimeout(15000);

  // Screenshot
  const { mkdirSync } = require('fs');
  mkdirSync('data', { recursive: true });
  await page.screenshot({ path: 'data/united-debug.png', fullPage: true });
  console.log('Screenshot saved');
  
  // Log page title and URL
  console.log('Title:', await page.title());
  console.log('URL:', page.url());
  
  // Check for common blocking indicators
  const content = await page.content();
  console.log('Page length:', content.length);
  if (content.includes('Access Denied')) console.log('>>> ACCESS DENIED detected');
  if (content.includes('captcha')) console.log('>>> CAPTCHA detected');
  if (content.includes('challenge')) console.log('>>> CHALLENGE detected');
  if (content.includes('flight-result') || content.includes('FlightResult')) console.log('>>> FLIGHT RESULTS detected');

  console.log(`\nTotal API calls: ${apiCalls.length}`);
  apiCalls.forEach(c => console.log(`  ${c.status} ${c.url.substring(0, 100)}`));

  await browser.close();
}

main().catch(e => console.error('Fatal:', e.message));
