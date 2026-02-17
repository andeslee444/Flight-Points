/**
 * Flight Monitor Daemon
 * Continuously scrapes award flights for signups every 30 minutes.
 * 
 * Memory-efficient: rotates through searches across cycles (max ~25 per cycle),
 * monitors RSS, and gracefully handles OOM conditions.
 * 
 * Started: 2026-02-16
 * Updated: 2026-02-16 — OOM fixes, search rotation, memory monitoring
 */

import 'dotenv/config';
import { searchAABatch } from './scrapers/aa.js';
import { searchAACamoufoxBatch } from './scrapers/aa-camoufox.js';
import { searchAAFastBatch } from './scrapers/aa-fast.js';
import { searchANACamoufox } from './scrapers/ana-camoufox.js';
import { searchBACamoufox } from './scrapers/ba-camoufox.js';
import { searchSQCamoufox } from './scrapers/sq-camoufox.js';
import { SearchParams, FlightResult } from './types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
// __dirname available in CJS; for ESM compat use path.dirname(fileURLToPath(import.meta.url))
// const __dirname is already defined in CommonJS
const DATA_DIR = path.resolve(__dirname, '../../data');
const SIGNUPS_FILE = path.join(DATA_DIR, 'flight-signups.json');
const HISTORY_FILE = path.join(DATA_DIR, 'flight-monitor-history.json');
const ROTATION_FILE = path.join(DATA_DIR, 'flight-rotation-state.json');
const SENT_ALERTS_FILE = path.join(DATA_DIR, 'sent-alerts.json');
const WEB_CACHE_FILE = '/Users/andeslee/Documents/cursor-projects/harbor-web/data/flight-cache.json';
const SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SEARCHES_PER_CYCLE = 25;
const MAX_RSS_MB = 450; // restart browser well before 500MB

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function getRssMB(): number {
  return process.memoryUsage.rss() / (1024 * 1024);
}

interface Signup {
  from: string;
  to: string;
  class: string;
  contact: string;
  alertMethod: string;
  startDate?: string;
  endDate?: string;
}

interface HistoryEntry {
  scanTime: string;
  results: FlightResult[];
}

interface History {
  lastScan: string;
  scans: HistoryEntry[];
  knownFlights: Record<string, { miles: number; firstSeen: string }>;
}

// ── Sent alerts dedup ──
type SentAlerts = Record<string, string>; // key → ISO timestamp

function loadSentAlerts(): SentAlerts {
  if (existsSync(SENT_ALERTS_FILE)) {
    try { return JSON.parse(readFileSync(SENT_ALERTS_FILE, 'utf-8')); } catch {}
  }
  return {};
}

function saveSentAlerts(sa: SentAlerts) {
  // Prune entries older than 90 days
  const cutoff = Date.now() - 90 * 86400000;
  for (const [k, v] of Object.entries(sa)) {
    if (new Date(v).getTime() < cutoff) delete sa[k];
  }
  writeFileSync(SENT_ALERTS_FILE, JSON.stringify(sa, null, 2));
}

function alertKey(f: FlightResult): string {
  return `${f.airline}-${f.origin}-${f.destination}-${f.departureDate}-${f.flightNumber}-${f.cabin}`;
}

// ── Deal quality filter ──
const ASIA_AIRPORTS = new Set([
  'NRT', 'HND', 'KIX', 'NGO', 'FUK', 'CTS', // Japan
  'ICN', 'GMP', // Korea
  'PEK', 'PVG', 'HKG', 'TPE', // China/HK/Taiwan
  'SIN', 'BKK', 'MNL', 'SGN', 'HAN', 'KUL', // SE Asia
  'DEL', 'BOM', 'BLR', // India
]);

const EUROPE_AIRPORTS = new Set([
  'LHR', 'CDG', 'FRA', 'AMS', 'FCO', 'MAD', 'BCN', 'MUC', 'ZRH', 'VIE',
  'CPH', 'ARN', 'OSL', 'HEL', 'DUB', 'LIS', 'ATH', 'IST', 'WAW', 'PRG',
]);

const US_AIRPORTS = new Set([
  'JFK', 'EWR', 'LGA', 'LAX', 'SFO', 'ORD', 'IAD', 'DFW', 'ATL', 'BOS',
  'SEA', 'MIA', 'IAH', 'DEN', 'PHX',
]);

function isTransatlantic(f: FlightResult): boolean {
  const oUS = US_AIRPORTS.has(f.origin);
  const dUS = US_AIRPORTS.has(f.destination);
  const oEU = EUROPE_AIRPORTS.has(f.origin);
  const dEU = EUROPE_AIRPORTS.has(f.destination);
  return (oUS && dEU) || (oEU && dUS);
}

function isToAsia(f: FlightResult): boolean {
  return US_AIRPORTS.has(f.origin) && ASIA_AIRPORTS.has(f.destination);
}

function isInternational(f: FlightResult): boolean {
  // Simple heuristic: different "regions"
  const oUS = US_AIRPORTS.has(f.origin);
  const dUS = US_AIRPORTS.has(f.destination);
  return (oUS && !dUS) || (!oUS && dUS);
}

interface DealCheck { isDeal: boolean; sweetSpot?: string }

function isGoodDeal(f: FlightResult): DealCheck {
  const miles = f.pointsRequired;
  const taxes = f.taxesAndFees;

  // Must have real data
  if (!miles || !Number.isFinite(miles) || miles <= 0) return { isDeal: false };
  if (taxes == null || !Number.isFinite(taxes) || taxes < 0) return { isDeal: false };
  if (taxes >= 500) return { isDeal: false };

  const airline = (f.airline || '').toUpperCase();

  // Business class deals
  if (f.cabin === 'business') {
    // AA business to Asia ≤70k
    if (airline.includes('AMERICAN') && isToAsia(f) && miles <= 70000)
      return { isDeal: true, sweetSpot: 'AA sAAver Asia Business' };
    // ANA business to Asia ≤95k (one-way comparison; RT would be ≤95k total)
    if (airline.includes('ANA') && isToAsia(f) && miles <= 95000)
      return { isDeal: true, sweetSpot: 'ANA Business to Asia' };
    // Any business transatlantic ≤60k
    if (isTransatlantic(f) && miles <= 60000)
      return { isDeal: true, sweetSpot: `${f.airline} Transatlantic Business` };
    // Catch-all business to Asia ≤75k (partner awards etc.)
    if (isToAsia(f) && miles <= 75000)
      return { isDeal: true, sweetSpot: `${f.airline} Business to Asia` };
    return { isDeal: false };
  }

  // First class deals
  if (f.cabin === 'first') {
    if (isToAsia(f) && miles <= 120000)
      return { isDeal: true, sweetSpot: `${f.airline} First Class to Asia` };
    if (isTransatlantic(f) && miles <= 90000)
      return { isDeal: true, sweetSpot: `${f.airline} First Class Transatlantic` };
    return { isDeal: false };
  }

  // Economy — only if under 30k international
  if (f.cabin === 'economy') {
    if (isInternational(f) && miles <= 30000)
      return { isDeal: true, sweetSpot: `${f.airline} Economy Deal` };
    return { isDeal: false };
  }

  return { isDeal: false };
}

function loadSignups(): Signup[] {
  return JSON.parse(readFileSync(SIGNUPS_FILE, 'utf-8'));
}

function loadHistory(): History {
  if (existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
    } catch { /* corrupted, start fresh */ }
  }
  return { lastScan: '', scans: [], knownFlights: {} };
}

function saveHistory(h: History) {
  if (h.scans.length > 48) h.scans = h.scans.slice(-48);
  // Prune knownFlights older than 30 days
  const cutoff = Date.now() - 30 * 86400000;
  for (const [k, v] of Object.entries(h.knownFlights)) {
    if (new Date(v.firstSeen).getTime() < cutoff) delete h.knownFlights[k];
  }
  writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
}

function loadRotationOffset(): number {
  try {
    if (existsSync(ROTATION_FILE)) {
      return JSON.parse(readFileSync(ROTATION_FILE, 'utf-8')).offset || 0;
    }
  } catch {}
  return 0;
}

function saveRotationOffset(offset: number) {
  writeFileSync(ROTATION_FILE, JSON.stringify({ offset, updatedAt: new Date().toISOString() }));
}

function flightKey(f: FlightResult): string {
  return `${f.flightNumber}|${f.origin}-${f.destination}|${f.departureDate}|${f.cabin}`;
}

function generateDates(startDate?: string, endDate?: string): string[] {
  const dates: string[] = [];
  const now = new Date();
  const start = startDate ? new Date(startDate) : new Date(now.getTime() + 7 * 86400000);
  const end = endDate ? new Date(endDate) : new Date(now.getTime() + 90 * 86400000);

  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 14);
  }
  return dates;
}

function parseList(s: string): string[] {
  return s.split(/[,;]\s*/).map(x => x.trim()).filter(Boolean);
}

function isValidFlight(f: FlightResult): boolean {
  // Airline must be a real name (not empty, not "N/A", not "Unknown")
  if (!f.airline || f.airline.trim() === '' || f.airline === 'N/A' || f.airline === 'Unknown') return false;
  // Points must be a positive number
  if (!f.pointsRequired || !Number.isFinite(f.pointsRequired) || f.pointsRequired <= 0) return false;
  // Taxes must be a valid finite number >= 0
  if (f.taxesAndFees == null || !Number.isFinite(f.taxesAndFees) || f.taxesAndFees < 0) return false;
  if (!f.origin || !f.destination || !f.departureDate) return false;
  return true;
}

function formatAlert(f: FlightResult, sweetSpot?: string): string {
  const miles = f.pointsRequired! >= 1000
    ? `${(f.pointsRequired! / 1000).toFixed(f.pointsRequired! % 1000 === 0 ? 0 : 1)}K`
    : `${f.pointsRequired!}`;
  const taxes = `$${f.taxesAndFees!.toFixed(2)}`;
  const cabin = f.cabin.charAt(0).toUpperCase() + f.cabin.slice(1);
  const airline = f.airline || 'Unknown';
  const url = f.bookingUrl || '';
  // Format date nicely
  const d = new Date(f.departureDate + 'T00:00:00');
  const dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let msg = `✈️ Award Deal Found!\n${airline} ${cabin}: ${f.origin} → ${f.destination}`;
  msg += `\n📅 ${dateStr}`;
  msg += `\n💰 ${miles} miles + ${taxes} taxes`;
  if (f.flightNumber) msg += `\n🛫 ${f.flightNumber}`;
  if (sweetSpot) msg += `\n📊 Sweet spot: ${sweetSpot}`;
  if (url) msg += `\nBook: ${url}`;
  return msg;
}

function sendWhatsApp(contact: string, message: string) {
  try {
    log(`Sending WhatsApp alert to ${contact}`);
    // Use env var to pass message to avoid shell interpolation of $ and other special chars
    // Write message to temp file to avoid all shell escaping issues
    const tmpFile = '/tmp/flight-alert-msg.txt';
    require('fs').writeFileSync(tmpFile, message);
    execSync(`openclaw message send --channel whatsapp --target "${contact}" --message "$(cat ${tmpFile})"`, {
      timeout: 30000,
      shell: '/bin/bash',
    });
    log('Alert sent successfully');
  } catch (e: any) {
    log(`Failed to send WhatsApp: ${e.message}`);
  }
}

function buildAllSearches(signups: Signup[]): {
  searches: Array<{ params: SearchParams; signups: Signup[] }>;
  signupCabins: Map<string, Set<string>>;
} {
  const searchMap = new Map<string, { params: SearchParams; signups: Signup[] }>();
  const signupCabins = new Map<string, Set<string>>();

  for (const signup of signups) {
    const origins = parseList(signup.from);
    const destinations = parseList(signup.to);
    const cabins: string[] = [];

    if (signup.class === 'Either' || signup.class === 'Business') cabins.push('business');
    if (signup.class === 'Either' || signup.class === 'First') cabins.push('first');
    if (cabins.length === 0) cabins.push('business', 'first');

    const dates = generateDates(signup.startDate, signup.endDate);

    for (const origin of origins) {
      for (const dest of destinations) {
        for (const date of dates) {
          const key = `${origin}-${dest}-${date}`;
          if (!searchMap.has(key)) {
            searchMap.set(key, {
              params: { origin, destination: dest, date, cabin: 'business' },
              signups: [],
            });
            signupCabins.set(key, new Set());
          }
          searchMap.get(key)!.signups.push(signup);
          cabins.forEach(c => signupCabins.get(key)!.add(c));
        }
      }
    }
  }

  return { searches: Array.from(searchMap.values()), signupCabins };
}

function writeToWebCache(
  results: FlightResult[],
  searches: Array<{ params: SearchParams; signups: Signup[] }>,
  signupCabins: Map<string, Set<string>>,
  scanTime: string
) {
  try {
    // Load existing cache
    let cache: any = { version: 1, entries: {}, lastUpdated: null };
    if (existsSync(WEB_CACHE_FILE)) {
      try { cache = JSON.parse(readFileSync(WEB_CACHE_FILE, 'utf-8')); } catch {}
    }

    // Group results by route-date-cabin
    for (const { params } of searches) {
      const routeKey = `${params.origin}-${params.destination}-${params.date}`;
      const cabins = signupCabins.get(routeKey) || new Set(['business']);

      for (const cabin of cabins) {
        const cacheKey = `${params.origin}-${params.destination}-${params.date}-${cabin}`;
        const matching = results.filter(r =>
          r.origin === params.origin &&
          r.destination === params.destination &&
          r.departureDate === params.date &&
          r.cabin === cabin
        );

        if (matching.length === 0) continue;

        const awardFlights = matching
          .filter(r => r.pointsRequired && r.pointsRequired > 0)
          .map(r => ({
            airline: r.airline || 'Unknown',
            flightNumber: r.flightNumber || '',
            origin: r.origin,
            destination: r.destination,
            departureDate: r.departureDate,
            departureTime: r.departureTime || '',
            arrivalTime: r.arrivalTime || '',
            duration: r.duration || '',
            stops: r.stops ?? -1,
            cabin: r.cabin,
            pointsRequired: r.pointsRequired,
            pointsProgram: r.pointsProgram || '',
            taxes: r.taxesAndFees || 0,
            awardType: r.awardType || null,
            source: r.source || 'daemon',
            bookingUrl: r.bookingUrl || '',
          }));

        cache.entries[cacheKey] = {
          timestamp: scanTime,
          awardFlights,
          cashFlights: cache.entries[cacheKey]?.cashFlights || [],
        };
      }
    }

    cache.lastUpdated = scanTime;

    // Prune entries older than 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, entry] of Object.entries(cache.entries) as any[]) {
      if (new Date(entry.timestamp).getTime() < cutoff) delete cache.entries[key];
    }

    writeFileSync(WEB_CACHE_FILE, JSON.stringify(cache, null, 2));
    log(`Web cache updated: ${Object.keys(cache.entries).length} entries`);
  } catch (e: any) {
    log(`Failed to write web cache: ${e.message}`);
  }
}

async function runScan() {
  log('=== Starting scan ===');
  log(`Memory: ${getRssMB().toFixed(0)}MB RSS`);
  
  const signups = loadSignups();
  const history = loadHistory();
  const scanTime = new Date().toISOString();
  const allResults: FlightResult[] = [];
  const newFlights: Array<{ flight: FlightResult; signup: Signup }> = [];

  // Build all possible searches
  const { searches: allSearches, signupCabins } = buildAllSearches(signups);
  log(`Total unique searches: ${allSearches.length}`);

  // Rotate: pick a slice of MAX_SEARCHES_PER_CYCLE
  let offset = loadRotationOffset();
  if (offset >= allSearches.length) offset = 0;
  
  const cycleSearches = allSearches.slice(offset, offset + MAX_SEARCHES_PER_CYCLE);
  const nextOffset = offset + cycleSearches.length;
  saveRotationOffset(nextOffset >= allSearches.length ? 0 : nextOffset);
  
  log(`This cycle: searches ${offset + 1}–${offset + cycleSearches.length} of ${allSearches.length} (rotating)`);

  // Use our own AA Playwright scraper (NOT seats.aero — non-commercial use only)
  const paramsList = cycleSearches.map(s => s.params);
  let batchResults: Map<string, FlightResult[]>;
  
  // Try fast cookie-replay first (curl_cffi, ~2s per search)
  try {
    log('Trying AA Fast (cookie replay) scraper...');
    batchResults = await searchAAFastBatch(paramsList, 2000);
    // Check if we got any results at all
    let totalResults = 0;
    for (const [, flights] of batchResults) totalResults += flights.length;
    if (totalResults === 0) {
      log('AA Fast returned 0 results, falling back to Camoufox...');
      throw new Error('NO_RESULTS');
    }
    log(`AA Fast succeeded: ${totalResults} total results`);
  } catch (e: any) {
    log(`AA Fast failed (${e.message}), trying Camoufox...`);
    try {
      batchResults = await searchAACamoufoxBatch(paramsList, 30000);
      let camoTotal = 0;
      for (const [, flights] of batchResults) camoTotal += flights.length;
      if (camoTotal === 0) throw new Error('CAMOUFOX_EMPTY');
      log(`Camoufox succeeded: ${camoTotal} total results`);
    } catch (e2: any) {
      log(`Camoufox also failed (${e2.message}), trying Playwright...`);
      try {
        batchResults = await searchAABatch(paramsList, 30000, 15);
      } catch (e3: any) {
        log(`All AA scrapers failed: ${e3.message}`);
        batchResults = new Map();
        for (const p of paramsList) {
          batchResults.set(`${p.origin}-${p.destination}-${p.date}`, []);
        }
      }
    }
  }

  // Run ANA and Singapore scrapers for the same params (with error handling)
  for (const { params } of cycleSearches) {
    const key = `${params.origin}-${params.destination}-${params.date}`;
    const existing = batchResults.get(key) || [];

    // ANA scraper
    try {
      const anaResults = await Promise.race([
        searchANACamoufox(params),
        new Promise<FlightResult[]>((resolve) => setTimeout(() => {
          log(`[ANA] Timed out for ${key}`);
          resolve([]);
        }, 45000)),
      ]);
      if (anaResults.length > 0) {
        log(`[ANA] ${key}: ${anaResults.length} results`);
        existing.push(...anaResults);
      }
    } catch (e: any) {
      log(`[ANA] Error for ${key}: ${e.message}`);
    }

    // Singapore Airlines scraper
    try {
      const sqResult = await Promise.race([
        searchSQCamoufox(params),
        new Promise<FlightResult[]>((resolve) => setTimeout(() => {
          log(`[SQ] Timed out for ${key}`);
          resolve([]);
        }, 180000)),
      ]);
      if (sqResult.length > 0) {
        log(`[SQ] ${key}: ${sqResult.length} results`);
        existing.push(...sqResult);
      }
    } catch (e: any) {
      log(`[SQ] Error for ${key}: ${e.message}`);
    }

    // BA Avios scraper (oneworld partner awards — requires BA_EXEC_CLUB_NUMBER)
    if (process.env.BA_EXEC_CLUB_NUMBER) {
      try {
        const baResults = await Promise.race([
          searchBACamoufox(params),
          new Promise<FlightResult[]>((resolve) => setTimeout(() => {
            log(`[BA] Timed out for ${key}`);
            resolve([]);
          }, 150000)),
        ]);
        if (baResults.length > 0) {
          log(`[BA] ${key}: ${baResults.length} results`);
          existing.push(...baResults);
        }
      } catch (e: any) {
        log(`[BA] Error for ${key}: ${e.message}`);
      }
    }

    batchResults.set(key, existing);
  }

  log(`Memory after searches: ${getRssMB().toFixed(0)}MB RSS`);

  // Build a lookup for the cycle searches
  const searchByKey = new Map(cycleSearches.map(s => [
    `${s.params.origin}-${s.params.destination}-${s.params.date}`,
    s
  ]));

  // Process results
  for (const [key, results] of batchResults) {
    const entry = searchByKey.get(key);
    if (!entry) continue;
    const wantedCabins = signupCabins.get(key) || new Set();
    if (results.length === 0) continue;
    const cabinResults = results.filter(r => wantedCabins.has(r.cabin));

    for (const f of cabinResults) {
      allResults.push(f);
      const fKey = flightKey(f);
      const known = history.knownFlights[fKey];

      if (!known) {
        history.knownFlights[fKey] = { miles: f.pointsRequired || 0, firstSeen: scanTime };
        newFlights.push({ flight: f, signup: entry.signups[0] });
      } else if (f.pointsRequired && f.pointsRequired < known.miles) {
        history.knownFlights[fKey].miles = f.pointsRequired;
        newFlights.push({ flight: f, signup: entry.signups[0] });
      }
    }

    log(`${entry.params.origin}→${entry.params.destination} ${entry.params.date}: ${cabinResults.length} results`);
  }

  // Save
  history.lastScan = scanTime;
  history.scans.push({ scanTime, results: allResults });
  saveHistory(history);

  // Write results to shared web cache
  writeToWebCache(allResults, cycleSearches, signupCabins, scanTime);

  log(`Scan complete: ${allResults.length} total results, ${newFlights.length} new/improved`);

  // Send alerts (dedup + deal quality filter)
  const sentAlerts = loadSentAlerts();
  let alertsSent = 0;
  for (const { flight, signup } of newFlights) {
    if (!isValidFlight(flight)) {
      log(`Skipping invalid flight: ${JSON.stringify({ airline: flight.airline, points: flight.pointsRequired, taxes: flight.taxesAndFees })}`);
      continue;
    }

    // Dedup check
    const aKey = alertKey(flight);
    if (sentAlerts[aKey]) {
      log(`Dedup: already alerted for ${aKey}`);
      continue;
    }

    // Deal quality check
    const deal = isGoodDeal(flight);
    if (!deal.isDeal) {
      log(`Not a deal: ${flight.airline} ${flight.cabin} ${flight.origin}→${flight.destination} ${flight.pointsRequired} miles`);
      continue;
    }

    if (signup.alertMethod === 'whatsapp' && signup.contact) {
      sendWhatsApp(signup.contact, formatAlert(flight, deal.sweetSpot));
      sentAlerts[aKey] = new Date().toISOString();
      alertsSent++;
      await sleep(2000);
    }
  }
  saveSentAlerts(sentAlerts);
  log(`Alerts sent this cycle: ${alertsSent}`);

  log(`Memory after scan: ${getRssMB().toFixed(0)}MB RSS`);
  log('=== Scan finished ===');
}

// Main loop
async function main() {
  log('Flight Monitor Daemon starting (memory-efficient mode)');
  log(`Scan interval: ${SCAN_INTERVAL_MS / 60000} minutes`);
  log(`Max searches per cycle: ${MAX_SEARCHES_PER_CYCLE}`);
  log(`Max RSS threshold: ${MAX_RSS_MB}MB`);
  log(`Initial memory: ${getRssMB().toFixed(0)}MB RSS`);
  log(`PID: ${process.pid}`);

  while (true) {
    try {
      await runScan();
    } catch (e: any) {
      log(`SCAN ERROR: ${e.message}`);
      log(`Stack: ${e.stack?.slice(0, 500)}`);
    }

    // Post-scan memory check
    const rss = getRssMB();
    log(`Post-scan RSS: ${rss.toFixed(0)}MB`);
    if (rss > MAX_RSS_MB) {
      log(`RSS ${rss.toFixed(0)}MB exceeds ${MAX_RSS_MB}MB — forcing GC if available`);
      if (global.gc) global.gc();
    }

    log(`Sleeping ${SCAN_INTERVAL_MS / 60000} minutes until next scan...`);
    await sleep(SCAN_INTERVAL_MS);
  }
}

main();
