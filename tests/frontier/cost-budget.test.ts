/**
 * PROOF TEST for cost-aware tier scheduling.
 *
 * The point of cost-budget is a measurably BETTER spending outcome: the scheduler
 * must spend the proxy/compute budget where it pays off and refuse to spend it
 * where it doesn't — and it must never let escalation blow past the monthly
 * ceiling. A naive "always use the priciest tier" or "always use the cheapest
 * tier" policy fails on at least one of these; this policy satisfies all of them.
 *
 * This proves the OUTCOME, not just "a function returns an object":
 *   (1) cheap-first: a LOW-priority PUBLIC route picks the CHEAPEST tier — minimal
 *       estCost, escalated:false (we don't overpay for an easy, unwatched route);
 *   (2) escalation: a HIGH-priority akamai/auth route WITH ample budget escalates
 *       to a residential/mobile tier — escalated:true AND strictly higher estCost
 *       (we DO pay more when the route earns it and we can afford it);
 *   (3) budget ceiling: once spent >= ceiling, the SAME high-priority route
 *       DEGRADES to the cheapest tier (degradedForBudget:true) — and critically,
 *       simulating the full decision→spend loop, total spend NEVER exceeds the
 *       ceiling via escalation (the budget is a hard cap, not a suggestion);
 *   (4) costPerConfirmedDeal math: correct average, plus the Infinity tripwire
 *       (spent money, zero deals) and the 0 base case.
 *
 * Deterministic, offline, no network/DB. Costs are injected constants.
 *
 *   npx tsx tests/frontier/cost-budget.test.ts
 */
import { test, assert, assertEqual, run } from '../_assert.js';
import {
  CostBudget,
  COST_PER_TIER,
  CHEAPEST_TIER,
  TIER_ORDER,
  costPerConfirmedDeal,
  type CostTier,
} from '../../src/flights/scheduling/cost-budget.js';

// Shared facts printed in the OUTCOME line.
let cheapFirstOk = false;
let escalatesOk = false;
let degradesOk = false;
let spendBounded = false;

/** Rank of a tier in the cheapest→priciest order (lower = cheaper). */
function tierRank(t: CostTier): number {
  return TIER_ORDER.indexOf(t);
}

test('COST_PER_TIER is strictly increasing cheapest→priciest (the only contract)', () => {
  for (let i = 1; i < TIER_ORDER.length; i++) {
    const prev = COST_PER_TIER[TIER_ORDER[i - 1]];
    const cur = COST_PER_TIER[TIER_ORDER[i]];
    assert(cur > prev, `tier costs must strictly increase: ${TIER_ORDER[i]} (${cur}) !> ${TIER_ORDER[i - 1]} (${prev})`);
  }
  assertEqual(CHEAPEST_TIER, TIER_ORDER[0], 'CHEAPEST_TIER must be the first tier');
});

test('(1) cheap-first: low-priority public route picks the cheapest tier', () => {
  const budget = new CostBudget(100); // plenty of money — proves it is PRIORITY, not poverty, gating spend
  const d = budget.chooseTier('public', 0.1);

  assertEqual(d.tier, CHEAPEST_TIER, 'low-priority public must use the cheapest tier');
  assertEqual(d.escalated, false, 'low-priority route must not escalate');
  assertEqual(d.degradedForBudget, false, 'with full budget there is no budget degradation');
  // estCost is the minimum possible across all tiers.
  const minCost = Math.min(...TIER_ORDER.map((t) => COST_PER_TIER[t]));
  assertEqual(d.estCostUsd, minCost, 'cheap-first estCost must equal the global minimum tier cost');

  // Even a HIGH-priority public route stays cheap: an easy route never needs to overpay.
  const dHigh = budget.chooseTier('public', 0.99);
  assertEqual(dHigh.tier, CHEAPEST_TIER, 'high-priority public still cheapest (nothing pricier is worth it)');
  assertEqual(dHigh.escalated, false, 'public never escalates — a cheap hit already works');

  cheapFirstOk = true;
});

test('(2) escalation: high-priority akamai/auth route with ample budget escalates to a pricier tier', () => {
  const budget = new CostBudget(100); // ample

  const baselineAkamai = budget.chooseTier('akamai', 0.1); // low priority => baseline
  const escAkamai = budget.chooseTier('akamai', 0.95); // high priority => escalate

  assertEqual(escAkamai.escalated, true, 'high-priority akamai must escalate');
  assertEqual(escAkamai.degradedForBudget, false, 'with ample budget it is not a degrade');
  assert(
    tierRank(escAkamai.tier) > tierRank(baselineAkamai.tier),
    `escalated tier (${escAkamai.tier}) must be pricier-ranked than baseline (${baselineAkamai.tier})`,
  );
  assert(
    escAkamai.estCostUsd > baselineAkamai.estCostUsd,
    `escalated estCost (${escAkamai.estCostUsd}) must exceed baseline (${baselineAkamai.estCostUsd})`,
  );

  // auth escalates too, to an even pricier (mobile) tier than akamai's residential.
  const escAuth = budget.chooseTier('auth', 0.95);
  assertEqual(escAuth.escalated, true, 'high-priority auth must escalate');
  assert(
    tierRank(escAuth.tier) >= tierRank(escAkamai.tier),
    `auth escalation (${escAuth.tier}) should be at least as premium as akamai (${escAkamai.tier})`,
  );

  escalatesOk = true;
});

test('(3) budget ceiling: at exhaustion the high-priority route DEGRADES to cheapest, spend stays bounded', () => {
  const CEILING = 1.0;
  const budget = new CostBudget(CEILING);

  // Before exhaustion: a high-priority akamai route escalates (and would cost the premium).
  const before = budget.chooseTier('akamai', 0.95);
  assertEqual(before.escalated, true, 'before exhaustion the route should escalate');
  assertEqual(before.degradedForBudget, false, 'before exhaustion it is not degraded');

  // Spend right up to the ceiling.
  budget.recordSpend(CEILING);
  assert(budget.isExhausted(), 'budget should report exhausted after spending the ceiling');
  assertEqual(budget.remaining(), 0, 'remaining must clamp to 0 (never negative)');

  // Same route, now broke: must DEGRADE to cheapest and SAY so. Never blocked.
  const after = budget.chooseTier('akamai', 0.95);
  assertEqual(after.tier, CHEAPEST_TIER, 'exhausted budget must degrade to the cheapest tier');
  assertEqual(after.escalated, false, 'a degraded decision is not an escalation');
  assertEqual(after.degradedForBudget, true, 'must flag the budget-forced downgrade for observability');
  assert(after.tier !== before.tier, 'degraded tier must differ from the pre-exhaustion escalated tier');

  degradesOk = true;
});

test('(3b) escalation can never push total spend past the ceiling (full decide→spend loop)', () => {
  // Simulate the real loop: a stream of high-priority akamai jobs, each of which
  // would LOVE to escalate. We charge actual cost per decision and assert the
  // ceiling holds. A naive "always escalate" policy would blow straight past it.
  const CEILING = 1.0;
  const budget = new CostBudget(CEILING);
  let escalations = 0;
  let degrades = 0;

  for (let i = 0; i < 50; i++) {
    const d = budget.chooseTier('akamai', 0.95, { budgetSafetyFactor: 1 });
    if (d.escalated) escalations++;
    if (d.degradedForBudget) degrades++;
    budget.recordSpend(d.estCostUsd); // pay exactly what we estimated
    // Invariant the budget is supposed to guarantee:
    assert(budget.spent() <= CEILING + 1e-9, `spend ${budget.spent()} exceeded ceiling ${CEILING} at job ${i}`);
  }

  // Sanity: it actually exercised BOTH paths (escalated early, degraded once broke),
  // otherwise "spend bounded" would be vacuously true.
  assert(escalations > 0, 'expected at least one escalation while budget remained');
  assert(degrades > 0, 'expected at least one budget-forced degrade after exhaustion');
  assert(budget.spent() <= CEILING + 1e-9, `final spend ${budget.spent()} must be <= ceiling ${CEILING}`);

  spendBounded = true;
});

test('(4) costPerConfirmedDeal math: average, Infinity tripwire, zero base case', () => {
  assertEqual(costPerConfirmedDeal(10, 4), 2.5, '10 USD / 4 deals = 2.5');
  assertEqual(costPerConfirmedDeal(0, 0), 0, 'no spend, no deals => 0');
  assertEqual(costPerConfirmedDeal(0, 5), 0, 'no spend, some deals => 0');
  assertEqual(costPerConfirmedDeal(5, 0), Infinity, 'spent money, zero deals => Infinity tripwire');
  assert(costPerConfirmedDeal(3, 0) === Infinity, 'any positive spend with 0 deals is Infinity');
});

test('OUTCOME', () => {
  assert(cheapFirstOk && escalatesOk && degradesOk && spendBounded, 'all proof conditions must hold');
  console.log('OUTCOME: cheap-first ok, escalates high-priority under budget ok, degrades at ceiling (spend bounded) ok');
});

run();
