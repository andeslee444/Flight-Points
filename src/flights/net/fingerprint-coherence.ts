/**
 * Fingerprint + Proxy Coherence Audit
 *
 * A stealth config is only as good as its weakest seam. The most common
 * giveaway is not a single bad value but an *internally inconsistent* one:
 * a curl_cffi `impersonate="chrome142"` TLS fingerprint paired with a
 * `User-Agent` that claims Chrome 99, or a `locale: en-US` browser routed
 * through a German proxy exit. Each half looks fine in isolation; together
 * they are a high-signal "this is automation" tell that no single-attribute
 * check would catch.
 *
 * This module audits a config for those cross-attribute contradictions:
 *   (a) impersonate target browser+version vs. User-Agent browser+version
 *   (b) locale (e.g. 'en-US') vs. proxy geo (e.g. 'US')
 *
 * It is pure/deterministic — no network, no I/O — so it can run as a
 * pre-flight gate before a scraper ever opens a socket.
 */

/** A parsed browser identity: family + major version. */
export interface BrowserVersion {
  /** Lowercased browser family, e.g. 'chrome', 'firefox', 'safari', 'edge'. */
  browser: string;
  /** Major version integer, e.g. 142. NaN when unparseable. */
  version: number;
}

/** Input config to audit. All fields optional so partial configs degrade gracefully. */
export interface CoherenceConfig {
  /** curl_cffi impersonation target, e.g. 'chrome142', 'safari17_0', 'firefox135'. */
  impersonate?: string;
  /** The User-Agent string the request will advertise. */
  userAgent?: string;
  /** BCP-47 locale, e.g. 'en-US', 'de-DE'. */
  locale?: string;
  /** ISO-3166 alpha-2 country of the proxy exit node, e.g. 'US', 'DE'. */
  proxyGeo?: string;
}

/** Result of a coherence audit. */
export interface CoherenceResult {
  /** True when no contradictions were detected. */
  coherent: boolean;
  /** Human-readable descriptions of each contradiction found (empty when coherent). */
  issues: string[];
}

/**
 * Allowed major-version drift between the impersonate target and the UA.
 * Browsers update fast and a config that's a couple majors behind the UA is
 * normal/benign; a large gap (Chrome 142 TLS vs. Chrome 99 UA) is the tell.
 */
export const VERSION_DRIFT_TOLERANCE = 3;

/**
 * Map curl_cffi impersonate prefixes to a canonical browser family. The
 * impersonate identifiers pack the family + version together with assorted
 * suffixes (chrome142, safari17_0, edge99, firefox135), so we match the
 * leading alphabetic run as the family.
 */
const IMPERSONATE_FAMILIES = ['chrome', 'edge', 'safari', 'firefox', 'opera'];

/**
 * Locales that are acceptable for a given proxy-exit country. Keyed by the
 * ISO country code; values are the language-region locales (lowercased) that
 * a real resident of that country would plausibly run. Kept intentionally
 * small — we only assert on the countries we actually route through.
 */
const GEO_LOCALES: Record<string, string[]> = {
  US: ['en-us', 'es-us'],
  GB: ['en-gb'],
  DE: ['de-de', 'en-gb'],
  FR: ['fr-fr'],
  CA: ['en-ca', 'fr-ca'],
  AU: ['en-au'],
  HK: ['zh-hk', 'en-hk', 'en-gb'],
  JP: ['ja-jp', 'en-us'],
  SG: ['en-sg', 'zh-sg'],
};

/**
 * Parse a curl_cffi impersonate target into {browser, version}.
 * e.g. 'chrome142' → {browser:'chrome', version:142},
 *      'safari17_0' → {browser:'safari', version:17}.
 * Returns version: NaN when the family or version can't be read.
 */
export function impersonateBrowserVersion(impersonate: string): BrowserVersion {
  const raw = (impersonate ?? '').trim().toLowerCase();
  const family = IMPERSONATE_FAMILIES.find((f) => raw.startsWith(f)) ?? '';
  // First run of digits after the family name is the major version.
  const rest = family ? raw.slice(family.length) : raw;
  const match = rest.match(/(\d+)/);
  const version = match ? parseInt(match[1], 10) : NaN;
  return { browser: family, version };
}

/**
 * Parse a User-Agent string into {browser, version}. Order matters: Edge UAs
 * also contain "Chrome/..." and Chrome UAs contain "Safari/...", so we check
 * the most specific tokens first (Edg → OPR → Firefox → Chrome → Safari).
 */
export function uaBrowserVersion(userAgent: string): BrowserVersion {
  const ua = userAgent ?? '';
  const probes: Array<{ browser: string; re: RegExp }> = [
    { browser: 'edge', re: /Edg(?:e|A|iOS)?\/(\d+)/ },
    { browser: 'opera', re: /OPR\/(\d+)/ },
    { browser: 'firefox', re: /Firefox\/(\d+)/ },
    { browser: 'chrome', re: /(?:Chrome|CriOS)\/(\d+)/ },
    { browser: 'safari', re: /Version\/(\d+)[\d.]*\s+Safari\// },
  ];
  for (const { browser, re } of probes) {
    const m = ua.match(re);
    if (m) return { browser, version: parseInt(m[1], 10) };
  }
  return { browser: '', version: NaN };
}

/** Normalize a country code to uppercase ISO alpha-2. */
function normGeo(geo: string): string {
  return (geo ?? '').trim().toUpperCase();
}

/** Normalize a locale to lowercase BCP-47. */
function normLocale(locale: string): string {
  return (locale ?? '').trim().toLowerCase();
}

/**
 * Audit a stealth config for internal contradictions across its fingerprint
 * and proxy attributes. Returns {coherent, issues}. An empty `issues` array
 * with `coherent: true` means no cross-attribute tell was detected.
 */
export function checkCoherence(config: CoherenceConfig): CoherenceResult {
  const issues: string[] = [];

  // ── (a) impersonate vs. User-Agent ────────────────────────────────
  if (config.impersonate && config.userAgent) {
    const imp = impersonateBrowserVersion(config.impersonate);
    const ua = uaBrowserVersion(config.userAgent);

    if (!imp.browser) {
      issues.push(
        `unrecognized impersonate target '${config.impersonate}' — cannot verify against User-Agent`,
      );
    } else if (!ua.browser) {
      issues.push(
        `User-Agent does not advertise a recognizable browser — cannot verify against impersonate '${config.impersonate}'`,
      );
    } else if (imp.browser !== ua.browser) {
      // Different browser families is an unambiguous mismatch.
      issues.push(
        `browser-family mismatch: impersonate is '${imp.browser}' but User-Agent claims '${ua.browser}'`,
      );
    } else if (Number.isFinite(imp.version) && Number.isFinite(ua.version)) {
      const drift = Math.abs(imp.version - ua.version);
      if (drift > VERSION_DRIFT_TOLERANCE) {
        // Same family, but the version gap is too large to be a benign lag.
        issues.push(
          `version-skew: impersonate ${imp.browser}${imp.version} vs. User-Agent ${ua.browser}${ua.version} ` +
            `(drift ${drift} > tolerance ${VERSION_DRIFT_TOLERANCE})`,
        );
      }
    }
  }

  // ── (b) locale vs. proxy geo ──────────────────────────────────────
  if (config.locale && config.proxyGeo) {
    const locale = normLocale(config.locale);
    const geo = normGeo(config.proxyGeo);
    const allowed = GEO_LOCALES[geo];

    if (!allowed) {
      // We don't have a locale expectation for this exit country; don't
      // false-positive, but surface that it went unverified.
      issues.push(
        `geo coverage gap: no locale expectation registered for proxy exit '${geo}' — locale '${config.locale}' unverified`,
      );
    } else if (!allowed.includes(locale)) {
      issues.push(
        `geo mismatch: locale '${config.locale}' does not match proxy exit '${geo}' ` +
          `(expected one of ${allowed.join(', ')})`,
      );
    }
  }

  return { coherent: issues.length === 0, issues };
}

/**
 * The project's current production stealth posture, kept in one place so the
 * audit reflects what scrapers actually send:
 *   - curl_cffi impersonate target (see MEMORY: impersonate="chrome131"/142)
 *   - a representative modern Chrome User-Agent
 *   - en-US locale, routed through the US Oracle Cloud proxy exit
 */
export const CURRENT_CONFIG: Required<CoherenceConfig> = {
  impersonate: 'chrome142',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  locale: 'en-US',
  proxyGeo: 'US',
};

/** Audit the project's actual current stealth config. */
export function auditCurrent(): CoherenceResult {
  return checkCoherence(CURRENT_CONFIG);
}
