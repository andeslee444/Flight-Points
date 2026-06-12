/**
 * Proof test for the CapSolver / 2captcha-compatible captcha solver adapter.
 *
 * Outcome under test — the create→poll contract that produces the token a
 * Gigya/Auth0 login flow injects to clear the Aeroplan/United login reCAPTCHA:
 *   (1) DORMANT: with no CAPSOLVER_API_KEY, solveCaptcha returns null AND makes
 *       ZERO http calls — the daemon's existing "captcha blocked" path is intact
 *       and nothing hits the network (asserted: fake http never invoked).
 *   (2) HAPPY PATH: key set + fake http that returns createTask {taskId} then a
 *       ready getTaskResult → returns the exact token 'TOKEN123'; we then prove
 *       that token threads into a (fake) login call, i.e. it's usable downstream.
 *   (3) POLLING: fake http returns status:'processing' once, then 'ready' →
 *       the bounded counter loop keeps polling and ultimately succeeds (proves
 *       the poller waits across attempts using a counter, not wall-clock/sleep).
 *   (4) ERROR: fake http that throws → solveCaptcha returns null, never throws.
 *
 * Fully offline: every case injects a fake SolverHttp; no real fetch, no network.
 * Env is saved/restored around each case so dormancy is exercised cleanly.
 */
import { test, assert, assertEqual, run } from '../_assert.js';
import {
  solveCaptcha,
  isCaptchaSolverConfigured,
  type CaptchaTask,
  type SolverHttp,
} from '../../src/flights/net/captcha-solver.js';

const TASK: CaptchaTask = {
  type: 'recaptcha_v2',
  websiteUrl: 'https://account.aircanada.com/aeroplan/login',
  websiteKey: '6LdSITE_KEY_EXAMPLE',
};

/** Run `fn` with CAPSOLVER_API_KEY set/unset, restoring the prior value after. */
async function withKey(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const saved = process.env.CAPSOLVER_API_KEY;
  if (value === undefined) delete process.env.CAPSOLVER_API_KEY;
  else process.env.CAPSOLVER_API_KEY = value;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.CAPSOLVER_API_KEY;
    else process.env.CAPSOLVER_API_KEY = saved;
  }
}

test('dormant w/o key (no http), solves to token, polls then succeeds, errors → null', async () => {
  // ───────────────────────────────────────────────────────────────────────────
  // (1) DORMANT: no key → null AND the injected http is NEVER called.
  // ───────────────────────────────────────────────────────────────────────────
  await withKey(undefined, async () => {
    assertEqual(isCaptchaSolverConfigured(), false, 'no key → not configured');
    let calls = 0;
    const spyHttp: SolverHttp = async () => {
      calls++;
      return {};
    };
    const token = await solveCaptcha(TASK, spyHttp);
    assertEqual(token, null, 'dormant solveCaptcha must return null');
    assertEqual(calls, 0, 'dormant path must make ZERO http calls (no network)');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (2) HAPPY PATH: createTask {taskId} → getTaskResult ready → 'TOKEN123'.
  //     Then prove the token threads into a login call (usable downstream).
  // ───────────────────────────────────────────────────────────────────────────
  await withKey('test-capsolver-key', async () => {
    assertEqual(isCaptchaSolverConfigured(), true, 'key set → configured');

    const urls: string[] = [];
    const happyHttp: SolverHttp = async (url, body) => {
      urls.push(url);
      if (url.endsWith('/createTask')) {
        // Sanity: the task carries the page URL + site key the login needs.
        const b = body as any;
        assert(b.clientKey === 'test-capsolver-key', 'createTask sends the api key');
        assert(b.task.websiteURL === TASK.websiteUrl, 'createTask carries page URL');
        assert(b.task.websiteKey === TASK.websiteKey, 'createTask carries site key');
        return { errorId: 0, taskId: 'task-abc-123' };
      }
      // getTaskResult: immediately ready with the canonical reCAPTCHA token field.
      const b = body as any;
      assertEqual(b.taskId, 'task-abc-123', 'poll references the created taskId');
      return { errorId: 0, status: 'ready', solution: { gRecaptchaResponse: 'TOKEN123' } };
    };

    const token = await solveCaptcha(TASK, happyHttp);
    assertEqual(token, 'TOKEN123', 'happy path must return the solved token verbatim');
    assert(urls.some((u) => u.endsWith('/createTask')), 'must call createTask');
    assert(urls.some((u) => u.endsWith('/getTaskResult')), 'must call getTaskResult');

    // The token would thread into the Gigya/Auth0 login call — model that here:
    // a fake login that requires the captcha token to "succeed".
    const fakeGigyaLogin = (creds: { loginID: string; captcha: string }) =>
      creds.captcha === 'TOKEN123'
        ? { status: 'OK', uid: 'user-1' }
        : { errorCode: 401020, errorMessage: 'Login Failed Captcha Required' };
    const loginResult = fakeGigyaLogin({ loginID: 'harbortheoctopus', captcha: token! });
    assertEqual(loginResult.status, 'OK', 'solved token must satisfy the login captcha gate');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (3) POLLING: first poll 'processing', second 'ready' → counter loop succeeds.
  // ───────────────────────────────────────────────────────────────────────────
  await withKey('test-capsolver-key', async () => {
    let pollCount = 0;
    const pollingHttp: SolverHttp = async (url) => {
      if (url.endsWith('/createTask')) return { errorId: 0, taskId: 'task-poll' };
      pollCount++;
      if (pollCount === 1) return { errorId: 0, status: 'processing' };
      return { errorId: 0, status: 'ready', solution: { gRecaptchaResponse: 'POLLED_TOKEN' } };
    };
    const token = await solveCaptcha(TASK, pollingHttp);
    assertEqual(token, 'POLLED_TOKEN', 'poller must wait across attempts then succeed');
    assertEqual(pollCount, 2, 'must have polled exactly twice (processing → ready)');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (4) ERROR: a throwing http must yield null, never propagate the throw.
  // ───────────────────────────────────────────────────────────────────────────
  await withKey('test-capsolver-key', async () => {
    const throwingHttp: SolverHttp = async () => {
      throw new Error('simulated network failure');
    };
    let threw = false;
    let token: string | null = 'sentinel';
    try {
      token = await solveCaptcha(TASK, throwingHttp);
    } catch {
      threw = true;
    }
    assertEqual(threw, false, 'solveCaptcha must never throw on transport error');
    assertEqual(token, null, 'transport error must degrade to null');
  });

  console.log(
    'OUTCOME: dormant w/o key returns null with 0 http calls; key+ready → token "TOKEN123" ' +
      'threads into login; processing→ready poll loop succeeds in 2 polls; throwing http → null (no throw)',
  );
});

run();
