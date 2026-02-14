/**
 * Interface for the slice controller component that handles user interaction
 */
export interface ISliceController {
  /**
   * Current mouse position in image coordinates
   */
  readonly mouseImagePosition: { x: number; y: number } | null;

  /**
   * Current mouse position in volume coordinates
   */
  readonly mouseVolumeCoordinate: number[] | null;

  /**
   * Current mouse position in world coordinates
   */
  readonly mouseWorldCoordinate: number[] | null;

  /**
   * Enable or disable the controller
   */
  setEnabled(enabled: boolean): void;

  /**
   * Check if the controller is enabled
   */
  isEnabled(): boolean;

  /**
   * Dispose of the controller and clean up event listeners
   */
  dispose(): void;
}