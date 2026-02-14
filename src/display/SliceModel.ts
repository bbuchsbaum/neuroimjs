/**
 * File: src/display/SliceModel.ts
 *
 * The SliceModel class keeps track of the user’s current 3D coordinate in
 * real-world (millimeter) space, especially regarding the pinned (movement) axis.
 * It calculates which integer slice index corresponds to that 3D coordinate
 * and allows us to increment or decrement slices. In a typical orthogonal viewer
 * setup, this class drives which slice plane is currently displayed.
 */

import { makeObservable, observable, action, computed, reaction, IReactionDisposer } from 'mobx';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D } from '../geometry/Axis';
import { ISliceModel } from './interfaces/ISliceModel';
import { CoordinateValidator } from './CoordinateValidation';
import { arraysNearlyEqual, COORDINATE_EPSILON } from './NumericalUtils';

/**
 * SliceModel represents the state of a single 2D slice within a 3D volume.
 * It tracks:
 *  - `currentCoord`: The user’s current 3D coordinate **in real-world mm** (per NeuroSpace).
 *  - `currentSliceIndex`: Computed by projecting `currentCoord` onto the pinned dimension.
 *  - Methods to move to the next or previous slice.
 *
 * IMPORTANT:
 *  - `currentCoord` must be a **millimeter-space coordinate** if `NeuroSpace` is
 *    configured for real-world mm. If you have voxel coords [i,j,k], do:
 *       const mmCoord = neuroSpace.gridToCoord(voxelCoord);
 *       sliceModel.setCurrentCoord(mmCoord);
 *    Otherwise `currentSliceIndex` will be incorrect.
 */
export class SliceModel implements ISliceModel {
  /**
   * The current 3D coordinate [X, Y, Z], stored in real-world mm space
   * (consistent with the NeuroSpace transform).
   */
  @observable public currentCoord: number[] = [];

  /**
   * totalSlices is the maximum number of discrete slices along the pinned axis.
   * For example, in a 256×256×128 volume, if the pinned axis is dimension #2,
   * totalSlices might be 128.
   */
  public totalSlices: number;

  private neuroSpace: NeuroSpace;      // The volume’s NeuroSpace (dimensions, spacing, transform, etc.)
  private movementAxisIndex: number;   // The dimension index (0,1,2) that is pinned for `currentSliceIndex`.
  private viewAxes: AxisSet3D;         // Which orientation (AXIAL, CORONAL, SAGITTAL, etc.) we are using.

  /**
   * Constructs a new SliceModel.
   *
   * @param totalSlices  - The number of slices along the movement axis.
   * @param initialCoord - The initial **real-world mm** 3D coordinate in the volume.
   * @param neuroSpace   - The NeuroSpace describing dimension, spacing, transform, etc.
   * @param viewAxes     - Which orientation axes we are using (e.g. AXIAL_LPI), from which we derive the pinned dimension.
   */
  constructor(
    totalSlices: number,
    initialCoord: number[],
    neuroSpace: NeuroSpace,
    viewAxes: AxisSet3D
  ) {
    this.totalSlices = totalSlices;
    this.currentCoord = initialCoord.slice();
    this.neuroSpace = neuroSpace;

    // Identify which dimension in the volume corresponds to viewAxes.k
    // (the "movement" or "slice" dimension).
    this.movementAxisIndex = neuroSpace.whichDim(viewAxes.k);
    this.viewAxes = viewAxes;

    makeObservable(this);
  }

  /**
   * currentSliceIndex is derived by mapping the **real-world** `currentCoord`
   * into voxel/grid space, then extracting the pinned dimension’s coordinate
   * and rounding it.
   */
  @computed
  get currentSliceIndex(): number {
    // 1) Convert mm => grid coords
    const gridCoord = this.neuroSpace.coordToGrid(this.currentCoord);
    // 2) The pinned dimension is movementAxisIndex
    // 3) Round to get the integer slice index
    return Math.round(gridCoord[this.movementAxisIndex]);
  }

  /**
   * Sets the model’s 3D coordinate to a new mm coordinate,
   * ensuring MobX reactivity by copying the array.
   *
   * @param coord - The new [X, Y, Z] in real-world mm.
   */
  @action.bound
  setCurrentCoord(coord: number[]): void {
    // Validate world coordinates
    const validation = CoordinateValidator.validateWorldCoord(
      coord,
      this.neuroSpace,
      { clamp: true } // Always clamp to valid range
    );

    if (validation.isValid) {
      const clamped = validation.clamped;
      const voxelCoord = (Array.isArray(clamped)
        ? clamped
        : this.neuroSpace.coordToGrid(coord)) as number[];
      const validWorldCoord = this.neuroSpace.gridToCoord(voxelCoord);
      this.currentCoord = validWorldCoord.slice();
    } else {
      // If completely invalid, keep current coordinate
      // Silently ignore invalid coordinates
    }
  }

  /**
   * Helper to set the coordinate only if it differs from the existing coordinate.
   * @param coord - The new [X, Y, Z] in real-world mm.
   */
  @action.bound
  setCurrentCoordIfChanged(coord: number[]): void {
    if (!this.coordinatesAreEqual(this.currentCoord, coord)) {
      this.currentCoord = coord.slice();
    } else {
    }
  }

  /**
   * Internal check if two coordinates are approximately equal within epsilon tolerance.
   * Uses epsilon comparison to handle floating-point precision issues.
   */
  private coordinatesAreEqual(coord1: number[], coord2: number[]): boolean {
    return arraysNearlyEqual(coord1, coord2, COORDINATE_EPSILON);
  }

  /**
   * Sets the sliceIndex by updating the relevant dimension in voxel space,
   * then converting back to mm (real-world) space for the model’s currentCoord.
   *
   * @param index - The new slice index (integer).
   */
  @action.bound
  setCurrentSliceIndex(index: number): void {
    // Validate slice index
    const validation = CoordinateValidator.validateSliceIndex(
      index,
      this.totalSlices,
      { clamp: true } // Always clamp to valid range
    );

    const clamped = validation.clamped;
    const validIndex = Array.isArray(clamped) ? clamped[0] : index;

    // 1) Convert the existing mm coord => voxel grid
    const gridCoord = this.neuroSpace.coordToGrid(this.currentCoord);

    // 2) Update the pinned dimension in voxel space
    gridCoord[this.movementAxisIndex] = validIndex;

    // 3) Convert back to mm
    const newCoord = this.neuroSpace.gridToCoord(gridCoord);

    // 4) Store as our new real-world mm coordinate
    this.setCurrentCoord(newCoord);
  }

  /**
   * Move to the previous slice, ensuring we don’t go below 0.
   */
  @action.bound
  previousSlice(): void {
    const newIndex = Math.max(0, this.currentSliceIndex - 1);
    this.setCurrentSliceIndex(newIndex);
  }

  /**
   * Move to the next slice, ensuring we don’t exceed totalSlices - 1.
   */
  @action.bound
  nextSlice(): void {
    const newIndex = Math.min(this.totalSlices - 1, this.currentSliceIndex + 1);
    this.setCurrentSliceIndex(newIndex);
  }

  /**
   * Returns the AxisSet3D used by this model, e.g. AXIAL_LPI or CORONAL_LIP, etc.
   */
  public getViewAxes(): AxisSet3D {
    return this.viewAxes;
  }

  /**
   * Subscribe to coordinate changes
   * @param callback Function to call when coordinate changes
   * @returns Dispose function to unsubscribe
   */
  public onCoordChange(callback: (coord: number[]) => void): IReactionDisposer {
    return reaction(
      () => this.currentCoord.slice(),
      (coord) => callback(coord)
    );
  }

  /**
   * Subscribe to slice index changes
   * @param callback Function to call when slice index changes
   * @returns Dispose function to unsubscribe
   */
  public onSliceIndexChange(callback: (index: number) => void): IReactionDisposer {
    return reaction(
      () => this.currentSliceIndex,
      (index) => callback(index)
    );
  }

  /**
   * Dispose of the model and clean up resources
   */
  public dispose(): void {
    // SliceModel doesn't have any resources to clean up
    // since it doesn't create any reactions or event listeners internally.
    // The reactions are created and managed by consumers of this model.
  }
}
