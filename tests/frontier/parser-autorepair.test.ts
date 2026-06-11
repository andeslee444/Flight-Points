/**
 * Proof test for self-healing parser AUTO-REPAIR — closing the detect→recover loop.
 *
 * Outcome under test: when a CDP scraper loads a page but parses 0 (vision flags
 * `layout_changed`), the repairer asks an LLM for a new selector and HOT-SWAPS it
 * ONLY when validation against the golden route reproduces the expected result.
 * The mechanism is BETTER than blindly trusting the LLM because:
 *   - A GOOD proposal that validates is hot-swapped AND persisted (recovery works).
 *   - A BAD proposal (validates to 0/garbage) is REJECTED and the old selector is
 *     KEPT — a hallucinated repair can never ship.
 *   - With no proposal (dormant LLM / no API key) it no-ops and keeps the old one.
 *   - A proposal whose COUNT is fine but whose miles are out of range is rejected
 *     too (count alone isn't enough — it must extract plausible award pricing).
 *
 * Fully offline: fake llm + fake validate + InMemorySelectorStore. No network/DB.
 */
import { test, assert, assertEqual, run } from '../_assert.js';
import {
  ParserAutoRepair,
  InMemorySelectorStore,
  defaultLlmRepairFn,
  type LlmRepairFn,
  type ValidateFn,
} from '../../src/flights/healing/parser-autorepair.js';

const SCRAPER = 'united-cdp';
const OLD_SELECTOR = '.flight-row .miles-amount'; // the drifted, now-broken selector
const GOOD_SELECTOR = 'div[data-testid="result-row"] span.award-miles'; // post-redesign
const GOLDEN_DOM = '<div data-testid="result-row">...77,500 miles...</div>';

// Golden expectation for the route the LLM is trying to recover.
const EXPECTED = { cabin: 'business', minCount: 5, milesRange: [40000, 120000] as [number, number] };

/**
 * A fake validate() that models "running the selector against the golden page":
 * only GOOD_SELECTOR reproduces the real results; everything else extracts
 * nothing (the page redesigned, so the old/garbage selectors match no rows).
 */
const fakeValidate: ValidateFn = async (selector) => {
  if (selector === GOOD_SELECTOR) {
    // Reproduces the golden extraction: 8 rows, all plausible business miles.
    return { count: 8, sampleMiles: [77500, 88000, 95000] };
  }
  // Anything else (old, hallucinated, wrong) matches no result rows post-redesign.
  return { count: 0, sampleMiles: [] };
};

/** Fake llm that returns a fixed proposal — lets each case inject what the LLM "said". */
const llmReturning = (proposal: Awaited<ReturnType<LlmRepairFn>>): LlmRepairFn =>
  async () => proposal;

test('GOOD proposal validates → hot-swapped + persisted; BAD/null/miles-out-of-range → rejected, old kept', async () => {
  // ---------------------------------------------------------------------------
  // (1) GOOD proposal: LLM returns a selector that validate reproduces. Repair ships.
  // ---------------------------------------------------------------------------
  {
    const store = new InMemorySelectorStore();
    await store.set(SCRAPER, OLD_SELECTOR); // we start with the drifted selector
    const repairer = new ParserAutoRepair({
      llm: llmReturning({ selector: GOOD_SELECTOR, confidence: 0.9 }),
      validate: fakeValidate,
      store,
    });

    const res = await repairer.attemptRepair(SCRAPER, { domHtml: GOLDEN_DOM, expected: EXPECTED });

    assertEqual(res.repaired, true, 'good validated proposal must repair');
    assertEqual(res.newSelector, GOOD_SELECTOR, 'result reports the new selector');
    assertEqual(
      await store.get(SCRAPER),
      GOOD_SELECTOR,
      'store must be HOT-SWAPPED to the validated selector (persisted)',
    );
  }

  // ---------------------------------------------------------------------------
  // (2) BAD proposal: LLM hallucinates a selector that validates to 0 rows.
  //     Must be rejected; the OLD selector must remain in the store. A bad
  //     repair cannot ship.
  // ---------------------------------------------------------------------------
  {
    const store = new InMemorySelectorStore();
    await store.set(SCRAPER, OLD_SELECTOR);
    const repairer = new ParserAutoRepair({
      llm: llmReturning({ selector: '.totally-wrong-guess', confidence: 0.99 }), // high self-confidence, still wrong
      validate: fakeValidate,
      store,
    });

    const res = await repairer.attemptRepair(SCRAPER, { domHtml: GOLDEN_DOM, expected: EXPECTED });

    assertEqual(res.repaired, false, 'unvalidated (0-result) proposal must be rejected');
    assert(/rejected/.test(res.reason), 'reason should explain the rejection');
    assertEqual(
      await store.get(SCRAPER),
      OLD_SELECTOR,
      'store MUST still hold the old selector — a bad repair cannot ship',
    );
    assert(
      res.newSelector !== '.totally-wrong-guess',
      'we must never report the hallucinated selector as active',
    );
  }

  // ---------------------------------------------------------------------------
  // (3) No proposal (dormant LLM / no API key): no-op, keep old selector.
  // ---------------------------------------------------------------------------
  {
    const store = new InMemorySelectorStore();
    await store.set(SCRAPER, OLD_SELECTOR);
    const repairer = new ParserAutoRepair({
      llm: llmReturning(null), // models defaultLlmRepairFn without ANTHROPIC_API_KEY
      validate: fakeValidate,
      store,
    });

    const res = await repairer.attemptRepair(SCRAPER, { domHtml: GOLDEN_DOM, expected: EXPECTED });

    assertEqual(res.repaired, false, 'no proposal → no repair');
    assert(/no proposal/.test(res.reason), 'reason should note there was no proposal');
    assertEqual(await store.get(SCRAPER), OLD_SELECTOR, 'old selector untouched when LLM is dormant');
  }

  // ---------------------------------------------------------------------------
  // (4) Miles-out-of-range: count is fine but extracted miles are implausible.
  //     Validation guard rejects even though count >= minCount.
  // ---------------------------------------------------------------------------
  {
    const store = new InMemorySelectorStore();
    await store.set(SCRAPER, OLD_SELECTOR);
    // This validate reports plenty of rows but the "miles" are actually flight
    // numbers / row indices — a classic wrong-column match. Count passes; miles don't.
    const milesGarbageValidate: ValidateFn = async (selector) =>
      selector === '.wrong-column'
        ? { count: 9, sampleMiles: [1, 2, 3, 4] } // way below the 40k–120k award range
        : { count: 0, sampleMiles: [] };
    const repairer = new ParserAutoRepair({
      llm: llmReturning({ selector: '.wrong-column' }),
      validate: milesGarbageValidate,
      store,
    });

    const res = await repairer.attemptRepair(SCRAPER, { domHtml: GOLDEN_DOM, expected: EXPECTED });

    assertEqual(res.repaired, false, 'count-ok but miles-out-of-range proposal must be rejected');
    assert(/out of range/.test(res.reason), 'reason should cite the miles-range guard');
    assertEqual(
      await store.get(SCRAPER),
      OLD_SELECTOR,
      'old selector kept when miles fail the plausibility guard',
    );
  }

  // ---------------------------------------------------------------------------
  // Bonus: the real default LLM fn is DORMANT without ANTHROPIC_API_KEY.
  // ---------------------------------------------------------------------------
  {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const proposal = await defaultLlmRepairFn({
        domHtml: GOLDEN_DOM,
        lastKnownSelector: OLD_SELECTOR,
        expected: { minCount: 5 },
      });
      assertEqual(proposal, null, 'defaultLlmRepairFn must be dormant (null) without an API key');
    } finally {
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  }

  console.log(
    'OUTCOME: good repair hot-swapped+persisted ok, bad repair rejected (old kept) ok, ' +
      'dormant w/o llm ok, miles-range guard ok',
  );
});

run();
