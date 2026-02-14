/**
 * Interface for coordinate transformation between different coordinate systems
 */
export interface ICoordinateTransformer {
  /**
   * Transform screen coordinates to image coordinates
   * @param x Screen x coordinate
   * @param y Screen y coordinate
   * @param container The container element
   * @returns Image coordinates
   */
  screenToImageCoord(x: number, y: number, container: any): { x: number; y: number };

  /**
   * Transform slice/image coordinates to volume coordinates
   * @param imageCoord Image coordinates
   * @returns Volume coordinates [x, y, z]
   */
  sliceToVolumeCoord(imageCoord: { x: number; y: number }): number[];

  /**
   * Transform slice/image coordinates to world coordinates
   * @param imageCoord Image coordinates
   * @returns World coordinates [x, y, z]
   */
  sliceToWorldCoord(imageCoord: { x: number; y: number }): number[];

  /**
   * Set the current slice index for coordinate transformations
   * @param index The slice index
   */
  setSliceIndex(index: number): void;

  /**
   * Dispose of any resources
   */
  dispose?(): void;
}