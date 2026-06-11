/**
 * Singleflight — in-flight request coalescing.
 *
 * Collapses concurrent calls that share the same key onto a SINGLE underlying
 * execution: while a call for a key is running, every other caller for that key
 * receives the exact same promise. The entry is cleared once it settles, so a
 * later call re-runs the work.
 *
 * This is deliberately NOT a cache: no resolved value is retained. Value caching
 * is the responsibility of cache.ts. Singleflight only deduplicates *concurrent*
 * work — useful for collapsing a burst of identical scraper searches into one
 * subprocess/network round-trip while leaving later (post-settle) searches free
 * to run again.
 */
export class Singleflight {
  /** Promises for currently in-flight keys. Cleared on settle. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` for `key`. If a call for `key` is already in flight, return that
   * same promise instead of invoking `fn` again. The in-flight entry is removed
   * as soon as the underlying promise settles (resolve OR reject), so a
   * subsequent call will execute `fn` afresh.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    // Defensively wrap fn() so a synchronous throw still produces a promise we
    // can attach cleanup to (and so the entry is always eventually cleared).
    const started = (async () => fn())();
    const tracked = started.finally(() => {
      // Only clear if we're still the active entry for this key (a settle
      // followed by a fresh run() under the same key must not be clobbered).
      if (this.inFlight.get(key) === tracked) {
        this.inFlight.delete(key);
      }
    });

    this.inFlight.set(key, tracked);
    return tracked;
  }

  /** Number of keys currently in flight (exposed for diagnostics/tests). */
  get size(): number {
    return this.inFlight.size;
  }
}
