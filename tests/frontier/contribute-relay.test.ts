/**
 * Proof test for the M3.3 crowdsource RELAY — signed ingest of award rows
 * harvested from volunteers' own logged-in airline tabs.
 *
 * Outcome under test: the relay accepts ONLY correctly-signed, well-formed,
 * plausible contributions, and stays harmless when unconfigured. Specifically:
 *   (1) a correctly HMAC-signed, valid payload -> ok:true, status:200, and the
 *       injected writeRows is called with the right payload + row count.
 *   (2) an UNSIGNED or WRONG-signature payload -> 401, writeRows NOT called.
 *   (3) malformed JSON / missing fields / implausible miles -> 400.
 *   (4) no secret configured -> 503 (dormant), writeRows NOT called.
 *   (5) parseAvailability() against a small DOM-like fixture -> expected rows.
 *
 * Fully offline: signing is done with node:crypto, persistence is a fake
 * writeRows that captures its input, and the content-script parser is exercised
 * against a plain object fixture. No HTTP server, no DB, no network.
 */
import { test, assert, assertEqual, run } from '../_assert.js';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  signPayload,
  verifySignature,
  ingestContribution,
  type ContributePayload,
} from '../../src/flights/contribute/relay.js';

const SECRET = 'test-contribute-secret-0xDEADBEEF';

function validPayload(): ContributePayload {
  return {
    scraper: 'crowdsource-extension',
    origin: 'JFK',
    destination: 'NRT',
    date: '2026-09-15',
    cabin: 'business',
    capturedAt: '2026-06-11T12:00:00.000Z',
    results: [
      { pointsRequired: 77500, cabin: 'business', taxesAndFees: 5.6 },
      { pointsRequired: 60000, cabin: 'economy' },
    ],
  };
}

// ── (1) Correctly-signed valid payload -> 200 + writeRows called correctly ──
test('valid signed payload ingests ok:true/200 and calls writeRows with right count', async () => {
  const payload = validPayload();
  const raw = JSON.stringify(payload);
  const sig = signPayload(raw, SECRET);

  let captured: ContributePayload | null = null;
  let calls = 0;
  const writeRows = async (p: ContributePayload) => {
    captured = p;
    calls++;
    return p.results.length;
  };

  const res = await ingestContribution(raw, sig, { secret: SECRET, writeRows });

  assertEqual(res.ok, true, 'expected ok:true for a valid signed payload');
  assertEqual(res.status, 200, 'expected status 200');
  assertEqual(res.wroteRows, 2, 'expected wroteRows to equal the 2 rows in the payload');
  assertEqual(calls, 1, 'writeRows must be called exactly once');
  assert(captured !== null, 'writeRows must receive the payload');
  assertEqual((captured as any).origin, 'JFK', 'captured payload origin should round-trip');
  assertEqual((captured as any).results.length, 2, 'captured payload must carry both rows');
});

// ── (2) Unsigned / wrong-signature -> 401, writeRows NOT called ──
test('unsigned and wrong-signature payloads -> 401 and writeRows NOT called', async () => {
  const raw = JSON.stringify(validPayload());

  let calls = 0;
  const writeRows = async () => {
    calls++;
    return 99;
  };

  // Empty signature.
  const unsigned = await ingestContribution(raw, '', { secret: SECRET, writeRows });
  assertEqual(unsigned.ok, false, 'unsigned must be rejected');
  assertEqual(unsigned.status, 401, 'unsigned must be 401');

  // Signature computed with the WRONG secret.
  const wrongSig = signPayload(raw, 'a-different-secret');
  const wrong = await ingestContribution(raw, wrongSig, { secret: SECRET, writeRows });
  assertEqual(wrong.ok, false, 'wrong signature must be rejected');
  assertEqual(wrong.status, 401, 'wrong signature must be 401');

  // Right signature but the body was TAMPERED after signing (miles inflated).
  const tampered = raw.replace('77500', '88888');
  const realSig = signPayload(raw, SECRET);
  const tamperRes = await ingestContribution(tampered, realSig, { secret: SECRET, writeRows });
  assertEqual(tamperRes.ok, false, 'tampered body must fail signature check');
  assertEqual(tamperRes.status, 401, 'tampered body must be 401');

  // Garbage hex signature must be a quiet 401, never a throw.
  const garbage = await ingestContribution(raw, 'not-hex-zzzz', { secret: SECRET, writeRows });
  assertEqual(garbage.status, 401, 'garbage signature must be 401, not a crash');

  assertEqual(calls, 0, 'writeRows must NEVER be called for any auth failure');
});

// ── (3) Malformed JSON / missing fields / implausible miles -> 400 ──
test('malformed JSON, missing fields, and implausible miles -> 400', async () => {
  let calls = 0;
  const writeRows = async () => {
    calls++;
    return 1;
  };

  // (a) Malformed JSON (still correctly signed over the raw bytes).
  const badJson = '{ this is not json ]';
  const badJsonSig = signPayload(badJson, SECRET);
  const r1 = await ingestContribution(badJson, badJsonSig, { secret: SECRET, writeRows });
  assertEqual(r1.status, 400, 'malformed JSON must be 400');

  // (b) Missing required field (no `origin`).
  const missing: any = validPayload();
  delete missing.origin;
  const missingRaw = JSON.stringify(missing);
  const r2 = await ingestContribution(missingRaw, signPayload(missingRaw, SECRET), { secret: SECRET, writeRows });
  assertEqual(r2.status, 400, 'missing field must be 400');

  // (c) Implausible miles: zero.
  const zero: any = validPayload();
  zero.results = [{ pointsRequired: 0, cabin: 'business' }];
  const zeroRaw = JSON.stringify(zero);
  const r3 = await ingestContribution(zeroRaw, signPayload(zeroRaw, SECRET), { secret: SECRET, writeRows });
  assertEqual(r3.status, 400, 'zero miles must be 400');

  // (d) Implausible miles: over the 1,000,000 cap.
  const huge: any = validPayload();
  huge.results = [{ pointsRequired: 5_000_000, cabin: 'first' }];
  const hugeRaw = JSON.stringify(huge);
  const r4 = await ingestContribution(hugeRaw, signPayload(hugeRaw, SECRET), { secret: SECRET, writeRows });
  assertEqual(r4.status, 400, 'miles over 1,000,000 must be 400');

  assertEqual(calls, 0, 'writeRows must NOT be called for any 400');
});

// ── (4) No secret configured -> 503 (dormant) ──
test('no secret configured -> 503 dormant, writeRows NOT called', async () => {
  const raw = JSON.stringify(validPayload());
  // Sign with SOMETHING so the only reason for rejection is the missing secret.
  const sig = signPayload(raw, SECRET);

  let calls = 0;
  const writeRows = async () => {
    calls++;
    return 1;
  };

  // Ensure env is also empty so the env fallback can't accidentally configure it.
  const savedEnv = process.env.CONTRIBUTE_SECRET;
  delete process.env.CONTRIBUTE_SECRET;
  try {
    const res = await ingestContribution(raw, sig, { writeRows }); // no opts.secret
    assertEqual(res.ok, false, 'dormant relay must reject');
    assertEqual(res.status, 503, 'dormant (no secret) must be 503');
    assertEqual(calls, 0, 'writeRows must NOT be called when dormant');
  } finally {
    if (savedEnv !== undefined) process.env.CONTRIBUTE_SECRET = savedEnv;
  }

  // Sanity: verifySignature stays a pure boolean (true here) and never throws.
  assertEqual(verifySignature(raw, sig, SECRET), true, 'verifySignature should validate a correct sig');
});

// ── (5) parseAvailability() unit test against a small DOM-like fixture ──
test('parseAvailability extracts expected rows from a fixture document', async () => {
  // Load the content-script's CommonJS export from the ESM test via createRequire.
  const require = createRequire(import.meta.url);
  const { parseAvailability } = require('../../extension/content-script.js') as {
    parseAvailability: (doc: any) => Array<{ pointsRequired: number; cabin: string; taxesAndFees?: number }>;
  };

  // A tiny "document-like": querySelectorAll('[data-fp-award-row]') returns rows,
  // each row.querySelector(sel) returns a node with `.text` for the field text.
  const makeNode = (text: string) => ({ text });
  const makeRow = (miles: string, cabin: string, taxes?: string) => ({
    querySelector(sel: string) {
      if (sel === '[data-fp-miles]') return makeNode(miles);
      if (sel === '[data-fp-cabin]') return makeNode(cabin);
      if (sel === '[data-fp-taxes]') return taxes !== undefined ? makeNode(taxes) : null;
      return null;
    },
  });

  const fixtureDoc = {
    querySelectorAll(sel: string) {
      if (sel !== '[data-fp-award-row]') return [];
      return [
        makeRow('77,500 miles', 'Business', '$5.60'),
        makeRow('60,000 miles', 'Economy'), // no taxes node
        makeRow('not-a-number', 'First'), // unparseable miles → skipped
      ];
    },
  };

  const rows = parseAvailability(fixtureDoc);
  assertEqual(rows.length, 2, 'should extract 2 valid rows (the junk-miles row is skipped)');
  assertEqual(rows[0].pointsRequired, 77500, 'first row miles parsed from "77,500 miles"');
  assertEqual(rows[0].cabin, 'Business', 'first row cabin');
  assertEqual(rows[0].taxesAndFees, 5.6, 'first row taxes parsed from "$5.60"');
  assertEqual(rows[1].pointsRequired, 60000, 'second row miles');
  assertEqual(rows[1].taxesAndFees, undefined, 'second row has no taxes node');

  // End-to-end glue: a parsed row signed + ingested should round-trip to 200.
  const payload: ContributePayload = {
    scraper: 'crowdsource-extension',
    origin: 'JFK',
    destination: 'NRT',
    date: '2026-09-15',
    cabin: 'business',
    capturedAt: new Date().toISOString(),
    results: rows,
  };
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
  let wrote = -1;
  const res = await ingestContribution(raw, sig, {
    secret: SECRET,
    writeRows: async (p) => {
      wrote = p.results.length;
      return wrote;
    },
  });
  assertEqual(res.status, 200, 'parsed-then-ingested payload should be accepted');
  assertEqual(wrote, 2, 'the 2 parsed rows should reach writeRows');

  console.log(
    'OUTCOME: signed valid contribution -> 200 + writeRows(2 rows); ' +
      'unsigned/wrong/tampered/garbage -> 401 (writeRows never called); ' +
      'malformed/missing-field/0-miles/>1M-miles -> 400; no secret -> 503 dormant; ' +
      'parseAvailability extracted 2/3 rows (junk skipped).',
  );
});

run();
