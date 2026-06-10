/**
 * Pure helpers extracted from flight-daemon.ts so they can be unit-tested
 * without importing the daemon entry point (which calls main() on import).
 * No side effects, no I/O — safe to import from tests.
 */
import { MAX_REASONABLE_POINTS, MAX_REASONABLE_TAXES_USD } from './scraper-config.js';
import type { FlightResult } from './types.js';

const DEFAULT_DATE_SAMPLING_DAYS = parseInt(process.env.DATE_SAMPLING_DAYS || '14', 10);

/**
 * Sampled future dates between startDate and endDate (inclusive), stepping by
 * samplingDays. The window start is clamped to today so stale signups with a
 * past start_date never generate unbookable past-date searches.
 */
export function generateDates(startDate?: string, endDate?: string, samplingDays?: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  const todayMidnight = new Date(now.toISOString().slice(0, 10) + 'T00:00:00');
  const requested = startDate ? new Date(startDate) : new Date(now.getTime() + 7 * 86400000);
  const start = requested < todayMidnight ? todayMidnight : requested;
  const end = endDate ? new Date(endDate) : new Date(now.getTime() + 90 * 86400000);
  const step = samplingDays || DEFAULT_DATE_SAMPLING_DAYS;

  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + step);
  }
  return dates;
}

/** Split a comma/semicolon-separated list into trimmed non-empty tokens. */
export function parseList(s: string): string[] {
  return s.split(/[,;]\s*/).map(x => x.trim()).filter(Boolean);
}

/**
 * Whether a scraped flight is trustworthy enough to alert on / persist.
 * Lower bounds reject empty/garbage; upper bounds reject parser corruption
 * (e.g. a DOM-drift bug reading a flight number as a mileage value).
 */
export function isValidFlight(f: FlightResult): boolean {
  if (!f.airline || f.airline.trim() === '' || f.airline === 'N/A' || f.airline === 'Unknown') return false;
  if (!f.pointsRequired || !Number.isFinite(f.pointsRequired) || f.pointsRequired <= 0) return false;
  if (f.taxesAndFees == null || !Number.isFinite(f.taxesAndFees) || f.taxesAndFees < 0) return false;
  if (f.pointsRequired > MAX_REASONABLE_POINTS) return false;
  if (f.taxesAndFees > MAX_REASONABLE_TAXES_USD) return false;
  if (!f.origin || !f.destination || !f.departureDate) return false;
  return true;
}
