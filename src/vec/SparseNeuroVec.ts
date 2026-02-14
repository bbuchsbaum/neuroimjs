import { NeuroVec } from './NeuroVec';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { AxisSet3D } from '../geometry/Axis';

/**
 * SparseNeuroVec class representing a sparse 4D neuroimaging dataset.
 * Implements the NeuroVec interface.
 */
export class SparseNeuroVec implements NeuroVec {
  readonly space: NeuroSpace;
  private voxelData: Map<number, number[]>; // Maps voxel linear indices to time series data
  private defaultValue: number;

  /**
   * Constructs a SparseNeuroVec.
   * @param space NeuroSpace defining the dimensionality and transformations.
   * @param voxelData Map from linear voxel indices to arrays of time series data.
   * @param defaultValue The default value for missing voxels. Defaults to 0.
   */
  constructor(space: NeuroSpace, voxelData: Map<number, number[]>, defaultValue: number = 0) {
    if (space.dim.length !== 4) {
      throw new Error('NeuroVec requires a 4D NeuroSpace.');
    }
    this.space = space;
    this.voxelData = voxelData;
    this.defaultValue = defaultValue;
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

  getData(): Map<number, number[]> {
    return this.voxelData;
  }

  /**
   * Retrieves the value at the specified (i, j, k, t) coordinate.
   */
  getAt(i: number, j: number, k: number, t: number): number {
    const index = this.getLinearIndex(i, j, k);
    const series = this.voxelData.get(index);
    if (series && t >= 0 && t < series.length) {
      return series[t];
    } else {
      return this.defaultValue;
    }
  }

  /**
   * Sets the value at the specified (i, j, k, t) coordinate.
   */
  setAt(i: number, j: number, k: number, t: number, value: number): void {
    const index = this.getLinearIndex(i, j, k);
    let series = this.voxelData.get(index);
    if (!series) {
      const nt = this.dim[3];
      series = new Array(nt).fill(this.defaultValue);
      this.voxelData.set(index, series);
    }
    if (t < 0 || t >= series.length) {
      throw new Error('Time index out of bounds.');
    }
    series[t] = value;
  }

  /**
   * Retrieves the time series at voxel (i, j, k) as a number[].
   */
  getSeries(i: number, j: number, k: number): number[] {
    const index = this.getLinearIndex(i, j, k);
    const series = this.voxelData.get(index);
    if (series) {
      return series;
    } else {
      return new Array(this.dim[3]).fill(this.defaultValue);
    }
  }

  /**
   * Retrieves the volume at the specified time index.
   */
  getVolume(t: number): NeuroVol {
    const [dimX, dimY, dimZ, dimT] = this.dim;
    if (t < 0 || t >= dimT) {
      throw new Error('Time index out of bounds.');
    }

    const volumeLength = dimX * dimY * dimZ;
    const volData = new Float32Array(volumeLength);
    volData.fill(this.defaultValue);

    for (const [linearIdx, series] of this.voxelData.entries()) {
      if (t < series.length) {
        volData[linearIdx] = series[t];
      }
    }

    const volumeSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      this.space.spacing.slice(0, 3),
      this.space.origin.slice(0, 3),
      this.space.axes
    );

    return new FloatNeuroVol(volumeSpace, volData);
  }

  /**
   * Retrieves the minimum and maximum values across all data.
   */
  getRange(): [number, number] {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const series of this.voxelData.values()) {
      for (const value of series) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    if (min === Number.POSITIVE_INFINITY && max === Number.NEGATIVE_INFINITY) {
      // No data
      min = max = this.defaultValue;
    }
    return [min, max];
  }

  // Helper method to calculate linear index
  private getLinearIndex(i: number, j: number, k: number): number {
    const [dimX, dimY, dimZ] = this.space.dim.slice(0, 3);
    if (
      i < 0 || i >= dimX ||
      j < 0 || j >= dimY ||
      k < 0 || k >= dimZ
    ) {
      throw new Error('Coordinates out of bounds.');
    }
    return i + j * dimX + k * dimX * dimY;
  }
}