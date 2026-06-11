/**
 * Proof test for the cost-budget → proxy-router LIVE WIRING (not just the pure
 * module). This is the integration the daemon/curl_cffi runner actually use:
 * `getSharedBudget()` (env-driven singleton) feeding `resolveProxyBudgeted()`.
 *
 * Outcome under test — with a residential proxy CONFIGURED and a budget active:
 *   1. a LOW-priority akamai route stays on the cheap datacenter proxy (the
 *      budget refuses to spend residential GB on a route nobody's watching),
 *   2. a HIGH-priority akamai route ESCALATES to the residential proxy,
 *   3. once the budget is EXHAUSTED even the high-priority route DEGRADES back
 *      to datacenter (degradedForBudget=true) — spend can't run away.
 * And with NO budget configured, resolveProxyBudgeted() === today's resolveProxy
 * (pure pass-through), so the flag-off path is unchanged.
 */
import { test, assert, run } from '../_assert.js';
import {
  resolveProxyBudgeted,
  resolveProxy,
} from '../../src/flights/net/proxy-router.js';
import {
  getSharedBudget,
  _resetSharedBudgetForTests,
  COST_PER_TIER,
} from '../../src/flights/scheduling/cost-budget.js';

const DC = 'socks5://datacenter.example:1080';
const RES = 'socks5://residential.example:1080';

function setEnv() {
  process.env.DATACENTER_PROXY_URL = DC;
  process.env.RESIDENTIAL_PROXY_URL = RES;
  delete process.env.MOBILE_PROXY_URL;
}
function clearEnv() {
  delete process.env.DATACENTER_PROXY_URL;
  delete process.env.RESIDENTIAL_PROXY_URL;
  delete process.env.MOBILE_PROXY_URL;
  delete process.env.COST_BUDGET_USD;
  delete process.env.PROXY_URL;
}

test('budget gates proxy escalation: low stays cheap, high escalates, exhausted degrades', () => {
  // ── Flag OFF: no budget → pure pass-through to resolveProxy ──
  clearEnv();
  setEnv();
  delete process.env.COST_BUDGET_USD;
  _resetSharedBudgetForTests();
  assert(getSharedBudget() === null, 'no COST_BUDGET_USD → no shared budget');
  const off = resolveProxyBudgeted('aa', 0.9);
  assert(
    off.proxyUrl === resolveProxy('aa') && off.estCostUsd === 0,
    'flag-off path must equal resolveProxy() with zero metered cost',
  );

  // ── Flag ON ──
  process.env.COST_BUDGET_USD = '1.00';
  _resetSharedBudgetForTests();
  const budget = getSharedBudget();
  assert(budget !== null, 'COST_BUDGET_USD set → shared budget exists');

  // (1) LOW-priority akamai route → cheap datacenter even though RES is configured.
  const low = resolveProxyBudgeted('aa', 0.1);
  assert(
    low.tier === 'datacenter' && low.proxyUrl === DC,
    `low-priority akamai should stay datacenter, got tier=${low.tier} url=${low.proxyUrl}`,
  );
  assert(!low.degradedForBudget, 'low-priority is a cheap-first choice, not a budget degrade');

  // (2) HIGH-priority akamai route → escalate to residential (budget can afford it).
  const high = resolveProxyBudgeted('aa', 0.95);
  assert(
    high.tier === 'residential' && high.proxyUrl === RES,
    `high-priority akamai should escalate to residential, got tier=${high.tier} url=${high.proxyUrl}`,
  );
  assert(high.estCostUsd === COST_PER_TIER.residential, 'escalated cost should be the residential tier cost');

  // (3) Exhaust the budget, then the SAME high-priority route must degrade to datacenter.
  budget!.recordSpend(budget!.ceiling()); // spend the whole ceiling
  assert(budget!.isExhausted(), 'budget should now be exhausted');
  const degraded = resolveProxyBudgeted('aa', 0.95);
  assert(
    degraded.tier === 'datacenter' && degraded.proxyUrl === DC,
    `exhausted high-priority route should degrade to datacenter, got tier=${degraded.tier}`,
  );
  assert(degraded.degradedForBudget, 'degrade must be flagged for observability');

  clearEnv();
  _resetSharedBudgetForTests();

  console.log(
    'OUTCOME: flag-off == resolveProxy ok, low-priority stays datacenter ok, ' +
      'high-priority escalates to residential ok, exhausted budget degrades to datacenter ok',
  );
});

run();
