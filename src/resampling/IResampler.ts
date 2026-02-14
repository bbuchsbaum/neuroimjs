/**
 * Interface for resampling and interpolation operations on neuroimaging data
 */

import { NeuroVol } from '../volume/NeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';

/**
 * Interpolation method for resampling
 */
export type InterpolationMethod = 'nearest' | 'linear' | 'cubic' | 'lanczos';

/**
 * Options for resampling operations
 */
export interface ResampleOptions {
  /**
   * Interpolation method to use
   */
  method?: InterpolationMethod;
  
  /**
   * Anti-aliasing filter before downsampling
   */
  antiAlias?: boolean;
  
  /**
   * Background value for out-of-bounds voxels
   */
  backgroundValue?: number;
  
  /**
   * Preserve data type of original volume
   */
  preserveType?: boolean;
}

/**
 * Options for coordinate transformation
 */
export interface TransformOptions {
  /**
   * 4x4 affine transformation matrix
   */
  matrix?: number[][];
  
  /**
   * Translation vector [x, y, z]
   */
  translation?: [number, number, number];
  
  /**
   * Rotation angles in radians [x, y, z]
   */
  rotation?: [number, number, number];
  
  /**
   * Scaling factors [x, y, z]
   */
  scale?: [number, number, number];
  
  /**
   * Center of rotation/scaling
   */
  center?: [number, number, number];
}

/**
 * Interface for resampling operations
 */
export interface IResampler {
  /**
   * Resample volume to new space/resolution
   * @param targetSpace Target space definition
   * @param options Resampling options
   */
  resample(targetSpace: NeuroSpace, options?: ResampleOptions): NeuroVol;
  
  /**
   * Resample to specific voxel dimensions
   * @param dimensions New dimensions [x, y, z]
   * @param options Resampling options
   */
  resampleToDimensions(dimensions: [number, number, number], options?: ResampleOptions): NeuroVol;
  
  /**
   * Resample to specific voxel size
   * @param voxelSize New voxel size [x, y, z] in mm
   * @param options Resampling options
   */
  resampleToVoxelSize(voxelSize: [number, number, number], options?: ResampleOptions): NeuroVol;
  
  /**
   * Apply affine transformation
   * @param options Transform options
   */
  transform(options: TransformOptions): NeuroVol;
  
  /**
   * Interpolate value at continuous coordinate
   * @param x X coordinate
   * @param y Y coordinate
   * @param z Z coordinate
   * @param method Interpolation method
   */
  interpolateAt(x: number, y: number, z: number, method?: InterpolationMethod): number;
  
  /**
   * Downsample by integer factor
   * @param factor Downsampling factor (e.g., 2 = half resolution)
   * @param options Resampling options
   */
  downsample(factor: number, options?: ResampleOptions): NeuroVol;
  
  /**
   * Upsample by integer factor
   * @param factor Upsampling factor (e.g., 2 = double resolution)
   * @param options Resampling options
   */
  upsample(factor: number, options?: ResampleOptions): NeuroVol;
}