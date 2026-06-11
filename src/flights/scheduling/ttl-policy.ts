/**
 * Volatility-keyed TTL policy.
 *
 * Award availability for some routes changes constantly (high miles volatility,
 * or sitting right at a sweet-spot threshold where a small move flips a deal on
 * or off). Those routes should be re-scraped FREQUENTLY, so they get a SHORT
 * cache TTL. Flat, boring routes get a LONG TTL so we don't waste scrapes.
 *
 * The result is always clamped to [minMs, maxMs] and is monotonically
 * non-increasing in volatility (more volatile → shorter or equal TTL).
 */

/** Default base TTL for a route with zero volatility (and not near a sweet spot). */
export const DEFAULT_BASE_MS = 30 * 60 * 1000; // 30 min
/** Default floor: never cache shorter than this. */
export const DEFAULT_MIN_MS = 5 * 60 * 1000; // 5 min
/** Default ceiling: never cache longer than this. */
export const DEFAULT_MAX_MS = 6 * 60 * 60 * 1000; // 6 h

/**
 * Multiplier applied when a route sits near a sweet-spot threshold. < 1 because
 * near-sweet-spot routes are higher-value to keep fresh (a flip is a deal alert).
 */
export const NEAR_SWEET_SPOT_FACTOR = 0.5;

export interface TtlRouteInput {
  /** Normalized miles volatility, 0 (flat) .. 1 (highly volatile). */
  milesVolatility: number;
  /** True if the route's price is close to a sweet-spot threshold. */
  nearSweetSpot: boolean;
}

export interface TtlOptions {
  minMs?: number;
  maxMs?: number;
  baseMs?: number;
}

/** Clamp helper. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute the cache TTL (ms) for a route given its volatility profile.
 *
 * Mechanism:
 *   1. Clamp volatility to [0,1].
 *   2. TTL scales DOWN linearly with volatility: at v=0 → baseMs, at v=1 → minMs.
 *   3. Near-sweet-spot routes get an extra shortening factor.
 *   4. Final value clamped to [minMs, maxMs].
 *
 * Properties (relied on by ttl-policy.test.ts):
 *   - ttl(volatile/near) < ttl(flat/far)
 *   - monotonically non-increasing in volatility
 *   - always within [minMs, maxMs]
 */
export function ttlForRoute(input: TtlRouteInput, opts: TtlOptions = {}): number {
  const minMs = opts.minMs ?? DEFAULT_MIN_MS;
  const maxMs = opts.maxMs ?? DEFAULT_MAX_MS;
  const baseMs = opts.baseMs ?? DEFAULT_BASE_MS;

  const v = clamp(input.milesVolatility, 0, 1);

  // Linear interpolation from baseMs (flat) toward minMs (fully volatile).
  // span is non-negative as long as baseMs >= minMs (the sane configuration);
  // if a caller passes baseMs < minMs the final clamp still keeps us in range.
  const span = baseMs - minMs;
  let ttl = baseMs - v * span;

  // Near a sweet spot: shorten further (deals here are worth re-checking).
  if (input.nearSweetSpot) {
    ttl *= NEAR_SWEET_SPOT_FACTOR;
  }

  return clamp(ttl, minMs, maxMs);
}
