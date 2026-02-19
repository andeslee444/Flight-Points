/**
 * Flight Monitor Daemon
 * Continuously scrapes award flights for signups every 30 minutes.
 *
 * Memory-efficient: rotates through searches across cycles (max ~25 per cycle),
 * monitors RSS, and gracefully handles OOM conditions.
 *
 * Started: 2026-02-16
 * Updated: 2026-02-17 — shared airports, sweet-spots integration, parallel scrapers,
 *   graceful shutdown, health metrics, configurable date sampling, atomic writes
 * Updated: 2026-02-18 — migrated all data storage from JSON files to PostgreSQL
 */

import 'dotenv/config';
import { searchAABatch } from './scrapers/aa.js';
import { searchAACamoufoxBatch } from './scrapers/aa-camoufox.js';
import { searchAAFastBatch } from './scrapers/aa-fast.js';
import { searchANACamoufox } from './scrapers/ana-camoufox.js';
import { searchBACamoufox } from './scrapers/ba-camoufox.js';
import { searchSQCamoufox } from './scrapers/sq-camoufox.js';
import { SearchParams, FlightResult } from './types.js';
import { matchSweetSpots } from './sweet-spots.js';
import {
  isTransatlantic as isTransatlanticRoute,
  isToAsia as isToAsiaRoute,
  isInternational as isInternationalRoute,
} from './airports.js';
import { execFileSync } from 'child_process';
import { recordSuccess, recordFailure, isScraperAvailable, writeHealthFile } from './scraper-health.js';
import {
  initPool, closePool,
  loadSignups as dbLoadSignups,
  loadSentAlerts as dbLoadSentAlerts,
  markAlertSent,
  pruneSentAlerts,
  getKnownFlight,
  upsertKnownFlight,
  pruneKnownFlights,
  loadRotationOffset as dbLoadRotationOffset,
  saveRotationOffset as dbSaveRotationOffset,
  addScan,
  pruneScans,
  upsertCacheEntries,
  pruneStaleCacheEntries,
  writeDaemonStatus as dbWriteDaemonStatus,
} from './db.js';

const SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SEARCHES_PER_CYCLE = 25;
const MAX_RSS_MB = 450; // restart browser well before 500MB
const DATE_SAMPLING_DAYS = parseInt(process.env.DATE_SAMPLING_DAYS || '14', 10);

// ── Graceful shutdown ──
let shuttingDown = false;

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function interruptibleSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const interval = 1000; // check every second
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += interval;
      if (shuttingDown || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, interval);
  });
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
  dateSamplingDays?: number;
}

// ── Deal quality filter (sweet-spots integrated) ──

interface DealCheck { isDeal: boolean; sweetSpot?: string }

function isGoodDeal(f: FlightResult): DealCheck {
  const miles = f.pointsRequired;
  const taxes = f.taxesAndFees;

  // Must have real data
  if (!miles || !Number.isFinite(miles) || miles <= 0) return { isDeal: false };
  if (taxes == null || !Number.isFinite(taxes) || taxes < 0) return { isDeal: false };
  if (taxes >= 500) return { isDeal: false };

  // Check sweet spots database first (1.2x threshold margin)
  const spots = matchSweetSpots(f.origin, f.destination, f.cabin);
  for (const spot of spots) {
    if (miles <= spot.pointsRequired * 1.2) {
      return { isDeal: true, sweetSpot: `${spot.product} (${spot.tier}-tier)` };
    }
  }

  // Fallback generic thresholds for routes not in sweet spots
  if (f.cabin === 'business') {
    if (isTransatlanticRoute(f.origin, f.destination) && miles <= 60000)
      return { isDeal: true, sweetSpot: `${f.airline} Transatlantic Business` };
    if (isToAsiaRoute(f.origin, f.destination) && miles <= 75000)
      return { isDeal: true, sweetSpot: `${f.airline} Business to Asia` };
    return { isDeal: false };
  }

  if (f.cabin === 'first') {
    if (isToAsiaRoute(f.origin, f.destination) && miles <= 120000)
      return { isDeal: true, sweetSpot: `${f.airline} First Class to Asia` };
    if (isTransatlanticRoute(f.origin, f.destination) && miles <= 90000)
      return { isDeal: true, sweetSpot: `${f.airline} First Class Transatlantic` };
    return { isDeal: false };
  }

  if (f.cabin === 'economy') {
    if (isInternationalRoute(f.origin, f.destination) && miles <= 30000)
      return { isDeal: true, sweetSpot: `${f.airline} Economy Deal` };
    return { isDeal: false };
  }

  return { isDeal: false };
}

function alertKey(f: FlightResult): string {
  return `${f.airline}-${f.origin}-${f.destination}-${f.departureDate}-${f.flightNumber}-${f.cabin}`;
}

function generateDates(startDate?: string, endDate?: string, samplingDays?: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  const start = startDate ? new Date(startDate) : new Date(now.getTime() + 7 * 86400000);
  const end = endDate ? new Date(endDate) : new Date(now.getTime() + 90 * 86400000);
  const step = samplingDays || DATE_SAMPLING_DAYS;

  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + step);
  }
  return dates;
}

function parseList(s: string): string[] {
  return s.split(/[,;]\s*/).map(x => x.trim()).filter(Boolean);
}

function isValidFlight(f: FlightResult): boolean {
  if (!f.airline || f.airline.trim() === '' || f.airline === 'N/A' || f.airline === 'Unknown') return false;
  if (!f.pointsRequired || !Number.isFinite(f.pointsRequired) || f.pointsRequired <= 0) return false;
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
    execFileSync('openclaw', [
      'message', 'send',
      '--channel', 'whatsapp',
      '--target', contact,
      '--message', message,
    ], { timeout: 30000 });
    log('Alert sent successfully');
  } catch (e: any) {
    log(`Failed to send WhatsApp: ${e.message}`);
  }
}

function flightKey(f: FlightResult): string {
  return `${f.flightNumber}|${f.origin}-${f.destination}|${f.departureDate}|${f.cabin}`;
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

    const dates = generateDates(signup.startDate, signup.endDate, signup.dateSamplingDays);

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

// ── Health/metrics ──
const daemonStartTime = new Date().toISOString();

// ── Parallel scraper helper with timeout ──
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => {
      log(`[${label}] Timed out after ${ms}ms`);
      reject(new Error(`${label} timeout`));
    }, ms)),
  ]);
}

async function runScan() {
  log('=== Starting scan ===');
  log(`Memory: ${getRssMB().toFixed(0)}MB RSS`);

  // Load signups from DB (map DB rows to Signup interface)
  const signupRows = await dbLoadSignups();
  const signups: Signup[] = signupRows.map(row => ({
    from: row.from,
    to: row.to,
    class: row.class,
    contact: row.contact || '',
    alertMethod: row.alert_method || '',
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
    dateSamplingDays: row.date_sampling_days || undefined,
  }));

  const scanTime = new Date().toISOString();
  const allResults: FlightResult[] = [];
  const newFlights: Array<{ flight: FlightResult; signup: Signup }> = [];

  // Build all possible searches
  const { searches: allSearches, signupCabins } = buildAllSearches(signups);
  log(`Total unique searches: ${allSearches.length}`);

  // Rotate: pick a slice of MAX_SEARCHES_PER_CYCLE
  let offset = await dbLoadRotationOffset();
  if (offset >= allSearches.length) offset = 0;

  const cycleSearches = allSearches.slice(offset, offset + MAX_SEARCHES_PER_CYCLE);
  const nextOffset = offset + cycleSearches.length;
  await dbSaveRotationOffset(nextOffset >= allSearches.length ? 0 : nextOffset);

  log(`This cycle: searches ${offset + 1}–${offset + cycleSearches.length} of ${allSearches.length} (rotating)`);

  // Use our own AA Playwright scraper (NOT seats.aero — non-commercial use only)
  const paramsList = cycleSearches.map(s => s.params);
  let batchResults: Map<string, FlightResult[]>;

  // Try fast cookie-replay first (curl_cffi, ~2s per search)
  try {
    log('Trying AA Fast (cookie replay) scraper...');
    batchResults = await searchAAFastBatch(paramsList, 2000);
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

  // Run ANA, SQ, BA scrapers in parallel per route (keep routes sequential)
  for (const { params } of cycleSearches) {
    if (shuttingDown) break;

    const key = `${params.origin}-${params.destination}-${params.date}`;
    const existing = batchResults.get(key) || [];

    // Build scraper promises for this route (circuit breaker gated)
    const scraperPromises: Array<{ label: string; promise: Promise<FlightResult[]> }> = [];

    if (isScraperAvailable('ana')) {
      scraperPromises.push({ label: 'ANA', promise: withTimeout(searchANACamoufox(params), 45000, 'ANA') });
    } else {
      log(`[ANA] Circuit breaker open — skipping`);
    }

    if (isScraperAvailable('singapore')) {
      scraperPromises.push({ label: 'SQ', promise: withTimeout(searchSQCamoufox(params), 180000, 'SQ') });
    } else {
      log(`[SQ] Circuit breaker open — skipping`);
    }

    if (process.env.BA_EXEC_CLUB_NUMBER && isScraperAvailable('ba-avios')) {
      scraperPromises.push({ label: 'BA', promise: withTimeout(searchBACamoufox(params), 150000, 'BA') });
    } else if (process.env.BA_EXEC_CLUB_NUMBER) {
      log(`[BA] Circuit breaker open — skipping`);
    }

    // Run all scrapers for this route in parallel
    const results = await Promise.allSettled(
      scraperPromises.map(s => s.promise)
    );

    const scraperKeyMap: Record<string, string> = { 'ANA': 'ana', 'SQ': 'singapore', 'BA': 'ba-avios' };
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const label = scraperPromises[i].label;
      const scraperKey = scraperKeyMap[label] || label.toLowerCase();
      if (result.status === 'fulfilled' && result.value.length > 0) {
        log(`[${label}] ${key}: ${result.value.length} results`);
        existing.push(...result.value);
        recordSuccess(scraperKey);
      } else if (result.status === 'fulfilled') {
        // 0 results — not a failure, but not a success either
      } else {
        log(`[${label}] Error for ${key}: ${result.reason?.message || result.reason}`);
        recordFailure(scraperKey);
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

  // Process results — check known flights via DB
  for (const [key, results] of batchResults) {
    const entry = searchByKey.get(key);
    if (!entry) continue;
    const wantedCabins = signupCabins.get(key) || new Set();
    if (results.length === 0) continue;
    const cabinResults = results.filter(r => wantedCabins.has(r.cabin));

    for (const f of cabinResults) {
      allResults.push(f);
      const fKey = flightKey(f);
      const known = await getKnownFlight(fKey);

      if (!known) {
        await upsertKnownFlight(fKey, f.pointsRequired || 0, scanTime);
        newFlights.push({ flight: f, signup: entry.signups[0] });
      } else if (f.pointsRequired && f.pointsRequired < known.miles) {
        await upsertKnownFlight(fKey, f.pointsRequired, known.first_seen);
        newFlights.push({ flight: f, signup: entry.signups[0] });
      }
    }

    log(`${entry.params.origin}→${entry.params.destination} ${entry.params.date}: ${cabinResults.length} results`);
  }

  // Save scan to DB
  await addScan(scanTime, allResults);
  await pruneScans(48);
  await pruneKnownFlights(30);

  // Write results to flight cache
  await writeToWebCache(allResults, cycleSearches, signupCabins, scanTime);

  // Prune stale cache entries (24 hours)
  await pruneStaleCacheEntries(24 * 60 * 60 * 1000);

  log(`Scan complete: ${allResults.length} total results, ${newFlights.length} new/improved`);

  // Send alerts (dedup + deal quality filter)
  const sentAlerts = await dbLoadSentAlerts();
  let alertsSent = 0;
  for (const { flight, signup } of newFlights) {
    if (shuttingDown) break;

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
      await markAlertSent(aKey);
      sentAlerts[aKey] = new Date().toISOString(); // update local cache too
      alertsSent++;
      await interruptibleSleep(2000);
    }
  }

  // Prune old sent alerts (90 days)
  await pruneSentAlerts(90);

  log(`Alerts sent this cycle: ${alertsSent}`);

  // Write health metrics
  await dbWriteDaemonStatus({
    pid: process.pid,
    rssMB: Math.round(getRssMB()),
    startedAt: daemonStartTime,
    lastScanTime: scanTime,
    resultsCount: allResults.length,
    alertsCount: alertsSent,
    nextScanTime: new Date(Date.now() + SCAN_INTERVAL_MS).toISOString(),
  });

  // Write scraper health to DB
  writeHealthFile();

  log(`Memory after scan: ${getRssMB().toFixed(0)}MB RSS`);
  log('=== Scan finished ===');
}

async function writeToWebCache(
  results: FlightResult[],
  searches: Array<{ params: SearchParams; signups: Signup[] }>,
  signupCabins: Map<string, Set<string>>,
  scanTime: string,
) {
  try {
    const entries: Array<{
      route_key: string;
      origin: string;
      destination: string;
      date: string;
      cabin: string;
      award_flights: any[];
    }> = [];

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

        entries.push({
          route_key: cacheKey,
          origin: params.origin,
          destination: params.destination,
          date: params.date,
          cabin,
          award_flights: awardFlights,
        });
      }
    }

    await upsertCacheEntries(entries);
    log(`Web cache updated: ${entries.length} entries`);
  } catch (e: any) {
    log(`Failed to write web cache: ${e.message}`);
  }
}

// Main loop
async function main() {
  log('Flight Monitor Daemon starting (memory-efficient mode)');
  log(`Scan interval: ${SCAN_INTERVAL_MS / 60000} minutes`);
  log(`Max searches per cycle: ${MAX_SEARCHES_PER_CYCLE}`);
  log(`Max RSS threshold: ${MAX_RSS_MB}MB`);
  log(`Date sampling: every ${DATE_SAMPLING_DAYS} days`);
  log(`Initial memory: ${getRssMB().toFixed(0)}MB RSS`);
  log(`PID: ${process.pid}`);

  // Initialize database connection pool
  initPool();
  log('Database pool initialized');

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // prevent double handling
    shuttingDown = true;
    log(`Received ${signal} — shutting down gracefully...`);
    await dbWriteDaemonStatus({
      pid: process.pid,
      rssMB: Math.round(getRssMB()),
      startedAt: daemonStartTime,
      status: 'shutting_down',
      signal,
    });
    // Close database pool
    await closePool();
    log('Database pool closed');
    // Give in-flight work a moment to finish, then exit
    setTimeout(() => {
      log('Shutdown complete.');
      process.exit(0);
    }, 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  log('Signal handlers registered (SIGTERM, SIGINT)');

  await dbWriteDaemonStatus({
    pid: process.pid,
    rssMB: Math.round(getRssMB()),
    startedAt: daemonStartTime,
    status: 'starting',
  });

  while (!shuttingDown) {
    try {
      await runScan();
    } catch (e: any) {
      log(`SCAN ERROR: ${e.message}`);
      log(`Stack: ${e.stack?.slice(0, 500)}`);
    }

    if (shuttingDown) break;

    // Post-scan memory check
    const rss = getRssMB();
    log(`Post-scan RSS: ${rss.toFixed(0)}MB`);
    if (rss > MAX_RSS_MB) {
      log(`RSS ${rss.toFixed(0)}MB exceeds ${MAX_RSS_MB}MB — forcing GC if available`);
      if (global.gc) global.gc();
    }

    log(`Sleeping ${SCAN_INTERVAL_MS / 60000} minutes until next scan...`);
    await interruptibleSleep(SCAN_INTERVAL_MS);
  }

  log('Daemon exiting.');
}

main();
