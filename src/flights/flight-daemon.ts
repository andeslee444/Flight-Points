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
 * Updated: 2026-06-10 — registry-driven scraping (SCRAPER_REGISTRY) with
 *   DAEMON_SCRAPERS allowlist; replaces hardcoded AA/ANA/SQ/BA chains
 */

import 'dotenv/config';
import { SCRAPER_REGISTRY, deduplicateResults } from './scrapers/index.js';
import { SCRAPER_TIMEOUTS, DEFAULT_SCRAPER_TIMEOUT_MS, ZERO_SUSPECT_THRESHOLD } from './scraper-config.js';
import { generateDates, parseList, isValidFlight } from './daemon-helpers.js';
import { SearchParams, FlightResult } from './types.js';
import { matchSweetSpots } from './sweet-spots.js';
import {
  isTransatlantic as isTransatlanticRoute,
  isToAsia as isToAsiaRoute,
  isInternational as isInternationalRoute,
} from './airports.js';
import { execFileSync } from 'child_process';
import { recordSuccess, recordFailure, recordZero, isScraperAvailable, writeHealthFile, getSuspectScrapers } from './scraper-health.js';
import { recordObservation, checkAnomaly as checkRouteAnomaly } from './monitoring/route-baseline.js';
import { auditCurrent as auditFingerprintCoherence } from './net/fingerprint-coherence.js';
import { SessionPool } from './net/session-pool.js';
import { Singleflight } from './scrapers/singleflight.js';
import { RunHistory, PgRunStore } from './monitoring/run-history.js';
import { makeJobQueue } from './queue/job-queue.js';
import { buildJobs, type ScrapeJob } from './queue/producer.js';
import { runWorkers } from './queue/worker-pool.js';
import { crawlScore } from './scheduling/crawl-score.js';
import { HostConcurrency } from './scheduling/adaptive-cadence.js';
import { getSharedBudget, costPerConfirmedDeal } from './scheduling/cost-budget.js';
import { getPool } from './db.js';

// Per-host session identity + health tracker (proxy/fingerprint binding, retire
// on repeated soft-block). Persists across cycles so health accrues; surfaced
// in the cycle log. (Cookie-reuse round-trip into the Python tiers is the next step.)
const sessionPool = new SessionPool();

// Coalesce identical in-flight scrapes (daemon + on-demand live search hitting the
// same route) so we never double-pay proxy GB or double-trip a block on one call.
const singleflight = new Singleflight();

// Durable per-scraper run ledger (survives restart, unlike the in-memory health
// Map) + per-INDIVIDUAL-scraper rot alert (today only whole-daemon staleness alerts).
const runHistory = new RunHistory(new PgRunStore(getPool));
runHistory.onAlert((a) => log(`🚨 SCRAPER ROT: ${a.scraper} — ${a.runs.length} consecutive unproductive runs (last outcomes: ${a.runs.map(r => r.outcome).join(',')})`));

// Keystone scale path (opt-in): when USE_QUEUE=1, fan scrapes out through a job
// queue with crawl-score priority + bounded worker concurrency instead of the
// per-scraper serial loop. Default off → the proven production loop is unchanged.
const USE_QUEUE = process.env.USE_QUEUE === '1';
const QUEUE_CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY || '8', 10);

// Adaptive cadence (opt-in: ADAPTIVE_CADENCE=1). A fleet-level AIMD controller
// over worker concurrency in the queue path: a cycle where hosts pushed back
// (blocks > successes) multiplicatively halves the pool; a clean cycle additively
// climbs it back toward QUEUE_CONCURRENCY. Default off → fixed QUEUE_CONCURRENCY.
const ADAPTIVE_CADENCE = process.env.ADAPTIVE_CADENCE === '1';
const fleetConcurrency = new HostConcurrency({ min: 2, max: QUEUE_CONCURRENCY, start: QUEUE_CONCURRENCY });
import { checkAlerts } from './alert-checker.js';
import { writeHistoryBatch } from './history-writer.js';
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

// ── Registry-driven scraper selection ──

/**
 * Resolve which SCRAPER_REGISTRY entries the daemon should run this cycle.
 * - Skips status==='blocked' entries (mirrors live-scraper.ts)
 * - Skips cash-price-only entries (Google Flights — not award results)
 * - Honors the optional DAEMON_SCRAPERS allowlist (comma-separated registry
 *   keys; empty/unset = all non-blocked entries)
 */
function getDaemonScraperKeys(): string[] {
  const allowlist = (process.env.DAEMON_SCRAPERS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const unknown = allowlist.filter(k => !SCRAPER_REGISTRY[k]);
  if (unknown.length > 0) {
    log(`DAEMON_SCRAPERS contains unknown registry keys (ignored): ${unknown.join(', ')}`);
  }

  const keys: string[] = [];
  for (const [key, entry] of Object.entries(SCRAPER_REGISTRY)) {
    if (entry.status === 'blocked') continue;
    if (entry.covers.includes('cash-prices')) continue; // Google Flights — cash only
    if (allowlist.length > 0 && !allowlist.includes(key)) continue;
    keys.push(key);
  }
  return keys;
}

async function runScan() {
  log('=== Starting scan ===');
  log(`Memory: ${getRssMB().toFixed(0)}MB RSS`);

  // Generate cycleId once — shared across all writeHistoryBatch calls in this cycle
  const cycleId = new Date().toISOString();

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

  // Run registry scrapers over this cycle's searches (own scrapers only —
  // NOT seats.aero, non-commercial use only). Mirrors live-scraper.ts:
  // skip blocked entries, respect the circuit breaker, run each entry's
  // fallback chain. Scrapers run in parallel; each scraper works through
  // the cycle's searches sequentially.
  const paramsList = cycleSearches.map(s => s.params);
  const batchResults = new Map<string, FlightResult[]>();
  for (const p of paramsList) {
    batchResults.set(`${p.origin}-${p.destination}-${p.date}`, []);
  }

  // Flights from calendar/estimated scrapers — excluded from price_history
  // (history-writer only accepts confirmed availability).
  const nonConfirmedFlights = new Set<FlightResult>();

  const scraperKeys = getDaemonScraperKeys();
  log(`Registry scrapers this cycle: ${scraperKeys.join(', ') || '(none)'}`);

  // Per-scraper cycle counters, shared by both the legacy loop and the queue path.
  const perScraper = new Map<string, { got: number; errored: number; ran: number }>();
  const bump = (k: string, field: 'got' | 'errored' | 'ran', n = 1) => {
    const c = perScraper.get(k) || { got: 0, errored: 0, ran: 0 };
    c[field] += n;
    perScraper.set(k, c);
  };

  // Run ONE (scraper, params) search: singleflight-coalesced + timed out; results →
  // batchResults + health + soft-block baseline + durable run ledger. Shared so the
  // legacy serial loop and the queue path behave identically per search.
  const runSearch = async (scraperKey: string, params: SearchParams): Promise<void> => {
    const entry = SCRAPER_REGISTRY[scraperKey];
    const timeoutMs = SCRAPER_TIMEOUTS[scraperKey] ?? DEFAULT_SCRAPER_TIMEOUT_MS;
    const key = `${params.origin}-${params.destination}-${params.date}`;
    bump(scraperKey, 'ran');
    try {
      const flights = await singleflight.run(
        `${scraperKey}:${key}`,
        () => withTimeout(entry.search(params), timeoutMs, scraperKey),
      );
      if (flights.length > 0) {
        log(`[${scraperKey}] ${key}: ${flights.length} results`);
        batchResults.get(key)!.push(...flights);
        if (entry.availabilityType !== 'confirmed') {
          for (const f of flights) nonConfirmedFlights.add(f);
        }
        bump(scraperKey, 'got', flights.length);
        recordSuccess(scraperKey);
        const obs = {
          count: flights.length,
          sampleMiles: flights.map(f => f.pointsRequired || 0).filter(m => m > 0).slice(0, 20),
        };
        const anomaly = checkRouteAnomaly(scraperKey, key, obs);
        if (anomaly.anomaly) {
          log(`[${scraperKey}] ⚠️ SOFT-BLOCK suspected on ${key}: ${anomaly.reasons.join('; ')}`);
        }
        recordObservation(scraperKey, key, obs);
        runHistory.recordRun({ scraper: scraperKey, route: key, outcome: 'ok', count: flights.length }).catch(() => {});
      } else {
        runHistory.recordRun({ scraper: scraperKey, route: key, outcome: 'empty', count: 0 }).catch(() => {});
      }
    } catch (e: any) {
      log(`[${scraperKey}] Error for ${key}: ${e?.message || e}`);
      bump(scraperKey, 'errored');
      recordFailure(scraperKey);
      runHistory.recordRun({ scraper: scraperKey, route: key, outcome: 'error', count: 0 }).catch(() => {});
    }
  };

  // After a scraper's searches: session health, silent-zero flag, durable rot check.
  const finalizeScraper = async (scraperKey: string): Promise<void> => {
    const c = perScraper.get(scraperKey) || { got: 0, errored: 0, ran: 0 };
    const session = sessionPool.acquire(scraperKey);
    if (c.got > 0) sessionPool.markSuccess(session);
    else if (c.errored > 0) sessionPool.markBlocked(session);
    if (c.ran > 0 && c.got === 0 && c.errored === 0) {
      const newlySuspect = recordZero(scraperKey);
      log(`[${scraperKey}] 0 results across ${c.ran} searches this cycle (clean zero)`);
      if (newlySuspect) {
        log(`[${scraperKey}] ⚠️ SUSPECT — returned 0 results for ${ZERO_SUSPECT_THRESHOLD}+ consecutive cycles; likely soft-blocked, DOM-drifted, or session expired`);
      }
    }
    await runHistory.detectScraperRot(scraperKey).catch(() => {});
  };

  if (USE_QUEUE) {
    // Keystone scale path: fan ALL (scraper × search) work out through a priority
    // queue with bounded worker concurrency, instead of ~one-task-per-scraper.
    const specs = scraperKeys.flatMap(sk => paramsList.map(p => ({ scraperKey: sk, params: p })));
    const jobs = buildJobs(specs, (s) => Math.round(crawlScore({
      // Cheap signal available here: how many signups watch this route (demand).
      userDemand: Math.min(1, (signupCabins.get(`${s.params.origin}-${s.params.destination}-${s.params.date}`)?.size || 0) / 3),
      milesVolatility: 0.5,
      dealLikelihood: 0.5,
      stalenessHours: 0,
    }) * 1000));
    const queue = makeJobQueue<ScrapeJob>('daemon-scrape');
    for (const j of jobs) await queue.add(j, { priority: j.priority, dedupeKey: j.dedupeKey });
    const effectiveConcurrency = ADAPTIVE_CADENCE ? fleetConcurrency.current() : QUEUE_CONCURRENCY;
    log(`[queue] enqueued ${jobs.length} jobs @ concurrency ${effectiveConcurrency}${ADAPTIVE_CADENCE ? ` (adaptive, max ${QUEUE_CONCURRENCY})` : ''}`);
    await runWorkers(queue, effectiveConcurrency, async (job) => {
      if (shuttingDown || !isScraperAvailable(job.scraperKey)) return;
      await runSearch(job.scraperKey, { origin: job.origin, destination: job.destination, date: job.date, cabin: job.cabin });
    });
    await queue.drain();
    for (const sk of scraperKeys) await finalizeScraper(sk);
  } else {
    // Legacy path (default): each scraper runs in parallel, its searches serial.
    const scraperTasks = scraperKeys.map(async (scraperKey) => {
      if (!isScraperAvailable(scraperKey)) {
        log(`[${scraperKey}] Circuit breaker open — skipping this cycle`);
        return;
      }
      for (const params of paramsList) {
        if (shuttingDown) break;
        if (!isScraperAvailable(scraperKey)) {
          log(`[${scraperKey}] Circuit breaker opened mid-cycle — stopping`);
          break;
        }
        await runSearch(scraperKey, params);
      }
      await finalizeScraper(scraperKey);
    });
    await Promise.allSettled(scraperTasks);
  }

  // Surface any scrapers stuck at clean-zero — the silent-block signal that
  // (one level up) caused the 4-month outage. The staleness watchdog / canary
  // can escalate; here we make it loud in the daemon log every cycle.
  const suspects = getSuspectScrapers();
  if (suspects.length > 0) {
    log(`⚠️ Suspect scrapers (stuck returning 0): ${suspects.join(', ')} — verify they aren't silently blocked`);
  }
  const poolStats = sessionPool.stats();
  log(`Session pool: ${poolStats.totalSessions} live across ${poolStats.hosts} hosts (${poolStats.created} created, ${poolStats.retired} retired)`);

  // Adaptive cadence AIMD feedback: a cycle where more scrapers were blocked
  // than productive halves next cycle's worker pool; a healthy cycle climbs it
  // back. Reading-only outside the queue path, so it's a no-op cost when off.
  if (ADAPTIVE_CADENCE) {
    let blocked = 0, productive = 0;
    for (const [, c] of perScraper) {
      if (c.got > 0) productive++;
      else if (c.errored > 0) blocked++;
    }
    if (blocked > productive) fleetConcurrency.onBlock();
    else fleetConcurrency.onSuccess();
    log(`[adaptive-cadence] fleet=${blocked > productive ? 'BLOCK ↓' : 'OK ↑'} (blocked ${blocked} / productive ${productive}) → next concurrency ${fleetConcurrency.current()}`);
  }

  // Cost-budget accounting: when a budget is active, report spend + efficiency.
  const budget = getSharedBudget();
  if (budget) {
    const dealsThisCycle = [...batchResults.values()].reduce((n, rs) => n + rs.filter(f => isGoodDeal(f).isDeal).length, 0);
    log(`[cost-budget] spent $${budget.spent().toFixed(2)} / $${budget.ceiling().toFixed(2)} ceiling (remaining $${budget.remaining().toFixed(2)})${budget.isExhausted() ? ' — EXHAUSTED, premium tiers degraded' : ''}; $/deal=${costPerConfirmedDeal(budget.spent(), dealsThisCycle).toFixed(3)}`);
  }

  // Deduplicate overlap across scrapers covering the same alliance
  for (const [key, results] of batchResults) {
    if (results.length > 1) batchResults.set(key, deduplicateResults(results));
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

  // Write confirmed results to price_history for time-series charts.
  // Calendar/estimated scraper results are excluded (history-writer gate).
  // Best-effort: history write failure must never crash the daemon
  try {
    const confirmedResults = nonConfirmedFlights.size > 0
      ? allResults.filter(f => !nonConfirmedFlights.has(f))
      : allResults;
    const historyCount = await writeHistoryBatch(confirmedResults, 'daemon', 'confirmed', cycleId);
    if (confirmedResults.length > 0 && historyCount === 0) {
      log('[daemon] Warning: confirmed scraper returned 0 valid history rows (possible session expiry)');
    }
  } catch (err: any) {
    log(`[daemon] History write failed (non-fatal): ${err.message}`);
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

  // Check alert subscriptions against fresh cycle results (Phase 1: logs matches only)
  try {
    await checkAlerts(allResults, scanTime);
  } catch (err: any) {
    log(`[daemon] Alert checker failed (non-fatal): ${err.message}`);
  }

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
  log(`Scraper allowlist (DAEMON_SCRAPERS): ${process.env.DAEMON_SCRAPERS || '(unset — all non-blocked registry entries)'}`);
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

  // Crash visibility: before this, an unhandled rejection/exception killed the
  // process with no record — the literal mechanism behind the 4-month silent
  // outage. Record status=crashed (so the staleness watchdog and /status see it)
  // then exit non-zero so launchd restarts us with a clean slate.
  const onFatal = (kind: string) => (err: unknown) => {
    const e = err as Error;
    log(`FATAL ${kind}: ${e?.stack || e?.message || String(err)}`);
    dbWriteDaemonStatus({
      pid: process.pid,
      status: `crashed:${kind}`,
      signal: kind,
    })
      .catch(() => {})
      .finally(() => process.exit(1));
    // Hard backstop if the status write hangs.
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('uncaughtException', onFatal('uncaughtException'));
  process.on('unhandledRejection', onFatal('unhandledRejection'));

  log('Signal handlers registered (SIGTERM, SIGINT, uncaughtException, unhandledRejection)');

  // Audit stealth-config coherence at boot: a TLS fingerprint that doesn't match
  // the UA, or a locale that doesn't match the proxy geo, is itself a detection
  // signal. Log a warning so config drift is visible (non-fatal).
  const coherence = auditFingerprintCoherence();
  if (!coherence.coherent) {
    log(`⚠️ Fingerprint/proxy incoherence: ${coherence.issues.join('; ')} — these mismatches are themselves a bot signal`);
  } else {
    log('Fingerprint/proxy coherence: OK');
  }

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
