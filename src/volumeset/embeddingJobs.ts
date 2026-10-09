/**
 * Cache and scheduler for expensive, keyed computations such as embedding fits.
 *
 * - Results are cached by key (bounded, least-recently-used eviction).
 * - Identical pending requests coalesce onto one run.
 * - Each request reports whether its key is still the latest one requested, so a
 *   caller never installs a stale result after the user has moved on (A -> B -> A
 *   reuses A's cached or pending run; B's late result is not current).
 * - Failures are not cached: the next request for the key retries.
 * - dispose() aborts pending runs, settles every outstanding promise (rejecting
 *   with an error whose name is 'AbortError') and releases the runner.
 *
 * The runner does the actual work (e.g. posts a distance matrix to a worker); it
 * receives an AbortSignal and should reject promptly when it fires.
 */

export interface JobRunner<I, R> {
  run(input: I, signal: AbortSignal): Promise<R>;
  dispose?(): void;
}

export interface JobOutcome<R> {
  key: string;
  result: R;
  /** True when no different key has been requested since this request. */
  current: boolean;
}

function abortError(message: string): Error {
  const e = new Error(message);
  e.name = 'AbortError';
  return e;
}

export class EmbeddingJobs<I, R> {
  private readonly cache = new Map<string, R>();
  private readonly pending = new Map<string, { promise: Promise<R>; controller: AbortController }>();
  private readonly failures = new Map<string, Error>();
  private latest: string | null = null;
  private disposed = false;
  /** Number of times the runner was invoked (for tests and diagnostics). */
  runs = 0;

  constructor(
    private readonly runner: JobRunner<I, R>,
    readonly maxEntries = 6
  ) {}

  /** Cached result for a key, if any (marks it recently used). */
  peek(key: string): R | undefined {
    const r = this.cache.get(key);
    if (r !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, r);
    }
    return r;
  }

  /** Last failure for a key since its most recent request, if any. */
  failure(key: string): Error | undefined {
    return this.failures.get(key);
  }

  isPending(key: string): boolean {
    return this.pending.has(key);
  }

  isCurrent(key: string): boolean {
    return !this.disposed && this.latest === key;
  }

  get size(): number {
    return this.cache.size;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Request the result for `key`, computing it from `input` only when it is
   * neither cached nor already pending. `input` is a thunk so callers can avoid
   * building large inputs for cache hits.
   */
  request(key: string, input: () => I): Promise<JobOutcome<R>> {
    if (this.disposed) return Promise.reject(abortError('job controller disposed'));
    this.latest = key;
    this.failures.delete(key);
    const cached = this.peek(key);
    if (cached !== undefined) return Promise.resolve({ key, result: cached, current: true });
    let entry = this.pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      this.runs++;
      // Settle on abort even if the runner ignores its signal.
      const raced = new Promise<R>((resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(abortError('job aborted')), { once: true });
        this.runner.run(input(), controller.signal).then(resolve, reject);
      });
      const promise = raced.then(
        (result) => {
          this.pending.delete(key);
          if (!this.disposed) this.store(key, result);
          return result;
        },
        (err: unknown) => {
          this.pending.delete(key);
          const e = err instanceof Error ? err : new Error(String(err));
          if (!this.disposed) this.failures.set(key, e);
          throw e;
        }
      );
      entry = { promise, controller };
      this.pending.set(key, entry);
    }
    return entry.promise.then((result) => {
      if (this.disposed) throw abortError('job controller disposed');
      return { key, result, current: this.latest === key };
    });
  }

  private store(key: string, result: R): void {
    this.cache.delete(key);
    this.cache.set(key, result);
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }

  /** Drop cached results (pending runs continue). */
  clear(): void {
    this.cache.clear();
    this.failures.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { controller } of this.pending.values()) controller.abort();
    this.pending.clear();
    this.cache.clear();
    this.failures.clear();
    this.runner.dispose?.();
  }
}
