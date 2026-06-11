/**
 * Per-Route Baseline Soft-Block Detection
 *
 * Extends silent-zero detection (which only catches "0 results returned") to
 * catch SOFT breaks: a scraper that still returns *some* results, but
 * suspiciously fewer than usual, or whose parsed fields have drifted into
 * garbage (e.g. an Angular/SvelteKit DOM change that makes the parser capture
 * blank/zero miles, or that drops most rows).
 *
 * The idea: maintain a rolling baseline per (scraperKey, routeKey). When a new
 * observation arrives, compare it to the recent history:
 *   - COUNT DROP — result count collapses far below the historical median.
 *   - FIELD DRIFT — sampled miles values fall outside the historical range, or
 *     go all-identical/zero when history showed variety (parser capturing blanks).
 *
 * Cold-start safe: with fewer than MIN_BASELINE_OBS history points we never
 * flag, because a tiny baseline can't distinguish a real regression from noise.
 *
 * Purely in-memory (Map), no network/DB — mirrors scraper-health.ts.
 */

/** Default rolling window length (number of recent observations retained). */
export const DEFAULT_WINDOW = 10;

/** Minimum baseline observations required before any anomaly can fire. */
export const MIN_BASELINE_OBS = 3;

/**
 * A current count below DEFAULT_DROP_FACTOR * (baseline median count) is a drop.
 * 0.25 → flag when current is less than a quarter of the typical count.
 */
export const DEFAULT_DROP_FACTOR = 0.25;

/**
 * Baseline median count must be at least this high for a count-drop to be
 * meaningful. Avoids flagging routes that are naturally low-volume (e.g. a
 * route that usually returns 1-3 award seats).
 */
export const COUNT_FLOOR = 5;

/** A single recorded observation for a route. */
export interface Observation {
  /** Number of flight results returned for this route. */
  count: number;
  /** A sample of miles values from the results (used for field-drift checks). */
  sampleMiles: number[];
}

export interface AnomalyResult {
  anomaly: boolean;
  reasons: string[];
}

export interface CheckOptions {
  windowSize?: number;
  minBaselineObs?: number;
  dropFactor?: number;
  countFloor?: number;
}

/** Key = `${scraperKey}::${routeKey}` → rolling list of observations. */
const baselines = new Map<string, Observation[]>();

function baselineKey(scraperKey: string, routeKey: string): string {
  return `${scraperKey}::${routeKey}`;
}

/** Median of a numeric array (returns 0 for empty input). */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Append an observation to the rolling baseline for a route, trimming to the
 * window size. Call this for observations you trust as "normal" (e.g. after a
 * scraper run that passed other health checks), so the baseline reflects
 * healthy behavior.
 */
export function recordObservation(
  scraperKey: string,
  routeKey: string,
  obs: Observation,
  windowSize: number = DEFAULT_WINDOW,
): void {
  const key = baselineKey(scraperKey, routeKey);
  const list = baselines.get(key) ?? [];
  list.push({ count: obs.count, sampleMiles: [...obs.sampleMiles] });
  // Trim oldest entries beyond the window.
  while (list.length > windowSize) list.shift();
  baselines.set(key, list);
}

/**
 * Compare a current observation against the rolling baseline and report
 * anomalies a plain zero-check would miss.
 *
 * Returns { anomaly: false, reasons: [] } during cold start (fewer than
 * minBaselineObs history points).
 */
export function checkAnomaly(
  scraperKey: string,
  routeKey: string,
  current: Observation,
  opts: CheckOptions = {},
): AnomalyResult {
  const minBaselineObs = opts.minBaselineObs ?? MIN_BASELINE_OBS;
  const dropFactor = opts.dropFactor ?? DEFAULT_DROP_FACTOR;
  const countFloor = opts.countFloor ?? COUNT_FLOOR;

  const history = baselines.get(baselineKey(scraperKey, routeKey)) ?? [];

  // Cold start: not enough baseline to judge anything. Never flag.
  if (history.length < minBaselineObs) {
    return { anomaly: false, reasons: [] };
  }

  const reasons: string[] = [];

  // ---- (a) COUNT DROP -----------------------------------------------------
  const baselineMedianCount = median(history.map((o) => o.count));
  if (
    baselineMedianCount >= countFloor &&
    current.count < dropFactor * baselineMedianCount
  ) {
    reasons.push(
      `count dropped from ~${Math.round(baselineMedianCount)} to ${current.count}`,
    );
  }

  // ---- (b) FIELD DRIFT (miles) -------------------------------------------
  // Gather historical miles values (ignore non-finite junk).
  const histMiles = history
    .flatMap((o) => o.sampleMiles)
    .filter((m) => Number.isFinite(m));

  if (histMiles.length > 0 && current.sampleMiles.length > 0) {
    const histMin = Math.min(...histMiles);
    const histMax = Math.max(...histMiles);
    // Did history actually vary, or were past miles essentially constant?
    const historyVaried = histMax > histMin && histMax > 0;

    // Acceptable band: generous (half the min to double the max). Anything
    // outside this is suspicious — likely a parser mis-capture.
    const lowerBand = histMin * 0.5;
    const upperBand = histMax * 2;

    const curFinite = current.sampleMiles.filter((m) => Number.isFinite(m));

    // Blank/zero capture: parser returning zero/blank miles where history
    // previously varied → the field stopped being parsed. We treat any
    // current value <= 0 (or below the lower band) as a blank signature, and
    // also the degenerate "multiple values all identical to each other yet
    // outside the historical band" case (parser stamping one constant).
    const hasZeroOrBlank = curFinite.some((m) => m <= 0);
    const collapsedConstant =
      historyVaried &&
      curFinite.length > 1 &&
      curFinite.every((m) => m === curFinite[0]) &&
      (curFinite[0] < lowerBand || curFinite[0] > upperBand);

    // Range check: any current value far outside the generous historical band.
    const outOfRange = curFinite.some((m) => m < lowerBand || m > upperBand);

    if ((historyVaried && hasZeroOrBlank) || collapsedConstant || outOfRange) {
      reasons.push(
        `miles out of historical range (parser may be capturing blanks)`,
      );
    }
  }

  return { anomaly: reasons.length > 0, reasons };
}

/**
 * Inspect the current in-memory baselines. Returns a plain object keyed by
 * `${scraperKey}::${routeKey}` for logging/diagnostics.
 */
export function getBaselines(): Record<string, Observation[]> {
  const out: Record<string, Observation[]> = {};
  for (const [key, list] of baselines.entries()) {
    out[key] = list.map((o) => ({ count: o.count, sampleMiles: [...o.sampleMiles] }));
  }
  return out;
}

/** Clear all baselines (primarily for tests). */
export function resetBaselines(): void {
  baselines.clear();
}
