import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol'; // Import NeuroVol
import { TypedArray } from '../types';
import { Matrix } from 'ml-matrix';
import { SparseNeuroVol } from '../sparse/SparseNeuroVol';
import { NumericType } from '../types';


/**
 * Represents a Region of Interest (ROI) defined by voxel coordinates.
 */
export class ROICoords {
  readonly space: NeuroSpace;
  readonly coords: number[][]; // Array of coordinate tuples [i, j, k]

  constructor(space: NeuroSpace, coords: number[][]) {
    if (!Array.isArray(coords) || coords.length === 0) {
      throw new Error('coords must be a non-empty array of [i, j, k] tuples');
    }
    this.space = space;
    this.coords = coords;
  }

  /**
   * Returns the number of voxels in the ROI.
   */
  get length(): number {
    return this.coords.length;
  }

  /**
   * Returns the indices of the voxels in the ROI based on the space dimensions.
   */
  indices(): number[] {
    return this.coords.map(coord => this.space.gridToIndex(coord));
  }

  /**
   * Returns the real-world coordinates of the voxels in the ROI.
   */
  realCoords(): number[][] {
    return this.coords.map(coord => this.space.gridToCoord(coord));
  }

  /**
   * Computes the centroid of the ROI in real-world coordinates.
   */
  centroid(): number[] {
    const realCoords = this.realCoords();
    const numCoords = realCoords.length;
    const sum = realCoords.reduce(
      (acc, coord) => acc.map((value, idx) => value + coord[idx]),
      [0, 0, 0]
    );
    return sum.map(value => value / numCoords);
  }
}

/**
 * Represents a volumetric ROI with associated data values.
 */
export class ROIVol extends ROICoords {
  readonly data: TypedArray;
  private coordMap: Map<number, number>;

  constructor(space: NeuroSpace, coords: number[][], data?: TypedArray) {
    super(space, coords);

    if (data) {
      if (data.length !== this.length) {
        throw new Error('Data length must match number of coordinates');
      }
      this.data = data;
    } else {
      // Default to Float32Array filled with 1s
      this.data = new Float32Array(this.length).fill(1);
    }

    // Generate the coordMap during construction
    this.coordMap = new Map(this.coords.map((coord, index) => [this.space.gridToIndex(coord), index]));
  }

  /**
   * Retrieves the data value at a specific relative voxel index.
   * @param index Index of the voxel in the ROI.
   */
  get(index: number): number {
    return this.data[index];
  }

  getAt(i: number, j: number, k: number): number {
    // Compute the grid index for the given i, j, k coordinates
    const gridIndex = this.space.gridToIndex([i, j, k]);
    
    // Check if the gridIndex exists in our ROI
    if (this.coordMap.has(gridIndex)) {
      // If it does, return the corresponding value from this.data
      return this.data[this.coordMap.get(gridIndex)!];
    } else {
      // If it doesn't, return 0
      return 0;
    }
  }

  /**
   * Converts this ROIVol instance into a SparseNeuroVol instance.
   *
   * @param defaultValue - The default value for voxels not explicitly stored. Defaults to 0.
   * @param dataType - The numeric data type for the SparseNeuroVol. Defaults to 'float32'.
   * @returns An instance of SparseNeuroVol representing the ROI.
   */
  toNeuroVol(defaultValue: number = 0, dataType: NumericType = 'float32'): SparseNeuroVol {
    const indices: number[] = [];
    const values: number[] = [];

    for (let i = 0; i < this.length; i++) {
      const value = this.data[i];
      if (value !== defaultValue) {
        const coord = this.coords[i];
        const index = this.space.gridToIndex(coord);
        indices.push(index);
        values.push(value);
      }
    }

    return new SparseNeuroVol(this.space, dataType, defaultValue, indices, values);
  }
}

/**
 * Represents a spatially windowed ROI with center voxel information.
 */
export class ROIVolWindow extends ROIVol {
  readonly parentIndex: number; // Index of the center voxel in the parent space
  readonly centerIndex: number; // Index of the center voxel in the ROI

  constructor(
    space: NeuroSpace,
    coords: number[][],
    data: TypedArray,
    centerIndex: number
  ) {
    super(space, coords, data);

    if (centerIndex < 0 || centerIndex >= this.length) {
      throw new Error('centerIndex must be a valid index within coords');
    }
    this.centerIndex = centerIndex;

    const centerCoord = this.coords[centerIndex];
    this.parentIndex = space.gridToIndex(centerCoord);
  }
}

/**
 * Represents a volumetric ROI with associated vector data for each voxel.
 */
export class ROIVec extends ROICoords {
  readonly data: Matrix; // Each row corresponds to a voxel, columns represent vector components

  constructor(space: NeuroSpace, coords: number[][], data: Matrix) {
    super(space, coords);

    if (data.rows !== this.length) {
      throw new Error('Number of rows in data must match number of coordinates');
    }
    this.data = data;
  }

  /**
   * Retrieves the vector data at a specific voxel index.
   * @param index Index of the voxel in the ROI.
   */
  getVectorAt(index: number): number[] {
    return this.data.getRow(index);
  }

  /**
   * Sets the vector data at a specific voxel index.
   * @param index Index of the voxel in the ROI.
   * @param vector Vector data to set.
   */
  setVectorAt(index: number, vector: number[]): void {
    this.data.setRow(index, vector);
  }
}

/**
 * Represents a windowed ROI with vector data and center voxel information.
 */
export class ROIVecWindow extends ROIVec {
  readonly parentIndex: number; // Index of the center voxel in the parent space
  readonly centerIndex: number; // Index of the center voxel in the ROI

  constructor(
    space: NeuroSpace,
    coords: number[][],
    data: Matrix,
    centerIndex: number
  ) {
    super(space, coords, data);

    if (centerIndex < 0 || centerIndex >= this.length) {
      throw new Error('centerIndex must be a valid index within coords');
    }
    this.centerIndex = centerIndex;

    const centerCoord = this.coords[centerIndex];
    this.parentIndex = space.gridToIndex(centerCoord);
  }
}

/**
 * Creates a square ROI with a fixed dimension (e.g., z-dimension).
 * @param space The NeuroSpace representing the volume.
 * @param centroid The center voxel coordinates [i, j, k].
 * @param surround Number of voxels around the center voxel.
 * @param fixDim The dimension to fix (0 for x, 1 for y, 2 for z).
 */
export function squareROI(
  space: NeuroSpace,
  centroid: number[],
  surround: number,
  fixDim: number = 2
): ROIVolWindow {
  if (centroid.length !== 3) {
    throw new Error('Centroid must have length 3');
  }

  const dims = space.dim;
  const coords: number[][] = [];
  const start = centroid.map(c => c - surround);
  const end = centroid.map(c => c + surround);

  for (let i = start[0]; i <= end[0]; i++) {
    for (let j = start[1]; j <= end[1]; j++) {
      const fixed = centroid[fixDim];
      const indices = [i, j, fixed];
      if (
        indices.every((val, idx) => val >= 0 && val < dims[idx])
      ) {
        coords.push(indices);
      }
    }
  }

  const data = new Float32Array(coords.length).fill(1);
  const centerIndex = coords.findIndex(coord =>
    coord.every((val, idx) => val === centroid[idx])
  );

  return new ROIVolWindow(space, coords, data, centerIndex);
}

/**
 * Creates a cuboidal Region of Interest (ROI) within a NeuroSpace.
 *
 * @param vol - The NeuroVol representing the volume.
 * @param centroid - The center voxel coordinates [i, j, k].
 * @param surround - Number of voxels to surround the centroid in each dimension.
 *                   Can be a single number (same for all dimensions) or an array of three numbers.
 * @param fill - Optional value(s) to assign to the data slot of the resulting ROI. Defaults to 1.
 * @param nonzero - If true, only include voxels with non-zero values from the source NeuroVol.
 * @returns An instance of ROIVolWindow representing the cuboidal ROI.
 */
export function cuboidROI(
  vol: NeuroVol, // Change parameter to 'vol' of type 'NeuroVol'
  centroid: number[],
  surround: number | number[],
  fill: number = 1,
  nonzero: boolean = false
): ROIVolWindow {
  const space = vol.space; // Access the NeuroSpace from the NeuroVol

  if (centroid.length !== 3) {
    throw new Error('Centroid must have length 3');
  }

  const dims = space.dim;
  const surroundArray = Array.isArray(surround)
    ? surround
    : [surround, surround, surround];

  if (surroundArray.length !== 3) {
    throw new Error('Surround must be a single number or an array of three numbers');
  }

  const coords: number[][] = [];

  const start = centroid.map((c, idx) => c - surroundArray[idx]);
  const end = centroid.map((c, idx) => c + surroundArray[idx]);

  for (let i = start[0]; i <= end[0]; i++) {
    for (let j = start[1]; j <= end[1]; j++) {
      for (let k = start[2]; k <= end[2]; k++) {
        const indices = [i, j, k];
        if (indices.every((val, idx) => val >= 0 && val < dims[idx])) {
          coords.push(indices);
        }
      }
    }
  }

  let data: TypedArray;
  if (nonzero) {
    const filteredCoords: number[][] = [];
    const filteredData: number[] = [];
    let centerIndex = -1;

    coords.forEach((coord) => {
      const value = vol.getAt(coord[0], coord[1], coord[2]); // Use 'vol.getAt'
      if (value !== 0) {
        filteredCoords.push(coord);
        filteredData.push(fill);
        if (coord.every((val, idx) => val === centroid[idx])) {
          centerIndex = filteredCoords.length - 1;
        }
      }
    });

    if (filteredCoords.length === 0) {
      throw new Error('No non-zero voxels found in the ROI');
    }

    if (centerIndex === -1) {
      throw new Error('Centroid voxel is not included in the ROI');
    }

    data = new Float32Array(filteredData);
    return new ROIVolWindow(space, filteredCoords, data, centerIndex);

  } else {
    data = new Float32Array(coords.length).fill(fill);

    const centerIndex = coords.findIndex(coord =>
      coord.every((val, idx) => val === centroid[idx])
    );

    if (centerIndex === -1) {
      throw new Error('Centroid voxel is out of bounds of the ROI');
    }

    return new ROIVolWindow(space, coords, data, centerIndex);
  }
}

/**
 * Creates a spherical Region of Interest (ROI) within a NeuroVol.
 *
 * @param vol - The NeuroVol representing the volume.
 * @param centroid - The center voxel coordinates [i, j, k].
 * @param radius - The radius of the sphere in voxel units.
 * @param fill - Optional value(s) to assign to the data slot of the resulting ROI. Defaults to 1.
 * @param nonzero - If true, only include voxels with non-zero values from the source NeuroVol.
 * @returns An instance of ROIVolWindow representing the spherical ROI.
 */
export function sphericalROI(
  vol: NeuroVol, // Change parameter to 'vol' of type 'NeuroVol'
  centroid: number[],
  radius: number,
  fill: number = 1,
  nonzero: boolean = false
): ROIVolWindow {
  const space = vol.space; // Access the NeuroSpace from the NeuroVol

  if (centroid.length !== 3) {
    throw new Error('Centroid must have length 3');
  }

  if (radius < 0) {
    throw new Error('Radius must be non-negative');
  }

  const dims = space.dim;
  const coords: number[][] = [];

  const squaredRadius = radius * radius;

  const start = centroid.map(c => Math.floor(c - radius));
  const end = centroid.map(c => Math.ceil(c + radius));

  for (let i = start[0]; i <= end[0]; i++) {
    for (let j = start[1]; j <= end[1]; j++) {
      for (let k = start[2]; k <= end[2]; k++) {
        const indices = [i, j, k];
        if (indices.some((val, idx) => val < 0 || val >= dims[idx])) {
          continue; // Skip out-of-bounds voxels
        }

        // Compute squared distance from centroid
        const dx = i - centroid[0];
        const dy = j - centroid[1];
        const dz = k - centroid[2];
        const distanceSquared = dx * dx + dy * dy + dz * dz;

        if (distanceSquared <= squaredRadius) {
          coords.push(indices);
        }
      }
    }
  }

  let data: TypedArray;
  if (nonzero) {
    // Now we can use 'vol.getAt' to access voxel values
    const filteredCoords: number[][] = [];
    const filteredData: number[] = [];
    let centerIndex = -1;

    coords.forEach((coord) => {
      const value = vol.getAt(coord[0], coord[1], coord[2]); // Use 'vol.getAt' instead of 'space.getAt'
      if (value !== 0) {
        filteredCoords.push(coord);
        filteredData.push(fill);
        if (coord.every((val, idx) => val === centroid[idx])) {
          centerIndex = filteredCoords.length - 1;
        }
      }
    });

    if (filteredCoords.length === 0) {
      throw new Error('No non-zero voxels found in the ROI');
    }

    if (centerIndex === -1) {
      throw new Error('Centroid voxel is not included in the ROI');
    }

    data = new Float32Array(filteredData);
    return new ROIVolWindow(space, filteredCoords, data, centerIndex);

  } else {
    data = new Float32Array(coords.length).fill(fill);

    // Find the center index within the ROI coordinates
    const centerIndex = coords.findIndex(coord =>
      coord.every((val, idx) => val === centroid[idx])
    );

    if (centerIndex === -1) {
      throw new Error('Centroid voxel is out of bounds of the ROI');
    }

    return new ROIVolWindow(space, coords, data, centerIndex);
  }
}