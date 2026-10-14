/** A small pool of smoothing workers; jobs are dispatched to the first idle worker. */
export interface SmoothJob {
  dim: number[];
  maskIndex: Int32Array;
  values: Float32Array;
  guide: 'self' | 'anatomy';
  radius: number;
  epsilon: number;
  guideScale?: { mean: number; sd: number };
}

export class SmoothPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { job: SmoothJob; resolve: (v: Float32Array) => void; reject: (e: Error) => void }[] = [];
  private pending = new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void; worker: Worker }>();
  private nextId = 1;
  private disposed = false;

  constructor(anatomy: Float32Array, size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./smooth.worker.ts', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', anatomy });
      w.onmessage = (e: MessageEvent) => {
        const { id, out, error } = e.data as { id: number; out?: Float32Array; error?: string };
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (error || !out) p.reject(new Error(error ?? 'smoothing failed'));
        else p.resolve(out);
        this.idle.push(w);
        this.pump();
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  run(job: SmoothJob): Promise<Float32Array> {
    if (this.disposed) return Promise.reject(new Error('smoothing pool is disposed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { job, resolve, reject } = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, worker: w });
      // Values are copied (the caller keeps its raw data); the result buffer is transferred back.
      w.postMessage({ type: 'job', id, ...job, values: job.values.slice() });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error('smoothing pool is disposed');
    for (const queued of this.queue.splice(0)) queued.reject(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.idle = [];
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }
}
