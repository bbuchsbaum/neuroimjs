import { NeuroVol } from './NeuroVol';
import { LogicalNeuroVol } from './LogicalNeuroVol';
import { SparseNeuroVol } from '../sparse/SparseNeuroVol';
import { DenseNeuroVol, FloatNeuroVol, Int32NeuroVol } from './DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroSlice } from './NeuroSlice';
import { AxisSet3D } from '../geometry/Axis';
import { TypedArray, NumericType, ValueError, NotImplementedError } from '../types';

/**
 * Label map interface for mapping cluster names to IDs
 * Can accept either string keys (cluster names) or number keys (cluster IDs)
 */
export interface LabelMap {
  [key: string]: number;
  [key: number]: number;
}

/**
 * Cluster information interface
 */
export interface ClusterInfo {
  id: number;
  label?: string;
  size: number;
  indices: number[];
  center: number[];
}

/**
 * ClusteredNeuroVol represents clustered volumetric neuroimaging data.
 * 
 * This class stores cluster assignments for voxels within a mask, where each
 * voxel in the mask is assigned a cluster ID. It provides methods to work with
 * clusters, extract cluster-specific data, and convert between representations.
 * 
 * Direct translation of Python's ClusteredNeuroVol class.
 */
export class ClusteredNeuroVol implements NeuroVol {
  readonly space: NeuroSpace;
  readonly mask: LogicalNeuroVol;
  readonly clusters: Int32Array;
  readonly labelMap: LabelMap;
  private clusterMap: Map<number, number[]>;
  private reverseLabelMap: Map<number, string>;

  /**
   * Creates a ClusteredNeuroVol instance.
   * 
   * @param mask - A LogicalNeuroVol representing the spatial domain of the clusters
   * @param clusters - An array of cluster labels for each voxel in the mask
   * @param labelMap - Optional mapping from cluster names to cluster IDs
   */
  constructor(
    mask: LogicalNeuroVol,
    clusters: Int32Array | number[],
    labelMap: LabelMap = {}
  ) {
    this.space = mask.space;
    this.mask = mask;
    
    // Convert clusters to Int32Array if needed
    this.clusters = clusters instanceof Int32Array ? clusters : new Int32Array(clusters);
    
    // Validate clusters length matches mask
    const maskIndices = mask.getTrueIndices();
    if (this.clusters.length !== maskIndices.length) {
      throw new ValueError(
        `Clusters array length (${this.clusters.length}) must match number of true voxels in mask (${maskIndices.length})`
      );
    }
    
    this.labelMap = labelMap;
    this.reverseLabelMap = new Map();
    for (const [label, id] of Object.entries(labelMap)) {
      this.reverseLabelMap.set(id, label);
    }
    
    this.clusterMap = this.createClusterMap();
  }

  /**
   * Create a mapping from cluster IDs to arrays of indices in the clusters array.
   */
  private createClusterMap(): Map<number, number[]> {
    const clusterMap = new Map<number, number[]>();
    
    for (let i = 0; i < this.clusters.length; i++) {
      const clusterId = this.clusters[i];
      if (!clusterMap.has(clusterId)) {
        clusterMap.set(clusterId, []);
      }
      clusterMap.get(clusterId)!.push(i);
    }
    
    return clusterMap;
  }

  // NeuroVol interface implementation
  get length(): number {
    return this.space.dim[0] * this.space.dim[1] * this.space.dim[2];
  }

  get dim(): number[] {
    return this.space.dim;
  }

  get spacing(): number[] {
    return this.space.spacing;
  }

  get origin(): number[] {
    return this.space.origin;
  }

  /**
   * Get value at a linear index.
   * Returns the cluster ID if the voxel is in the mask, 0 otherwise.
   */
  get(index: number): number {
    const maskIndices = this.mask.getTrueIndices();
    const maskIdx = maskIndices.indexOf(index);
    return maskIdx >= 0 ? this.clusters[maskIdx] : 0;
  }

  /**
   * Get value at specific coordinates.
   * Returns the cluster ID if the voxel is in the mask, 0 otherwise.
   */
  getAt(i: number, j: number, k: number): number {
    const index = this.coordToIndex(i, j, k);
    return this.get(index);
  }

  /**
   * Setting values is not supported for ClusteredNeuroVol.
   */
  setAt(i: number, j: number, k: number, value: number): void {
    throw new NotImplementedError("ClusteredNeuroVol does not support item assignment");
  }

  /**
   * Get the underlying data as a dense array.
   * Returns a volume where masked voxels have their cluster IDs and others are 0.
   */
  getData(): Int32Array {
    const data = new Int32Array(this.length);
    const maskIndices = this.mask.getTrueIndices();
    
    for (let i = 0; i < maskIndices.length; i++) {
      data[maskIndices[i]] = this.clusters[i];
    }
    
    return data;
  }

  /**
   * Get the range of cluster IDs.
   */
  getRange(): [number, number] {
    if (this.clusters.length === 0) {
      return [0, 0];
    }
    
    let min = this.clusters[0];
    let max = this.clusters[0];
    
    for (let i = 1; i < this.clusters.length; i++) {
      if (this.clusters[i] < min) min = this.clusters[i];
      if (this.clusters[i] > max) max = this.clusters[i];
    }
    
    return [min, max];
  }

  /**
   * Replace data is not supported for clustered sparse volumes.
   * Provided to satisfy NeuroVol; throws to indicate misuse.
   */
  setData(_newData: TypedArray): void {
    throw new Error('setData is not supported on ClusteredNeuroVol');
  }

  /**
   * Get the label map.
   */
  getLabelMap(): LabelMap {
    return { ...this.labelMap };
  }

  /**
   * Get cluster information by ID or label.
   */
  getClusterInfo(idOrLabel: number | string): ClusterInfo | undefined {
    let clusterId: number;
    
    if (typeof idOrLabel === 'string') {
      clusterId = this.labelMap[idOrLabel];
      if (clusterId === undefined) {
        return undefined;
      }
    } else {
      clusterId = idOrLabel;
    }
    
    const indices = this.clusterMap.get(clusterId);
    if (!indices) {
      return undefined;
    }
    
    // Convert cluster array indices to volume indices
    const maskIndices = this.mask.getTrueIndices();
    const volumeIndices = indices.map(i => maskIndices[i]);
    
    // Calculate center of mass
    const coords = volumeIndices.map(idx => this.space.indexToGrid(idx));
    const center = [0, 0, 0];
    for (const coord of coords) {
      center[0] += coord[0];
      center[1] += coord[1];
      center[2] += coord[2];
    }
    center[0] /= coords.length;
    center[1] /= coords.length;
    center[2] /= coords.length;
    
    return {
      id: clusterId,
      label: this.reverseLabelMap.get(clusterId),
      size: indices.length,
      indices: volumeIndices,
      center
    };
  }

  /**
   * Get a binary mask for a specific cluster.
   */
  getClusterMask(idOrLabel: number | string): LogicalNeuroVol {
    const info = this.getClusterInfo(idOrLabel);
    if (!info) {
      throw new ValueError(`Cluster ${idOrLabel} not found`);
    }
    
    return new LogicalNeuroVol(this.space, undefined, info.indices);
  }

  /**
   * Extract data for a specific cluster from another volume.
   */
  getClusterData(data: NeuroVol, idOrLabel: number | string): Float32Array {
    const info = this.getClusterInfo(idOrLabel);
    if (!info) {
      throw new ValueError(`Cluster ${idOrLabel} not found`);
    }
    
    if (!this.isSameSpace(data)) {
      throw new ValueError("Data volume must have matching space");
    }
    
    const values = new Float32Array(info.size);
    for (let i = 0; i < info.indices.length; i++) {
      values[i] = data.get(info.indices[i]);
    }
    
    return values;
  }

  /**
   * Get cluster ID for a voxel at a specific coordinate.
   * This is a convenience method for compatibility.
   */
  getClusterId(coord: number[]): number | undefined {
    const idx = this.space.coordToIndex(coord);
    if (!this.mask.get(idx)) {
      return undefined;
    }
    
    const maskIndices = this.mask.getTrueIndices();
    const clusterArrayIndex = maskIndices.indexOf(idx);
    if (clusterArrayIndex === -1) {
      return undefined;
    }
    
    return this.clusters[clusterArrayIndex];
  }

  /**
   * Get cluster label for a voxel at a specific coordinate.
   * This is a convenience method for compatibility.
   */
  getClusterLabel(coord: number[]): string | undefined {
    const clusterId = this.getClusterId(coord);
    if (clusterId === undefined) {
      return undefined;
    }
    return this.reverseLabelMap.get(clusterId);
  }

  /**
   * Get all coordinates for a specific cluster.
   * This is a convenience method for compatibility.
   */
  getClusterCoords(idOrLabel: number | string): number[][] {
    const info = this.getClusterInfo(idOrLabel);
    if (!info) {
      return [];
    }
    
    return info.indices.map(idx => this.space.indexToGrid(idx));
  }

  /**
   * Get the number of unique clusters.
   */
  numClusters(): number {
    return this.clusterMap.size;
  }

  /**
   * Get sizes of all clusters.
   */
  clusterSizes(): Map<number, number> {
    const sizes = new Map<number, number>();
    for (const [id, indices] of this.clusterMap) {
      sizes.set(id, indices.length);
    }
    return sizes;
  }

  /**
   * Get centers of all clusters.
   */
  clusterCenters(): Map<number, number[]> {
    const centers = new Map<number, number[]>();
    
    for (const [id] of this.clusterMap) {
      const info = this.getClusterInfo(id);
      if (info) {
        centers.set(id, info.center);
      }
    }
    
    return centers;
  }

  /**
   * Convert to SparseNeuroVol.
   */
  asSparse(): SparseNeuroVol {
    const maskIndices = this.mask.getTrueIndices();
    return new SparseNeuroVol(
      this.space,
      'int32',
      0,
      maskIndices,
      Array.from(this.clusters)
    );
  }

  /**
   * Convert to DenseNeuroVol.
   */
  asDense(): DenseNeuroVol {
    const data = this.getData();
    return new Int32NeuroVol(this.space, data);
  }

  /**
   * Convert to LogicalNeuroVol (returns the mask).
   */
  asLogical(): LogicalNeuroVol {
    return this.mask;
  }

  /**
   * Get slice - delegates to dense representation.
   */
  getSlice(zlevel: number, outAxes: AxisSet3D): NeuroSlice {
    return this.asDense().getSlice(zlevel, outAxes);
  }

  /**
   * Get slice at coordinates - delegates to dense representation.
   */
  getSliceAt(coord: number[], outAxes: AxisSet3D, interpolation: 'nearest' | 'trilinear'): NeuroSlice {
    return this.asDense().getSliceAt(coord, outAxes, interpolation);
  }

  getSliceTypedArrayType(): NumericType {
    return 'int32';
  }

  getDataConstructor(): new (length: number) => Int32Array {
    return Int32Array;
  }

  /**
   * Helper method to convert coordinates to linear index.
   */
  private coordToIndex(i: number, j: number, k: number): number {
    const [dimX, dimY] = this.dim;
    return i + j * dimX + k * dimX * dimY;
  }

  /**
   * Check if two volumes have the same space.
   */
  private isSameSpace(other: NeuroVol): boolean {
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

  /**
   * String representation of the volume.
   */
  toString(): string {
    return `ClusteredNeuroVol(
  Num clusters   : ${this.numClusters()}
  Dimension      : ${this.dim.join(' x ')}
  Spacing        : ${this.spacing.join(' x ')}
  Origin         : ${this.origin.join(' x ')}
  Label map      : ${Object.keys(this.labelMap).length} labels
)`;
  }
}

/**
 * Factory function to create a ClusteredNeuroVol instance.
 */
export function clusteredNeuroVol(
  mask: LogicalNeuroVol,
  clusters: Int32Array | number[],
  labelMap: LabelMap = {}
): ClusteredNeuroVol {
  return new ClusteredNeuroVol(mask, clusters, labelMap);
}
