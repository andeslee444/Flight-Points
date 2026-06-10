/**
 * Offline unit-test entry point.
 *
 * Statically imports every tests/unit/*.test.ts (each registers its cases at
 * module load via test() from _assert), then runs them all. Deterministic:
 * no network, no DB, no credentials.
 *
 *   npx tsx tests/run-unit.ts
 */
import { run } from './_assert.js';

// Static imports — each module registers its tests as a side effect.
import './unit/scraper-health.test.js';
import './unit/daemon-helpers.test.js';

run();
