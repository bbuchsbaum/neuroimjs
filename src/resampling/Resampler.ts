/**
 * Implementation of resampling and interpolation operations
 */

import { NeuroVol } from '../volume/NeuroVol';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { ClusteredNeuroVol, LabelMap } from '../volume/ClusteredNeuroVol';
import {
  IResampler,
  InterpolationMethod,
  ResampleOptions,
  TransformOptions
} from './IResampler';
import { SpatialFilter } from '../spatial/SpatialFilter';

/**
 * Resampling implementation for NeuroVol
 */
export class Resampler implements IResampler {
  private volume: NeuroVol;

  constructor(volume: NeuroVol) {
    this.volume = volume;
  }

  /**
   * Resample volume to new space/resolution
   */
  resample(targetSpace: NeuroSpace, options: ResampleOptions = {}): NeuroVol {
    const {
      method = 'linear',
      antiAlias = true,
      backgroundValue = 0,
      preserveType = false
    } = options;

    const srcDim = this.volume.dim;
    const targetDim = targetSpace.dim;
    const result = new Float32Array(targetDim[0] * targetDim[1] * targetDim[2]);

    // Apply anti-aliasing if downsampling
    let sourceVolume = this.volume;
    if (antiAlias && this.needsAntiAliasing(targetSpace)) {
      sourceVolume = this.applyAntiAliasingFilter();
    }

    // Resample each voxel in target space
    let idx = 0;
    for (let k = 0; k < targetDim[2]; k++) {
      for (let j = 0; j < targetDim[1]; j++) {
        for (let i = 0; i < targetDim[0]; i++) {
          // Convert target voxel to world coordinates
          const worldCoord = targetSpace.voxelToWorld([i, j, k]);
          
          // Convert world to source voxel coordinates
          const srcCoord = sourceVolume.space.worldToVoxel(worldCoord);
          
          // Interpolate value
          result[idx++] = this.interpolate(
            sourceVolume, 
            srcCoord[0], 
            srcCoord[1], 
            srcCoord[2], 
            method, 
            backgroundValue
          );
        }
      }
    }

    return new FloatNeuroVol(targetSpace, result);
  }

  /**
   * Resample to specific voxel dimensions
   */
  resampleToDimensions(dimensions: [number, number, number], options?: ResampleOptions): NeuroVol {
    const currentDim = this.volume.dim;
    const currentSpacing = this.volume.space.spacing;
    
    // Calculate new spacing to maintain FOV
    const newSpacing: [number, number, number] = [
      (currentDim[0] * currentSpacing[0]) / dimensions[0],
      (currentDim[1] * currentSpacing[1]) / dimensions[1],
      (currentDim[2] * currentSpacing[2]) / dimensions[2]
    ];

    const targetSpace = new NeuroSpace(
      dimensions,
      newSpacing,
      this.volume.space.origin,
      this.volume.space.axes
    );

    return this.resample(targetSpace, options);
  }

  /**
   * Resample to specific voxel size
   */
  resampleToVoxelSize(voxelSize: [number, number, number], options?: ResampleOptions): NeuroVol {
    const currentDim = this.volume.dim;
    const currentSpacing = this.volume.space.spacing;
    
    // Calculate new dimensions
    const newDim: [number, number, number] = [
      Math.round((currentDim[0] * currentSpacing[0]) / voxelSize[0]),
      Math.round((currentDim[1] * currentSpacing[1]) / voxelSize[1]),
      Math.round((currentDim[2] * currentSpacing[2]) / voxelSize[2])
    ];

    const targetSpace = new NeuroSpace(
      newDim,
      voxelSize,
      this.volume.space.origin,
      this.volume.space.axes
    );

    return this.resample(targetSpace, options);
  }

  /**
   * Apply affine transformation
   */
  transform(options: TransformOptions): NeuroVol {
    const matrix = this.buildTransformMatrix(options);
    const transformedSpace = this.transformSpace(this.volume.space, matrix);
    
    return this.resample(transformedSpace, {
      method: 'linear',
      backgroundValue: 0
    });
  }

  /**
   * Interpolate value at continuous coordinate
   */
  interpolateAt(x: number, y: number, z: number, method: InterpolationMethod = 'linear'): number {
    return this.interpolate(this.volume, x, y, z, method, 0);
  }

  /**
   * Downsample by integer factor
   */
  downsample(factor: number, options?: ResampleOptions): NeuroVol {
    const currentDim = this.volume.dim;
    const newDim: [number, number, number] = [
      Math.floor(currentDim[0] / factor),
      Math.floor(currentDim[1] / factor),
      Math.floor(currentDim[2] / factor)
    ];

    return this.resampleToDimensions(newDim, {
      ...options,
      antiAlias: options?.antiAlias ?? true
    });
  }

  /**
   * Upsample by integer factor
   */
  upsample(factor: number, options?: ResampleOptions): NeuroVol {
    const currentDim = this.volume.dim;
    const newDim: [number, number, number] = [
      currentDim[0] * factor,
      currentDim[1] * factor,
      currentDim[2] * factor
    ];

    return this.resampleToDimensions(newDim, options);
  }

  /**
   * Resample a ClusteredNeuroVol to a new target space.
   *
   * Uses nearest-neighbour interpolation to preserve integer labels.
   * The algorithm:
   *  1. Resample labels (dense Int32 representation) with nearest-neighbour
   *  2. Resample the mask with nearest-neighbour
   *  3. Keep voxels where both resampled mask and label are non-zero
   *  4. Build a new ClusteredNeuroVol with the surviving labels
   */
  static resampleClustered(
    source: ClusteredNeuroVol,
    targetSpace: NeuroSpace
  ): ClusteredNeuroVol {
    const targetDim = targetSpace.dim;
    const totalTarget = targetDim[0] * targetDim[1] * targetDim[2];

    // Dense representations
    const labelData = source.getData();   // Int32Array with cluster ids
    const maskData = source.mask.getData(); // Uint8Array

    // Resample both with nearest-neighbour
    const resampledLabels = new Int32Array(totalTarget);
    const resampledMask = new Uint8Array(totalTarget);

    let idx = 0;
    for (let k = 0; k < targetDim[2]; k++) {
      for (let j = 0; j < targetDim[1]; j++) {
        for (let i = 0; i < targetDim[0]; i++, idx++) {
          // Target voxel -> world -> source voxel
          const worldCoord = targetSpace.voxelToWorld([i, j, k]);
          const srcCoord = source.space.worldToVoxel(worldCoord);

          const si = Math.round(srcCoord[0]);
          const sj = Math.round(srcCoord[1]);
          const sk = Math.round(srcCoord[2]);

          if (
            si >= 0 && si < source.dim[0] &&
            sj >= 0 && sj < source.dim[1] &&
            sk >= 0 && sk < source.dim[2]
          ) {
            const srcIdx = si + sj * source.dim[0] + sk * source.dim[0] * source.dim[1];
            resampledLabels[idx] = labelData[srcIdx];
            resampledMask[idx] = maskData[srcIdx];
          }
        }
      }
    }

    // Build new mask + clusters: keep where both are non-zero
    const finalMaskData = new Uint8Array(totalTarget);
    const clusterIds: number[] = [];
    for (let idx = 0; idx < totalTarget; idx++) {
      if (resampledMask[idx] !== 0 && resampledLabels[idx] !== 0) {
        finalMaskData[idx] = 1;
        clusterIds.push(resampledLabels[idx]);
      }
    }

    const mask = new LogicalNeuroVol(targetSpace, finalMaskData);

    // Filter label map to only include surviving labels
    const survivingIds = new Set(clusterIds);
    const filteredLabelMap: LabelMap = {};
    for (const [name, id] of Object.entries(source.labelMap)) {
      if (survivingIds.has(id)) {
        filteredLabelMap[name] = id;
      }
    }

    return new ClusteredNeuroVol(mask, new Int32Array(clusterIds), filteredLabelMap);
  }

  // Private helper methods

  private interpolate(
    volume: NeuroVol, 
    x: number, 
    y: number, 
    z: number, 
    method: InterpolationMethod,
    backgroundValue: number
  ): number {
    const [dimX, dimY, dimZ] = volume.dim;

    // Check bounds - allow for proper interpolation at edges
    if (x < -0.5 || x > dimX - 0.5 ||
        y < -0.5 || y > dimY - 0.5 ||
        z < -0.5 || z > dimZ - 0.5) {
      return backgroundValue;
    }

    switch (method) {
      case 'nearest':
        return this.nearestInterpolation(volume, x, y, z, backgroundValue);
      case 'linear':
        return this.linearInterpolation(volume, x, y, z, backgroundValue);
      case 'cubic':
        return this.cubicInterpolation(volume, x, y, z, backgroundValue);
      case 'lanczos':
        return this.lanczosInterpolation(volume, x, y, z, backgroundValue);
      default:
        throw new Error(`Unknown interpolation method: ${method}`);
    }
  }

  private nearestInterpolation(
    volume: NeuroVol, 
    x: number, 
    y: number, 
    z: number,
    backgroundValue: number
  ): number {
    const i = Math.round(x);
    const j = Math.round(y);
    const k = Math.round(z);
    
    const [dimX, dimY, dimZ] = volume.dim;
    if (i < 0 || i >= dimX || j < 0 || j >= dimY || k < 0 || k >= dimZ) {
      return backgroundValue;
    }
    
    return volume.getAt(i, j, k);
  }

  private linearInterpolation(
    volume: NeuroVol, 
    x: number, 
    y: number, 
    z: number,
    backgroundValue: number
  ): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const z1 = z0 + 1;

    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;

    const [dimX, dimY, dimZ] = volume.dim;

    // Get values at 8 corners
    const v000 = this.getVoxelSafe(volume, x0, y0, z0, dimX, dimY, dimZ, backgroundValue);
    const v001 = this.getVoxelSafe(volume, x0, y0, z1, dimX, dimY, dimZ, backgroundValue);
    const v010 = this.getVoxelSafe(volume, x0, y1, z0, dimX, dimY, dimZ, backgroundValue);
    const v011 = this.getVoxelSafe(volume, x0, y1, z1, dimX, dimY, dimZ, backgroundValue);
    const v100 = this.getVoxelSafe(volume, x1, y0, z0, dimX, dimY, dimZ, backgroundValue);
    const v101 = this.getVoxelSafe(volume, x1, y0, z1, dimX, dimY, dimZ, backgroundValue);
    const v110 = this.getVoxelSafe(volume, x1, y1, z0, dimX, dimY, dimZ, backgroundValue);
    const v111 = this.getVoxelSafe(volume, x1, y1, z1, dimX, dimY, dimZ, backgroundValue);

    // Check if all corners are background - if so, return background
    if (v000 === backgroundValue && v001 === backgroundValue && 
        v010 === backgroundValue && v011 === backgroundValue &&
        v100 === backgroundValue && v101 === backgroundValue &&
        v110 === backgroundValue && v111 === backgroundValue) {
      return backgroundValue;
    }

    // Trilinear interpolation
    const v00 = v000 * (1 - fx) + v100 * fx;
    const v01 = v001 * (1 - fx) + v101 * fx;
    const v10 = v010 * (1 - fx) + v110 * fx;
    const v11 = v011 * (1 - fx) + v111 * fx;

    const v0 = v00 * (1 - fy) + v10 * fy;
    const v1 = v01 * (1 - fy) + v11 * fy;

    return v0 * (1 - fz) + v1 * fz;
  }

  private cubicInterpolation(
    volume: NeuroVol, 
    x: number, 
    y: number, 
    z: number,
    backgroundValue: number
  ): number {
    // Cubic convolution interpolation
    const [dimX, dimY, dimZ] = volume.dim;
    
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    
    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;
    
    let sum = 0;
    let weightSum = 0;
    
    // 4x4x4 neighborhood
    for (let dk = -1; dk <= 2; dk++) {
      for (let dj = -1; dj <= 2; dj++) {
        for (let di = -1; di <= 2; di++) {
          const i = x0 + di;
          const j = y0 + dj;
          const k = z0 + dk;
          
          const wx = this.cubicWeight(fx - di);
          const wy = this.cubicWeight(fy - dj);
          const wz = this.cubicWeight(fz - dk);
          const weight = wx * wy * wz;
          
          if (weight !== 0) {
            const value = this.getVoxelSafe(volume, i, j, k, dimX, dimY, dimZ, backgroundValue);
            sum += weight * value;
            weightSum += weight;
          }
        }
      }
    }
    
    return weightSum > 0 ? sum / weightSum : backgroundValue;
  }

  private lanczosInterpolation(
    volume: NeuroVol, 
    x: number, 
    y: number, 
    z: number,
    backgroundValue: number
  ): number {
    // Lanczos interpolation with a=3
    const a = 3;
    const [dimX, dimY, dimZ] = volume.dim;
    
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    
    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;
    
    let sum = 0;
    let weightSum = 0;
    
    // (2a)x(2a)x(2a) neighborhood
    for (let dk = -a + 1; dk <= a; dk++) {
      for (let dj = -a + 1; dj <= a; dj++) {
        for (let di = -a + 1; di <= a; di++) {
          const i = x0 + di;
          const j = y0 + dj;
          const k = z0 + dk;
          
          const wx = this.lanczosWeight(fx - di, a);
          const wy = this.lanczosWeight(fy - dj, a);
          const wz = this.lanczosWeight(fz - dk, a);
          const weight = wx * wy * wz;
          
          if (weight !== 0) {
            const value = this.getVoxelSafe(volume, i, j, k, dimX, dimY, dimZ, backgroundValue);
            sum += weight * value;
            weightSum += weight;
          }
        }
      }
    }
    
    return weightSum > 0 ? sum / weightSum : backgroundValue;
  }

  private cubicWeight(x: number): number {
    // Cubic convolution kernel (Mitchell-Netravali with B=0, C=0.5)
    const absX = Math.abs(x);
    if (absX >= 2) return 0;
    
    if (absX < 1) {
      return 1 - 2.5 * absX * absX + 1.5 * absX * absX * absX;
    } else {
      return 2 - 4 * absX + 2.5 * absX * absX - 0.5 * absX * absX * absX;
    }
  }

  private lanczosWeight(x: number, a: number): number {
    if (x === 0) return 1;
    if (Math.abs(x) >= a) return 0;
    
    const piX = Math.PI * x;
    const piXOverA = piX / a;
    
    return (Math.sin(piX) / piX) * (Math.sin(piXOverA) / piXOverA);
  }

  private getVoxelSafe(
    volume: NeuroVol, 
    i: number, 
    j: number, 
    k: number,
    dimX: number, 
    dimY: number, 
    dimZ: number,
    backgroundValue: number
  ): number {
    if (i < 0 || i >= dimX || j < 0 || j >= dimY || k < 0 || k >= dimZ) {
      return backgroundValue;
    }
    return volume.getAt(i, j, k);
  }

  private needsAntiAliasing(targetSpace: NeuroSpace): boolean {
    const srcDim = this.volume.dim;
    const targetDim = targetSpace.dim;
    
    // Check if any dimension is being downsampled by more than factor of 1.5
    // This happens when target has fewer voxels than source
    return srcDim[0] / targetDim[0] > 1.5 ||
           srcDim[1] / targetDim[1] > 1.5 ||
           srcDim[2] / targetDim[2] > 1.5;
  }

  private applyAntiAliasingFilter(): NeuroVol {
    // Apply Gaussian smoothing before downsampling
    // Sigma based on downsampling factor
    const srcSpacing = this.volume.space.spacing;
    const sigma = [
      Math.max(srcSpacing[0] * 0.5, 1.0),
      Math.max(srcSpacing[1] * 0.5, 1.0),
      Math.max(srcSpacing[2] * 0.5, 1.0)
    ];
    
    const filter = new SpatialFilter(this.volume);
    return filter.gaussianBlur(sigma as [number, number, number]);
  }

  private buildTransformMatrix(options: TransformOptions): number[][] {
    if (options.matrix) {
      return options.matrix;
    }

    // Build matrix from components
    const matrix = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];

    const center = options.center || [0, 0, 0];

    // Translation
    if (options.translation) {
      matrix[0][3] = options.translation[0];
      matrix[1][3] = options.translation[1];
      matrix[2][3] = options.translation[2];
    }

    // Scale
    if (options.scale) {
      const scaleMatrix = [
        [options.scale[0], 0, 0, 0],
        [0, options.scale[1], 0, 0],
        [0, 0, options.scale[2], 0],
        [0, 0, 0, 1]
      ];
      this.multiplyMatrices(matrix, scaleMatrix);
    }

    // Rotation
    if (options.rotation) {
      // Rotation around X
      const cosX = Math.cos(options.rotation[0]);
      const sinX = Math.sin(options.rotation[0]);
      const rotX = [
        [1, 0, 0, 0],
        [0, cosX, -sinX, 0],
        [0, sinX, cosX, 0],
        [0, 0, 0, 1]
      ];
      this.multiplyMatrices(matrix, rotX);

      // Rotation around Y
      const cosY = Math.cos(options.rotation[1]);
      const sinY = Math.sin(options.rotation[1]);
      const rotY = [
        [cosY, 0, sinY, 0],
        [0, 1, 0, 0],
        [-sinY, 0, cosY, 0],
        [0, 0, 0, 1]
      ];
      this.multiplyMatrices(matrix, rotY);

      // Rotation around Z
      const cosZ = Math.cos(options.rotation[2]);
      const sinZ = Math.sin(options.rotation[2]);
      const rotZ = [
        [cosZ, -sinZ, 0, 0],
        [sinZ, cosZ, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ];
      this.multiplyMatrices(matrix, rotZ);
    }

    return matrix;
  }

  private multiplyMatrices(a: number[][], b: number[][]): void {
    // In-place multiplication: a = a * b
    const temp = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ];

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          temp[i][j] += a[i][k] * b[k][j];
        }
      }
    }

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        a[i][j] = temp[i][j];
      }
    }
  }

  private transformSpace(space: NeuroSpace, matrix: number[][]): NeuroSpace {
    // For now, return the same space
    // Full implementation would transform the space axes
    return space;
  }
}

/**
 * Add resampling methods to NeuroVol
 */
export function addResamplingToNeuroVol() {
  const proto = Object.getPrototypeOf(FloatNeuroVol.prototype);
  
  proto.resample = function(this: NeuroVol, targetSpace: NeuroSpace, options?: ResampleOptions) {
    return new Resampler(this).resample(targetSpace, options);
  };

  proto.resampleToDimensions = function(this: NeuroVol, dimensions: [number, number, number], options?: ResampleOptions) {
    return new Resampler(this).resampleToDimensions(dimensions, options);
  };

  proto.resampleToVoxelSize = function(this: NeuroVol, voxelSize: [number, number, number], options?: ResampleOptions) {
    return new Resampler(this).resampleToVoxelSize(voxelSize, options);
  };

  proto.downsample = function(this: NeuroVol, factor: number, options?: ResampleOptions) {
    return new Resampler(this).downsample(factor, options);
  };

  proto.upsample = function(this: NeuroVol, factor: number, options?: ResampleOptions) {
    return new Resampler(this).upsample(factor, options);
  };
}