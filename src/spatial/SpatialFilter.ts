/**
 * Spatial filtering operations for 3D neuroimaging data
 */

import { NeuroVol } from '../volume/NeuroVol';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { 
  ISpatialFilter, 
  BilateralFilterOptions, 
  GuidedFilterOptions 
} from './ISpatialFilter';
import { Kernel3D } from './Kernel3D';

/**
 * Implementation of spatial filtering operations for NeuroVol
 */
export class SpatialFilter implements ISpatialFilter {
  private volume: NeuroVol;

  constructor(volume: NeuroVol) {
    this.volume = volume;
  }

  /**
   * Apply Gaussian blur
   */
  gaussianBlur(sigma: number | [number, number, number]): NeuroVol {
    const kernel = Kernel3D.gaussian(sigma);
    return this.spatialFilter(kernel);
  }

  /**
   * Apply bilateral filter for edge-preserving smoothing
   */
  bilateralFilter(options: BilateralFilterOptions): NeuroVol {
    const { spatialSigma, intensitySigma, windowSize = 5 } = options;
    const [dimX, dimY, dimZ] = this.volume.dim;
    const result = new Float32Array(dimX * dimY * dimZ);
    const halfWindow = Math.floor(windowSize / 2);

    // Pre-compute spatial weights
    const spatialWeights: number[][][] = [];
    for (let di = -halfWindow; di <= halfWindow; di++) {
      const plane: number[][] = [];
      for (let dj = -halfWindow; dj <= halfWindow; dj++) {
        const row: number[] = [];
        for (let dk = -halfWindow; dk <= halfWindow; dk++) {
          const distance = Math.sqrt(di * di + dj * dj + dk * dk);
          row.push(Math.exp(-(distance * distance) / (2 * spatialSigma * spatialSigma)));
        }
        plane.push(row);
      }
      spatialWeights.push(plane);
    }

    // Apply bilateral filter
    let idx = 0;
    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          const centerValue = this.volume.getAt(i, j, k);
          let weightSum = 0;
          let valueSum = 0;

          // Apply filter window
          for (let di = -halfWindow; di <= halfWindow; di++) {
            for (let dj = -halfWindow; dj <= halfWindow; dj++) {
              for (let dk = -halfWindow; dk <= halfWindow; dk++) {
                const ni = i + di;
                const nj = j + dj;
                const nk = k + dk;

                // Check bounds
                if (ni >= 0 && ni < dimX && nj >= 0 && nj < dimY && nk >= 0 && nk < dimZ) {
                  const neighborValue = this.volume.getAt(ni, nj, nk);
                  const intensityDiff = neighborValue - centerValue;
                  
                  // Spatial weight
                  const spatialWeight = spatialWeights[di + halfWindow][dj + halfWindow][dk + halfWindow];
                  
                  // Intensity weight
                  const intensityWeight = Math.exp(
                    -(intensityDiff * intensityDiff) / (2 * intensitySigma * intensitySigma)
                  );
                  
                  const weight = spatialWeight * intensityWeight;
                  weightSum += weight;
                  valueSum += weight * neighborValue;
                }
              }
            }
          }

          result[idx++] = weightSum > 0 ? valueSum / weightSum : centerValue;
        }
      }
    }

    return new FloatNeuroVol(this.volume.space, result);
  }

  /**
   * Apply guided filter (He et al. 2013).
   *
   * When no guide is provided the filter is self-guided (edge-preserving
   * smoothing).  The algorithm:
   *
   *   mean_I  = box(I, r)
   *   mean_p  = box(p, r)
   *   corr_Ip = box(I*p, r)
   *   corr_II = box(I*I, r)
   *   var_I   = corr_II - mean_I * mean_I
   *   cov_Ip  = corr_Ip - mean_I * mean_p
   *   a       = cov_Ip / (var_I + eps)
   *   b       = mean_p - a * mean_I
   *   mean_a  = box(a, r)
   *   mean_b  = box(b, r)
   *   output  = mean_a * I + mean_b
   */
  guidedFilter(options: GuidedFilterOptions): NeuroVol {
    const { radius, epsilon, guide } = options;
    const [dimX, dimY, dimZ] = this.volume.dim;
    const n = dimX * dimY * dimZ;

    // I = guide volume (or self), p = input volume
    const guideVol = guide || this.volume;
    const I = guideVol.getData();
    const p = this.volume.getData();

    // Helper: box blur on a flat Float32Array, returns new Float32Array
    const boxBlur = (src: Float32Array): Float32Array => {
      const out = new Float32Array(n);
      const r = Math.max(1, Math.round(radius));

      // Separable box blur: X pass -> Y pass -> Z pass
      // Each pass averages over (2r+1) with boundary clamping and
      // proper normalisation (divide by the count of in-bounds neighbours).

      const tmp1 = new Float32Array(n);
      const tmp2 = new Float32Array(n);

      // --- X pass ---
      for (let k = 0; k < dimZ; k++) {
        for (let j = 0; j < dimY; j++) {
          const rowBase = j * dimX + k * dimX * dimY;
          let sum = 0;
          let count = 0;
          // seed window [0, r]
          for (let x = 0; x <= Math.min(r, dimX - 1); x++) {
            sum += src[rowBase + x];
            count++;
          }
          tmp1[rowBase] = sum / count;
          for (let i = 1; i < dimX; i++) {
            // add right edge
            const addX = i + r;
            if (addX < dimX) { sum += src[rowBase + addX]; count++; }
            // remove left edge
            const remX = i - r - 1;
            if (remX >= 0) { sum -= src[rowBase + remX]; count--; }
            tmp1[rowBase + i] = sum / count;
          }
        }
      }

      // --- Y pass ---
      for (let k = 0; k < dimZ; k++) {
        for (let i = 0; i < dimX; i++) {
          let sum = 0;
          let count = 0;
          for (let y = 0; y <= Math.min(r, dimY - 1); y++) {
            sum += tmp1[i + y * dimX + k * dimX * dimY];
            count++;
          }
          tmp2[i + k * dimX * dimY] = sum / count;
          for (let j = 1; j < dimY; j++) {
            const addY = j + r;
            if (addY < dimY) { sum += tmp1[i + addY * dimX + k * dimX * dimY]; count++; }
            const remY = j - r - 1;
            if (remY >= 0) { sum -= tmp1[i + remY * dimX + k * dimX * dimY]; count--; }
            tmp2[i + j * dimX + k * dimX * dimY] = sum / count;
          }
        }
      }

      // --- Z pass ---
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          let sum = 0;
          let count = 0;
          for (let z = 0; z <= Math.min(r, dimZ - 1); z++) {
            sum += tmp2[i + j * dimX + z * dimX * dimY];
            count++;
          }
          out[i + j * dimX] = sum / count;
          for (let k = 1; k < dimZ; k++) {
            const addZ = k + r;
            if (addZ < dimZ) { sum += tmp2[i + j * dimX + addZ * dimX * dimY]; count++; }
            const remZ = k - r - 1;
            if (remZ >= 0) { sum -= tmp2[i + j * dimX + remZ * dimX * dimY]; count--; }
            out[i + j * dimX + k * dimX * dimY] = sum / count;
          }
        }
      }

      return out;
    };

    // element-wise multiply two Float32Arrays
    const mul = (a: Float32Array | ReturnType<typeof Float32Array.prototype.slice>, b: Float32Array): Float32Array => {
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = a[i] * b[i];
      return o;
    };

    const Iarr = Float32Array.from(I);
    const parr = Float32Array.from(p);

    const mean_I = boxBlur(Iarr);
    const mean_p = boxBlur(parr);
    const corr_II = boxBlur(mul(Iarr, Iarr));
    const corr_Ip = boxBlur(mul(Iarr, parr));

    const eps = epsilon ?? 0.01;

    // a = cov_Ip / (var_I + eps),  b = mean_p - a * mean_I
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const var_I = corr_II[i] - mean_I[i] * mean_I[i];
      const cov_Ip = corr_Ip[i] - mean_I[i] * mean_p[i];
      a[i] = cov_Ip / (var_I + eps);
      b[i] = mean_p[i] - a[i] * mean_I[i];
    }

    const mean_a = boxBlur(a);
    const mean_b = boxBlur(b);

    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = mean_a[i] * Iarr[i] + mean_b[i];
    }

    return new FloatNeuroVol(this.volume.space, result);
  }

  /**
   * Apply a custom 3D kernel
   */
  spatialFilter(kernel: Kernel3D): NeuroVol {
    const [dimX, dimY, dimZ] = this.volume.dim;
    const result = new Float32Array(dimX * dimY * dimZ);
    const [kSizeX, kSizeY, kSizeZ] = kernel.size;
    const halfX = Math.floor(kSizeX / 2);
    const halfY = Math.floor(kSizeY / 2);
    const halfZ = Math.floor(kSizeZ / 2);

    let idx = 0;
    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          let sum = 0;
          let weightSum = 0;

          // Apply kernel
          for (let kz = 0; kz < kSizeZ; kz++) {
            for (let ky = 0; ky < kSizeY; ky++) {
              for (let kx = 0; kx < kSizeX; kx++) {
                const ni = i + kx - halfX;
                const nj = j + ky - halfY;
                const nk = k + kz - halfZ;

                // Check bounds
                if (ni >= 0 && ni < dimX && nj >= 0 && nj < dimY && nk >= 0 && nk < dimZ) {
                  const weight = kernel.getWeight(kx, ky, kz);
                  sum += weight * this.volume.getAt(ni, nj, nk);
                  weightSum += weight;
                }
              }
            }
          }

          result[idx++] = weightSum > 0 ? sum / weightSum : this.volume.getAt(i, j, k);
        }
      }
    }

    return new FloatNeuroVol(this.volume.space, result);
  }

  /**
   * Apply median filter
   */
  medianFilter(radius: number): NeuroVol {
    const [dimX, dimY, dimZ] = this.volume.dim;
    const result = new Float32Array(dimX * dimY * dimZ);
    const windowSize = 2 * radius + 1;

    let idx = 0;
    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          const values: number[] = [];

          // Collect values in window
          for (let dk = -radius; dk <= radius; dk++) {
            for (let dj = -radius; dj <= radius; dj++) {
              for (let di = -radius; di <= radius; di++) {
                const ni = i + di;
                const nj = j + dj;
                const nk = k + dk;

                if (ni >= 0 && ni < dimX && nj >= 0 && nj < dimY && nk >= 0 && nk < dimZ) {
                  values.push(this.volume.getAt(ni, nj, nk));
                }
              }
            }
          }

          // Find median
          values.sort((a, b) => a - b);
          const mid = Math.floor(values.length / 2);
          result[idx++] = values.length % 2 !== 0 
            ? values[mid] 
            : (values[mid - 1] + values[mid]) / 2;
        }
      }
    }

    return new FloatNeuroVol(this.volume.space, result);
  }

  /**
   * Apply morphological erosion
   */
  erode(radius: number): NeuroVol {
    const kernel = Kernel3D.sphere(radius);
    return this.morphological(kernel, 'erode');
  }

  /**
   * Apply morphological dilation
   */
  dilate(radius: number): NeuroVol {
    const kernel = Kernel3D.sphere(radius);
    return this.morphological(kernel, 'dilate');
  }

  /**
   * Apply morphological opening
   */
  open(radius: number): NeuroVol {
    const eroded = this.erode(radius);
    return new SpatialFilter(eroded).dilate(radius);
  }

  /**
   * Apply morphological closing
   */
  close(radius: number): NeuroVol {
    const dilated = this.dilate(radius);
    return new SpatialFilter(dilated).erode(radius);
  }

  /**
   * Apply anisotropic diffusion filter
   */
  anisotropicDiffusion(iterations: number, kappa: number, lambda: number): NeuroVol {
    if (lambda < 0 || lambda > 0.25) {
      throw new Error('Lambda must be between 0 and 0.25');
    }

    const [dimX, dimY, dimZ] = this.volume.dim;
    let current = new Float32Array(dimX * dimY * dimZ);
    
    // Initialize with input data
    let idx = 0;
    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          current[idx++] = this.volume.getAt(i, j, k);
        }
      }
    }

    // Iterate diffusion
    for (let iter = 0; iter < iterations; iter++) {
      const next = new Float32Array(current);
      idx = 0;

      for (let k = 0; k < dimZ; k++) {
        for (let j = 0; j < dimY; j++) {
          for (let i = 0; i < dimX; i++) {
            const center = current[idx];
            
            // Calculate gradients in 6 directions
            const gradients = [
              i > 0 ? current[idx - 1] - center : 0,
              i < dimX - 1 ? current[idx + 1] - center : 0,
              j > 0 ? current[idx - dimX] - center : 0,
              j < dimY - 1 ? current[idx + dimX] - center : 0,
              k > 0 ? current[idx - dimX * dimY] - center : 0,
              k < dimZ - 1 ? current[idx + dimX * dimY] - center : 0
            ];

            // Calculate conduction coefficients
            const conductions = gradients.map(g => {
              const absG = Math.abs(g);
              return Math.exp(-(absG / kappa) * (absG / kappa));
            });

            // Update value
            let update = 0;
            for (let d = 0; d < 6; d++) {
              update += conductions[d] * gradients[d];
            }
            
            next[idx] = center + lambda * update;
            idx++;
          }
        }
      }

      current = next;
    }

    return new FloatNeuroVol(this.volume.space, current);
  }

  /**
   * Apply edge detection filter
   */
  edgeDetection(method: 'sobel' | 'laplacian' | 'canny'): NeuroVol {
    switch (method) {
      case 'sobel':
        return this.sobelEdgeDetection();
      case 'laplacian':
        return this.spatialFilter(Kernel3D.laplacian());
      case 'canny':
        // Canny edge detection is complex, using Sobel as approximation
        console.warn('Canny edge detection not fully implemented, using Sobel');
        return this.sobelEdgeDetection();
      default:
        throw new Error(`Unknown edge detection method: ${method}`);
    }
  }

  // Private helper methods

  private morphological(kernel: Kernel3D, operation: 'erode' | 'dilate'): NeuroVol {
    const [dimX, dimY, dimZ] = this.volume.dim;
    const result = new Float32Array(dimX * dimY * dimZ);
    const [kSizeX, kSizeY, kSizeZ] = kernel.size;
    const halfX = Math.floor(kSizeX / 2);
    const halfY = Math.floor(kSizeY / 2);
    const halfZ = Math.floor(kSizeZ / 2);

    let idx = 0;
    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          let value = operation === 'erode' ? Number.MAX_VALUE : Number.MIN_VALUE;

          // Apply kernel
          for (let kz = 0; kz < kSizeZ; kz++) {
            for (let ky = 0; ky < kSizeY; ky++) {
              for (let kx = 0; kx < kSizeX; kx++) {
                if (kernel.getWeight(kx, ky, kz) > 0) {
                  const ni = i + kx - halfX;
                  const nj = j + ky - halfY;
                  const nk = k + kz - halfZ;

                  if (ni >= 0 && ni < dimX && nj >= 0 && nj < dimY && nk >= 0 && nk < dimZ) {
                    const neighborValue = this.volume.getAt(ni, nj, nk);
                    if (operation === 'erode') {
                      value = Math.min(value, neighborValue);
                    } else {
                      value = Math.max(value, neighborValue);
                    }
                  }
                }
              }
            }
          }

          result[idx++] = value;
        }
      }
    }

    return new FloatNeuroVol(this.volume.space, result);
  }

  private sobelEdgeDetection(): NeuroVol {
    // Apply Sobel filters in all three directions
    const sobelX = new SpatialFilter(this.volume).spatialFilter(Kernel3D.sobel('x'));
    const sobelY = new SpatialFilter(this.volume).spatialFilter(Kernel3D.sobel('y'));
    const sobelZ = new SpatialFilter(this.volume).spatialFilter(Kernel3D.sobel('z'));

    const [dimX, dimY, dimZ] = this.volume.dim;
    const result = new Float32Array(dimX * dimY * dimZ);

    // Combine gradients using magnitude
    let idx = 0;
    for (let k = 0; k < dimZ; k++) {
      for (let j = 0; j < dimY; j++) {
        for (let i = 0; i < dimX; i++) {
          const gx = (sobelX as FloatNeuroVol).getData()[idx];
          const gy = (sobelY as FloatNeuroVol).getData()[idx];
          const gz = (sobelZ as FloatNeuroVol).getData()[idx];
          
          result[idx] = Math.sqrt(gx * gx + gy * gy + gz * gz);
          idx++;
        }
      }
    }

    return new FloatNeuroVol(this.volume.space, result);
  }
}

/**
 * Add spatial filtering methods to NeuroVol
 */
export function addSpatialFilteringToNeuroVol() {
  // Add methods to NeuroVol prototype
  const proto = Object.getPrototypeOf(FloatNeuroVol.prototype);
  
  proto.gaussianBlur = function(this: NeuroVol, sigma: number | [number, number, number]) {
    return new SpatialFilter(this).gaussianBlur(sigma);
  };

  proto.bilateralFilter = function(this: NeuroVol, options: BilateralFilterOptions) {
    return new SpatialFilter(this).bilateralFilter(options);
  };

  proto.medianFilter = function(this: NeuroVol, radius: number) {
    return new SpatialFilter(this).medianFilter(radius);
  };

  proto.erode = function(this: NeuroVol, radius: number) {
    return new SpatialFilter(this).erode(radius);
  };

  proto.dilate = function(this: NeuroVol, radius: number) {
    return new SpatialFilter(this).dilate(radius);
  };
}