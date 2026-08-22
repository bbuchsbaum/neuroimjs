/**
 * Worker pool for managing multiple web workers
 * Provides efficient task distribution and resource management
 */

import { SliceWorkerRequest, SliceWorkerResponse } from './SliceWorker';
import { getCategoryLogger, LogCategories } from '../logging/LoggerConfig';

export interface WorkerTask<T = unknown> {
  id: string;
  request: SliceWorkerRequest;
  resolve: (result: T) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
}

export interface WorkerPoolOptions {
  /** Maximum number of workers (default: navigator.hardwareConcurrency || 4) */
  maxWorkers?: number;
  /** Worker script URL */
  workerUrl?: string;
  /** Idle timeout in milliseconds before terminating unused workers */
  idleTimeout?: number;
  /** Enable worker reuse (default: true) */
  reuseWorkers?: boolean;
}

interface PooledWorker<T = unknown> {
  worker: Worker;
  busy: boolean;
  currentTask?: WorkerTask<T>;
  lastUsed: number;
}

/**
 * Manages a pool of web workers for parallel processing
 */
export class WorkerPool {
  private workers: PooledWorker<unknown>[] = [];
  private taskQueue: WorkerTask<unknown>[] = [];
  private options: Required<WorkerPoolOptions>;
  private terminated = false;
  private idleCheckInterval?: number;
  private readonly logger = getCategoryLogger(LogCategories.WORKER);
  
  constructor(options: WorkerPoolOptions = {}) {
    const hardwareConcurrency =
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    const maxWorkers = options.maxWorkers ?? hardwareConcurrency ?? 4;
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1) {
      throw new RangeError('maxWorkers must be a positive integer');
    }
    const idleTimeout = options.idleTimeout ?? 30000;
    if (!Number.isFinite(idleTimeout) || idleTimeout < 0) {
      throw new RangeError('idleTimeout must be a finite, non-negative number');
    }
    this.options = {
      maxWorkers,
      workerUrl: options.workerUrl ?? '/workers/SliceWorker.js',
      idleTimeout,
      reuseWorkers: options.reuseWorkers !== false
    };
    
    this.logger.info('Worker pool created', {
      maxWorkers: this.options.maxWorkers,
      workerUrl: this.options.workerUrl,
      idleTimeout: this.options.idleTimeout
    });
    
    if (this.options.idleTimeout > 0) {
      this.startIdleCheck();
    }
  }
  
  /**
   * Execute a task using the worker pool
   */
  async execute<T = unknown>(
    request: SliceWorkerRequest,
    onProgress?: (progress: number) => void
  ): Promise<T> {
    if (this.terminated) {
      throw new Error('Worker pool has been terminated');
    }
    
    return new Promise((resolve, reject) => {
      const task: WorkerTask<T> = {
        id: request.id,
        request,
        resolve,
        reject,
        onProgress
      };
      
      const availableWorker = this.getAvailableWorker();
      
      if (availableWorker) {
        this.assignTask(availableWorker, task);
      } else if (this.workers.length < this.options.maxWorkers) {
        const newWorker = this.createWorker();
        this.assignTask(newWorker, task);
      } else {
        // Queue the task
        this.taskQueue.push(task as WorkerTask<unknown>);
        this.logger.debug('Task queued', {
          taskId: task.id,
          queueLength: this.taskQueue.length
        });
      }
    });
  }
  
  /**
   * Execute multiple tasks in parallel
   */
  async executeMany<T = unknown>(
    requests: SliceWorkerRequest[],
    onProgress?: (taskId: string, progress: number) => void
  ): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    
    await Promise.all(
      requests.map(async (request) => {
        const result = await this.execute<T>(
          request,
          onProgress ? (progress) => onProgress(request.id, progress) : undefined
        );
        results.set(request.id, result);
      })
    );
    
    return results;
  }
  
  /**
   * Get an available worker from the pool
   */
  private getAvailableWorker(): PooledWorker<unknown> | null {
    return this.workers.find(w => !w.busy) || null;
  }
  
  /**
   * Create a new worker
   */
  private createWorker(): PooledWorker<unknown> {
    const worker = new Worker(this.options.workerUrl);
    const pooledWorker: PooledWorker<unknown> = {
      worker,
      busy: false,
      lastUsed: Date.now()
    };
    
    this.logger.debug('Worker created', {
      workerCount: this.workers.length + 1,
      maxWorkers: this.options.maxWorkers
    });
    
    // Set up message handling
    worker.addEventListener('message', (event: MessageEvent<SliceWorkerResponse>) => {
      this.handleWorkerMessage(pooledWorker, event.data);
    });
    
    worker.addEventListener('error', (error) => {
      this.handleWorkerError(pooledWorker, error);
    });
    
    this.workers.push(pooledWorker);
    return pooledWorker;
  }
  
  /**
   * Assign a task to a worker
   */
  private assignTask<T>(pooledWorker: PooledWorker<T>, task: WorkerTask<T>): void {
    pooledWorker.busy = true;
    pooledWorker.currentTask = task;
    pooledWorker.lastUsed = Date.now();
    
    try {
      pooledWorker.worker.postMessage(task.request);
    } catch (error) {
      pooledWorker.busy = false;
      pooledWorker.currentTask = undefined;
      task.reject(error instanceof Error ? error : new Error(String(error)));
      this.processNextTask();
    }
  }
  
  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(pooledWorker: PooledWorker<unknown>, response: SliceWorkerResponse): void {
    const task = pooledWorker.currentTask;
    
    if (!task || task.id !== response.id) {
      return; // Ignore messages for unknown tasks
    }
    
    switch (response.type) {
      case 'result':
        this.logger.debug('Task completed', { taskId: task.id });
        task.resolve(response.data);
        this.completeTask(pooledWorker);
        break;
        
      case 'error':
        this.logger.error('Task failed', {
          taskId: task.id,
          error: response.error
        });
        task.reject(new Error(response.error || 'Unknown worker error'));
        this.completeTask(pooledWorker);
        break;
        
      case 'progress':
        if (task.onProgress && response.progress !== undefined) {
          task.onProgress(response.progress);
        }
        break;
    }
  }
  
  /**
   * Handle worker errors
   */
  private handleWorkerError(pooledWorker: PooledWorker<unknown>, error: ErrorEvent): void {
    const task = pooledWorker.currentTask;
    
    if (task) {
      task.reject(new Error(`Worker error: ${error.message}`));
    }
    
    // Remove the failed worker
    this.removeWorker(pooledWorker);
    
    // Process next task if any
    this.processNextTask();
  }
  
  /**
   * Complete a task and free the worker
   */
  private completeTask(pooledWorker: PooledWorker<unknown>): void {
    pooledWorker.busy = false;
    pooledWorker.currentTask = undefined;
    pooledWorker.lastUsed = Date.now();

    if (!this.options.reuseWorkers) {
      this.removeWorker(pooledWorker);
    }
    
    // Process next queued task
    this.processNextTask();
  }
  
  /**
   * Process the next task in the queue
   */
  private processNextTask(): void {
    if (this.taskQueue.length === 0) {
      return;
    }
    
    const availableWorker = this.getAvailableWorker();
    
    const worker = availableWorker ??
      (this.workers.length < this.options.maxWorkers ? this.createWorker() : null);
    if (!worker) return;

    const task = this.taskQueue.shift()!;
    this.assignTask(worker, task);
  }
  
  /**
   * Remove a worker from the pool
   */
  private removeWorker(pooledWorker: PooledWorker<unknown>): void {
    const index = this.workers.indexOf(pooledWorker);
    
    if (index !== -1) {
      this.workers.splice(index, 1);
      
      try {
        pooledWorker.worker.terminate();
      } catch {
        // Ignore termination errors
      }
    }
  }
  
  /**
   * Start idle worker checking
   */
  private startIdleCheck(): void {
    this.idleCheckInterval = window.setInterval(() => {
      this.checkIdleWorkers();
    }, 5000); // Check every 5 seconds
  }
  
  /**
   * Check for idle workers and terminate them
   */
  private checkIdleWorkers(): void {
    const now = Date.now();
    const idleWorkers = this.workers.filter(
      w => !w.busy && 
      (now - w.lastUsed) > this.options.idleTimeout &&
      this.workers.length > 1 // Keep at least one worker
    );
    
    idleWorkers.forEach(w => this.removeWorker(w));
  }
  
  /**
   * Get pool statistics
   */
  getStats(): {
    totalWorkers: number;
    busyWorkers: number;
    idleWorkers: number;
    queuedTasks: number;
  } {
    const busyWorkers = this.workers.filter(w => w.busy).length;
    
    return {
      totalWorkers: this.workers.length,
      busyWorkers,
      idleWorkers: this.workers.length - busyWorkers,
      queuedTasks: this.taskQueue.length
    };
  }
  
  /**
   * Terminate all workers and clean up
   */
  terminate(): void {
    this.terminated = true;
    
    // Stop idle checking
    if (this.idleCheckInterval !== undefined) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
    }
    
    // Reject all queued tasks
    this.taskQueue.forEach(task => {
      task.reject(new Error('Worker pool terminated'));
    });
    this.taskQueue = [];
    
    // Terminate all workers
    this.workers.forEach(pooledWorker => {
      if (pooledWorker.currentTask) {
        pooledWorker.currentTask.reject(new Error('Worker pool terminated'));
      }
      
      try {
        pooledWorker.worker.terminate();
      } catch {
        // Ignore termination errors
      }
    });
    
    this.workers = [];
  }
  
  /**
   * Set maximum number of workers
   */
  setMaxWorkers(max: number): void {
    if (!Number.isSafeInteger(max) || max < 1) {
      throw new RangeError('maxWorkers must be a positive integer');
    }
    this.options.maxWorkers = max;
    
    // Remove excess idle workers if needed
    while (this.workers.length > this.options.maxWorkers) {
      const idleWorker = this.workers.find(w => !w.busy);
      
      if (idleWorker) {
        this.removeWorker(idleWorker);
      } else {
        break; // All workers are busy
      }
    }
  }
}
