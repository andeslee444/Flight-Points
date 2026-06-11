/**
 * PROOF test for fingerprint-coherence.ts
 *
 * This is not a smoke test: it proves the audit IMPROVES stealth by firing on
 * the configs that are actually self-incriminating (UA/TLS version skew, locale
 * vs. proxy-geo mismatch) and staying silent on a coherent config. A detector
 * that always fired would be useless, so we assert both directions.
 *
 * Deterministic, no network/DB. Run: tsx tests/approach/fingerprint-coherence.test.ts
 */

import { test, assert, run } from '../_assert.js';
import {
  checkCoherence,
  auditCurrent,
  impersonateBrowserVersion,
  uaBrowserVersion,
  VERSION_DRIFT_TOLERANCE,
} from '../../src/flights/net/fingerprint-coherence.js';

const CHROME_142_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const CHROME_99_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36';

// Outcome flags collected as assertions pass, printed as a single summary line.
let flagsUaSkew = false;
let flagsGeoMismatch = false;
let passesCoherent = false;

// ── parse helpers ───────────────────────────────────────────────────
test('impersonateBrowserVersion parses family + major version', () => {
  const a = impersonateBrowserVersion('chrome142');
  assert(a.browser === 'chrome' && a.version === 142, `chrome142 → ${JSON.stringify(a)}`);
  const b = impersonateBrowserVersion('safari17_0');
  assert(b.browser === 'safari' && b.version === 17, `safari17_0 → ${JSON.stringify(b)}`);
  const c = impersonateBrowserVersion('firefox135');
  assert(c.browser === 'firefox' && c.version === 135, `firefox135 → ${JSON.stringify(c)}`);
});

test('uaBrowserVersion parses Chrome and disambiguates Edge from Chrome', () => {
  const chrome = uaBrowserVersion(CHROME_142_UA);
  assert(chrome.browser === 'chrome' && chrome.version === 142, `chrome UA → ${JSON.stringify(chrome)}`);
  // Edge UAs contain "Chrome/..." too — must resolve to edge, not chrome.
  const edge = uaBrowserVersion(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  );
  assert(edge.browser === 'edge' && edge.version === 142, `edge UA → ${JSON.stringify(edge)}`);
});

// ── (1) coherent config → coherent:true, issues:[] ──────────────────
test('coherent config (chrome142 + Chrome/142 + en-US + US) passes clean', () => {
  const res = checkCoherence({
    impersonate: 'chrome142',
    userAgent: CHROME_142_UA,
    locale: 'en-US',
    proxyGeo: 'US',
  });
  assert(res.coherent === true, `expected coherent:true, got ${JSON.stringify(res)}`);
  assert(res.issues.length === 0, `expected no issues, got ${JSON.stringify(res.issues)}`);
  passesCoherent = true;
});

// A 1-major drift within tolerance must NOT flag (proves we don't over-fire).
test('within-tolerance version drift does not flag', () => {
  const res = checkCoherence({
    impersonate: 'chrome142',
    userAgent: CHROME_142_UA.replace('Chrome/142', 'Chrome/141'),
    locale: 'en-US',
    proxyGeo: 'US',
  });
  assert(VERSION_DRIFT_TOLERANCE >= 1, 'tolerance should allow at least 1 major of drift');
  assert(res.coherent === true, `1-major drift should pass, got ${JSON.stringify(res.issues)}`);
});

// ── (2) UA-mismatch config → coherent:false with version-skew issue ─
test('large UA/TLS version gap flags a version-skew issue', () => {
  const res = checkCoherence({
    impersonate: 'chrome142',
    userAgent: CHROME_99_UA, // claims Chrome 99 while TLS impersonates 142
    locale: 'en-US',
    proxyGeo: 'US',
  });
  assert(res.coherent === false, `expected coherent:false, got ${JSON.stringify(res)}`);
  const skew = res.issues.find((i) => i.includes('version-skew'));
  assert(!!skew, `expected a version-skew issue, got ${JSON.stringify(res.issues)}`);
  // The geo half is coherent here, so version-skew must be the ONLY issue.
  assert(res.issues.length === 1, `expected exactly the skew issue, got ${JSON.stringify(res.issues)}`);
  flagsUaSkew = true;
});

// Different browser families is also a fingerprint contradiction.
test('browser-family mismatch flags (chrome impersonate + Firefox UA)', () => {
  const res = checkCoherence({
    impersonate: 'chrome142',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0',
    locale: 'en-US',
    proxyGeo: 'US',
  });
  assert(res.coherent === false, `expected coherent:false, got ${JSON.stringify(res)}`);
  assert(
    res.issues.some((i) => i.includes('browser-family mismatch')),
    `expected family mismatch, got ${JSON.stringify(res.issues)}`,
  );
});

// ── (3) locale/geo mismatch → coherent:false with geo issue ─────────
test('locale vs. proxy-geo mismatch (en-US + DE) flags a geo issue', () => {
  const res = checkCoherence({
    impersonate: 'chrome142',
    userAgent: CHROME_142_UA, // fingerprint half is clean
    locale: 'en-US',
    proxyGeo: 'DE', // German exit with a US-English browser
  });
  assert(res.coherent === false, `expected coherent:false, got ${JSON.stringify(res)}`);
  const geo = res.issues.find((i) => i.includes('geo mismatch'));
  assert(!!geo, `expected a geo-mismatch issue, got ${JSON.stringify(res.issues)}`);
  // Fingerprint half is coherent, so geo mismatch must be the ONLY issue.
  assert(res.issues.length === 1, `expected exactly the geo issue, got ${JSON.stringify(res.issues)}`);
  flagsGeoMismatch = true;
});

// Matching locale/geo must NOT flag (proves geo check doesn't over-fire).
test('matching locale/geo (de-DE + DE) passes geo check', () => {
  const res = checkCoherence({
    impersonate: 'chrome142',
    userAgent: CHROME_142_UA,
    locale: 'de-DE',
    proxyGeo: 'DE',
  });
  assert(res.coherent === true, `de-DE on DE exit should pass, got ${JSON.stringify(res.issues)}`);
});

// ── (4) auditCurrent() runs and returns a result object ─────────────
test('auditCurrent() returns a coherent result for the live config', () => {
  const res = auditCurrent();
  assert(typeof res === 'object' && res !== null, 'auditCurrent should return an object');
  assert(typeof res.coherent === 'boolean', 'result.coherent should be boolean');
  assert(Array.isArray(res.issues), 'result.issues should be an array');
  // The project's real config (chrome142 + Chrome/142 UA + en-US + US) is coherent.
  assert(res.coherent === true, `current config should be coherent, got ${JSON.stringify(res.issues)}`);
});

// Emit the single-line OUTCOME summary after the suite reports.
process.on('exit', () => {
  console.log(
    `OUTCOME: flags UA skew ${flagsUaSkew ? 'ok' : 'FAIL'}, ` +
      `flags geo mismatch ${flagsGeoMismatch ? 'ok' : 'FAIL'}, ` +
      `passes coherent config ${passesCoherent ? 'ok' : 'FAIL'}`,
  );
});

run();
