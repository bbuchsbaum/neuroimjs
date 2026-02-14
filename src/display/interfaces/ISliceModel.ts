import { IReactionDisposer } from 'mobx';
/**
 * Interface for the slice model component that manages slice state and coordinates
 */
export interface ISliceModel {
  /**
   * Current coordinate in the volume space
   */
  readonly currentCoord: number[];

  /**
   * Current slice index
   */
  readonly currentSliceIndex: number;

  /**
   * Total number of slices available
   */
  readonly totalSlices: number;

  /**
   * Sets the current coordinate in volume space
   */
  setCurrentCoord(coord: number[]): void;

  /**
   * Sets the current slice index
   */
  setCurrentSliceIndex(index: number): void;

  /**
   * Navigate to the previous slice
   */
  previousSlice(): void;

  /**
   * Navigate to the next slice
   */
  nextSlice(): void;

  /**
   * Subscribe to coordinate changes
   * @param callback Function called when coordinates change
   * @returns Disposal function to unsubscribe
   */
  onCoordChange(callback: (coord: number[]) => void): IReactionDisposer;

  /**
   * Subscribe to slice index changes
   * @param callback Function called when slice index changes
   * @returns Disposal function to unsubscribe
   */
  onSliceIndexChange(callback: (index: number) => void): IReactionDisposer;

  /**
   * Dispose of the model and clean up resources
   */
  dispose(): void;
}
