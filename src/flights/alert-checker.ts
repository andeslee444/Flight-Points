/**
 * Alert Checker — Daemon Extension (Phase 1 Skeleton)
 *
 * Queries alert_subscriptions for active watches and compares them against
 * the current flight cache. Phase 1: logs matches only.
 * Phase 6: adds email (Resend) and WhatsApp (OpenClaw) delivery.
 */
import { getPool } from './db.js';
import type { FlightResult } from './types.js';

export interface AlertSubscription {
  id: number;
  user_id: string;
  origin: string;
  destination: string;
  cabin: string;
  program: string | null;
  max_miles: number | null;
  channel: string;  // 'email' | 'whatsapp'
  contact: string;
  active: boolean;
  created_at: Date;
}

export interface AlertMatch {
  subscription: AlertSubscription;
  flight: FlightResult;
}

/**
 * Load all active alert subscriptions from the database.
 * Returns empty array if table is empty or DB is unavailable.
 */
async function loadActiveSubscriptions(): Promise<AlertSubscription[]> {
  const pool = getPool();
  try {
    const result = await pool.query<AlertSubscription>(
      `SELECT * FROM alert_subscriptions WHERE active = true`,
    );
    return result.rows;
  } catch (err) {
    console.error('[alert-checker] Failed to load subscriptions:', err);
    return [];
  }
}

/**
 * Check whether a flight result matches an alert subscription.
 */
function flightMatchesSubscription(
  flight: FlightResult,
  sub: AlertSubscription,
): boolean {
  if (flight.origin !== sub.origin) return false;
  if (flight.destination !== sub.destination) return false;
  if (flight.cabin !== sub.cabin) return false;
  if (sub.program && flight.source !== sub.program) return false;
  if (sub.max_miles && flight.pointsRequired && flight.pointsRequired > sub.max_miles) return false;
  return true;
}

/**
 * Main entry point — called by daemon after each scrape cycle.
 * Phase 1: logs matches.
 * Phase 6: sends notifications via email/WhatsApp.
 *
 * @param freshResults - All confirmed flight results from the current cycle
 * @param cycleId - ISO timestamp of the current scrape cycle
 */
export async function checkAlerts(
  freshResults: FlightResult[],
  cycleId: string,
): Promise<void> {
  if (freshResults.length === 0) return;

  const subscriptions = await loadActiveSubscriptions();
  if (subscriptions.length === 0) {
    // Normal during Phase 1 — no users yet
    return;
  }

  const matches: AlertMatch[] = [];
  for (const sub of subscriptions) {
    for (const flight of freshResults) {
      if (flightMatchesSubscription(flight, sub)) {
        matches.push({ subscription: sub, flight });
      }
    }
  }

  if (matches.length === 0) return;

  // Phase 1: log only. Phase 6 replaces this block with notification delivery.
  console.log(`[alert-checker] ${matches.length} alert match(es) found (cycle: ${cycleId})`);
  for (const { subscription, flight } of matches) {
    console.log(
      `[alert-checker] MATCH: user=${subscription.user_id} ` +
      `route=${flight.origin}->${flight.destination} ` +
      `cabin=${flight.cabin} miles=${flight.pointsRequired} ` +
      `source=${flight.source} channel=${subscription.channel}`,
    );
  }

  // TODO (Phase 6): Replace logging above with:
  //   await sendEmailAlert(match) for channel === 'email'
  //   await sendWhatsAppAlert(match) for channel === 'whatsapp'
}
