# Frontier roadmap — implementation plan

Source: `frontier-roadmap-2026-06.md`. Principle: the ceiling is **architecture**, not
anti-bot. Every item ships with a **proof test** whose pass/fail is a real outcome
metric (throughput, ordering, dedup ratio, recovery), not a smoke test. Architectural
changes ship **behind a flag** so the running launchd daemon never breaks.

Module home: `src/flights/queue`, `src/flights/scheduling`, `src/flights/monitoring`,
`src/flights/healing`, `src/flights/net`. Tests: `tests/frontier/*.test.ts`, aggregated
by `tests/run-frontier-tests.ts` (each prints an `OUTCOME:` line).

External-dependency items (Redis, Browserbase/Steel, CapSolver, ANTHROPIC_API_KEY,
cloud fleet) are built **dormant + tested** — the logic/adapter is real and proof-tested;
it activates when the credential/service is configured, else degrades to today's path.

---

## Milestone 1 — Foundation (the keystone + free wins)

### 1.1 Job queue abstraction (`queue/job-queue.ts`)
`JobQueue` interface with two backends: `InMemoryQueue` (default; concurrency-bounded
fan-out within one process — already beats the current ~6-way serial loop) and
`BullMqQueue` (when `REDIS_URL` set; multi-process horizontal scale). Priorities,
delayed jobs, per-key dedup.
- **Test goal:** enqueue 20 jobs; a pool at concurrency=5 completes in ~⌈20/5⌉×jobTime, and ≤5 run simultaneously at any instant (assert max observed concurrency == 5). Proves throughput scales with workers, not the scraper count.

### 1.2 Producer + worker pool (`queue/producer.ts`, `queue/worker-pool.ts`)
Producer turns signups×routes×dates into jobs (with priority from 1.4). Worker pulls,
runs the registry scraper via the existing fallback chain, records health. Daemon
becomes a thin producer **behind `USE_QUEUE=1`** (default off → current loop unchanged).
- **Test goal:** producer emits exactly one job per (scraper,route,date); a 3-worker pool drains a 12-job set with each job run exactly once and total wall-time ≈ 12/3 × jobTime. Proves correct fan-out + no double-execution.

### 1.3 Singleflight coalescing (`scrapers/singleflight.ts`) + wire into `cache.ts`
`Map<key, Promise>` so N concurrent identical (route,date,scraper) calls await ONE.
- **Test goal:** fire 100 concurrent calls for one key against a counting fake; assert the underlying fn ran **exactly 1×** and all 100 got the same result. Proves elimination of the daemon/live-search thundering herd.

### 1.4 Crawl-score priority (`scheduling/crawl-score.ts`)
`priority = userDemand × milesVolatility × dealLikelihood(distance below sweet-spot) ×
staleness`. Pure function over price-history + signups + sweet-spots.
- **Test goal:** given a hot route (watched, volatile, near sweet-spot, stale) and a cold route (unwatched, flat, far, fresh), assert hot > cold and that scrambled input still ranks hot first. Proves the 25-job budget lands on deal-likely routes.

### 1.5 Volatility-keyed TTL (`scheduling/ttl-policy.ts`) + wire into cache
`ttlFor(route)` short for volatile/near-sweet-spot, long for flat.
- **Test goal:** assert ttl(volatile) < ttl(stable) and both within bounds. Proves proxy-GB isn't wasted re-scraping stable routes.

### 1.6 Persistent run-history + per-scraper alerts (`monitoring/run-history.ts` + migration)
Durable `scrape_runs` (ts, scraper, route, outcome, count) — survives restart (today's
health Map resets). Alert when an **individual** scraper flips `suspect`.
- **Test goal:** record a scraper degrading to suspect across N runs (storage-abstracted, in-memory in test) → assert the alert fires once on the flip, not every run, and not for healthy scrapers. Proves per-scraper silent-rot is caught (the 4-month-outage class).

---

## Milestone 2 — Intelligence & self-healing  ✅ built + integrated (flag-gated)

> Status: all three modules built, proof-tested, and wired live behind flags.
> `ADAPTIVE_CADENCE=1` feeds a fleet AIMD into the queue worker count;
> `COST_BUDGET_USD=<n>` gates curl_cffi proxy-tier escalation + meters spend;
> `PARSER_AUTOREPAIR=1` fires `attemptRepair` on a vision `layout_changed` verdict
> (LLM dormant w/o `ANTHROPIC_API_KEY`; validator rejects unproven selectors).
> Master loop is 9/9 (added `budget-proxy-routing` live-wiring proof).

### 2.1 Adaptive cadence (`scheduling/adaptive-cadence.ts`)
Per-route poll interval (tightens when volatile/near-deal, relaxes when flat) + per-host
AIMD concurrency (additive-increase on success, multiplicative-decrease on 403/429/captcha;
fed by the existing soft-block + Retry-After signals).
- **Test goal:** simulate a success streak → interval shrinks / concurrency additively rises; inject block signals → concurrency multiplicatively backs off and interval relaxes; assert the sawtooth. Proves hot routes polled more and blocks reduce load — within the same envelope.

### 2.2 Cost-aware scheduling (`scheduling/cost-budget.ts`)
Per-job cost (proxy GB + browser-hours), monthly ceiling, cheap-tier-first escalation,
degrade to VPS at ceiling (difficulty-router already degrades).
- **Test goal:** run a job mix under a budget; assert cheap curl_cffi tier chosen first, escalation to residential/browser only for high-priority routes, and hard stop (degrade) when the ceiling is hit. Proves spend is bounded and allocated to high-value routes.

### 2.3 Self-healing parser auto-repair (`healing/parser-autorepair.ts`)
On a vision `layout_changed` flag, send screenshot+DOM+last-known-good selector to an LLM
to regenerate the selector; **validate against the golden route's known result and
hot-swap only if it reproduces expected miles/count**. Dormant w/o `ANTHROPIC_API_KEY`;
LLM call injectable for tests.
- **Test goal:** with a mock LLM that proposes a CORRECT selector → swap accepted and persisted; a mock proposing a WRONG selector (repro fails validation) → rejected, old selector kept. Proves detect→**recover**, and that a bad repair can't ship.

---

## Milestone 3 — Scale-out adapters & strategic scaffolds (dormant/scaffold)

### 3.1 Cloud browser pool adapter (`net/cloud-browser.ts`)
Browserbase/Steel client; CDP tiers use it when `CLOUD_BROWSER_URL` set, gated to
high-priority routes, else local Chrome. Dormant w/o key.
- **Test goal:** assert high-priority CDP job routes to cloud when configured, degrades to local when not, and only high-priority routes are eligible. Proves elastic concurrency gating without a paid key.

### 3.2 CapSolver adapter (`net/captcha-solver.ts`)
2captcha-compatible solver for Gigya/Auth0; dormant w/o `CAPSOLVER_API_KEY`.
- **Test goal:** wiring/contract test with a mock HTTP solver → token threaded into the login flow; absent key → clean skip. Proves the unblock path is wired (real solve needs the key).

### 3.3 Crowdsource browser extension + relay (`extension/`, `app/api/contribute`)
MV3 extension skeleton that reads availability from the user's own logged-in airline
tabs and POSTs to a signed relay endpoint; ingestion validates + writes to flight_cache.
- **Test goal:** relay endpoint accepts a signed valid payload (writes a cache row), rejects unsigned/malformed; extension content-script parser unit-tested against a fixture. Proves the ingestion contract end-to-end (real residential coverage needs users).

### 3.4 Off-Mac fleet (`Dockerfile`, `fly.toml`/fargate notes)
Containerize the stateless light (curl_cffi) workers; queue-driven autoscale notes.
Browser tiers stay on the cloud-browser pool. Plan + Dockerfile + config (deploy is the
operator's step).
- **Test goal:** `docker build` succeeds and the container runs `tests/run-frontier-tests.ts` green (worker image is valid). Proves the worker is portable off the Mac.

---

## Master test loop
`tests/run-frontier-tests.ts` runs every frontier proof test and prints, per item, the
OUTCOME metric + PASS/FAIL; exits non-zero on any failure. `npm run test:frontier`.
This is the "real-goal" loop: green == each approach measurably does its job.

## Sequencing & safety
M1 → M2 → M3. Each milestone: build modules + proof tests (parallel), then integrate
behind flags, run the full loop, commit as owner identity (pre-push hook). The daemon's
queue cutover is `USE_QUEUE`-gated; cloud/solver/LLM/Redis all degrade to today's path
when unconfigured — so nothing in this roadmap can break the live pipeline.
