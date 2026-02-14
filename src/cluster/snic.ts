// Import necessary types and interfaces
import { NeuroVec } from '../vec/NeuroVec';
import { NeuroVol } from '../volume/NeuroVol';
import { TypedArray } from '../types';

import { Matrix } from 'ml-matrix'; // For numerical operations if needed

// Interfaces for centroid and elements in the priority queue
interface CentroidInfo {
  x: Float32Array; // Spatial coordinates
  c: Float32Array; // Feature vector
  label: number;
  n: number; // Number of voxels assigned to the centroid
}

interface Element {
  x: Float32Array; // Spatial coordinates
  voxel: [number, number, number]; // Voxel coordinates
  i_k: number; // Index in the feature matrix
  label: number;
  distance: number;
}

// Helper functions for index calculations
function indexToGrid(index: number, dims: number[]): [number, number, number] {
  const [dimX, dimY] = dims;
  const i = index % dimX;
  const j = Math.floor((index / dimX) % dimY);
  const k = Math.floor(index / (dimX * dimY));
  return [i, j, k];
}

function coordsToIndex(i: number, j: number, k: number, dims: number[]): number {
  const [dimX, dimY] = dims;
  return i + j * dimX + k * dimX * dimY;
}

// SNIC main function
function snic(
  vec: NeuroVec,
  mask: NeuroVol,
  compactness: number = 5,
  K: number = 500
): { cluster: Int32Array } {
  // Get mask data and dimensions
  const maskData = mask.getData() as Uint8Array; // Assuming mask is Uint8Array
  const maskDims = mask.dim;
  const maskLength = maskData.length;

  // Get indices where mask > 0
  const maskIdx: number[] = [];
  for (let idx = 0; idx < maskLength; idx++) {
    if (maskData[idx] > 0) {
      maskIdx.push(idx);
    }
  }

  // Convert indices to grid coordinates
  const valid_coords: Float32Array[] = maskIdx.map((idx) =>
    new Float32Array(indexToGrid(idx, maskDims))
  );

  // Normalize coordinates by spacing
  const spacing = mask.spacing;
  const norm_coords: Float32Array[] = valid_coords.map(
    (coord) => new Float32Array(coord.map((c, idx) => c / spacing[idx]))
  );

  // Build mask lookup
  const [dimX, dimY, dimZ] = maskDims;
  const totalVoxels = dimX * dimY * dimZ;
  const mask_lookup = new Int32Array(totalVoxels).fill(-1);
  for (let idx = 0; idx < valid_coords.length; idx++) {
    const [i, j, k] = valid_coords[idx];
    const index = coordsToIndex(i, j, k, [dimX, dimY]);
    mask_lookup[index] = idx;
  }

  // Get data from NeuroVec at mask indices and standardize
  const vecmat: Float32Array[] = []; // D x N
  const [vecDimX, vecDimY, vecDimZ, vecDimT] = vec.dim;
  for (let idx = 0; idx < maskIdx.length; idx++) {
    const voxelIdx = maskIdx[idx];
    const [i, j, k] = indexToGrid(voxelIdx, [vecDimX, vecDimY, vecDimZ]);
    const series = vec.getSeries(i, j, k); // Returns number[]
    for (let d = 0; d < vecDimT; d++) {
      if (!vecmat[d]) vecmat[d] = new Float32Array(maskIdx.length);
      vecmat[d][idx] = series[d];
    }
  }
  const vecmatStandardized = standardizeData(vecmat);

  // Select initial points for centroids
  const centroid_idx = selectInitialPoints(valid_coords, K);
  const centroids: Float32Array[] = centroid_idx.map((idx) => norm_coords[idx]);

  // Compute s
  const s = Math.sqrt(valid_coords.length / K);

  // Create L, the label array
  const L = new Int32Array(totalVoxels); // Initialized to zeros

  // Prepare maskData as Uint8Array
  const maskDataUint8 = maskData; // Already Uint8Array

  // Call snic_main
  snic_main(
    L,
    maskDataUint8,
    centroids,
    centroid_idx,
    valid_coords,
    norm_coords,
    vecmatStandardized,
    K,
    s,
    compactness,
    mask_lookup,
    maskDims
  );

  // Extract cluster labels for the masked voxels
  const cluster = new Int32Array(maskIdx.length);
  for (let idx = 0; idx < maskIdx.length; idx++) {
    const [i, j, k] = valid_coords[idx];
    const index = coordsToIndex(i, j, k, [dimX, dimY]);
    cluster[idx] = L[index];
  }

  return { cluster };
}

// Helper function to standardize data
function standardizeData(data: Float32Array[]): Float32Array[] {
  const D = data.length;
  const N = data[0].length;

  const standardizedData: Float32Array[] = [];

  for (let d = 0; d < D; d++) {
    const feature = data[d];
    const mean =
      feature.reduce((sum, val) => sum + val, 0) / N;
    const variance =
      feature.reduce((sum, val) => sum + (val - mean) ** 2, 0) / N;
    const std = Math.sqrt(variance) || 1; // Avoid division by zero

    const standardizedFeature = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      standardizedFeature[i] = (feature[i] - mean) / std;
    }
    standardizedData[d] = standardizedFeature;
  }

  return standardizedData;
}

// Helper function to select initial points for centroids
function selectInitialPoints(valid_coords: Float32Array[], K: number): number[] {
  const N = valid_coords.length;
  const step = Math.floor(N / K);
  const centroid_idx: number[] = [];

  for (let k = 0; k < K; k++) {
    centroid_idx.push(k * step);
  }

  return centroid_idx;
}

// SNIC main processing function
function snic_main(
  L: Int32Array,
  mask: Uint8Array,
  centroids: Float32Array[],
  centroid_idx: number[],
  valid_coords: Float32Array[],
  norm_coords: Float32Array[],
  vecmat: Float32Array[],
  K: number,
  s: number,
  compactness: number,
  mask_lookup: Int32Array,
  maskDims: number[]
): void {
  const [dimX, dimY, dimZ] = maskDims;
  const totalVoxels = dimX * dimY * dimZ;
  const C: CentroidInfo[] = new Array(K);
  let nassigned = 0;
  const nvoxels = vecmat[0].length;

  // Precompute scaling factors
  const inv_s = 1 / s;
  const inv_compactness = 1 / compactness;

  // Create a min-heap priority queue based on distance
  const Q = new PriorityQueue<Element>((a, b) => a.distance < b.distance);

  // Initialize centroids and priority queue
  for (let k = 0; k < K; ++k) {
    const idx = centroid_idx[k];
    const x_k = centroids[k]; // Float32Array
    const c_k = new Float32Array(vecmat.length);
    for (let d = 0; d < vecmat.length; d++) {
      c_k[d] = vecmat[d][idx];
    }
    const voxel = valid_coords[idx];
    const voxelTuple: [number, number, number] = [voxel[0], voxel[1], voxel[2]];

    const e: Element = create_element(x_k, voxelTuple, idx, k + 1, 0.0);

    C[k] = {
      x: x_k.slice(),
      c: c_k.slice(),
      label: k + 1,
      n: 1,
    };

    Q.push(e);
  }

  // Main loop
  while (!Q.isEmpty() && nassigned <= nvoxels) {
    const e_i = Q.pop();
    if (!e_i) continue;

    const x_i = e_i.x; // Float32Array
    const voxel = e_i.voxel; // [number, number, number]
    const i_k = e_i.i_k;
    const k_i = e_i.label;

    const [i, j, k] = voxel.map((v) => Math.round(v));

    const idx = coordsToIndex(i, j, k, [dimX, dimY]);

    if (L[idx] === 0) {
      L[idx] = k_i;
      nassigned++;

      const c_i = new Float32Array(vecmat.length);
      for (let d = 0; d < vecmat.length; d++) {
        c_i[d] = vecmat[d][i_k];
      }

      C[k_i - 1] = update_centroid_online(C[k_i - 1], x_i, c_i);

      const current_centroid = C[k_i - 1];
      const cen_k = current_centroid.x;
      const ci = current_centroid.c;

      const neighbors = get_26_connected_neighbors(i, j, k, dimX, dimY, dimZ);

      for (const neighbor of neighbors) {
        const [ni, nj, nk] = neighbor;
        const n_idx = coordsToIndex(ni, nj, nk, [dimX, dimY]);

        if (L[n_idx] !== 0 || mask[n_idx] === 0) {
          continue;
        }

        const neighb_idx = mask_lookup[n_idx];
        if (neighb_idx === -1) continue; // Skip if not in valid_coords

        const c_j = new Float32Array(vecmat.length);
        for (let d = 0; d < vecmat.length; d++) {
          c_j[d] = vecmat[d][neighb_idx];
        }
        const nx_j = norm_coords[neighb_idx];

        const d_j_ki = compute_distance(
          cen_k,
          nx_j,
          ci,
          c_j,
          inv_s,
          inv_compactness
        );
        const e_j: Element = create_element(
          nx_j,
          [ni, nj, nk],
          neighb_idx,
          k_i,
          d_j_ki
        );
        Q.push(e_j);
      }
    }
  }
}

// Function to create an element for the priority queue
function create_element(
  x_k: Float32Array,
  voxel: [number, number, number],
  centroid_idx_k: number,
  k: number,
  distance: number
): Element {
  return {
    x: x_k.slice(),
    voxel: [voxel[0], voxel[1], voxel[2]],
    i_k: centroid_idx_k,
    label: k,
    distance: distance,
  };
}

// Function to update centroid information online
function update_centroid_online(
  centroid: CentroidInfo,
  x_i: Float32Array,
  c_i: Float32Array
): CentroidInfo {
  const current_x = centroid.x;
  const current_c = centroid.c;
  const current_n = centroid.n;

  const new_x = new Float32Array(current_x.length);
  for (let idx = 0; idx < current_x.length; idx++) {
    new_x[idx] = (current_x[idx] * current_n + x_i[idx]) / (current_n + 1);
  }

  const new_c = new Float32Array(current_c.length);
  for (let idx = 0; idx < current_c.length; idx++) {
    new_c[idx] = (current_c[idx] * current_n + c_i[idx]) / (current_n + 1);
  }

  const norm = Math.sqrt(new_c.reduce((sum, ci) => sum + ci * ci, 0)) || 1;
  for (let idx = 0; idx < new_c.length; idx++) {
    new_c[idx] /= norm;
  }

  const new_n = current_n + 1;

  return {
    x: new_x,
    c: new_c,
    label: centroid.label,
    n: new_n,
  };
}

// Function to get 26-connected neighbors
function get_26_connected_neighbors(
  i: number,
  j: number,
  k: number,
  max_i: number,
  max_j: number,
  max_k: number
): [number, number, number][] {
  const neighbors: [number, number, number][] = [];

  for (let i_shift = -1; i_shift <= 1; ++i_shift) {
    for (let j_shift = -1; j_shift <= 1; ++j_shift) {
      for (let k_shift = -1; k_shift <= 1; ++k_shift) {
        if (i_shift === 0 && j_shift === 0 && k_shift === 0) {
          continue;
        }

        const i_neighbor = i + i_shift;
        const j_neighbor = j + j_shift;
        const k_neighbor = k + k_shift;

        if (
          i_neighbor >= 0 &&
          i_neighbor < max_i &&
          j_neighbor >= 0 &&
          j_neighbor < max_j &&
          k_neighbor >= 0 &&
          k_neighbor < max_k
        ) {
          neighbors.push([i_neighbor, j_neighbor, k_neighbor]);
        }
      }
    }
  }

  return neighbors;
}

// Function to compute distance
function compute_distance(
  x_i: Float32Array,
  x_k: Float32Array,
  c_i: Float32Array,
  c_k: Float32Array,
  inv_s: number,
  inv_compactness: number
): number {
  let dc = 0.0;
  let ds = 0.0;

  for (let idx = 0; idx < c_i.length; idx++) {
    const diff_c = c_i[idx] - c_k[idx];
    dc += diff_c * diff_c;
  }

  for (let idx = 0; idx < x_i.length; idx++) {
    const diff_x = x_i[idx] - x_k[idx];
    ds += diff_x * diff_x;
  }

  // Since we only need relative distances, we can omit sqrt
  const distance = ds * inv_s + dc * inv_compactness;
  return distance;
}

// PriorityQueue implementation adapted for TypeScript
const top = 0;
const parent = (i: number) => ((i + 1) >>> 1) - 1;
const left = (i: number) => (i << 1) + 1;
const right = (i: number) => (i + 1) << 1;

class PriorityQueue<T> {
  private _heap: T[];
  private _comparator: (a: T, b: T) => boolean;

  constructor(comparator: (a: T, b: T) => boolean) {
    this._heap = [];
    this._comparator = comparator;
  }

  size(): number {
    return this._heap.length;
  }

  isEmpty(): boolean {
    return this.size() === 0;
  }

  peek(): T | undefined {
    return this._heap[top];
  }

  push(...values: T[]): number {
    values.forEach((value) => {
      this._heap.push(value);
      this._siftUp();
    });
    return this.size();
  }

  pop(): T | undefined {
    const poppedValue = this.peek();
    const bottom = this.size() - 1;
    if (bottom > top) {
      this._swap(top, bottom);
    }
    this._heap.pop();
    this._siftDown();
    return poppedValue;
  }

  replace(value: T): T | undefined {
    const replacedValue = this.peek();
    this._heap[top] = value;
    this._siftDown();
    return replacedValue;
  }

  private _greater(i: number, j: number): boolean {
    return this._comparator(this._heap[i], this._heap[j]);
  }

  private _swap(i: number, j: number): void {
    [this._heap[i], this._heap[j]] = [this._heap[j], this._heap[i]];
  }

  private _siftUp(): void {
    let node = this.size() - 1;
    while (node > top && this._greater(node, parent(node))) {
      this._swap(node, parent(node));
      node = parent(node);
    }
  }

  private _siftDown(): void {
    let node = top;
    while (
      (left(node) < this.size() && this._greater(left(node), node)) ||
      (right(node) < this.size() && this._greater(right(node), node))
    ) {
      let maxChild =
        right(node) < this.size() && this._greater(right(node), left(node))
          ? right(node)
          : left(node);
      this._swap(node, maxChild);
      node = maxChild;
    }
  }
}
