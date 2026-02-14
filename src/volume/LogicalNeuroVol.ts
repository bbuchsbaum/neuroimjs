import { DenseNeuroVol } from './DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroSlice } from './NeuroSlice';
import { NeuroVol } from './NeuroVol';
import { AxisSet3D } from '../geometry/Axis';
import { ValueError, NumericType } from '../types';
import { createNeuroSlice } from './NeuroIm';

/**
 * LogicalNeuroVol class for binary/logical 3D neuroimaging volumes.
 * 
 * This class represents volumetric data where each voxel is either true or false.
 * It's useful for masks, ROIs, and binary classifications.
 * 
 * Direct translation of Python's LogicalNeuroVol class.
 */
export class LogicalNeuroVol extends DenseNeuroVol {
  private boolData: Uint8Array;

  /**
   * Creates a LogicalNeuroVol instance.
   * 
   * @param space - The spatial metadata for the volume
   * @param data - Optional binary data (0 or 1 values)
   * @param indices - Optional indices to set to true (all others will be false)
   * @param label - Optional label for the volume
   */
  constructor(
    space: NeuroSpace,
    data?: Uint8Array | boolean[],
    indices?: number[],
    label: string = ""
  ) {
    // Always use Uint8Array for boolean data (0 = false, 1 = true)
    super(space, Uint8Array, space.dim[0] * space.dim[1] * space.dim[2]);
    
    this.boolData = this.data as Uint8Array;
    
    if (indices !== undefined) {
      // Create false volume and set specified indices to true
      this.boolData.fill(0);
      for (const idx of indices) {
        if (idx >= 0 && idx < this.length) {
          this.boolData[idx] = 1;
        }
      }
    } else if (data !== undefined) {
      // Convert input data to binary format
      if (data instanceof Uint8Array) {
        // Ensure values are 0 or 1
        for (let i = 0; i < data.length; i++) {
          this.boolData[i] = data[i] ? 1 : 0;
        }
      } else if (Array.isArray(data)) {
        // Convert boolean array
        for (let i = 0; i < data.length; i++) {
          this.boolData[i] = data[i] ? 1 : 0;
        }
      }
    }
  }

  /**
   * Get the value at a specific voxel as boolean.
   */
  getBool(index: number): boolean {
    return this.boolData[index] === 1;
  }

  /**
   * Get the value at specific coordinates as boolean.
   */
  getBoolAt(i: number, j: number, k: number): boolean {
    const index = this.coordToIndex(i, j, k);
    return this.boolData[index] === 1;
  }

  /**
   * Set a boolean value at a specific index.
   */
  setBool(index: number, value: boolean): void {
    this.boolData[index] = value ? 1 : 0;
  }

  /**
   * Set a boolean value at specific coordinates.
   */
  setBoolAt(i: number, j: number, k: number, value: boolean): void {
    const index = this.coordToIndex(i, j, k);
    this.boolData[index] = value ? 1 : 0;
  }

  /**
   * Convert to logical representation (returns self since already logical).
   */
  asLogical(): LogicalNeuroVol {
    return this;
  }

  /**
   * Convert to dense representation.
   */
  asDense(): DenseNeuroVol {
    // Create a Float32 dense volume from the logical data
    const denseData = new Float32Array(this.length);
    for (let i = 0; i < this.length; i++) {
      denseData[i] = this.boolData[i];
    }
    return new FloatNeuroVol(this.space, denseData);
  }

  /**
   * Count the number of true voxels.
   */
  count(): number {
    let sum = 0;
    for (let i = 0; i < this.length; i++) {
      sum += this.boolData[i];
    }
    return sum;
  }

  /**
   * Get the indices of all true voxels.
   */
  getTrueIndices(): number[] {
    const indices: number[] = [];
    for (let i = 0; i < this.length; i++) {
      if (this.boolData[i] === 1) {
        indices.push(i);
      }
    }
    return indices;
  }

  /**
   * Get the coordinates of all true voxels.
   */
  getTrueCoords(): number[][] {
    const coords: number[][] = [];
    const [dimX, dimY, dimZ] = this.dim;
    
    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          if (this.getBoolAt(i, j, k)) {
            coords.push([i, j, k]);
          }
        }
      }
    }
    return coords;
  }

  /**
   * Logical AND operation with another LogicalNeuroVol.
   */
  and(other: LogicalNeuroVol): LogicalNeuroVol {
    if (!this.isSameSpace(other)) {
      throw new ValueError("Volumes must have the same space for logical operations");
    }
    
    const resultData = new Uint8Array(this.length);
    for (let i = 0; i < this.length; i++) {
      resultData[i] = this.boolData[i] & other.boolData[i];
    }
    
    return new LogicalNeuroVol(this.space, resultData);
  }

  /**
   * Logical OR operation with another LogicalNeuroVol.
   */
  or(other: LogicalNeuroVol): LogicalNeuroVol {
    if (!this.isSameSpace(other)) {
      throw new ValueError("Volumes must have the same space for logical operations");
    }
    
    const resultData = new Uint8Array(this.length);
    for (let i = 0; i < this.length; i++) {
      resultData[i] = this.boolData[i] | other.boolData[i];
    }
    
    return new LogicalNeuroVol(this.space, resultData);
  }

  /**
   * Logical XOR operation with another LogicalNeuroVol.
   */
  xor(other: LogicalNeuroVol): LogicalNeuroVol {
    if (!this.isSameSpace(other)) {
      throw new ValueError("Volumes must have the same space for logical operations");
    }
    
    const resultData = new Uint8Array(this.length);
    for (let i = 0; i < this.length; i++) {
      resultData[i] = this.boolData[i] ^ other.boolData[i];
    }
    
    return new LogicalNeuroVol(this.space, resultData);
  }

  /**
   * Logical NOT operation.
   */
  not(): LogicalNeuroVol {
    const resultData = new Uint8Array(this.length);
    for (let i = 0; i < this.length; i++) {
      resultData[i] = this.boolData[i] ? 0 : 1;
    }
    
    return new LogicalNeuroVol(this.space, resultData);
  }

  /**
   * Create a logical volume from a threshold operation.
   */
  static fromThreshold(
    vol: NeuroVol,
    threshold: number,
    comparison: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' = 'gt'
  ): LogicalNeuroVol {
    const data = vol.getData();
    const boolData = new Uint8Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      switch (comparison) {
        case 'gt':
          boolData[i] = value > threshold ? 1 : 0;
          break;
        case 'lt':
          boolData[i] = value < threshold ? 1 : 0;
          break;
        case 'gte':
          boolData[i] = value >= threshold ? 1 : 0;
          break;
        case 'lte':
          boolData[i] = value <= threshold ? 1 : 0;
          break;
        case 'eq':
          boolData[i] = value === threshold ? 1 : 0;
          break;
        case 'neq':
          boolData[i] = value !== threshold ? 1 : 0;
          break;
      }
    }
    
    return new LogicalNeuroVol(vol.space, boolData);
  }

  getSliceTypedArrayType(): NumericType {
    return 'uint8';
  }

  public getDataConstructor(): new (length: number) => Uint8Array {
    return Uint8Array;
  }

  protected getTypedArrayType(): NumericType {
    return 'uint8';
  }

  protected getVolumeConstructor(): new (space: NeuroSpace, data: Uint8Array) => LogicalNeuroVol {
    return LogicalNeuroVol;
  }

  /**
   * Override the coordinate to index method for efficiency.
   */
  private coordToIndex(i: number, j: number, k: number): number {
    const [dimX, dimY] = this.dim;
    return i + j * dimX + k * dimX * dimY;
  }

  /**
   * Check if two volumes have the same space.
   */
  private isSameSpace(other: LogicalNeuroVol): boolean {
    // Compare dimensions
    if (this.dim.length !== other.dim.length) return false;
    for (let i = 0; i < this.dim.length; i++) {
      if (this.dim[i] !== other.dim[i]) return false;
    }
    
    // Compare spacing
    for (let i = 0; i < this.spacing.length; i++) {
      if (Math.abs(this.spacing[i] - other.spacing[i]) > 1e-6) return false;
    }
    
    // Compare origin
    for (let i = 0; i < this.origin.length; i++) {
      if (Math.abs(this.origin[i] - other.origin[i]) > 1e-6) return false;
    }
    
    return true;
  }
}

// Import FloatNeuroVol to avoid circular dependency
import { FloatNeuroVol } from './DenseNeuroVol';
