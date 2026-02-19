/**
 * Database Access Layer — PostgreSQL via node-postgres
 *
 * Singleton connection pool with typed query functions for every table.
 * All functions wrap queries in try/catch for graceful degradation.
 */

import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function initPool(): pg.Pool {
  if (pool) return pool;

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Strip sslmode from the connection string — we handle SSL via the ssl option
  const connectionString = rawUrl.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');

  const sslOff = process.env.PG_SSL === 'false';
  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    ssl: sslOff ? false : { rejectUnauthorized: false },
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });

  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('Database pool not initialized — call initPool() first');
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ── flight_cache ──

export interface CacheEntry {
  route_key: string;
  origin: string;
  destination: string;
  date: string;
  cabin: string;
  award_flights: any[];
  cash_flights: any[];
  updated_at: string;
}

export async function getCacheEntries(
  origins: string[],
  dests: string[],
  cabin?: string,
): Promise<CacheEntry[]> {
  try {
    const p = getPool();
    let query: string;
    let params: any[];

    if (cabin && cabin !== 'any') {
      query = `SELECT * FROM flight_cache WHERE origin = ANY($1) AND destination = ANY($2) AND cabin = $3`;
      params = [origins, dests, cabin];
    } else {
      query = `SELECT * FROM flight_cache WHERE origin = ANY($1) AND destination = ANY($2)`;
      params = [origins, dests];
    }

    const { rows } = await p.query(query, params);
    return rows;
  } catch (err: any) {
    console.error('[DB] getCacheEntries error:', err.message);
    return [];
  }
}

export async function getAllCacheEntries(): Promise<CacheEntry[]> {
  try {
    const { rows } = await getPool().query('SELECT * FROM flight_cache');
    return rows;
  } catch (err: any) {
    console.error('[DB] getAllCacheEntries error:', err.message);
    return [];
  }
}

export async function getCacheRoutes(): Promise<Array<{
  origin: string;
  destination: string;
  date: string;
  cabin: string;
  updated_at: string;
}>> {
  try {
    const { rows } = await getPool().query(
      'SELECT origin, destination, date, cabin, updated_at FROM flight_cache'
    );
    return rows;
  } catch (err: any) {
    console.error('[DB] getCacheRoutes error:', err.message);
    return [];
  }
}

export async function upsertCacheEntries(
  entries: Array<{
    route_key: string;
    origin: string;
    destination: string;
    date: string;
    cabin: string;
    award_flights: any[];
    cash_flights?: any[];
  }>,
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      for (const e of entries) {
        await client.query(
          `INSERT INTO flight_cache (route_key, origin, destination, date, cabin, award_flights, cash_flights, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (route_key) DO UPDATE SET
             award_flights = $6,
             cash_flights = $7,
             updated_at = NOW()`,
          [e.route_key, e.origin, e.destination, e.date, e.cabin,
           JSON.stringify(e.award_flights), JSON.stringify(e.cash_flights || [])],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('[DB] upsertCacheEntries error:', err.message);
  }
}

export async function upsertLiveCacheResults(
  results: any[],
  cabin: string,
): Promise<void> {
  if (results.length === 0) return;

  try {
    const p = getPool();

    // Group results by route key
    const groups = new Map<string, { origin: string; destination: string; date: string; flights: any[] }>();
    for (const r of results) {
      if (!r.departureDate || !r.origin || !r.destination) continue;
      const key = `${r.origin}-${r.destination}-${r.departureDate}-${cabin}`;
      if (!groups.has(key)) {
        groups.set(key, { origin: r.origin, destination: r.destination, date: r.departureDate, flights: [] });
      }
      groups.get(key)!.flights.push(r);
    }

    const client = await p.connect();
    try {
      await client.query('BEGIN');

      for (const [routeKey, group] of groups) {
        // Read existing entry to merge
        const { rows } = await client.query(
          'SELECT award_flights FROM flight_cache WHERE route_key = $1',
          [routeKey],
        );

        let existing: any[] = rows.length > 0 ? rows[0].award_flights : [];
        if (!Array.isArray(existing)) existing = [];

        // Deduplicate by flightNumber-date-source
        for (const r of group.flights) {
          const dedupeKey = r.flightNumber
            ? `${r.flightNumber}-${r.departureDate}-${r.source}`
            : `${r.source}-${r.origin}-${r.destination}-${r.departureDate}-${r.departureTime}`;

          const exists = existing.some((e: any) => {
            const eKey = e.flightNumber
              ? `${e.flightNumber}-${e.departureDate}-${e.source}`
              : `${e.source}-${e.origin}-${e.destination}-${e.departureDate}-${e.departureTime}`;
            return eKey === dedupeKey;
          });

          if (!exists) existing.push(r);
        }

        await client.query(
          `INSERT INTO flight_cache (route_key, origin, destination, date, cabin, award_flights, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (route_key) DO UPDATE SET
             award_flights = $6,
             updated_at = NOW()`,
          [routeKey, group.origin, group.destination, group.date, cabin, JSON.stringify(existing)],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    console.log(`[DB] Wrote ${results.length} live results across ${groups.size} cache entries`);
  } catch (err: any) {
    console.error('[DB] upsertLiveCacheResults error:', err.message);
  }
}

export async function pruneStaleCacheEntries(maxAgeMs: number): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const { rowCount } = await getPool().query(
      'DELETE FROM flight_cache WHERE updated_at < $1',
      [cutoff],
    );
    return rowCount ?? 0;
  } catch (err: any) {
    console.error('[DB] pruneStaleCacheEntries error:', err.message);
    return 0;
  }
}

// ── flight_signups ──

export interface SignupRow {
  id: number;
  type: string | null;
  from: string;
  to: string;
  class: string;
  contact: string | null;
  alert_method: string | null;
  start_date: string | null;
  end_date: string | null;
  date_sampling_days: number | null;
  timestamp: string;
}

export async function loadSignups(): Promise<SignupRow[]> {
  try {
    const { rows } = await getPool().query('SELECT * FROM flight_signups ORDER BY id');
    return rows;
  } catch (err: any) {
    console.error('[DB] loadSignups error:', err.message);
    return [];
  }
}

export async function addSignup(entry: Record<string, any>): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO flight_signups (type, "from", "to", class, contact, alert_method, start_date, end_date, date_sampling_days, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.type || null,
        entry.from,
        entry.to,
        entry.class || 'Business',
        entry.contact || null,
        entry.alertMethod || entry.alert_method || null,
        entry.startDate || entry.start_date || null,
        entry.endDate || entry.end_date || null,
        entry.dateSamplingDays || entry.date_sampling_days || null,
        entry.timestamp || new Date().toISOString(),
      ],
    );
  } catch (err: any) {
    console.error('[DB] addSignup error:', err.message);
  }
}

// ── sent_alerts ──

export async function loadSentAlerts(): Promise<Record<string, string>> {
  try {
    const { rows } = await getPool().query('SELECT alert_key, sent_at FROM sent_alerts');
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.alert_key] = row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at;
    }
    return result;
  } catch (err: any) {
    console.error('[DB] loadSentAlerts error:', err.message);
    return {};
  }
}

export async function markAlertSent(key: string): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO sent_alerts (alert_key, sent_at) VALUES ($1, NOW())
       ON CONFLICT (alert_key) DO UPDATE SET sent_at = NOW()`,
      [key],
    );
  } catch (err: any) {
    console.error('[DB] markAlertSent error:', err.message);
  }
}

export async function pruneSentAlerts(maxAgeDays: number): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const { rowCount } = await getPool().query(
      'DELETE FROM sent_alerts WHERE sent_at < $1',
      [cutoff],
    );
    return rowCount ?? 0;
  } catch (err: any) {
    console.error('[DB] pruneSentAlerts error:', err.message);
    return 0;
  }
}

// ── monitor_scans ──

export async function getLastScanTime(): Promise<string | null> {
  try {
    const { rows } = await getPool().query(
      'SELECT scan_time FROM monitor_scans ORDER BY scan_time DESC LIMIT 1'
    );
    if (rows.length === 0) return null;
    const t = rows[0].scan_time;
    return t instanceof Date ? t.toISOString() : t;
  } catch (err: any) {
    console.error('[DB] getLastScanTime error:', err.message);
    return null;
  }
}

export async function addScan(scanTime: string, results: any[]): Promise<void> {
  try {
    await getPool().query(
      'INSERT INTO monitor_scans (scan_time, results) VALUES ($1, $2)',
      [scanTime, JSON.stringify(results)],
    );
  } catch (err: any) {
    console.error('[DB] addScan error:', err.message);
  }
}

export async function pruneScans(maxScans: number): Promise<void> {
  try {
    await getPool().query(
      `DELETE FROM monitor_scans WHERE id NOT IN (
         SELECT id FROM monitor_scans ORDER BY scan_time DESC LIMIT $1
       )`,
      [maxScans],
    );
  } catch (err: any) {
    console.error('[DB] pruneScans error:', err.message);
  }
}

// ── known_flights ──

export async function getKnownFlight(key: string): Promise<{ miles: number; first_seen: string } | null> {
  try {
    const { rows } = await getPool().query(
      'SELECT miles, first_seen FROM known_flights WHERE flight_key = $1',
      [key],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      miles: row.miles,
      first_seen: row.first_seen instanceof Date ? row.first_seen.toISOString() : row.first_seen,
    };
  } catch (err: any) {
    console.error('[DB] getKnownFlight error:', err.message);
    return null;
  }
}

export async function upsertKnownFlight(key: string, miles: number, firstSeen: string): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO known_flights (flight_key, miles, first_seen) VALUES ($1, $2, $3)
       ON CONFLICT (flight_key) DO UPDATE SET miles = $2`,
      [key, miles, firstSeen],
    );
  } catch (err: any) {
    console.error('[DB] upsertKnownFlight error:', err.message);
  }
}

export async function pruneKnownFlights(maxAgeDays: number): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const { rowCount } = await getPool().query(
      'DELETE FROM known_flights WHERE first_seen < $1',
      [cutoff],
    );
    return rowCount ?? 0;
  } catch (err: any) {
    console.error('[DB] pruneKnownFlights error:', err.message);
    return 0;
  }
}

// ── rotation_state ──

export async function loadRotationOffset(): Promise<number> {
  try {
    const { rows } = await getPool().query(
      'SELECT offset_value FROM rotation_state WHERE id = 1'
    );
    return rows.length > 0 ? rows[0].offset_value : 0;
  } catch (err: any) {
    console.error('[DB] loadRotationOffset error:', err.message);
    return 0;
  }
}

export async function saveRotationOffset(offset: number): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO rotation_state (id, offset_value, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET offset_value = $1, updated_at = NOW()`,
      [offset],
    );
  } catch (err: any) {
    console.error('[DB] saveRotationOffset error:', err.message);
  }
}

// ── daemon_status ──

export async function writeDaemonStatus(status: Record<string, any>): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO daemon_status (id, pid, rss_mb, started_at, status, signal, last_scan_time, results_count, alerts_count, next_scan_time, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (id) DO UPDATE SET
         pid = COALESCE($1, daemon_status.pid),
         rss_mb = COALESCE($2, daemon_status.rss_mb),
         started_at = COALESCE($3, daemon_status.started_at),
         status = COALESCE($4, daemon_status.status),
         signal = $5,
         last_scan_time = COALESCE($6, daemon_status.last_scan_time),
         results_count = COALESCE($7, daemon_status.results_count),
         alerts_count = COALESCE($8, daemon_status.alerts_count),
         next_scan_time = COALESCE($9, daemon_status.next_scan_time),
         updated_at = NOW()`,
      [
        status.pid ?? null,
        status.rssMB ?? null,
        status.startedAt ?? null,
        status.status ?? null,
        status.signal ?? null,
        status.lastScanTime ?? null,
        status.resultsCount ?? null,
        status.alertsCount ?? null,
        status.nextScanTime ?? null,
      ],
    );
  } catch (err: any) {
    console.error('[DB] writeDaemonStatus error:', err.message);
  }
}

// ── scraper_health ──

export async function writeScraperHealth(
  scrapers: Record<string, {
    totalCalls: number;
    totalSuccesses: number;
    totalFailures: number;
    consecutiveFailures: number;
    lastSuccess: string | null;
    lastFailure: string | null;
    circuitOpen: boolean;
    circuitOpenedAt: string | null;
  }>,
): Promise<void> {
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      for (const [key, s] of Object.entries(scrapers)) {
        await client.query(
          `INSERT INTO scraper_health (scraper_key, total_calls, total_successes, total_failures, consecutive_failures, last_success, last_failure, circuit_open, circuit_opened_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (scraper_key) DO UPDATE SET
             total_calls = $2,
             total_successes = $3,
             total_failures = $4,
             consecutive_failures = $5,
             last_success = $6,
             last_failure = $7,
             circuit_open = $8,
             circuit_opened_at = $9,
             updated_at = NOW()`,
          [key, s.totalCalls, s.totalSuccesses, s.totalFailures,
           s.consecutiveFailures, s.lastSuccess, s.lastFailure,
           s.circuitOpen, s.circuitOpenedAt],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('[DB] writeScraperHealth error:', err.message);
  }
}
