/**
 * Harbor Flights — Self-Contained Web Server
 *
 * Serves the frontend pages and provides API endpoints that read
 * from the daemon's flight-cache.json. Also supports live on-demand
 * scraping via SSE when the cache has no results for a route.
 *
 * Usage:  npm run dev   (or)  npm run serve
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import {
  POINTS_PROGRAMS,
  getTransferPartnersForProgram,
  type TransferPartner,
} from './transfer-partners.js';
import {
  cabinDisplayName,
  computeDealRating,
  findPartnerForSource,
  estimateCashPrice,
  getBookingUrl,
} from './monitor.js';
import { atomicWriteFile } from './utils.js';
import { getSweetSpotsByTier, getSweetSpotsForProgram, SWEET_SPOTS } from './sweet-spots.js';
import { runLiveScrape, canStartLiveScrape } from './live-scraper.js';
import type { FlightResult } from './types.js';

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CACHE_FILE = process.env.WEB_CACHE_PATH || path.join(DATA_DIR, 'flight-cache.json');
const SIGNUPS_FILE = path.join(DATA_DIR, 'flight-signups.json');
const PUBLIC_DIR = path.join(__dirname, '../../web/public');

// ── Shared enrichment helper ─────────────────────────────────

function enrichFlightResult(
  f: any,
  programSlug: string,
  partners: TransferPartner[],
  programName: string,
): any {
  const partner = findPartnerForSource(f.source, f.pointsProgram, partners);
  const ratio = partner?.ratio || 1;
  const pointsNeeded = Math.ceil(f.pointsRequired * ratio);
  const transferTarget = partner?.program || f.pointsProgram || f.source;

  const transferPath = partner
    ? `Transfer ${pointsNeeded.toLocaleString()} ${programName} \u2192 ${transferTarget}`
    : `Book via ${f.pointsProgram || f.source} (${f.pointsRequired.toLocaleString()} miles)`;

  const cashPrice = estimateCashPrice(f.origin, f.destination, f.cabin);
  const cppVal = cashPrice
    ? ((cashPrice * 100 - (f.taxes || 0) * 100) / f.pointsRequired)
    : undefined;
  const cpp = cppVal ? Math.round(cppVal * 10) / 10 : undefined;

  const bookingUrl = getBookingUrl(
    partner?.programCode || f.source,
    f.origin,
    f.destination,
    f.departureDate,
  );

  return {
    airline: f.airline,
    flightNumber: f.flightNumber,
    origin: f.origin,
    destination: f.destination,
    departureDate: f.departureDate,
    departureTime: f.departureTime,
    arrivalTime: f.arrivalTime,
    duration: f.duration,
    stops: f.stops,
    cabin: f.cabin,
    pointsRequired: f.pointsRequired,
    pointsProgram: f.pointsProgram,
    taxes: f.taxes || 0,
    awardType: f.awardType,
    source: f.source,
    bookingUrl,
    points: pointsNeeded,
    cabinDisplay: cabinDisplayName(f.cabin),
    program: partner?.programCode || f.source,
    programDisplay: transferTarget,
    transferPath,
    cashPrice,
    cpp,
    dealRating: computeDealRating(cppVal),
    direct: f.stops === 0,
    route: `${f.origin} \u2192 ${f.destination}`,
  };
}

// ── Static files ────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR));

// ── Root redirect ───────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/flights'));

// ── Clean URL routes ────────────────────────────────────────
const PAGE_MAP: Record<string, string> = {
  '/flights': 'flights.html',
  '/flight-results': 'flight-results.html',
};

for (const [route, file] of Object.entries(PAGE_MAP)) {
  app.get(route, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}

// ── GET /api/flights/search ─────────────────────────────────
app.get('/api/flights/search', (req, res) => {
  const fromRaw = (req.query.from as string) || '';
  const toRaw = (req.query.to as string) || '';
  const cabinRaw = (req.query.class as string) || 'any';
  const programSlug = (req.query.program as string) || 'amex-mr';

  const origins = fromRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const dests = toRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  if (origins.length === 0 || dests.length === 0) {
    return res.status(400).json({ error: 'Missing from/to parameters' });
  }

  // Normalize cabin
  const cabinMap: Record<string, string> = {
    business: 'business', first: 'first', economy: 'economy',
    'Business': 'business', 'First': 'first', 'Economy': 'economy',
    'Either': 'any', 'any': 'any',
  };
  const cabin = cabinMap[cabinRaw] || 'business';

  // Read daemon cache
  let cache: { version?: number; entries: Record<string, any>; lastUpdated?: string } = { entries: {} };
  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch {
    // cache unreadable — proceed with empty
  }

  // Collect matching cache entries
  const rawFlights: any[] = [];
  for (const [key, entry] of Object.entries(cache.entries)) {
    // Key format: ORIGIN-DEST-YYYY-MM-DD-cabin
    const parts = key.split('-');
    if (parts.length < 6) continue;
    const entryOrigin = parts[0];
    const entryDest = parts[1];
    // date is parts[2]-parts[3]-parts[4], cabin is parts[5]
    const entryCabin = parts[5];

    const matchOrigin = origins.includes(entryOrigin);
    const matchDest = dests.includes(entryDest);
    const matchCabin = cabin === 'any' || entryCabin === cabin;

    if (matchOrigin && matchDest && matchCabin) {
      for (const f of (entry.awardFlights || [])) {
        rawFlights.push(f);
      }
    }
  }

  // Enrich flights based on user's credit card program
  const partners = getTransferPartnersForProgram(programSlug);
  const programName = POINTS_PROGRAMS.find(p => p.slug === programSlug)?.name || programSlug;

  const enriched = rawFlights
    .filter(f => f.pointsRequired && f.pointsRequired > 0)
    .map(f => enrichFlightResult(f, programSlug, partners, programName));

  // Sort by CPP descending (best deals first)
  enriched.sort((a, b) => (b.cpp || 0) - (a.cpp || 0));

  res.json({
    results: enriched,
    awardFlights: { count: enriched.length, results: enriched },
    cashFlights: { count: 0, results: [] },
    source: 'daemon-cache',
    lastUpdated: cache.lastUpdated || null,
    from: origins.join(', '),
    to: dests.join(', '),
    cabin: cabin === 'any' ? 'Any' : cabinDisplayName(cabin),
  });
});

// ── POST /api/flights/signup ────────────────────────────────
app.post('/api/flights/signup', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // Route signups need from/to/class/contact; early-access signups need type=signup
  if (body.type === 'route') {
    if (!body.from || !body.to || !body.class || !body.contact) {
      return res.status(400).json({ error: 'Missing required fields: from, to, class, contact' });
    }
  }

  const entry = { ...body, timestamp: new Date().toISOString() };

  // Read existing signups
  let signups: any[] = [];
  try {
    if (fs.existsSync(SIGNUPS_FILE)) {
      signups = JSON.parse(fs.readFileSync(SIGNUPS_FILE, 'utf-8'));
    }
  } catch {
    signups = [];
  }

  signups.push(entry);

  // Ensure data directory exists
  const dir = path.dirname(SIGNUPS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await atomicWriteFile(SIGNUPS_FILE, JSON.stringify(signups, null, 2));
  res.json({ ok: true });
});

// ── GET /api/flights/sweet-spots ─────────────────────────────
app.get('/api/flights/sweet-spots', (req, res) => {
  const tier = req.query.tier as string | undefined;
  const program = req.query.program as string | undefined;

  let spots = tier
    ? getSweetSpotsByTier(tier as 'S' | 'A' | 'B')
    : getSweetSpotsByTier();

  if (program) {
    const programSpots = getSweetSpotsForProgram(program);
    const programIds = new Set(programSpots.map(s => s.id));
    spots = spots.filter(s => programIds.has(s.id));
  }

  res.json({
    sweetSpots: spots.map(s => ({
      id: s.id,
      tier: s.tier,
      cabin: s.cabin,
      product: s.product,
      operatingAirline: s.operatingAirline,
      pointsRequired: s.pointsRequired,
      centsPerPoint: s.centsPerPoint,
      transferFrom: s.transferFrom,
      note: s.note,
      bookingProgram: s.bookingProgram,
      route: s.route,
      originRegion: s.originRegion,
      destinationRegion: s.destinationRegion,
    })),
  });
});

// ── GET /api/flights/programs ───────────────────────────────
app.get('/api/flights/programs', (_req, res) => {
  res.json({
    programs: POINTS_PROGRAMS.map(p => ({
      name: p.name,
      slug: p.slug,
      partnerCount: p.partners.length,
    })),
  });
});

// ── GET /api/flights/routes ─────────────────────────────────
app.get('/api/flights/routes', (_req, res) => {
  let cache: { version?: number; entries: Record<string, any>; lastUpdated?: string } = { entries: {} };
  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }

  const routes = Object.entries(cache.entries).map(([key, entry]) => {
    const parts = key.split('-');
    if (parts.length < 6) return null;
    return {
      origin: parts[0],
      destination: parts[1],
      date: `${parts[2]}-${parts[3]}-${parts[4]}`,
      cabin: parts[5],
      lastUpdated: (entry as any).lastUpdated || cache.lastUpdated || null,
    };
  }).filter(Boolean);

  res.json({
    routes,
    totalEntries: routes.length,
    lastUpdated: cache.lastUpdated || null,
  });
});

// ── GET /api/flights/live-search (SSE) ──────────────────────

app.get('/api/flights/live-search', (req, res) => {
  const fromRaw = (req.query.from as string) || '';
  const toRaw = (req.query.to as string) || '';
  const cabinRaw = (req.query.class as string) || 'any';
  const programSlug = (req.query.program as string) || 'amex-mr';

  const origins = fromRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const dests = toRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  if (origins.length === 0 || dests.length === 0) {
    res.status(400).json({ error: 'Missing from/to parameters' });
    return;
  }

  // Normalize cabin: 'any' defaults to 'business' for scraping
  const cabinMap: Record<string, string> = {
    business: 'business', first: 'first', economy: 'economy',
    'Business': 'business', 'First': 'first', 'Economy': 'economy',
    'Either': 'any', 'any': 'any',
  };
  const cabinNorm = cabinMap[cabinRaw] || 'business';
  const scrapeCabin = (cabinNorm === 'any' ? 'business' : cabinNorm) as 'economy' | 'business' | 'first';

  // Check concurrency limit
  if (!canStartLiveScrape()) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`event: search-error\ndata: ${JSON.stringify({ message: 'Server is busy with other live searches. Try again in a minute.' })}\n\n`);
    res.end();
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  let clientConnected = true;
  req.on('close', () => { clientConnected = false; });

  function sendEvent(event: string, data: any) {
    if (!clientConnected) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Keep-alive every 15s
  const keepAlive = setInterval(() => {
    if (!clientConnected) { clearInterval(keepAlive); return; }
    res.write(':keepalive\n\n');
  }, 15000);

  const partners = getTransferPartnersForProgram(programSlug);
  const programName = POINTS_PROGRAMS.find(p => p.slug === programSlug)?.name || programSlug;
  const liveResults: FlightResult[] = [];

  runLiveScrape(origins, dests, scrapeCabin, programSlug, {
    onScraperStarted(key, name) {
      sendEvent('scraper-started', { scraper: key, name, status: 'running' });
    },
    onScraperProgress(key, message, date) {
      sendEvent('scraper-progress', { scraper: key, message, date });
    },
    onResult(flight) {
      liveResults.push(flight);
      if (flight.pointsRequired && flight.pointsRequired > 0) {
        const enriched = enrichFlightResult(flight, programSlug, partners, programName);
        sendEvent('result', { flight: enriched });
      }
    },
    onScraperDone(key, name, count) {
      sendEvent('scraper-done', { scraper: key, name, resultCount: count, status: 'done' });
    },
    onScraperError(key, name, error) {
      sendEvent('scraper-error', { scraper: key, name, error, status: 'error' });
    },
    onScraperSkipped(key, name, reason) {
      sendEvent('scraper-skipped', { scraper: key, name, reason, status: 'skipped' });
    },
    onComplete(summary) {
      sendEvent('complete', summary);
      clearInterval(keepAlive);
      res.end();
      // Write results to cache in background
      writeLiveResultsToCache(liveResults, scrapeCabin).catch(err => {
        console.error('[LiveSearch] Failed to write cache:', err.message);
      });
    },
  }).catch(err => {
    sendEvent('search-error', { message: err.message || 'Live search failed' });
    clearInterval(keepAlive);
    res.end();
  });
});

// ── Write live results to daemon cache ──────────────────────

async function writeLiveResultsToCache(
  results: FlightResult[],
  cabin: string,
): Promise<void> {
  if (results.length === 0) return;

  let cache: { version?: number; entries: Record<string, any>; lastUpdated?: string } = {
    version: 1,
    entries: {},
    lastUpdated: new Date().toISOString(),
  };

  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch { /* proceed with empty */ }

  // Group results by ORIGIN-DEST-YYYY-MM-DD-cabin key
  for (const r of results) {
    if (!r.departureDate || !r.origin || !r.destination) continue;
    const key = `${r.origin}-${r.destination}-${r.departureDate}-${cabin}`;

    if (!cache.entries[key]) {
      cache.entries[key] = { awardFlights: [], lastUpdated: new Date().toISOString() };
    }

    const entry = cache.entries[key];
    // Deduplicate by flightNumber-date-source
    const dedupeKey = r.flightNumber
      ? `${r.flightNumber}-${r.departureDate}-${r.source}`
      : `${r.source}-${r.origin}-${r.destination}-${r.departureDate}-${r.departureTime}`;

    const exists = entry.awardFlights.some((existing: any) => {
      const existKey = existing.flightNumber
        ? `${existing.flightNumber}-${existing.departureDate}-${existing.source}`
        : `${existing.source}-${existing.origin}-${existing.destination}-${existing.departureDate}-${existing.departureTime}`;
      return existKey === dedupeKey;
    });

    if (!exists) {
      entry.awardFlights.push(r);
    }

    entry.lastUpdated = new Date().toISOString();
  }

  cache.lastUpdated = new Date().toISOString();

  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await atomicWriteFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`[LiveSearch] Wrote ${results.length} results to cache`);
}

// ── Start ───────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`🐙 Harbor Flights web server running on http://localhost:${PORT}`);
  console.log(`   Cache file: ${CACHE_FILE}`);
  console.log(`   Static dir: ${PUBLIC_DIR}`);
});
