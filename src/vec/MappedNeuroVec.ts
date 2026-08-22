/**
 * Memory-mapped NeuroVec for efficient large dataset access
 * Uses ArrayBuffer and DataView for direct memory access patterns
 */

import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { INeuroVec, DetrendMethod, TemporalFilter } from './INeuroVec';
import { EnhancedFloat32NeuroVec } from './EnhancedNeuroVec';
import { seriesMin, seriesMax, seriesMedian } from './temporalOps';

/**
 * Options for memory-mapped access
 */
export interface MappedNeuroVecOptions {
  dtype?: 'float32' | 'float64' | 'int16' | 'uint8';
  byteOffset?: number;
  littleEndian?: boolean;
}

/**
 * Memory-mapped NeuroVec that provides efficient access to large datasets
 * Uses ArrayBuffer for zero-copy operations where possible
 */
export class MappedNeuroVec implements INeuroVec {
  readonly space: NeuroSpace;
  private buffer: ArrayBufferLike;
  private view: DataView;
  private dtype: 'float32' | 'float64' | 'int16' | 'uint8';
  private bytesPerElement: number;
  private littleEndian: boolean;
  private volumeSize: number;

  constructor(
    space: NeuroSpace,
    buffer: ArrayBufferLike,
    options: MappedNeuroVecOptions = {}
  ) {
    if (space.dim.length !== 4) {
      throw new Error('MappedNeuroVec requires a 4D NeuroSpace');
    }

    this.space = space;
    this.buffer = buffer;
    this.dtype = options.dtype || 'float32';
    this.littleEndian = options.littleEndian ?? true;
    
    // Set bytes per element based on dtype
    switch (this.dtype) {
      case 'float32':
        this.bytesPerElement = 4;
        break;
      case 'float64':
        this.bytesPerElement = 8;
        break;
      case 'int16':
        this.bytesPerElement = 2;
        break;
      case 'uint8':
        this.bytesPerElement = 1;
        break;
    }

    const byteOffset = options.byteOffset || 0;
    this.view = new DataView(buffer, byteOffset);
    
    const [dimX, dimY, dimZ] = space.dim;
    this.volumeSize = dimX * dimY * dimZ;

    // Verify buffer size
    const expectedSize = this.length * this.bytesPerElement;
    if (this.view.byteLength < expectedSize) {
      throw new Error(`Buffer too small. Expected ${expectedSize} bytes, got ${this.view.byteLength}`);
    }
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

  getData(): ArrayBufferLike {
    return this.buffer;
  }

  getRange(): [number, number] {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < this.length; i++) {
      const value = this.getValueAt(i);
      if (value < min) min = value;
      if (value > max) max = value;
    }

    return [min, max];
  }

  getAt(i: number, j: number, k: number, t: number): number {
    const index = this.getLinearIndex(i, j, k, t);
    return this.getValueAt(index);
  }

  setAt(i: number, j: number, k: number, t: number, value: number): void {
    const index = this.getLinearIndex(i, j, k, t);
    this.setValueAt(index, value);
  }

  getVolume(t: number): NeuroVol {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (t < 0 || t >= dimT) {
      throw new Error('Time index out of bounds');
    }

    // Create a view of the specific volume
    const volumeData = new Float32Array(this.volumeSize);
    const startIndex = t * this.volumeSize;

    for (let i = 0; i < this.volumeSize; i++) {
      volumeData[i] = this.getValueAt(startIndex + i);
    }

    const volumeSpace = this.space.withDimensions([dimX, dimY, dimZ]);

    return new FloatNeuroVol(volumeSpace, volumeData);
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
      const index = voxelIndex + t * this.volumeSize;
      series[t] = this.getValueAt(index);
    }

    return series;
  }

  setTimeSeries(i: number, j: number, k: number, data: Float32Array): void {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (data.length !== dimT) {
      throw new Error(`Time series length ${data.length} does not match time dimension ${dimT}`);
    }

    const voxelIndex = i + j * dimX + k * dimX * dimY;

    for (let t = 0; t < dimT; t++) {
      const index = voxelIndex + t * this.volumeSize;
      this.setValueAt(index, data[t]);
    }
  }

  // Time series operations - convert to in-memory for processing
  
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
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const volumeSpace = this.space.withDimensions([dimX, dimY, dimZ]);

    const meanData = new Float32Array(this.volumeSize);
    
    // Calculate mean for each voxel
    for (let idx = 0; idx < this.volumeSize; idx++) {
      let sum = 0;
      for (let t = 0; t < dimT; t++) {
        sum += this.getValueAt(idx + t * this.volumeSize);
      }
      meanData[idx] = sum / dimT;
    }

    return new FloatNeuroVol(volumeSpace, meanData);
  }

  temporalStd(): NeuroVol {
    const mean = this.temporalMean();
    const meanData = (mean as FloatNeuroVol).getData();
    
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const volumeSpace = this.space.withDimensions([dimX, dimY, dimZ]);

    const stdData = new Float32Array(this.volumeSize);
    
    // Calculate variance for each voxel
    for (let idx = 0; idx < this.volumeSize; idx++) {
      let sumSq = 0;
      for (let t = 0; t < dimT; t++) {
        const diff = this.getValueAt(idx + t * this.volumeSize) - meanData[idx];
        sumSq += diff * diff;
      }
      stdData[idx] = Math.sqrt(sumSq / (dimT - 1));
    }

    return new FloatNeuroVol(volumeSpace, stdData);
  }

  temporalMin(): NeuroVol {
    return this.temporalReduce((values) => seriesMin(values));
  }

  temporalMax(): NeuroVol {
    return this.temporalReduce((values) => seriesMax(values));
  }

  temporalMedian(): NeuroVol {
    return this.temporalReduce((values) => seriesMedian(values));
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
    // Create a copy of the buffer
    const newBuffer = this.buffer.slice(0);
    return new MappedNeuroVec(this.space, newBuffer, {
      dtype: this.dtype,
      littleEndian: this.littleEndian
    });
  }

  slice(startTime: number, endTime: number): INeuroVec {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (startTime < 0 || endTime > dimT || startTime >= endTime) {
      throw new Error('Invalid time range for slice');
    }

    const newDimT = endTime - startTime;
    const newSpace = this.space.withDimensions([dimX, dimY, dimZ, newDimT]);

    // Create new buffer for sliced data
    const newLength = this.volumeSize * newDimT;
    const newBuffer = new ArrayBuffer(newLength * this.bytesPerElement);
    const sliced = new MappedNeuroVec(newSpace, newBuffer, {
      dtype: this.dtype,
      littleEndian: this.littleEndian
    });

    // Copy relevant data
    for (let t = 0; t < newDimT; t++) {
      for (let idx = 0; idx < this.volumeSize; idx++) {
        const srcIndex = idx + (startTime + t) * this.volumeSize;
        const dstIndex = idx + t * this.volumeSize;
        sliced.setValueAt(dstIndex, this.getValueAt(srcIndex));
      }
    }

    return sliced;
  }

  concatenate(other: INeuroVec): INeuroVec {
    const inMemory = this.toInMemory();
    return inMemory.concatenate(other);
  }

  // Private helper methods

  private getLinearIndex(i: number, j: number, k: number, t: number): number {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    
    if (i < 0 || i >= dimX || j < 0 || j >= dimY || 
        k < 0 || k >= dimZ || t < 0 || t >= dimT) {
      throw new Error('Coordinates out of bounds');
    }

    return i + j * dimX + k * dimX * dimY + t * this.volumeSize;
  }

  private getValueAt(index: number): number {
    const byteOffset = index * this.bytesPerElement;

    switch (this.dtype) {
      case 'float32':
        return this.view.getFloat32(byteOffset, this.littleEndian);
      case 'float64':
        return this.view.getFloat64(byteOffset, this.littleEndian);
      case 'int16':
        return this.view.getInt16(byteOffset, this.littleEndian);
      case 'uint8':
        return this.view.getUint8(byteOffset);
      default:
        throw new Error(`Unsupported dtype: ${this.dtype}`);
    }
  }

  private setValueAt(index: number, value: number): void {
    const byteOffset = index * this.bytesPerElement;

    switch (this.dtype) {
      case 'float32':
        this.view.setFloat32(byteOffset, value, this.littleEndian);
        break;
      case 'float64':
        this.view.setFloat64(byteOffset, value, this.littleEndian);
        break;
      case 'int16':
        this.view.setInt16(byteOffset, value, this.littleEndian);
        break;
      case 'uint8':
        this.view.setUint8(byteOffset, value);
        break;
    }
  }

  private temporalReduce(reducer: (values: number[]) => number): NeuroVol {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    const volumeSpace = this.space.withDimensions([dimX, dimY, dimZ]);

    const resultData = new Float32Array(this.volumeSize);

    for (let idx = 0; idx < this.volumeSize; idx++) {
      const values: number[] = [];
      
      for (let t = 0; t < dimT; t++) {
        values.push(this.getValueAt(idx + t * this.volumeSize));
      }

      resultData[idx] = reducer(values);
    }

    return new FloatNeuroVol(volumeSpace, resultData);
  }

  private toInMemory(): EnhancedFloat32NeuroVec {
    const data = new Float32Array(this.length);
    
    for (let i = 0; i < this.length; i++) {
      data[i] = this.getValueAt(i);
    }

    return new EnhancedFloat32NeuroVec(this.space, data);
  }

  /**
   * Create a MappedNeuroVec from a typed array
   */
  static fromTypedArray(
    space: NeuroSpace,
    data: Float32Array | Float64Array | Int16Array | Uint8Array
  ): MappedNeuroVec {
    let dtype: 'float32' | 'float64' | 'int16' | 'uint8';
    
    if (data instanceof Float32Array) {
      dtype = 'float32';
    } else if (data instanceof Float64Array) {
      dtype = 'float64';
    } else if (data instanceof Int16Array) {
      dtype = 'int16';
    } else if (data instanceof Uint8Array) {
      dtype = 'uint8';
    } else {
      throw new Error('Unsupported typed array type');
    }

    return new MappedNeuroVec(space, data.buffer, {
      dtype,
      byteOffset: data.byteOffset,
      littleEndian: true
    });
  }
}
