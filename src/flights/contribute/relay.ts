/**
 * Crowdsource contribution RELAY — signed ingest of award availability harvested
 * from users' OWN logged-in airline tabs (the M3.3 "crowdsource extension").
 *
 * WHY this exists: the daemon scrapes from a single VPS IP and a handful of
 * server-side sessions, so the hardest walls (reCAPTCHA logins like Aeroplan,
 * IP-reputation/Akamai sites) stay dark. A browser extension running in a
 * volunteer's real, already-logged-in tab sees award space the daemon never can,
 * over genuine residential IPs and authenticated sessions. This relay is the
 * server side: it accepts those harvested rows so they can feed the same cache.
 *
 * WHAT this file is: a PURE, framework-agnostic ingest pipeline plus an Express
 * route shim. The core (`ingestContribution`) takes the RAW request body string
 * and an HMAC signature and is fully testable with no HTTP server, no DB, and no
 * network — the row-writer is injectable.
 *
 * SECURITY model — never trust the wire:
 *   - Every payload is HMAC-SHA256 signed with a shared secret the extension and
 *     server both hold (CONTRIBUTE_SECRET). Signing is over the EXACT raw body
 *     bytes so a re-serialized/reordered body can't be smuggled past the check.
 *   - Verification is constant-time (crypto.timingSafeEqual) and returns false —
 *     never throws — on length mismatch, bad hex, or missing input.
 *   - Payloads are shape-validated and miles are sanity-bounded (a crowdsourced
 *     "1 mile JFK→NRT first" is almost certainly a parse error or spoof).
 *
 * DORMANT-WITHOUT-KEY: when CONTRIBUTE_SECRET is unset the route stays harmless —
 * ingest returns {ok:false,status:503} and writes nothing. Mirrors the dormant
 * shape in vision-verify.ts / parser-autorepair.ts: log to stderr, degrade, never
 * throw, never reach out at import time. The running daemon is unaffected when the
 * env var is absent, and the writer is injected (default no-op) so this module
 * makes no network/DB call on its own.
 */
import * as crypto from 'node:crypto';

/** Header carrying the hex HMAC-SHA256 of the raw request body. */
export const SIGNATURE_HEADER = 'x-signature';

/** A single harvested availability row from an airline results page. */
export interface ContributeRow {
  pointsRequired: number;
  taxesAndFees?: number;
  cabin: string;
}

/** The contribution envelope POSTed by the extension's background worker. */
export interface ContributePayload {
  scraper: string;
  origin: string;
  destination: string;
  date: string;
  cabin: string;
  results: ContributeRow[];
  capturedAt: string;
}

/** Outcome of an ingest attempt. `status` mirrors the HTTP status the route emits. */
export interface IngestResult {
  ok: boolean;
  status: number;
  wroteRows: number;
  error?: string;
}

/** Injectable persistence — returns the number of rows actually written. */
export type WriteRowsFn = (payload: ContributePayload) => Promise<number>;

// Crowdsourced miles must be plausible award pricing. <=0 is a parse failure or
// spoof; >1,000,000 is implausible for any real award (the priciest first-class
// redemptions top out around the low hundred-thousands).
const MIN_MILES = 0; // exclusive lower bound (must be > 0)
const MAX_MILES = 1_000_000; // inclusive upper bound

function log(msg: string): void {
  console.error(`[contribute-relay ${new Date().toISOString()}] ${msg}`);
}

/** HMAC-SHA256 of the raw body string, hex-encoded. */
export function signPayload(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Constant-time verification of a hex HMAC signature against the raw body.
 * Returns false (never throws) on length mismatch, malformed hex, or any bad
 * input — so a malformed signature is rejected, not crashed on.
 */
export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (typeof rawBody !== 'string' || typeof signature !== 'string' || typeof secret !== 'string') {
    return false;
  }
  if (!secret || !signature) return false;
  try {
    const expected = signPayload(rawBody, secret);
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    // timingSafeEqual throws on unequal lengths — guard first so a wrong-length
    // signature is a quiet `false`, and the compare stays constant-time.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Type guard + bounds check for a single harvested row. */
function isValidRow(row: unknown): row is ContributeRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (typeof r.pointsRequired !== 'number' || !Number.isFinite(r.pointsRequired)) return false;
  if (r.pointsRequired <= MIN_MILES || r.pointsRequired > MAX_MILES) return false;
  if (typeof r.cabin !== 'string' || !r.cabin.trim()) return false;
  if (r.taxesAndFees !== undefined && (typeof r.taxesAndFees !== 'number' || !Number.isFinite(r.taxesAndFees))) {
    return false;
  }
  return true;
}

/**
 * Validate a parsed payload's shape. Returns an error string if malformed/missing
 * fields or implausible miles, otherwise null. (Empty `results` is allowed — a
 * genuine "searched, found nothing" report is still signal.)
 */
function validatePayload(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return 'payload is not an object';
  const p = parsed as Record<string, unknown>;
  for (const field of ['scraper', 'origin', 'destination', 'date', 'cabin', 'capturedAt'] as const) {
    if (typeof p[field] !== 'string' || !(p[field] as string).trim()) {
      return `missing or invalid field: ${field}`;
    }
  }
  if (!Array.isArray(p.results)) return 'results must be an array';
  for (let i = 0; i < p.results.length; i++) {
    if (!isValidRow(p.results[i])) {
      return `invalid row at index ${i} (missing fields or implausible miles, must be >0 and <=${MAX_MILES})`;
    }
  }
  return null;
}

/**
 * Core ingest pipeline. Pure and framework-agnostic — takes the RAW body string
 * (the exact bytes the signature was computed over) and the signature, and never
 * throws.
 *
 * Resolution / status ladder:
 *   - no secret configured (opts.secret ?? CONTRIBUTE_SECRET unset) -> 503 (dormant)
 *   - missing/invalid/wrong signature                               -> 401
 *   - malformed JSON / missing fields / implausible miles           -> 400
 *   - valid                                                         -> 200, writeRows() called
 *
 * The secret is checked BEFORE parsing so a dormant server reveals nothing about
 * payload validity. `writeRows` is injected; the default no-op returns the row
 * count so the relay is inert (no DB/network) until a real writer is wired in.
 */
export async function ingestContribution(
  rawBody: string,
  signature: string,
  opts: { secret?: string; writeRows?: WriteRowsFn } = {},
): Promise<IngestResult> {
  const secret = opts.secret ?? process.env.CONTRIBUTE_SECRET;

  // DORMANT: no secret configured → accept nothing, stay harmless.
  if (!secret) {
    log('CONTRIBUTE_SECRET not set — relay dormant, rejecting with 503.');
    return { ok: false, status: 503, wroteRows: 0, error: 'contribution relay not configured' };
  }

  // AUTH: verify HMAC over the exact raw bytes before trusting any content.
  if (!verifySignature(rawBody, signature, secret)) {
    return { ok: false, status: 401, wroteRows: 0, error: 'missing or invalid signature' };
  }

  // PARSE: tolerate any malformed JSON.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, wroteRows: 0, error: 'malformed JSON body' };
  }

  // SHAPE + SANITY: reject missing fields / implausible miles.
  const validationError = validatePayload(parsed);
  if (validationError) {
    return { ok: false, status: 400, wroteRows: 0, error: validationError };
  }

  const payload = parsed as ContributePayload;

  // PERSIST via the injected writer (default no-op returns the row count). Any
  // writer failure degrades to 500 rather than throwing out of the handler.
  const writeRows: WriteRowsFn = opts.writeRows ?? (async (p) => p.results.length);
  try {
    const wroteRows = await writeRows(payload);
    return { ok: true, status: 200, wroteRows };
  } catch (e: any) {
    log(`writeRows failed for ${payload.scraper} ${payload.origin}->${payload.destination}: ${e?.message ?? e}`);
    return { ok: false, status: 500, wroteRows: 0, error: 'failed to persist contribution' };
  }
}

/**
 * Minimal Express-shaped types so this module needs no `express` import (it stays
 * usable from contexts that don't depend on express types). Structurally matches
 * the real Express objects used by web-server.ts.
 */
interface ExpressReqLike {
  body?: unknown;
  get(header: string): string | undefined;
  header?(header: string): string | undefined;
}
interface ExpressResLike {
  status(code: number): ExpressResLike;
  json(body: unknown): unknown;
}
interface ExpressAppLike {
  post(path: string, handler: (req: ExpressReqLike, res: ExpressResLike) => void | Promise<void>): unknown;
}

/**
 * Register POST /api/flights/contribute on an Express app. Tiny by design: read
 * the JSON body + signature header, hand off to ingestContribution, and map the
 * IngestResult straight onto the HTTP response. Dormant-safe — if
 * CONTRIBUTE_SECRET is unset the handler returns 503 and writes nothing.
 *
 * Because the HMAC must cover the EXACT bytes the client signed, we re-serialize
 * the already-parsed `req.body` (express.json() has run). The extension signs the
 * same canonical JSON.stringify output, so they agree.
 */
export function registerContributeRoute(
  app: ExpressAppLike,
  deps: { writeRows?: WriteRowsFn } = {},
): void {
  app.post('/api/flights/contribute', async (req, res) => {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const signature = req.get(SIGNATURE_HEADER) ?? req.header?.(SIGNATURE_HEADER) ?? '';
    const result = await ingestContribution(rawBody, signature, { writeRows: deps.writeRows });
    res.status(result.status).json(
      result.ok
        ? { ok: true, wroteRows: result.wroteRows }
        : { ok: false, error: result.error ?? 'contribution rejected' },
    );
  });
}
