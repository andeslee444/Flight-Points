# Off-Mac Fleet Deploy — light (curl_cffi) worker containers  [M3.4]

This doc covers running the **stateless light scraper tier** as a horizontally
scalable fleet of containers, off the Mac Mini (Harbor). It is a **scaffold +
operator runbook** — the image builds and self-verifies today; the actual
`docker build` / `push` / `scale` are the operator's steps (marked below).

---

## What goes in these containers — and what does NOT

| Tier | Runs in this fleet? | Why |
|------|---------------------|-----|
| **curl_cffi** (light, HTTP-only TLS impersonation) | ✅ **Yes** | Pure HTTP, no browser/display/GPU. Stateless. Scales horizontally on cheap compute. |
| **Patchright / Camoufox** (headless browser) | ❌ No | Heavy (browser binaries, RAM). Lives on the **cloud-browser pool (M3.1)**. |
| **Real-Chrome CDP** (AA, Flying Blue) | ❌ No | Needs a real Chrome + persistent profile + login sessions. **Cloud-browser pool / Harbor**, not stateless containers. |

> Rule of thumb: if a scraper opens a browser or holds a login session, it does
> **not** belong in this fleet. The fleet exists purely to fan the *light* tier
> wide. The browser/CDP tiers are routed to the cloud-browser pool from M3.1.

---

## How autoscale works (queue-driven)

The keystone job queue (`src/flights/queue/job-queue.ts`) is Redis-backed
(BullMQ) when `REDIS_URL` is set, and in-memory otherwise. The daemon fans
scrapes out through the queue **only when `USE_QUEUE=1`** (see
`src/flights/flight-daemon.ts`, `const USE_QUEUE = process.env.USE_QUEUE === '1'`).

So the autoscale model is:

```
┌────────────┐  enqueue jobs   ┌─────────┐   pull jobs    ┌──────────────────────┐
│  daemon /  │ ──────────────► │  Redis  │ ◄───────────── │  N light containers  │
│  producer  │   (REDIS_URL)   │ (BullMQ)│   (USE_QUEUE=1) │  (this image, scale) │
└────────────┘                 └─────────┘                 └──────────────────────┘
```

- **Producer**: the daemon (or a thin producer) generates route×date×cabin jobs
  and enqueues them. Run with `USE_QUEUE=1` + `REDIS_URL`.
- **Consumers**: each container runs the same image with `USE_QUEUE=1` +
  `REDIS_URL` + `PROXY_URL` and pulls light-tier jobs off Redis. Add more
  containers → more throughput. They are stateless and disposable; results land
  in Postgres / the shared cache, not on the container.
- **Default (no `USE_QUEUE`)**: the daemon runs the legacy in-process local path
  on Harbor exactly as today. **Nothing about the running launchd daemon changes
  unless the operator sets the flag.** Default-OFF.

---

## Environment the container needs

| Var | Required for | Notes |
|-----|--------------|-------|
| `DATABASE_URL` | run-history / signups / history persistence | Worker **degrades gracefully** if unset (no DB writes), per `src/flights/db.ts`. |
| `REDIS_URL` | queue-driven autoscale | With `USE_QUEUE=1`, this is the broker the daemon/workers share. |
| `USE_QUEUE=1` | enabling fan-out | Default-OFF. Unset → in-process local path. |
| `PROXY_URL` | the curl_cffi tier | e.g. `socks5://host:1081`. The light tier routes outbound through this. |
| `PG_SSL` | local/non-TLS Postgres | Set `"false"` for non-SSL DBs. |
| `DATA_DIR` / `WEB_CACHE_PATH` | shared cache location | Point at a mounted volume / shared path if the fleet should publish to the web cache. |

The image is **default-OFF for the queue**: with no `USE_QUEUE`/`REDIS_URL`, a
container just runs whatever command you give it on the local in-process path.

---

## Build & self-verify

The image's **default CMD runs the frontier proof loop**
(`npx tsx tests/run-frontier-tests.ts`), so a successful `docker run` of a
freshly built image proves the worker is valid-by-construction — offline, no
creds, no network.

```bash
# OPERATOR STEP — build + self-verify locally:
docker build -t flight-points-worker .
docker run --rm flight-points-worker          # → frontier proof loop, exits 0 if valid
```

Override the command to run the daemon or a queue worker instead:

```bash
# production daemon (local path):
docker run --rm -e DATABASE_URL=... -e PROXY_URL=... flight-points-worker npm run daemon

# queue-driven light worker (consumes Redis jobs):
docker run --rm -e REDIS_URL=redis://... -e USE_QUEUE=1 -e PROXY_URL=socks5://... \
  flight-points-worker npm run daemon
```

---

## fly.io sketch (OPERATOR STEP)

`fly.toml` (illustrative — the worker has **no inbound port**, so no `[http_service]`):

```toml
app = "flight-points-worker"
primary_region = "iad"   # near the Ashburn VPS/proxy

[build]
  dockerfile = "Dockerfile"

[processes]
  worker = "npm run daemon"   # consumer; set USE_QUEUE=1 via secrets

[env]
  USE_QUEUE = "1"
  NODE_ENV  = "production"
```

```bash
# OPERATOR STEPS:
fly launch --no-deploy                       # create app from Dockerfile
fly secrets set DATABASE_URL=... REDIS_URL=... PROXY_URL=...   # never bake secrets into the image
fly deploy                                   # build + push + release
fly scale count worker=5                     # scale the light fleet horizontally
fly scale count worker=10                    # add capacity on demand
```

---

## AWS Fargate sketch (OPERATOR STEP)

```bash
# OPERATOR STEPS:

# 1. Build + push to ECR
aws ecr create-repository --repository-name flight-points-worker
docker build -t flight-points-worker .
docker tag flight-points-worker:latest <acct>.dkr.ecr.<region>.amazonaws.com/flight-points-worker:latest
aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com
docker push <acct>.dkr.ecr.<region>.amazonaws.com/flight-points-worker:latest

# 2. Task definition: command = ["npm","run","daemon"]; pass env from Secrets
#    Manager (DATABASE_URL, REDIS_URL, PROXY_URL) + USE_QUEUE=1. No port mapping.

# 3. Run as a Service and scale N:
aws ecs update-service --cluster fp --service fp-light-workers --desired-count 5
```

> Autoscaling target tracking can drive `desired-count` off the Redis queue
> depth (CloudWatch custom metric) so the fleet grows with backlog and shrinks
> when idle.

---

## Notes / caveats

- **`docker build` is the operator's step.** The CI/automated layer here only
  proves the Dockerfile's *structural* contract offline (see
  `tests/frontier/fleet-dockerfile.test.ts`). It does **not** invoke Docker.
- **Secrets are never baked into the image.** `.env`, `config/keys`,
  `config/airline-accounts.json` are excluded by `.dockerignore`; supply creds
  at runtime via fly secrets / Fargate Secrets Manager.
- **Browser/CDP tiers are out of scope** for this fleet — they remain on the
  cloud-browser pool (M3.1) and/or Harbor with persistent Chrome profiles.
