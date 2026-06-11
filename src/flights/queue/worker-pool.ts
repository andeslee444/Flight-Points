/**
 * Worker pool: runs a queue's jobs with a fixed concurrency and tracks live
 * performance — total jobs run and the peak number of handlers in flight at once
 * (the proof that parallelism is actually worker-bounded, not serial).
 */

import type { JobQueue } from './job-queue.js';

export interface WorkerPoolStats {
  /** Total jobs whose handler ran to completion (success or thrown). */
  jobsRun: number;
  /** Peak simultaneous in-flight handlers observed during the run. */
  maxObservedConcurrency: number;
}

export interface WorkerPoolHandle {
  /** Resolves when the queue has drained (all jobs processed). */
  done: Promise<void>;
  /** Live, mutable stats — read after `done` resolves for final values. */
  stats: WorkerPoolStats;
}

/**
 * Wrap queue.process() with instrumentation. The handler is wrapped so we can
 * count starts/finishes and track the high-water mark of concurrent execution.
 *
 * @param queue       a JobQueue (jobs should already be added before/while running)
 * @param concurrency max simultaneous handlers
 * @param handler     per-job work
 * @returns a handle exposing `done` (process completion) and live `stats`
 */
export function runWorkers<T>(
  queue: JobQueue<T>,
  concurrency: number,
  handler: (job: T) => Promise<void>,
): WorkerPoolHandle {
  const stats: WorkerPoolStats = { jobsRun: 0, maxObservedConcurrency: 0 };
  let active = 0;

  const instrumented = async (job: T): Promise<void> => {
    active++;
    if (active > stats.maxObservedConcurrency) {
      stats.maxObservedConcurrency = active;
    }
    try {
      await handler(job);
    } finally {
      active--;
      stats.jobsRun++;
    }
  };

  const done = queue.process(concurrency, instrumented);
  return { done, stats };
}
