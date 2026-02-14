/**
 * Interface for high-dimensional neuroimaging data (5D+)
 * Supports multi-subject, multi-condition, multi-time fMRI data
 */

import { NeuroVol } from '../volume/NeuroVol';
import { NeuroVec } from '../vec/NeuroVec';
import { NeuroSpace } from '../geometry/NeuroSpace';

/**
 * Dimension labels for organizing high-dimensional data
 */
export interface DimensionInfo {
  /**
   * Name of the dimension (e.g., 'subject', 'condition', 'time', 'feature')
   */
  name: string;
  
  /**
   * Size of this dimension
   */
  size: number;
  
  /**
   * Optional labels for each index in this dimension
   */
  labels?: string[];
  
  /**
   * Optional metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Options for creating a NeuroHyperVec
 */
export interface NeuroHyperVecOptions {
  /**
   * Description of non-spatial dimensions
   */
  dimensions: DimensionInfo[];
  
  /**
   * Whether to use sparse storage
   */
  sparse?: boolean;
  
  /**
   * Memory limit in bytes for caching
   */
  memoryLimit?: number;
  
  /**
   * Whether to use lazy loading
   */
  lazy?: boolean;
}

/**
 * Reduction operations for collapsing dimensions
 */
export type ReductionOp = 'mean' | 'sum' | 'std' | 'min' | 'max' | 'median' | 'var';

/**
 * Options for dimension reduction
 */
export interface ReductionOptions {
  /**
   * Operation to apply
   */
  operation: ReductionOp;
  
  /**
   * Whether to keep the reduced dimension as size 1
   */
  keepDims?: boolean;
  
  /**
   * Ignore NaN values
   */
  skipNaN?: boolean;
}

/**
 * Options for feature extraction
 */
export interface FeatureExtractionOptions {
  /**
   * Number of components to extract
   */
  nComponents: number;
  
  /**
   * Method for extraction
   */
  method: 'pca' | 'ica' | 'nmf' | 'factor';
  
  /**
   * Whether to standardize features before extraction
   */
  standardize?: boolean;
  
  /**
   * Random seed for reproducibility
   */
  seed?: number;
}

/**
 * Interface for high-dimensional neuroimaging data
 */
export interface INeuroHyperVec {
  /**
   * Spatial dimensions [x, y, z]
   */
  spatialDim: [number, number, number];
  
  /**
   * Spatial coordinate system
   */
  space: NeuroSpace;
  
  /**
   * Information about non-spatial dimensions
   */
  dimensions: DimensionInfo[];
  
  /**
   * Total number of dimensions (spatial + non-spatial)
   */
  ndim: number;
  
  /**
   * Shape of the full array
   */
  shape: number[];
  
  /**
   * Total number of elements
   */
  size: number;
  
  /**
   * Get a sub-volume by specifying indices for non-spatial dimensions
   * @param indices Map of dimension name to index or slice
   */
  getSubVolume(indices: Record<string, number | number[]>): NeuroVol | NeuroVec;
  
  /**
   * Get a time series for a specific voxel across specified dimensions
   * @param x X coordinate
   * @param y Y coordinate  
   * @param z Z coordinate
   * @param dims Dimensions to extract (default: all non-spatial)
   */
  getVoxelSeries(x: number, y: number, z: number, dims?: string[]): number[];
  
  /**
   * Set data for a sub-volume
   * @param indices Indices for non-spatial dimensions
   * @param data Data to set
   */
  setSubVolume(indices: Record<string, number | number[]>, data: NeuroVol | NeuroVec): void;
  
  /**
   * Reduce along specified dimensions
   * @param dims Dimension names to reduce
   * @param options Reduction options
   */
  reduce(dims: string[], options: ReductionOptions): INeuroHyperVec;
  
  /**
   * Apply function along specified dimensions
   * @param dims Dimensions to map over
   * @param fn Function to apply
   */
  mapAlong(dims: string[], fn: (data: NeuroVol) => NeuroVol): INeuroHyperVec;
  
  /**
   * Concatenate with another hypervec along a dimension
   * @param other Other hypervec
   * @param dim Dimension name
   */
  concat(other: INeuroHyperVec, dim: string): INeuroHyperVec;
  
  /**
   * Split along a dimension
   * @param dim Dimension to split
   * @param indices Indices where to split
   */
  split(dim: string, indices: number[]): INeuroHyperVec[];
  
  /**
   * Permute dimensions
   * @param order New dimension order by name
   */
  permute(order: string[]): INeuroHyperVec;
  
  /**
   * Extract features using dimensionality reduction
   * @param options Feature extraction options
   */
  extractFeatures(options: FeatureExtractionOptions): {
    components: INeuroHyperVec;
    loadings: number[][];
    explainedVariance?: number[];
  };
  
  /**
   * Compute correlation between different conditions/subjects
   * @param dim1 First dimension name
   * @param dim2 Second dimension name
   */
  correlateAlong(dim1: string, dim2: string): number[][];
  
  /**
   * Apply GLM across time or conditions
   * @param designMatrix Design matrix
   * @param contrastMatrix Contrast matrix
   */
  glm(designMatrix: number[][], contrastMatrix: number[][]): {
    beta: INeuroHyperVec;
    tstat: NeuroVol;
    pval: NeuroVol;
  };
  
  /**
   * Convert to dense array (use with caution for large data)
   */
  toArray(): Float32Array;
  
  /**
   * Save to file
   * @param filename Output filename
   * @param format Format (hdf5, nifti-5d, custom)
   */
  save(filename: string, format?: string): Promise<void>;
  
  /**
   * Create a view with reordered/subsetted dimensions
   * @param spec Specification for the view
   */
  view(spec: Record<string, number | number[] | 'all'>): INeuroHyperVec;
  
  /**
   * Clone the hypervec
   */
  clone(): INeuroHyperVec;
  
  /**
   * Dispose of resources
   */
  dispose(): void;
}