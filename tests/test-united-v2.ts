/**
 * Debug v2: Navigate to search URL, dismiss modal, click Update, and capture API response
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

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

  // Track flight API responses
  const flightResponses: any[] = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/flight/Fetch') && url.includes('united.com')) {
      console.log(`[API] ${resp.status()} ${url}`);
      if (resp.status() === 200) {
        try {
          const json = await resp.json();
          flightResponses.push(json);
          mkdirSync('data', { recursive: true });
          writeFileSync('data/united-api-response.json', JSON.stringify(json, null, 2));
          console.log('[API] Saved flight response!');
        } catch {}
      }
    }
  });

  // Step 1: Navigate to search URL
  const searchUrl = 'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-04-01&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7';
  console.log('Navigating to search...');
  await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
  
  // Wait for page to settle
  await page.waitForTimeout(3000);

  // Dismiss sign-in modal if present
  try {
    const closeBtn = await page.$('button[aria-label="Close"], .modal-close, button:has-text("×"), [data-testid="close-button"]');
    if (closeBtn) {
      await closeBtn.click();
      console.log('Dismissed modal');
    }
  } catch {}
  
  // Also try pressing Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // Do mouse movements to satisfy Akamai sensor
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(100 + Math.random() * 800, 100 + Math.random() * 600);
    await page.waitForTimeout(300 + Math.random() * 500);
  }

  // Scroll down and back
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(1000);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(2000);

  // Accept cookies if banner present
  try {
    const acceptBtn = await page.$('button:has-text("Accept cookies"), button:has-text("Accept")');
    if (acceptBtn) {
      await acceptBtn.click();
      console.log('Accepted cookies');
      await page.waitForTimeout(1000);
    }
  } catch {}

  // Screenshot before clicking Update
  await page.screenshot({ path: 'data/united-before-update.png' });

  // Click "Update" button to trigger search
  console.log('Clicking Update button...');
  try {
    const updateBtn = await page.$('button:has-text("Update"), button:has-text("Search"), button:has-text("Find flights")');
    if (updateBtn) {
      await updateBtn.click();
      console.log('Clicked Update!');
    } else {
      console.log('No Update button found');
    }
  } catch (e: any) {
    console.log('Error clicking update:', e.message);
  }

  // Wait for API response
  console.log('Waiting for flight results...');
  const startWait = Date.now();
  while (flightResponses.length === 0 && Date.now() - startWait < 30000) {
    await page.waitForTimeout(2000);
  }

  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'data/united-after-update.png', fullPage: true });
  console.log('Screenshots saved');

  console.log(`Flight API responses: ${flightResponses.length}`);
  if (flightResponses.length > 0) {
    console.log('Response keys:', Object.keys(flightResponses[0]));
  }

  // Check if results loaded in DOM
  const resultCards = await page.$$('[class*="flight-result"], [class*="FlightResult"], .flight-card, [data-testid="flight-card"]');
  console.log('DOM flight cards:', resultCards.length);

  await browser.close();
}

main().catch(e => console.error('Fatal:', e.message));
