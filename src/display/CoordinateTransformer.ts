/**
 * File: src/display/CoordinateTransformer.ts
 *
 * The CoordinateTransformer class provides convenience methods to
 * convert between various coordinate systems involved in slice-based
 * rendering:
 *
 *  1. Screen Coordinates (mouse pointer in the browser window).
 *  2. Local 2D slice Coordinates (the 2D space of the slice within a
 *     PIXI container, typically measured in pixel units).
 *  3. 3D Volume Coordinates (voxel space or continuous i,j,k grid).
 *
 * Internally, it delegates the core math to a SliceTransform instance,
 * which handles reorientation and the "pinning" of k = sliceIndex.
 */

import * as PIXI from 'pixi.js';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { SliceTransform } from './SliceTransform';
import { ICoordinateTransformer } from './interfaces';
import { CoordinateValidator, ValidationOptions } from './CoordinateValidation';

/**
 * CoordinateTransformer wraps a SliceTransform and adds convenience methods
 * for screen-based picking. Typically, you pass in a parent PIXI.Container
 * that might be scaled, flipped, or panned, and the code uses `toLocal()`
 * to find local slice coordinates, which are then converted to or from
 * volume coordinates.
 * 
 * Coordinate System Chain:
 * Screen (pixels) → Container Local (pixels) → Slice (mm) → Volume (voxels) → World (mm)
 * 
 * World Space Convention: NIFTI LPI (Left-Posterior-Inferior)
 * - X-axis: Left (-) to Right (+)
 * - Y-axis: Posterior (-) to Anterior (+)
 * - Z-axis: Inferior (-) to Superior (+)
 */
export class CoordinateTransformer implements ICoordinateTransformer {
  private sliceTransform: SliceTransform;
  private currentSliceIndex: number;

  /**
   * Constructs a CoordinateTransformer.
   * @param neuroSpace - The NeuroSpace describing the 3D volume.
   * @param viewAxes - The AxisSet3D specifying how to orient the slice
   *                   (e.g., AXIAL_LPI or SAGITTAL_AIL, etc.).
   * @param initialSliceIndex - The slice index along the pinned axis.
   *                            Defaults to 0.
   */
  constructor(neuroSpace: NeuroSpace, viewAxes: AxisSet3D, initialSliceIndex: number = 0) {
    this.currentSliceIndex = initialSliceIndex;
    this.sliceTransform = new SliceTransform(neuroSpace, viewAxes, initialSliceIndex);
  }

  /**
   * Updates the pinned slice index (k dimension) in the transform.
   * @param sliceIndex - The new slice index to display or pick against.
   */
  public setSliceIndex(sliceIndex: number): void {
    this.currentSliceIndex = sliceIndex;
    this.sliceTransform.updateSliceIndex(sliceIndex);
  }

  /**
   * Converts a screen position (e.g., mouse pointer in stage coordinates)
   * to local slice coordinates. This uses PIXI's `toLocal()`, letting any
   * translation or scaling in the container be accounted for automatically.
   *
   * Typically, the container might be scaled negatively in Y to flip the
   * slice upright, so local Y might be reversed from raw image data.
   *
   * @param screenX - The screen X coordinate (in global / stage space).
   * @param screenY - The screen Y coordinate (in global / stage space).
   * @param mainContainer - The container in which the slice is rendered.
   * @returns An object `{ x, y }` in local slice coordinates.
   */
  public screenToImageCoord(
    screenX: number,
    screenY: number,
    mainContainer: PIXI.Container
  ): { x: number; y: number } {
    const globalPoint = new PIXI.Point(screenX, screenY);
    const localPoint = mainContainer.toLocal(globalPoint);
    return { x: localPoint.x, y: localPoint.y };
  }

  /**
   * Converts a screen position to scaled image coordinates in millimeters.
   * This first converts screen coordinates to local image coordinates (in pixels),
   * then scales them by the pixel spacing to get coordinates in physical units (mm).
   *
   * NOTE: Local image coordinates returned by PIXI are in pixels. Most of the
   * math in SliceTransform expects slice coordinates in mm. Use this helper
   * whenever you need mm-space from a screen position.
   *
   * @param screenX - The screen X coordinate (in global / stage space).
   * @param screenY - The screen Y coordinate (in global / stage space).
   * @param mainContainer - The container in which the slice is rendered.
   * @returns An object `{ x, y }` in millimeters, scaled by pixel spacing.
   */
  public screenToScaledImageCoord(
    screenX: number,
    screenY: number,
    mainContainer: PIXI.Container
  ): { x: number; y: number } {
    // First get image coordinates in pixels
    const imageCoord = this.screenToImageCoord(screenX, screenY, mainContainer);
    
    // Get pixel spacing (mm per pixel) from SliceTransform
    const [xSpacing, ySpacing] = this.sliceTransform.pixelSpacing;
    
    // Scale the coordinates by pixel spacing to get mm
    return {
      x: imageCoord.x * xSpacing,
      y: imageCoord.y * ySpacing
    };
  }

  /**
   * An all-in-one helper to go from screen coordinates directly to 3D volume
   * coordinates. This calls `toLocal()` (screen -> pixels), then converts pixels
   * to mm using slice pixel spacing, and finally uses SliceTransform to map to
   * voxel coordinates.
   *
   * @param screenX - The screen X coordinate (mouse in stage space).
   * @param screenY - The screen Y coordinate.
   * @param mainContainer - The parent container to interpret local coords.
   * @returns A 3-element array `[i, j, k]` in volume/voxel space,
   *          typically floating if partial-voxel.
   */
  public screenToVolumeCoord(
    screenX: number,
    screenY: number,
    mainContainer: PIXI.Container
  ): number[] | null {
    // Step 1: Screen → local image coords (pixels)
    const imagePt = mainContainer.toLocal(new PIXI.Point(screenX, screenY));
    // Step 2: Pixels → volume via SliceTransform helper
    return this.sliceTransform.imageToVolumeCoord({ x: imagePt.x, y: imagePt.y });
  }

  /**
   * Converts 2D local image coordinates (pixels) to volume coordinates.
   * This uses SliceTransform.imageToVolumeCoord, which applies pixel spacing
   * to obtain mm before solving for voxel coordinates with pinned k.
   *
   * @param imagePt - The local image coordinate `{ x, y }` in pixels.
   * @returns A 3-element array `[i, j, k]` in the volume space.
   */
  public sliceToVolumeCoord(imagePt: { x: number; y: number }): number[] {
    return this.sliceTransform.imageToVolumeCoord(imagePt);
  }

  /**
   * Converts 2D local image coordinates (pixels) to original world coordinates (mm)
   * in the un-pinned NeuroSpace.
   *
   * @param imagePt - The local image coordinate `{ x, y }` in pixels.
   * @returns A 3-element array `[x, y, z]` in world mm.
   */
  public sliceToWorldCoord(imagePt: { x: number; y: number }): number[] {
    return this.sliceTransform.imageToWorldCoord(imagePt);
  }

  /**
   * The inverse of sliceToVolumeCoord. Given `[i, j, k]` in volume space, returns
   * the local slice coordinate `[x, y]`.
   *
   * Use this, for example, to place a crosshair or highlight a particular volume
   * coordinate on the 2D slice.
   *
   * @param volCoord - A 3-element array `[i, j, k]` in volume space.
   * @returns The local 2D coordinate `{ x, y }`, which can be used to position
   *          PIXI display objects within the container.
   */
  public volumeToLocalSliceCoord(volCoord: number[]): { x: number; y: number } {
    // Convert 3D voxel -> slice mm, then mm -> pixels using spacing
    const imagePt = this.sliceTransform.volumeToImageCoord(volCoord);
    return { x: imagePt.x, y: imagePt.y };
  }

  /**
   * Safe version of screenToVolumeCoord that validates coordinates
   * @param screenX - The screen X coordinate
   * @param screenY - The screen Y coordinate
   * @param mainContainer - The parent container
   * @param options - Validation options
   * @returns A 3-element array or null if invalid
   */
  public screenToVolumeCoordSafe(
    screenX: number,
    screenY: number,
    mainContainer: PIXI.Container,
    options: ValidationOptions = {}
  ): number[] | null {
    // Check for NaN or Infinity in screen coordinates
    if (!isFinite(screenX) || !isFinite(screenY)) {
      return null;
    }

    // Step 1: Screen → local "slice" coords
    const imagePt = mainContainer.toLocal(new PIXI.Point(screenX, screenY));
    // Convert pixels → mm, then validate and map to volume
    return this.sliceTransform.sliceToVolumeCoordSafe(
      {
        x: imagePt.x * this.sliceTransform.pixelSpacing[0],
        y: imagePt.y * this.sliceTransform.pixelSpacing[1]
      },
      options
    );
  }

  /**
   * Safe version of sliceToVolumeCoord with validation
   * @param slicePt - The local slice coordinate
   * @param options - Validation options
   * @returns A 3-element array or null if invalid
   */
  public sliceToVolumeCoordSafe(
    imagePt: { x: number; y: number },
    options: ValidationOptions = {}
  ): number[] | null {
    // Pixels → mm then validate via SliceTransform
    return this.sliceTransform.sliceToVolumeCoordSafe(
      {
        x: imagePt.x * this.sliceTransform.pixelSpacing[0],
        y: imagePt.y * this.sliceTransform.pixelSpacing[1]
      },
      options
    );
  }

  /**
   * Safe version of volumeToLocalSliceCoord with validation
   * @param volCoord - The volume coordinate
   * @param options - Validation options
   * @returns The local 2D coordinate or null if invalid
   */
  public volumeToLocalSliceCoordSafe(
    volCoord: number[],
    options: ValidationOptions = {}
  ): { x: number; y: number } | null {
    const slicePt = this.sliceTransform.volumeToSliceCoordSafe(volCoord, options);
    if (!slicePt) return null;
    const [sx, sy] = this.sliceTransform.pixelSpacing;
    return { x: slicePt.x / sx, y: slicePt.y / sy };
  }

  /**
   * Get the bounds for valid slice coordinates
   * @returns Bounds in millimeters
   */
  public getSliceBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    return this.sliceTransform.getSliceBounds();
  }

  /**
   * Check if current slice index is valid
   * @returns true if valid
   */
  public isSliceIndexValid(): boolean {
    return this.sliceTransform.isSliceIndexValid();
  }

  /**
   * Validate and optionally clamp the slice index
   * @param sliceIndex - The slice index to validate
   * @param totalSlices - Total number of slices
   * @param options - Validation options
   * @returns Validated slice index or null
   */
  public validateSliceIndex(
    sliceIndex: number,
    totalSlices: number,
    options: ValidationOptions = {}
  ): number | null {
    const validation = CoordinateValidator.validateSliceIndex(sliceIndex, totalSlices, options);

    if (!validation.isValid && !options.clamp) {
      return null;
    }

    return Array.isArray(validation.clamped) ? (validation.clamped as number[])[0] : sliceIndex;
  }
}
