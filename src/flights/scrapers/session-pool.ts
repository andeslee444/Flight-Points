/**
 * Session Cookie Pool
 *
 * Manages Akamai session cookies for direct API calls to airline websites.
 * Lazy-initializes via a headless browser, then reuses cookies until they expire.
 *
 * Created: 2026-02-19
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

interface SessionEntry {
  cookies: string;
  createdAt: number;
  refreshing: boolean;
}

const COOKIE_TTL_MS = 12 * 60 * 1000; // 12 minutes (conservative; actual ~15-30min)

const sessions = new Map<string, SessionEntry>();
const initPromises = new Map<string, Promise<string>>();

/**
 * Get valid session cookies for a domain. Lazy-initializes on first call.
 * Returns cookie header string or empty string on failure.
 */
export async function getSessionCookies(domain: string): Promise<string> {
  const existing = sessions.get(domain);
  if (existing && Date.now() - existing.createdAt < COOKIE_TTL_MS) {
    return existing.cookies;
  }

  // If already initializing, wait for that promise
  const pending = initPromises.get(domain);
  if (pending) return pending;

  const promise = warmCookies(domain);
  initPromises.set(domain, promise);
  try {
    return await promise;
  } finally {
    initPromises.delete(domain);
  }
}

/**
 * Mark cookies as invalid so the next call triggers a refresh.
 */
export function invalidateSession(domain: string): void {
  sessions.delete(domain);
}

/**
 * Launch a headless browser, visit the domain to establish Akamai cookies,
 * then extract and store them.
 */
async function warmCookies(domain: string): Promise<string> {
  const url = `https://www.${domain}/`;
  console.log(`[SessionPool] Warming cookies for ${domain}...`);

  let browser = null;
  try {
    const rawProxy = process.env.PROXY_URL || '';
    const proxyServer = rawProxy.startsWith('socks') ? rawProxy : '';
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-http2',
        '--no-first-run',
      ],
      ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Wait for Akamai challenge to resolve
    await page.waitForTimeout(3000 + Math.random() * 2000);

    // Accept cookies banner if present
    try {
      const btn = page.locator('#onetrust-accept-btn-handler');
      if (await btn.isVisible({ timeout: 2000 })) await btn.click();
    } catch {}

    // Human-like scroll
    await page.evaluate(() => window.scrollBy(0, Math.random() * 300));
    await page.waitForTimeout(1000);

    // Extract cookies
    const browserCookies = await context.cookies();
    const cookieStr = browserCookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    await context.close();

    if (cookieStr) {
      sessions.set(domain, {
        cookies: cookieStr,
        createdAt: Date.now(),
        refreshing: false,
      });
      console.log(`[SessionPool] Got ${browserCookies.length} cookies for ${domain}`);
    } else {
      console.warn(`[SessionPool] No cookies obtained for ${domain}`);
    }

    return cookieStr;
  } catch (err: any) {
    console.error(`[SessionPool] Failed to warm cookies for ${domain}: ${err.message}`);
    return '';
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
