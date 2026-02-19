-- Flight Points — Initial Schema
-- Run: psql "$DATABASE_URL" -f migrations/001_initial_schema.sql

BEGIN;

-- ── flight_cache ──
-- Stores daemon-scraped award + cash flight data by route key.
-- award_flights and cash_flights are JSONB because the web server always
-- reads entire entries by route key — no need for per-flight queries.

CREATE TABLE IF NOT EXISTS flight_cache (
  route_key   TEXT PRIMARY KEY,            -- e.g. "JFK-NRT-2026-03-15-business"
  origin      TEXT NOT NULL,
  destination TEXT NOT NULL,
  date        DATE NOT NULL,
  cabin       TEXT NOT NULL,
  award_flights JSONB NOT NULL DEFAULT '[]'::jsonb,
  cash_flights  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flight_cache_route ON flight_cache (origin, destination);
CREATE INDEX IF NOT EXISTS idx_flight_cache_updated ON flight_cache (updated_at);

-- ── flight_signups ──
-- User watch list entries (route alerts + early-access signups).

CREATE TABLE IF NOT EXISTS flight_signups (
  id           SERIAL PRIMARY KEY,
  type         TEXT,                        -- 'route' or null
  "from"       TEXT NOT NULL,
  "to"         TEXT NOT NULL,
  class        TEXT NOT NULL DEFAULT 'Business',
  contact      TEXT,
  alert_method TEXT,
  start_date   TEXT,
  end_date     TEXT,
  date_sampling_days INTEGER,
  timestamp    TIMESTAMPTZ DEFAULT NOW()
);

-- ── sent_alerts ──
-- Deduplication tracking for WhatsApp alerts (90-day TTL).

CREATE TABLE IF NOT EXISTS sent_alerts (
  alert_key TEXT PRIMARY KEY,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sent_alerts_sent_at ON sent_alerts (sent_at);

-- ── monitor_scans ──
-- Recent scan history (replaces monitor-history.json → scans[]).

CREATE TABLE IF NOT EXISTS monitor_scans (
  id         SERIAL PRIMARY KEY,
  scan_time  TIMESTAMPTZ NOT NULL,
  results    JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_monitor_scans_time ON monitor_scans (scan_time DESC);

-- ── known_flights ──
-- Tracks known flights for new/improved deal detection
-- (replaces monitor-history.json → knownFlights).

CREATE TABLE IF NOT EXISTS known_flights (
  flight_key TEXT PRIMARY KEY,
  miles      INTEGER NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── rotation_state ──
-- Single-row table for daemon search rotation offset.

CREATE TABLE IF NOT EXISTS rotation_state (
  id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  offset_value INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO rotation_state (id, offset_value) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

-- ── daemon_status ──
-- Single-row table for daemon health metrics.

CREATE TABLE IF NOT EXISTS daemon_status (
  id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pid            INTEGER,
  rss_mb         INTEGER,
  started_at     TIMESTAMPTZ,
  status         TEXT,
  signal         TEXT,
  last_scan_time TIMESTAMPTZ,
  results_count  INTEGER,
  alerts_count   INTEGER,
  next_scan_time TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO daemon_status (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ── scraper_health ──
-- Per-scraper success/failure stats and circuit breaker state.

CREATE TABLE IF NOT EXISTS scraper_health (
  scraper_key          TEXT PRIMARY KEY,
  total_calls          INTEGER NOT NULL DEFAULT 0,
  total_successes      INTEGER NOT NULL DEFAULT 0,
  total_failures       INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_success         TIMESTAMPTZ,
  last_failure         TIMESTAMPTZ,
  circuit_open         BOOLEAN NOT NULL DEFAULT FALSE,
  circuit_opened_at    TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
