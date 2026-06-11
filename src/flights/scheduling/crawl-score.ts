/**
 * Crawl-score PRIORITY model.
 *
 * The daemon can only afford a bounded number of searches per 30-minute cycle
 * (see flight-daemon.ts rotation). Plain round-robin wastes that budget on cold
 * routes nobody watches while hot, deal-likely, stale routes wait their turn.
 * This module assigns each route a scalar priority so the scheduler can scrape
 * the routes that matter SOONER.
 *
 * Higher score = scrape sooner. Pure function, no I/O, deterministic.
 *
 * Documented weighted formula:
 *
 *   score = userDemand        * W_DEMAND
 *         + milesVolatility   * W_VOLATILITY
 *         + dealLikelihood    * W_DEAL
 *         + saturate(staleness) * W_STALENESS
 *
 * All four input signals are normalized to 0..1 before weighting so the weights
 * alone express their relative importance. Staleness arrives in hours and is run
 * through a saturating curve (diminishing returns) so a route that has been cold
 * for 3 days does not infinitely dominate one cold for 1 day.
 *
 * Weighting intent: demand is the dominant signal — we exist to serve the people
 * actually watching a route. A heavily-watched route that was just scraped should
 * still outrank an unwatched route that is merely stale; W_DEMAND is sized to make
 * that hold (see the proof test). The remaining weights break ties and surface
 * routes that are about to produce a deal even before anyone is watching them.
 *
 * Created: 2026-06-11
 */

/** A single route's priority signals, all normalized to 0..1 except staleness. */
export interface CrawlScoreInput {
  /** 0..1 — fraction of max watcher interest, derived from #signups watching. */
  userDemand: number;
  /** 0..1 — recent miles-price stddev normalized; volatile routes hide deals. */
  milesVolatility: number;
  /** 0..1 — how far below the sweet-spot threshold current pricing sits. */
  dealLikelihood: number;
  /** Hours since the last SUCCESSFUL scrape of this route (>= 0). */
  stalenessHours: number;
}

/** Tunable weights for the crawl-score formula. Exported so callers/tests can read intent. */
export interface CrawlScoreWeights {
  demand: number;
  volatility: number;
  deal: number;
  staleness: number;
  /**
   * Staleness half-saturation point in hours: at this many hours the saturating
   * staleness term reaches 0.5 of its max. Controls diminishing returns.
   */
  stalenessHalfLifeHours: number;
}

/**
 * Default weights. demand dominates (see weighting intent above): it is larger
 * than any single other weight AND larger than the max staleness contribution,
 * so a fully-watched fresh route beats an unwatched maximally-stale one.
 */
export const DEFAULT_WEIGHTS: CrawlScoreWeights = {
  demand: 0.45,
  volatility: 0.15,
  deal: 0.25,
  staleness: 0.15,
  stalenessHalfLifeHours: 6,
};

/** Clamp a value into [0, 1]. */
function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Saturating transform for staleness hours → 0..1.
 *
 * Uses h / (h + halfLife): monotonically increasing in h, 0 at h=0, 0.5 at
 * h=halfLife, asymptotes to 1. Guarantees "more stale never lowers priority"
 * while preventing ancient routes from infinitely starving everything else.
 */
export function saturateStaleness(hours: number, halfLifeHours: number): number {
  const h = hours > 0 ? hours : 0;
  const hl = halfLifeHours > 0 ? halfLifeHours : 1;
  return h / (h + hl);
}

/**
 * Compute the crawl priority for one route. Higher = scrape sooner.
 *
 * Pure and total: NaN / out-of-range inputs are clamped, negative staleness is
 * floored at 0. The output is a weighted sum; with DEFAULT_WEIGHTS it lands in
 * roughly [0, 1] (it cannot exceed the sum of the four non-half-life weights).
 */
export function crawlScore(input: CrawlScoreInput, opts?: Partial<CrawlScoreWeights>): number {
  const w: CrawlScoreWeights = { ...DEFAULT_WEIGHTS, ...opts };

  const demand = clamp01(input.userDemand);
  const volatility = clamp01(input.milesVolatility);
  const deal = clamp01(input.dealLikelihood);
  const staleness = saturateStaleness(input.stalenessHours, w.stalenessHalfLifeHours);

  return (
    demand * w.demand +
    volatility * w.volatility +
    deal * w.deal +
    staleness * w.staleness
  );
}

/** A route to rank: an opaque key plus the score inputs. */
export type RankableRoute = { key: string } & CrawlScoreInput;

/**
 * Rank routes by crawl priority, returning their keys in descending score order
 * (hottest first). Ties broke deterministically by key (ascending) so the order
 * is stable regardless of input ordering.
 */
export function rankRoutes(routes: RankableRoute[], opts?: Partial<CrawlScoreWeights>): string[] {
  return routes
    .map((r) => ({ key: r.key, score: crawlScore(r, opts) }))
    .sort((a, b) => (b.score - a.score) || a.key.localeCompare(b.key))
    .map((r) => r.key);
}
