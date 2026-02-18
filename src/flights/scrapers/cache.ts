/**
 * Scraper result cache — in-memory with optional disk persistence.
 *
 * Set SCRAPER_CACHE_DIR env var to enable disk fallback.
 * In-memory cache remains the fast path; disk is read on cache miss.
 *
 * Cache is bounded: evicts oldest entries when exceeding CACHE_MAX_ENTRIES.
 */

import { FlightResult } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteFileSync } from '../utils.js';
import { CACHE_TTL_MS, CACHE_MAX_ENTRIES } from '../scraper-config.js';

const cache = new Map<string, { results: FlightResult[]; timestamp: number }>();
const DISK_DIR = process.env.SCRAPER_CACHE_DIR || '';

function diskPath(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DISK_DIR, `${safeKey}.json`);
}

/**
 * Evict expired entries, then oldest entries if still over max size.
 */
function evictIfNeeded(): void {
  // First pass: remove expired
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }

  // Second pass: if still over limit, remove oldest by timestamp
  if (cache.size > CACHE_MAX_ENTRIES) {
    const entries = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = cache.size - CACHE_MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      cache.delete(entries[i][0]);
    }
  }
}

export function getCached(key: string): FlightResult[] | null {
  // Fast path: in-memory
  const entry = cache.get(key);
  if (entry) {
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      cache.delete(key);
    } else {
      return entry.results;
    }
  }

  // Disk fallback (opt-in)
  if (DISK_DIR) {
    try {
      const fp = diskPath(key);
      if (fs.existsSync(fp)) {
        const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        if (Date.now() - data.timestamp <= CACHE_TTL_MS) {
          cache.set(key, { results: data.results, timestamp: data.timestamp });
          return data.results;
        }
      }
    } catch (e: any) {
      console.warn(`[Cache] Disk read error for ${key}: ${e.message}`);
    }
  }

  return null;
}

export function setCache(key: string, results: FlightResult[]): void {
  const timestamp = Date.now();
  cache.set(key, { results, timestamp });

  // Evict if over limit
  evictIfNeeded();

  // Persist to disk if configured
  if (DISK_DIR) {
    try {
      if (!fs.existsSync(DISK_DIR)) {
        fs.mkdirSync(DISK_DIR, { recursive: true });
      }
      atomicWriteFileSync(diskPath(key), JSON.stringify({ results, timestamp }));
    } catch (e: any) {
      console.warn(`[Cache] Disk write error for ${key}: ${e.message}`);
    }
  }
}

/** Get current cache stats for health monitoring */
export function getCacheStats(): { size: number; maxSize: number } {
  return { size: cache.size, maxSize: CACHE_MAX_ENTRIES };
}
