/**
 * Persistent Run-History + Per-Scraper Rot Alerting
 *
 * Records the outcome of every scraper run (ok / empty / error + count) into a
 * pluggable RunStore, then derives a per-scraper "rot" signal from the recent
 * history. Rot = the last K runs are ALL unproductive (empty/error) AFTER a
 * stretch that previously produced results — i.e. a scraper that *used to work*
 * and has quietly stopped (session expiry, DOM drift, silent block).
 *
 * This sits one layer above scraper-health.ts:
 *   - scraper-health tracks live in-process consecutive counters (volatile,
 *     reset on daemon restart).
 *   - run-history persists every run to a store so rot can be detected across
 *     restarts and surfaced historically — and alerts fire ONCE per episode
 *     (transition-only dedupe, exactly like scraper-health's `suspect` flip),
 *     re-arming only after a good run clears the rot.
 *
 * Storage is abstracted behind RunStore so detection logic is fully offline:
 *   - InMemoryRunStore — default, used by tests (no network/DB).
 *   - PgRunStore — production stub, injected with a getPool()-style provider so
 *     the real database is never touched in tests.
 */

/** A single recorded scraper run. */
export interface Run {
  ts: number;
  scraper: string;
  route: string;
  outcome: 'ok' | 'empty' | 'error';
  count: number;
}

/**
 * Storage abstraction for run history. record() appends; recent() returns the
 * last n runs for a scraper in MOST-RECENT-FIRST order.
 */
export interface RunStore {
  record(run: Run): Promise<void>;
  recent(scraper: string, n: number): Promise<Run[]>;
}

/**
 * Default in-memory store. Deterministic and offline — the proof test runs
 * entirely against this. Keeps an append-ordered list per scraper.
 */
export class InMemoryRunStore implements RunStore {
  private runs = new Map<string, Run[]>();

  async record(run: Run): Promise<void> {
    let list = this.runs.get(run.scraper);
    if (!list) {
      list = [];
      this.runs.set(run.scraper, list);
    }
    list.push(run);
  }

  async recent(scraper: string, n: number): Promise<Run[]> {
    const list = this.runs.get(scraper) ?? [];
    // Most-recent-first: take the tail, reversed.
    return list.slice(Math.max(0, list.length - n)).reverse();
  }
}

/** Minimal shape of the pg pool we depend on (query()). */
export interface QueryablePool {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * Production store backed by PostgreSQL. The pool is INJECTED via a
 * getPool()-style provider so tests never instantiate a real connection. This
 * is a stub: the SQL mirrors the intended `scraper_runs` schema but is not
 * exercised offline.
 */
export class PgRunStore implements RunStore {
  constructor(private readonly getPool: () => QueryablePool) {}

  async record(run: Run): Promise<void> {
    const pool = this.getPool();
    await pool.query(
      `INSERT INTO scraper_runs (ts, scraper, route, outcome, count)
       VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5)`,
      [run.ts, run.scraper, run.route, run.outcome, run.count],
    );
  }

  async recent(scraper: string, n: number): Promise<Run[]> {
    const pool = this.getPool();
    const { rows } = await pool.query(
      `SELECT extract(epoch from ts) * 1000 AS ts, scraper, route, outcome, count
       FROM scraper_runs
       WHERE scraper = $1
       ORDER BY ts DESC
       LIMIT $2`,
      [scraper, n],
    );
    return rows.map((r) => ({
      ts: Number(r.ts),
      scraper: r.scraper,
      route: r.route,
      outcome: r.outcome,
      count: Number(r.count),
    }));
  }
}

/** Result of a rot check for one scraper. */
export interface RotResult {
  /** True while the scraper is in a rot episode (last K runs all unproductive). */
  suspect: boolean;
  /** True ONLY on the run that newly transitions into rot (alert dedupe). */
  fired: boolean;
}

/** Alert payload handed to the onAlert hook. */
export interface RotAlert {
  scraper: string;
  /** The K unproductive runs that triggered the episode, most-recent-first. */
  runs: Run[];
}

export type AlertHook = (alert: RotAlert) => void;

/** How many consecutive unproductive runs constitute rot. */
export const DEFAULT_ROT_THRESHOLD = 3;

function isUnproductive(r: Run): boolean {
  // A clean run that genuinely returned data is productive; everything else
  // (empty results, or a thrown error) counts toward rot.
  return r.outcome !== 'ok' || r.count <= 0;
}

/**
 * RunHistory persists runs and derives the per-scraper rot signal with
 * once-per-episode alert dedupe.
 */
export class RunHistory {
  private alertHook: AlertHook | null = null;
  /** Per-scraper latch: are we currently inside a fired rot episode? */
  private inRot = new Map<string, boolean>();

  constructor(
    private readonly store: RunStore = new InMemoryRunStore(),
    private readonly threshold: number = DEFAULT_ROT_THRESHOLD,
  ) {}

  /** Register a callback invoked once when a scraper newly enters rot. */
  onAlert(hook: AlertHook): void {
    this.alertHook = hook;
  }

  /** Persist a run. ts defaults to Date.now() when omitted. */
  async recordRun(run: Omit<Run, 'ts'> & { ts?: number }): Promise<void> {
    await this.store.record({
      ts: run.ts ?? Date.now(),
      scraper: run.scraper,
      route: run.route,
      outcome: run.outcome,
      count: run.count,
    });
  }

  /**
   * Inspect a scraper's recent history and decide if it's rotting.
   *
   * Rot requires:
   *   - the last `threshold` runs are ALL unproductive, AND
   *   - there is at least one PRIOR run (older than that window) that produced
   *     results — so a scraper that has simply never worked, or one that's
   *     cold-starting, is not flagged (matches scraper-health: only a working
   *     scraper that *stops* is suspect).
   *
   * `fired` is true only on the transition into rot (dedupe). A subsequent
   * good run clears the latch, re-arming the alert for a future episode.
   */
  async detectScraperRot(scraper: string): Promise<RotResult> {
    // Pull one extra run so we can verify a productive run preceded the window.
    const window = await this.store.recent(scraper, this.threshold + 1);

    const latched = this.inRot.get(scraper) ?? false;

    // Need a full window of unproductive runs to even consider rot.
    if (window.length < this.threshold) {
      this.inRot.set(scraper, false);
      return { suspect: false, fired: false };
    }

    const lastK = window.slice(0, this.threshold);
    const allBad = lastK.every(isUnproductive);

    // The run immediately preceding the window, if any.
    const prior = window[this.threshold];

    if (!allBad) {
      // A productive run is inside the last K → not rotting. A productive most
      // recent run clears the latch and re-arms.
      this.inRot.set(scraper, false);
      return { suspect: false, fired: false };
    }

    // Last K are all unproductive. To ENTER rot we require evidence the scraper
    // was previously producing (the run just before the window was productive) —
    // this distinguishes "stopped working" from "never worked". Once latched,
    // we stay in rot even after that productive run scrolls out of the window;
    // only a fresh good run (handled above) clears it.
    if (!latched) {
      const hadHistory = prior !== undefined && !isUnproductive(prior);
      if (!hadHistory) {
        // No confirmed prior healthy run → never-worked / cold-start, not rot.
        this.inRot.set(scraper, false);
        return { suspect: false, fired: false };
      }
    }

    const fired = !latched;
    this.inRot.set(scraper, true);
    if (fired && this.alertHook) {
      this.alertHook({ scraper, runs: lastK });
    }
    return { suspect: true, fired };
  }
}
