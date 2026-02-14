/**
 * Enhanced DenseNeuroVec with time series operations
 */

import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';
import { TypedArray, NumericType } from '../types';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { INeuroVec, DetrendMethod, TemporalFilter } from './INeuroVec';
import { DenseNeuroVec } from './NeuroVec';

/**
 * Enhanced abstract class for dense 4D neuroimaging data with time series operations
 */
export abstract class EnhancedDenseNeuroVec<TArray extends TypedArray, TVol extends NeuroVol> 
  extends DenseNeuroVec<TArray, TVol> 
  implements INeuroVec {

  /**
   * Get time series as Float32Array for efficient operations
   */
  getTimeSeries(i: number, j: number, k: number): Float32Array {
    const series = this.getSeries(i, j, k);
    return new Float32Array(series);
  }

  /**
   * Set time series data for a voxel
   */
  setTimeSeries(i: number, j: number, k: number, data: Float32Array): void {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    if (data.length !== dimT) {
      throw new Error(`Time series length ${data.length} does not match time dimension ${dimT}`);
    }

    for (let t = 0; t < dimT; t++) {
      this.setAt(i, j, k, t, data[t]);
    }
  }

  /**
   * Detrend the time series data
   */
  detrend(method: DetrendMethod, options?: { order?: number }): INeuroVec {
    const result = this.clone();
    const [dimX, dimY, dimZ, dimT] = this.space.dim;

    for (let i = 0; i < dimX; i++) {
      for (let j = 0; j < dimY; j++) {
        for (let k = 0; k < dimZ; k++) {
          const series = this.getTimeSeries(i, j, k);
          const detrended = this.detrendSeries(series, method, options);
          result.setTimeSeries(i, j, k, detrended);
        }
      }
    }

    return result;
  }

  /**
   * Apply temporal filter to the data
   */
  temporalFilter(filter: TemporalFilter): INeuroVec {
    const result = this.clone();
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const tr = filter.tr || 2.0; // Default TR of 2 seconds

    for (let i = 0; i < dimX; i++) {
      for (let j = 0; j < dimY; j++) {
        for (let k = 0; k < dimZ; k++) {
          const series = this.getTimeSeries(i, j, k);
          const filtered = this.filterSeries(series, filter.lowFreq, filter.highFreq, tr);
          result.setTimeSeries(i, j, k, filtered);
        }
      }
    }

    return result;
  }

  /**
   * Convolve time series with a kernel
   */
  convolve(kernel: number[]): INeuroVec {
    const result = this.clone();
    const [dimX, dimY, dimZ] = this.space.dim;

    for (let i = 0; i < dimX; i++) {
      for (let j = 0; j < dimY; j++) {
        for (let k = 0; k < dimZ; k++) {
          const series = this.getTimeSeries(i, j, k);
          const convolved = this.convolveSeries(series, kernel);
          result.setTimeSeries(i, j, k, convolved);
        }
      }
    }

    return result;
  }

  /**
   * Apply temporal smoothing with Gaussian kernel
   */
  temporalSmooth(sigma: number): INeuroVec {
    const kernel = this.gaussianKernel(sigma);
    return this.convolve(kernel);
  }

  /**
   * Calculate temporal mean across time
   */
  temporalMean(): NeuroVol {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const volumeSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      this.spacing.slice(0, 3),
      this.origin.slice(0, 3),
      this.space.axes
    );

    const meanData = new Float32Array(dimX * dimY * dimZ);
    let idx = 0;

    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          const series = this.getTimeSeries(i, j, k);
          meanData[idx++] = this.mean(series);
        }
      }
    }

    return new FloatNeuroVol(volumeSpace, meanData);
  }

  /**
   * Calculate temporal standard deviation
   */
  temporalStd(): NeuroVol {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const volumeSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      this.spacing.slice(0, 3),
      this.origin.slice(0, 3),
      this.space.axes
    );

    const stdData = new Float32Array(dimX * dimY * dimZ);
    let idx = 0;

    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          const series = this.getTimeSeries(i, j, k);
          stdData[idx++] = this.std(series);
        }
      }
    }

    return new FloatNeuroVol(volumeSpace, stdData);
  }

  /**
   * Calculate temporal minimum
   */
  temporalMin(): NeuroVol {
    return this.temporalReduce((series) => Math.min(...series));
  }

  /**
   * Calculate temporal maximum
   */
  temporalMax(): NeuroVol {
    return this.temporalReduce((series) => Math.max(...series));
  }

  /**
   * Calculate temporal median
   */
  temporalMedian(): NeuroVol {
    return this.temporalReduce((series) => this.median(series));
  }

  /**
   * Calculate temporal correlation with a seed voxel
   */
  temporalCorrelation(seed: [number, number, number]): NeuroVol {
    const [seedX, seedY, seedZ] = seed;
    const seedSeries = this.getTimeSeries(seedX, seedY, seedZ);
    const seedMean = this.mean(seedSeries);
    const seedStd = this.std(seedSeries);

    const [dimX, dimY, dimZ] = this.space.dim;
    const volumeSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      this.spacing.slice(0, 3),
      this.origin.slice(0, 3),
      this.space.axes
    );

    const corrData = new Float32Array(dimX * dimY * dimZ);
    let idx = 0;

    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          const series = this.getTimeSeries(i, j, k);
          corrData[idx++] = this.pearsonCorrelation(seedSeries, series, seedMean, seedStd);
        }
      }
    }

    return new FloatNeuroVol(volumeSpace, corrData);
  }

  /**
   * Calculate correlation map for multiple seeds
   */
  temporalCorrelationMap(seedVol: NeuroVol): INeuroVec {
    throw new Error('temporalCorrelationMap not yet implemented');
  }

  /**
   * Z-score normalize the time series
   */
  zscore(): INeuroVec {
    const result = this.clone();
    const [dimX, dimY, dimZ] = this.space.dim;

    for (let i = 0; i < dimX; i++) {
      for (let j = 0; j < dimY; j++) {
        for (let k = 0; k < dimZ; k++) {
          const series = this.getTimeSeries(i, j, k);
          const mean = this.mean(series);
          const std = this.std(series);
          
          if (std > 0) {
            const zscored = series.map(v => (v - mean) / std);
            result.setTimeSeries(i, j, k, new Float32Array(zscored));
          }
        }
      }
    }

    return result;
  }

  /**
   * Calculate percent signal change
   */
  percentSignalChange(baseline?: number[]): INeuroVec {
    const result = this.clone();
    const [dimX, dimY, dimZ, dimT] = this.space.dim;

    // Default baseline is first 10% of time points
    const baselineIndices = baseline || Array.from(
      { length: Math.floor(dimT * 0.1) }, 
      (_, i) => i
    );

    for (let i = 0; i < dimX; i++) {
      for (let j = 0; j < dimY; j++) {
        for (let k = 0; k < dimZ; k++) {
          const series = this.getTimeSeries(i, j, k);
          const baselineMean = this.meanSubset(series, baselineIndices);
          
          if (baselineMean > 0) {
            const psc = series.map(v => ((v - baselineMean) / baselineMean) * 100);
            result.setTimeSeries(i, j, k, new Float32Array(psc));
          }
        }
      }
    }

    return result;
  }

  /**
   * Clone the NeuroVec
   */
  abstract clone(): INeuroVec;

  /**
   * Extract a time slice
   */
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

    const SlicedClass = this.constructor as any;
    const sliced = new SlicedClass(newSpace);

    for (let i = 0; i < dimX; i++) {
      for (let j = 0; j < dimY; j++) {
        for (let k = 0; k < dimZ; k++) {
          const series = this.getTimeSeries(i, j, k);
          const slicedSeries = series.slice(startTime, endTime);
          sliced.setTimeSeries(i, j, k, slicedSeries);
        }
      }
    }

    return sliced;
  }

  /**
   * Concatenate with another NeuroVec
   */
  concatenate(other: INeuroVec): INeuroVec {
    const [dimX, dimY, dimZ, dimT1] = this.space.dim;
    const [otherX, otherY, otherZ, dimT2] = other.dim;

    if (dimX !== otherX || dimY !== otherY || dimZ !== otherZ) {
      throw new Error('Spatial dimensions must match for concatenation');
    }

    const newSpace = new NeuroSpace(
      [dimX, dimY, dimZ, dimT1 + dimT2],
      this.spacing,
      this.origin,
      this.space.axes
    );

    const ConcatClass = this.constructor as any;
    const concatenated = new ConcatClass(newSpace);

    // Copy this data
    for (let t = 0; t < dimT1; t++) {
      const vol = this.getVolume(t);
      for (let k = 0; k < dimZ; k++) {
        for (let j = 0; j < dimY; j++) {
          for (let i = 0; i < dimX; i++) {
            concatenated.setAt(i, j, k, t, vol.getAt(i, j, k));
          }
        }
      }
    }

    // Copy other data
    for (let t = 0; t < dimT2; t++) {
      const vol = other.getVolume(t);
      for (let k = 0; k < dimZ; k++) {
        for (let j = 0; j < dimY; j++) {
          for (let i = 0; i < dimX; i++) {
            concatenated.setAt(i, j, k, dimT1 + t, vol.getAt(i, j, k));
          }
        }
      }
    }

    return concatenated;
  }

  // Helper methods

  private temporalReduce(reducer: (series: Float32Array) => number): NeuroVol {
    const [dimX, dimY, dimZ] = this.space.dim;
    const volumeSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      this.spacing.slice(0, 3),
      this.origin.slice(0, 3),
      this.space.axes
    );

    const data = new Float32Array(dimX * dimY * dimZ);
    let idx = 0;

    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          const series = this.getTimeSeries(i, j, k);
          data[idx++] = reducer(series);
        }
      }
    }

    return new FloatNeuroVol(volumeSpace, data);
  }

  private detrendSeries(series: Float32Array, method: DetrendMethod, options?: { order?: number }): Float32Array {
    const n = series.length;
    const detrended = new Float32Array(n);

    switch (method) {
      case 'mean': {
        const mean = this.mean(series);
        for (let i = 0; i < n; i++) {
          detrended[i] = series[i] - mean;
        }
        break;
      }
      case 'linear': {
        // Fit linear trend y = a + b*t
        const t = Array.from({ length: n }, (_, i) => i);
        const { slope, intercept } = this.linearRegression(t, Array.from(series));
        
        for (let i = 0; i < n; i++) {
          detrended[i] = series[i] - (intercept + slope * i);
        }
        break;
      }
      case 'polynomial': {
        const order = options?.order || 2;
        // TODO: Implement polynomial detrending
        throw new Error('Polynomial detrending not yet implemented');
      }
    }

    return detrended;
  }

  private filterSeries(series: Float32Array, lowFreq?: number, highFreq?: number, tr: number = 2.0): Float32Array {
    // Simple butterworth filter implementation
    // TODO: Implement proper frequency filtering
    console.warn('Temporal filtering not fully implemented, returning original series');
    return series;
  }

  private convolveSeries(series: Float32Array, kernel: number[]): Float32Array {
    const n = series.length;
    const k = kernel.length;
    const halfK = Math.floor(k / 2);
    const result = new Float32Array(n);

    // Normalize kernel
    const kernelSum = kernel.reduce((a, b) => a + b, 0);
    const normalizedKernel = kernel.map(v => v / kernelSum);

    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < k; j++) {
        const idx = i - halfK + j;
        if (idx >= 0 && idx < n) {
          sum += series[idx] * normalizedKernel[j];
        }
      }
      result[i] = sum;
    }

    return result;
  }

  private gaussianKernel(sigma: number): number[] {
    const size = Math.ceil(sigma * 6) | 1; // Make it odd
    const kernel = new Array(size);
    const center = Math.floor(size / 2);
    let sum = 0;

    for (let i = 0; i < size; i++) {
      const x = i - center;
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      sum += kernel[i];
    }

    // Normalize
    return kernel.map(v => v / sum);
  }

  private mean(data: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / data.length;
  }

  private meanSubset(data: Float32Array, indices: number[]): number {
    let sum = 0;
    for (const idx of indices) {
      sum += data[idx];
    }
    return sum / indices.length;
  }

  private std(data: Float32Array): number {
    const m = this.mean(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const diff = data[i] - m;
      sum += diff * diff;
    }
    return Math.sqrt(sum / (data.length - 1));
  }

  private median(data: Float32Array): number {
    const sorted = Array.from(data).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 
      ? sorted[mid] 
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private pearsonCorrelation(x: Float32Array, y: Float32Array, xMean?: number, xStd?: number): number {
    const n = x.length;
    const meanX = xMean ?? this.mean(x);
    const meanY = this.mean(y);
    const stdX = xStd ?? this.std(x);
    const stdY = this.std(y);

    if (stdX === 0 || stdY === 0) return 0;

    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += (x[i] - meanX) * (y[i] - meanY);
    }

    return sum / ((n - 1) * stdX * stdY);
  }

  private linearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
    const n = x.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumXX += x[i] * x[i];
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }
}

/**
 * Enhanced Float32NeuroVec with time series operations
 */
export class EnhancedFloat32NeuroVec extends EnhancedDenseNeuroVec<Float32Array, FloatNeuroVol> {
  constructor(space: NeuroSpace, data?: Float32Array) {
    super(space, data);
  }

  protected getDataConstructor(): new (length: number) => Float32Array {
    return Float32Array;
  }

  protected getTypedArrayType(): 'float32' {
    return 'float32';
  }

  protected getVolumeConstructor(): new (space: NeuroSpace, data: Float32Array) => FloatNeuroVol {
    return FloatNeuroVol;
  }

  clone(): INeuroVec {
    return new EnhancedFloat32NeuroVec(this.space, new Float32Array(this.data));
  }
}