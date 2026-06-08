// SliceLayer.ts

import * as PIXI from 'pixi.js';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { Container } from 'pixi.js';
import { SlicePointerEvent } from './types/display';

/**
 * Interface representing a generic slice layer in the SliceViewer.
 * Each layer is responsible for rendering specific types of data
 * (e.g., intensity images, atlas boundaries, annotations, overlays) and handling user interactions.
 *
 * ## Overview
 * SliceLayer provides a composable way to add custom rendering and interactivity to slice views.
 * Layers are stacked on top of each other in a PIXI.Container, with later layers rendering on top.
 *
 * ## Built-in Implementations
 * - **ImageLayer**: Renders volumetric data slices
 * - **CrossHair**: Renders crosshair overlays
 * - **ClusterLayer**: Renders cluster/ROI boundaries
 * - **PositionLabel**: Renders text labels
 *
 * ## Creating Custom Layers
 * To create a custom layer, implement this interface:
 *
 * @example
 * ```typescript
 * class CustomAnnotationLayer implements SliceLayer {
 *   neuroSpace: NeuroSpace;
 *   private container: PIXI.Container | null = null;
 *
 *   constructor(neuroSpace: NeuroSpace) {
 *     this.neuroSpace = neuroSpace;
 *   }
 *
 *   async initialize(): Promise<void> {
 *     // Load any resources, prepare graphics
 *   }
 *
 *   renderSlice(sliceIndex: number, coord: number[], viewAxes: AxisSet3D, parentContainer: PIXI.Container): PIXI.Container | null {
 *     if (!this.container) {
 *       this.container = new PIXI.Container();
 *     }
 *
 *     // Clear previous graphics
 *     this.container.removeChildren();
 *
 *     // Add your custom rendering here
 *     const graphics = new PIXI.Graphics();
 *     graphics.circle(100, 100, 20);
 *     graphics.fill(0xff0000);
 *     this.container.addChild(graphics);
 *
 *     return this.container;
 *   }
 *
 *   setPosition(coord: number[]): void {
 *     // Update layer state based on new position
 *   }
 *
 *   onPointerMove(event: SlicePointerEvent): boolean {
 *     // Handle mouse hover
 *     return false; // Return true to stop event propagation
 *   }
 *
 *   onPointerDown(event: SlicePointerEvent): boolean {
 *     // Handle mouse click
 *     return false;
 *   }
 *
 *   dispose(): void {
 *     if (this.container) {
 *       this.container.destroy({ children: true });
 *       this.container = null;
 *     }
 *   }
 * }
 *
 * // Use the custom layer
 * const viewer = await SingleSliceViewer.createAxial(container, volStack);
 * const customLayer = new CustomAnnotationLayer(volStack.neuroSpace);
 * viewer.getViewer().view.addLayer('annotations', customLayer);
 * ```
 *
 * ## Public API
 * This interface is part of the public API and can be used by external applications
 * to create custom visualization layers.
 */
export interface SliceLayer {
  /**
   * The NeuroSpace associated with the layer.
   * Ensures spatial coherence with other layers in the viewer.
   */
  neuroSpace: NeuroSpace;

  /**
   * Initializes the layer, loading any necessary data or resources.
   * This method is called once when the layer is added to the SliceViewer.
   * It can perform asynchronous operations if needed.
   */
  initialize(): Promise<void> | void;

  /**
   * Renders the slice for the current slice index and view axes.
   * This method is called whenever the SliceViewer updates the slice index
   * or the view orientation.
   *
   * @param sliceIndex - The index of the slice to render.
   * @param viewAxes - The AxisSet3D defining the view orientation.
   * @returns A PIXI.Container or PIXI.DisplayObject containing the rendered content.
   *          Returns `null` if the layer has nothing to render for the given slice.
   */
  renderSlice(sliceIndex: number, coord: number[], viewAxes: AxisSet3D, parentContainer: PIXI.Container): PIXI.Container | null;

  /**
   * Updates the layer's state based on the new volume coordinates.
   * This method is called whenever the SliceViewer's position changes,
   * ensuring that the layer remains in sync with the current view.
   *
   * @param coord - The new volume coordinates [x, y, z].
   */
  setPosition(coord: number[]): void;

  /**
   * Handles pointer (mouse or touch) move events.
   * Layers can implement this method to provide interactive behaviors,
   * such as displaying tooltips or highlighting regions.
   *
   * @param event - The PIXI.InteractionEvent containing event details.
   * @returns A boolean indicating whether the event has been fully handled.
   *          If `true`, the event propagation stops, preventing other layers from handling it.
   */
  onPointerMove(event: SlicePointerEvent): boolean;

  /**
   * Handles pointer (mouse or touch) down events.
   * Layers can implement this method to provide interactive behaviors,
   * such as selecting regions or initiating drag operations.
   *
   * @param event - The PIXI.InteractionEvent containing event details.
   * @returns A boolean indicating whether the event has been fully handled.
   *          If `true`, the event propagation stops, preventing other layers from handling it.
   */
  onPointerDown(event: SlicePointerEvent): boolean;

  /**
   * Disposes of the layer, cleaning up any resources or event listeners.
   * This method is called when the layer is removed from the SliceViewer or
   * when the SliceViewer itself is disposed.
   */
  dispose(): void;

  /**
   * Optional method to handle layer-specific updates.
   */
  update?(params: any): void; // Generic update method for flexibility

  /**
   * If `true`, this layer renders in **screen-pixel space** rather than in the
   * scaled/Y-flipped image content space.
   *
   * The container returned by {@link renderSlice} is added to a dedicated,
   * unscaled overlay container that sits on top of the image. Such layers are
   * excluded from the image's fit-to-screen bounds (so they never affect the
   * image scale) and must position their content using viewport pixel
   * coordinates via {@link layoutScreen}.
   *
   * Use this for overlays that should stay a constant size and stay pinned to
   * the viewport (orientation labels, scale bars, fixed HUD text) instead of
   * tracking the anatomy.
   */
  screenSpace?: boolean;

  /**
   * Called for {@link screenSpace} layers after every fit-to-screen pass (i.e.
   * on render, resize, zoom, and pan) with the current viewport geometry.
   * Implementations should (re)position their content in screen pixels here.
   *
   * @param ctx - Current viewport size and a projector from image-content
   *              coordinates to screen pixels.
   */
  layoutScreen?(ctx: ScreenLayoutContext): void;
}

/**
 * Geometry passed to a {@link SliceLayer.layoutScreen} implementation.
 */
export interface ScreenLayoutContext {
  /** Viewport width in screen pixels. */
  width: number;
  /** Viewport height in screen pixels. */
  height: number;
  /**
   * Pixels reserved on each edge by other UI (e.g. the slice slider along the
   * bottom). Screen-space layers should keep their content inside the safe area
   * `[left, width - right] × [top, height - bottom]` so it does not collide with
   * those widgets. Always present; defaults to zero on every edge.
   */
  insets: { top: number; right: number; bottom: number; left: number };
  /**
   * Projects a point from image-content space (the pre-scale coordinate space
   * the slice sprite occupies: x along the i-axis, y along the j-axis) to
   * screen pixels, accounting for the current scale, Y-flip, zoom, and pan.
   */
  project(contentX: number, contentY: number): { x: number; y: number };
}
