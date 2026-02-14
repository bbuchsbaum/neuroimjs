import type { ScatterFieldOptions, ScatterFieldResult, ScatterFieldMessage } from './ScatterFieldBuilder';
import { buildScatterField } from './ScatterFieldBuilder';

// Fallback inline builder if Worker is unavailable (e.g., Node tests)
const supportsWorker = typeof Worker !== 'undefined';

/**
 * Build scatter field off the main thread when possible.
 * Returns the same shape as buildScatterField.
 */
export function buildScatterFieldAsync(opts: ScatterFieldOptions): Promise<ScatterFieldResult> {
  if (!supportsWorker || opts.reuseBuffer) {
    // If reuseBuffer is provided, transferring its backing buffer would break it; do sync
    const res = buildScatterField(opts);
    return Promise.resolve(res);
  }

  return new Promise((resolve, reject) => {
    try {
      // @ts-ignore import.meta is only valid in ESM builds; CJS builds will hit the catch and fall back
      const worker = new Worker(new URL('./ScatterFieldWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<ScatterFieldMessage>) => {
        const msg = ev.data;
        // Rehydrate NeuroSpace + volume
        // Note: we keep a simple FloatNeuroVol reconstruction to match buildScatterField output
        // Re-import lazily to avoid circular deps on non-worker paths
        import('../volume/DenseNeuroVol').then(({ FloatNeuroVol }) => {
          import('../geometry/NeuroSpace').then(({ NeuroSpace }) => {
            import('../geometry/Axis').then(({ AxisSet3D }) => {
              const axes = AxisSet3D.fromStr(msg.volumeMeta.axesId) ?? AxisSet3D.AXIAL_LPI;
              const space = new NeuroSpace(
                msg.volumeMeta.dim as any,
                msg.volumeMeta.spacing as any,
                msg.volumeMeta.origin as any,
                axes
              );
              const volume = new FloatNeuroVol(space, msg.data);
              const result: ScatterFieldResult = {
                volume,
                data: msg.data,
                maxValue: msg.maxValue,
                nonZeroCount: msg.nonZeroCount,
              };
              worker.terminate();
              resolve(result);
            });
          });
        });
      };
      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };
      worker.postMessage(opts);
    } catch (err) {
      // Fallback to sync build if worker construction fails
      try {
        const res = buildScatterField(opts);
        resolve(res);
      } catch (e) {
        reject(e);
      }
    }
  });
}
