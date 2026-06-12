/**
 * Proof test for the off-Mac light-worker container contract.  [M3.4]
 *
 * WHAT: a PURE, OFFLINE structural lint of the repo-root `Dockerfile` and
 *       `.dockerignore`. It reads both files from disk and asserts the
 *       invariants that make the image valid-by-construction:
 *
 *         1. Dockerfile exists.
 *         2. Dual runtime: it provisions BOTH Node (FROM node:*) and Python
 *            (apt-get python3) — the curl_cffi tier needs Python, the
 *            orchestration needs Node/tsx.
 *         3. Cache ordering: package.json is COPY'd (and deps installed) BEFORE
 *            the full-source `COPY . .`, so editing a scraper doesn't bust the
 *            slow npm/pip layers.
 *         4. pip installs requirements.txt (the curl_cffi deps).
 *         5. The default CMD runs tests/run-frontier-tests.ts, so a built image
 *            self-verifies.
 *         6. .dockerignore excludes node_modules, .env, and data — keeping the
 *            context lean and secrets/state out of the image.
 *
 * WHY OFFLINE: a real `docker build` is the OPERATOR'S step (see notes /
 *       docs/fleet-deploy.md). This test never shells out to Docker; it proves
 *       the contract from the file contents alone, so it runs in CI with no
 *       Docker daemon, no network, and no credentials — matching the
 *       dormant/offline discipline of the rest of the frontier suite.
 */
import * as fs from 'fs';
import * as path from 'path';
import { test, assert, run } from '../_assert.js';

const ROOT = path.resolve(__dirname, '..', '..');
const DOCKERFILE = path.join(ROOT, 'Dockerfile');
const DOCKERIGNORE = path.join(ROOT, '.dockerignore');

/** Read a file or fail the test with a clear message (never throws raw ENOENT). */
function readOrFail(p: string, label: string): string {
  assert(fs.existsSync(p), `${label} must exist at ${p}`);
  return fs.readFileSync(p, 'utf8');
}

/** Index of the FIRST line matching a predicate, or -1. (Comments stripped.) */
function firstLineMatching(lines: string[], pred: (l: string) => boolean): number {
  return lines.findIndex((l) => !l.trim().startsWith('#') && pred(l));
}

test('Dockerfile is a valid-by-construction light-worker image; .dockerignore is lean+safe', () => {
  const df = readOrFail(DOCKERFILE, 'Dockerfile');
  const di = readOrFail(DOCKERIGNORE, '.dockerignore');

  // Work on non-comment instruction lines for ordering checks.
  const lines = df.split('\n');
  const instr = lines.filter((l) => !l.trim().startsWith('#') && l.trim().length > 0);
  const blob = instr.join('\n');

  // --- Invariant 2a: Node runtime present (base image). ---
  const hasNode = /^FROM\s+node:\d/m.test(blob);
  assert(hasNode, 'Dockerfile must base on a Node image (FROM node:<version>) for tsx orchestration');

  // --- Invariant 2b: Python runtime installed (for curl_cffi). ---
  const hasPython = /apt-get\s+install[\s\S]*python3/.test(blob);
  assert(hasPython, 'Dockerfile must install python3 (curl_cffi tier needs Python)');

  // --- Invariant 3: cache ordering — COPY package.json BEFORE the full source. ---
  const copyPkgIdx = firstLineMatching(
    lines,
    (l) => /^\s*COPY\s+/.test(l) && /package\.json/.test(l),
  );
  // The full-source copy is `COPY . ...` (a bare dot as the source).
  const copyAllIdx = firstLineMatching(
    lines,
    (l) => /^\s*COPY\s+\.\s+/.test(l),
  );
  assert(copyPkgIdx >= 0, 'Dockerfile must COPY package.json (dependency manifest)');
  assert(copyAllIdx >= 0, 'Dockerfile must COPY the full source (COPY . .)');
  assert(
    copyPkgIdx < copyAllIdx,
    `cache ordering broken: package.json copy (line ${copyPkgIdx}) must precede full-source copy (line ${copyAllIdx})`,
  );

  // --- Invariant 3b: a node dependency install runs (npm ci or npm install). ---
  const hasNpmInstall = /npm\s+(ci|install)/.test(blob);
  assert(hasNpmInstall, 'Dockerfile must run npm ci (or npm install) for Node deps');

  // The npm install should also be before the full-source copy (cache layer).
  const npmIdx = firstLineMatching(lines, (l) => /RUN[\s\S]*npm\s+(ci|install)/.test(l));
  assert(
    npmIdx >= 0 && npmIdx < copyAllIdx,
    'npm install must run before COPY . . to keep the deps layer cache-stable',
  );

  // --- Invariant 4: pip installs requirements.txt. ---
  const hasPipReq = /pip3?\s+install[\s\S]*requirements\.txt/.test(blob);
  assert(hasPipReq, 'Dockerfile must pip install -r requirements.txt (curl_cffi deps)');

  // --- Invariant 5: default CMD runs the frontier proof loop. ---
  const cmdMatch = /^CMD\s+(.+)$/m.exec(blob);
  assert(cmdMatch !== null, 'Dockerfile must declare a default CMD');
  const cmdText = cmdMatch![1];
  assert(
    /tests\/run-frontier-tests\.ts/.test(cmdText),
    `default CMD must run tests/run-frontier-tests.ts so the image self-verifies (got: ${cmdText})`,
  );

  // --- Invariant 6: .dockerignore excludes node_modules, .env, data. ---
  const ignored = di
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  const excludes = (entry: string) =>
    ignored.some((l) => l === entry || l === `${entry}/` || l === `/${entry}`);

  assert(excludes('node_modules'), '.dockerignore must exclude node_modules');
  assert(excludes('.env'), '.dockerignore must exclude .env (secrets must not be baked in)');
  assert(excludes('data'), '.dockerignore must exclude data (mutable runtime state)');

  // Count the invariants that held for the OUTCOME summary.
  const invariants = [
    'node-base',
    'python-installed',
    'pkg-before-source',
    'npm-install',
    'pip-requirements',
    'cmd-self-verify',
    'ignore-node_modules',
    'ignore-.env',
    'ignore-data',
  ];

  console.log(
    `OUTCOME: ${invariants.length}/${invariants.length} container invariants held ` +
      '(dual-runtime node+python, cache order pkg<source, pip -r requirements.txt, ' +
      'CMD=run-frontier-tests, .dockerignore drops node_modules/.env/data) — ' +
      'real `docker build` is the operator step',
  );
});

run();
