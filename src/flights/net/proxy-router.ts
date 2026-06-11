/**
 * Proxy difficulty-routing layer.
 *
 * Each scraper faces a different level of anti-bot defense. Rather than send
 * every request through the same proxy, we classify scrapers by DIFFICULTY and
 * route them to a proxy TIER that matches the threat:
 *
 *   - public  → datacenter VPS is plenty (no IP-reputation gate)
 *   - akamai  → prefer residential IPs (Akamai shares cross-site reputation),
 *               but degrade to datacenter if no residential proxy is configured
 *   - auth    → prefer mobile IPs (hardest to flag on login captcha flows),
 *               then residential, then datacenter
 *
 * Tiers are read from the environment INSIDE resolveProxy (not at module load)
 * so callers — and tests — can vary configuration at runtime. Nothing is cached.
 *
 * Pure and env-driven: no network, no disk, no side effects.
 */

/** Difficulty class for a scraper, ordered roughly by anti-bot severity. */
export type Difficulty = 'public' | 'akamai' | 'auth';

/** Proxy tier names, from cheapest/most-available to scarcest/highest-trust. */
export type ProxyTier = 'datacenter' | 'residential' | 'mobile';

/**
 * Classification of each known scraper into a difficulty bucket.
 *
 * - public: open/unauthenticated APIs with little or no bot protection.
 * - akamai: Akamai/_abck-protected sites that punish bad IP reputation.
 * - auth:   require a logged-in session and/or captcha-guarded login flows.
 *
 * Keys mirror the SCRAPER_REGISTRY keys in scrapers/index.ts.
 */
export const DIFFICULTY: Record<string, Difficulty> = {
  // public — open APIs, no heavy bot protection
  jetblue: 'public',
  cathay: 'public',
  alaska: 'public',
  'google-flights': 'public',

  // akamai — Akamai-protected, IP reputation matters
  aa: 'akamai',
  united: 'akamai',
  aeroplan: 'akamai',
  'ba-avios': 'akamai',

  // auth — login/session required, often captcha-guarded
  'flying-blue': 'auth',
  delta: 'auth',
  'virgin-atlantic': 'auth',
  ana: 'auth',
  singapore: 'auth',
};

/**
 * Preference order of proxy tiers per difficulty. The router walks this list
 * left-to-right and returns the first tier that has a configured proxy URL,
 * always falling back to the datacenter VPS, then to undefined (direct).
 */
export const TIER_PREFERENCE: Record<Difficulty, ProxyTier[]> = {
  public: ['datacenter'],
  akamai: ['residential', 'datacenter'],
  auth: ['mobile', 'residential', 'datacenter'],
};

/** Difficulty used when a scraper key is not in the DIFFICULTY table. */
const DEFAULT_DIFFICULTY: Difficulty = 'akamai';

/**
 * Read the configured proxy URL for a given tier from the environment.
 *
 * - datacenter defaults to PROXY_URL (the Oracle VPS) when DATACENTER_PROXY_URL
 *   is unset, so existing single-proxy setups keep working unchanged.
 * - residential and mobile are optional; unset → undefined (tier unavailable).
 */
function tierUrl(tier: ProxyTier): string | undefined {
  switch (tier) {
    case 'datacenter':
      return normalize(process.env.DATACENTER_PROXY_URL ?? process.env.PROXY_URL);
    case 'residential':
      return normalize(process.env.RESIDENTIAL_PROXY_URL);
    case 'mobile':
      return normalize(process.env.MOBILE_PROXY_URL);
  }
}

/** Treat empty / whitespace-only env values as "not configured". */
function normalize(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Map a scraper key to its difficulty, defaulting safely for unknown keys. */
export function difficultyFor(scraperKey: string): Difficulty {
  return DIFFICULTY[scraperKey] ?? DEFAULT_DIFFICULTY;
}

/**
 * Resolve the proxy URL a scraper should use, by difficulty, degrading
 * gracefully through the tier preference list.
 *
 * Returns the first configured tier in preference order; if none of the
 * preferred tiers (including datacenter) are configured, returns undefined
 * to signal a direct connection.
 */
export function resolveProxy(scraperKey: string): string | undefined {
  const difficulty = difficultyFor(scraperKey);
  for (const tier of TIER_PREFERENCE[difficulty]) {
    const url = tierUrl(tier);
    if (url) return url;
  }
  // Last-resort safety net: even an unrecognized difficulty falls back to the
  // datacenter VPS before giving up on a proxy entirely.
  return tierUrl('datacenter');
}

/**
 * Diagnostic view of how every known scraper currently routes, given the
 * environment at call time. Useful for daemon startup logging.
 */
export interface RoutingEntry {
  scraperKey: string;
  difficulty: Difficulty;
  /** The tier actually selected, or 'direct' when no proxy is configured. */
  tier: ProxyTier | 'direct';
  /** The resolved proxy URL, or undefined for a direct connection. */
  proxyUrl: string | undefined;
}

/** Return one RoutingEntry per known scraper, reflecting current env. */
export function listRouting(): RoutingEntry[] {
  return Object.keys(DIFFICULTY).map((scraperKey) => {
    const difficulty = difficultyFor(scraperKey);
    const proxyUrl = resolveProxy(scraperKey);
    let tier: ProxyTier | 'direct' = 'direct';
    if (proxyUrl !== undefined) {
      // Identify which tier produced this URL (first match in preference order).
      tier =
        TIER_PREFERENCE[difficulty].find((t) => tierUrl(t) === proxyUrl) ?? 'datacenter';
    }
    return { scraperKey, difficulty, tier, proxyUrl };
  });
}

export default { DIFFICULTY, TIER_PREFERENCE, difficultyFor, resolveProxy, listRouting };
