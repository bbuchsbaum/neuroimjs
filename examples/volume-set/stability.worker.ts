/**
 * Block-bootstrap stability worker. Holds one set's masked vectors (eligible
 * members only) per basis key and streams aligned replicate layouts back as they
 * finish, so clouds fill in progressively. Aborting = terminating the worker.
 */
import { runStability } from '../../src/volumeset/stability';
import { nmds, metricSmacof } from '../../src/volumeset/nmds';
import { procrustesAlign } from '../../src/volumeset/procrustes';

interface Init {
  type: 'init';
  key: string;
  data: Float32Array[];
  support: Int32Array;
  dim: number[];
  spacingMm: number[];
  maskIndex: Int32Array;
}

interface Run {
  type: 'run';
  id: number;
  key: string;
  ids: string[];
  reference: Float64Array;
  method: 'nmds' | 'metric-smacof';
  replicates: number;
  seed: number;
  blockMm: number;
}

let held: Init | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as Init | Run;
  if (msg.type === 'init') {
    held = msg;
    return;
  }
  const post = (m: unknown): void => (self as unknown as Worker).postMessage(m);
  if (!held || held.key !== msg.key) {
    post({ id: msg.id, type: 'error', error: 'stability data not initialised for this layout' });
    return;
  }
  try {
    const m = msg.ids.length;
    // Refit with the same method as the displayed layout, warm-started at it; no random restarts.
    const fit = (dist: Float64Array, init: Float64Array): Float64Array => {
      const opts = { init, restarts: 0, seed: 1, maxIter: 200, tol: 1e-6 };
      const r = msg.method === 'metric-smacof' ? metricSmacof(dist, msg.ids, opts) : nmds(dist, msg.ids, opts);
      return Float64Array.from(r.coords);
    };
    const align = (source: Float64Array, target: Float64Array): Float64Array => Float64Array.from(procrustesAlign(source, target).aligned);
    const result = await runStability({
      data: held.data,
      members: Array.from({ length: m }, (_, i) => i),
      support: held.support,
      dim: held.dim,
      spacingMm: held.spacingMm,
      maskIndex: held.maskIndex,
      reference: msg.reference,
      fit,
      align,
      replicates: msg.replicates,
      seed: msg.seed,
      blockMm: msg.blockMm,
      maxMomentBytes: 96 * 1024 * 1024,
      onReplicate: (rep) => post({ id: msg.id, type: 'replicate', index: rep.index, coords: rep.coords, invalid: rep.invalid, done: rep.done, total: rep.total }),
    });
    post({
      id: msg.id,
      type: 'done',
      result: {
        definition: result.definition,
        blockMm: result.blockMm,
        blockMmActual: result.blockMmActual,
        nBlocks: result.nBlocks,
        replicates: result.replicates,
        seed: result.seed,
        method: result.method,
        invalid: result.invalid,
        ellipses: result.ellipses,
        spread: Array.from(result.spread),
      },
    });
  } catch (err) {
    post({ id: msg.id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
