/**
 * Session-pool abstraction (Crawlee SessionPool pattern).
 *
 * Award portals (Akamai/Cloudflare) bind anti-bot state — _abck cookies, TLS
 * fingerprint, proxy IP reputation — to a coherent "session". Reusing a warm,
 * unblocked session across requests to the same host preserves that earned trust
 * and avoids re-running JS challenges on every hit. When a host blocks a session,
 * burning it and rotating to a fresh one is far cheaper than hammering a poisoned
 * one. This module keeps a small per-host pool of sessions with health tracking,
 * reuse, and automatic retirement of blocked sessions.
 *
 * Pure in-memory, no I/O — safe to unit test deterministically.
 */

/** Browser/TLS fingerprint a session presents to a host. */
export interface Fingerprint {
  /** curl_cffi / browser impersonation token, e.g. "chrome131". */
  impersonate: string;
  /** User-Agent string. */
  userAgent: string;
  /** Accept-Language / locale, e.g. "en-US". */
  locale: string;
}

/** A single reusable session bound to one host. */
export interface Session {
  /** Stable unique id for this session. */
  readonly id: string;
  /** Proxy URL this session routes through (may be empty for direct). */
  readonly proxyUrl: string;
  /** Cookie jar (name -> value) accumulated for the host. */
  cookies: Record<string, string>;
  /** Fingerprint presented to the host. */
  readonly fingerprint: Fingerprint;
  /** Count of successful requests on this session. */
  successCount: number;
  /** Count of blocked/challenged requests on this session. */
  blockCount: number;
  /** Epoch ms when the session was created. */
  readonly createdAt: number;
  /**
   * Reliability ratio in [0, 1]: successes / (successes + blocks).
   * Returns 1.0 when the session has never been blocked (optimistic default).
   */
  healthScore(): number;
}

export interface SessionPoolOptions {
  /** Retire a session once its blockCount reaches this value. Default 2. */
  maxBlocks?: number;
  /** Soft cap on sessions kept per host. Default 10. */
  maxPerHost?: number;
  /** Proxy URL stamped onto newly created sessions. Default "". */
  proxyUrl?: string;
  /** Override fingerprint factory (per new session). */
  fingerprintFactory?: () => Fingerprint;
  /** Override id factory (must return unique strings). */
  idFactory?: () => string;
}

export interface SessionPoolStats {
  /** Number of hosts with at least one live session. */
  hosts: number;
  /** Total live sessions across all hosts. */
  totalSessions: number;
  /** Sessions created over the pool's lifetime (includes retired). */
  created: number;
  /** Sessions retired over the pool's lifetime. */
  retired: number;
  /** Per-host live session count. */
  perHost: Record<string, number>;
}

const DEFAULT_MAX_BLOCKS = 2;
const DEFAULT_MAX_PER_HOST = 10;

function defaultFingerprint(): Fingerprint {
  return {
    impersonate: 'chrome131',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  };
}

let idCounter = 0;
function defaultIdFactory(): string {
  idCounter += 1;
  return `sess-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSession(opts: {
  proxyUrl: string;
  fingerprint: Fingerprint;
  id: string;
}): Session {
  const session: Session = {
    id: opts.id,
    proxyUrl: opts.proxyUrl,
    cookies: {},
    fingerprint: opts.fingerprint,
    successCount: 0,
    blockCount: 0,
    createdAt: Date.now(),
    healthScore(): number {
      const total = this.successCount + this.blockCount;
      if (total === 0) return 1.0;
      return this.successCount / total;
    },
  };
  return session;
}

/**
 * Per-host pool of reusable sessions. Hands out warm, healthy sessions for
 * reuse and retires blocked ones so callers transparently rotate identities.
 */
export class SessionPool {
  private readonly maxBlocks: number;
  private readonly maxPerHost: number;
  private readonly proxyUrl: string;
  private readonly fingerprintFactory: () => Fingerprint;
  private readonly idFactory: () => string;

  /** host -> live sessions for that host. */
  private readonly byHost = new Map<string, Session[]>();
  private createdTotal = 0;
  private retiredTotal = 0;

  constructor(options: SessionPoolOptions = {}) {
    this.maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
    this.maxPerHost = options.maxPerHost ?? DEFAULT_MAX_PER_HOST;
    this.proxyUrl = options.proxyUrl ?? '';
    this.fingerprintFactory = options.fingerprintFactory ?? defaultFingerprint;
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  /**
   * Return a healthy reusable session for `host`, creating one if none is
   * available. Prefers the highest-health existing session (most "trust"
   * earned) to maximize reuse before falling back to a fresh session.
   */
  acquire(host: string): Session {
    const pool = this.byHost.get(host);
    if (pool && pool.length > 0) {
      // Reuse the healthiest live session for this host.
      let best = pool[0];
      for (const s of pool) {
        if (s.healthScore() > best.healthScore()) best = s;
      }
      return best;
    }
    return this.createFor(host);
  }

  /** Record a successful request on a session. */
  markSuccess(session: Session): void {
    session.successCount += 1;
  }

  /**
   * Record a block/challenge on a session. Retires (removes) the session from
   * its host pool once blockCount reaches maxBlocks so the next acquire() for
   * that host yields a fresh identity.
   */
  markBlocked(session: Session): void {
    session.blockCount += 1;
    if (session.blockCount >= this.maxBlocks) {
      this.retire(session);
    }
  }

  /** Snapshot of pool state for observability/tests. */
  stats(): SessionPoolStats {
    const perHost: Record<string, number> = {};
    let total = 0;
    for (const [host, sessions] of this.byHost) {
      perHost[host] = sessions.length;
      total += sessions.length;
    }
    return {
      hosts: this.byHost.size,
      totalSessions: total,
      created: this.createdTotal,
      retired: this.retiredTotal,
      perHost,
    };
  }

  private createFor(host: string): Session {
    const session = makeSession({
      proxyUrl: this.proxyUrl,
      fingerprint: this.fingerprintFactory(),
      id: this.idFactory(),
    });
    const pool = this.byHost.get(host);
    if (pool) {
      pool.push(session);
      // Soft cap: evict the least-healthy session if over capacity.
      if (pool.length > this.maxPerHost) {
        let worstIdx = 0;
        for (let i = 1; i < pool.length; i++) {
          if (pool[i].healthScore() < pool[worstIdx].healthScore()) worstIdx = i;
        }
        const [evicted] = pool.splice(worstIdx, 1);
        if (evicted) this.retiredTotal += 1;
      }
    } else {
      this.byHost.set(host, [session]);
    }
    this.createdTotal += 1;
    return session;
  }

  /** Remove a session from whichever host pool holds it. */
  private retire(session: Session): void {
    for (const [host, sessions] of this.byHost) {
      const idx = sessions.findIndex((s) => s.id === session.id);
      if (idx !== -1) {
        sessions.splice(idx, 1);
        this.retiredTotal += 1;
        if (sessions.length === 0) this.byHost.delete(host);
        return;
      }
    }
  }
}
