/**
 * PROOF test for the proxy difficulty-routing layer.
 *
 * This is not a smoke test. It proves the routing mechanism IMPROVES outcomes by
 * asserting that each scraper reaches the proxy tier its difficulty warrants when
 * that tier exists, AND that it DEGRADES GRACEFULLY to the datacenter VPS (and
 * finally to a direct connection) when better tiers are missing — never crashing
 * and never silently sending a hard-target scraper through nothing when a proxy
 * is available.
 *
 * Deterministic: no network, no DB. Env is the only input and is fully controlled
 * here, snapshotted and restored around the suite.
 */

import {
  DIFFICULTY,
  difficultyFor,
  resolveProxy,
  listRouting,
} from '../../src/flights/net/proxy-router.js';
import { test, assert, assertEqual, run } from '../_assert.js';

// --- env control -----------------------------------------------------------

const PROXY_KEYS = [
  'DATACENTER_PROXY_URL',
  'RESIDENTIAL_PROXY_URL',
  'MOBILE_PROXY_URL',
  'PROXY_URL',
] as const;

const SNAPSHOT: Record<string, string | undefined> = {};
for (const k of PROXY_KEYS) SNAPSHOT[k] = process.env[k];

function clearProxyEnv(): void {
  for (const k of PROXY_KEYS) delete process.env[k];
}

function restoreProxyEnv(): void {
  for (const k of PROXY_KEYS) {
    if (SNAPSHOT[k] === undefined) delete process.env[k];
    else process.env[k] = SNAPSHOT[k];
  }
}

const DC = 'socks5://datacenter.example:1081';
const RES = 'http://residential.example:8000';
const MOB = 'http://mobile.example:9000';

// --- (1) all three tiers configured → route by difficulty ------------------

test('all tiers configured: public→datacenter, akamai→residential, auth→mobile', () => {
  clearProxyEnv();
  process.env.DATACENTER_PROXY_URL = DC;
  process.env.RESIDENTIAL_PROXY_URL = RES;
  process.env.MOBILE_PROXY_URL = MOB;

  // public difficulty → datacenter
  assertEqual(resolveProxy('jetblue'), DC, 'jetblue (public) should use datacenter');
  assertEqual(resolveProxy('cathay'), DC, 'cathay (public) should use datacenter');
  assertEqual(resolveProxy('alaska'), DC, 'alaska (public) should use datacenter');
  assertEqual(
    resolveProxy('google-flights'),
    DC,
    'google-flights (public) should use datacenter',
  );

  // akamai difficulty → residential (the best tier for IP reputation)
  assertEqual(resolveProxy('aa'), RES, 'aa (akamai) should use residential');
  assertEqual(resolveProxy('united'), RES, 'united (akamai) should use residential');
  assertEqual(resolveProxy('ba-avios'), RES, 'ba-avios (akamai) should use residential');

  // auth difficulty → mobile (highest-trust tier for login/captcha flows)
  assertEqual(resolveProxy('flying-blue'), MOB, 'flying-blue (auth) should use mobile');
  assertEqual(resolveProxy('delta'), MOB, 'delta (auth) should use mobile');
  assertEqual(resolveProxy('ana'), MOB, 'ana (auth) should use mobile');
  assertEqual(resolveProxy('singapore'), MOB, 'singapore (auth) should use mobile');

  restoreProxyEnv();
});

// --- (2) residential + mobile UNSET → graceful degradation to VPS ----------

test('residential & mobile unset: akamai and auth both DEGRADE to datacenter VPS', () => {
  clearProxyEnv();
  process.env.DATACENTER_PROXY_URL = DC;
  // RESIDENTIAL_PROXY_URL and MOBILE_PROXY_URL intentionally absent.

  // akamai would prefer residential, but it's gone → falls through to datacenter.
  assertEqual(resolveProxy('aa'), DC, 'aa should degrade akamai→datacenter');
  assertEqual(resolveProxy('united'), DC, 'united should degrade akamai→datacenter');

  // auth would prefer mobile→residential, both gone → falls through to datacenter.
  assertEqual(resolveProxy('flying-blue'), DC, 'flying-blue should degrade auth→datacenter');
  assertEqual(resolveProxy('singapore'), DC, 'singapore should degrade auth→datacenter');

  // public is unaffected — still datacenter.
  assertEqual(resolveProxy('jetblue'), DC, 'jetblue should stay on datacenter');

  // Prove the chain has the RIGHT shape: with only mobile present, auth uses
  // mobile while akamai (no residential) still degrades to datacenter — i.e. the
  // fall-through is per-tier, not all-or-nothing.
  delete process.env.MOBILE_PROXY_URL;
  process.env.MOBILE_PROXY_URL = MOB;
  assertEqual(resolveProxy('flying-blue'), MOB, 'auth should grab mobile when present');
  assertEqual(resolveProxy('aa'), DC, 'akamai (no residential) still degrades to datacenter');

  // And with PROXY_URL as the ONLY signal (legacy single-proxy setup), every
  // tier resolves to it via the datacenter default — nothing is left direct.
  clearProxyEnv();
  process.env.PROXY_URL = DC;
  assertEqual(resolveProxy('aa'), DC, 'PROXY_URL backs datacenter default for akamai');
  assertEqual(resolveProxy('flying-blue'), DC, 'PROXY_URL backs datacenter default for auth');
  assertEqual(resolveProxy('jetblue'), DC, 'PROXY_URL backs datacenter default for public');

  // With NOTHING configured at all → direct (undefined), no crash.
  clearProxyEnv();
  assertEqual(resolveProxy('aa'), undefined, 'no proxies configured → direct (undefined)');
  assertEqual(resolveProxy('flying-blue'), undefined, 'no proxies → direct for auth too');

  restoreProxyEnv();
});

// --- (3) unknown scraper key → safe default, no crash ----------------------

test('unknown scraper key defaults to a safe tier, does not crash', () => {
  clearProxyEnv();
  process.env.DATACENTER_PROXY_URL = DC;
  process.env.RESIDENTIAL_PROXY_URL = RES;

  // Unknown key must classify safely (akamai default) — never throw.
  const diff = difficultyFor('totally-unknown-airline');
  assertEqual(diff, 'akamai', 'unknown key should default to akamai difficulty');

  // And it should resolve to the best available proxy for that default tier.
  assertEqual(
    resolveProxy('totally-unknown-airline'),
    RES,
    'unknown key (akamai default) should route to residential when present',
  );

  // Empty-string key is also safe.
  assert(
    resolveProxy('') === RES,
    'empty scraper key should not crash and should route via default tier',
  );

  // With no proxies at all, unknown key degrades to undefined, not an exception.
  clearProxyEnv();
  assertEqual(
    resolveProxy('totally-unknown-airline'),
    undefined,
    'unknown key with no proxies → direct (undefined), no crash',
  );

  restoreProxyEnv();
});

// --- (4) listRouting() returns an entry per known scraper ------------------

test('listRouting() returns one diagnostic entry per known scraper with correct tiers', () => {
  clearProxyEnv();
  process.env.DATACENTER_PROXY_URL = DC;
  process.env.RESIDENTIAL_PROXY_URL = RES;
  process.env.MOBILE_PROXY_URL = MOB;

  const routing = listRouting();
  const knownKeys = Object.keys(DIFFICULTY);

  assertEqual(
    routing.length,
    knownKeys.length,
    'listRouting must have one entry per known scraper',
  );

  // Every known key is represented exactly once.
  const seen = new Set(routing.map((r) => r.scraperKey));
  assertEqual(seen.size, knownKeys.length, 'no duplicate scraper keys in routing');
  for (const k of knownKeys) {
    assert(seen.has(k), `listRouting missing entry for ${k}`);
  }

  // Spot-check the diagnostic tier/url fields line up with resolveProxy.
  const byKey = new Map(routing.map((r) => [r.scraperKey, r]));
  assertEqual(byKey.get('jetblue')!.tier, 'datacenter', 'jetblue diag tier = datacenter');
  assertEqual(byKey.get('aa')!.tier, 'residential', 'aa diag tier = residential');
  assertEqual(byKey.get('flying-blue')!.tier, 'mobile', 'flying-blue diag tier = mobile');
  assertEqual(byKey.get('flying-blue')!.proxyUrl, MOB, 'flying-blue diag url = mobile url');

  // Degraded diagnostics: drop residential+mobile, akamai/auth show 'datacenter'.
  delete process.env.RESIDENTIAL_PROXY_URL;
  delete process.env.MOBILE_PROXY_URL;
  const degraded = new Map(listRouting().map((r) => [r.scraperKey, r]));
  assertEqual(degraded.get('aa')!.tier, 'datacenter', 'aa diag degrades to datacenter');
  assertEqual(degraded.get('flying-blue')!.tier, 'datacenter', 'flying-blue diag degrades');

  // Direct diagnostics: nothing configured → tier 'direct', url undefined.
  clearProxyEnv();
  const direct = new Map(listRouting().map((r) => [r.scraperKey, r]));
  assertEqual(direct.get('aa')!.tier, 'direct', 'aa diag tier = direct when unconfigured');
  assertEqual(direct.get('aa')!.proxyUrl, undefined, 'aa diag url = undefined when unconfigured');

  restoreProxyEnv();

  console.log(
    'OUTCOME: routing by difficulty ok, degrades to VPS when residential/mobile unset ok',
  );
});

run();
