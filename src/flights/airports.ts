/**
 * Shared Airport Region Definitions
 * Canonical sets used by daemon, sweet-spots, and monitor for route classification.
 *
 * Note: Scraper-local airport sets in ana.ts and singapore.ts stay untouched —
 * they serve zone-based award chart lookups with different compositions.
 *
 * Created: 2026-02-17
 */

// ============================================================
// CANONICAL REGION SETS
// ============================================================

export const US_AIRPORTS = new Set([
  'JFK', 'EWR', 'LGA', 'LAX', 'SFO', 'ORD', 'IAD', 'DFW', 'ATL', 'BOS',
  'SEA', 'MIA', 'IAH', 'DEN', 'PHX',
]);

export const EUROPE_AIRPORTS = new Set([
  'LHR', 'CDG', 'FRA', 'AMS', 'FCO', 'MAD', 'BCN', 'MUC', 'ZRH', 'VIE',
  'CPH', 'ARN', 'OSL', 'HEL', 'DUB', 'LIS', 'ATH', 'IST', 'WAW', 'PRG',
  'BRU', 'GVA',
]);

export const JAPAN_AIRPORTS = new Set([
  'NRT', 'HND', 'KIX', 'NGO', 'FUK', 'CTS', 'OKA',
]);

export const KOREA_AIRPORTS = new Set(['ICN', 'GMP']);

export const CHINA_HK_TW_AIRPORTS = new Set(['PEK', 'PVG', 'HKG', 'TPE']);

export const SEA_AIRPORTS = new Set([
  'SIN', 'BKK', 'MNL', 'SGN', 'HAN', 'KUL',
]);

export const INDIA_AIRPORTS = new Set(['DEL', 'BOM', 'BLR']);

export const MIDDLE_EAST_AIRPORTS = new Set(['DOH', 'DXB', 'AUH', 'JED', 'RUH']);

export const AUSTRALIA_NZ_AIRPORTS = new Set(['SYD', 'MEL', 'BNE', 'PER', 'AKL']);

/** Union of all Asian sub-regions */
export const ASIA_AIRPORTS = new Set([
  ...JAPAN_AIRPORTS,
  ...KOREA_AIRPORTS,
  ...CHINA_HK_TW_AIRPORTS,
  ...SEA_AIRPORTS,
  ...INDIA_AIRPORTS,
]);

// ============================================================
// HELPER FUNCTIONS
// ============================================================

type Region =
  | 'US' | 'Europe' | 'Japan' | 'Korea' | 'China/HK/TW'
  | 'SEA' | 'India' | 'Middle East' | 'Australia/NZ' | 'Unknown';

const REGION_MAP: Array<[Set<string>, Region]> = [
  [US_AIRPORTS, 'US'],
  [EUROPE_AIRPORTS, 'Europe'],
  [JAPAN_AIRPORTS, 'Japan'],
  [KOREA_AIRPORTS, 'Korea'],
  [CHINA_HK_TW_AIRPORTS, 'China/HK/TW'],
  [SEA_AIRPORTS, 'SEA'],
  [INDIA_AIRPORTS, 'India'],
  [MIDDLE_EAST_AIRPORTS, 'Middle East'],
  [AUSTRALIA_NZ_AIRPORTS, 'Australia/NZ'],
];

export function getRegion(code: string): Region {
  for (const [set, region] of REGION_MAP) {
    if (set.has(code)) return region;
  }
  return 'Unknown';
}

export function isTransatlantic(origin: string, destination: string): boolean {
  const oUS = US_AIRPORTS.has(origin);
  const dUS = US_AIRPORTS.has(destination);
  const oEU = EUROPE_AIRPORTS.has(origin);
  const dEU = EUROPE_AIRPORTS.has(destination);
  return (oUS && dEU) || (oEU && dUS);
}

export function isToAsia(origin: string, destination: string): boolean {
  return US_AIRPORTS.has(origin) && ASIA_AIRPORTS.has(destination);
}

export function isInternational(origin: string, destination: string): boolean {
  const oUS = US_AIRPORTS.has(origin);
  const dUS = US_AIRPORTS.has(destination);
  return (oUS && !dUS) || (!oUS && dUS);
}

/** Canonical region display labels for use in transfer partner sweet spot descriptions */
export const REGION_LABELS: Record<string, string> = {
  Japan: 'Japan', Europe: 'Europe', 'Middle East': 'Middle East',
  Singapore: 'Singapore', Asia: 'Asia', US: 'US', RTW: 'Round the World',
  Korea: 'Korea', 'China/HK/TW': 'China/HK/TW', SEA: 'Southeast Asia',
  India: 'India', 'Australia/NZ': 'Australia/NZ',
};
