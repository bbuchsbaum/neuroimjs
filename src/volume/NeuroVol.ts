import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroSlice } from './NeuroSlice';
import { TypedArray, NumericType } from '../types';
import { AxisSet3D } from '../geometry/Axis';

/**
 * Interface for volumetric neuroimaging data.
 */
export interface NeuroVol {
  readonly space: NeuroSpace;
  readonly length: number;
  readonly dim: number[];
  readonly spacing: number[];
  readonly origin: number[];

  get(index: number): number;
  getAt(i: number, j: number, k: number): number;
  setAt(i: number, j: number, k: number, value: number): void;
  getSlice(zlevel: number, outAxes: AxisSet3D): NeuroSlice;
  getSliceAt(coord: number[], outAxes: AxisSet3D, interpolation: 'nearest' | 'trilinear'): NeuroSlice;

  // Method to get the underlying data as a TypedArray (for compatibility)
  getData(): TypedArray;
  /**
   * Replace the underlying data in-place without changing geometry.
   * Implementations should copy into the existing buffer to preserve view types.
   */
  setData(newData: TypedArray): void;

  getRange(): [number, number];

  // Abstract methods that concrete implementations need to provide
  getSliceTypedArrayType(): NumericType;
  
  getDataConstructor(): new (length: number) => TypedArray;
}
