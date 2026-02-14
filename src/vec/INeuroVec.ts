/**
 * Enhanced interface for 4D neuroimaging data with time series operations
 */

import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';

/**
 * Detrending methods for time series data
 */
export type DetrendMethod = 'linear' | 'polynomial' | 'mean';

/**
 * Filter types for temporal filtering
 */
export interface TemporalFilter {
  lowFreq?: number;  // Low frequency cutoff (Hz)
  highFreq?: number; // High frequency cutoff (Hz)
  tr?: number;       // Repetition time (seconds)
}

/**
 * Enhanced NeuroVec interface with time series operations
 */
export interface INeuroVec {
  // Basic properties
  readonly space: NeuroSpace;
  readonly length: number;
  readonly dim: number[];    // Should have 4 dimensions [x, y, z, t]
  readonly spacing: number[];
  readonly origin: number[];

  // Basic access methods
  getAt(i: number, j: number, k: number, t: number): number;
  setAt(i: number, j: number, k: number, t: number, value: number): void;
  getVolume(t: number): NeuroVol;
  getData(): any;
  getRange(): [number, number];

  // Enhanced time series access
  getTimeSeries(i: number, j: number, k: number): Float32Array;
  setTimeSeries(i: number, j: number, k: number, data: Float32Array): void;
  getSeries(i: number, j: number, k: number): number[]; // Legacy method

  // Time series operations
  detrend(method: DetrendMethod, options?: { order?: number }): INeuroVec;
  temporalFilter(filter: TemporalFilter): INeuroVec;
  convolve(kernel: number[]): INeuroVec;
  temporalSmooth(sigma: number): INeuroVec;

  // Temporal statistics
  temporalMean(): NeuroVol;
  temporalStd(): NeuroVol;
  temporalMin(): NeuroVol;
  temporalMax(): NeuroVol;
  temporalMedian(): NeuroVol;
  
  // Correlation operations
  temporalCorrelation(seed: [number, number, number]): NeuroVol;
  temporalCorrelationMap(seedVol: NeuroVol): INeuroVec;
  
  // Transformations
  zscore(): INeuroVec;
  percentSignalChange(baseline?: number[]): INeuroVec;
  
  // Utility methods
  clone(): INeuroVec;
  slice(startTime: number, endTime: number): INeuroVec;
  concatenate(other: INeuroVec): INeuroVec;
}

/**
 * Options for creating NeuroVec instances
 */
export interface NeuroVecOptions {
  dtype?: 'float32' | 'float64' | 'int16' | 'uint8';
  lazy?: boolean;
  chunked?: boolean;
  chunkSize?: number;
}