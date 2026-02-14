// src/display/SliceTransform.ts

import { AxisSet3D, oppositeAxis, NamedAxis } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { CoordinateValidator, ValidationOptions } from './CoordinateValidation';
import { safeDivide, MIN_SPACING } from './NumericalUtils';

/**
 * SliceTransform manages conversion between slice (2D) coordinates and
 * volume (3D) coordinates, given a pinned axis and slice index.
 * 
 * Coordinate Systems:
 * - Volume Space: 3D voxel indices [i, j, k]
 * - Slice Space: 2D coordinates [x, y] in millimeters within the slice plane
 * - World Space: 3D coordinates [x, y, z] in millimeters (LPI convention)
 * 
 * The LPI (Left-Posterior-Inferior) convention is used for world coordinates,
 * which is the NIFTI standard orientation.
 */
export class SliceTransform {
  private volumeSpace: NeuroSpace;
  private _viewAxes: AxisSet3D;
  private sliceIndex: number;
  
  // Cached values for performance
  private cachedPixelSpacing?: [number, number];
  private cachedAxisMapping?: {
    pinnedDim: number;
    planeDim0: number;
    planeDim1: number;
  };
  private cachedSliceBounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };

  /**
   * Constructs a SliceTransform.
   * 
   * @param volumeSpace  The original NeuroSpace (3D)
   * @param viewAxes     The orientation in which we are viewing (must be 3D axes)
   * @param sliceIndex   Which slice we are "pinned" at, in terms of the pinned axis dimension
   */
  constructor(volumeSpace: NeuroSpace, viewAxes: AxisSet3D, sliceIndex: number) {
    this.volumeSpace = volumeSpace;
    this._viewAxes = viewAxes;
    this.sliceIndex = sliceIndex;
  }

  /**
   * Helper method to compute the pixel spacing based on view axes and volume space.
   * Returns the mm per pixel spacing for the in-plane dimensions.
   * Results are cached for performance.
   * 
   * @returns [x_spacing, y_spacing] in mm per pixel
   */
  private getPixelSpacing(): [number, number] {
    if (!this.cachedPixelSpacing) {
      const planeAxis0 = this._viewAxes.i;
      const planeAxis1 = this._viewAxes.j;
      const planeDim0 = this.volumeSpace.whichDim(planeAxis0);
      const planeDim1 = this.volumeSpace.whichDim(planeAxis1);
      
      const spacing = this.volumeSpace.spacing;
      
      this.cachedPixelSpacing = [spacing[planeDim0], spacing[planeDim1]];
    }
    return this.cachedPixelSpacing;
  }

  /**
   * Public getter for pixel spacing (mm per pixel) for the in-plane dimensions.
   * 
   * @returns [x_spacing, y_spacing] in mm per pixel
   */
  public get pixelSpacing(): [number, number] {
    return this.getPixelSpacing();
  }

  /**
   * Get cached axis mapping for performance
   * @returns Object with pinnedDim, planeDim0, and planeDim1
   */
  private getAxisMapping(): { pinnedDim: number; planeDim0: number; planeDim1: number } {
    if (!this.cachedAxisMapping) {
      this.cachedAxisMapping = {
        pinnedDim: this.volumeSpace.whichDim(this._viewAxes.k),
        planeDim0: this.volumeSpace.whichDim(this._viewAxes.i),
        planeDim1: this.volumeSpace.whichDim(this._viewAxes.j)
      };
    }
    return this.cachedAxisMapping;
  }

  /**
   * volumeToSliceCoord: converts a 3D voxel coordinate in the volume to 2D (x,y) slice coordinates, in millimeters.
   * 
   * @param volCoord - The volume's 3D voxel coordinate [i, j, k].
   * @returns { x, y } in slice space, in millimeters.
   */
  public volumeToSliceCoord(volCoord: number[]): { x: number; y: number } {
    // Get cached axis mapping
    const { planeDim0, planeDim1 } = this.getAxisMapping();
    
    // Get the plane axes from cache
    const planeAxis0 = this._viewAxes.i;
    const planeAxis1 = this._viewAxes.j;

    // 3) Decide sign for each plane axis
    const volAxes = this.volumeSpace.axes.axes();
    const signForAxis = (target: NamedAxis, candidate: NamedAxis) => {
      if (candidate.equals(target)) return +1;
      if (candidate.equals(oppositeAxis(target))) return -1;
      throw new Error(
        `Logic error: ${candidate.name} not matching ${target.name} or opposite.`
      );
    };
    const volAxis0 = volAxes[planeDim0];
    const volAxis1 = volAxes[planeDim1];
    const s0 = signForAxis(planeAxis0, volAxis0);
    const s1 = signForAxis(planeAxis1, volAxis1);

    // 4) Convert [i, j, k] => slice (x, y) in mm
    const spacing = this.volumeSpace.spacing;
    const dims = this.volumeSpace.dim;

    let x_mm = 0;
    let y_mm = 0;

    if (s0 > 0) {
      x_mm = volCoord[planeDim0] * spacing[planeDim0];
    } else {
      x_mm = (dims[planeDim0] - 1 - volCoord[planeDim0]) * spacing[planeDim0];
    }

    if (s1 > 0) {
      y_mm = volCoord[planeDim1] * spacing[planeDim1];
    } else {
      y_mm = (dims[planeDim1] - 1 - volCoord[planeDim1]) * spacing[planeDim1];
    }

    return { x: x_mm, y: y_mm };
  }

  /**
   * sliceToVolumeCoord converts a 2D coordinate in the slice (in mm) back into the volume's 3D voxel coordinate.
   * 
   * @param slicePt - The { x, y } coordinate on the slice, in millimeters.
   * @returns A 3-element array [i, j, k] in the volume's voxel coordinate system.
   */
  public sliceToVolumeCoord(slicePt: { x: number; y: number }): number[] {
    // Get cached axis mapping
    const { pinnedDim, planeDim0, planeDim1 } = this.getAxisMapping();
    
    const planeAxis0 = this._viewAxes.i;
    const planeAxis1 = this._viewAxes.j;

    const volAxes = this.volumeSpace.axes.axes();
    const signForAxis = (target: NamedAxis, candidate: NamedAxis) => {
      if (candidate.equals(target)) return +1;
      if (candidate.equals(oppositeAxis(target))) return -1;
      throw new Error(`Logic error: ${candidate.name} not matching ${target.name} or opposite.`);
    };
    const volAxis0 = volAxes[planeDim0];
    const volAxis1 = volAxes[planeDim1];
    const s0 = signForAxis(planeAxis0, volAxis0);
    const s1 = signForAxis(planeAxis1, volAxis1);

    const newVoxelCoord = [0, 0, 0];
    const spacing = this.volumeSpace.spacing;
    const dims = this.volumeSpace.dim;

    newVoxelCoord[pinnedDim] = this.sliceIndex; // pinned axis

    // planeDim0 => x (using safe division)
    if (s0 > 0) {
      newVoxelCoord[planeDim0] = safeDivide(slicePt.x, spacing[planeDim0], 0);
    } else {
      newVoxelCoord[planeDim0] =
        (dims[planeDim0] - 1) - safeDivide(slicePt.x, spacing[planeDim0], 0);
    }

    // planeDim1 => y (using safe division)
    if (s1 > 0) {
      newVoxelCoord[planeDim1] = safeDivide(slicePt.y, spacing[planeDim1], 0);
    } else {
      newVoxelCoord[planeDim1] =
        (dims[planeDim1] - 1) - safeDivide(slicePt.y, spacing[planeDim1], 0);
    }

    return newVoxelCoord;
  }

  /**
   * sliceToWorldCoord converts 2D slice coordinates (in mm) to real-world coordinates (in mm).
   * @param slicePt - The { x, y } coordinate on the slice, in millimeters (the in-plane mm).
   * @returns A [X, Y, Z] array in real-world coordinates.
   */
  public sliceToWorldCoord(slicePt: { x: number; y: number }): number[] {
    // 1) slice => volume (voxel)
    const voxel = this.sliceToVolumeCoord(slicePt);
    // 2) voxel => world
    return this.volumeSpace.gridToCoord(voxel);
  }

  /**
   * worldToSliceCoord: if you want the reverse transform from 3D mm => slice XY
   * 
   * @param worldPt - A 3D point in real-world coordinates [X, Y, Z].
   * @returns { x, y } in slice space (in-plane mm).
   */
  public worldToSliceCoord(worldPt: number[]): { x: number; y: number } {
    // 1) world => volume (voxel)
    const voxelCoord = this.volumeSpace.coordToGrid(worldPt);
    // 2) volume => slice
    return this.volumeToSliceCoord(voxelCoord);
  }

  /**
   * imageToVolumeCoord converts a 2D image coordinate in pixels to a 3D voxel coordinate.
   * The pixel spacing is determined from the volume space.
   * 
   * @param imagePt - The { x, y } coordinate in the image (in pixels).
   * @returns A 3-element array [i, j, k] in the volume's voxel coordinate system.
   */
  public imageToVolumeCoord(imagePt: { x: number; y: number }): number[] {
    // Get pixel spacing from volume
    const [xSpacing, ySpacing] = this.getPixelSpacing();
    
    // Convert image pixel coordinates to slice mm coordinates
    const slicePt = {
      x: imagePt.x * xSpacing,
      y: imagePt.y * ySpacing
    };
    
    // Use existing slice to volume conversion
    return this.sliceToVolumeCoord(slicePt);
  }

  /**
   * imageToWorldCoord converts a 2D image coordinate in pixels to a 3D world coordinate in mm.
   * The pixel spacing is determined from the volume space.
   * 
   * @param imagePt - The { x, y } coordinate in the image (in pixels).
   * @returns A 3-element array [X, Y, Z] in real-world coordinates (mm).
   */
  public imageToWorldCoord(imagePt: { x: number; y: number }): number[] {
    // Get pixel spacing from volume
    const [xSpacing, ySpacing] = this.getPixelSpacing();
    
    // Convert image pixel coordinates to slice mm coordinates
    const slicePt = {
      x: imagePt.x * xSpacing,
      y: imagePt.y * ySpacing
    };
    
    // Use existing slice to world conversion
    return this.sliceToWorldCoord(slicePt);
  }

  /**
   * volumeToImageCoord converts a 3D voxel coordinate to a 2D image coordinate in pixels.
   * The pixel spacing is determined from the volume space.
   * 
   * @param volCoord - The volume's 3D voxel coordinate [i, j, k].
   * @returns { x, y } in image space (in pixels).
   */
  public volumeToImageCoord(volCoord: number[]): { x: number; y: number } {
    // First convert to slice mm coordinates
    const slicePt = this.volumeToSliceCoord(volCoord);
    
    // Get pixel spacing from volume
    const [xSpacing, ySpacing] = this.getPixelSpacing();
    
    // Then convert from mm to pixels (using safe division)
    return {
      x: safeDivide(slicePt.x, xSpacing, 0),
      y: safeDivide(slicePt.y, ySpacing, 0)
    };
  }

  /**
   * worldToImageCoord converts a 3D world coordinate in mm to a 2D image coordinate in pixels.
   * The pixel spacing is determined from the volume space.
   * 
   * @param worldPt - A 3D point in real-world coordinates [X, Y, Z].
   * @returns { x, y } in image space (in pixels).
   */
  public worldToImageCoord(worldPt: number[]): { x: number; y: number } {
    // First convert to slice mm coordinates
    const slicePt = this.worldToSliceCoord(worldPt);
    
    // Get pixel spacing from volume
    const [xSpacing, ySpacing] = this.getPixelSpacing();
    
    // Then convert from mm to pixels (using safe division)
    return {
      x: safeDivide(slicePt.x, xSpacing, 0),
      y: safeDivide(slicePt.y, ySpacing, 0)
    };
  }

  /**
   * Provides access to the 3D view axes (i, j, k).
   */
  public get viewAxes(): AxisSet3D {
    return this._viewAxes;
  }

  public updateSliceIndex(newSliceIndex: number): void {
    this.sliceIndex = newSliceIndex;
    // Note: Cached values remain valid as they don't depend on slice index
    // Only the slice index itself changes, not the axis mapping or bounds
  }

  /**
   * Safe version of volumeToSliceCoord that validates input coordinates
   * @param volCoord - The volume's 3D voxel coordinate [i, j, k]
   * @param options - Validation options
   * @returns { x, y } in slice space, or null if invalid
   */
  public volumeToSliceCoordSafe(
    volCoord: number[],
    options: ValidationOptions = {}
  ): { x: number; y: number } | null {
    const validation = CoordinateValidator.validateVoxelCoord(
      volCoord,
      this.volumeSpace.dim,
      options
    );

    if (!validation.isValid && !options.clamp) {
      return null;
    }

    const coordToUse = (validation.clamped as number[] | undefined) || volCoord;
    return this.volumeToSliceCoord(coordToUse);
  }

  /**
   * Safe version of sliceToVolumeCoord that validates input and output
   * @param slicePt - The { x, y } coordinate on the slice, in millimeters
   * @param options - Validation options
   * @returns A 3-element array [i, j, k] or null if invalid
   */
  public sliceToVolumeCoordSafe(
    slicePt: { x: number; y: number },
    options: ValidationOptions = {}
  ): number[] | null {
    // Get the in-plane dimensions for this slice
    const pinnedAxis = this._viewAxes.k;
    const pinnedDim = this.volumeSpace.whichDim(pinnedAxis);
    const planeAxis0 = this._viewAxes.i;
    const planeAxis1 = this._viewAxes.j;
    const planeDim0 = this.volumeSpace.whichDim(planeAxis0);
    const planeDim1 = this.volumeSpace.whichDim(planeAxis1);
    
    const sliceDimensions: [number, number] = [
      this.volumeSpace.dim[planeDim0],
      this.volumeSpace.dim[planeDim1]
    ];

    // Validate slice coordinates
    const sliceValidation = CoordinateValidator.validateSliceCoord(
      slicePt,
      sliceDimensions,
      this.pixelSpacing,
      options
    );

    if (!sliceValidation.isValid && !options.clamp) {
      return null;
    }

    const sliceToUse = (sliceValidation.clamped as { x: number; y: number } | undefined) || slicePt;

    const volCoord = this.sliceToVolumeCoord(sliceToUse);

    // Validate the resulting volume coordinates
    const volValidation = CoordinateValidator.validateVoxelCoord(
      volCoord,
      this.volumeSpace.dim,
      { clamp: true } // Always clamp output to be safe
    );

    return (volValidation.clamped as number[] | undefined) || volCoord;
  }

  /**
   * Get the valid bounds for slice coordinates in mm
   * Results are cached for performance.
   * @returns { minX, maxX, minY, maxY } in millimeters
   */
  public getSliceBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    if (!this.cachedSliceBounds) {
      const { planeDim0, planeDim1 } = this.getAxisMapping();
      const spacing = this.volumeSpace.spacing;
      const dims = this.volumeSpace.dim;

      this.cachedSliceBounds = {
        minX: 0,
        maxX: (dims[planeDim0] - 1) * spacing[planeDim0],
        minY: 0,
        maxY: (dims[planeDim1] - 1) * spacing[planeDim1]
      };
    }
    return this.cachedSliceBounds;
  }

  /**
   * Validates that the current slice index is within bounds
   * @returns true if slice index is valid
   */
  public isSliceIndexValid(): boolean {
    const pinnedAxis = this._viewAxes.k;
    const pinnedDim = this.volumeSpace.whichDim(pinnedAxis);
    const maxSlices = this.volumeSpace.dim[pinnedDim];
    
    return this.sliceIndex >= 0 && this.sliceIndex < maxSlices;
  }
}
