// src/volume/VoxelIterator.ts

import { NeuroVol } from './NeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { Matrix } from 'ml-matrix';   
import { AxisSet3D, oppositeAxis } from '../geometry/Axis';




export interface VoxelMapping {
  sourceDimIndex: [number, number, number];
  flipSource: [boolean, boolean, boolean];
  sizeSource: [number, number, number];
}

export function computeVoxelMapping(outSpace: NeuroSpace, srcSpace: NeuroSpace): VoxelMapping {
  if (outSpace.ndim() < 3 || srcSpace.ndim() < 3) {
    throw new Error('computeVoxelMapping requires 3D spaces');
  }
  const outAxes = outSpace.axes.axes();
  const srcAxes = srcSpace.axes.axes();
  
  const mapping: VoxelMapping = {
    sourceDimIndex: [0,0,0],
    flipSource: [false,false,false],
    sizeSource: [ srcSpace.dim[0], srcSpace.dim[1], srcSpace.dim[2] ]
  };

  for (let od=0; od<3; od++) {
    const outAxis = outAxes[od];
    let found = false;
    for (let sd=0; sd<3; sd++) {
      const sAxis = srcAxes[sd];
      if (outAxis.equals(sAxis)) {
        mapping.sourceDimIndex[od] = sd;
        mapping.flipSource[od] = false;
        found = true;
        break;
      }
      if (outAxis.equals(oppositeAxis(sAxis))) {
        mapping.sourceDimIndex[od] = sd;
        mapping.flipSource[od] = true;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`Cannot map outAxis ${outAxis} to source volume axes`);
    }
  }

  return mapping;
}

/**
 * Interface representing a voxel's information during iteration.
 */
export interface VoxelItResult {
  /**
   * The [i, j, k] index in the source volume.
   */
  sourceIndex3D: [number, number, number];

  /**
   * The [i, j, k] index in the output space.
   */
  outputIndex3D: [number, number, number];

  /**
   * Indicates whether the voxel is within the bounds of the source volume.
   */
  inBounds: boolean;
}

export class VoxelIterator implements Iterable<VoxelItResult>, Iterator<VoxelItResult> {
  private sourceVol: NeuroVol;
  private outSpace: NeuroSpace;
  private zSlice: number;
  private mapping: VoxelMapping;
  private outWidth: number;
  private outHeight: number;
  private outDepth: number; // or if pinned dimension is zSlice, we handle that specially
  private i=0;
  private j=0;
  // pinned dimension z = ?

  constructor(sourceVol: NeuroVol, outSpace: NeuroSpace, zSlice: number) {
    this.sourceVol = sourceVol;
    this.outSpace = outSpace;
    this.zSlice = zSlice;
    this.mapping = computeVoxelMapping(outSpace, sourceVol.space);

    // out dims
    const [nx, ny, nz] = outSpace.dim;
    this.outWidth  = nx;
    this.outHeight = ny;
    this.outDepth  = nz; // might or might not use if you're pinning z.

    // We’ll iterate i in [0..nx-1], j in [0..ny-1], fixed zSlice in [0..nz-1].
  }

  [Symbol.iterator](): Iterator<VoxelItResult> { return this; }

  next(): IteratorResult<VoxelItResult> {
    if (this.j >= this.outHeight) {
      return { done:true, value:undefined };
    }

    const outI = this.i;
    const outJ = this.j;
    const outK = this.zSlice; // pinned
    
    // map => source coords
    const { sourceDimIndex, flipSource, sizeSource } = this.mapping;

    // dimension 0 => outI
    let s0 = flipSource[0]
      ? (sizeSource[sourceDimIndex[0]] - 1 - outI)
      : outI;
    // dimension 1 => outJ
    let s1 = flipSource[1]
      ? (sizeSource[sourceDimIndex[1]] - 1 - outJ)
      : outJ;
    // dimension 2 => outK
    let s2 = flipSource[2]
      ? (sizeSource[sourceDimIndex[2]] - 1 - outK)
      : outK;

    // sourceIndex3D => place s0..2 by which dimension they map to
    // e.g. sourceDimIndex[0] might be 2 => meaning s0 goes to i2
    const sourceIndex = [0,0,0] as [number,number,number];
    sourceIndex[sourceDimIndex[0]] = s0;
    sourceIndex[sourceDimIndex[1]] = s1;
    sourceIndex[sourceDimIndex[2]] = s2;

    // Check bounds
    const [SX, SY, SZ] = this.sourceVol.dim;
    const inBounds = (sourceIndex[0]>=0 && sourceIndex[0]<SX &&
                      sourceIndex[1]>=0 && sourceIndex[1]<SY &&
                      sourceIndex[2]>=0 && sourceIndex[2]<SZ);

    const result: VoxelItResult = {
      sourceIndex3D: sourceIndex,
      outputIndex3D: [outI, outJ, outK],
      inBounds
    };

    // increment
    this.i++;
    if (this.i >= this.outWidth) {
      this.i=0;
      this.j++;
    }

    return { done:false, value: result };
  }
}


/**
 * Fast Voxel Iterator for cases where the permutation matrix is the identity matrix.
 */
export class FastVoxelIterator implements IterableIterator<[number, number, number]> {
  private nx: number;
  private ny: number;
  private nz: number;
  private i: number = 0;
  private j: number = 0;
  private k: number = 0;

  constructor(volume: NeuroVol) {
    const [nx, ny, nz] = volume.dim;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
  }

  [Symbol.iterator](): IterableIterator<[number, number, number]> {
    return this;
  }

  next(): IteratorResult<[number, number, number]> {
    if (this.k >= this.nz) {
      return { done: true, value: undefined };
    }

    const result: [number, number, number] = [this.i, this.j, this.k];

    // Update indices
    this.i++;
    if (this.i >= this.nx) {
      this.i = 0;
      this.j++;
      if (this.j >= this.ny) {
        this.j = 0;
        this.k++;
      }
    }

    return { value: result, done: false };
  }
}

/**
 * Specialized iterator for coronal slices when source is LPI.
 */
export class CoronalVoxelIterator implements Iterable<VoxelItResult>, Iterator<VoxelItResult> {
  private sourceVolume: NeuroVol;
  private zSlice: number;
  private sourceDims: number[];
  private sliceWidth: number;
  private sliceHeight: number;
  private i: number = 0;
  private j: number = 0;

  constructor(sourceVolume: NeuroVol, zSlice: number) {
    this.sourceVolume = sourceVolume;
    this.zSlice = zSlice;
    this.sourceDims = sourceVolume.dim;
    this.sliceWidth = this.sourceDims[0];   // Width along i_source (Left-Right)
    this.sliceHeight = this.sourceDims[2];  // Height along k_source (Inferior-Superior)
  }

  [Symbol.iterator](): Iterator<VoxelItResult> {
    return this;
  }

  next(): IteratorResult<VoxelItResult> {
    if (this.j >= this.sliceHeight) {
      return { done: true, value: undefined };
    }

    // Mapping:
    // i_out = i_source = this.i
    // j_out = j_source = this.zSlice
    // k_out = k_source = this.j

    const sourceIndex3D: [number, number, number] = [this.i, this.zSlice, this.j];
    const outputIndex3D: [number, number, number] = [this.i, this.j, this.zSlice];

    // Check bounds
    const [nx, ny, nz] = this.sourceDims;
    const inBounds = 
      this.i >= 0 && this.i < nx &&
      this.zSlice >= 0 && this.zSlice < ny &&
      this.j >= 0 && this.j < nz;

    const result: VoxelItResult = {
      sourceIndex3D,
      outputIndex3D,
      inBounds,
    };

    // Update indices
    this.i++;
    if (this.i >= this.sliceWidth) {
      this.i = 0;
      this.j++;
    }

    return { value: result, done: false };
  }
}

/**
 * Specialized iterator for sagittal slices when source is LPI.
 */
export class SagittalVoxelIterator implements Iterable<VoxelItResult>, Iterator<VoxelItResult> {
  private sourceVolume: NeuroVol;
  private zSlice: number;
  private sourceDims: number[];
  private sliceWidth: number;
  private sliceHeight: number;
  private i: number = 0;
  private j: number = 0;

  constructor(sourceVolume: NeuroVol, zSlice: number) {
    this.sourceVolume = sourceVolume;
    this.zSlice = zSlice;
    this.sourceDims = sourceVolume.dim;
    this.sliceWidth = this.sourceDims[1];   // Width along y_source (Anterior-Posterior)
    this.sliceHeight = this.sourceDims[2];  // Height along z_source (Inferior-Superior)
  }

  [Symbol.iterator](): Iterator<VoxelItResult> {
    return this;
  }

  next(): IteratorResult<VoxelItResult> {
    if (this.j >= this.sliceHeight) {
      return { done: true, value: undefined };
    }

    // Flip the Y-axis (Anterior-Posterior axis)
    const flippedI = this.sliceWidth - 1 - this.i;

    // Mapping:
    // x_source = this.zSlice
    // y_source = flippedI
    // z_source = this.j

    const sourceIndex3D: [number, number, number] = [this.zSlice, flippedI, this.j];
    const outputIndex3D: [number, number, number] = [this.i, this.j, this.zSlice];

    // Check bounds
    const [nx, ny, nz] = this.sourceDims;
    const inBounds = 
      this.zSlice >= 0 && this.zSlice < nx &&
      flippedI >= 0 && flippedI < ny &&
      this.j >= 0 && this.j < nz;

    const result: VoxelItResult = {
      sourceIndex3D,
      outputIndex3D,
      inBounds,
    };

    // Update indices
    this.i++;
    if (this.i >= this.sliceWidth) {
      this.i = 0;
      this.j++;
    }

    return { value: result, done: false };
  }
}
