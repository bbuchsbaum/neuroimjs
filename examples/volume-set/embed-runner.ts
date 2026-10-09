import type { JobRunner } from '../../src/volumeset/embeddingJobs';
import type { EmbeddingResult, NmdsOptions } from '../../src/volumeset/nmds';

export interface EmbedInput {
  /** m x m dissimilarities over eligible members (copied to the worker; canonical volume data never is). */
  dist: Float64Array;
  ids: string[];
  opts: NmdsOptions;
}

export interface EmbedOutput {
  result: EmbeddingResult;
  /** Solver wall time inside the worker. */
  ms: number;
}

/**
 * One dedicated embedding worker, created on first use. Jobs run one at a time;
 * aborting the running job terminates the worker (a fresh one starts for the next
 * job), aborting a queued job just drops it.
 */
export class EmbedWorkerRunner implements JobRunner<EmbedInput, EmbedOutput> {
  private worker: Worker | null = null;
  private nextId = 1;
  private chain: Promise<unknown> = Promise.resolve();
  private active: { id: number; resolve: (v: EmbedOutput) => void; reject: (e: Error) => void } | null = null;
  private disposed = false;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent) => {
      const { id, result, ms, error } = e.data as { id: number; result?: EmbeddingResult; ms?: number; error?: string };
      const job = this.active;
      if (!job || job.id !== id) return;
      this.active = null;
      if (error || !result) job.reject(new Error(error ?? 'embedding failed'));
      else job.resolve({ result, ms: ms ?? 0 });
    };
    w.onerror = (e) => {
      e.preventDefault();
      const job = this.active;
      this.active = null;
      this.kill();
      job?.reject(new Error(`embedding worker error: ${e.message || 'unknown'}`));
    };
    this.worker = w;
    return w;
  }

  private kill(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  run(input: EmbedInput, signal: AbortSignal): Promise<EmbedOutput> {
    const job = (): Promise<EmbedOutput> =>
      new Promise<EmbedOutput>((resolve, reject) => {
        if (this.disposed || signal.aborted) {
          reject(new Error('embedding cancelled'));
          return;
        }
        const id = this.nextId++;
        this.active = { id, resolve, reject };
        signal.addEventListener(
          'abort',
          () => {
            if (this.active?.id !== id) return;
            this.active = null;
            this.kill();
            reject(new Error('embedding cancelled'));
          },
          { once: true }
        );
        this.ensure().postMessage({ id, dist: input.dist.slice(), ids: input.ids, opts: input.opts });
      });
    const p = this.chain.then(job, job);
    this.chain = p.catch(() => undefined);
    return p;
  }

  get workerCount(): number {
    return this.worker ? 1 : 0;
  }

  dispose(): void {
    this.disposed = true;
    const job = this.active;
    this.active = null;
    this.kill();
    job?.reject(new Error('embedding cancelled'));
  }
}
