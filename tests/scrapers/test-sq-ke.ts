import { chromium } from 'playwright';
import * as fs from 'fs';

async function testSingaporeAirlines() {
  console.log('\n=== SINGAPORE AIRLINES ===');
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

  const apiResponses: {url: string, status: number, body: string}[] = [];
  page.on('response', async resp => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('json') && (url.includes('api') || url.includes('flight') || url.includes('search') || url.includes('award') || url.includes('redemption'))) {
      try {
        const body = await resp.text();
        apiResponses.push({ url, status: resp.status(), body: body.substring(0, 2000) });
        if (body.length > 100) {
          console.log(`[SQ API] ${resp.status()} ${url.substring(0, 100)}`);
          console.log(`  ${body.substring(0, 300)}`);
        }
      } catch {}
    }
  });

  // Try the guest award search page
  console.log('Loading SQ award search...');
  try {
    await page.goto('https://www.singaporeair.com/en_UK/us/ppsclub-krisflyer/redemption/search/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    const text = (await page.textContent('body').catch(() => '')) || '';
    console.log('Page text:', text.replace(/\s+/g, ' ').substring(0, 500));
    
    // Check if login required
    if (text.includes('log in') || text.includes('sign in') || text.includes('Login')) {
      console.log('*** LOGIN REQUIRED ***');
    }
    
    await page.screenshot({ path: 'data/sq-award-search.png', fullPage: true });
  } catch (e: any) {
    console.log('SQ Error:', e.message);
  }
  
  await browser.close();
  console.log(`SQ API responses: ${apiResponses.length}`);
}

async function testKoreanAir() {
  console.log('\n=== KOREAN AIR ===');
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

  page.on('response', async resp => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('json') && (url.includes('api') || url.includes('flight') || url.includes('search') || url.includes('award') || url.includes('skypass'))) {
      try {
        const body = await resp.text();
        if (body.length > 100) {
          console.log(`[KE API] ${resp.status()} ${url.substring(0, 100)}`);
          console.log(`  ${body.substring(0, 300)}`);
        }
      } catch {}
    }
  });

  console.log('Loading KE award search...');
  try {
    await page.goto('https://www.koreanair.com/booking/best-prices?departureCode=JFK&arrivalCode=NRT&departureDate=20260315&tripType=OW&cabinClass=C&adult=1&child=0&infant=0&bonusUse=Y', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    const text = (await page.textContent('body').catch(() => '')) || '';
    console.log('Page text:', text.replace(/\s+/g, ' ').substring(0, 500));
    
    if (text.includes('log in') || text.includes('sign in') || text.includes('Login') || text.includes('SKYPASS')) {
      console.log('*** LOGIN REQUIRED ***');
    }
    
    await page.screenshot({ path: 'data/ke-award-search.png', fullPage: true });
  } catch (e: any) {
    console.log('KE Error:', e.message);
  }
  
  await browser.close();
}

async function testDelta() {
  console.log('\n=== DELTA ===');
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

  page.on('response', async resp => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('json') && url.includes('delta.com') && (url.includes('shop') || url.includes('flight') || url.includes('search') || url.includes('api'))) {
      try {
        const body = await resp.text();
        if (body.length > 100) {
          console.log(`[DL API] ${resp.status()} ${url.substring(0, 120)}`);
          console.log(`  ${body.substring(0, 500)}`);
        }
      } catch {}
    }
  });

  console.log('Loading Delta search...');
  try {
    // Delta's search URL pattern
    await page.goto('https://www.delta.com/flight-search/search?tripType=ONE_WAY&originCity=JFK&destinationCity=NRT&departureDate=2026-03-15&numOfAdults=1&numOfChildren=0&numOfInfants=0&fareClass=BUSINESS&meetingEventCode=&refundableFlightsOnly=false&nearbyOriginAirports=false&nearbyDestinationAirports=false&awardTravel=true', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(10000);
    
    const text = (await page.textContent('body').catch(() => '')) || '';
    console.log('Page text:', text.replace(/\s+/g, ' ').substring(0, 500));
    
    await page.screenshot({ path: 'data/delta-search.png', fullPage: true });
  } catch (e: any) {
    console.log('DL Error:', e.message);
  }
  
  await browser.close();
}

async function main() {
  await testSingaporeAirlines();
  await testKoreanAir();
  await testDelta();
}

main();
