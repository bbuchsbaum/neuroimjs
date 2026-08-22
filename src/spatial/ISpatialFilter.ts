/**
 * Interface for spatial filtering operations on 3D neuroimaging data
 */

import { NeuroVol } from '../volume/NeuroVol';

/**
 * Kernel for 3D convolution operations
 */
export interface Kernel3DLike {
  data: number[][][];
  size: [number, number, number];
  normalize(): Kernel3DLike;
  getWeight(i: number, j: number, k: number): number;
}

/**
 * Options for bilateral filtering
 */
export interface BilateralFilterOptions {
  spatialSigma: number;
  intensitySigma: number;
  windowSize?: number;
}

/**
 * Options for guided filtering
 */
export interface GuidedFilterOptions {
  radius: number;
  epsilon: number;
  guide?: NeuroVol;
}

/**
 * Morphological operation types
 */
export type MorphOperation = 'erode' | 'dilate' | 'open' | 'close';

/**
 * Interface for spatial filtering operations
 */
export interface ISpatialFilter {
  /**
   * Apply Gaussian blur with specified sigma
   * @param sigma Standard deviation for Gaussian kernel (can be scalar or [x,y,z])
   */
  gaussianBlur(sigma: number | [number, number, number]): NeuroVol;

  /**
   * Apply bilateral filter for edge-preserving smoothing
   * @param options Bilateral filter parameters
   */
  bilateralFilter(options: BilateralFilterOptions): NeuroVol;

  /**
   * Apply guided filter for edge-preserving smoothing
   * @param options Guided filter parameters
   */
  guidedFilter(options: GuidedFilterOptions): NeuroVol;

  /**
   * Apply a custom 3D kernel
   * @param kernel The 3D convolution kernel
   */
  spatialFilter(kernel: Kernel3DLike): NeuroVol;

  /**
   * Apply median filter
   * @param radius Radius of the filter window
   */
  medianFilter(radius: number): NeuroVol;

  /**
   * Apply morphological erosion
   * @param radius Radius of the structuring element
   */
  erode(radius: number): NeuroVol;

  /**
   * Apply morphological dilation
   * @param radius Radius of the structuring element
   */
  dilate(radius: number): NeuroVol;

  /**
   * Apply morphological opening (erosion followed by dilation)
   * @param radius Radius of the structuring element
   */
  open(radius: number): NeuroVol;

  /**
   * Apply morphological closing (dilation followed by erosion)
   * @param radius Radius of the structuring element
   */
  close(radius: number): NeuroVol;

  /**
   * Apply anisotropic diffusion filter
   * @param iterations Number of iterations
   * @param kappa Gradient modulus threshold
   * @param lambda Integration constant (0-0.25)
   */
  anisotropicDiffusion(iterations: number, kappa: number, lambda: number): NeuroVol;

  /**
   * Apply edge detection filter
   * @param method Edge detection method ('sobel', 'laplacian', 'canny')
   */
  edgeDetection(method: 'sobel' | 'laplacian' | 'canny'): NeuroVol;
}
