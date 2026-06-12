# ─────────────────────────────────────────────────────────────────────────────
# Flight-Points — portable LIGHT (curl_cffi) worker image  [M3.4]
#
# WHAT: A single container image that runs the stateless, HTTP-only scraper tier
#       (curl_cffi with TLS-fingerprint impersonation) plus the Node/tsx
#       orchestration that drives it. It self-verifies on build by running the
#       frontier proof loop as its default command.
#
# WHY:  The light tier is pure HTTP — no browser, no display, no GPU — so it
#       scales HORIZONTALLY off cheap commodity compute (fly.io machines,
#       Fargate tasks). Pulling these workers OFF the Mac Mini lets the daemon
#       on Harbor stop being a single point of capacity. The heavy tiers
#       (Patchright / Camoufox / real-Chrome CDP from M3.1) deliberately do NOT
#       live here — they stay on the cloud-browser pool. See docs/fleet-deploy.md.
#
# DUAL RUNTIME: the curl_cffi tier needs Python 3.10+; the registry, runners,
#       queue fan-out and proof tests need Node 20+ / tsx. We need BOTH in one
#       image. We start FROM node:20-slim (Debian bookworm) and apt-get Python,
#       rather than FROM python:*-slim + nodesource, because the Node base ships
#       a known-good npm/node pair and Debian's python3 (3.11 on bookworm) is
#       new enough for curl_cffi — fewer moving parts than a nodesource install.
#
# CACHE ORDERING: dependency manifests (package*.json, requirements.txt) are
#       copied and installed BEFORE the application source so that editing a
#       scraper does not bust the (slow) npm ci / pip install layers.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim

# --- OS-level deps: Python 3 + pip (for curl_cffi) and curl/build basics. ---
# curl_cffi ships manylinux wheels, so no compiler is normally needed, but we
# keep ca-certificates current for outbound TLS to airline APIs / the proxy.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Layer 1 (rarely changes): Node dependency manifests. ---
# Copy package.json AND the lockfile (when present) before any source so the
# npm install layer is cached across source edits. `npm ci` requires the lock;
# fall back to `npm install` if the lock is absent so the build still succeeds.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --- Layer 2 (rarely changes): Python dependency manifest. ---
# Install the light tier's Python deps. PEP 668 marks the Debian base env as
# "externally managed", so pass --break-system-packages to install globally in
# the container (safe — the container is single-purpose and disposable).
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# --- Layer 3 (changes often): application source. ---
# Copied LAST so day-to-day scraper edits only invalidate this cheap layer.
COPY . .

# Container needs no inbound port; it is a worker, not a server.
# Required env at runtime (see docs/fleet-deploy.md):
#   DATABASE_URL  — Postgres for run-history / signups (worker degrades without it)
#   REDIS_URL     — BullMQ broker; set with USE_QUEUE=1 for queue-driven autoscale
#   PROXY_URL     — SOCKS5 datacenter proxy for the curl_cffi tier
ENV NODE_ENV=production

# --- Default command: SELF-VERIFY. ---
# A freshly built image proves the worker is valid-by-construction by running
# the frontier proof loop (offline, no network, no creds). If this exits 0 the
# image is shippable.
#
#   docker build -t flight-points-worker .
#   docker run --rm flight-points-worker          # runs the proof loop below
#
# To run something else, override the command at `docker run` time:
#   # production daemon (needs DATABASE_URL/PROXY_URL, and REDIS_URL+USE_QUEUE for fan-out):
#   docker run --rm -e DATABASE_URL=... -e PROXY_URL=... flight-points-worker npm run daemon
#   # a queue-driven light worker (consumes jobs off Redis):
#   docker run --rm -e REDIS_URL=... -e USE_QUEUE=1 -e PROXY_URL=... flight-points-worker npm run daemon
CMD ["npx", "tsx", "tests/run-frontier-tests.ts"]
