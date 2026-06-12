/**
 * Cloud browser pool adapter (elastic CDP for HARD, HIGH-PRIORITY routes).
 *
 * WHAT: a thin, dormant-by-default client over a hosted headful-browser pool
 * (Browserbase / Steel.dev style). It exposes (a) gating logic that decides
 * whether a given route should run on the elastic cloud pool or stay on the
 * single local Chrome, and (b) an injectable session-acquire call that returns
 * a CDP websocket URL the existing Chrome-CDP scraper tier can `connect_over_cdp`
 * to — exactly like it does today against local Chrome's --remote-debugging-port.
 *
 * WHY: the Chrome-CDP tier is our strongest anti-bot bypass, but it's a SINGLE
 * local Chrome on the Mac Mini — a hard concurrency ceiling. When several HARD
 * (Akamai-protected) routes that someone actually cares about all need CDP at
 * once, they serialize behind one browser. A hosted pool gives elastic
 * concurrency on demand. It is, however, METERED (cost-per-session) and adds an
 * external dependency, so we reserve it for routes that have *earned* it:
 * high-priority AND hard. Everything else — and the entire flag-off path — stays
 * on local Chrome, unchanged. The running launchd daemon is unaffected until
 * CLOUD_BROWSER_URL is set.
 *
 * DORMANT-WITHOUT-KEY (same shape as vision-verify.ts / parser-autorepair.ts):
 *   - Config is read from the environment at CALL time, never at module load.
 *   - acquireCloudCdpEndpoint() returns null (logging to stderr) when not
 *     configured, and NEVER throws — callers degrade to the local-Chrome path.
 *   - The network call is INJECTABLE (`fetchImpl`) so the proof test runs fully
 *     offline with a fake; the default impl uses global fetch.
 *
 * This is scaffold: nothing here is wired into the daemon yet. A CDP runner can
 * call chooseBrowserTarget() once a pool is provisioned and route accordingly.
 */

/** Resolved cloud-browser configuration. Read from env at call time. */
export interface CloudBrowserConfig {
  /**
   * Optional pre-resolved CDP websocket endpoint. Usually undefined — the real
   * endpoint is minted per-session via acquireCloudCdpEndpoint(); this field
   * exists for setups that pin a single long-lived ws endpoint via env.
   */
  wsEndpoint?: string;
}

/** The provider's session-create base URL env var (e.g. a Browserbase/Steel API root). */
const ENV_URL = 'CLOUD_BROWSER_URL';
/** Optional API key for the provider; sent as a bearer token when present. */
const ENV_API_KEY = 'CLOUD_BROWSER_API_KEY';

/** Default gate: a route is "high priority" (cloud-eligible) at/above this score. */
const DEFAULT_PRIORITY_THRESHOLD = 0.7;

function log(msg: string): void {
  console.error(`[cloud-browser ${new Date().toISOString()}] ${msg}`);
}

/** Treat empty / whitespace-only env values as "not configured". */
function normalize(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read the cloud-browser config from the environment AT CALL TIME (never cached,
 * never read at module load) so callers and tests can vary it at runtime.
 *
 * `wsEndpoint` here mirrors the env's optional pinned endpoint; the per-session
 * path ignores it and mints a fresh ws URL from the provider instead.
 */
export function getCloudBrowserConfig(): CloudBrowserConfig {
  return { wsEndpoint: normalize(process.env.CLOUD_BROWSER_WS_ENDPOINT) };
}

/** True iff CLOUD_BROWSER_URL is set to a non-empty string. */
export function isCloudBrowserConfigured(): boolean {
  return normalize(process.env[ENV_URL]) !== undefined;
}

/** Where a CDP scraper should connect: the elastic cloud pool, or local Chrome. */
export interface BrowserTarget {
  kind: 'cloud' | 'local';
  /** CDP websocket URL when kind === 'cloud' and a pinned endpoint exists; else undefined.
   *  (For per-session cloud routing the runner still calls acquireCloudCdpEndpoint().) */
  wsEndpoint?: string;
  /** Human-readable justification, for daemon startup logging / observability. */
  reason: string;
}

/**
 * Decide whether a route runs on the cloud pool or local Chrome.
 *
 * Routes to 'cloud' ONLY when the pool is configured AND the route's priority
 * meets the threshold — elastic (metered) concurrency is reserved for
 * high-priority hard routes. In every other case it returns 'local', which is
 * also the entire flag-off behavior (configured=false ⇒ local). This is the
 * single gating decision the daemon/CDP runner consults.
 *
 * @param opts.routePriority      0..1 priority score for this route.
 * @param opts.configured         Defaults to isCloudBrowserConfigured() so tests can inject.
 * @param opts.priorityThreshold  Cloud-eligibility cutoff (default 0.7).
 */
export function chooseBrowserTarget(opts: {
  routePriority: number;
  configured?: boolean;
  priorityThreshold?: number;
}): BrowserTarget {
  const configured = opts.configured ?? isCloudBrowserConfigured();
  const threshold = opts.priorityThreshold ?? DEFAULT_PRIORITY_THRESHOLD;

  if (!configured) {
    return {
      kind: 'local',
      reason: 'cloud pool not configured (CLOUD_BROWSER_URL unset) — using local Chrome',
    };
  }
  if (opts.routePriority < threshold) {
    return {
      kind: 'local',
      reason:
        `route priority ${opts.routePriority.toFixed(2)} < threshold ${threshold.toFixed(2)} ` +
        `— reserving elastic cloud for high-priority hard routes, using local Chrome`,
    };
  }
  return {
    kind: 'cloud',
    // Surface any pinned endpoint; per-session callers mint one instead.
    wsEndpoint: getCloudBrowserConfig().wsEndpoint,
    reason:
      `route priority ${opts.routePriority.toFixed(2)} >= threshold ${threshold.toFixed(2)} ` +
      `and cloud pool configured — eligible for elastic cloud CDP`,
  };
}

/**
 * Injectable fetch surface — exactly the subset of the global `fetch` contract
 * we use, so the proof test can hand in a fake with no network.
 */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}>;

/**
 * Acquire a fresh CDP websocket endpoint from the cloud pool for ONE session.
 *
 * DORMANT: returns null (logging to stderr) when CLOUD_BROWSER_URL is unset, so
 * importing this module never makes a network call and a missing-config daemon
 * silently keeps using local Chrome. Otherwise it POSTs a session-create request
 * to the provider and extracts the CDP ws URL from the response. NEVER throws —
 * any network/HTTP/parse error is logged and yields null, and the caller falls
 * back to local Chrome.
 *
 * The provider response shape varies by vendor, so we accept the common keys
 * (connectUrl / wsEndpoint / webSocketDebuggerUrl) and the first one present wins.
 *
 * @param fetchImpl  Injected for tests; defaults to global fetch.
 */
export async function acquireCloudCdpEndpoint(
  fetchImpl?: FetchLike,
): Promise<string | null> {
  const baseUrl = normalize(process.env[ENV_URL]);
  if (!baseUrl) {
    log(`${ENV_URL} not set — cloud browser dormant, returning null (use local Chrome).`);
    return null;
  }

  const apiKey = normalize(process.env[ENV_API_KEY]);
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init as any) as any);

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;

    const resp = await doFetch(baseUrl, {
      method: 'POST',
      headers,
      // Minimal create-session payload; vendors ignore unknown fields.
      body: JSON.stringify({ headful: true }),
    });

    if (!resp.ok) {
      log(`session-create returned HTTP ${resp.status} — returning null (use local Chrome).`);
      return null;
    }

    const data = await resp.json();
    const endpoint = extractWsEndpoint(data);
    if (!endpoint) {
      log('session-create response had no recognizable CDP ws URL — returning null.');
      return null;
    }
    return endpoint;
  } catch (e: any) {
    log(`session-create failed: ${e?.message ?? e} — returning null (use local Chrome).`);
    return null;
  }
}

/**
 * Pull the CDP websocket URL out of a provider's session-create response,
 * tolerating the common vendor key names. Returns null if none are present.
 */
function extractWsEndpoint(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const candidate =
    data.connectUrl ?? data.wsEndpoint ?? data.webSocketDebuggerUrl ?? data.cdpUrl;
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

export default {
  isCloudBrowserConfigured,
  getCloudBrowserConfig,
  chooseBrowserTarget,
  acquireCloudCdpEndpoint,
};
