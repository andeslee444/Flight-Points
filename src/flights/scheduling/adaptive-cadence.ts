/**
 * Adaptive cadence controllers.
 *
 * Two coupled, pure, in-memory controllers that decide HOW HARD and HOW OFTEN to
 * scrape each award-flight source. Both are clock-free: the caller drives them by
 * reporting outcomes (success / block) or by passing an observation per route, so
 * they are trivially testable without timers, network, or DB.
 *
 * 1. HostConcurrency — per-HOST AIMD (Additive-Increase / Multiplicative-Decrease)
 *    concurrency cap. The classic congestion-control sawtooth: probe upward one
 *    step at a time while things are healthy, slam down by a factor the instant a
 *    host pushes back (403 / 429 / captcha / soft-block). Converges to the
 *    sustainable concurrency a host tolerates without ever exceeding [min, max].
 *
 * 2. RouteCadence — per-ROUTE poll interval. Hot routes (volatile miles, sitting
 *    near a sweet-spot, or whose miles just changed) tighten toward a short
 *    interval so deals are caught fast; cold/flat routes relax geometrically
 *    toward a long interval so we don't burn scrapes. Always clamped.
 */

/** Clamp a value to [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// 1. Per-host AIMD concurrency
// ---------------------------------------------------------------------------

export interface HostConcurrencyOptions {
  /** Floor for the concurrency cap. Default 1. */
  min?: number;
  /** Ceiling for the concurrency cap. Default 8. */
  max?: number;
  /** How many slots to add per healthy success (additive increase). Default 1. */
  additiveStep?: number;
  /** Factor applied on a block signal (multiplicative decrease). Default 0.5. */
  multiplicativeFactor?: number;
  /** Optional starting cap (defaults to min — probe up from the floor). */
  start?: number;
}

export const DEFAULT_HOST_MIN = 1;
export const DEFAULT_HOST_MAX = 8;
export const DEFAULT_ADDITIVE_STEP = 1;
export const DEFAULT_MULTIPLICATIVE_FACTOR = 0.5;

/**
 * AIMD concurrency limiter for a single host.
 *
 * onSuccess() additively raises the cap (+step, clamped at max).
 * onBlock()   multiplicatively lowers it (×factor, floored at min).
 * current()   returns the integer cap currently allowed.
 *
 * Internally the cap is tracked as a float so repeated decreases compose
 * correctly (e.g. 8 → 4 → 2 → 1), but current() always exposes a floored
 * integer >= min so callers get a usable slot count.
 */
export class HostConcurrency {
  private readonly min: number;
  private readonly max: number;
  private readonly step: number;
  private readonly factor: number;
  /** Float backing value; current() floors it. */
  private cap: number;

  constructor(opts: HostConcurrencyOptions = {}) {
    this.min = opts.min ?? DEFAULT_HOST_MIN;
    this.max = opts.max ?? DEFAULT_HOST_MAX;
    this.step = opts.additiveStep ?? DEFAULT_ADDITIVE_STEP;
    this.factor = opts.multiplicativeFactor ?? DEFAULT_MULTIPLICATIVE_FACTOR;

    if (this.max < this.min) {
      throw new Error(`HostConcurrency: max (${this.max}) must be >= min (${this.min})`);
    }
    if (this.step <= 0) {
      throw new Error(`HostConcurrency: additiveStep (${this.step}) must be > 0`);
    }
    if (this.factor <= 0 || this.factor >= 1) {
      throw new Error(`HostConcurrency: multiplicativeFactor (${this.factor}) must be in (0,1)`);
    }

    const start = opts.start ?? this.min;
    this.cap = clamp(start, this.min, this.max);
  }

  /** Additive increase: a healthy response nudges the cap up by one step. */
  onSuccess(): void {
    this.cap = clamp(this.cap + this.step, this.min, this.max);
  }

  /** Multiplicative decrease: a block (403/429/captcha/soft-block) cuts the cap. */
  onBlock(): void {
    this.cap = clamp(this.cap * this.factor, this.min, this.max);
  }

  /** Current integer concurrency cap (>= min, <= max). */
  current(): number {
    // Floor the float backing value, but never report below min.
    return Math.max(this.min, Math.floor(this.cap));
  }

  /** Raw float cap — exposed for tests / introspection. */
  rawCap(): number {
    return this.cap;
  }
}

// ---------------------------------------------------------------------------
// 2. Per-route poll cadence
// ---------------------------------------------------------------------------

export interface RouteCadenceOptions {
  /** Shortest allowed interval. Default 5 min. */
  minMs?: number;
  /** Longest allowed interval. Default 24 h. */
  maxMs?: number;
  /** Baseline interval a fresh route starts at. Default 30 min. */
  baseMs?: number;
  /** Geometric relax factor per stable observation (>1). Default 1.5. */
  relaxFactor?: number;
  /** Geometric tighten factor per hot observation (in (0,1)). Default 0.5. */
  tightenFactor?: number;
}

export const DEFAULT_ROUTE_MIN_MS = 5 * 60 * 1000; // 5 min
export const DEFAULT_ROUTE_MAX_MS = 24 * 60 * 60 * 1000; // 24 h
export const DEFAULT_ROUTE_BASE_MS = 30 * 60 * 1000; // 30 min
export const DEFAULT_RELAX_FACTOR = 1.5;
export const DEFAULT_TIGHTEN_FACTOR = 0.5;

/** Signal describing the latest observation of a route. */
export interface RouteSignal {
  /** Normalized miles volatility, 0 (flat) .. 1 (highly volatile). */
  volatility: number;
  /** True if the route sits near a sweet-spot threshold (a flip = a deal alert). */
  nearDeal: boolean;
  /** True if the route's miles changed since the last observation. */
  lastChanged: boolean;
}

/**
 * Adaptive poll-interval controller for a single route.
 *
 * Stateful: it remembers the last interval and adjusts from there so that
 * repeated stable observations RELAX the cadence geometrically toward maxMs,
 * while any hot signal (volatile / nearDeal / lastChanged) TIGHTENS it toward
 * minMs. The amount of tighten scales with volatility so a wildly churning
 * route snaps almost to the floor in one step.
 *
 * nextInterval(signal) advances the internal state and returns the new interval.
 * peek() returns the current interval without advancing.
 */
export class RouteCadence {
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly baseMs: number;
  private readonly relaxFactor: number;
  private readonly tightenFactor: number;
  /** Current interval (ms). Starts at baseMs. */
  private intervalMs: number;

  constructor(opts: RouteCadenceOptions = {}) {
    this.minMs = opts.minMs ?? DEFAULT_ROUTE_MIN_MS;
    this.maxMs = opts.maxMs ?? DEFAULT_ROUTE_MAX_MS;
    this.baseMs = opts.baseMs ?? DEFAULT_ROUTE_BASE_MS;
    this.relaxFactor = opts.relaxFactor ?? DEFAULT_RELAX_FACTOR;
    this.tightenFactor = opts.tightenFactor ?? DEFAULT_TIGHTEN_FACTOR;

    if (this.maxMs < this.minMs) {
      throw new Error(`RouteCadence: maxMs (${this.maxMs}) must be >= minMs (${this.minMs})`);
    }
    if (this.relaxFactor <= 1) {
      throw new Error(`RouteCadence: relaxFactor (${this.relaxFactor}) must be > 1`);
    }
    if (this.tightenFactor <= 0 || this.tightenFactor >= 1) {
      throw new Error(`RouteCadence: tightenFactor (${this.tightenFactor}) must be in (0,1)`);
    }

    this.intervalMs = clamp(this.baseMs, this.minMs, this.maxMs);
  }

  /** True if a signal counts as "hot" (anything that warrants tightening). */
  private isHot(signal: RouteSignal): boolean {
    const v = clamp(signal.volatility, 0, 1);
    return v > 0 || signal.nearDeal || signal.lastChanged;
  }

  /**
   * Advance the controller with the latest observation and return the new
   * poll interval (ms).
   *
   * Hot observation → tighten geometrically toward minMs. The effective tighten
   * factor interpolates from a gentle nudge (low volatility, but nearDeal/
   * lastChanged) down to the full tightenFactor at volatility=1, so a violently
   * churning route drops fastest.
   *
   * Stable observation (flat, not near a deal, unchanged) → relax geometrically
   * toward maxMs.
   *
   * Result is always clamped to [minMs, maxMs].
   */
  nextInterval(signal: RouteSignal): number {
    if (this.isHot(signal)) {
      const v = clamp(signal.volatility, 0, 1);
      // At v=1 use full tightenFactor; at v=0 (but hot via nearDeal/lastChanged)
      // use a milder factor halfway between 1 and tightenFactor.
      const mildFactor = (1 + this.tightenFactor) / 2;
      const effectiveFactor = mildFactor + (this.tightenFactor - mildFactor) * v;
      this.intervalMs = clamp(this.intervalMs * effectiveFactor, this.minMs, this.maxMs);
    } else {
      this.intervalMs = clamp(this.intervalMs * this.relaxFactor, this.minMs, this.maxMs);
    }
    return this.intervalMs;
  }

  /** Current interval without advancing state. */
  peek(): number {
    return this.intervalMs;
  }
}
