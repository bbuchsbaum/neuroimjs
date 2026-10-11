import { describe, it, expect } from 'vitest';
import { EmbeddingJobs, type JobRunner } from '../src/volumeset/embeddingJobs';

/** A runner whose jobs finish only when the test says so. */
function controlledRunner() {
  const calls: { input: string; resolve: (v: string) => void; reject: (e: Error) => void; signal: AbortSignal }[] = [];
  let disposed = 0;
  const runner: JobRunner<string, string> = {
    run(input, signal) {
      return new Promise((resolve, reject) => calls.push({ input, resolve, reject, signal }));
    },
    dispose() {
      disposed++;
    },
  };
  return { runner, calls, disposedCount: () => disposed };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('embedding job controller', () => {
  it('coalesces identical pending requests into one run', async () => {
    const { runner, calls } = controlledRunner();
    const jobs = new EmbeddingJobs(runner);
    const p1 = jobs.request('A', () => 'a');
    const p2 = jobs.request('A', () => 'a');
    expect(jobs.runs).toBe(1);
    calls[0].resolve('layout-A');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.result).toBe('layout-A');
    expect(r2.result).toBe('layout-A');
    // A cached key does not run again and does not even build its input.
    let built = false;
    const r3 = await jobs.request('A', () => ((built = true), 'a'));
    expect(r3).toEqual({ key: 'A', result: 'layout-A', current: true });
    expect(built).toBe(false);
    expect(jobs.runs).toBe(1);
  });

  it('never reports a superseded result as current (A -> B -> A)', async () => {
    const { runner, calls } = controlledRunner();
    const jobs = new EmbeddingJobs(runner);
    const a1 = jobs.request('A', () => 'a');
    const b = jobs.request('B', () => 'b');
    const a2 = jobs.request('A', () => 'a');
    // A is reused while pending: only two runs for three requests.
    expect(jobs.runs).toBe(2);
    // B finishes late, after the user went back to A.
    calls[0].resolve('layout-A');
    expect((await a1).current).toBe(true);
    expect((await a2).current).toBe(true);
    calls[1].resolve('layout-B');
    const rb = await b;
    expect(rb.result).toBe('layout-B');
    expect(rb.current).toBe(false);
    expect(jobs.isCurrent('A')).toBe(true);
  });

  it('does not cache failures and retries on the next request', async () => {
    const { runner, calls } = controlledRunner();
    const jobs = new EmbeddingJobs(runner);
    const p = jobs.request('A', () => 'a');
    calls[0].reject(new Error('solver crashed'));
    await expect(p).rejects.toThrow('solver crashed');
    expect(jobs.failure('A')?.message).toBe('solver crashed');
    expect(jobs.peek('A')).toBeUndefined();
    const retry = jobs.request('A', () => 'a');
    expect(jobs.failure('A')).toBeUndefined();
    expect(jobs.runs).toBe(2);
    calls[1].resolve('ok');
    expect((await retry).result).toBe('ok');
  });

  it('bounds the cache with least-recently-used eviction', async () => {
    const { runner, calls } = controlledRunner();
    const jobs = new EmbeddingJobs(runner, 2);
    for (const k of ['A', 'B']) {
      const p = jobs.request(k, () => k);
      calls[calls.length - 1].resolve(k);
      await p;
    }
    jobs.peek('A'); // A is now more recent than B
    const p = jobs.request('C', () => 'C');
    calls[calls.length - 1].resolve('C');
    await p;
    expect(jobs.size).toBe(2);
    expect(jobs.peek('B')).toBeUndefined();
    expect(jobs.peek('A')).toBe('A');
    expect(jobs.peek('C')).toBe('C');
  });

  it('settles pending promises, aborts runs and releases the runner on dispose', async () => {
    const { runner, calls, disposedCount } = controlledRunner();
    const jobs = new EmbeddingJobs(runner);
    const p = jobs.request('A', () => 'a');
    const settled = p.then(
      () => 'resolved',
      (e: Error) => e.name
    );
    jobs.dispose();
    expect(await settled).toBe('AbortError');
    expect(calls[0].signal.aborted).toBe(true);
    expect(disposedCount()).toBe(1);
    // A late result after disposal is ignored; new requests are refused.
    calls[0].resolve('late');
    await tick();
    expect(jobs.size).toBe(0);
    await expect(jobs.request('A', () => 'a')).rejects.toThrow(/disposed/);
    jobs.dispose();
    expect(disposedCount()).toBe(1);
  });

  it('runs nothing for repeated requests of the current key (display-only redraws)', async () => {
    const { runner, calls } = controlledRunner();
    const jobs = new EmbeddingJobs(runner);
    const first = jobs.request('A', () => 'a');
    calls[0].resolve('layout');
    await first;
    for (let i = 0; i < 100; i++) await jobs.request('A', () => 'a');
    expect(jobs.runs).toBe(1);
  });
});
