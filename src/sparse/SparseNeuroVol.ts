import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';
import { TypedArray, NumericType } from '../types';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSlice } from '../volume/NeuroSlice';
import { createNeuroSlice } from '../volume/NeuroIm';
import { Matrix, inverse } from 'ml-matrix';
import { VoxelIterator, SagittalVoxelIterator, CoronalVoxelIterator } from '../volume/VoxelIterator';
import { extractSliceForView } from '../geometry/SliceHelpers';
import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { DenseNeuroVol } from '../volume/DenseNeuroVol';

/**
 * SparseNeuroVol class implements the NeuroVol interface and represents
 * a volumetric dataset where most of the data is the default value (e.g., zero).
 * It uses a Map to store only non-default values to save memory and improve efficiency.
 */
export class SparseNeuroVol implements NeuroVol {
  readonly space: NeuroSpace;
  private sparseData: Map<number, number>;
  private defaultValue: number;
  private dataType: NumericType;

  constructor(
    space: NeuroSpace,
    dataType: NumericType = 'float32',
    defaultValue: number = 0,
    indices?: number[],
    values?: number[]
  ) {
    this.space = space;
    this.dataType = dataType;
    this.defaultValue = defaultValue;
    this.sparseData = new Map<number, number>();

    if (indices && values) {
      if (indices.length !== values.length) {
        throw new Error('Indices and values arrays must have the same length');
      }
      for (let i = 0; i < indices.length; i++) {
        const value = values[i];
        if (value !== this.defaultValue) {
          this.sparseData.set(indices[i], value);
        }
      }
    }
  }

  get length(): number {
    return this.space.dim.reduce((acc, val) => acc * val, 1);
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

  getData(): TypedArray {
    const constructor = this.getDataConstructor();
    const fullData = new constructor(this.length);
    if (this.defaultValue !== 0) {
      fullData.fill(this.defaultValue);
    }
    for (const [index, value] of this.sparseData.entries()) {
      fullData[index] = value;
    }
    return fullData;
  }

  get(index: number): number {
    return this.sparseData.get(index) ?? this.defaultValue;
  }

  getAt(i: number, j: number, k: number): number {
    const index = this.coordToIndex(i, j, k);
    return this.sparseData.get(index) ?? this.defaultValue;
  }

  setAt(i: number, j: number, k: number, value: number): void {
    const index = this.coordToIndex(i, j, k);
    if (value !== this.defaultValue) {
      this.sparseData.set(index, value);
    } else {
      this.sparseData.delete(index);
    }
  }

  getRange(): [number, number] {
    if (this.sparseData.size === 0) {
      return [this.defaultValue, this.defaultValue];
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const value of this.sparseData.values()) {
      if (value < min) min = value;
      if (value > max) max = value;
    }

    if (this.defaultValue < min) min = this.defaultValue;
    if (this.defaultValue > max) max = this.defaultValue;

    return [min, max];
  }

  /**
   * Replace underlying data with a dense buffer. Rebuilds sparse map from non-zero entries.
   */
  setData(newData: TypedArray): void {
    if (newData.length !== this.length) {
      throw new Error(`Data length mismatch: expected ${this.length}, got ${newData.length}`);
    }
    this.sparseData.clear();
    const [nx, ny, nz] = this.space.dim;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = i + j * nx + k * nx * ny;
          const v = newData[idx];
          if (v !== this.defaultValue) {
            this.sparseData.set(idx, v);
          }
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    // Store new default range (no dedicated fields; derive via getRange later)
    if (!Number.isFinite(min)) {
      min = this.defaultValue;
    }
    if (!Number.isFinite(max)) {
      max = this.defaultValue;
    }
  }

  /**
   * Convert to a LogicalNeuroVol mask representation.
   * Creates a boolean mask based on non-zero voxels.
   */
  asLogical(): LogicalNeuroVol {
    const boolData = new Uint8Array(this.length);

    // Set default value for all voxels
    if (this.defaultValue !== 0) {
      boolData.fill(1);
    }

    // Set sparse values
    for (const [index, value] of this.sparseData.entries()) {
      boolData[index] = value !== 0 ? 1 : 0;
    }

    return new LogicalNeuroVol(this.space, boolData);
  }

  getSliceAt(
    coord: number[],
    outAxes: AxisSet3D,
    interpolation: 'nearest' | 'trilinear' = 'trilinear'
  ): NeuroSlice {
    const { space } = this;
    const reorientedSpace = space.reorient(outAxes);
    const transformMatrix = space.getTransformationMatrixTo(reorientedSpace);
    const coordHomogeneous = [...coord, 1];
    const transformedCoord = transformMatrix.mmul(Matrix.columnVector(coordHomogeneous)).to1DArray();
    const fixedAxisValue = transformedCoord[2];

    const [nx, ny] = [reorientedSpace.dim[0], reorientedSpace.dim[1]];
    const sliceData = new (this.getDataConstructor())(nx * ny);

    // Fill with default value if non-zero
    if (this.defaultValue !== 0) {
      sliceData.fill(this.defaultValue);
    }

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const sliceCoord = [i, j, fixedAxisValue, 1];
        const volCoordHomogeneous = space.getTransformationMatrixTo(space).mmul(Matrix.columnVector(sliceCoord)).to1DArray();
        const [x, y, z] = volCoordHomogeneous.slice(0, 3);

        let value = this.defaultValue;
        if (interpolation === 'nearest') {
          const xi = Math.round(x);
          const yj = Math.round(y);
          const zk = Math.round(z);
          if (
            xi >= 0 && xi < space.dim[0] &&
            yj >= 0 && yj < space.dim[1] &&
            zk >= 0 && zk < space.dim[2]
          ) {
            value = this.getAtSafe(xi, yj, zk);
          }
        } else if (interpolation === 'trilinear') {
          const xi = Math.floor(x);
          const yj = Math.floor(y);
          const zk = Math.floor(z);
          const xd = x - xi;
          const yd = y - yj;
          const zd = z - zk;

          if (
            xi >= 0 && xi + 1 < space.dim[0] &&
            yj >= 0 && yj + 1 < space.dim[1] &&
            zk >= 0 && zk + 1 < space.dim[2]
          ) {
            const v000 = this.getAtSafe(xi, yj, zk);
            const v001 = this.getAtSafe(xi, yj, zk + 1);
            const v010 = this.getAtSafe(xi, yj + 1, zk);
            const v011 = this.getAtSafe(xi, yj + 1, zk + 1);
            const v100 = this.getAtSafe(xi + 1, yj, zk);
            const v101 = this.getAtSafe(xi + 1, yj, zk + 1);
            const v110 = this.getAtSafe(xi + 1, yj + 1, zk);
            const v111 = this.getAtSafe(xi + 1, yj + 1, zk + 1);

            const c00 = v000 * (1 - xd) + v100 * xd;
            const c01 = v001 * (1 - xd) + v101 * xd;
            const c10 = v010 * (1 - xd) + v110 * xd;
            const c11 = v011 * (1 - xd) + v111 * xd;
            const c0 = c00 * (1 - yd) + c10 * yd;
            const c1 = c01 * (1 - yd) + c11 * yd;
            value = c0 * (1 - zd) + c1 * zd;
          }
        } else {
          throw new Error(`Unknown interpolation method: ${interpolation}`);
        }

        sliceData[j * nx + i] = value;
      }
    }

    // Create the 2D slice space by dropping the pinned axis
    const dropped = reorientedSpace.dropDim();
    if (!dropped) {
      throw new Error('Failed to create 2D slice space from reoriented space');
    }

    const slice = createNeuroSlice(
      this.dataType as 'float32' | 'uint8' | 'int16' | 'float64' | 'int32' | 'int8' | 'uint16',
      dropped as NeuroSpace,
      sliceData
    );
    return slice;
  }

  /**
   * Safe version of getAt that returns defaultValue for out-of-bounds coordinates
   * instead of throwing an error.
   */
  private getAtSafe(i: number, j: number, k: number): number {
    const { dim } = this.space;
    if (
      i < 0 || i >= dim[0] ||
      j < 0 || j >= dim[1] ||
      k < 0 || k >= dim[2]
    ) {
      return this.defaultValue;
    }
    const index = i + j * dim[0] + k * dim[0] * dim[1];
    return this.sparseData.get(index) ?? this.defaultValue;
  }

  getSlice(zlevel: number, outAxes: AxisSet3D): NeuroSlice {
    const reorientedSpace = this.space.reorient(outAxes);
    const trans = this.space.getPermutationMatrixTo(reorientedSpace.axes);
    const isIdentity = this.isIdentityMatrix(trans);

    const sliceDims = reorientedSpace.dim.slice();
    sliceDims[2] = 1;
    const [nx, ny] = sliceDims.slice(0, 2);
    const constructor = this.getDataConstructor();
    const sliceData = new constructor(nx * ny);
    if (this.defaultValue !== 0) {
      sliceData.fill(this.defaultValue);
    }

    if (isIdentity && zlevel >= 0 && zlevel < this.dim[2]) {

      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const i = x;
          const j = y;
          const k = zlevel;
          const index = x + y * nx;
          sliceData[index] = this.getAt(i, j, k);
        }
      }

      const slice = createNeuroSlice(
        this.dataType,
        extractSliceForView(reorientedSpace, zlevel, outAxes),
        sliceData
      );
      return slice;

    } else if (AxisSet3D.SAGITTAL_AIL.equals(reorientedSpace.axes)) {

      let index = 0;
      const voxelIterator = new SagittalVoxelIterator(this, zlevel);
      for (const voxel of voxelIterator) {
        const { sourceIndex3D, inBounds } = voxel;
        const value = inBounds
          ? this.getAt(sourceIndex3D[0], sourceIndex3D[1], sourceIndex3D[2])
          : this.defaultValue;
        sliceData[index++] = value;
      }

      const slice = createNeuroSlice(
        this.dataType,
        extractSliceForView(reorientedSpace, zlevel, outAxes),
        sliceData
      );
      return slice;

    } else {

      let index = 0;
      const voxelIterator = new VoxelIterator(this, reorientedSpace, zlevel);
      for (const voxel of voxelIterator) {
        const { sourceIndex3D, inBounds } = voxel;
        const value = inBounds
          ? this.getAt(sourceIndex3D[0], sourceIndex3D[1], sourceIndex3D[2])
          : this.defaultValue;
        sliceData[index++] = value;
      }

      const slice = createNeuroSlice(
        this.dataType,
        extractSliceForView(reorientedSpace, zlevel, outAxes),
        sliceData
      );
      return slice;
    }
  }

  getSliceTypedArrayType(): NumericType {
    return this.dataType;
  }

  getDataConstructor(): new (length: number) => TypedArray {
    switch (this.dataType) {
      case 'float32':
        return Float32Array;
      case 'float64':
        return Float64Array;
      case 'int32':
        return Int32Array;
      case 'int16':
        return Int16Array;
      case 'uint16':
        return Uint16Array;
      case 'int8':
        return Int8Array;
      case 'uint8':
        return Uint8Array;
      default:
        throw new Error(`Unsupported data type: ${this.dataType}`);
    }
  }

  private coordToIndex(i: number, j: number, k: number): number {
    const { dim } = this.space;
    if (
      i < 0 || i >= dim[0] ||
      j < 0 || j >= dim[1] ||
      k < 0 || k >= dim[2]
    ) {
      throw new Error(`Coordinates (${i}, ${j}, ${k}) are out of bounds`);
    }
    return i + j * dim[0] + k * dim[0] * dim[1];
  }

  get nonDefaultCount(): number {
    return this.sparseData.size;
  }

  get sparsityRatio(): number {
    return this.sparseData.size / this.length;
  }

  private isIdentityMatrix(matrix: Matrix): boolean {
    const size = matrix.rows;
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (i === j && matrix.get(i, j) !== 1) {
          return false;
        } else if (i !== j && matrix.get(i, j) !== 0) {
          return false;
        }
      }
    }
    return true;
  }

  // ============================================================
  // Static factory methods for creating SparseNeuroVol instances
  // ============================================================

  /**
   * Creates a SparseNeuroVol from coordinate arrays.
   *
   * @param space - The NeuroSpace defining the coordinate system
   * @param coords - Array of [i, j, k] voxel coordinates
   * @param values - Array of values for each coordinate (default: all 1s)
   * @param dataType - The numeric data type (default: 'float32')
   * @param defaultValue - The default value for non-specified voxels (default: 0)
   * @returns A new SparseNeuroVol instance
   */
  static fromCoords(
    space: NeuroSpace,
    coords: number[][],
    values?: number[],
    dataType: NumericType = 'float32',
    defaultValue: number = 0
  ): SparseNeuroVol {
    const indices = coords.map(coord => space.gridToIndex(coord));
    const actualValues = values ?? new Array(coords.length).fill(1);
    return new SparseNeuroVol(space, dataType, defaultValue, indices, actualValues);
  }

  /**
   * Creates a SparseNeuroVol from a LogicalNeuroVol (binary mask).
   *
   * @param mask - The LogicalNeuroVol mask
   * @param fillValue - The value to assign to true voxels (default: 1)
   * @param dataType - The numeric data type (default: 'float32')
   * @returns A new SparseNeuroVol instance
   */
  static fromMask(
    mask: LogicalNeuroVol,
    fillValue: number = 1,
    dataType: NumericType = 'float32'
  ): SparseNeuroVol {
    const coords = mask.getTrueCoords();
    const indices = coords.map(coord => mask.space.gridToIndex(coord));
    const values = new Array(indices.length).fill(fillValue);
    return new SparseNeuroVol(mask.space, dataType, 0, indices, values);
  }

  /**
   * Creates a SparseNeuroVol from a DenseNeuroVol by extracting non-zero values.
   * Useful for converting a dense volume with sparse data to a memory-efficient representation.
   *
   * @param vol - The DenseNeuroVol to convert
   * @param threshold - Values below this threshold are treated as default (default: 0)
   * @param dataType - The numeric data type (default: 'float32')
   * @returns A new SparseNeuroVol instance
   */
  static fromDense(
    vol: DenseNeuroVol,
    threshold: number = 0,
    dataType: NumericType = 'float32'
  ): SparseNeuroVol {
    const data = vol.getData();
    const indices: number[] = [];
    const values: number[] = [];

    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > threshold) {
        indices.push(i);
        values.push(data[i]);
      }
    }

    return new SparseNeuroVol(vol.space, dataType, 0, indices, values);
  }

  /**
   * Creates a SparseNeuroVol with a single point.
   * Useful for marking a single voxel location.
   *
   * @param space - The NeuroSpace defining the coordinate system
   * @param coord - The [i, j, k] coordinate of the point
   * @param value - The value at the point (default: 1)
   * @param dataType - The numeric data type (default: 'float32')
   * @returns A new SparseNeuroVol instance with a single point
   */
  static fromPoint(
    space: NeuroSpace,
    coord: number[],
    value: number = 1,
    dataType: NumericType = 'float32'
  ): SparseNeuroVol {
    const index = space.gridToIndex(coord);
    return new SparseNeuroVol(space, dataType, 0, [index], [value]);
  }

  /**
   * Creates a SparseNeuroVol representing a spherical region.
   *
   * @param space - The NeuroSpace defining the coordinate system
   * @param center - The center [i, j, k] coordinate
   * @param radius - The radius in voxel units
   * @param fillValue - The value to fill the sphere with (default: 1)
   * @param dataType - The numeric data type (default: 'float32')
   * @returns A new SparseNeuroVol instance
   */
  static fromSphere(
    space: NeuroSpace,
    center: number[],
    radius: number,
    fillValue: number = 1,
    dataType: NumericType = 'float32'
  ): SparseNeuroVol {
    const dims = space.dim;
    const indices: number[] = [];
    const values: number[] = [];
    const radiusSquared = radius * radius;

    const minBound = center.map(c => Math.max(0, Math.floor(c - radius)));
    const maxBound = center.map((c, idx) => Math.min(dims[idx] - 1, Math.ceil(c + radius)));

    for (let i = minBound[0]; i <= maxBound[0]; i++) {
      for (let j = minBound[1]; j <= maxBound[1]; j++) {
        for (let k = minBound[2]; k <= maxBound[2]; k++) {
          const distSquared =
            (i - center[0]) ** 2 +
            (j - center[1]) ** 2 +
            (k - center[2]) ** 2;

          if (distSquared <= radiusSquared) {
            const index = i + j * dims[0] + k * dims[0] * dims[1];
            indices.push(index);
            values.push(fillValue);
          }
        }
      }
    }

    return new SparseNeuroVol(space, dataType, 0, indices, values);
  }
}
