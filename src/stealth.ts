/**
 * Stealth Module - Rate Limiting & Anti-Detection
 * SNIPER-014
 * 
 * Prevents studios from detecting automated booking via:
 * - Randomized check intervals with jitter
 * - Request spacing (minimum delay between actions)
 * - Browser fingerprint rotation
 * - Session management
 * - Playwright stealth settings
 * 
 * Created: 2026-02-13
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// TYPES
// ============================================================

export interface StealthConfig {
  enabled: boolean;
  minDelayMs: number;        // minimum delay between actions (default 2000)
  maxDelayMs: number;        // maximum delay between actions (default 5000)
  jitterPercent: number;     // ±% jitter on check intervals (default 20)
  rotateFingerprint: boolean; // rotate viewport/UA/timezone
  sessionReuseMs: number;    // reuse sessions for this long (default 30min)
  cookieClearIntervalMs: number; // clear cookies every N ms (default 1hr)
}

export interface BrowserFingerprint {
  viewport: { width: number; height: number };
  userAgent: string;
  timezone: string;
  locale: string;
}

// ============================================================
// DEFAULT CONFIG
// ============================================================

const DEFAULT_STEALTH: StealthConfig = {
  enabled: true,
  minDelayMs: 2000,
  maxDelayMs: 5000,
  jitterPercent: 20,
  rotateFingerprint: true,
  sessionReuseMs: 1800000,     // 30 minutes
  cookieClearIntervalMs: 3600000, // 1 hour
};

// ============================================================
// FINGERPRINT POOLS
// ============================================================

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1680, height: 1050 },
];

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0',
];

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
];

const LOCALES = ['en-US', 'en-US', 'en-US', 'en-GB']; // weighted toward en-US

// ============================================================
// STEALTH CLASS
// ============================================================

export class StealthManager {
  private config: StealthConfig;
  private configPath: string;
  private lastActionTime: number = 0;
  private sessionStart: number = 0;
  private lastCookieClear: number = 0;

  constructor(configDir?: string) {
    const dir = configDir || path.join(__dirname, '../config');
    this.configPath = path.join(dir, 'stealth-config.json');
    this.config = this.loadConfig();
    this.sessionStart = Date.now();
    this.lastCookieClear = Date.now();
  }

  private loadConfig(): StealthConfig {
    if (fs.existsSync(this.configPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        return { ...DEFAULT_STEALTH, ...saved };
      } catch {
        // corrupted
      }
    }
    this.saveConfig(DEFAULT_STEALTH);
    return { ...DEFAULT_STEALTH };
  }

  private saveConfig(config?: StealthConfig): void {
    const c = config || this.config;
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(c, null, 2));
  }

  // ── Configuration ──

  getConfig(): StealthConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<StealthConfig>): StealthConfig {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
    return { ...this.config };
  }

  // ── Delay & Jitter ──

  /**
   * Get a randomized delay between minDelayMs and maxDelayMs
   */
  getRandomDelay(): number {
    if (!this.config.enabled) return 0;
    const { minDelayMs, maxDelayMs } = this.config;
    return Math.floor(Math.random() * (maxDelayMs - minDelayMs)) + minDelayMs;
  }

  /**
   * Apply jitter to a base interval
   * e.g., 60000ms ± 20% → 48000-72000ms
   */
  applyJitter(baseMs: number): number {
    if (!this.config.enabled) return baseMs;
    const jitter = this.config.jitterPercent / 100;
    const min = baseMs * (1 - jitter);
    const max = baseMs * (1 + jitter);
    return Math.floor(Math.random() * (max - min)) + min;
  }

  /**
   * Wait for minimum spacing between actions
   * Returns ms to wait (0 if enough time has passed)
   */
  getRequiredWait(): number {
    if (!this.config.enabled) return 0;
    const elapsed = Date.now() - this.lastActionTime;
    const minDelay = this.config.minDelayMs;
    return Math.max(0, minDelay - elapsed);
  }

  /**
   * Record that an action was taken
   */
  recordAction(): void {
    this.lastActionTime = Date.now();
  }

  /**
   * Sleep helper with stealth delay
   */
  async stealthDelay(): Promise<void> {
    const wait = this.getRequiredWait();
    if (wait > 0) {
      await new Promise(r => setTimeout(r, wait));
    }
    // Add random extra delay
    const extra = this.getRandomDelay();
    if (extra > 0) {
      await new Promise(r => setTimeout(r, extra));
    }
    this.recordAction();
  }

  // ── Fingerprint Rotation ──

  /**
   * Generate a random browser fingerprint
   */
  generateFingerprint(): BrowserFingerprint {
    const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    return {
      viewport: pick(VIEWPORTS),
      userAgent: pick(USER_AGENTS),
      timezone: pick(TIMEZONES),
      locale: pick(LOCALES),
    };
  }

  /**
   * Get Playwright launch options with stealth settings
   */
  getPlaywrightOptions(): Record<string, any> {
    if (!this.config.enabled) {
      return { headless: false };
    }

    const fp = this.config.rotateFingerprint ? this.generateFingerprint() : {
      viewport: { width: 1920, height: 1080 },
      userAgent: USER_AGENTS[0],
      timezone: 'America/New_York',
      locale: 'en-US',
    };

    return {
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-infobars',
        '--no-first-run',
        `--window-size=${fp.viewport.width},${fp.viewport.height}`,
      ],
    };
  }

  /**
   * Get Playwright context options with stealth settings
   */
  getContextOptions(): Record<string, any> {
    const fp = this.config.rotateFingerprint ? this.generateFingerprint() : {
      viewport: { width: 1920, height: 1080 },
      userAgent: USER_AGENTS[0],
      timezone: 'America/New_York',
      locale: 'en-US',
    };

    return {
      viewport: fp.viewport,
      userAgent: fp.userAgent,
      timezoneId: fp.timezone,
      locale: fp.locale,
      // Stealth: override navigator.webdriver
      javaScriptEnabled: true,
      bypassCSP: true,
      extraHTTPHeaders: {
        'Accept-Language': `${fp.locale},en;q=0.9`,
      },
    };
  }

  /**
   * Get stealth page init script (inject into page to hide automation)
   */
  getStealthScript(): string {
    return `
      // Override navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      // Override chrome automation flags
      if (window.chrome) {
        window.chrome.runtime = window.chrome.runtime || {};
      }
      
      // Override permissions query
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // Override plugins length
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    `;
  }

  // ── Session Management ──

  /**
   * Check if session should be refreshed
   */
  shouldRefreshSession(): boolean {
    return Date.now() - this.sessionStart > this.config.sessionReuseMs;
  }

  /**
   * Check if cookies should be cleared
   */
  shouldClearCookies(): boolean {
    return Date.now() - this.lastCookieClear > this.config.cookieClearIntervalMs;
  }

  /**
   * Mark session as refreshed
   */
  refreshSession(): void {
    this.sessionStart = Date.now();
  }

  /**
   * Mark cookies as cleared
   */
  markCookiesCleared(): void {
    this.lastCookieClear = Date.now();
  }
}

// ============================================================
// SINGLETON
// ============================================================

let _stealthManager: StealthManager | null = null;

export function getStealthManager(): StealthManager {
  if (!_stealthManager) {
    _stealthManager = new StealthManager();
  }
  return _stealthManager;
}
