/**
 * CapSolver / 2captcha-compatible CAPTCHA solver adapter.
 *
 * WHAT: A thin client for the CapSolver REST API (whose request/response shape
 * 2captcha and CapMonster also speak): submit a "create task" describing the
 * captcha challenge, then poll "get task result" until a token is ready. On
 * success it returns the `gRecaptchaResponse` token a login form would otherwise
 * obtain from the embedded reCAPTCHA/Turnstile widget.
 *
 * WHY: Aeroplan and United gate ALL logins behind a Gigya/Auth0 reCAPTCHA
 * (errorCode 401020 "Login Failed Captcha Required"). There is no IP/abuse
 * trigger — it is a server-side decision for every login — so no amount of
 * stealth or proxy rotation clears it. The only programmatic path is to solve
 * the visible reCAPTCHA out-of-band: hand CapSolver the page URL + site key, get
 * back a token, and inject that token into the Gigya `accounts.login` call (or
 * the Auth0 form's `g-recaptcha-response` field). This module produces that
 * token; the login adapters consume it.
 *
 * DORMANT-WITHOUT-KEY: with no CAPSOLVER_API_KEY this never touches the network —
 * `solveCaptcha` logs to STDERR and returns null, so the login adapter falls back
 * to today's "captcha blocked" path and the running daemon is unaffected. The key
 * is read at CALL time (not import time), so flipping it on needs no restart.
 *
 * INJECTABLE HTTP: the actual POST is a `SolverHttp` function. The default uses
 * the global `fetch`; tests pass a fake so the whole create→poll loop runs fully
 * offline with deterministic responses and zero real requests. The poll loop is
 * bounded by a plain integer attempt counter and uses NO wall-clock time and NO
 * randomness — it just increments a counter, so tests are reproducible.
 *
 * Mirrors the dormant-default shape of src/flights/vision-verify.ts and
 * src/flights/healing/parser-autorepair.ts.
 */

/** CapSolver REST base. Both create-task and get-result are POSTs under here. */
const CAPSOLVER_BASE = 'https://api.capsolver.com';

/** Upper bound on how many times we poll getTaskResult before giving up. */
const MAX_POLL_ATTEMPTS = 30;

/** A captcha challenge to solve, expressed in CapSolver/2captcha terms. */
export interface CaptchaTask {
  /** Which widget guards the page. Maps to a CapSolver task `type`. */
  type: 'recaptcha_v2' | 'recaptcha_v3' | 'turnstile';
  /** The URL of the page that hosts the captcha (the login page). */
  websiteUrl: string;
  /** The widget's public site key (reCAPTCHA `data-sitekey` / Turnstile sitekey). */
  websiteKey: string;
  /** reCAPTCHA v3 action name (e.g. "login"); ignored for v2/turnstile. */
  action?: string;
}

/**
 * Injectable HTTP transport: POSTs `body` as JSON to `url` and resolves the
 * parsed JSON response. Kept deliberately minimal so a test fake is trivial and
 * the whole solve flow can run with no real network.
 */
export type SolverHttp = (url: string, body: unknown) => Promise<any>;

/** Map our task type to CapSolver's `task.type` discriminator. */
function capsolverTaskType(t: CaptchaTask['type']): string {
  switch (t) {
    case 'recaptcha_v2':
      return 'ReCaptchaV2TaskProxyLess';
    case 'recaptcha_v3':
      return 'ReCaptchaV3TaskProxyLess';
    case 'turnstile':
      return 'AntiTurnstileTaskProxyLess';
  }
}

function log(msg: string): void {
  console.error(`[captcha-solver ${new Date().toISOString()}] ${msg}`);
}

/**
 * True iff CAPSOLVER_API_KEY is configured (read at call time so the flag can be
 * flipped without restarting the daemon). Login adapters check this to decide
 * whether the captcha path is even available before attempting a solve.
 */
export function isCaptchaSolverConfigured(): boolean {
  return !!process.env.CAPSOLVER_API_KEY && process.env.CAPSOLVER_API_KEY.trim() !== '';
}

/**
 * Default transport: POST JSON via the global `fetch`. Errors (network/non-OK)
 * propagate to `solveCaptcha`, which catches them and returns null — so a
 * transport failure degrades cleanly rather than throwing into a caller.
 */
const defaultHttp: SolverHttp = async (url, body) => {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} from ${url}`);
  }
  return resp.json();
};

/**
 * Solve a captcha challenge, returning the `gRecaptchaResponse`/Turnstile token,
 * or null on dormancy/failure/timeout. NEVER throws.
 *
 * Flow (the CapSolver / 2captcha contract):
 *   1. POST /createTask {clientKey, task:{type, websiteURL, websiteKey, ...}}
 *      → { errorId, taskId } (or { errorId:1, errorDescription } on failure)
 *   2. POST /getTaskResult {clientKey, taskId} repeatedly until
 *      { status:'ready', solution:{ gRecaptchaResponse|token } }
 *      or { status:'failed' } / errorId. Each poll increments a counter; after
 *      MAX_POLL_ATTEMPTS still-processing polls we give up (return null).
 *
 * The returned token is what a login adapter injects into the Gigya
 * `accounts.login({ ..., 'g-recaptcha-response': token })` (or the Auth0 form
 * field) to clear the login captcha.
 *
 * @param task  The challenge to solve (page URL + site key + widget type).
 * @param http  Injectable transport; defaults to `fetch`. Tests pass a fake.
 */
export async function solveCaptcha(
  task: CaptchaTask,
  http: SolverHttp = defaultHttp,
): Promise<string | null> {
  const clientKey = process.env.CAPSOLVER_API_KEY;
  if (!clientKey || clientKey.trim() === '') {
    // Dormant: no key → no network call, caller keeps today's "blocked" path.
    log('CAPSOLVER_API_KEY not set — skipping captcha solve (dormant).');
    return null;
  }

  try {
    // ── 1) Create the task. ──
    const createBody = {
      clientKey,
      task: {
        type: capsolverTaskType(task.type),
        websiteURL: task.websiteUrl,
        websiteKey: task.websiteKey,
        ...(task.type === 'recaptcha_v3' && task.action ? { pageAction: task.action } : {}),
      },
    };
    const created = await http(`${CAPSOLVER_BASE}/createTask`, createBody);
    if (!created || created.errorId) {
      log(
        `createTask failed: ${created?.errorCode ?? 'errorId=' + created?.errorId} ` +
          `${created?.errorDescription ?? ''}`.trim(),
      );
      return null;
    }
    const taskId = created.taskId;
    if (!taskId) {
      log('createTask returned no taskId — aborting.');
      return null;
    }

    // ── 2) Poll for the result, bounded by a plain attempt counter. ──
    // No wall-clock, no randomness: each iteration is one getTaskResult poll,
    // so the loop is fully deterministic and reproducible under test.
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const result = await http(`${CAPSOLVER_BASE}/getTaskResult`, { clientKey, taskId });
      if (!result || result.errorId) {
        log(
          `getTaskResult failed: ${result?.errorCode ?? 'errorId=' + result?.errorId} ` +
            `${result?.errorDescription ?? ''}`.trim(),
        );
        return null;
      }
      if (result.status === 'ready') {
        // CapSolver returns the reCAPTCHA token as `gRecaptchaResponse`;
        // Turnstile returns it as `token`. Accept either.
        const token =
          result.solution?.gRecaptchaResponse ?? result.solution?.token ?? null;
        if (typeof token === 'string' && token.length > 0) {
          log(`solved ${task.type} after ${attempt + 1} poll(s).`);
          return token;
        }
        log('getTaskResult ready but contained no token — treating as failure.');
        return null;
      }
      if (result.status === 'failed') {
        log(`getTaskResult reported status=failed: ${result.errorDescription ?? ''}`);
        return null;
      }
      // status === 'processing' (or anything not-yet-ready): keep polling.
    }

    // Exhausted the attempt budget without a ready token.
    log(`gave up after ${MAX_POLL_ATTEMPTS} polls — token never became ready.`);
    return null;
  } catch (e: any) {
    // Transport or unexpected error: degrade cleanly, never throw into caller.
    log(`solve errored: ${e?.message ?? e}`);
    return null;
  }
}
