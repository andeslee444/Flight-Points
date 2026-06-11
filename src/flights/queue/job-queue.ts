/**
 * Backend-agnostic job queue.
 *
 * Two implementations behind one interface:
 *   - InMemoryQueue<T>  — the DEFAULT. Priority-ordered (higher priority first),
 *                         concurrency-bounded worker loop, per-dedupeKey suppression
 *                         of duplicate pending jobs. Single-process.
 *   - BullMqQueue<T>    — thin adapter over 'bullmq' (lazy-imported) backed by Redis,
 *                         for multi-process scale-out. Same interface.
 *
 * makeJobQueue<T>(name) returns BullMq when REDIS_URL is set, else InMemory.
 *
 * No `.ts` import here — keep this file dependency-free for the InMemory path so
 * the default never pulls in bullmq/ioredis at module load.
 */

export interface AddOpts {
  /** Higher priority dequeues first. Default 0. */
  priority?: number;
  /**
   * If set, a duplicate add with the same dedupeKey is suppressed while an
   * equivalent job is still pending (not yet started). Once a job begins
   * processing, the key is released so a genuinely new job can re-enqueue.
   */
  dedupeKey?: string;
}

export interface JobQueue<T> {
  /** Enqueue a job. */
  add(job: T, opts?: AddOpts): Promise<void>;
  /**
   * Start consuming with up to `concurrency` workers in flight, invoking
   * `handler` per job. Resolves once the queue has been drained (no pending
   * and no in-flight jobs remain). Idempotent re-entry is the caller's concern.
   */
  process(concurrency: number, handler: (job: T) => Promise<void>): Promise<void>;
  /** Resolve once all enqueued work (pending + in-flight) has completed. */
  drain(): Promise<void>;
  /** Number of jobs not yet completed (pending + in-flight). */
  size(): number;
}

interface PendingEntry<T> {
  job: T;
  priority: number;
  dedupeKey?: string;
  /** Monotonic insertion sequence — preserves FIFO order within equal priority. */
  seq: number;
}

/**
 * Single-process priority queue with a concurrency-bounded worker loop.
 *
 * Ordering: strictly by priority descending, ties broken by insertion order
 * (stable FIFO). Parallelism is bounded by the `concurrency` passed to
 * process() — at most that many handlers run at once.
 */
export class InMemoryQueue<T> implements JobQueue<T> {
  private pending: PendingEntry<T>[] = [];
  private inFlight = 0;
  private seqCounter = 0;
  /** dedupeKeys of jobs that are pending (queued but not yet started). */
  private pendingKeys = new Set<string>();

  private handler: ((job: T) => Promise<void>) | null = null;
  private concurrency = 1;
  private running = false;
  /** Resolvers waiting on drain() / process() completion. */
  private idleWaiters: Array<() => void> = [];

  async add(job: T, opts: AddOpts = {}): Promise<void> {
    const { priority = 0, dedupeKey } = opts;

    // Suppress a duplicate pending job sharing this dedupeKey.
    if (dedupeKey !== undefined && this.pendingKeys.has(dedupeKey)) {
      return;
    }
    if (dedupeKey !== undefined) {
      this.pendingKeys.add(dedupeKey);
    }

    this.pending.push({ job, priority, dedupeKey, seq: this.seqCounter++ });
    // Keep pending sorted: higher priority first, then FIFO by seq.
    this.pending.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));

    if (this.running) this.pump();
  }

  async process(concurrency: number, handler: (job: T) => Promise<void>): Promise<void> {
    this.concurrency = Math.max(1, concurrency);
    this.handler = handler;
    this.running = true;
    this.pump();
    return this.waitIdle();
  }

  async drain(): Promise<void> {
    return this.waitIdle();
  }

  size(): number {
    return this.pending.length + this.inFlight;
  }

  /** Launch as many handlers as concurrency allows against the pending queue. */
  private pump(): void {
    if (!this.running || !this.handler) return;

    while (this.inFlight < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift()!;
      // Release the dedupe key the moment the job STARTS — a job that is now
      // executing no longer suppresses a fresh re-enqueue of the same key.
      if (entry.dedupeKey !== undefined) {
        this.pendingKeys.delete(entry.dedupeKey);
      }
      this.inFlight++;
      const handler = this.handler;
      void Promise.resolve()
        .then(() => handler(entry.job))
        .catch(() => {
          // A failing handler must not stall the loop; surface via handler itself.
        })
        .finally(() => {
          this.inFlight--;
          this.pump();
          if (this.size() === 0) this.flushIdle();
        });
    }

    if (this.size() === 0) this.flushIdle();
  }

  private waitIdle(): Promise<void> {
    if (this.size() === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private flushIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }
}

/**
 * Thin BullMQ adapter for multi-process scale-out. Lazy-imports 'bullmq' so the
 * default in-memory path never depends on Redis. Connects to process.env.REDIS_URL.
 *
 * BullMQ priority semantics are INVERTED relative to our interface (lower number =
 * higher priority in BullMQ), so we map `priority` → `1 / -priority`-style by
 * negating and offsetting into BullMQ's positive-integer space.
 */
export class BullMqQueue<T> implements JobQueue<T> {
  private readonly name: string;
  private queue: any = null;
  private worker: any = null;
  private connection: { url: string } | null = null;

  constructor(name: string) {
    this.name = name;
  }

  private async ensureQueue(): Promise<any> {
    if (this.queue) return this.queue;
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL/bullmq required: BullMqQueue needs process.env.REDIS_URL to be set');
    }
    let bullmq: any;
    try {
      // Lazy, dynamic import — only resolved when BullMQ is actually used.
      bullmq = await import('bullmq');
    } catch {
      throw new Error("REDIS_URL/bullmq required: the 'bullmq' package is not installed (run `npm install bullmq`)");
    }
    this.connection = { url };
    this.queue = new bullmq.Queue(this.name, { connection: this.connection });
    return this.queue;
  }

  async add(job: T, opts: AddOpts = {}): Promise<void> {
    const queue = await this.ensureQueue();
    const { priority = 0, dedupeKey } = opts;
    // BullMQ: lower number = higher priority. Map larger `priority` → smaller value.
    // Offset keeps the value a positive integer (BullMQ requires >= 1 when set).
    const bullPriority = priority === 0 ? undefined : Math.max(1, 1_000_000 - priority);
    await queue.add(this.name, job, {
      priority: bullPriority,
      // BullMQ jobId is unique — reusing one suppresses duplicate enqueues while pending.
      ...(dedupeKey !== undefined ? { jobId: dedupeKey } : {}),
    });
  }

  async process(concurrency: number, handler: (job: T) => Promise<void>): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL/bullmq required: BullMqQueue needs process.env.REDIS_URL to be set');
    }
    let bullmq: any;
    try {
      bullmq = await import('bullmq');
    } catch {
      throw new Error("REDIS_URL/bullmq required: the 'bullmq' package is not installed (run `npm install bullmq`)");
    }
    this.connection = { url };
    this.worker = new bullmq.Worker(
      this.name,
      async (job: any) => handler(job.data as T),
      { connection: this.connection, concurrency: Math.max(1, concurrency) },
    );
    // BullMQ workers run until closed; drain() is the cooperative stop point.
    return this.drain();
  }

  async drain(): Promise<void> {
    if (!this.queue) return;
    // Wait until the queue reports no waiting/active jobs.
    // BullMQ exposes getJobCounts(); poll briefly. Production callers typically
    // keep the worker alive — this is a best-effort drain for symmetry.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
      const remaining =
        (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);
      if (remaining === 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  size(): number {
    // BullMQ size is async over Redis; the synchronous interface can't express it.
    // Return 0 as a non-blocking best-effort. Use drain() for accurate waiting.
    return 0;
  }
}

/**
 * Factory: returns a Redis-backed BullMqQueue when REDIS_URL is set (multi-process
 * scale-out), otherwise the in-memory default. `name` namespaces the BullMQ queue.
 */
export function makeJobQueue<T>(name: string): JobQueue<T> {
  if (process.env.REDIS_URL) {
    return new BullMqQueue<T>(name);
  }
  return new InMemoryQueue<T>();
}
