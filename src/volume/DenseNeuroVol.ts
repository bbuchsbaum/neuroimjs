import { Matrix } from 'ml-matrix';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroSlice } from './NeuroSlice';
import { NeuroVol } from './NeuroVol';
import { AxisSet2D, AxisSet3D } from '../geometry/Axis';
import { SliceTypedArrayType, TypedArray } from '../types';
import { VoxelIterator } from './VoxelIterator';
import { createNeuroSlice } from './NeuroIm';
import { CoronalVoxelIterator, SagittalVoxelIterator } from './VoxelIterator';
import { extractSliceForView } from '../geometry/SliceHelpers';

function assertTypedArray(arr: TypedArray): Float32Array | Uint8Array | Int16Array | Float64Array | Int32Array | Uint16Array | Int8Array {
  if (arr instanceof Float32Array || arr instanceof Uint8Array || arr instanceof Int16Array || 
    arr instanceof Float64Array || arr instanceof Int32Array || arr instanceof Uint16Array || 
    arr instanceof Int8Array) {
    return arr;
  }
  throw new Error('Unsupported TypedArray type');
}

export abstract class DenseNeuroVol implements NeuroVol {
  readonly space: NeuroSpace;
  protected data: TypedArray;

  constructor(
    space: NeuroSpace,
    dataConstructor: new (length: number) => TypedArray,
    length?: number,
    initialData?: TypedArray
  ) {
    if (!(space instanceof NeuroSpace)) {
      throw new TypeError('space must be an instance of NeuroSpace');
    }
    this.space = space;
    this.data = initialData || new dataConstructor(length || this.length);
  }

  get length(): number {
    return this.space.dim[0] * this.space.dim[1] * this.space.dim[2];
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
    return this.data;
  }

  /**
   * Replace underlying data in-place to preserve typed array type and views.
   * Useful for fast volume updates (e.g., refreshed overlays) without realloc.
   */
  setData(newData: TypedArray): void {
    if (newData.length !== this.length) {
      throw new Error(`Data length mismatch: expected ${this.length}, got ${newData.length}`);
    }
    // Copy into existing buffer to keep constructor/type consistent
    this.data.set(newData as any);
  }

  get(index: number): number {
    return this.data[index];
  }

  getAt(i: number, j: number, k: number): number {
    const index = i + j * this.space.dim[0] + k * this.space.dim[0] * this.space.dim[1];
    return this.data[index];
  }

  setAt(i: number, j: number, k: number, value: number): void {
    const index = i + j * this.space.dim[0] + k * this.space.dim[0] * this.space.dim[1];
    this.data[index] = value;
  }

  isIdentityMatrix(matrix: Matrix): boolean {
    if (matrix.rows !== matrix.columns) {
      return false;
    }
    
    for (let i = 0; i < matrix.rows; i++) {
      for (let j = 0; j < matrix.columns; j++) {
        if (i === j) {
          if (Math.abs(matrix.get(i, j) - 1) > Number.EPSILON) {
            return false;
          }
        } else {
          if (Math.abs(matrix.get(i, j)) > Number.EPSILON) {
            return false;
          }
        }
      }
    }
    
    return true;
  }

  getSlice(zlevel: number, outAxes: AxisSet3D): NeuroSlice {
    const reorientedSpace = this.space.reorient(outAxes);
    // Use extractSliceForView to properly handle different orientations
    const sliceSpace = extractSliceForView(reorientedSpace, zlevel, outAxes);
    if (!sliceSpace) {
      throw new Error("Failed to create slice space");
    }

    const trans = this.space.getPermutationMatrixTo(reorientedSpace.axes);
    const isIdentity = this.isIdentityMatrix(trans);

    const sliceDims = reorientedSpace.dim.slice();
    sliceDims[2] = 1;
    const [nx, ny] = sliceDims.slice(0, 2);

    if (isIdentity && zlevel >= 0 && zlevel < this.dim[2]) {

      // Compute offset and length for the subarray
      const offset = zlevel * this.dim[0] * this.dim[1];
      const sliceLength = nx * ny;

      // Create a subarray to avoid copying data
      const sliceData = this.data.subarray(offset, offset + sliceLength);
      

      // Create and return the NeuroSlice using the subarray
      const slice = createNeuroSlice(
        this.getSliceTypedArrayType(),
        sliceSpace,
        sliceData
      );
      return slice;
    } else if (AxisSet3D.CORONAL_LIP.equals(reorientedSpace.axes)) {

      const sliceData = new (this.getDataConstructor())(nx * ny);
      let index = 0;

      const voxelIterator = new CoronalVoxelIterator(this, zlevel);
      for (const voxel of voxelIterator) {
        const { sourceIndex3D, inBounds } = voxel;
        const value = inBounds
          ? this.getAt(sourceIndex3D[0], sourceIndex3D[1], sourceIndex3D[2])
          : 0;
        sliceData[index++] = value;
      }

      const slice = createNeuroSlice(
        this.getSliceTypedArrayType(),
        sliceSpace,
        assertTypedArray(sliceData)
      );
      return slice;

    } else if (AxisSet3D.SAGITTAL_AIL.equals(reorientedSpace.axes)) {

      const sliceData = new (this.getDataConstructor())(nx * ny);
      let index = 0;

      const voxelIterator = new SagittalVoxelIterator(this, zlevel);
      for (const voxel of voxelIterator) {
        const { sourceIndex3D, inBounds } = voxel;
        const value = inBounds
          ? this.getAt(sourceIndex3D[0], sourceIndex3D[1], sourceIndex3D[2])
          : 0;
        sliceData[index++] = value;
      }

      const slice = createNeuroSlice(
        this.getSliceTypedArrayType(),
        sliceSpace,
        assertTypedArray(sliceData)
      );
      return slice;

    } else {

      const sliceData = new (this.getDataConstructor())(nx * ny);
      let index = 0;

      // Use the standard VoxelIterator
      const voxelIterator = new VoxelIterator(this, reorientedSpace, zlevel);
      for (const voxel of voxelIterator) {
        const { sourceIndex3D, inBounds } = voxel;
        const value = inBounds
          ? this.getAt(sourceIndex3D[0], sourceIndex3D[1], sourceIndex3D[2])
          : 0;
        sliceData[index++] = value;
      }

      const slice = createNeuroSlice(
        this.getSliceTypedArrayType(),
        sliceSpace,
        assertTypedArray(sliceData)
      );
      return slice;
    }
  }

  getRange(): [number, number] {
    const data = this.getData();
    if (data.length === 0) {
      throw new Error("Volume data is empty");
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (let i = 0, len = data.length; i < len; i++) {
      const value = data[i];
      // Assuming data contains only valid numbers
      if (value < min) {
        min = value;
        // Early exit if minimum possible value is found
        if (min === Number.MIN_VALUE) break;
      }
      if (value > max) {
        max = value;
        // Early exit if maximum possible value is found
        if (max === Number.MAX_VALUE) break;
      }
    }

    if (!isFinite(min) || !isFinite(max)) {
      throw new Error("No valid numeric data found in volume");
    }

    return [min, max];
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

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const sliceCoord = [i, j, fixedAxisValue, 1];
        const volCoordHomogeneous = space.getTransformationMatrixTo(space).mmul(Matrix.columnVector(sliceCoord)).to1DArray();
        const [x, y, z] = volCoordHomogeneous.slice(0, 3);

        let value = 0;
        if (interpolation === 'nearest') {
          const xi = Math.round(x);
          const yj = Math.round(y);
          const zk = Math.round(z);
          if (
            xi >= 0 && xi < space.dim[0] &&
            yj >= 0 && yj < space.dim[1] &&
            zk >= 0 && zk < space.dim[2]
          ) {
            value = this.getAt(xi, yj, zk);
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
            const v000 = this.getAt(xi, yj, zk);
            const v001 = this.getAt(xi, yj, zk + 1);
            const v010 = this.getAt(xi, yj + 1, zk);
            const v011 = this.getAt(xi, yj + 1, zk + 1);
            const v100 = this.getAt(xi + 1, yj, zk);
            const v101 = this.getAt(xi + 1, yj, zk + 1);
            const v110 = this.getAt(xi + 1, yj + 1, zk);
            const v111 = this.getAt(xi + 1, yj + 1, zk + 1);

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
    // Prefer constructing the 2D slice space by dropping the pinned axis
    // from the reoriented 3D space. NeuroSpace.dropDim() contains safeguards
    // that avoid creating singular 2x2 transforms in cases where an axis
    // projects to zero in the in-plane basis.
    const dropped = reorientedSpace.dropDim();
    if (!dropped) {
      throw new Error('Failed to create 2D slice space from reoriented space');
    }

    const slice = createNeuroSlice(
      this.getSliceTypedArrayType() as 'float32' | 'uint8' | 'int16' | 'float64' | 'int32' | 'int8' | 'uint16',
      dropped as NeuroSpace,
      assertTypedArray(sliceData)
    );
    return slice;
  }

  public abstract getSliceTypedArrayType(): SliceTypedArrayType
  public abstract getDataConstructor(): new (length: number) => TypedArray;
}


/**
 * Concrete NeuroVol class using Float32Array.
 */
export class FloatNeuroVol extends DenseNeuroVol {
  constructor(space: NeuroSpace, data?: Float32Array) {
    super(space, Float32Array, space.dim[0] * space.dim[1] * space.dim[2], data);
  }

  public getSliceTypedArrayType(): 'float32' {
    return 'float32';
  }

  public getDataConstructor(): new (length: number) => Float32Array {
    return Float32Array;
  } 

  // Additional Float32Array-specific methods can be added here
}

export class Int16NeuroVol extends DenseNeuroVol {
  constructor(space: NeuroSpace, data?: Int16Array) {
    super(space, Int16Array, space.dim[0] * space.dim[1] * space.dim[2], data);
  }

  public getSliceTypedArrayType(): 'int16' {
    return 'int16';
  }

  public getDataConstructor(): new (length: number) => Int16Array {
    return Int16Array;
  } 

  // Additional Int16Array-specific methods can be added here
}

export class UInt8NeuroVol extends DenseNeuroVol {
  constructor(space: NeuroSpace, data?: Uint8Array) {
    super(space, Uint8Array, space.dim[0] * space.dim[1] * space.dim[2], data);
  }

  public getDataConstructor(): typeof Uint8Array {
    return Uint8Array;
  }

  public getSliceTypedArrayType(): 'uint8' {
    return 'uint8';
  }

  // Additional Uint8Array-specific methods can be added here
}

export class Int8NeuroVol extends DenseNeuroVol {
  constructor(space: NeuroSpace, data?: Int8Array) {
    super(space, Int8Array, space.dim[0] * space.dim[1] * space.dim[2], data);
  }

  public getSliceTypedArrayType(): 'int8' {
    return 'int8';
  }

  public getDataConstructor(): new (length: number) => Int8Array {
    return Int8Array;
  } 

  // Additional Int8Array-specific methods can be added here
}

export class Float64NeuroVol extends DenseNeuroVol {
  constructor(space: NeuroSpace, data?: Float64Array) {
    super(space, Float64Array, space.dim[0] * space.dim[1] * space.dim[2], data);
  }

  public getSliceTypedArrayType(): 'float64' {
    return 'float64';
  }

  public getDataConstructor(): new (length: number) => Float64Array {
    return Float64Array;
  }

  // Additional Float64Array-specific methods can be added here
}

export class Int32NeuroVol extends DenseNeuroVol {
  constructor(space: NeuroSpace, data?: Int32Array) {
    super(space, Int32Array, space.dim[0] * space.dim[1] * space.dim[2], data);
  }

  public getSliceTypedArrayType(): 'int32' {
    return 'int32';
  }

  public getDataConstructor(): new (length: number) => Int32Array {
    return Int32Array;
  } 

  // Additional Int32Array-specific methods can be added here
}

export class UInt16NeuroVol extends DenseNeuroVol {
  constructor(space: NeuroSpace, data?: Uint16Array) {
    super(space, Uint16Array, space.dim[0] * space.dim[1] * space.dim[2], data);
  }

  public getSliceTypedArrayType(): 'uint16' {
    return 'uint16';
  }

  public getDataConstructor(): new (length: number) => Uint16Array {
    return Uint16Array;
  }

  // Additional Uint16Array-specific methods can be added here
}
