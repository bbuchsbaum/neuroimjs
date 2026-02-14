import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';
import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { ROICoords, ROIVol, ROIVolWindow } from './ROI_improved';
import { ValueError, TypedArray } from '../types';

/**
 * Creates a spherical ROI centered at the given coordinates.
 * 
 * @param vol - The NeuroVol representing the volume
 * @param centroid - The center voxel coordinates [i, j, k]
 * @param radius - The radius of the sphere in voxel units
 * @param fill - Optional value(s) to assign to the data slot. Defaults to 1
 * @param nonzero - If true, only include voxels with non-zero values from the source volume
 * @returns An ROIVolWindow representing the spherical ROI
 */
export function sphericalROI(
  vol: NeuroVol,
  centroid: number[],
  radius: number,
  fill: number = 1,
  nonzero: boolean = false
): ROIVolWindow {
  if (centroid.length !== 3) {
    throw new ValueError('Centroid must have length 3');
  }

  const space = vol.space;
  const dims = space.dim;
  const coords: number[][] = [];
  const radiusSquared = radius * radius;

  // Calculate bounding box
  const minBound = centroid.map(c => Math.max(0, Math.floor(c - radius)));
  const maxBound = centroid.map((c, idx) => Math.min(dims[idx] - 1, Math.ceil(c + radius)));

  // Iterate through the bounding box
  for (let i = minBound[0]; i <= maxBound[0]; i++) {
    for (let j = minBound[1]; j <= maxBound[1]; j++) {
      for (let k = minBound[2]; k <= maxBound[2]; k++) {
        // Calculate squared distance from centroid
        const distSquared = 
          (i - centroid[0]) ** 2 + 
          (j - centroid[1]) ** 2 + 
          (k - centroid[2]) ** 2;
        
        if (distSquared <= radiusSquared) {
          // Check nonzero constraint if needed
          if (!nonzero || vol.getAt(i, j, k) !== 0) {
            coords.push([i, j, k]);
          }
        }
      }
    }
  }

  if (coords.length === 0) {
    throw new ValueError('No voxels found within the specified sphere');
  }

  // Create data array
  const data = new Float32Array(coords.length).fill(fill);

  // Find center index
  const centerIndex = coords.findIndex(coord =>
    coord[0] === Math.round(centroid[0]) &&
    coord[1] === Math.round(centroid[1]) &&
    coord[2] === Math.round(centroid[2])
  );

  // If exact center not in coords, find closest
  let finalCenterIndex = centerIndex;
  if (centerIndex === -1) {
    let minDist = Infinity;
    coords.forEach((coord, idx) => {
      const dist = Math.sqrt(
        (coord[0] - centroid[0]) ** 2 +
        (coord[1] - centroid[1]) ** 2 +
        (coord[2] - centroid[2]) ** 2
      );
      if (dist < minDist) {
        minDist = dist;
        finalCenterIndex = idx;
      }
    });
  }

  return new ROIVolWindow(space, coords, data, finalCenterIndex);
}

/**
 * Creates a cuboidal ROI centered at the given coordinates.
 * 
 * @param vol - The NeuroVol representing the volume
 * @param centroid - The center voxel coordinates [i, j, k]
 * @param surround - Number of voxels to surround the centroid in each dimension.
 *                   Can be a single number (same for all dimensions) or an array of three numbers
 * @param fill - Optional value(s) to assign to the data slot. Defaults to 1
 * @param nonzero - If true, only include voxels with non-zero values from the source volume
 * @returns An ROIVolWindow representing the cuboidal ROI
 */
export function cuboidROI(
  vol: NeuroVol,
  centroid: number[],
  surround: number | number[],
  fill: number = 1,
  nonzero: boolean = false
): ROIVolWindow {
  if (centroid.length !== 3) {
    throw new ValueError('Centroid must have length 3');
  }

  const space = vol.space;
  const dims = space.dim;
  const surroundArray = Array.isArray(surround)
    ? surround
    : [surround, surround, surround];

  if (surroundArray.length !== 3) {
    throw new ValueError('Surround must be a single number or an array of three numbers');
  }

  const coords: number[][] = [];

  // Calculate bounds
  const start = centroid.map((c, idx) => Math.max(0, c - surroundArray[idx]));
  const end = centroid.map((c, idx) => Math.min(dims[idx] - 1, c + surroundArray[idx]));

  // Iterate through the cuboid
  for (let i = start[0]; i <= end[0]; i++) {
    for (let j = start[1]; j <= end[1]; j++) {
      for (let k = start[2]; k <= end[2]; k++) {
        // Check nonzero constraint if needed
        if (!nonzero || vol.getAt(i, j, k) !== 0) {
          coords.push([i, j, k]);
        }
      }
    }
  }

  if (coords.length === 0) {
    throw new ValueError('No voxels found within the specified cuboid');
  }

  // Create data array
  const data = new Float32Array(coords.length).fill(fill);

  // Find center index
  const centerIndex = coords.findIndex(coord =>
    coord[0] === centroid[0] &&
    coord[1] === centroid[1] &&
    coord[2] === centroid[2]
  );

  if (centerIndex === -1) {
    throw new ValueError('Centroid is not within the ROI (possibly excluded by nonzero constraint)');
  }

  return new ROIVolWindow(space, coords, data, centerIndex);
}

/**
 * Creates a square ROI with a fixed dimension (e.g., z-dimension).
 * This creates a 2D square in the plane perpendicular to the fixed dimension.
 * 
 * @param vol - The NeuroVol representing the volume
 * @param centroid - The center voxel coordinates [i, j, k]
 * @param surround - Number of voxels around the center voxel
 * @param fixDim - The dimension to fix (0 for x, 1 for y, 2 for z)
 * @param fill - Optional value to assign to the data slot. Defaults to 1
 * @param nonzero - If true, only include voxels with non-zero values
 * @returns An ROIVolWindow representing the square ROI
 */
export function squareROI(
  vol: NeuroVol,
  centroid: number[],
  surround: number,
  fixDim: number = 2,
  fill: number = 1,
  nonzero: boolean = false
): ROIVolWindow {
  if (centroid.length !== 3) {
    throw new ValueError('Centroid must have length 3');
  }
  
  if (fixDim < 0 || fixDim > 2) {
    throw new ValueError('fixDim must be 0, 1, or 2');
  }

  const space = vol.space;
  const dims = space.dim;
  const coords: number[][] = [];

  // Determine which dimensions to vary
  const varyDims = [0, 1, 2].filter(d => d !== fixDim);
  
  // Calculate bounds for the varying dimensions
  const start = [0, 0];
  const end = [0, 0];
  
  start[0] = Math.max(0, centroid[varyDims[0]] - surround);
  end[0] = Math.min(dims[varyDims[0]] - 1, centroid[varyDims[0]] + surround);
  start[1] = Math.max(0, centroid[varyDims[1]] - surround);
  end[1] = Math.min(dims[varyDims[1]] - 1, centroid[varyDims[1]] + surround);

  // Iterate through the square
  for (let a = start[0]; a <= end[0]; a++) {
    for (let b = start[1]; b <= end[1]; b++) {
      const coord = [0, 0, 0];
      coord[fixDim] = centroid[fixDim];
      coord[varyDims[0]] = a;
      coord[varyDims[1]] = b;
      
      // Check nonzero constraint if needed
      if (!nonzero || vol.getAt(coord[0], coord[1], coord[2]) !== 0) {
        coords.push(coord);
      }
    }
  }

  if (coords.length === 0) {
    throw new ValueError('No voxels found within the specified square');
  }

  // Create data array
  const data = new Float32Array(coords.length).fill(fill);

  // Find center index
  const centerIndex = coords.findIndex(coord =>
    coord[0] === centroid[0] &&
    coord[1] === centroid[1] &&
    coord[2] === centroid[2]
  );

  if (centerIndex === -1) {
    throw new ValueError('Centroid is not within the ROI (possibly excluded by nonzero constraint)');
  }

  return new ROIVolWindow(space, coords, data, centerIndex);
}

/**
 * Creates an ROI from a logical/binary volume (mask).
 * 
 * @param mask - A LogicalNeuroVol representing the mask
 * @param fill - Optional value to assign to the data slot. Defaults to 1
 * @returns An ROIVol containing all true voxels from the mask
 */
export function roiFromMask(
  mask: LogicalNeuroVol,
  fill: number = 1
): ROIVol {
  const coords = mask.getTrueCoords();
  
  if (coords.length === 0) {
    throw new ValueError('Mask contains no true voxels');
  }
  
  const data = new Float32Array(coords.length).fill(fill);
  return new ROIVol(data, mask.space, coords);
}

/**
 * Creates an ROI from a set of linear indices.
 * 
 * @param space - The NeuroSpace defining the coordinate system
 * @param indices - Array of linear indices
 * @param fill - Optional value to assign to the data slot. Defaults to 1
 * @returns An ROIVol containing the specified voxels
 */
export function roiFromIndices(
  space: NeuroSpace,
  indices: number[],
  fill: number = 1
): ROIVol {
  const coords = indices.map(idx => space.indexToGrid(idx));
  const data = new Float32Array(coords.length).fill(fill);
  return new ROIVol(data, space, coords);
}

/**
 * Creates an ROI from a set of coordinates.
 * 
 * @param space - The NeuroSpace defining the coordinate system
 * @param coords - Array of [i, j, k] coordinates
 * @param data - Optional data values for each coordinate. If not provided, fills with 1
 * @returns An ROIVol or ROICoords depending on whether data is provided
 */
export function roiFromCoords(
  space: NeuroSpace,
  coords: number[][],
  data?: TypedArray | number[]
): ROIVol | ROICoords {
  if (data) {
    return new ROIVol(data, space, coords);
  } else {
    return new ROICoords(coords, space);
  }
}
