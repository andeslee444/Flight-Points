-- Durable per-scraper run ledger (frontier M1: run-history).
-- Survives daemon restart, unlike the in-memory scraper-health Map. Powers
-- per-individual-scraper rot detection + a future /status dashboard.

CREATE TABLE IF NOT EXISTS scraper_runs (
  id       BIGSERIAL PRIMARY KEY,
  ts       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scraper  TEXT NOT NULL,
  route    TEXT NOT NULL,
  outcome  TEXT NOT NULL,        -- 'ok' | 'empty' | 'error'
  count    INTEGER NOT NULL DEFAULT 0
);

-- recent(scraper, n) orders by ts DESC per scraper — index for it.
CREATE INDEX IF NOT EXISTS idx_scraper_runs_scraper_ts ON scraper_runs (scraper, ts DESC);
-- Pruning / dashboard time-range scans.
CREATE INDEX IF NOT EXISTS idx_scraper_runs_ts ON scraper_runs (ts);
