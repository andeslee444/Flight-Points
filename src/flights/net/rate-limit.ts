/**
 * Rate-limit & retry etiquette for a SHARED proxy IP.
 *
 * All scrapers funnel through a single Oracle Cloud VPS SOCKS5 proxy
 * (PROXY_URL=socks5://127.0.0.1:1081). If multiple scrapers hammer the same
 * upstream host through that one egress IP — or all retry in lockstep after a
 * 429 — the IP gets flagged and every scraper suffers. This module provides the
 * three primitives needed to be a good citizen on a shared IP:
 *
 *   1. fullJitterBackoff — randomized exponential backoff so parallel retries
 *      DON'T synchronize into a thundering herd.
 *   2. TokenBucket — a per-host request-rate governor (cap requests/sec).
 *   3. parseRetryAfter / nextDelayMs — honor a server's explicit Retry-After
 *      header instead of guessing, when the server tells us how long to wait.
 */

/** Injectable RNG so tests can be deterministic. Returns a float in [0, 1). */
export type Rng = () => number;

/**
 * AWS-style "full jitter" backoff.
 *
 * Returns a delay uniformly random in [0, min(capMs, baseMs * 2^attempt)].
 * Using the FULL range (not equal-jitter / decorrelated) maximizes spread, so
 * N clients that all failed at the same instant scatter their retries across
 * the whole window rather than clumping — which is exactly what protects a
 * shared egress IP from a synchronized retry burst.
 *
 * @param attempt  Zero-based retry attempt number (0 for the first retry).
 * @param baseMs   Base delay; the exponential window doubles each attempt.
 * @param capMs    Hard ceiling on the window (prevents unbounded growth).
 * @param rng      Injectable RNG (defaults to Math.random) for deterministic tests.
 */
export function fullJitterBackoff(
  attempt: number,
  baseMs = 1000,
  capMs = 60000,
  rng: Rng = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  // 2^attempt can overflow to Infinity for large attempts; clamp to cap first.
  const exp = safeAttempt >= 31 ? capMs : baseMs * 2 ** safeAttempt;
  const window = Math.min(capMs, exp);
  return Math.floor(rng() * window);
}

/**
 * Per-host request-rate governor.
 *
 * Classic token bucket: refills at `ratePerSec` tokens/second up to `burst`
 * tokens. `take()` consumes one token, resolving immediately if one is
 * available, otherwise waiting until the bucket refills enough to grant it.
 * This caps the sustained request rate to a single upstream host while still
 * allowing a short burst (so we don't artificially serialize independent calls).
 */
export class TokenBucket {
  private readonly ratePerSec: number;
  private readonly burst: number;
  private tokens: number;
  private lastRefill: number;

  constructor(ratePerSec: number, burst: number) {
    if (ratePerSec <= 0) throw new Error('ratePerSec must be > 0');
    if (burst <= 0) throw new Error('burst must be > 0');
    this.ratePerSec = ratePerSec;
    this.burst = burst;
    this.tokens = burst; // start full so the initial burst is allowed
    this.lastRefill = Date.now();
  }

  /** Refill tokens based on elapsed wall-clock time since the last refill. */
  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.ratePerSec);
    this.lastRefill = now;
  }

  /**
   * Acquire one token. Resolves immediately if a token is available, otherwise
   * waits (real timer) until the bucket has refilled enough to grant it.
   */
  async take(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Wait for the deficit to refill. Need (1 - tokens) more tokens.
    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil((deficit / this.ratePerSec) * 1000);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    // After the wait we should have >= 1; consume it (clamp guards rounding).
    this.tokens = Math.max(0, this.tokens - 1);
  }
}

/**
 * Parse an HTTP `Retry-After` header value into milliseconds.
 *
 * Supports both forms from RFC 7231:
 *   - delta-seconds:  "120"        -> 120000
 *   - HTTP-date:      "Wed, 21 Oct 2026 07:28:00 GMT" -> ms until that instant
 *
 * Returns null if the value is missing or unparseable. A past HTTP-date clamps
 * to 0 (don't wait a negative amount).
 *
 * @param headerValue  Raw header value (may be null/undefined).
 * @param now          Reference time for HTTP-date math (defaults to Date.now()).
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (headerValue == null) return null;
  const trimmed = headerValue.trim();
  if (trimmed === '') return null;

  // delta-seconds: a bare non-negative integer.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date.
  const ts = Date.parse(trimmed);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, ts - now);
}

/**
 * Decide how long to wait before the next retry.
 *
 * If the server sent a valid `Retry-After`, HONOR IT — the server is telling us
 * exactly when it'll accept traffic again, which beats any client-side guess and
 * keeps a shared IP off the naughty list. Otherwise fall back to full-jitter
 * exponential backoff.
 *
 * @param attempt           Zero-based retry attempt number.
 * @param retryAfterHeader  Raw Retry-After header value, if any.
 * @param baseMs            Backoff base (passed through to fullJitterBackoff).
 * @param capMs             Backoff cap (passed through to fullJitterBackoff).
 * @param rng               Injectable RNG for deterministic tests.
 */
export function nextDelayMs(
  attempt: number,
  retryAfterHeader?: string | null,
  baseMs = 1000,
  capMs = 60000,
  rng: Rng = Math.random,
): number {
  const retryAfter = parseRetryAfter(retryAfterHeader);
  if (retryAfter !== null) return retryAfter;
  return fullJitterBackoff(attempt, baseMs, capMs, rng);
}
