/**
 * Proof test for the cloud-browser pool adapter (M3.1).
 *
 * Proves the gate + dormant-acquire behavior that lets the Chrome-CDP tier
 * elastically scale onto a hosted browser pool for HARD, HIGH-PRIORITY routes
 * while leaving everything else — and the entire flag-off path — on local
 * Chrome:
 *   (1) high-priority + configured            -> target 'cloud'
 *   (2) high-priority + NOT configured        -> 'local' (flag-off degrade)
 *   (3) LOW-priority  + configured            -> 'local' (only high-pri eligible)
 *   (4) acquireCloudCdpEndpoint with NO env   -> null    (dormant, never throws)
 *   (5) acquire with a FAKE fetchImpl session -> returns the minted ws endpoint
 *
 * Fully offline: gating is pure, and the one network path is exercised through
 * an injected fake fetch — no real provider, no CLOUD_BROWSER_URL needed.
 */
import { test, assert, assertEqual, run } from '../_assert.js';
import {
  chooseBrowserTarget,
  acquireCloudCdpEndpoint,
  isCloudBrowserConfigured,
  type FetchLike,
} from '../../src/flights/net/cloud-browser.js';

const ENV_URL = 'CLOUD_BROWSER_URL';

function clearEnv() {
  delete process.env[ENV_URL];
  delete process.env.CLOUD_BROWSER_API_KEY;
  delete process.env.CLOUD_BROWSER_WS_ENDPOINT;
}

test('cloud-browser gate routes only high-priority hard routes to cloud; acquire is dormant without config', async () => {
  clearEnv();

  // (1) high-priority + configured -> 'cloud'
  const t1 = chooseBrowserTarget({ routePriority: 0.95, configured: true });
  assertEqual(t1.kind, 'cloud', 'high-priority + configured must route to cloud');

  // (2) high-priority + NOT configured -> 'local' (flag-off degrade)
  const t2 = chooseBrowserTarget({ routePriority: 0.95, configured: false });
  assertEqual(t2.kind, 'local', 'high-priority but unconfigured must degrade to local');

  // (3) LOW-priority + configured -> 'local' (only high-priority is eligible)
  const t3 = chooseBrowserTarget({ routePriority: 0.2, configured: true });
  assertEqual(t3.kind, 'local', 'low-priority must stay local even when configured');

  // Sanity: the default-threshold boundary is reserved for high-priority only.
  assert(
    isCloudBrowserConfigured() === false,
    'with no CLOUD_BROWSER_URL, isCloudBrowserConfigured() must be false',
  );

  // (4) acquireCloudCdpEndpoint with no env -> null (dormant, never throws)
  const dormant = await acquireCloudCdpEndpoint();
  assertEqual(dormant, null, 'acquire must return null when CLOUD_BROWSER_URL is unset');

  // (5) with a fake fetchImpl returning a session -> returns the ws endpoint.
  const WS = 'wss://pool.example.com/devtools/browser/abc-123';
  process.env[ENV_URL] = 'https://api.cloudpool.example/v1/sessions';
  process.env.CLOUD_BROWSER_API_KEY = 'sk-test-key';
  let sawAuth = false;
  const fakeFetch: FetchLike = async (url, init) => {
    sawAuth = init?.headers?.['authorization'] === 'Bearer sk-test-key';
    assert(init?.method === 'POST', 'session-create must POST');
    return {
      ok: true,
      status: 200,
      json: async () => ({ connectUrl: WS }),
    };
  };
  const endpoint = await acquireCloudCdpEndpoint(fakeFetch);
  assertEqual(endpoint, WS, 'acquire must return the provider-minted CDP ws endpoint');
  assert(sawAuth, 'API key must be sent as a bearer token when present');

  clearEnv();

  console.log(
    'OUTCOME: cloud-browser gate — high+configured->cloud, high+unconfigured->local, ' +
      'low+configured->local; acquire dormant(null) without CLOUD_BROWSER_URL and ' +
      `returns minted ws endpoint (${WS}) via injected fetch`,
  );
});

run();
