/**
 * Service for managing web worker operations in display components
 * Provides high-level API for offloading computations
 */

import { WorkerPool } from './WorkerPool';
import { SliceWorkerRequest } from './SliceWorker';
import { ImageSlice } from '../ImageSlice';
import { SliceResultData, ProcessResultData } from '../types/display';
import { AxisSet2D } from '../../geometry/Axis';

export interface WorkerServiceOptions {
  /** Enable web workers (default: true if supported) */
  enabled?: boolean;
  /** Maximum number of workers */
  maxWorkers?: number;
  /** Worker script URL */
  workerUrl?: string;
}

/**
 * Singleton service for managing web workers
 */
export class WorkerService {
  private static instance: WorkerService;
  private workerPool?: WorkerPool;
  private enabled: boolean;
  private requestIdCounter = 0;
  
  private constructor(options: WorkerServiceOptions = {}) {
    this.enabled = options.enabled !== false && typeof Worker !== 'undefined';
    
    if (this.enabled) {
      try {
        this.workerPool = new WorkerPool({
          maxWorkers: options.maxWorkers,
          workerUrl: options.workerUrl
        });
      } catch (error) {
        console.warn('Failed to initialize worker pool:', error);
        this.enabled = false;
      }
    }
  }
  
  /**
   * Get the singleton instance
   */
  static getInstance(options?: WorkerServiceOptions): WorkerService {
    if (!WorkerService.instance) {
      WorkerService.instance = new WorkerService(options);
    }
    return WorkerService.instance;
  }
  
  /**
   * Check if workers are enabled and available
   */
  isEnabled(): boolean {
    return this.enabled && this.workerPool !== undefined;
  }
  
  /**
   * Extract a slice using web workers
   */
  async extractSlice(
    volumeData: Float32Array,
    dimensions: number[],
    sliceIndex: number,
    axis: number,
    spacing: number[],
    onProgress?: (progress: number) => void
  ): Promise<ImageSlice> {
    if (!this.isEnabled()) {
      throw new Error('Web workers are not available');
    }
    
    const request: SliceWorkerRequest = {
      id: this.generateRequestId(),
      type: 'extractSlice',
      data: {
        volumeData,
        dimensions,
        sliceIndex,
        axis,
        spacing
      }
    };
    
    const result = await this.workerPool!.execute<SliceResultData>(request, onProgress);

    // Convert result to ImageSlice
    const boundingBox = {
      xMin: 0,
      xMax: result.width * result.spacing[0],
      yMin: 0,
      yMax: result.height * result.spacing[1]
    };

    // Create a default 2D axis set (assuming axial orientation)
    const axes = AxisSet2D.AXIAL_LP;

    return new ImageSlice(result.imageData, boundingBox, Array.from(result.spacing), axes);
  }
  
  /**
   * Process a slice with filters
   */
  async processSlice(
    imageData: ImageData,
    operation: 'blur' | 'sharpen' | 'edge' | 'threshold',
    params: any = {},
    onProgress?: (progress: number) => void
  ): Promise<ImageData> {
    if (!this.isEnabled()) {
      throw new Error('Web workers are not available');
    }

    const request: SliceWorkerRequest = {
      id: this.generateRequestId(),
      type: 'processSlice',
      data: {
        imageData,
        operation,
        params
      }
    };

    const result = await this.workerPool!.execute<ProcessResultData>(request, onProgress);
    return result.imageData;
  }
  
  /**
   * Resample image data
   */
  async resampleImage(
    imageData: ImageData,
    targetWidth: number,
    targetHeight: number,
    method: 'nearest' | 'bilinear' | 'bicubic' = 'bilinear',
    onProgress?: (progress: number) => void
  ): Promise<ImageData> {
    if (!this.isEnabled()) {
      throw new Error('Web workers are not available');
    }

    const request: SliceWorkerRequest = {
      id: this.generateRequestId(),
      type: 'resample',
      data: {
        imageData,
        targetWidth,
        targetHeight,
        method
      }
    };

    const result = await this.workerPool!.execute<ProcessResultData>(request, onProgress);
    return result.imageData;
  }
  
  /**
   * Process multiple slices in parallel
   */
  async processSlicesBatch(
    tasks: Array<{
      imageData: ImageData;
      operation: 'blur' | 'sharpen' | 'edge' | 'threshold';
      params?: any;
    }>,
    onProgress?: (taskIndex: number, progress: number) => void
  ): Promise<ImageData[]> {
    if (!this.isEnabled()) {
      throw new Error('Web workers are not available');
    }
    
    const requests: SliceWorkerRequest[] = tasks.map((task, index) => ({
      id: `${this.generateRequestId()}_${index}`,
      type: 'processSlice',
      data: {
        imageData: task.imageData,
        operation: task.operation,
        params: task.params || {}
      }
    }));
    
    const results = await this.workerPool!.executeMany<ProcessResultData>(
      requests,
      onProgress ? (taskId, progress) => {
        const index = parseInt(taskId.split('_').pop()!);
        onProgress(index, progress);
      } : undefined
    );

    // Extract results in order
    return requests.map(req => {
      const result = results.get(req.id);
      if (!result) {
        throw new Error('No result returned');
      }
      return result.imageData;
    });
  }
  
  /**
   * Get worker pool statistics
   */
  getStats(): {
    enabled: boolean;
    poolStats?: ReturnType<WorkerPool['getStats']>;
  } {
    return {
      enabled: this.enabled,
      poolStats: this.workerPool?.getStats()
    };
  }
  
  /**
   * Update worker pool configuration
   */
  setMaxWorkers(max: number): void {
    if (this.workerPool) {
      this.workerPool.setMaxWorkers(max);
    }
  }
  
  /**
   * Terminate all workers
   */
  terminate(): void {
    if (this.workerPool) {
      this.workerPool.terminate();
      this.workerPool = undefined;
    }
    
    if (WorkerService.instance === this) {
      WorkerService.instance = undefined as any;
    }
  }
  
  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return `worker_${Date.now()}_${++this.requestIdCounter}`;
  }
  
  /**
   * Calculate bounds for a slice
   */
  private calculateBounds(
    width: number,
    height: number,
    spacing: [number, number]
  ): [[number, number], [number, number], [number, number], [number, number]] {
    const [sx, sy] = spacing;
    const worldWidth = width * sx;
    const worldHeight = height * sy;
    
    return [
      [0, 0],
      [worldWidth, 0],
      [worldWidth, worldHeight],
      [0, worldHeight]
    ];
  }
  
  /**
   * Create a fallback for when workers are not available
   */
  static createFallback(): {
    isEnabled: () => boolean;
    extractSlice: () => Promise<never>;
    processSlice: () => Promise<never>;
    resampleImage: () => Promise<never>;
    processSlicesBatch: () => Promise<never>;
    getStats: () => { enabled: boolean };
    setMaxWorkers: () => void;
    terminate: () => void;
  } {
    const notAvailable = () => Promise.reject(new Error('Web workers are not available'));
    
    return {
      isEnabled: () => false,
      extractSlice: notAvailable,
      processSlice: notAvailable,
      resampleImage: notAvailable,
      processSlicesBatch: notAvailable,
      getStats: () => ({ enabled: false }),
      setMaxWorkers: () => {},
      terminate: () => {}
    };
  }
}
