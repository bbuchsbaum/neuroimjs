// Import necessary types and interfaces
import { NeuroVol } from '../volume/NeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { TypedArray } from '../types';

/**
 * Interface representing the searchlight neighborhood for a central voxel.
 */
interface SearchlightNeighborhood {
  centralVoxelIndex: number;      // Linear index of the central voxel
  centralVoxelCoord: [number, number, number]; // Voxel coordinates (i, j, k) of the central voxel
  centralWorldCoord: [number, number, number]; // Real-world coordinates of the central voxel
  neighborhoodIndices: number[];  // Linear indices of voxels within the searchlight
  neighborhoodCoords: [number, number, number][]; // Voxel coordinates of the neighborhood voxels
}

/**
 * Searchlight class for generating spherical neighborhoods over a 3D volume.
 */
class Searchlight implements Iterable<SearchlightNeighborhood> {
  private maskVolume: NeuroVol;
  private radius: number; // Radius in real-world units (e.g., millimeters)
  private voxelRadius: number; // Radius in voxel units
  private maskData: TypedArray;
  private space: NeuroSpace;
  private voxelSize: [number, number, number];
  private maskIndices: number[];
  private neighborhoodOffsets: Int32Array[];

  constructor(maskVolume: NeuroVol, radius: number) {
    this.maskVolume = maskVolume;
    this.radius = radius;
    this.space = maskVolume.space;
    this.voxelSize = [
      this.space.spacing[0],
      this.space.spacing[1],
      this.space.spacing[2],
    ];
    this.maskData = maskVolume.getData();
    this.maskIndices = this.getMaskIndices();
    this.voxelRadius = this.radiusToVoxelRadius(radius, this.voxelSize);
    this.neighborhoodOffsets = this.precomputeNeighborhoodOffsets(this.voxelRadius);
  }

  /**
   * Converts radius in real-world units to voxel units.
   */
  private radiusToVoxelRadius(radius: number, voxelSize: [number, number, number]): number {
    const avgVoxelSize = (voxelSize[0] + voxelSize[1] + voxelSize[2]) / 3;
    return radius / avgVoxelSize;
  }

  /**
   * Precomputes the offsets of neighborhood voxels within the radius.
   */
  private precomputeNeighborhoodOffsets(voxelRadius: number): Int32Array[] {
    const offsets: Int32Array[] = [];
    const ceilRadius = Math.ceil(voxelRadius);

    for (let z = -ceilRadius; z <= ceilRadius; z++) {
      for (let y = -ceilRadius; y <= ceilRadius; y++) {
        for (let x = -ceilRadius; x <= ceilRadius; x++) {
          const distance = Math.sqrt(x * x + y * y + z * z);
          if (distance <= voxelRadius) {
            offsets.push(Int32Array.from([x, y, z]));
          }
        }
      }
    }

    return offsets;
  }

  /**
   * Retrieves the indices of voxels within the mask.
   */
  private getMaskIndices(): number[] {
    const indices: number[] = [];
    const data = this.maskData;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) {
        indices.push(i);
      }
    }
    return indices;
  }

  /**
   * Returns an iterator over the searchlight neighborhoods.
   */
  [Symbol.iterator](): Iterator<SearchlightNeighborhood> {
    const maskIndices = this.maskIndices;
    const data = this.maskData;
    const dim = this.space.dim;
    const voxelSize = this.voxelSize;
    const neighborhoodOffsets = this.neighborhoodOffsets;
    const space = this.space;

    let current = 0;
    const total = maskIndices.length;

    return {
      next(): IteratorResult<SearchlightNeighborhood> {
        if (current >= total) {
          return { done: true, value: undefined };
        }

        const centralIndex = maskIndices[current++];
        const centralCoord = space.indexToGrid(centralIndex) as [number, number, number];
        const centralWorldCoord = space.gridToCoord(centralCoord);

        const neighborhoodIndices: number[] = [];
        const neighborhoodCoords: [number, number, number][] = [];

        for (const offset of neighborhoodOffsets) {
          const x = centralCoord[0] + offset[0];
          const y = centralCoord[1] + offset[1];
          const z = centralCoord[2] + offset[2];

          if (
            x >= 0 && x < dim[0] &&
            y >= 0 && y < dim[1] &&
            z >= 0 && z < dim[2]
          ) {
            const neighborIndex = space.gridToIndex([x, y, z]);
            if (data[neighborIndex] !== 0) {
              neighborhoodIndices.push(neighborIndex);
              neighborhoodCoords.push([x, y, z]);
            }
          }
        }

        return {
          done: false,
          value: {
            centralVoxelIndex: centralIndex,
            centralVoxelCoord: centralCoord,
            centralWorldCoord: centralWorldCoord as [number, number, number],
            neighborhoodIndices,
            neighborhoodCoords,
          },
        };
      },
    };
  }
}