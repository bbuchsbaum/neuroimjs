/**
 * Browser Web Worker pool for spherical searchlight geometry.
 *
 * Workers receive linear center indices and return flat coordinate buffers. The
 * parent thread owns the NeuroSpace and reconstructs ROIVolWindow instances so
 * custom affines and axis metadata never need to be serialized.
 */

import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';

export interface WorkerPoolOptions {
  numWorkers?: number;
  onProgress?: (progress: number) => void;
}

export interface SearchlightWorkerResult {
  /** Flat [i, j, k, ...] grid coordinates. */
  coords: Int32Array;
  data: Float32Array;
  centerIdx: number;
}

interface WorkerHandle {
  worker: Worker;
  url: string;
}

interface InitializeRequest {
  type: 'initialize';
  data: {
    dimensions: [number, number, number];
    spacing: [number, number, number];
    radius: number;
  };
}

interface ComputeRequest {
  type: 'compute';
  data: {
    centerIndices: number[];
  };
}

type SearchlightWorkerRequest = InitializeRequest | ComputeRequest;

type SearchlightWorkerResponse =
  | { type: 'initialized' }
  | { type: 'result'; results: SearchlightWorkerResult[] }
  | { type: 'error'; error: string };

const DEFAULT_WORKERS = 4;
const MAX_WORKERS = 32;

export class SearchlightWorkerPool {
  private handles: WorkerHandle[] = [];
  private readonly onProgress?: (progress: number) => void;
  private initialized = false;
  private terminated = false;

  constructor(options: WorkerPoolOptions = {}) {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' ||
        typeof URL?.createObjectURL !== 'function') {
      throw new Error('Web Workers are not available in this environment');
    }

    const hardwareConcurrency =
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    const requested = options.numWorkers ?? hardwareConcurrency ?? DEFAULT_WORKERS;
    if (!Number.isSafeInteger(requested) || requested < 1) {
      throw new RangeError('numWorkers must be a positive integer');
    }

    this.onProgress = options.onProgress;
    const workerCount = Math.min(requested, MAX_WORKERS);

    try {
      for (let i = 0; i < workerCount; i++) {
        this.handles.push(this.createWorker());
      }
    } catch (error) {
      this.terminate();
      throw error;
    }
  }

  private createWorker(): WorkerHandle {
    const blob = new Blob([`(${searchlightWorkerMain.toString()})()`], {
      type: 'application/javascript',
    });
    const url = URL.createObjectURL(blob);

    try {
      return { worker: new Worker(url), url };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  async initialize(mask: LogicalNeuroVol, radius: number): Promise<void> {
    this.assertActive();
    if (!Number.isFinite(radius) || radius < 0) {
      throw new RangeError('radius must be a finite, non-negative number');
    }
    if (mask.space.ndim() !== 3) {
      throw new Error('Searchlight computation requires a 3D mask');
    }

    const dimensions = mask.space.dim as [number, number, number];
    const spacing = mask.space.spacing as [number, number, number];
    const request: InitializeRequest = {
      type: 'initialize',
      data: {
        dimensions: [...dimensions],
        spacing: [...spacing],
        radius,
      },
    };

    await Promise.all(
      this.handles.map(({ worker }) =>
        this.request(worker, request, response => response.type === 'initialized')
      )
    );
    this.initialized = true;
  }

  async computeSearchlights(
    centerIndices: number[],
    batchSize = 100
  ): Promise<SearchlightWorkerResult[]> {
    this.assertActive();
    if (!this.initialized) {
      throw new Error('SearchlightWorkerPool must be initialized before use');
    }
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
      throw new RangeError('batchSize must be a positive integer');
    }
    if (centerIndices.length === 0) {
      this.onProgress?.(1);
      return [];
    }

    const batches: number[][] = [];
    for (let i = 0; i < centerIndices.length; i += batchSize) {
      batches.push(centerIndices.slice(i, i + batchSize));
    }

    const orderedResults = new Array<SearchlightWorkerResult[]>(batches.length);
    let nextBatch = 0;
    let completedBatches = 0;

    const runWorker = async (worker: Worker): Promise<void> => {
      while (true) {
        const batchIndex = nextBatch++;
        if (batchIndex >= batches.length) return;

        const request: ComputeRequest = {
          type: 'compute',
          data: { centerIndices: batches[batchIndex] },
        };
        const response = await this.request(
          worker,
          request,
          candidate => candidate.type === 'result'
        );
        if (response.type !== 'result') {
          throw new Error('Worker returned an unexpected response');
        }
        orderedResults[batchIndex] = response.results;
        completedBatches++;
        this.onProgress?.(completedBatches / batches.length);
      }
    };

    await Promise.all(this.handles.map(({ worker }) => runWorker(worker)));
    return orderedResults.flat();
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.initialized = false;

    for (const { worker, url } of this.handles) {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
    this.handles = [];
  }

  private assertActive(): void {
    if (this.terminated) {
      throw new Error('SearchlightWorkerPool has been terminated');
    }
  }

  private request<TRequest extends SearchlightWorkerRequest>(
    worker: Worker,
    request: TRequest,
    accepts: (response: SearchlightWorkerResponse) => boolean
  ): Promise<SearchlightWorkerResponse> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        worker.removeEventListener('messageerror', handleMessageError);
      };
      const handleMessage = (event: MessageEvent<SearchlightWorkerResponse>): void => {
        const response = event.data;
        if (response.type === 'error') {
          cleanup();
          reject(new Error(response.error));
        } else if (accepts(response)) {
          cleanup();
          resolve(response);
        }
      };
      const handleError = (event: ErrorEvent): void => {
        cleanup();
        reject(new Error(`Searchlight worker failed: ${event.message || 'unknown error'}`));
      };
      const handleMessageError = (): void => {
        cleanup();
        reject(new Error('Searchlight worker returned an unreadable message'));
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      worker.addEventListener('messageerror', handleMessageError);
      try {
        worker.postMessage(request);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

/** Standalone entry point stringified into a Blob-backed Web Worker. */
function searchlightWorkerMain(): void {
  type State = {
    dimensions: [number, number, number];
    spacing: [number, number, number];
    radius: number;
  };
  type Request =
    | { type: 'initialize'; data: State }
    | { type: 'compute'; data: { centerIndices: number[] } };
  type Result = {
    coords: Int32Array;
    data: Float32Array;
    centerIdx: number;
  };
  type Response =
    | { type: 'initialized' }
    | { type: 'result'; results: Result[] }
    | { type: 'error'; error: string };
  type WorkerScope = {
    onmessage: ((event: MessageEvent<Request>) => void) | null;
    postMessage(message: Response, transfer?: Transferable[]): void;
  };

  const scope = self as unknown as WorkerScope;
  let state: State | undefined;

  const compute = (centerIndex: number): Result => {
    if (!state) throw new Error('Worker has not been initialized');
    const [nx, ny, nz] = state.dimensions;
    const volumeSize = nx * ny * nz;
    if (!Number.isSafeInteger(centerIndex) || centerIndex < 0 || centerIndex >= volumeSize) {
      throw new RangeError(`Center index ${centerIndex} is out of bounds`);
    }

    const cx = centerIndex % nx;
    const cy = Math.floor(centerIndex / nx) % ny;
    const cz = Math.floor(centerIndex / (nx * ny));
    const [sx, sy, sz] = state.spacing;
    const radiusSquared = state.radius * state.radius;
    const xRadius = state.radius / sx;
    const yRadius = state.radius / sy;
    const zRadius = state.radius / sz;
    const xMin = Math.max(0, Math.floor(cx - xRadius));
    const xMax = Math.min(nx - 1, Math.ceil(cx + xRadius));
    const yMin = Math.max(0, Math.floor(cy - yRadius));
    const yMax = Math.min(ny - 1, Math.ceil(cy + yRadius));
    const zMin = Math.max(0, Math.floor(cz - zRadius));
    const zMax = Math.min(nz - 1, Math.ceil(cz + zRadius));

    const coordinates: number[] = [];
    let centerIdx = -1;
    for (let i = xMin; i <= xMax; i++) {
      for (let j = yMin; j <= yMax; j++) {
        for (let k = zMin; k <= zMax; k++) {
          const distanceSquared =
            ((i - cx) * sx) ** 2 +
            ((j - cy) * sy) ** 2 +
            ((k - cz) * sz) ** 2;
          if (distanceSquared <= radiusSquared) {
            if (i === cx && j === cy && k === cz) {
              centerIdx = coordinates.length / 3;
            }
            coordinates.push(i, j, k);
          }
        }
      }
    }

    if (centerIdx < 0) throw new Error('Searchlight geometry omitted its center voxel');
    const coords = Int32Array.from(coordinates);
    const data = new Float32Array(coords.length / 3);
    data.fill(1);
    return { coords, data, centerIdx };
  };

  scope.onmessage = (event): void => {
    try {
      if (event.data.type === 'initialize') {
        state = event.data.data;
        scope.postMessage({ type: 'initialized' });
        return;
      }
      const results = event.data.data.centerIndices.map(compute);
      const transfer = results.flatMap(result => [result.coords.buffer, result.data.buffer]);
      scope.postMessage({ type: 'result', results }, transfer);
    } catch (error) {
      scope.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
