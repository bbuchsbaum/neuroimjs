// Import necessary types and interfaces
import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';
import { TypedArray, NumericType } from '../types';
import { FloatNeuroVol, Int16NeuroVol, UInt8NeuroVol, Float64NeuroVol } from '../volume/DenseNeuroVol';

/**
 * Interface for 4D neuroimaging data (NeuroVec).
 */
export interface NeuroVec<TData = TypedArray> {
  readonly space: NeuroSpace;
  readonly length: number;
  readonly dim: number[];    // Should have 4 dimensions
  readonly spacing: number[];
  readonly origin: number[];

  getAt(i: number, j: number, k: number, t: number): number;
  setAt(i: number, j: number, k: number, t: number, value: number): void;
  getVolume(t: number): NeuroVol;
  getSeries(i: number, j: number, k: number): number[];
  getData(): TData;
  getRange(): [number, number];
}

/**
 * Abstract class for dense 4D neuroimaging data.
 * Implements the NeuroVec interface.
 */
export abstract class DenseNeuroVec<TArray extends TypedArray, TVol extends NeuroVol>
  implements NeuroVec<TArray> {
  readonly space: NeuroSpace;
  protected data: TArray;

  constructor(space: NeuroSpace, data?: TArray) {
    if (!(space instanceof NeuroSpace)) {
      throw new TypeError('space must be an instance of NeuroSpace');
    }
    if (space.dim.length !== 4) {
      throw new Error('NeuroVec requires a 4D NeuroSpace.');
    }
    this.space = space;
    if (data && data.length !== this.length) {
      throw new Error(`Data length mismatch: expected ${this.length}, got ${data.length}`);
    }
    this.data = data ?? this.createDataArray();
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

  getData(): TArray {
    return this.data;
  }

  getAt(i: number, j: number, k: number, t: number): number {
    const index = this.getLinearIndex(i, j, k, t);
    return this.data[index];
  }

  setAt(i: number, j: number, k: number, t: number, value: number): void {
    const index = this.getLinearIndex(i, j, k, t);
    this.data[index] = value;
  }

  /**
   * Retrieves the time series at voxel (i, j, k).
   */
  getSeries(i: number, j: number, k: number): number[] {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    if (i < 0 || i >= dimX || j < 0 || j >= dimY || k < 0 || k >= dimZ) {
      throw new Error('Coordinates out of bounds.');
    }

    const volumeSize = dimX * dimY * dimZ;
    const voxelIndex = i + j * dimX + k * dimX * dimY;

    const series = [];
    for (let t = 0; t < dimT; t++) {
      series.push(this.data[voxelIndex + t * volumeSize]);
    }
    return series;
  }

  /**
   * Retrieves the volume at time t.
   */
  getVolume(t: number): TVol {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    if (t < 0 || t >= dimT) {
      throw new Error('Time index out of bounds.');
    }
    const volumeLength = dimX * dimY * dimZ;
    const offset = t * volumeLength;
    const volumeData = this.data.subarray(offset, offset + volumeLength);

    const volumeSpace = this.space.withDimensions([dimX, dimY, dimZ]);

    return new (this.getVolumeConstructor())(volumeSpace, volumeData as TArray);
  }

  /**
   * Returns the minimum and maximum values across all data.
   */
  getRange(): [number, number] {
    const data = this.data;
    if (data.length === 0) {
      throw new Error('Volume data is empty');
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (let i = 0, len = data.length; i < len; i++) {
      const value = data[i];
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error('No valid numeric data found in volume');
    }

    return [min, max];
  }

  // Helper method to calculate linear index
  private getLinearIndex(i: number, j: number, k: number, t: number): number {
    const [dimX, dimY, dimZ, dimT] = this.space.dim;
    if (
      i < 0 || i >= dimX ||
      j < 0 || j >= dimY ||
      k < 0 || k >= dimZ ||
      t < 0 || t >= dimT
    ) {
      throw new Error('Coordinates out of bounds.');
    }
    const volumeSize = dimX * dimY * dimZ;
    return i + j * dimX + k * dimX * dimY + t * volumeSize;
  }

  // Abstract methods that subclasses need to implement
  protected abstract getDataConstructor(): new (length: number) => TArray;
  protected abstract getTypedArrayType(): NumericType;
  protected abstract getVolumeConstructor(): new (space: NeuroSpace, data: TArray) => TVol;

  // Creates a new data array of the appropriate type
  protected createDataArray(): TArray {
    return new (this.getDataConstructor())(this.length);
  }
}

/**
 * Implementing concrete DenseNeuroVec classes for different data types.
 */

// For Float32
export class Float32NeuroVec extends DenseNeuroVec<Float32Array, FloatNeuroVol> {
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
}

// For Int16
export class Int16NeuroVec extends DenseNeuroVec<Int16Array, Int16NeuroVol> {
  constructor(space: NeuroSpace, data?: Int16Array) {
    super(space, data);
  }

  protected getDataConstructor(): new (length: number) => Int16Array {
    return Int16Array;
  }

  protected getTypedArrayType(): 'int16' {
    return 'int16';
  }

  protected getVolumeConstructor(): new (space: NeuroSpace, data: Int16Array) => Int16NeuroVol {
    return Int16NeuroVol;
  }
}

// For Uint8
export class Uint8NeuroVec extends DenseNeuroVec<Uint8Array, UInt8NeuroVol> {
  constructor(space: NeuroSpace, data?: Uint8Array) {
    super(space, data);
  }

  setAt(i: number, j: number, k: number, t: number, value: number): void {
    if (value < 0 || value > 255) {
      throw new Error('Value must be between 0 and 255 for Uint8 data');
    }
    super.setAt(i, j, k, t, value);
  }

  protected getDataConstructor(): new (length: number) => Uint8Array {
    return Uint8Array;
  }

  protected getTypedArrayType(): 'uint8' {
    return 'uint8';
  }

  protected getVolumeConstructor(): new (space: NeuroSpace, data: Uint8Array) => UInt8NeuroVol {
    return UInt8NeuroVol;
  }
}

// For Float64
export class Float64NeuroVec extends DenseNeuroVec<Float64Array, Float64NeuroVol> {
  constructor(space: NeuroSpace, data?: Float64Array) {
    super(space, data);
  }

  protected getDataConstructor(): new (length: number) => Float64Array {
    return Float64Array;
  }

  protected getTypedArrayType(): 'float64' {
    return 'float64';
  }

  protected getVolumeConstructor(): new (space: NeuroSpace, data: Float64Array) => Float64NeuroVol {
    return Float64NeuroVol;
  }
}
