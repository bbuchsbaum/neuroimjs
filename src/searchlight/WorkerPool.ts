/**
 * Worker pool for managing parallel searchlight computations.
 * 
 * This class manages a pool of Web Workers for efficient parallel
 * processing of searchlight analyses.
 */

import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { ROIVolWindow } from '../roi/ROI_improved';
import { NeuroSpace } from '../geometry/NeuroSpace';

export interface WorkerPoolOptions {
  numWorkers?: number;
  onProgress?: (progress: number) => void;
}

interface WorkerTask {
  indices: number[];
  startIdx: number;
  resolve: (results: any[]) => void;
  reject: (error: Error) => void;
}

export class SearchlightWorkerPool {
  private workers: Worker[] = [];
  private taskQueue: WorkerTask[] = [];
  private busyWorkers = new Set<Worker>();
  private completedTasks = 0;
  private totalTasks = 0;
  private results: Map<number, any[]> = new Map();
  private onProgress?: (progress: number) => void;

  constructor(options: WorkerPoolOptions = {}) {
    const numWorkers = options.numWorkers || navigator.hardwareConcurrency || 4;
    this.onProgress = options.onProgress;

    // Create workers
    for (let i = 0; i < numWorkers; i++) {
      const worker = this.createWorker();
      this.workers.push(worker);
    }
  }

  private createWorker(): Worker {
    // In a real browser environment, this would create a Web Worker
    // For Node.js compatibility, we'll use a different approach
    if (typeof Worker !== 'undefined') {
      // Browser environment
      const blob = new Blob([
        `(${workerFunction.toString()})()`
      ], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      return new Worker(workerUrl);
    } else {
      // Node.js environment - return a mock worker
      return createMockWorker();
    }
  }

  async initialize(mask: LogicalNeuroVol, radius: number, nonzero: boolean): Promise<void> {
    const initData = {
      type: 'initialize',
      data: {
        maskData: mask.getData(),
        spaceDim: mask.space.dim,
        spacing: mask.space.spacing,
        origin: mask.space.origin,
        radius,
        nonzero
      }
    };

    // Initialize all workers
    const initPromises = this.workers.map(worker => {
      return new Promise<void>((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          if (event.data.type === 'initialized') {
            worker.removeEventListener('message', handler);
            resolve();
          } else if (event.data.type === 'error') {
            worker.removeEventListener('message', handler);
            reject(new Error(event.data.error));
          }
        };
        worker.addEventListener('message', handler);
        worker.postMessage(initData);
      });
    });

    await Promise.all(initPromises);
  }

  async computeSearchlights(
    indices: number[],
    batchSize: number = 100
  ): Promise<any[]> {
    this.results.clear();
    this.completedTasks = 0;
    this.totalTasks = Math.ceil(indices.length / batchSize);

    // Create tasks
    const tasks: WorkerTask[] = [];
    for (let i = 0; i < indices.length; i += batchSize) {
      const batch = indices.slice(i, i + batchSize);
      tasks.push({
        indices: batch,
        startIdx: i,
        resolve: () => {},
        reject: () => {}
      });
    }

    // Process all tasks
    return new Promise((resolve, reject) => {
      let resolved = false;

      const processNextTask = (worker: Worker) => {
        if (tasks.length === 0) {
          this.busyWorkers.delete(worker);
          
          // Check if all tasks are complete
          if (this.busyWorkers.size === 0 && !resolved) {
            resolved = true;
            // Combine results in order
            const allResults: any[] = [];
            for (let i = 0; i < this.totalTasks; i++) {
              const taskResults = this.results.get(i * batchSize);
              if (taskResults) {
                allResults.push(...taskResults);
              }
            }
            resolve(allResults);
          }
          return;
        }

        const task = tasks.shift()!;
        this.busyWorkers.add(worker);

        const handler = (event: MessageEvent) => {
          if (event.data.type === 'result') {
            worker.removeEventListener('message', handler);
            this.results.set(task.startIdx, event.data.results);
            this.completedTasks++;
            
            if (this.onProgress) {
              this.onProgress(event.data.progress);
            }

            processNextTask(worker);
          } else if (event.data.type === 'error') {
            worker.removeEventListener('message', handler);
            this.busyWorkers.delete(worker);
            if (!resolved) {
              resolved = true;
              reject(new Error(event.data.error));
            }
          }
        };

        worker.addEventListener('message', handler);
        worker.postMessage({
          type: 'compute',
          data: {
            indices: task.indices,
            startIdx: task.startIdx
          }
        });
      };

      // Start processing with all workers
      this.workers.forEach(worker => processNextTask(worker));
    });
  }

  terminate(): void {
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
  }
}

// Worker function to be injected
function workerFunction() {
  // The browser Web Worker searchlight path is not implemented. Previously this
  // was an empty placeholder, which caused the worker to silently produce no
  // results. Throw a clear error instead so callers are not misled by empty output.
  throw new Error('worker searchlight not implemented');
}

// Mock worker for Node.js environment
function createMockWorker(): Worker {
  // Create a mock worker that processes synchronously
  const listeners = new Map<string, Function[]>();
  
  const mockWorker = {
    postMessage: (data: any) => {
      // Simulate async processing
      setTimeout(() => {
        const handlers = listeners.get('message') || [];
        handlers.forEach(handler => {
          handler({ data: { type: 'initialized' } });
        });
      }, 0);
    },
    addEventListener: (event: string, handler: Function) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
    },
    removeEventListener: (event: string, handler: Function) => {
      const handlers = listeners.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    },
    terminate: () => {}
  };

  return mockWorker as any;
}