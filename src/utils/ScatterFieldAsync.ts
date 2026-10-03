import type {
  ScatterFieldMessage,
  ScatterFieldOptions,
  ScatterFieldResult,
  ScatterFieldWorkerRequest,
} from './ScatterFieldBuilder';
import { buildScatterField } from './ScatterFieldBuilder';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D, matchAxis } from '../geometry/Axis';
import { getCategoryLogger, LogCategories } from '../display/logging/LoggerConfig';

const logger = getCategoryLogger(LogCategories.WORKER);

/**
 * Build scatter field off the main thread when possible.
 * Returns the same shape as buildScatterField.
 *
 * If the worker cannot be constructed, fails to load or run (for example a
 * UMD host that does not serve the bundle's `assets/` worker chunk), returns
 * an unreadable message, or exceeds `workerTimeoutMs`, the field is built
 * synchronously on the main thread instead.
 */
export function buildScatterFieldAsync(opts: ScatterFieldOptions): Promise<ScatterFieldResult> {
  if (typeof Worker === 'undefined' || opts.reuseBuffer || opts.kernel) {
    // Reused buffers and callback kernels cannot be safely transferred to a worker.
    const res = buildScatterField(opts);
    return Promise.resolve(res);
  }

  const workerTimeoutMs = opts.workerTimeoutMs ?? 120_000;
  if (!Number.isFinite(workerTimeoutMs) || workerTimeoutMs <= 0) {
    return Promise.reject(new RangeError('workerTimeoutMs must be a positive finite number'));
  }

  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = (): void => {
      if (timeout !== undefined) clearTimeout(timeout);
      worker?.terminate();
    };

    // Main-thread fallback: the worker could not deliver a result.
    const fallBack = (reason: string, detail?: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      logger.debug(`Scatter field worker unavailable (${reason}); building on the main thread`, detail);
      try {
        resolve(buildScatterField(opts));
      } catch (e) {
        reject(e);
      }
    };

    try {
      // @ts-ignore import.meta is only valid in ESM builds; CJS builds will hit the catch and fall back
      worker = new Worker(new URL('./ScatterFieldWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<ScatterFieldMessage>) => {
        if (settled) return;
        settled = true;
        try {
          const msg = ev.data;
          const axes = new AxisSet3D(...msg.volumeMeta.axisNames.map(matchAxis) as [
            ReturnType<typeof matchAxis>,
            ReturnType<typeof matchAxis>,
            ReturnType<typeof matchAxis>,
          ]);
          const space = new NeuroSpace(
            msg.volumeMeta.dim,
            msg.volumeMeta.spacing,
            msg.volumeMeta.origin,
            axes,
            msg.volumeMeta.affine
          );
          const volume = new FloatNeuroVol(space, msg.data);
          resolve({
            volume,
            data: msg.data,
            maxValue: msg.maxValue,
            nonZeroCount: msg.nonZeroCount,
          });
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      };
      worker.onerror = (event) => {
        fallBack('error', event?.error ?? event?.message);
      };
      worker.onmessageerror = () => {
        fallBack('unreadable message');
      };
      const axisNames = opts.space.axes.names();
      if (axisNames.length !== 3) {
        throw new Error(`Scatter fields require exactly 3 axes, received ${axisNames.length}`);
      }
      const request: ScatterFieldWorkerRequest = {
        spaceMeta: {
          dim: opts.space.dim.slice(),
          spacing: opts.space.spacing.slice(),
          origin: opts.space.origin.slice(),
          axisNames: axisNames as [string, string, string],
          affine: opts.space.trans.to2DArray(),
        },
        points: opts.points,
        kernelParams: opts.kernelParams ?? {},
        cutoffMm: opts.cutoffMm,
        combine: opts.combine,
      };
      timeout = setTimeout(() => {
        fallBack(`timed out after ${workerTimeoutMs} ms`);
      }, workerTimeoutMs);
      worker.postMessage(request);
    } catch (error) {
      // Worker construction or request preparation failed.
      fallBack('construction failed', error);
    }
  });
}
