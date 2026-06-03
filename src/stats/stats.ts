/**
 * Statistical operations for neuroimaging data.
 * 
 * This module provides functions for splitting, partitioning, and
 * analyzing neuroimaging data using various statistical approaches.
 * 
 * Direct translation of Python's pyneuroim statistical functions.
 */

import { NeuroVol } from '../volume/NeuroVol';
import { NeuroVec, Float32NeuroVec } from '../vec/NeuroVec';
import { SparseNeuroVec } from '../vec/SparseNeuroVec';
import { FloatNeuroVol, DenseNeuroVol } from '../volume/DenseNeuroVol';
import { SparseNeuroVol } from '../sparse/SparseNeuroVol';
import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { ClusteredNeuroVol } from '../volume/ClusteredNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { ROIVol } from '../roi/ROI_improved';
import { TypedArray, ValueError } from '../types';

/**
 * Helper function to create ClusteredNeuroVol from a volume containing cluster IDs.
 * 
 * @param vol - Volume where each voxel value is a cluster ID (0 for background)
 * @param labelMap - Optional mapping from cluster IDs to names
 * @returns ClusteredNeuroVol instance
 */
function clusteredNeuroVolFromDense(
  vol: NeuroVol,
  labelMap?: Map<number, string>
): ClusteredNeuroVol {
  const data = vol.getData();
  
  // Find non-zero voxels (mask)
  const maskIndices: number[] = [];
  const clusterIds: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) {
      maskIndices.push(i);
      clusterIds.push(data[i]);
    }
  }
  
  // Create mask
  const maskData = new Uint8Array(data.length);
  for (const idx of maskIndices) {
    maskData[idx] = 1;
  }
  const mask = new LogicalNeuroVol(vol.space, maskData);
  
  // Create label map if not provided
  const finalLabelMap: Record<string, number> = {};
  if (!labelMap) {
    const uniqueIds = Array.from(new Set(clusterIds));
    for (const id of uniqueIds) {
      finalLabelMap[`Cluster${id}`] = id;
    }
  } else {
    // Convert Map to object - Map has id as key and name as value
    for (const [id, name] of labelMap) {
      finalLabelMap[name] = id;
    }
  }
  
  return new ClusteredNeuroVol(mask, new Int32Array(clusterIds), finalLabelMap);
}

/**
 * Split a NeuroVol or NeuroVec into blocks using indices.
 * 
 * Creates separate volumes/vectors for each unique block ID, where each
 * block contains only the data from voxels with that block ID.
 * 
 * @param x - The data to split
 * @param indices - 1D indices into the data array
 * @param blockIds - Block ID for each index (same length as indices)
 * @returns List of blocks, one for each unique block ID
 */
export function splitBlocks(
  x: NeuroVol | NeuroVec,
  indices: Uint32Array | Int32Array,
  blockIds: Int32Array
): Array<NeuroVol | NeuroVec> {
  if (indices.length !== blockIds.length) {
    throw new ValueError('indices and blockIds must have same length');
  }

  const uniqueBlocks = Array.from(new Set(blockIds));
  const blocks: Array<NeuroVol | NeuroVec> = [];

  for (const blockId of uniqueBlocks) {
    // Get indices for this block
    const blockIndices: number[] = [];
    for (let i = 0; i < blockIds.length; i++) {
      if (blockIds[i] === blockId) {
        blockIndices.push(indices[i]);
      }
    }

    if ('getVolume' in x) {
      // NeuroVec case
      const vec = x as NeuroVec;
      
      // Create array to hold time series for this block
      const nTimepoints = vec.dim[3]; // Time is the 4th dimension (X,Y,Z,T)
      const blockSeries = new Float32Array(blockIndices.length * nTimepoints);
      
      // Extract time series for each voxel in the block
      const spatialDims = vec.dim.slice(0, 3); // X,Y,Z dimensions
      const spatialSize = spatialDims.reduce((a, b) => a * b, 1);
      
      for (let i = 0; i < blockIndices.length; i++) {
        const idx = blockIndices[i];
        
        // Convert linear index to 3D coordinates (Fortran order)
        const z = Math.floor(idx / (spatialDims[0] * spatialDims[1]));
        const remainder = idx % (spatialDims[0] * spatialDims[1]);
        const y = Math.floor(remainder / spatialDims[0]);
        const x = remainder % spatialDims[0];
        
        // Extract time series for this voxel
        for (let t = 0; t < nTimepoints; t++) {
          blockSeries[i * nTimepoints + t] = vec.getAt(x, y, z, t);
        }
      }
      
      // Create mask for this block
      const maskData = new Uint8Array(spatialSize);
      for (const idx of blockIndices) {
        maskData[idx] = 1;
      }
      
      const maskSpace = new NeuroSpace(spatialDims, vec.spacing.slice(1), vec.origin.slice(1));
      const mask = new LogicalNeuroVol(maskSpace, maskData);
      
      // Create SparseNeuroVec for this block
      // Convert flat array to Map<number, number[]> for SparseNeuroVec
      const voxelDataMap = new Map<number, number[]>();
      for (let i = 0; i < blockIndices.length; i++) {
        const timeSeries: number[] = [];
        for (let t = 0; t < nTimepoints; t++) {
          timeSeries.push(blockSeries[i * nTimepoints + t]);
        }
        voxelDataMap.set(blockIndices[i], timeSeries);
      }
      
      const blockVec = new SparseNeuroVec(
        new NeuroSpace([spatialDims[0], spatialDims[1], spatialDims[2], nTimepoints], 
                       [...vec.spacing.slice(1), vec.spacing[0]], 
                       [...vec.origin.slice(1), vec.origin[0]]),
        voxelDataMap
      );
      
      blocks.push(blockVec);
      
    } else {
      // NeuroVol case
      const vol = x as NeuroVol;
      const blockData = new Float32Array(blockIndices.length);
      
      // Extract data for this block
      const flatData = vol.getData();
      for (let i = 0; i < blockIndices.length; i++) {
        blockData[i] = flatData[blockIndices[i]];
      }
      
      // Create SparseNeuroVol for this block
      const blockVol = new SparseNeuroVol(
        vol.space,
        'float32',
        0,
        blockIndices,
        Array.from(blockData)
      );
      
      blocks.push(blockVol);
    }
  }

  return blocks;
}

/**
 * Split data into ROIs based on cluster labels.
 * 
 * Creates a list of ROIVol objects, one for each cluster, containing
 * the data values from the input volume/vector.
 * 
 * @param x - The data to split
 * @param clusters - Volume containing integer cluster labels
 * @returns List of ROI volumes, one for each cluster
 */
export function splitClusters(
  x: NeuroVol | NeuroVec,
  clusters: ClusteredNeuroVol | NeuroVol
): ROIVol[] {
  // For NeuroVec, compare spatial dimensions only
  if ('getVolume' in x) {
    const vec = x as NeuroVec;
    const spatialDims = vec.dim.slice(0, 3); // X,Y,Z dimensions
    if (!spatialDims.every((d, i) => d === clusters.space.dim[i])) {
      throw new ValueError('x and clusters must have same spatial dimensions');
    }
  } else {
    const vol = x as NeuroVol;
    if (!vol.space.isEqualTo(clusters.space)) {
      throw new ValueError('x and clusters must have same space');
    }
  }

  // Get cluster labels
  let clusterData: TypedArray;
  let uniqueLabels: number[];
  
  if (clusters instanceof ClusteredNeuroVol) {
    uniqueLabels = Array.from(Object.values(clusters.labelMap));
    clusterData = clusters.asDense().getData();
  } else {
    clusterData = clusters.getData();
    const labelSet = new Set<number>();
    for (let i = 0; i < clusterData.length; i++) {
      if (clusterData[i] > 0) {
        labelSet.add(clusterData[i]);
      }
    }
    uniqueLabels = Array.from(labelSet);
  }

  const rois: ROIVol[] = [];

  for (const label of uniqueLabels) {
    if (label === 0) continue; // Skip background

    // Get voxel coordinates for this cluster
    const coords: Array<[number, number, number]> = [];
    const values: number[] = [];
    
    for (let z = 0; z < clusters.space.dim[2]; z++) {
      for (let y = 0; y < clusters.space.dim[1]; y++) {
        for (let xCoord = 0; xCoord < clusters.space.dim[0]; xCoord++) {
          const idx = clusters.space.gridToIndex([xCoord, y, z]);
          if (clusterData[idx] === label) {
            coords.push([xCoord, y, z]);
            
            // Extract data value
            if ('getVolume' in x) {
              // For NeuroVec, average time series
              const vec = x as NeuroVec;
              let sum = 0;
              const nTimepoints = vec.dim[3]; // Time is the 4th dimension
              for (let t = 0; t < nTimepoints; t++) {
                sum += vec.getAt(xCoord, y, z, t);
              }
              values.push(sum / nTimepoints);
            } else {
              // For NeuroVol, extract value directly
              const vol = x as NeuroVol;
              values.push(vol.getAt(xCoord, y, z));
            }
          }
        }
      }
    }

    // Skip empty clusters
    if (coords.length === 0) {
      continue;
    }
    
    // Create ROIVol
    const data = new Float32Array(values);
    
    const space = clusters instanceof ClusteredNeuroVol ? clusters.space : clusters.space;
    const roi = new ROIVol(data, space, coords);
    rois.push(roi);
  }

  return rois;
}

/**
 * Split a NeuroVec by factor levels and fill a new NeuroVec.
 * 
 * Splits the input NeuroVec according to levels of a factor, creating
 * a new NeuroVec for each level containing only the volumes from that level.
 * 
 * @param x - The 4D data to split
 * @param fac - Factor array with length equal to number of volumes
 * @returns Dictionary mapping factor levels to NeuroVec objects
 */
export function splitFill(
  x: NeuroVec,
  fac: Int32Array | Float32Array
): Map<number, NeuroVec> {
  const nVolumes = x.dim[3]; // Time is the 4th dimension (X,Y,Z,T)
  
  if (fac.length !== nVolumes) {
    throw new ValueError(`Length of factor (${fac.length}) must equal number of volumes (${nVolumes})`);
  }

  const levels = Array.from(new Set(fac));
  const result = new Map<number, NeuroVec>();

  for (const level of levels) {
    // Get indices for this level
    const levelIndices: number[] = [];
    for (let i = 0; i < fac.length; i++) {
      if (fac[i] === level) {
        levelIndices.push(i);
      }
    }

    const nLevelVolumes = levelIndices.length;

    if (x instanceof SparseNeuroVec) {
      // For sparse vectors, we need to handle the Map-based data structure
      // Create new space with updated time dimension (X,Y,Z,T ordering)
      const newDim = [...x.dim.slice(0, 3), nLevelVolumes];
      const newSpace = new NeuroSpace(newDim, x.spacing, x.origin);
      
      // Convert to Map format for SparseNeuroVec
      const voxelDataMap = new Map<number, number[]>();
      const sparseVec = x as SparseNeuroVec;
      
      // Copy only the selected time points for each voxel
      for (const [voxelIdx, timeSeries] of sparseVec.getData()) {
        const newTimeSeries: number[] = [];
        for (const timeIdx of levelIndices) {
          if (timeIdx < timeSeries.length) {
            newTimeSeries.push(timeSeries[timeIdx]);
          }
        }
        voxelDataMap.set(voxelIdx, newTimeSeries);
      }
      
      const levelVec = new SparseNeuroVec(newSpace, voxelDataMap);
      result.set(level, levelVec);
    } else {
      // For dense, extract the relevant volumes (X,Y,Z,T ordering)
      const spatialSize = x.dim[0] * x.dim[1] * x.dim[2]; // X*Y*Z
      const subsetData = new Float32Array(spatialSize * nLevelVolumes);
      
      // Copy data for selected time points
      const srcData = x.getData();
      for (let i = 0; i < spatialSize; i++) {
        for (let t = 0; t < nLevelVolumes; t++) {
          const srcTimeIdx = levelIndices[t];
          const srcIdx = i + srcTimeIdx * spatialSize;
          const dstIdx = i + t * spatialSize;
          subsetData[dstIdx] = srcData[srcIdx];
        }
      }

      // Create new space with updated time dimension (X,Y,Z,T ordering)
      const newDim = [...x.dim.slice(0, 3), nLevelVolumes];
      const newSpace = new NeuroSpace(newDim, x.spacing, x.origin);
      
      const levelVec = new Float32NeuroVec(newSpace, subsetData);
      result.set(level, levelVec);
    }
  }

  return result;
}

/**
 * Reduce a NeuroVec by applying a function across factor levels.
 * 
 * Splits the NeuroVec by factor levels and applies a reduction function
 * to each voxel's time series within each level, returning a volume
 * where each voxel contains the reduced value.
 * 
 * @param x - The 4D data to reduce
 * @param fac - Factor array with length equal to number of volumes
 * @param FUN - Function to apply to each voxel's values within a level
 * @returns Volume containing reduced values
 */
export function splitReduce(
  x: NeuroVec,
  fac: Int32Array | Float32Array,
  FUN: (values: Float32Array) => number
): NeuroVol {
  const nVolumes = x.dim[3]; // Time is the 4th dimension (X,Y,Z,T)
  
  if (fac.length !== nVolumes) {
    throw new ValueError(`Length of factor (${fac.length}) must equal number of volumes (${nVolumes})`);
  }

  // Create 3D space for output volume (X,Y,Z)
  const volSpace = new NeuroSpace(
    x.dim.slice(0, 3),
    x.spacing.slice(0, 3),
    x.origin.slice(0, 3)
  );

  // Get unique levels
  const uniqueLevels = Array.from(new Set(fac));
  
  if ('getData' in x && x.getData && !('voxelData' in x)) { // Check if it's a dense vector
    // Initialize output array
    const outData = new Float32Array(volSpace.size);
    const srcData = x.getData();
    
    // Process each voxel
    const spatialSize = volSpace.size;
    for (let voxIdx = 0; voxIdx < spatialSize; voxIdx++) {
      const reducedValues: number[] = [];
      
      // Apply function to each level
      for (const level of uniqueLevels) {
        const levelValues: number[] = [];
        
        for (let t = 0; t < nVolumes; t++) {
          if (fac[t] === level) {
            levelValues.push(srcData[t * spatialSize + voxIdx]);
          }
        }
        
        if (levelValues.length > 0) {
          reducedValues.push(FUN(new Float32Array(levelValues)));
        }
      }
      
      // Store mean of reduced values
      if (reducedValues.length > 0) {
        outData[voxIdx] = reducedValues.reduce((a, b) => a + b, 0) / reducedValues.length;
      }
    }
    
    return new FloatNeuroVol(volSpace, outData);
    
  } else if (x instanceof SparseNeuroVec) {
    // Handle sparse case
    const outIndices: number[] = [];
    const outValues: number[] = [];
    const sparseVec = x as SparseNeuroVec;
    const voxelData = sparseVec.getData();
    
    // Process each stored voxel
    for (const [voxIdx, timeSeries] of voxelData) {
      const reducedValues: number[] = [];
      
      // Apply function to each level
      for (const level of uniqueLevels) {
        const levelValues: number[] = [];
        
        for (let t = 0; t < nVolumes; t++) {
          if (fac[t] === level && t < timeSeries.length) {
            levelValues.push(timeSeries[t]);
          }
        }
        
        if (levelValues.length > 0) {
          reducedValues.push(FUN(new Float32Array(levelValues)));
        }
      }
      
      // Store mean of reduced values
      if (reducedValues.length > 0) {
        outIndices.push(voxIdx); // voxIdx is already the index from the Map key
        outValues.push(reducedValues.reduce((a, b) => a + b, 0) / reducedValues.length);
      }
    }
    
    if (outIndices.length > 0) {
      return new SparseNeuroVol(
        volSpace,
        'float32',
        0,
        outIndices,
        outValues
      );
    } else {
      return new FloatNeuroVol(volSpace, new Float32Array(volSpace.size));
    }
  }
  
  throw new ValueError('Unsupported NeuroVec type');
}

/**
 * Scale a NeuroVec within factor levels.
 * 
 * Centers and/or scales the data within each level of a factor,
 * returning a new NeuroVec with the transformed data.
 * 
 * @param x - The 4D data to scale
 * @param fac - Factor array with length equal to number of volumes
 * @param center - Whether to center (subtract mean) within each level
 * @param scale - Whether to scale (divide by SD) within each level
 * @returns Scaled NeuroVec
 */
export function splitScale(
  x: NeuroVec,
  fac: Int32Array | Float32Array,
  center: boolean = true,
  scale: boolean = true
): NeuroVec {
  const nVolumes = x.dim[3]; // Time is the 4th dimension (X,Y,Z,T)
  
  if (fac.length !== nVolumes) {
    throw new ValueError(`Length of factor (${fac.length}) must equal number of volumes (${nVolumes})`);
  }

  // Get unique levels
  const uniqueLevels = Array.from(new Set(fac));
  
  if ('getData' in x && x.getData && !('voxelData' in x)) { // Check if it's a dense vector
    // Copy data
    const srcData = x.getData();
    const scaledData = new Float32Array(srcData);
    const spatialSize = x.dim.slice(0, 3).reduce((a, b) => a * b, 1); // X*Y*Z for X,Y,Z,T ordering
    
    // Process each level
    for (const level of uniqueLevels) {
      const levelIndices: number[] = [];
      for (let i = 0; i < fac.length; i++) {
        if (fac[i] === level) {
          levelIndices.push(i);
        }
      }
      
      if (levelIndices.length < 2) continue; // Skip if too few samples
      
      // Process each voxel
      for (let voxIdx = 0; voxIdx < spatialSize; voxIdx++) {
        // Extract values for this level
        const levelValues = new Float32Array(levelIndices.length);
        for (let i = 0; i < levelIndices.length; i++) {
          // For X,Y,Z,T ordering: index = voxIdx + timeIdx * spatialSize
          levelValues[i] = scaledData[voxIdx + levelIndices[i] * spatialSize];
        }
        
        // Compute mean and SD
        let mean = 0;
        if (center) {
          mean = levelValues.reduce((a, b) => a + b, 0) / levelValues.length;
        }
        
        let sd = 1;
        if (scale) {
          const variance = levelValues.reduce((sum, val) => {
            const diff = val - mean;
            return sum + diff * diff;
          }, 0) / (levelValues.length - 1);
          sd = Math.sqrt(variance);
          if (sd === 0) sd = 1; // Avoid division by zero
        }
        
        // Apply scaling
        for (let i = 0; i < levelIndices.length; i++) {
          // For X,Y,Z,T ordering: index = voxIdx + timeIdx * spatialSize
          const idx = voxIdx + levelIndices[i] * spatialSize;
          scaledData[idx] = (scaledData[idx] - mean) / sd;
        }
      }
    }
    
    return new Float32NeuroVec(x.space, scaledData);
    
  } else if (x instanceof SparseNeuroVec) {
    // Handle sparse case
    const sparseVec = x as SparseNeuroVec;
    const voxelDataMap = new Map<number, number[]>();
    
    // Copy original data
    for (const [voxIdx, timeSeries] of sparseVec.getData()) {
      voxelDataMap.set(voxIdx, [...timeSeries]);
    }
    
    // Process each level
    for (const level of uniqueLevels) {
      const levelIndices: number[] = [];
      for (let i = 0; i < fac.length; i++) {
        if (fac[i] === level) {
          levelIndices.push(i);
        }
      }
      
      if (levelIndices.length < 2) continue;
      
      // Process each voxel
      for (const [voxIdx, timeSeries] of voxelDataMap) {
        // Extract values for this level
        const levelValues = new Float32Array(levelIndices.length);
        for (let i = 0; i < levelIndices.length; i++) {
          levelValues[i] = timeSeries[levelIndices[i]];
        }
        
        // Compute mean and SD
        let mean = 0;
        if (center) {
          mean = levelValues.reduce((a, b) => a + b, 0) / levelValues.length;
        }
        
        let sd = 1;
        if (scale) {
          const variance = levelValues.reduce((sum, val) => {
            const diff = val - mean;
            return sum + diff * diff;
          }, 0) / (levelValues.length - 1);
          sd = Math.sqrt(variance);
          if (sd === 0) sd = 1;
        }
        
        // Apply scaling
        for (let i = 0; i < levelIndices.length; i++) {
          timeSeries[levelIndices[i]] = (levelValues[i] - mean) / sd;
        }
      }
    }
    
    return new SparseNeuroVec(x.space, voxelDataMap);
  }
  
  throw new ValueError('Unsupported NeuroVec type');
}

/**
 * Partition a volume into k regions using clustering.
 * 
 * Uses clustering algorithms to partition the brain volume into
 * k distinct regions based on voxel values.
 * 
 * @param x - The volume to partition
 * @param k - Number of partitions/clusters
 * @param method - Clustering method (currently only "kmeans")
 * @param mask - Optional mask to restrict clustering to specific voxels
 * @returns Clustered volume with partition labels
 */
export function partition(
  x: NeuroVol,
  k: number,
  method: string = 'kmeans',
  mask?: LogicalNeuroVol
): ClusteredNeuroVol {
  // Get mask - either provided or non-zero voxels
  let maskData: Uint8Array;
  if (mask) {
    maskData = mask.getData() as Uint8Array;
  } else {
    const data = x.getData();
    maskData = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      maskData[i] = data[i] !== 0 ? 1 : 0;
    }
  }

  // Get masked values
  const maskIndices: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < maskData.length; i++) {
    if (maskData[i]) {
      maskIndices.push(i);
      values.push(x.getData()[i]);
    }
  }

  if (values.length < k) {
    throw new ValueError(`Number of non-zero voxels (${values.length}) is less than k (${k})`);
  }

  if (method === 'kmeans') {
    // Simple k-means implementation
    const labels = simpleKMeans(values, k);
    
    // Create label array
    const labelArray = new Float32Array(x.space.size);
    for (let i = 0; i < maskIndices.length; i++) {
      labelArray[maskIndices[i]] = labels[i] + 1; // 1-indexed
    }
    
    // Create label map
    const labelMap = new Map<number, string>();
    for (let i = 1; i <= k; i++) {
      labelMap.set(i, `Cluster${i}`);
    }
    
    // Create clustered volume
    const labelVol = new FloatNeuroVol(x.space, labelArray);
    return clusteredNeuroVolFromDense(labelVol, labelMap);
  } else {
    throw new ValueError(`Unknown method: ${method}`);
  }
}

/**
 * Simple k-means clustering implementation.
 * For production use, consider using a proper ML library.
 */
function simpleKMeans(values: number[], k: number): number[] {
  const n = values.length;
  const labels = new Array(n).fill(0);
  
  // Initialize centers randomly
  const centers = new Float32Array(k);
  const indices = new Set<number>();
  while (indices.size < k) {
    indices.add(Math.floor(Math.random() * n));
  }
  let i = 0;
  for (const idx of indices) {
    centers[i++] = values[idx];
  }
  
  // Iterate until convergence
  let changed = true;
  let iterations = 0;
  const maxIterations = 100;
  
  while (changed && iterations < maxIterations) {
    changed = false;
    
    // Assign points to nearest center
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let bestLabel = 0;
      
      for (let j = 0; j < k; j++) {
        const dist = Math.abs(values[i] - centers[j]);
        if (dist < minDist) {
          minDist = dist;
          bestLabel = j;
        }
      }
      
      if (labels[i] !== bestLabel) {
        labels[i] = bestLabel;
        changed = true;
      }
    }
    
    // Update centers
    const counts = new Array(k).fill(0);
    centers.fill(0);
    
    for (let i = 0; i < n; i++) {
      centers[labels[i]] += values[i];
      counts[labels[i]]++;
    }
    
    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) {
        centers[j] /= counts[j];
      }
    }
    
    iterations++;
  }
  
  return labels;
}

/**
 * Map values in a volume using a lookup table.
 * 
 * Replaces values in the volume according to a lookup map.
 * 
 * @param x - The volume to transform
 * @param lookup - Map of old values to new values
 * @returns Volume with mapped values
 */
export function mapValues(
  x: NeuroVol,
  lookup: Map<number, number>
): NeuroVol {
  if (x instanceof SparseNeuroVol) {
    // For sparse volumes, we need to work with the sparse data structure
    const sparseVol = x as SparseNeuroVol;
    const indices: number[] = [];
    const values: number[] = [];
    
    // Get the full data to find sparse values
    const data = sparseVol.getData();
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) { // Non-default value
        const newVal = lookup.get(data[i]);
        const mappedVal = newVal !== undefined ? newVal : data[i];
        if (mappedVal !== 0) { // Only store non-default mapped values
          indices.push(i);
          values.push(mappedVal);
        }
      }
    }
    
    return new SparseNeuroVol(x.space, 'float32', 0, indices, values);
  } else {
    // For dense volumes
    const data = x.getData();
    const mappedData = new Float32Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      const newVal = lookup.get(data[i]);
      mappedData[i] = newVal !== undefined ? newVal : data[i];
    }
    
    // Preserve exact type
    if (x instanceof FloatNeuroVol) {
      return new FloatNeuroVol(x.space, mappedData);
    } else {
      return new (x.constructor as any)(x.space, mappedData);
    }
  }
}

/**
 * Calculate centroids for each cluster.
 * 
 * Computes the centroid (center point) of each cluster using
 * the specified method.
 * 
 * @param x - Clustered volume
 * @param method - Method for computing centroids ("center_of_mass" or "median")
 * @returns Map of cluster labels to centroid coordinates
 */
export function centroids(
  x: ClusteredNeuroVol,
  method: string = 'center_of_mass'
): Map<number, [number, number, number]> {
  if (method !== 'center_of_mass' && method !== 'median') {
    throw new ValueError(`Unknown method: ${method}`);
  }
  
  const result = new Map<number, [number, number, number]>();
  const labels = Array.from(Object.values(x.labelMap));
  const clusterData = x.asDense().getData();
  
  for (const label of labels) {
    if (label === 0) continue; // Skip background
    
    const coords: Array<[number, number, number]> = [];
    
    // Find all voxels for this cluster
    for (let z = 0; z < x.space.dim[2]; z++) {
      for (let y = 0; y < x.space.dim[1]; y++) {
        for (let x_coord = 0; x_coord < x.space.dim[0]; x_coord++) {
          const idx = x.space.gridToIndex([x_coord, y, z]);
          if (clusterData[idx] === label) {
            coords.push([x_coord, y, z]);
          }
        }
      }
    }
    
    if (coords.length === 0) continue;
    
    if (method === 'center_of_mass') {
      // Compute mean of coordinates
      let sumX = 0, sumY = 0, sumZ = 0;
      for (const [x, y, z] of coords) {
        sumX += x;
        sumY += y;
        sumZ += z;
      }
      result.set(label, [
        sumX / coords.length,
        sumY / coords.length,
        sumZ / coords.length
      ]);
    } else if (method === 'median') {
      // Compute median of coordinates
      const xCoords = coords.map(c => c[0]).sort((a, b) => a - b);
      const yCoords = coords.map(c => c[1]).sort((a, b) => a - b);
      const zCoords = coords.map(c => c[2]).sort((a, b) => a - b);
      
      const mid = Math.floor(coords.length / 2);
      result.set(label, [
        coords.length % 2 === 0 
          ? (xCoords[mid - 1] + xCoords[mid]) / 2 
          : xCoords[mid],
        coords.length % 2 === 0 
          ? (yCoords[mid - 1] + yCoords[mid]) / 2 
          : yCoords[mid],
        coords.length % 2 === 0 
          ? (zCoords[mid - 1] + zCoords[mid]) / 2 
          : zCoords[mid]
      ]);
    }
  }
  
  return result;
}

/**
 * Common statistical reduction functions
 */
export const StatFunctions = {
  // NaN-skipping mean. Returns NaN if every value is NaN (no valid samples).
  mean: (values: Float32Array): number => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isNaN(v)) {
        sum += v;
        count++;
      }
    }
    return count > 0 ? sum / count : NaN;
  },

  sum: (values: Float32Array): number => {
    return values.reduce((a, b) => a + b, 0);
  },

  // NaN-safe min via a loop (avoids spreading large arrays as call arguments,
  // which overflows the call stack for whole-brain ROIs).
  min: (values: Float32Array): number => {
    let result = Infinity;
    let found = false;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isNaN(v) && v < result) {
        result = v;
        found = true;
      }
    }
    return found ? result : NaN;
  },

  // NaN-safe max via a loop (see `min`).
  max: (values: Float32Array): number => {
    let result = -Infinity;
    let found = false;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isNaN(v) && v > result) {
        result = v;
        found = true;
      }
    }
    return found ? result : NaN;
  },

  // NaN-skipping sample standard deviation (divides by n-1 over valid samples).
  std: (values: Float32Array): number => {
    const mean = StatFunctions.mean(values);
    let sumSq = 0;
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isNaN(v)) {
        const diff = v - mean;
        sumSq += diff * diff;
        count++;
      }
    }
    return count > 1 ? Math.sqrt(sumSq / (count - 1)) : NaN;
  },
  
  median: (values: Float32Array): number => {
    const sorted = Array.from(values).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
};

// ---------------------------------------------------------------------------
// concat — combine an array of NeuroVol into a Float32NeuroVec
// ---------------------------------------------------------------------------

/**
 * Concatenate an array of 3D volumes into a single 4D NeuroVec.
 *
 * All volumes must share the same spatial dimensions.  The resulting vec
 * has shape [dimX, dimY, dimZ, volumes.length].
 *
 * @param volumes - Array of NeuroVol objects to concatenate
 * @returns A Float32NeuroVec with the concatenated data
 */
export function concat(volumes: NeuroVol[]): Float32NeuroVec {
  if (volumes.length === 0) {
    throw new ValueError('concat requires at least one volume');
  }

  const refDim = volumes[0].dim;
  for (let v = 1; v < volumes.length; v++) {
    const d = volumes[v].dim;
    if (d.length !== refDim.length || !d.every((val, i) => val === refDim[i])) {
      throw new ValueError(
        `Volume ${v} dimensions [${d}] do not match first volume [${refDim}]`
      );
    }
  }

  const spatialSize = refDim[0] * refDim[1] * refDim[2];
  const T = volumes.length;
  const data = new Float32Array(spatialSize * T);

  for (let t = 0; t < T; t++) {
    const src = volumes[t].getData();
    data.set(src, t * spatialSize);
  }

  const ref = volumes[0].space;
  const space4d = new NeuroSpace(
    [refDim[0], refDim[1], refDim[2], T],
    [...ref.spacing.slice(0, 3), 1],
    [...ref.origin.slice(0, 3), 0]
  );

  return new Float32NeuroVec(space4d, data);
}

// ---------------------------------------------------------------------------
// series — extract time-series from a NeuroVec at voxel coordinates
// ---------------------------------------------------------------------------

/**
 * Extract time-series from a NeuroVec at one or more voxel coordinates.
 *
 * @param vec - The 4D data
 * @param coords - Array of [i,j,k] grid coordinates
 * @returns One Float32Array per coordinate containing the time-series
 */
export function series(
  vec: NeuroVec,
  coords: Array<[number, number, number]>
): Float32Array[] {
  return coords.map(([i, j, k]) => {
    const raw = vec.getSeries(i, j, k);
    return Float32Array.from(raw);
  });
}

// ---------------------------------------------------------------------------
// scaleSeries — normalize time-series within a NeuroVec
// ---------------------------------------------------------------------------

/**
 * Normalize every voxel's time-series in a NeuroVec.
 *
 * Methods:
 * - `zscore`: subtract mean, divide by SD
 * - `mean-center`: subtract mean only
 * - `psc`: percent signal change — (x - mean) / mean * 100
 *
 * @param vec - The 4D data
 * @param method - Normalization method
 * @returns A new Float32NeuroVec with normalized data
 */
export function scaleSeries(
  vec: NeuroVec,
  method: 'zscore' | 'mean-center' | 'psc' = 'zscore'
): Float32NeuroVec {
  const [dimX, dimY, dimZ, dimT] = vec.dim;
  const spatialSize = dimX * dimY * dimZ;
  const out = new Float32Array(spatialSize * dimT);

  // Copy source data
  const src = vec.getData();
  if (src instanceof Float32Array || src instanceof Float64Array ||
      src instanceof Int16Array || src instanceof Uint8Array) {
    // Dense typed array — fast path
    for (let i = 0; i < out.length; i++) out[i] = src[i];
  } else {
    // Fallback for sparse or other data
    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          const voxIdx = i + j * dimX + k * dimX * dimY;
          for (let t = 0; t < dimT; t++) {
            out[voxIdx + t * spatialSize] = vec.getAt(i, j, k, t);
          }
        }
      }
    }
  }

  // Normalize each voxel's time-series
  for (let vox = 0; vox < spatialSize; vox++) {
    // Compute mean
    let sum = 0;
    for (let t = 0; t < dimT; t++) sum += out[vox + t * spatialSize];
    const mean = sum / dimT;

    if (method === 'mean-center') {
      for (let t = 0; t < dimT; t++) {
        out[vox + t * spatialSize] -= mean;
      }
    } else if (method === 'zscore') {
      let ss = 0;
      for (let t = 0; t < dimT; t++) {
        const diff = out[vox + t * spatialSize] - mean;
        ss += diff * diff;
      }
      const sd = dimT > 1 ? Math.sqrt(ss / (dimT - 1)) : 1;
      const invSd = sd > 0 ? 1 / sd : 0;
      for (let t = 0; t < dimT; t++) {
        out[vox + t * spatialSize] = (out[vox + t * spatialSize] - mean) * invSd;
      }
    } else if (method === 'psc') {
      const invMean = mean !== 0 ? 100 / mean : 0;
      for (let t = 0; t < dimT; t++) {
        out[vox + t * spatialSize] = (out[vox + t * spatialSize] - mean) * invMean;
      }
    }
  }

  return new Float32NeuroVec(vec.space, out);
}