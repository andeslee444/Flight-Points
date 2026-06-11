/**
 * Cost-aware scheduling: treat proxy GB + browser-hours as a first-class BUDGET.
 *
 * Every scrape costs real money, and the cost is dominated by which execution
 * tier we pick. A datacenter curl_cffi hit is fractions of a cent; a residential
 * proxy, a mobile proxy, or a cloud headful-browser session can be 50-1000x more.
 * If we always reached for the priciest tier "to be safe" we would burn the whole
 * monthly proxy/compute budget on cold routes nobody watches.
 *
 * This module models that budget so the scheduler can:
 *   - ALWAYS prefer the cheapest tier that can plausibly clear the site's defenses;
 *   - ESCALATE to a pricier tier ONLY for high-priority routes AND only while
 *     budget remains;
 *   - DEGRADE back to the cheapest tier once the monthly ceiling is hit — we never
 *     BLOCK scraping (a cheap attempt that might fail beats no attempt), we just
 *     stop PAYING for premium.
 *
 * Pure + in-memory: costs are injected as constants, spend is tracked in a plain
 * counter. No real metering, no I/O, deterministic.
 *
 * Created: 2026-06-11
 */

/** Execution / proxy tiers, cheapest → priciest. */
export type CostTier =
  | 'datacenter-curlffi' // HTTP-only via cheap datacenter IP + TLS impersonation
  | 'datacenter-browser' // headless browser over a datacenter proxy
  | 'residential' // residential proxy (much pricier per GB, harder to block)
  | 'mobile' // mobile/4G proxy — priciest IP, best reputation
  | 'cloud-browser'; // hosted headful browser session (CPU + residential egress)

/** The kind of bot defense a route's airline puts up. */
export type ScraperDifficulty = 'public' | 'akamai' | 'auth';

/**
 * Rough $/job by tier. These are intentionally order-of-magnitude estimates of
 * the marginal cost of ONE scrape job at that tier (proxy egress + compute),
 * not a billed price. The ONLY contract that matters is the strict ordering:
 *   datacenter-curlffi < datacenter-browser < residential < mobile < cloud-browser
 * Callers/tests rely on that ordering to reason about "cheapest" vs "pricier".
 */
export const COST_PER_TIER: Readonly<Record<CostTier, number>> = Object.freeze({
  'datacenter-curlffi': 0.002, // ~half a cent — a curl_cffi request, tiny egress
  'datacenter-browser': 0.02, // headless browser, more egress + a little CPU
  residential: 0.15, // residential GB is ~$10-15/GB; a JS-heavy page burns it
  mobile: 0.45, // mobile proxies are the priciest IP class
  'cloud-browser': 0.9, // hosted headful browser: CPU-seconds + residential egress
});

/** Tiers ordered cheapest → priciest (single source of truth for "escalate"). */
export const TIER_ORDER: readonly CostTier[] = Object.freeze([
  'datacenter-curlffi',
  'datacenter-browser',
  'residential',
  'mobile',
  'cloud-browser',
]);

/** The cheapest tier — the universal fallback we degrade to when broke. */
export const CHEAPEST_TIER: CostTier = TIER_ORDER[0];

/**
 * The CHEAPEST tier that can *plausibly* clear each difficulty class on its own.
 * This is the "always prefer the cheapest that can work" baseline, before any
 * priority-driven escalation.
 *
 *  - public : a curl_cffi datacenter hit is plenty (no JS challenge).
 *  - akamai : needs a real browser to pass the _abck JS sensor; datacenter
 *             browser is the cheapest thing that *might* work.
 *  - auth   : login flows are flakier and IP-reputation-sensitive, so the cheap
 *             baseline is a real browser too (still the cheapest browser tier).
 */
export const BASELINE_TIER_FOR_DIFFICULTY: Readonly<Record<ScraperDifficulty, CostTier>> = Object.freeze({
  public: 'datacenter-curlffi',
  akamai: 'datacenter-browser',
  auth: 'datacenter-browser',
});

/**
 * The pricier tier we ESCALATE to for a high-priority route of each difficulty,
 * when budget allows. Public routes never need to escalate (a cheap hit works),
 * so they stay at their baseline. Akamai/auth routes escalate to a higher-
 * reputation proxy that is materially more likely to succeed on a hard route.
 */
export const ESCALATION_TIER_FOR_DIFFICULTY: Readonly<Record<ScraperDifficulty, CostTier>> = Object.freeze({
  public: 'datacenter-curlffi', // already cheap & sufficient — nothing to escalate to
  akamai: 'residential', // residential IP beats a flagged datacenter range
  auth: 'mobile', // login flows do best on pristine mobile IP reputation
});

/** Default priority at/above which we are willing to spend more on a hard route. */
export const DEFAULT_ESCALATION_PRIORITY_THRESHOLD = 0.7;

/** Options for a single tier decision. */
export interface ChooseTierOptions {
  /** routePriority >= this triggers escalation consideration. Default 0.7. */
  escalationPriorityThreshold?: number;
  /**
   * Safety headroom: only escalate if remaining budget can cover the pricier
   * tier's cost multiplied by this factor (so we don't escalate on the very last
   * cent and then have nothing left). Default 1 (must simply afford it).
   */
  budgetSafetyFactor?: number;
}

/** The outcome of a tier decision — what to run and why. */
export interface TierDecision {
  /** The execution tier to actually use for this job. */
  tier: CostTier;
  /** Estimated marginal cost of running this job at `tier`, in USD. */
  estCostUsd: number;
  /** True iff we picked a pricier-than-baseline tier because the route earned it. */
  escalated: boolean;
  /**
   * True iff the route WOULD have escalated (high priority, eligible difficulty)
   * but we fell back to the cheapest tier because the budget is exhausted.
   */
  degradedForBudget: boolean;
}

/**
 * In-memory monthly cost budget. Inject the ceiling; record spend as jobs run.
 * No persistence — the daemon constructs one per billing window.
 */
export class CostBudget {
  private readonly ceilingUsd: number;
  private spentUsd = 0;

  constructor(monthlyCeilingUsd: number) {
    if (!(monthlyCeilingUsd >= 0)) {
      throw new Error(`monthlyCeilingUsd must be >= 0, got ${monthlyCeilingUsd}`);
    }
    this.ceilingUsd = monthlyCeilingUsd;
  }

  /** The configured monthly ceiling. */
  ceiling(): number {
    return this.ceilingUsd;
  }

  /** Record that `usd` was actually spent. Negative spend is rejected. */
  recordSpend(usd: number): void {
    if (!(usd >= 0)) {
      throw new Error(`recordSpend requires usd >= 0, got ${usd}`);
    }
    this.spentUsd += usd;
  }

  /** Total spent so far this window. */
  spent(): number {
    return this.spentUsd;
  }

  /** Budget left before hitting the ceiling. Never negative. */
  remaining(): number {
    const r = this.ceilingUsd - this.spentUsd;
    return r > 0 ? r : 0;
  }

  /** True once we've spent at or beyond the ceiling — premium spend stops here. */
  isExhausted(): boolean {
    return this.spentUsd >= this.ceilingUsd;
  }

  /**
   * Decide which execution tier to use for one job.
   *
   * Decision order (the whole point of the module):
   *   1. Start at the CHEAPEST tier that can plausibly work for `difficulty`.
   *   2. If the route is high-priority (>= threshold) AND the difficulty has a
   *      pricier escalation tier AND we can afford it within remaining budget,
   *      ESCALATE to that pricier tier.
   *   3. If we WOULD have escalated but the budget can't cover it (or is
   *      exhausted), DEGRADE: drop all the way to the cheapest tier and flag it.
   *      We never block — a cheap attempt beats no attempt.
   *
   * Pure w.r.t. its inputs (reads current remaining(), does not mutate spend).
   */
  chooseTier(
    difficulty: ScraperDifficulty,
    routePriority: number,
    opts?: ChooseTierOptions,
  ): TierDecision {
    const threshold = opts?.escalationPriorityThreshold ?? DEFAULT_ESCALATION_PRIORITY_THRESHOLD;
    const safety = opts?.budgetSafetyFactor ?? 1;

    const baseline = BASELINE_TIER_FOR_DIFFICULTY[difficulty];
    const escalationTier = ESCALATION_TIER_FOR_DIFFICULTY[difficulty];

    const priority = Number.isNaN(routePriority) ? 0 : routePriority;
    const wantsEscalation =
      priority >= threshold &&
      // Only "escalation" if the tier is actually pricier than baseline.
      COST_PER_TIER[escalationTier] > COST_PER_TIER[baseline];

    if (!wantsEscalation) {
      // Cheap-first path: low priority, or nothing pricier worth reaching for.
      return {
        tier: baseline,
        estCostUsd: COST_PER_TIER[baseline],
        escalated: false,
        degradedForBudget: false,
      };
    }

    // High-priority, eligible route: can we afford the pricier tier?
    const escalationCost = COST_PER_TIER[escalationTier];
    const canAfford = !this.isExhausted() && this.remaining() >= escalationCost * safety;

    if (canAfford) {
      return {
        tier: escalationTier,
        estCostUsd: escalationCost,
        escalated: true,
        degradedForBudget: false,
      };
    }

    // Budget can't cover the premium: DEGRADE to the cheapest tier (never block),
    // and flag that this was a budget-forced downgrade for observability.
    return {
      tier: CHEAPEST_TIER,
      estCostUsd: COST_PER_TIER[CHEAPEST_TIER],
      escalated: false,
      degradedForBudget: true,
    };
  }
}

/**
 * Accounting helper: average spend per confirmed deal.
 *
 * Returns Infinity when we've spent money but confirmed zero deals (the worst
 * possible efficiency — useful as a tripwire), and 0 when nothing was spent.
 */
export function costPerConfirmedDeal(spentUsd: number, dealCount: number): number {
  if (dealCount <= 0) {
    return spentUsd > 0 ? Infinity : 0;
  }
  return spentUsd / dealCount;
}

// ---------------------------------------------------------------------------
// Process-shared budget singleton (live wiring)
// ---------------------------------------------------------------------------

/**
 * Lazily-constructed budget shared by every cost-aware caller in this process
 * (the daemon's per-job recordSpend and the curl_cffi runner's tier choice must
 * see the SAME spend counter). DORMANT by default: returns null unless
 * COST_BUDGET_USD is set to a positive number, in which case callers fall back
 * to today's behavior (no escalation gating, no metering). Memoized so the same
 * instance accrues spend across the whole billing window / process lifetime.
 */
let sharedBudget: CostBudget | null | undefined;

export function getSharedBudget(): CostBudget | null {
  if (sharedBudget !== undefined) return sharedBudget;
  const raw = process.env.COST_BUDGET_USD;
  const ceiling = raw != null ? Number(raw) : NaN;
  sharedBudget = Number.isFinite(ceiling) && ceiling > 0 ? new CostBudget(ceiling) : null;
  return sharedBudget;
}

/** Test-only: reset the memoized singleton so env changes take effect. */
export function _resetSharedBudgetForTests(): void {
  sharedBudget = undefined;
}
