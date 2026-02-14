import { ROI } from './ROI_base';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';
import { TypedArray, ValueError } from '../types';
import { Matrix } from 'ml-matrix';
import { SparseNeuroVol } from '../sparse/SparseNeuroVol';

/**
 * ROICoords - A class representing a region of interest (ROI) in a brain image,
 * defined by a set of coordinates.
 * 
 * Direct translation of Python's ROICoords class.
 */
export class ROICoords extends ROI {
  readonly space: NeuroSpace;
  readonly coords: number[][]; // Array of coordinate tuples [i, j, k]

  /**
   * Creates an ROICoords instance.
   * 
   * @param coords - Matrix with 3 columns representing (i, j, k) coordinates
   * @param space - NeuroSpace object defining the spatial reference. If not provided,
   *                creates a default space based on coordinate bounds.
   */
  constructor(coords: number[][], space?: NeuroSpace) {
    super();
    
    if (!Array.isArray(coords) || coords.length === 0) {
      throw new ValueError('coords must be a non-empty array of [i, j, k] tuples');
    }
    
    // Validate all coordinates have 3 components
    for (const coord of coords) {
      if (!Array.isArray(coord) || coord.length !== 3) {
        throw new ValueError('Each coordinate must be an array of length 3 [i, j, k]');
      }
    }
    
    this.coords = coords;
    
    // If no space provided, create default space based on coordinate bounds
    if (!space) {
      const maxCoords = [0, 0, 0];
      for (const coord of coords) {
        maxCoords[0] = Math.max(maxCoords[0], coord[0] + 1);
        maxCoords[1] = Math.max(maxCoords[1], coord[1] + 1);
        maxCoords[2] = Math.max(maxCoords[2], coord[2] + 1);
      }
      this.space = new NeuroSpace(
        maxCoords,
        [1, 1, 1],
        [0, 0, 0]
      );
    } else {
      this.space = space;
    }
  }

  /**
   * Returns the number of voxels in the ROI.
   */
  get length(): number {
    return this.coords.length;
  }

  /**
   * Get dimensions of the coordinate matrix.
   * Returns [nrows, ncols] where ncols is always 3.
   */
  get dim(): [number, number] {
    return [this.coords.length, 3];
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

  /**
   * Extract subset of coordinates.
   */
  getSubset(indices: number | number[] | boolean[]): ROICoords {
    if (typeof indices === 'number') {
      // Single row
      return new ROICoords([this.coords[indices]], this.space);
    } else if (Array.isArray(indices)) {
      // Multiple rows
      const subCoords: number[][] = [];
      if (typeof indices[0] === 'boolean') {
        // Boolean mask
        const mask = indices as boolean[];
        for (let i = 0; i < Math.min(mask.length, this.coords.length); i++) {
          if (mask[i]) {
            subCoords.push(this.coords[i]);
          }
        }
      } else {
        // Numeric indices
        const numIndices = indices as number[];
        for (const idx of numIndices) {
          if (idx >= 0 && idx < this.coords.length) {
            subCoords.push(this.coords[idx]);
          }
        }
      }
      return new ROICoords(subCoords, this.space);
    } else {
      throw new ValueError('Invalid index type');
    }
  }

  /**
   * String representation matching Python's implementation.
   */
  toString(): string {
    return `ROICoords\n  Dimension      : ${this.dim[0]} x ${this.dim[1]}`;
  }

  /**
   * Convert to SparseNeuroVol representation as a binary mask.
   * All voxels in the ROI will have a value of 1, all others will be 0.
   *
   * @param fillValue - The value to assign to ROI voxels (default: 1)
   * @returns A SparseNeuroVol with the ROI voxels set to fillValue
   */
  asSparse(fillValue: number = 1): SparseNeuroVol {
    const indices = this.indices();
    const values = new Array(indices.length).fill(fillValue);
    return new SparseNeuroVol(
      this.space,
      'float32',
      0,
      indices,
      values
    );
  }
}

/**
 * ROIVol - Class representing a volumetric region of interest (ROI) in a brain image,
 * defined by a set of coordinates and associated data values.
 * 
 * Direct translation of Python's ROIVol class.
 */
export class ROIVol extends ROICoords {
  readonly data: TypedArray;
  private coordMap: Map<number, number>;

  /**
   * Creates an ROIVol instance.
   * 
   * @param data - Numeric vector of values corresponding to each coordinate
   * @param space - NeuroSpace object defining the spatial reference
   * @param coords - Matrix with 3 columns representing (i,j,k) coordinates
   */
  constructor(data: TypedArray | number[], space: NeuroSpace, coords: number[][]) {
    super(coords, space);

    // Convert to TypedArray if needed
    if (Array.isArray(data)) {
      this.data = new Float32Array(data);
    } else {
      this.data = data;
    }

    if (this.data.length !== this.length) {
      throw new ValueError(
        `Length of data (${this.data.length}) must equal number of coordinates (${this.length})`
      );
    }

    // Generate the coordMap for fast lookups
    this.coordMap = new Map(
      this.coords.map((coord, index) => [this.space.gridToIndex(coord), index])
    );
  }

  /**
   * Retrieves the data value at a specific relative voxel index.
   * @param index Index of the voxel in the ROI.
   */
  get(index: number): number {
    return this.data[index];
  }

  /**
   * Get value at specific coordinates.
   * Returns 0 if coordinates are not in the ROI.
   */
  getAt(i: number, j: number, k: number): number {
    const gridIndex = this.space.gridToIndex([i, j, k]);
    
    if (this.coordMap.has(gridIndex)) {
      return this.data[this.coordMap.get(gridIndex)!];
    } else {
      return 0;
    }
  }

  /**
   * Convert to SparseNeuroVol representation.
   */
  asSparse(): SparseNeuroVol {
    const indices = this.indices();
    return new SparseNeuroVol(
      this.space,
      'float32',
      0,
      indices,
      Array.from(this.data)
    );
  }

  /**
   * Extract subset based on indices.
   */
  getSubset(indices: number | number[] | boolean[]): ROIVol {
    const subCoords = super.getSubset(indices);
    
    if (typeof indices === 'number') {
      const subData = new Float32Array([this.data[indices]]);
      return new ROIVol(subData, this.space, subCoords.coords);
    } else if (Array.isArray(indices)) {
      const subData: number[] = [];
      if (typeof indices[0] === 'boolean') {
        const mask = indices as boolean[];
        for (let i = 0; i < Math.min(mask.length, this.data.length); i++) {
          if (mask[i]) {
            subData.push(this.data[i]);
          }
        }
      } else {
        const numIndices = indices as number[];
        for (const idx of numIndices) {
          if (idx >= 0 && idx < this.data.length) {
            subData.push(this.data[idx]);
          }
        }
      }
      return new ROIVol(new Float32Array(subData), this.space, subCoords.coords);
    }
    
    throw new ValueError('Invalid index type');
  }

  /**
   * String representation.
   */
  toString(): string {
    return `ROIVol\n  Dimension      : ${this.dim[0]} x ${this.dim[1]}\n  Data length    : ${this.data.length}`;
  }
}

/**
 * ROIVolWindow - A windowed ROI representing a local neighborhood around a center voxel.
 * 
 * Direct translation of Python's ROIVolWindow class.
 */
export class ROIVolWindow extends ROIVol {
  readonly parentIndex: number;
  readonly centerIndex: number;

  constructor(
    space: NeuroSpace,
    coords: number[][],
    data: TypedArray | number[],
    centerIndex: number
  ) {
    super(data, space, coords);

    if (centerIndex < 0 || centerIndex >= this.length) {
      throw new ValueError('centerIndex must be a valid index within coords');
    }
    this.centerIndex = centerIndex;

    const centerCoord = this.coords[centerIndex];
    this.parentIndex = space.gridToIndex(centerCoord);
  }

  /**
   * String representation.
   */
  toString(): string {
    return `ROIVolWindow\n  Dimension      : ${this.dim[0]} x ${this.dim[1]}\n  Center index   : ${this.centerIndex}\n  Parent index   : ${this.parentIndex}`;
  }
}

/**
 * ROIVec - Represents a volumetric ROI with associated vector data for each voxel.
 * 
 * Direct translation of Python's ROIVec class.
 */
export class ROIVec extends ROICoords {
  readonly data: Matrix;

  /**
   * Creates an ROIVec instance.
   * 
   * @param data - Matrix where each row corresponds to a voxel, columns represent vector components
   * @param space - NeuroSpace object defining the spatial reference
   * @param coords - Matrix with 3 columns representing (i,j,k) coordinates
   */
  constructor(data: Matrix | number[][], space: NeuroSpace, coords: number[][]) {
    super(coords, space);

    // Convert to Matrix if needed
    if (Array.isArray(data)) {
      this.data = new Matrix(data);
    } else {
      this.data = data;
    }

    if (this.data.rows !== this.length) {
      throw new ValueError(
        `Number of rows in data (${this.data.rows}) must match number of coordinates (${this.length})`
      );
    }
  }

  /**
   * Get the number of columns (vector dimension).
   */
  get ncol(): number {
    return this.data.columns;
  }

  /**
   * Retrieves the vector data at a specific voxel index.
   * @param index Index of the voxel in the ROI.
   */
  getVector(index: number): number[] {
    return this.data.getRow(index);
  }

  /**
   * Sets the vector data at a specific voxel index.
   * @param index Index of the voxel in the ROI.
   * @param vector Vector data to set.
   */
  setVector(index: number, vector: number[]): void {
    if (vector.length !== this.ncol) {
      throw new ValueError(`Vector length must be ${this.ncol}`);
    }
    this.data.setRow(index, vector);
  }

  /**
   * Get column of data (all values for a specific vector component).
   */
  getColumn(colIndex: number): number[] {
    return this.data.getColumn(colIndex);
  }

  /**
   * Set column of data.
   */
  setColumn(colIndex: number, values: number[]): void {
    if (values.length !== this.length) {
      throw new ValueError(`Column length must be ${this.length}`);
    }
    this.data.setColumn(colIndex, values);
  }

  /**
   * String representation.
   */
  toString(): string {
    return `ROIVec\n  Dimension      : ${this.dim[0]} x ${this.dim[1]}\n  Vector dim     : ${this.ncol}`;
  }
}

/**
 * ROIVecWindow - Represents a windowed ROI with vector data and center voxel information.
 * 
 * Note: This is not in the Python implementation but exists in the TypeScript version.
 */
export class ROIVecWindow extends ROIVec {
  readonly parentIndex: number;
  readonly centerIndex: number;

  constructor(
    space: NeuroSpace,
    coords: number[][],
    data: Matrix | number[][],
    centerIndex: number
  ) {
    super(data, space, coords);

    if (centerIndex < 0 || centerIndex >= this.length) {
      throw new ValueError('centerIndex must be a valid index within coords');
    }
    this.centerIndex = centerIndex;

    const centerCoord = this.coords[centerIndex];
    this.parentIndex = space.gridToIndex(centerCoord);
  }

  /**
   * String representation.
   */
  toString(): string {
    return `ROIVecWindow\n  Dimension      : ${this.dim[0]} x ${this.dim[1]}\n  Vector dim     : ${this.ncol}\n  Center index   : ${this.centerIndex}`;
  }
}