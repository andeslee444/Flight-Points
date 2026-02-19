/**
 * One-time data migration: JSON files → PostgreSQL
 *
 * Reads each JSON file from data/ and inserts into corresponding tables.
 * Uses ON CONFLICT upserts for idempotent re-runs.
 *
 * Usage: DATABASE_URL=... tsx migrations/002_seed_from_json.ts
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data');

function readJson(filename: string): any {
  const filePath = path.join(DATA_DIR, filename);
  if (!existsSync(filePath)) {
    console.log(`  Skipping ${filename} (not found)`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err: any) {
    console.error(`  Failed to parse ${filename}: ${err.message}`);
    return null;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  console.log('Connected to database');
  console.log(`Reading data from: ${DATA_DIR}`);

  // ── 1. flight-signups.json ──
  console.log('\n1. Migrating flight-signups.json...');
  const signups = readJson('flight-signups.json');
  if (Array.isArray(signups)) {
    let count = 0;
    for (const s of signups) {
      await pool.query(
        `INSERT INTO flight_signups (type, "from", "to", class, contact, alert_method, start_date, end_date, date_sampling_days, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          s.type || null,
          s.from,
          s.to,
          s.class || 'Business',
          s.contact || null,
          s.alertMethod || s.alert_method || null,
          s.startDate || s.start_date || null,
          s.endDate || s.end_date || null,
          s.dateSamplingDays || s.date_sampling_days || null,
          s.timestamp || new Date().toISOString(),
        ],
      );
      count++;
    }
    console.log(`  Inserted ${count} signups`);
  }

  // ── 2. sent-alerts.json ──
  console.log('\n2. Migrating sent-alerts.json...');
  const sentAlerts = readJson('sent-alerts.json');
  if (sentAlerts && typeof sentAlerts === 'object') {
    let count = 0;
    for (const [key, sentAt] of Object.entries(sentAlerts)) {
      await pool.query(
        `INSERT INTO sent_alerts (alert_key, sent_at) VALUES ($1, $2)
         ON CONFLICT (alert_key) DO UPDATE SET sent_at = $2`,
        [key, sentAt],
      );
      count++;
    }
    console.log(`  Inserted ${count} sent alerts`);
  }

  // ── 3. flight-monitor-history.json ──
  console.log('\n3. Migrating flight-monitor-history.json...');
  const history = readJson('flight-monitor-history.json');
  if (history) {
    // 3a. Scans
    if (Array.isArray(history.scans)) {
      let count = 0;
      for (const scan of history.scans) {
        await pool.query(
          'INSERT INTO monitor_scans (scan_time, results) VALUES ($1, $2)',
          [scan.scanTime, JSON.stringify(scan.results || [])],
        );
        count++;
      }
      console.log(`  Inserted ${count} scans`);
    }

    // 3b. Known flights
    if (history.knownFlights && typeof history.knownFlights === 'object') {
      let count = 0;
      for (const [key, value] of Object.entries(history.knownFlights) as [string, any][]) {
        await pool.query(
          `INSERT INTO known_flights (flight_key, miles, first_seen) VALUES ($1, $2, $3)
           ON CONFLICT (flight_key) DO UPDATE SET miles = $2`,
          [key, value.miles, value.firstSeen],
        );
        count++;
      }
      console.log(`  Inserted ${count} known flights`);
    }
  }

  // ── 4. flight-rotation-state.json ──
  console.log('\n4. Migrating flight-rotation-state.json...');
  const rotation = readJson('flight-rotation-state.json');
  if (rotation && typeof rotation.offset === 'number') {
    await pool.query(
      `INSERT INTO rotation_state (id, offset_value, updated_at) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET offset_value = $1, updated_at = $2`,
      [rotation.offset, rotation.updatedAt || new Date().toISOString()],
    );
    console.log(`  Set rotation offset to ${rotation.offset}`);
  }

  // ── 5. daemon-status.json ──
  console.log('\n5. Migrating daemon-status.json...');
  const status = readJson('daemon-status.json');
  if (status) {
    await pool.query(
      `INSERT INTO daemon_status (id, pid, rss_mb, started_at, status, signal, last_scan_time, results_count, alerts_count, next_scan_time, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (id) DO UPDATE SET
         pid = $1, rss_mb = $2, started_at = $3, status = $4, signal = $5,
         last_scan_time = $6, results_count = $7, alerts_count = $8, next_scan_time = $9, updated_at = NOW()`,
      [
        status.pid || null,
        status.rssMB || null,
        status.startedAt || null,
        status.status || null,
        status.signal || null,
        status.lastScanTime || null,
        status.resultsCount || null,
        status.alertsCount || null,
        status.nextScanTime || null,
      ],
    );
    console.log('  Migrated daemon status');
  }

  // ── 6. scraper-health.json ──
  console.log('\n6. Migrating scraper-health.json...');
  const health = readJson('scraper-health.json');
  if (health && health.scrapers) {
    let count = 0;
    for (const [key, s] of Object.entries(health.scrapers) as [string, any][]) {
      await pool.query(
        `INSERT INTO scraper_health (scraper_key, total_calls, total_successes, total_failures, consecutive_failures, last_success, last_failure, circuit_open, circuit_opened_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (scraper_key) DO UPDATE SET
           total_calls = $2, total_successes = $3, total_failures = $4,
           consecutive_failures = $5, last_success = $6, last_failure = $7,
           circuit_open = $8, circuit_opened_at = $9, updated_at = NOW()`,
        [key, s.totalCalls, s.totalSuccesses, s.totalFailures,
         s.consecutiveFailures, s.lastSuccess || null, s.lastFailure || null,
         s.circuitOpen, s.circuitOpenedAt || null],
      );
      count++;
    }
    console.log(`  Inserted ${count} scraper health entries`);
  }

  // ── 7. flight-cache.json ──
  console.log('\n7. Migrating flight-cache.json...');
  const cache = readJson('flight-cache.json');
  if (cache && cache.entries) {
    let count = 0;
    for (const [key, entry] of Object.entries(cache.entries) as [string, any][]) {
      // Parse key: ORIGIN-DEST-YYYY-MM-DD-cabin
      const parts = key.split('-');
      if (parts.length < 6) {
        console.log(`  Skipping malformed key: ${key}`);
        continue;
      }
      const origin = parts[0];
      const destination = parts[1];
      const date = `${parts[2]}-${parts[3]}-${parts[4]}`;
      const cabin = parts[5];

      await pool.query(
        `INSERT INTO flight_cache (route_key, origin, destination, date, cabin, award_flights, cash_flights, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (route_key) DO UPDATE SET
           award_flights = $6, cash_flights = $7, updated_at = $8`,
        [
          key,
          origin,
          destination,
          date,
          cabin,
          JSON.stringify(entry.awardFlights || []),
          JSON.stringify(entry.cashFlights || []),
          entry.timestamp || entry.lastUpdated || cache.lastUpdated || new Date().toISOString(),
        ],
      );
      count++;
    }
    console.log(`  Inserted ${count} cache entries`);
  }

  console.log('\nMigration complete!');
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
