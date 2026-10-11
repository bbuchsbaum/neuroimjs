import { nmds, type NmdsOptions } from '../../src/volumeset/nmds';

interface Job {
  id: number;
  dist: Float64Array;
  ids: string[];
  opts: NmdsOptions;
}

self.onmessage = (e: MessageEvent) => {
  const { id, dist, ids, opts } = e.data as Job;
  try {
    const t0 = performance.now();
    const result = nmds(dist, ids, opts);
    (self as unknown as Worker).postMessage({ id, result, ms: performance.now() - t0 });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
