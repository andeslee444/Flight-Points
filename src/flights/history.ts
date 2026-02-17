/**
 * Flight Search History Storage
 * Saves every search result for price tracking over time.
 * Created: 2026-02-16
 */

import * as fs from 'fs';
import * as path from 'path';
import { FlightResult, PriceHistory } from './types.js';

const DATA_DIR = path.join(__dirname, '../../data/flight-history');

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getFilePath(route: string, cabin: string): string {
  return path.join(DATA_DIR, `${route}-${cabin}.json`);
}

/**
 * Save search results to history file. Appends to existing data.
 */
export function saveSearchResults(results: FlightResult[]): void {
  ensureDir();

  // Group by route + cabin
  const groups = new Map<string, FlightResult[]>();
  for (const r of results) {
    const key = `${r.origin}-${r.destination}`;
    const group = groups.get(`${key}:${r.cabin}`) || [];
    group.push(r);
    groups.set(`${key}:${r.cabin}`, group);
  }

  for (const [key, flights] of groups) {
    const [route, cabin] = key.split(':');
    const filePath = getFilePath(route, cabin);

    let history: PriceHistory;
    if (fs.existsSync(filePath)) {
      try {
        history = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        history = { route, cabin, dataPoints: [] };
      }
    } else {
      history = { route, cabin, dataPoints: [] };
    }

    for (const flight of flights) {
      if (flight.pointsRequired || flight.cashPrice) {
        history.dataPoints.push({
          date: flight.scrapedAt,
          travelDate: flight.departureDate,
          pointsRequired: flight.pointsRequired || 0,
          program: flight.pointsProgram || flight.source,
          cashPrice: flight.cashPrice || 0,
          centsPerPoint: flight.centsPerPoint || 0,
        });
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
  }
}

/**
 * Get price history for a route/cabin within N days
 */
export function getHistory(route: string, cabin: string, days: number = 30): PriceHistory | null {
  const filePath = getFilePath(route, cabin);
  if (!fs.existsSync(filePath)) return null;

  try {
    const history: PriceHistory = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    history.dataPoints = history.dataPoints.filter(dp => dp.date >= cutoffStr);
    return history;
  } catch {
    return null;
  }
}
