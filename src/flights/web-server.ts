/**
 * Harbor Flights — Self-Contained Web Server
 *
 * Serves the frontend pages and provides API endpoints that read
 * from the PostgreSQL database. Also supports live on-demand
 * scraping via SSE when the cache has no results for a route.
 *
 * Usage:  npm run dev   (or)  npm run serve
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
  normalizeAirlineName,
} from './monitor.js';
import { getSweetSpotsByTier, getSweetSpotsForProgram, SWEET_SPOTS } from './sweet-spots.js';
import { runLiveScrape, canStartLiveScrape } from './live-scraper.js';
import type { FlightResult, SearchParams } from './types.js';
import { searchGoogleFlights } from './scrapers/google-flights.js';
import {
  initPool, closePool,
  getCacheEntries, getAllCacheEntries, getCacheRoutes,
  addSignup, upsertLiveCacheResults,
} from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, '../../web/public');

// Sources that are chart estimates, not confirmed availability — never show to users
const NON_BOOKABLE_SOURCES = new Set(['ana-estimated', 'ana-chart']);

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
    f.cabin,
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
    cashPriceSource: 'estimate',
    cpp,
    dealRating: computeDealRating(cppVal),
    direct: f.stops === 0,
    route: `${f.origin} \u2192 ${f.destination}`,
    estimated: NON_BOOKABLE_SOURCES.has(f.source),
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
app.get('/api/flights/search', async (req, res) => {
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

  // Read from database
  const cacheRows = await getCacheEntries(origins, dests, cabin);

  // Collect matching award flights
  const rawFlights: any[] = [];
  let lastUpdated: string | null = null;

  for (const row of cacheRows) {
    const flights = Array.isArray(row.award_flights) ? row.award_flights : [];
    for (const f of flights) {
      rawFlights.push(f);
    }
    // Track most recent update
    const updatedAt = row.updated_at;
    if (updatedAt && (!lastUpdated || updatedAt > lastUpdated)) {
      lastUpdated = updatedAt;
    }
  }

  // Enrich flights based on user's credit card program
  const partners = getTransferPartnersForProgram(programSlug);
  const programName = POINTS_PROGRAMS.find(p => p.slug === programSlug)?.name || programSlug;

  const enriched = rawFlights
    .filter(f => f.pointsRequired && f.pointsRequired > 0)
    .filter(f => !NON_BOOKABLE_SOURCES.has(f.source))
    .map(f => enrichFlightResult(f, programSlug, partners, programName));

  // Sort by CPP descending (best deals first)
  enriched.sort((a, b) => (b.cpp || 0) - (a.cpp || 0));

  res.json({
    results: enriched,
    awardFlights: { count: enriched.length, results: enriched },
    cashFlights: { count: 0, results: [] },
    source: 'daemon-cache',
    lastUpdated,
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

  await addSignup(body);
  res.json({ ok: true });
});

// ── GET /api/flights/deals ───────────────────────────────────
app.get('/api/flights/deals', async (req, res) => {
  const programSlug = (req.query.program as string) || 'amex-mr';

  // Read all cache entries from DB
  const cacheRows = await getAllCacheEntries();

  // Collect ALL award flights (skip non-bookable estimates)
  const rawFlights: any[] = [];
  let lastUpdated: string | null = null;

  for (const row of cacheRows) {
    const flights = Array.isArray(row.award_flights) ? row.award_flights : [];
    for (const f of flights) {
      if (f.pointsRequired && f.pointsRequired > 0 && !NON_BOOKABLE_SOURCES.has(f.source)) {
        rawFlights.push(f);
      }
    }
    const updatedAt = row.updated_at;
    if (updatedAt && (!lastUpdated || updatedAt > lastUpdated)) {
      lastUpdated = updatedAt;
    }
  }

  // Enrich with transfer partner info
  const partners = getTransferPartnersForProgram(programSlug);
  const programName = POINTS_PROGRAMS.find(p => p.slug === programSlug)?.name || programSlug;

  const enriched = rawFlights
    .map(f => enrichFlightResult(f, programSlug, partners, programName))
    .filter(f => f.dealRating === 'hot' || f.dealRating === 'good');

  // Deduplicate by route+cabin+airline — keep best CPP per combo
  const deduped = new Map<string, any>();
  for (const f of enriched) {
    const key = `${f.origin}-${f.destination}-${f.cabin}-${f.airline}`;
    const existing = deduped.get(key);
    if (!existing || (f.cpp || 0) > (existing.cpp || 0)) {
      deduped.set(key, f);
    }
  }

  // Sort by CPP descending, limit to top 20
  const deals = Array.from(deduped.values())
    .sort((a, b) => (b.cpp || 0) - (a.cpp || 0))
    .slice(0, 20);

  res.json({
    deals,
    lastUpdated,
    totalCached: rawFlights.length,
  });
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
app.get('/api/flights/routes', async (_req, res) => {
  const rows = await getCacheRoutes();

  const routes = rows.map(r => ({
    origin: r.origin,
    destination: r.destination,
    date: r.date,
    cabin: r.cabin,
    lastUpdated: r.updated_at,
  }));

  // Find most recent update
  let lastUpdated: string | null = null;
  for (const r of rows) {
    if (r.updated_at && (!lastUpdated || r.updated_at > lastUpdated)) {
      lastUpdated = r.updated_at;
    }
  }

  res.json({
    routes,
    totalEntries: routes.length,
    lastUpdated,
  });
});

// ── GET /api/flights/cash-prices ─────────────────────────────

app.get('/api/flights/cash-prices', async (req, res) => {
  const origin = ((req.query.from as string) || '').trim().toUpperCase();
  const destination = ((req.query.to as string) || '').trim().toUpperCase();
  const date = (req.query.date as string) || '';
  const cabinRaw = (req.query.class as string) || 'business';

  if (!origin || !destination || !date) {
    return res.status(400).json({ error: 'Missing from, to, or date parameters' });
  }

  const cabinMap: Record<string, string> = {
    business: 'business', first: 'first', economy: 'economy',
    'Business': 'business', 'First': 'first', 'Economy': 'economy',
    'any': 'business',
  };
  const cabin = (cabinMap[cabinRaw] || 'business') as 'economy' | 'business' | 'first';

  try {
    const params: SearchParams = { origin, destination, date, cabin };
    const results = await searchGoogleFlights(params);

    const cashFlights = results.map(r => ({
      airline: normalizeAirlineName(r.airline),
      cashPrice: r.cashPrice,
      departureTime: r.departureTime,
      arrivalTime: r.arrivalTime,
      duration: r.duration,
      stops: r.stops,
    }));

    res.json({ cashFlights, source: 'google-flights', origin, destination, date, cabin });
  } catch (err: any) {
    console.error('[CashPrices] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch cash prices', message: err.message });
  }
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
      if (flight.pointsRequired && flight.pointsRequired > 0 && !NON_BOOKABLE_SOURCES.has(flight.source)) {
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
      upsertLiveCacheResults(liveResults, scrapeCabin).catch(err => {
        console.error('[LiveSearch] Failed to write cache:', err.message);
      });
    },
  }).catch(err => {
    sendEvent('search-error', { message: err.message || 'Live search failed' });
    clearInterval(keepAlive);
    res.end();
  });
});

// ── Export for Vercel ────────────────────────────────────────
export { app };

// ── Start (local dev only) ──────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = parseInt(process.env.PORT || '3000', 10);

  initPool();
  console.log('[DB] Connection pool initialized');

  app.listen(PORT, () => {
    console.log(`Flight Points web server running on http://localhost:${PORT}`);
    console.log(`   Static dir: ${PUBLIC_DIR}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM — closing DB pool...');
    await closePool();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT — closing DB pool...');
    await closePool();
    process.exit(0);
  });
}
