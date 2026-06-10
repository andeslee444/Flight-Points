/**
 * Thin wrapper for the golden-route canary loop.
 *
 * The real implementation lives in src/flights/scraper-canary.ts — this file
 * just re-runs it so the canary is discoverable alongside the other tests/.
 * All flags (--loop, --loop=<seconds>) and env (CANARY_DRY=1) pass through
 * because scraper-canary.ts reads process.argv / process.env itself.
 *
 * Usage:
 *   npx tsx tests/run-canary.ts              # single run, exit 0 (no FAIL) / 1 (FAIL)
 *   npx tsx tests/run-canary.ts --loop       # loop every 6h until SIGINT
 *   npx tsx tests/run-canary.ts --loop=3600  # loop every hour
 *   CANARY_DRY=1 npx tsx tests/run-canary.ts # print golden-route plan, no network
 *
 * Importing the module is enough — its main() runs on load and owns process.exit.
 */
import '../src/flights/scraper-canary.js';
