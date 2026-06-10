/**
 * Daemon staleness watchdog.
 *
 * Queries daemon_status.last_scan_time and alerts (WhatsApp via openclaw) when
 * the daemon hasn't completed a scan within STALENESS_THRESHOLD_MIN. This exists
 * because the daemon silently died once and went unnoticed for ~4 months — an
 * external heartbeat check is the backstop the in-process health write can't be.
 *
 * Run periodically (launchd com.flightpoints.staleness, StartInterval 1800s).
 * Configure via env:
 *   STALENESS_THRESHOLD_MIN  default 90  (alert if last scan older than this)
 *   STALENESS_ALERT_CONTACT  WhatsApp target (e.g. +1...); if unset, logs only
 *   STALENESS_STATE_FILE     dedup file so we don't re-alert every run (default ~/.flight-points/staleness-state.json)
 *
 * Exit codes: 0 = healthy or alert-sent, 1 = error reaching DB.
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pg from 'pg';

const THRESHOLD_MIN = Number(process.env.STALENESS_THRESHOLD_MIN || 90);
const CONTACT = process.env.STALENESS_ALERT_CONTACT || '';
const STATE_FILE =
  process.env.STALENESS_STATE_FILE ||
  path.join(os.homedir(), '.flight-points', 'staleness-state.json');

function log(msg: string) {
  console.error(`[staleness ${new Date().toISOString()}] ${msg}`);
}

function readState(): { lastAlertedScan?: string } {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(s: { lastAlertedScan?: string }) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s));
  } catch (e: any) {
    log(`Could not persist state: ${e.message}`);
  }
}

function sendAlert(message: string) {
  log(`ALERT: ${message}`);
  if (!CONTACT) {
    log('STALENESS_ALERT_CONTACT unset — logging only, no WhatsApp sent.');
    return;
  }
  try {
    execFileSync(
      'openclaw',
      ['message', 'send', '--channel', 'whatsapp', '--target', CONTACT, '--message', message],
      { timeout: 30000 },
    );
    log('Alert delivered via WhatsApp.');
  } catch (e: any) {
    log(`Failed to send WhatsApp alert: ${e.message}`);
  }
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    log('DATABASE_URL not set');
    process.exit(1);
  }
  const connectionString = raw.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');
  const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });

  // Set exitCode and return inside try/catch so the finally (pool.end) always
  // runs — process.exit() inside try would skip it and leak the connection.
  let exitCode = 0;
  try {
    const { rows } = await pool.query(
      'SELECT last_scan_time, status, pid FROM daemon_status WHERE id = 1',
    );
    if (rows.length === 0 || !rows[0].last_scan_time) {
      sendAlert('⚠️ Flight Points daemon: no scan recorded yet (daemon may have never started).');
    } else {
      const lastScan = new Date(rows[0].last_scan_time);
      const lastScanIso = lastScan.toISOString();
      const ageMin = (Date.now() - lastScan.getTime()) / 60000;
      log(`Last scan ${lastScanIso} (${ageMin.toFixed(0)} min ago); threshold ${THRESHOLD_MIN} min.`);

      const state = readState();
      if (ageMin > THRESHOLD_MIN) {
        // Only alert once per stale episode (don't spam every run).
        if (state.lastAlertedScan === lastScanIso) {
          log('Already alerted for this stale scan — skipping duplicate.');
        } else {
          sendAlert(
            `🚨 Flight Points daemon STALE: last scan ${ageMin.toFixed(0)} min ago ` +
              `(${lastScanIso}), threshold ${THRESHOLD_MIN} min. status=${rows[0].status} pid=${rows[0].pid}. Check Harbor.`,
          );
          writeState({ lastAlertedScan: lastScanIso });
        }
      } else {
        log('Daemon healthy.');
        if (state.lastAlertedScan) writeState({}); // clear once recovered
      }
    }
  } catch (e: any) {
    log(`DB error: ${e.message}`);
    exitCode = 1;
  } finally {
    await pool.end();
  }
  process.exit(exitCode);
}

main();
