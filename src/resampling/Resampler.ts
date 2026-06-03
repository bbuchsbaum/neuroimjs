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
   * Apply an affine transformation to the volume, resampling onto a grid of the
   * same dimensions/spacing as the input.
   *
   * The transform is expressed in voxel (grid) coordinates. The forward map
   * sends an input voxel `p` to an output voxel `q` via
   *
   *   q = M * (p - center) + center + translation
   *
   * where `M = R * S` (rotation composed with scale). Resampling fills each
   * OUTPUT voxel `q` by mapping it back into the INPUT volume with the inverse
   * transform and sampling there:
   *
   *   p = M^-1 * (q - center - translation) + center
   */
  transform(options: TransformOptions, resampleOptions: ResampleOptions = {}): NeuroVol {
    const { method = 'linear', backgroundValue = 0 } = resampleOptions;

    // Build the forward 4x4 voxel-space matrix and invert it. We resample each
    // output voxel by applying the inverse map and sampling the input volume.
    const forward = this.buildTransformMatrix(options);
    const inverse = this.invertMatrix4(forward);

    const [dimX, dimY, dimZ] = this.volume.dim;
    const result = new Float32Array(dimX * dimY * dimZ);

    let idx = 0;
    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          // Map this output voxel back into the input volume.
          const sx =
            inverse[0][0] * i + inverse[0][1] * j + inverse[0][2] * k + inverse[0][3];
          const sy =
            inverse[1][0] * i + inverse[1][1] * j + inverse[1][2] * k + inverse[1][3];
          const sz =
            inverse[2][0] * i + inverse[2][1] * j + inverse[2][2] * k + inverse[2][3];

          result[idx++] = this.interpolate(
            this.volume,
            sx,
            sy,
            sz,
            method,
            backgroundValue
          );
        }
      }
    }

    return new FloatNeuroVol(this.volume.space, result);
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
            // Out-of-bounds taps are filled by linear extrapolation from the
            // nearest in-bounds samples rather than by the background value.
            //
            // The previous code added weight * backgroundValue to the numerator
            // but still added weight to weightSum, biasing every sample within a
            // kernel radius of an edge (e.g. the linear ramp f(i)=i interpolated
            // at x=0.5 returned 0.4375 instead of 0.5). Simply dropping the taps
            // and renormalizing is also biased (it yields 0.4118) because the
            // cubic/Lanczos kernels only reproduce linear functions when given a
            // full, symmetric set of taps. Distance-based linear extrapolation
            // restores that and makes the ramp interpolate to its exact value.
            const value = this.getVoxelExtrapolated(volume, i, j, k, dimX, dimY, dimZ);
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
            // Out-of-bounds taps are filled by linear extrapolation from the
            // nearest in-bounds samples rather than the background value. See
            // cubicInterpolation for the rationale: adding background to the
            // numerator while keeping its weight in weightSum biases every
            // sample near an edge.
            const value = this.getVoxelExtrapolated(volume, i, j, k, dimX, dimY, dimZ);
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

  /**
   * Sample a voxel, extrapolating linearly along any axis whose index is out of
   * bounds. Extrapolation is performed independently per axis from the two
   * nearest in-bounds planes, using the actual distance past the edge so that a
   * locally linear field is continued exactly:
   *
   *   value(idx < 0)      = f(0)     + idx       * (f(1) - f(0))
   *   value(idx > dim-1)  = f(dim-1) + (idx-(dim-1)) * (f(dim-1) - f(dim-2))
   *
   * This is what lets the cubic and Lanczos kernels reproduce linear ramps
   * exactly right up to the volume boundary. Because callers only reach this
   * code for points within half a voxel of the valid range (see interpolate()),
   * the extrapolation always stays within a few voxels of an edge.
   */
  private getVoxelExtrapolated(
    volume: NeuroVol,
    i: number,
    j: number,
    k: number,
    dimX: number,
    dimY: number,
    dimZ: number
  ): number {
    return this.extrapolateAxis(i, dimX, ci =>
      this.extrapolateAxis(j, dimY, cj =>
        this.extrapolateAxis(k, dimZ, ck => volume.getAt(ci, cj, ck))
      )
    );
  }

  /**
   * Linearly extrapolate a single axis. `getValue` returns the field value at a
   * valid integer index along this axis (with the other axes already fixed).
   */
  private extrapolateAxis(
    idx: number,
    dim: number,
    getValue: (validIndex: number) => number
  ): number {
    if (idx >= 0 && idx < dim) {
      return getValue(idx);
    }
    if (dim === 1) {
      // Degenerate axis: no slope information, hold the single sample.
      return getValue(0);
    }
    if (idx < 0) {
      const f0 = getValue(0);
      const f1 = getValue(1);
      return f0 + idx * (f1 - f0);
    }
    const fn = getValue(dim - 1);
    const fn1 = getValue(dim - 2);
    return fn + (idx - (dim - 1)) * (fn - fn1);
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

  /**
   * Build the forward affine matrix (in voxel/grid coordinates) from the
   * supplied transform options. The composite map applied to a point `p` is
   *
   *   q = T(translation) * T(center) * R * S * T(-center) * p
   *
   * so that rotation and scale are applied about `center` (when provided) and
   * the translation is applied in the (un-centered) grid frame afterwards. When
   * `options.matrix` is supplied it is used verbatim.
   */
  private buildTransformMatrix(options: TransformOptions): number[][] {
    if (options.matrix) {
      return options.matrix.map(row => [...row]);
    }

    const center = options.center || [0, 0, 0];

    // Accumulator starts as identity. Because multiplyMatrices computes a = a*b,
    // we right-multiply factors in the order they appear in the composition
    // above (leftmost factor first).
    let matrix = this.identityMatrix4();

    // Outer translation (applied last to a point).
    if (options.translation) {
      this.multiplyMatrices(matrix, this.translationMatrix(
        options.translation[0],
        options.translation[1],
        options.translation[2]
      ));
    }

    // Move center to origin AFTER rotation/scale: T(center).
    this.multiplyMatrices(matrix, this.translationMatrix(center[0], center[1], center[2]));

    // Rotation (Z * Y * X intrinsic ordering, matching the original convention).
    if (options.rotation) {
      const cosX = Math.cos(options.rotation[0]);
      const sinX = Math.sin(options.rotation[0]);
      this.multiplyMatrices(matrix, [
        [1, 0, 0, 0],
        [0, cosX, -sinX, 0],
        [0, sinX, cosX, 0],
        [0, 0, 0, 1]
      ]);

      const cosY = Math.cos(options.rotation[1]);
      const sinY = Math.sin(options.rotation[1]);
      this.multiplyMatrices(matrix, [
        [cosY, 0, sinY, 0],
        [0, 1, 0, 0],
        [-sinY, 0, cosY, 0],
        [0, 0, 0, 1]
      ]);

      const cosZ = Math.cos(options.rotation[2]);
      const sinZ = Math.sin(options.rotation[2]);
      this.multiplyMatrices(matrix, [
        [cosZ, -sinZ, 0, 0],
        [sinZ, cosZ, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ]);
    }

    // Scale about the (already centered) origin.
    if (options.scale) {
      this.multiplyMatrices(matrix, [
        [options.scale[0], 0, 0, 0],
        [0, options.scale[1], 0, 0],
        [0, 0, options.scale[2], 0],
        [0, 0, 0, 1]
      ]);
    }

    // Move origin back to center: T(-center) (applied first to a point).
    this.multiplyMatrices(matrix, this.translationMatrix(-center[0], -center[1], -center[2]));

    return matrix;
  }

  private identityMatrix4(): number[][] {
    return [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
  }

  private translationMatrix(tx: number, ty: number, tz: number): number[][] {
    return [
      [1, 0, 0, tx],
      [0, 1, 0, ty],
      [0, 0, 1, tz],
      [0, 0, 0, 1]
    ];
  }

  /**
   * Invert a 4x4 affine matrix via Gauss-Jordan elimination with partial
   * pivoting. Used to map output voxels back into the input volume.
   */
  private invertMatrix4(m: number[][]): number[][] {
    // Augmented [m | I]
    const a: number[][] = m.map((row, r) => [
      ...row,
      ...[0, 1, 2, 3].map(c => (c === r ? 1 : 0))
    ]);

    for (let col = 0; col < 4; col++) {
      // Partial pivot: find the row with the largest magnitude in this column.
      let pivot = col;
      let maxAbs = Math.abs(a[col][col]);
      for (let r = col + 1; r < 4; r++) {
        const v = Math.abs(a[r][col]);
        if (v > maxAbs) {
          maxAbs = v;
          pivot = r;
        }
      }
      if (maxAbs < 1e-12) {
        throw new Error('Resampler.transform: transform matrix is singular and cannot be inverted');
      }
      if (pivot !== col) {
        const tmp = a[col];
        a[col] = a[pivot];
        a[pivot] = tmp;
      }

      // Normalize the pivot row.
      const pivVal = a[col][col];
      for (let c = 0; c < 8; c++) {
        a[col][c] /= pivVal;
      }

      // Eliminate the column entry from all other rows.
      for (let r = 0; r < 4; r++) {
        if (r === col) continue;
        const factor = a[r][col];
        if (factor === 0) continue;
        for (let c = 0; c < 8; c++) {
          a[r][c] -= factor * a[col][c];
        }
      }
    }

    // Extract the right half as the inverse.
    return a.map(row => row.slice(4, 8));
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