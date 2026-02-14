/**
 * File-backed NeuroVec for handling large 4D datasets
 * This implementation uses lazy loading and caching for efficient memory usage
 */

import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { INeuroVec, DetrendMethod, TemporalFilter } from './INeuroVec';
import { EnhancedFloat32NeuroVec } from './EnhancedNeuroVec';

/**
 * Cache entry for volume data
 */
interface CacheEntry {
  timeIndex: number;
  data: Float32Array;
  lastAccess: number;
}

/**
 * File-backed NeuroVec that loads data on demand
 * Maintains an LRU cache of recently accessed volumes
 */
export class FileBackedNeuroVec implements INeuroVec {
  readonly space: NeuroSpace;
  private cache: Map<number, CacheEntry> = new Map();
  private maxCacheSize: number;
  private accessCounter: number = 0;
  private dataGetter: (timeIndex: number) => Float32Array;
  private dataSetter?: (timeIndex: number, data: Float32Array) => void;

  constructor(
    space: NeuroSpace,
    dataGetter: (timeIndex: number) => Float32Array,
    options?: {
      maxCacheSize?: number;
      dataSetter?: (timeIndex: number, data: Float32Array) => void;
    }
  ) {
    if (space.dim.length !== 4) {
      throw new Error('FileBackedNeuroVec requires a 4D NeuroSpace');
    }
    
    this.space = space;
    this.dataGetter = dataGetter;
    this.dataSetter = options?.dataSetter;
    this.maxCacheSize = options?.maxCacheSize || 10; // Cache 10 volumes by default
  }

  get length(): number {
    return this.space.dim.reduce((a, b) => a * b, 1);
  }

  get dim(): number[] {
    return this.space.dim;
  }

  get spacing(): number[] {
    return this.space.spacing;
  }

  get origin(): number[] {
    return this.space.origin;
  }

  getData(): any {
    throw new Error('FileBackedNeuroVec does not support getData() - use getVolume() or getTimeSeries()');
  }

  getRange(): [number, number] {
    // This requires scanning all data - expensive operation
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const [, , , dimT] = this.space.dim;

    for (let t = 0; t < dimT; t++) {
      const volData = this.getVolumeData(t);
      for (let i = 0; i < volData.length; i++) {
        if (volData[i] < min) min = volData[i];
        if (volData[i] > max) max = volData[i];
      }
    }

    return [min, max];
  }

  getAt(i: number, j: number, k: number, t: number): number {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (i < 0 || i >= dimX || j < 0 || j >= dimY || 
        k < 0 || k >= dimZ || t < 0 || t >= dimT) {
      throw new Error('Coordinates out of bounds');
    }

    const volData = this.getVolumeData(t);
    const index = i + j * dimX + k * dimX * dimY;
    return volData[index];
  }

  setAt(i: number, j: number, k: number, t: number, value: number): void {
    if (!this.dataSetter) {
      throw new Error('FileBackedNeuroVec is read-only (no dataSetter provided)');
    }

    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (i < 0 || i >= dimX || j < 0 || j >= dimY || 
        k < 0 || k >= dimZ || t < 0 || t >= dimT) {
      throw new Error('Coordinates out of bounds');
    }

    const volData = this.getVolumeData(t);
    const index = i + j * dimX + k * dimX * dimY;
    volData[index] = value;

    // Update cache and persist
    const cacheEntry = this.cache.get(t);
    if (cacheEntry) {
      cacheEntry.lastAccess = this.accessCounter++;
    }
    this.dataSetter(t, volData);
  }

  getVolume(t: number): NeuroVol {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (t < 0 || t >= dimT) {
      throw new Error('Time index out of bounds');
    }

    const volData = this.getVolumeData(t);
    const volumeSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      this.spacing.slice(0, 3),
      this.origin.slice(0, 3),
      this.space.axes
    );

    return new FloatNeuroVol(volumeSpace, volData);
  }

  getSeries(i: number, j: number, k: number): number[] {
    const series = this.getTimeSeries(i, j, k);
    return Array.from(series);
  }

  getTimeSeries(i: number, j: number, k: number): Float32Array {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (i < 0 || i >= dimX || j < 0 || j >= dimY || k < 0 || k >= dimZ) {
      throw new Error('Coordinates out of bounds');
    }

    const series = new Float32Array(dimT);
    const voxelIndex = i + j * dimX + k * dimX * dimY;

    for (let t = 0; t < dimT; t++) {
      const volData = this.getVolumeData(t);
      series[t] = volData[voxelIndex];
    }

    return series;
  }

  setTimeSeries(i: number, j: number, k: number, data: Float32Array): void {
    if (!this.dataSetter) {
      throw new Error('FileBackedNeuroVec is read-only (no dataSetter provided)');
    }

    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (data.length !== dimT) {
      throw new Error(`Time series length ${data.length} does not match time dimension ${dimT}`);
    }

    const voxelIndex = i + j * dimX + k * dimX * dimY;

    for (let t = 0; t < dimT; t++) {
      const volData = this.getVolumeData(t);
      volData[voxelIndex] = data[t];
      this.dataSetter(t, volData);
    }
  }

  // Delegate time series operations to a temporary in-memory EnhancedNeuroVec
  // This is memory-intensive but provides full functionality

  detrend(method: DetrendMethod, options?: { order?: number }): INeuroVec {
    const inMemory = this.toInMemory();
    return inMemory.detrend(method, options);
  }

  temporalFilter(filter: TemporalFilter): INeuroVec {
    const inMemory = this.toInMemory();
    return inMemory.temporalFilter(filter);
  }

  convolve(kernel: number[]): INeuroVec {
    const inMemory = this.toInMemory();
    return inMemory.convolve(kernel);
  }

  temporalSmooth(sigma: number): INeuroVec {
    const inMemory = this.toInMemory();
    return inMemory.temporalSmooth(sigma);
  }

  temporalMean(): NeuroVol {
    // Implement directly to avoid loading all data
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const volumeSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      this.spacing.slice(0, 3),
      this.origin.slice(0, 3),
      this.space.axes
    );

    const meanData = new Float32Array(dimX * dimY * dimZ);
    
    // Accumulate sums
    for (let t = 0; t < dimT; t++) {
      const volData = this.getVolumeData(t);
      for (let i = 0; i < volData.length; i++) {
        meanData[i] += volData[i];
      }
    }

    // Divide by time points
    for (let i = 0; i < meanData.length; i++) {
      meanData[i] /= dimT;
    }

    return new FloatNeuroVol(volumeSpace, meanData);
  }

  temporalStd(): NeuroVol {
    // Implement using two-pass algorithm
    const mean = this.temporalMean();
    const meanData = (mean as FloatNeuroVol).getData();
    
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const volumeSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      this.spacing.slice(0, 3),
      this.origin.slice(0, 3),
      this.space.axes
    );

    const varData = new Float32Array(dimX * dimY * dimZ);
    
    // Accumulate squared differences
    for (let t = 0; t < dimT; t++) {
      const volData = this.getVolumeData(t);
      for (let i = 0; i < volData.length; i++) {
        const diff = volData[i] - meanData[i];
        varData[i] += diff * diff;
      }
    }

    // Convert to standard deviation
    for (let i = 0; i < varData.length; i++) {
      varData[i] = Math.sqrt(varData[i] / (dimT - 1));
    }

    return new FloatNeuroVol(volumeSpace, varData);
  }

  temporalMin(): NeuroVol {
    return this.temporalReduce((values) => Math.min(...values));
  }

  temporalMax(): NeuroVol {
    return this.temporalReduce((values) => Math.max(...values));
  }

  temporalMedian(): NeuroVol {
    return this.temporalReduce((values) => {
      const sorted = values.sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 
        ? sorted[mid] 
        : (sorted[mid - 1] + sorted[mid]) / 2;
    });
  }

  temporalCorrelation(seed: [number, number, number]): NeuroVol {
    const inMemory = this.toInMemory();
    return inMemory.temporalCorrelation(seed);
  }

  temporalCorrelationMap(seedVol: NeuroVol): INeuroVec {
    throw new Error('temporalCorrelationMap not yet implemented');
  }

  zscore(): INeuroVec {
    const inMemory = this.toInMemory();
    return inMemory.zscore();
  }

  percentSignalChange(baseline?: number[]): INeuroVec {
    const inMemory = this.toInMemory();
    return inMemory.percentSignalChange(baseline);
  }

  clone(): INeuroVec {
    return new FileBackedNeuroVec(this.space, this.dataGetter, {
      maxCacheSize: this.maxCacheSize,
      dataSetter: this.dataSetter
    });
  }

  slice(startTime: number, endTime: number): INeuroVec {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (startTime < 0 || endTime > dimT || startTime >= endTime) {
      throw new Error('Invalid time range for slice');
    }

    const newDimT = endTime - startTime;
    const newSpace = new NeuroSpace(
      [dimX, dimY, dimZ, newDimT],
      this.spacing,
      this.origin,
      this.space.axes
    );

    // Create new data getter that adjusts time indices
    const slicedGetter = (t: number) => {
      return this.dataGetter(startTime + t);
    };

    const slicedSetter = this.dataSetter ? (t: number, data: Float32Array) => {
      this.dataSetter!(startTime + t, data);
    } : undefined;

    return new FileBackedNeuroVec(newSpace, slicedGetter, {
      maxCacheSize: this.maxCacheSize,
      dataSetter: slicedSetter
    });
  }

  concatenate(other: INeuroVec): INeuroVec {
    // For file-backed, concatenation creates a new in-memory vec
    const inMemory = this.toInMemory();
    return inMemory.concatenate(other);
  }

  // Private helper methods

  private getVolumeData(t: number): Float32Array {
    // Check cache first
    const cached = this.cache.get(t);
    if (cached) {
      cached.lastAccess = this.accessCounter++;
      return cached.data;
    }

    // Load from file
    const data = this.dataGetter(t);
    
    // Add to cache
    this.cache.set(t, {
      timeIndex: t,
      data: data,
      lastAccess: this.accessCounter++
    });

    // Evict old entries if cache is full
    if (this.cache.size > this.maxCacheSize) {
      this.evictOldest();
    }

    return data;
  }

  private evictOldest(): void {
    let oldestTime = -1;
    let oldestAccess = Number.MAX_SAFE_INTEGER;

    for (const [time, entry] of this.cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestTime = time;
      }
    }

    if (oldestTime >= 0) {
      this.cache.delete(oldestTime);
    }
  }

  private temporalReduce(reducer: (values: number[]) => number): NeuroVol {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const volumeSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      this.spacing.slice(0, 3),
      this.origin.slice(0, 3),
      this.space.axes
    );

    const resultData = new Float32Array(dimX * dimY * dimZ);
    const voxelSize = dimX * dimY * dimZ;

    // Collect values for each voxel across time
    for (let idx = 0; idx < voxelSize; idx++) {
      const values: number[] = [];
      
      for (let t = 0; t < dimT; t++) {
        const volData = this.getVolumeData(t);
        values.push(volData[idx]);
      }

      resultData[idx] = reducer(values);
    }

    return new FloatNeuroVol(volumeSpace, resultData);
  }

  private toInMemory(): EnhancedFloat32NeuroVec {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const totalSize = dimX * dimY * dimZ * dimT;
    const data = new Float32Array(totalSize);

    // Load all volumes
    const volumeSize = dimX * dimY * dimZ;
    for (let t = 0; t < dimT; t++) {
      const volData = this.getVolumeData(t);
      data.set(volData, t * volumeSize);
    }

    return new EnhancedFloat32NeuroVec(this.space, data);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.accessCounter = 0;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hitRate: 0 // TODO: Track hits/misses
    };
  }
}