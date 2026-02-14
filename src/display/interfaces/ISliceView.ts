import { ICoordinateTransformer } from './ICoordinateTransformer';
import type { SliceLayer } from '../SliceLayer';
import { PointerEventHandler } from '../types/display';

/**
 * Interface for the slice view component that handles rendering and display
 */
export interface ISliceView {
  /**
   * Update the position/coordinate being displayed
   */
  updatePosition(coord: number[]): void;

  /**
   * Render the current slice
   */
  renderSlice(): void;

  /**
   * Handle window/container resize events
   */
  handleResize(): void;

  /**
   * Get the coordinate transformer for this view
   */
  getCoordinateTransformer(): ICoordinateTransformer;

  /**
   * Get the canvas element
   */
  getCanvas(): HTMLCanvasElement;

  /**
   * Add a pointer move event listener
   */
  addPointerMoveListener(handler: PointerEventHandler): void;

  /**
   * Add a pointer down event listener
   */
  addPointerDownListener(handler: PointerEventHandler): void;

  /**
   * Remove a pointer move event listener
   */
  removePointerMoveListener(handler: PointerEventHandler): void;

  /**
   * Remove a pointer down event listener
   */
  removePointerDownListener(handler: PointerEventHandler): void;

  /**
   * Get the width of the view
   */
  get width(): number;

  /**
   * Get the height of the view
   */
  get height(): number;

  /**
   * Get the current scale factor applied to the view content
   */
  getScale(): number;

  /**
   * Dispose of the view and clean up resources
   */
  dispose(): void;

  /**
   * Add a render layer (e.g., crosshair or custom annotation)
   */
  addLayer?(id: string, layer: SliceLayer): void;

  /**
   * Remove a render layer by id
   */
  removeLayer?(id: string): void;
}
