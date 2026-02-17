/**
 * Simple in-memory cache with 30-minute TTL
 */

import { FlightResult } from '../types.js';

const cache = new Map<string, { results: FlightResult[]; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function getCached(key: string): FlightResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.results;
}

export function setCache(key: string, results: FlightResult[]): void {
  cache.set(key, { results, timestamp: Date.now() });
}
