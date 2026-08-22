/**
 * Searchlight functionality for neuroimaging analysis.
 * 
 * This module provides searchlight iterators for analyzing local neighborhoods
 * of voxels within brain masks. Includes exhaustive, random, and clustered
 * searchlight implementations.
 * 
 * Direct translation of Python's pyneuroim searchlight functions.
 */

import { NeuroVol } from '../volume/NeuroVol';
import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { ROIVolWindow } from '../roi/ROI_improved';
import { sphericalROI } from '../roi/ROI_factories';
import { LazyList } from '../utils/LazyList';
import { SearchlightWorkerPool } from './WorkerPool';

/**
 * Options for searchlight analysis
 */
export interface SearchlightOptions {
  /** Whether to eagerly compute the searchlight ROIs */
  eager?: boolean;
  /** Whether to include only coordinates with nonzero values */
  nonzero?: boolean;
  /** Number of cores/workers to use for parallel computation */
  cores?: number;
  /** Progress callback */
  onProgress?: (progress: number) => void;
}

function validateSearchlightArguments(radius: number, cores = 0): void {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError('radius must be a finite, non-negative number');
  }
  if (!Number.isSafeInteger(cores) || cores < 0) {
    throw new RangeError('cores must be a non-negative integer');
  }
}

function unflattenCoordinates(flat: Int32Array): number[][] {
  const coordinates = new Array<number[]>(flat.length / 3);
  for (let i = 0, outputIndex = 0; i < flat.length; i += 3, outputIndex++) {
    coordinates[outputIndex] = [flat[i], flat[i + 1], flat[i + 2]];
  }
  return coordinates;
}

/**
 * Create an exhaustive searchlight iterator.
 * 
 * This function generates an exhaustive searchlight iterator that returns
 * ROIVolWindow objects for each searchlight sphere within the provided mask.
 * The iterator visits every non-zero voxel in the mask as a potential center voxel.
 * 
 * @param mask - A NeuroVol object representing the brain mask
 * @param radius - The radius (in mm) of the spherical searchlight
 * @param options - Searchlight options
 * @returns A lazy list or array of ROIVolWindow objects
 */
function ensureLogicalMask(mask: NeuroVol | LogicalNeuroVol): LogicalNeuroVol {
  if (mask instanceof LogicalNeuroVol) {
    return mask;
  }

  const source = mask.getData();
  const boolData = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) {
    boolData[i] = source[i] !== 0 ? 1 : 0;
  }
  return new LogicalNeuroVol(mask.space, boolData);
}

export function searchlightIterator(
  mask: NeuroVol | LogicalNeuroVol,
  radius: number,
  options: SearchlightOptions = {}
): LazyList<ROIVolWindow> | ROIVolWindow[] | Promise<ROIVolWindow[]> {
  const { eager = false, nonzero = false, cores = 0, onProgress } = options;
  validateSearchlightArguments(radius, cores);

  // Convert to LogicalNeuroVol if needed
  const logicalMask = ensureLogicalMask(mask);
  

  // Get indices to iterate over
  let indices: number[];
  if (nonzero) {
    // Only iterate over nonzero voxels
    indices = [];
    const data = logicalMask.getData();
    for (let i = 0; i < data.length; i++) {
      if (data[i]) {
        indices.push(i);
      }
    }
    if (indices.length === 0) {
      console.warn('No nonzero voxels found in mask');
    }
  } else {
    // Iterate over all voxels
    indices = Array.from({ length: logicalMask.space.size }, (_, i) => i);
  }

  const generateSearchlight = (idx: number): ROIVolWindow => {
    // Get the center voxel index
    const centerIdx = indices[idx];

    // Get grid coordinates of center
    const centerGrid = logicalMask.space.indexToGrid(centerIdx);
    
    // Ensure centerGrid is a 3-element array
    const centerGrid3D: [number, number, number] = [
      centerGrid[0] || 0,
      centerGrid[1] || 0,
      centerGrid[2] || 0
    ];

    // Create spherical ROI around this center
    // sphericalROI already returns a ROIVolWindow, so we can return it directly
    return sphericalROI(logicalMask, centerGrid3D, radius);
  };

  if (eager) {
    // Eagerly compute all searchlights
    if (cores > 1) {
      // Use Web Workers for parallel processing
      return computeSearchlightsParallel(
        logicalMask,
        radius,
        indices,
        nonzero,
        cores,
        onProgress
      );
    } else {
      // Single-threaded processing
      const results: ROIVolWindow[] = [];
      for (let i = 0; i < indices.length; i++) {
        results.push(generateSearchlight(i));
        onProgress?.(i / indices.length);
      }
      onProgress?.(1.0);
      return results;
    }
  } else {
    // Return lazy list
    return new LazyList(generateSearchlight, indices.length);
  }
}

/**
 * Create an exhaustive searchlight iterator for voxel coordinates.
 * 
 * This function generates an exhaustive searchlight iterator that returns
 * voxel coordinates for each searchlight sphere within the provided mask.
 * 
 * @param mask - A NeuroVol object representing the brain mask
 * @param radius - The radius (in mm) of the spherical searchlight
 * @param options - Searchlight options
 * @returns A lazy list of coordinate arrays
 */
export async function searchlightCoords(
  mask: NeuroVol | LogicalNeuroVol,
  radius: number,
  options: SearchlightOptions = {}
): Promise<LazyList<Float32Array>> {
  const { nonzero = false, cores = 0 } = options;
  validateSearchlightArguments(radius, cores);

  // Convert to LogicalNeuroVol if needed
  const logicalMask = ensureLogicalMask(mask);

  // Get indices to iterate over
  let indices: number[];
  if (nonzero) {
    indices = [];
    const data = logicalMask.getData();
    for (let i = 0; i < data.length; i++) {
      if (data[i]) {
        indices.push(i);
      }
    }
  } else {
    indices = Array.from({ length: logicalMask.space.size }, (_, i) => i);
  }

  const generateCoords = (idx: number): Float32Array => {
    // Get the center voxel index
    const centerIdx = indices[idx];

    // Get grid coordinates of center
    const centerGrid = logicalMask.space.indexToGrid(centerIdx);
    
    // Ensure centerGrid is a 3-element array
    const centerGrid3D: [number, number, number] = [
      centerGrid[0] || 0,
      centerGrid[1] || 0,
      centerGrid[2] || 0
    ];

    // Create spherical ROI around this center
    const roi = sphericalROI(logicalMask, centerGrid3D, radius);

    // Return coordinates as flat Float32Array
    const flatCoords = new Float32Array(roi.coords.length * 3);
    for (let i = 0; i < roi.coords.length; i++) {
      flatCoords[i * 3] = roi.coords[i][0];
      flatCoords[i * 3 + 1] = roi.coords[i][1];
      flatCoords[i * 3 + 2] = roi.coords[i][2];
    }
    return flatCoords;
  };

  if (cores > 1) {
    // Generate all coords in parallel
    const coordsList = await computeCoordsParallel(
      logicalMask,
      radius,
      indices,
      nonzero,
      cores
    );
    // Return a pre-computed LazyList
    return new LazyList((i: number) => coordsList[i], coordsList.length);
  } else {
    // Return lazy list with deferred computation
    return new LazyList(generateCoords, indices.length);
  }
}

/**
 * Create a spherical random searchlight iterator.
 * 
 * This function generates a spherical random searchlight iterator
 * for analyzing local neighborhoods of voxels within a given radius
 * in a brain mask. The algorithm randomly selects centers and removes
 * all voxels within the searchlight from future consideration.
 * 
 * @param mask - A NeuroVol object representing the brain mask
 * @param radius - The radius of the searchlight sphere (in mm)
 * @returns Array of ROIVolWindow objects
 */
export function randomSearchlight(
  mask: NeuroVol | LogicalNeuroVol,
  radius: number
): ROIVolWindow[] {
  validateSearchlightArguments(radius);
  // Convert to LogicalNeuroVol if needed
  const logicalMask = ensureLogicalMask(mask);

  // Get all nonzero voxel indices
  const availableIndices = new Set<number>();
  const data = logicalMask.getData();
  for (let i = 0; i < data.length; i++) {
    if (data[i]) {
      availableIndices.add(i);
    }
  }

  const results: ROIVolWindow[] = [];

  while (availableIndices.size > 0) {
    // Randomly select a center from available indices
    const indicesArray = Array.from(availableIndices);
    const randomIdx = Math.floor(Math.random() * indicesArray.length);
    const centerIdx = indicesArray[randomIdx];

    // Get grid coordinates of center
    const centerGrid = logicalMask.space.indexToGrid(centerIdx);
    
    // Ensure centerGrid is a 3-element array
    const centerGrid3D: [number, number, number] = [
      centerGrid[0] || 0,
      centerGrid[1] || 0,
      centerGrid[2] || 0
    ];

    // Create spherical ROI around this center
    const roi = sphericalROI(logicalMask, centerGrid3D, radius);

    // Remove all voxels in this searchlight from available indices
    const coords = roi.coords;
    for (const coord of coords) {
      const idx = logicalMask.space.gridToIndex(coord);
      availableIndices.delete(idx);
    }

    // sphericalROI already returns a ROIVolWindow, but we need to update its parentIndex
    // Since we can't modify readonly properties, we'll use the returned ROI directly
    const window = roi;
    results.push(window);
  }

  return results;
}

/**
 * Create a clustered searchlight iterator.
 * 
 * This function generates a clustered searchlight iterator that creates
 * searchlights based on pre-defined clusters or regions.
 * 
 * @param mask - A NeuroVol object with cluster labels
 * @param radius - The radius of the searchlight sphere (in mm)
 * @returns Array of ROIVolWindow objects, one per cluster
 */
export function clusteredSearchlight(
  mask: NeuroVol,
  radius: number
): ROIVolWindow[] {
  validateSearchlightArguments(radius);
  const results: ROIVolWindow[] = [];
  const data = mask.getData();
  
  // Find unique cluster labels (excluding 0)
  const labels = new Set<number>();
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0) {
      labels.add(data[i]);
    }
  }

  // Create searchlight for each cluster
  for (const label of labels) {
    // Find center of mass for this cluster
    let sumX = 0, sumY = 0, sumZ = 0, count = 0;
    
    for (let z = 0; z < mask.space.dim[2]; z++) {
      for (let y = 0; y < mask.space.dim[1]; y++) {
        for (let x = 0; x < mask.space.dim[0]; x++) {
          const idx = mask.space.gridToIndex([x, y, z]);
          if (data[idx] === label) {
            sumX += x;
            sumY += y;
            sumZ += z;
            count++;
          }
        }
      }
    }

    if (count > 0) {
      const centerGrid: [number, number, number] = [
        Math.round(sumX / count),
        Math.round(sumY / count),
        Math.round(sumZ / count)
      ];
      
      // Create spherical ROI around cluster center
      const roi = sphericalROI(mask, centerGrid, radius);
      // sphericalROI already returns a ROIVolWindow
      const window = roi;
      results.push(window);
    }
  }

  return results;
}

/**
 * Create a bootstrap searchlight iterator.
 * 
 * This function generates a bootstrap searchlight iterator by randomly
 * sampling center voxels with replacement.
 * 
 * @param mask - A NeuroVol object representing the brain mask
 * @param radius - The radius of the searchlight sphere in mm (default: 8)
 * @param iter - Number of bootstrap iterations (default: 100)
 * @returns Array of ROIVolWindow objects
 */
export function bootstrapSearchlight(
  mask: NeuroVol | LogicalNeuroVol,
  radius: number = 8,
  iter: number = 100
): ROIVolWindow[] {
  validateSearchlightArguments(radius);
  if (!Number.isSafeInteger(iter) || iter < 0) {
    throw new RangeError('iter must be a non-negative integer');
  }
  // Convert to LogicalNeuroVol if needed
  const logicalMask = ensureLogicalMask(mask);

  // Get all nonzero voxel indices
  const maskIndices: number[] = [];
  const data = logicalMask.getData();
  for (let i = 0; i < data.length; i++) {
    if (data[i]) {
      maskIndices.push(i);
    }
  }

  const results: ROIVolWindow[] = [];

  if (iter > 0 && maskIndices.length === 0) {
    throw new Error('Cannot bootstrap searchlights from an empty mask');
  }

  // Sample with replacement
  for (let i = 0; i < iter; i++) {
    // Randomly select a center
    const randomIdx = Math.floor(Math.random() * maskIndices.length);
    const centerIdx = maskIndices[randomIdx];

    // Get grid coordinates of center
    const centerGrid = logicalMask.space.indexToGrid(centerIdx);
    
    // Ensure centerGrid is a 3-element array
    const centerGrid3D: [number, number, number] = [
      centerGrid[0] || 0,
      centerGrid[1] || 0,
      centerGrid[2] || 0
    ];

    // Create spherical ROI around this center
    const roi = sphericalROI(logicalMask, centerGrid3D, radius);

    // sphericalROI already returns a ROIVolWindow, but we need to update its parentIndex
    // Since we can't modify readonly properties, we'll use the returned ROI directly
    const window = roi;
    results.push(window);
  }

  return results;
}

/**
 * Compute searchlights in parallel using Web Workers
 */
async function computeSearchlightsParallel(
  mask: LogicalNeuroVol,
  radius: number,
  indices: number[],
  nonzero: boolean,
  cores: number,
  onProgress?: (progress: number) => void
): Promise<ROIVolWindow[]> {
  // Check if we're in a browser environment with Web Worker support
  if (typeof Worker === 'undefined') {
    console.warn('Web Workers not available, falling back to sequential processing');
    return computeSearchlightsSequential(mask, radius, indices, nonzero, onProgress);
  }

  const pool = new SearchlightWorkerPool({
    numWorkers: cores,
    onProgress
  });

  try {
    // Initialize workers
    await pool.initialize(mask, radius);

    // Compute searchlights in parallel
    const results = await pool.computeSearchlights(
      indices
    );

    // Convert results to ROIVolWindow objects
    return results.map(result => {
      return new ROIVolWindow(
        mask.space,
        unflattenCoordinates(result.coords),
        result.data,
        result.centerIdx
      );
    });
  } finally {
    pool.terminate();
  }
}

/**
 * Sequential searchlight computation fallback
 */
function computeSearchlightsSequential(
  mask: LogicalNeuroVol,
  radius: number,
  indices: number[],
  nonzero: boolean,
  onProgress?: (progress: number) => void
): ROIVolWindow[] {
  const results: ROIVolWindow[] = [];
  for (let i = 0; i < indices.length; i++) {
    const centerIdx = indices[i];
    const centerGrid = mask.space.indexToGrid(centerIdx);
    
    // Ensure centerGrid is a 3-element array
    const centerGrid3D: [number, number, number] = [
      centerGrid[0] || 0,
      centerGrid[1] || 0,
      centerGrid[2] || 0
    ];
    
    const roi = sphericalROI(mask, centerGrid3D, radius);
    
    // sphericalROI already returns a ROIVolWindow
    results.push(roi);
    onProgress?.(i / indices.length);
  }
  onProgress?.(1.0);
  
  return results;
}

/**
 * Compute coordinates in parallel using Web Workers
 */
async function computeCoordsParallel(
  mask: LogicalNeuroVol,
  radius: number,
  indices: number[],
  nonzero: boolean,
  cores: number
): Promise<Float32Array[]> {
  // Check if we're in a browser environment with Web Worker support
  if (typeof Worker === 'undefined') {
    // Fallback to sequential processing
    const results: Float32Array[] = [];
    
    for (let i = 0; i < indices.length; i++) {
      const centerIdx = nonzero ? indices[i] : i;
      const centerGrid = mask.space.indexToGrid(centerIdx);
      
      // Ensure centerGrid is a 3-element array
      const centerGrid3D: [number, number, number] = [
        centerGrid[0] || 0,
        centerGrid[1] || 0,
        centerGrid[2] || 0
      ];
      
      const roi = sphericalROI(mask, centerGrid3D, radius);
      
      // Convert coordinates to flat Float32Array
      const flatCoords = new Float32Array(roi.coords.length * 3);
      for (let i = 0; i < roi.coords.length; i++) {
        flatCoords[i * 3] = roi.coords[i][0];
        flatCoords[i * 3 + 1] = roi.coords[i][1];
        flatCoords[i * 3 + 2] = roi.coords[i][2];
      }
      results.push(flatCoords);
    }
    
    return results;
  }

  const pool = new SearchlightWorkerPool({
    numWorkers: cores
  });

  try {
    // Initialize workers
    await pool.initialize(mask, radius);

    // Compute coordinates in parallel
    const results = await pool.computeSearchlights(
      indices
    );

    // Extract just the coordinates
    return results.map(result => Float32Array.from(result.coords));
  } finally {
    pool.terminate();
  }
}
