// Import necessary classes and types
import { NeuroVol } from '../volume/NeuroVol';
import { Int16NeuroVol } from '../volume/DenseNeuroVol';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { UInt8NeuroVol } from '../volume/DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D } from '../geometry/Axis';

/**
 * Enum for defining connectivity schemes.
 */
enum Connectivity {
  Six = 6,
  Eighteen = 18,
  TwentySix = 26,
}

/**
 * Interface representing a cluster's properties.
 */
interface Cluster {
  provisionalLabel: number; // Temporary label before sorting
  finalLabel: number;       // Final label after sorting
  size: number;
  sumX: number;
  sumY: number;
  sumZ: number;
  maxValue: number;
}

/**
 * Class handling Connected Components Analysis.
 */
/**
 * Result returned by performConnectedComponents.
 */
export interface ConnectedComponentsResult {
  clusters: Cluster[];
  indexVolume: Int16NeuroVol;
  sizeVolume: Int16NeuroVol;
}

/**
 * Entry in the enriched cluster table produced by clusterTable().
 */
export interface ClusterTableEntry {
  id: number;
  size: number;
  centerOfMass: [number, number, number];
  centerOfMassWorld: [number, number, number];
  maxValue: number;
  maxLocation: [number, number, number];
  meanValue: number;
}

// Re-export types
export { Cluster, Connectivity };

class ConnectedComponents {
  /**
   * Performs connected components analysis on a 3D volume.
   * @param valueVolume - The NeuroVol containing voxel values.
   * @param maskVolume - The NeuroVol containing binary mask (0 or 1).
   * @param threshold - The threshold value for voxel inclusion.
   * @param connectivity - The connectivity scheme (6, 18, or 26).
   * @returns An object containing the cluster table, indexVolume, and sizeVolume.
   */
  static performConnectedComponents(
    valueVolume: NeuroVol,
    maskVolume: NeuroVol,
    threshold: number,
    connectivity: Connectivity
  ): ConnectedComponentsResult {
    // Validate that input volumes have the same dimensions
    if (
      valueVolume.dim.length !== 3 ||
      maskVolume.dim.length !== 3 ||
      !valueVolume.dim.every((dim, idx) => dim === maskVolume.dim[idx])
    ) {
      throw new Error('Value and mask volumes must be 3D and have the same dimensions.');
    }

    const dimX = valueVolume.dim[0];
    const dimY = valueVolume.dim[1];
    const dimZ = valueVolume.dim[2];
    const totalVoxels = dimX * dimY * dimZ;

    // Initialize indexVolume and sizeVolume as Int16NeuroVol
    const indexSpace = new NeuroSpace(
      [dimX, dimY, dimZ],
      valueVolume.spacing,
      valueVolume.origin,
      valueVolume.space.axes
    );
    const indexVolume = new Int16NeuroVol(indexSpace);
    const sizeVolume = new Int16NeuroVol(indexSpace);

    // Initialize variables
    let currentProvisionalLabel = 1;
    const clusters: Cluster[] = [];

    // Precompute neighbor offsets based on connectivity
    const neighborOffsets = ConnectedComponents.getNeighborOffsets(connectivity);

    // Create a helper function to convert 3D coordinates to linear index
    const getLinearIndex = (x: number, y: number, z: number): number => {
      return x + y * dimX + z * dimX * dimY;
    };

    // Access the underlying data arrays for faster operations
    const valueData = valueVolume.getData();
    const maskData = maskVolume.getData();
    const indexData = indexVolume.getData() as Int16Array;
    const sizeData = sizeVolume.getData() as Int16Array;

    // Initialize a queue for BFS using a fixed-size array for better performance
    const maxQueueSize = totalVoxels;
    const queue = new Uint32Array(maxQueueSize);
    let queueStart = 0;
    let queueEnd = 0;

    // Iterate through all voxels
    for (let i = 0; i < totalVoxels; i++) {
      // Check if voxel is already labeled
      if (indexData[i] !== 0) {
        continue;
      }

      // Check mask and threshold
      if (maskData[i] !== 1 || valueData[i] < threshold) {
        continue;
      }

      // Start BFS for a new cluster
      queue[queueEnd++] = i;
      indexData[i] = currentProvisionalLabel;

      // Initialize cluster properties
      const cluster: Cluster = {
        provisionalLabel: currentProvisionalLabel,
        finalLabel: 0, // To be assigned after sorting
        size: 0,
        sumX: 0,
        sumY: 0,
        sumZ: 0,
        maxValue: valueData[i],
      };

      // BFS Loop
      while (queueStart < queueEnd) {
        const currentIdx = queue[queueStart++];
        const z = Math.floor(currentIdx / (dimX * dimY));
        const y = Math.floor((currentIdx % (dimX * dimY)) / dimX);
        const x = currentIdx % dimX;

        cluster.size += 1;
        cluster.sumX += x;
        cluster.sumY += y;
        cluster.sumZ += z;
        const currentValue = valueData[currentIdx];
        if (currentValue > cluster.maxValue) {
          cluster.maxValue = currentValue;
        }

        // Iterate through all neighbors
        for (const offset of neighborOffsets) {
          const neighborX = x + offset[0];
          const neighborY = y + offset[1];
          const neighborZ = z + offset[2];

          // Check bounds without function call for efficiency
          if (
            neighborX >= 0 && neighborX < dimX &&
            neighborY >= 0 && neighborY < dimY &&
            neighborZ >= 0 && neighborZ < dimZ
          ) {
            const neighborIdx = neighborX + neighborY * dimX + neighborZ * dimX * dimY;

            // Check if neighbor is part of the cluster
            if (
              indexData[neighborIdx] === 0 &&
              maskData[neighborIdx] === 1 &&
              valueData[neighborIdx] >= threshold
            ) {
              indexData[neighborIdx] = currentProvisionalLabel;
              queue[queueEnd++] = neighborIdx;
            }
          }
        }
      }

      // Add the cluster to the list
      clusters.push(cluster);

      // Increment the provisional label for the next cluster
      currentProvisionalLabel += 1;

      // Reset queue pointers for the next cluster
      queueStart = queueEnd;
    }

    // Sort clusters by size in descending order
    clusters.sort((a, b) => b.size - a.size);

    // Create a mapping from provisional labels to final labels
    const labelMapping = new Uint16Array(currentProvisionalLabel);
    clusters.forEach((cluster, idx) => {
      cluster.finalLabel = idx + 1; // Final labels start at 1
      labelMapping[cluster.provisionalLabel] = cluster.finalLabel;
    });

    // Reassign final labels to indexVolume and populate sizeVolume
    for (let i = 0; i < totalVoxels; i++) {
      const provisionalLabel = indexData[i];
      if (provisionalLabel > 0) {
        const finalLabel = labelMapping[provisionalLabel];
        indexData[i] = finalLabel;
        sizeData[i] = clusters[finalLabel - 1].size;
      } else {
        // Background voxels remain 0
        sizeData[i] = 0;
      }
    }

    // Calculate center of mass for each cluster
    clusters.forEach((cluster) => {
      const invSize = 1 / cluster.size;
      cluster.sumX *= invSize;
      cluster.sumY *= invSize;
      cluster.sumZ *= invSize;
    });

    return {
      clusters,
      indexVolume,
      sizeVolume,
    };
  }

  /**
   * Generates neighbor offsets based on the connectivity scheme.
   * @param connectivity - The connectivity scheme (6, 18, or 26).
   * @returns An array of [dx, dy, dz] tuples representing neighbor offsets.
   */
  private static getNeighborOffsets(connectivity: Connectivity): Int8Array[] {
    const offsets: Int8Array[] = [];

    const directions = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, -1, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
    ];

    if (connectivity >= Connectivity.Eighteen) {
      directions.push(
        [-1, -1, 0],
        [-1, 1, 0],
        [1, -1, 0],
        [1, 1, 0],
        [-1, 0, -1],
        [-1, 0, 1],
        [1, 0, -1],
        [1, 0, 1],
        [0, -1, -1],
        [0, -1, 1],
        [0, 1, -1],
        [0, 1, 1]
      );
    }

    if (connectivity === Connectivity.TwentySix) {
      directions.push(
        [-1, -1, -1],
        [-1, -1, 1],
        [-1, 1, -1],
        [-1, 1, 1],
        [1, -1, -1],
        [1, -1, 1],
        [1, 1, -1],
        [1, 1, 1]
      );
    }

    for (const dir of directions) {
      offsets.push(Int8Array.from(dir));
    }

    return offsets;
  }
}

// ---------------------------------------------------------------------------
// clusterTable — enriched per-cluster summary
// ---------------------------------------------------------------------------

/**
 * Build an enriched table of cluster statistics from a connected-components
 * result and the original value volume.
 *
 * @param result - Output from `ConnectedComponents.performConnectedComponents`
 * @param valueVolume - The original value volume (used for mean/max/peak location)
 * @returns Array of ClusterTableEntry sorted by cluster id (ascending)
 */
export function clusterTable(
  result: ConnectedComponentsResult,
  valueVolume: NeuroVol
): ClusterTableEntry[] {
  const { clusters, indexVolume } = result;
  const [dimX, dimY, dimZ] = valueVolume.dim;
  const indexData = indexVolume.getData() as Int16Array;
  const valueData = valueVolume.getData();

  // Per-cluster accumulators
  const nClusters = clusters.length;
  const sumVal = new Float64Array(nClusters);
  const countVal = new Uint32Array(nClusters);
  const peakVal = new Float32Array(nClusters).fill(-Infinity);
  const peakX = new Int32Array(nClusters);
  const peakY = new Int32Array(nClusters);
  const peakZ = new Int32Array(nClusters);

  // Single pass over the volume
  let idx = 0;
  for (let k = 0; k < dimZ; k++) {
    for (let j = 0; j < dimY; j++) {
      for (let i = 0; i < dimX; i++, idx++) {
        const label = indexData[idx];
        if (label > 0) {
          const ci = label - 1; // clusters are 1-indexed
          const v = valueData[idx];
          sumVal[ci] += v;
          countVal[ci]++;
          if (v > peakVal[ci]) {
            peakVal[ci] = v;
            peakX[ci] = i;
            peakY[ci] = j;
            peakZ[ci] = k;
          }
        }
      }
    }
  }

  const entries: ClusterTableEntry[] = [];
  for (let ci = 0; ci < nClusters; ci++) {
    const c = clusters[ci];
    const com: [number, number, number] = [c.sumX, c.sumY, c.sumZ];
    const comWorld = valueVolume.space.voxelToWorld(com) as [number, number, number];

    entries.push({
      id: c.finalLabel,
      size: c.size,
      centerOfMass: com,
      centerOfMassWorld: comWorld,
      maxValue: peakVal[ci],
      maxLocation: [peakX[ci], peakY[ci], peakZ[ci]],
      meanValue: countVal[ci] > 0 ? sumVal[ci] / countVal[ci] : 0,
    });
  }

  entries.sort((a, b) => a.id - b.id);
  return entries;
}

// ---------------------------------------------------------------------------
// localMaxima — find local peaks within each cluster
// ---------------------------------------------------------------------------

/**
 * Find local maxima (peaks) in each cluster.
 *
 * A voxel is a local maximum if its value is strictly greater than all of its
 * 26-connected neighbours that belong to the same cluster.
 *
 * @param valueVolume - The value volume
 * @param indexVolume - The cluster index volume from performConnectedComponents
 * @param minDistance - Optional minimum grid distance between reported peaks
 *                      within the same cluster (Euclidean)
 * @returns Array of peak descriptors
 */
export function localMaxima(
  valueVolume: NeuroVol,
  indexVolume: NeuroVol,
  minDistance?: number
): Array<{ clusterId: number; location: [number, number, number]; value: number }> {
  const [dimX, dimY, dimZ] = valueVolume.dim;
  const valueData = valueVolume.getData();
  const indexData = indexVolume.getData();

  // 26-connectivity offsets
  const offsets: [number, number, number][] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        offsets.push([dx, dy, dz]);
      }
    }
  }

  type Peak = { clusterId: number; location: [number, number, number]; value: number };
  const allPeaks: Peak[] = [];

  let idx = 0;
  for (let k = 0; k < dimZ; k++) {
    for (let j = 0; j < dimY; j++) {
      for (let i = 0; i < dimX; i++, idx++) {
        const label = indexData[idx];
        if (label <= 0) continue;

        const val = valueData[idx];
        let isMax = true;

        for (const [dx, dy, dz] of offsets) {
          const ni = i + dx;
          const nj = j + dy;
          const nk = k + dz;
          if (ni < 0 || ni >= dimX || nj < 0 || nj >= dimY || nk < 0 || nk >= dimZ) continue;
          const nIdx = ni + nj * dimX + nk * dimX * dimY;
          if (indexData[nIdx] === label && valueData[nIdx] >= val) {
            // Not strictly greater — only fail if neighbour is >= val
            // (equal neighbour means not a strict local max)
            if (nIdx !== idx) {
              isMax = false;
              break;
            }
          }
        }

        if (isMax) {
          allPeaks.push({ clusterId: label, location: [i, j, k], value: val });
        }
      }
    }
  }

  if (minDistance === undefined || minDistance <= 0) {
    return allPeaks;
  }

  // Enforce minimum distance within each cluster
  const byCluster = new Map<number, Peak[]>();
  for (const p of allPeaks) {
    if (!byCluster.has(p.clusterId)) byCluster.set(p.clusterId, []);
    byCluster.get(p.clusterId)!.push(p);
  }

  const filtered: Peak[] = [];
  for (const [, peaks] of byCluster) {
    // Sort descending by value
    peaks.sort((a, b) => b.value - a.value);
    const kept: Peak[] = [];
    for (const p of peaks) {
      let tooClose = false;
      for (const q of kept) {
        const dx = p.location[0] - q.location[0];
        const dy = p.location[1] - q.location[1];
        const dz = p.location[2] - q.location[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < minDistance) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) kept.push(p);
    }
    filtered.push(...kept);
  }

  return filtered;
}

export { ConnectedComponents };