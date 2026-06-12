/**
 * Flight-Points Contributor — content script.
 *
 * Runs inside the user's OWN logged-in airline tab (opt-in only). It reads the
 * already-rendered award-search RESULTS from the page DOM — it NEVER touches
 * login forms, cookies, tokens, or credentials. The harvested rows are handed to
 * the background worker, which signs and POSTs them to the Flight-Points relay.
 *
 * `parseAvailability(documentLike)` is factored out and EXPORTED so it can be
 * unit-tested offline against a tiny fixture object (a stand-in for `document`
 * exposing `querySelectorAll`), with no real browser. The skeleton selectors
 * below are intentionally generic placeholders — each airline portal needs its
 * own selector map filled in (and validated by the self-healing parser layer).
 */

// Skeleton selector contract. A real per-airline build replaces these. Kept here
// so parseAvailability has a single, testable extraction shape.
const ROW_SELECTOR = '[data-fp-award-row]';
const MILES_SELECTOR = '[data-fp-miles]';
const CABIN_SELECTOR = '[data-fp-cabin]';
const TAXES_SELECTOR = '[data-fp-taxes]';

/** Parse "77,500 miles" / "$ 5.60" / "5.6 USD" → a finite number, or null. */
function parseNumber(text) {
  if (text == null) return null;
  const cleaned = String(text).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function textOf(node) {
  if (!node) return '';
  // Support both a real DOM node (.textContent) and plain fixture objects (.text).
  return (node.textContent != null ? node.textContent : node.text) || '';
}

/**
 * Extract award rows from a document-like object.
 * @param {{ querySelectorAll: (sel: string) => any[] | NodeListOf<any> }} documentLike
 * @returns {Array<{ pointsRequired: number, cabin: string, taxesAndFees?: number }>}
 *
 * A "document-like" is anything exposing querySelectorAll. Each matched row must
 * itself expose querySelector(sel) (real Elements do; fixtures provide a stub).
 * Rows without a parseable miles value are skipped — partial junk never ships.
 */
function parseAvailability(documentLike) {
  const out = [];
  if (!documentLike || typeof documentLike.querySelectorAll !== 'function') return out;

  const rows = Array.from(documentLike.querySelectorAll(ROW_SELECTOR) || []);
  for (const row of rows) {
    if (!row || typeof row.querySelector !== 'function') continue;

    const pointsRequired = parseNumber(textOf(row.querySelector(MILES_SELECTOR)));
    if (pointsRequired == null || pointsRequired <= 0) continue; // require real miles

    const cabin = textOf(row.querySelector(CABIN_SELECTOR)).trim() || 'unknown';

    const entry = { pointsRequired, cabin };
    const taxes = parseNumber(textOf(row.querySelector(TAXES_SELECTOR)));
    if (taxes != null) entry.taxesAndFees = taxes;

    out.push(entry);
  }
  return out;
}

/**
 * Build the contribution envelope from the current page. Origin/destination/date
 * would be read from the page or URL in a real build — left as TODO placeholders
 * in this skeleton so the shape matches ContributePayload in relay.ts.
 */
function buildPayload(documentLike) {
  return {
    scraper: 'crowdsource-extension',
    origin: '', // TODO: read from page/URL per airline
    destination: '', // TODO: read from page/URL per airline
    date: '', // TODO: read from page/URL per airline
    cabin: 'any',
    results: parseAvailability(documentLike),
    capturedAt: new Date().toISOString(),
  };
}

// Browser runtime: harvest and hand off to the background worker. Guarded so this
// file is also importable in a non-browser (test) context without side effects.
if (typeof chrome !== 'undefined' && chrome.runtime && typeof document !== 'undefined') {
  try {
    const payload = buildPayload(document);
    if (payload.results.length > 0) {
      chrome.runtime.sendMessage({ type: 'fp-contribute', payload });
    }
  } catch (e) {
    // Never disrupt the user's page — log and move on.
    console.error('[fp-contributor] harvest failed:', e);
  }
}

// Export for unit testing (CommonJS in test env; ignored by the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseAvailability, buildPayload, parseNumber };
}
