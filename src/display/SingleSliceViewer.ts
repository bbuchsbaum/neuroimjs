// File: src/display/SingleSliceViewer.ts

import { ImageLayer } from './ImageLayer';
import { AxisSet3D, AXIAL_LPI, CORONAL_LIP, SAGITTAL_AIL } from '../geometry/Axis';
import { IReactionDisposer } from 'mobx';
import { SliceViewer } from './SliceViewer';
import { EventEmitter } from './EventEmitter';
import { VolStack } from './VolStack';
import { ICoordinateTransformer } from './interfaces/ICoordinateTransformer';
import { PointerEventHandler } from './types/display';
import { DepthEnhancedLayer, DepthEnhancedOptions } from './DepthEnhancedLayer';
import { IntensityReadout } from './IntensityReadout';
import { OrientationLabelLayer } from './OrientationLabelLayer';

/**
 * Event types for SingleSliceViewer
 */
export interface SingleSliceViewerEvents extends Record<string, unknown[]> {
  /**
   * Fired when the viewer is fully initialized and ready
   */
  'ready': [];

  /**
   * Fired when the coordinate changes
   */
  'coordChanged': [coord: number[]];

  /**
   * Fired when the slice index changes
   */
  'sliceChanged': [index: number];

  /**
   * Fired on pointer move events with coordinate information
   */
  'pointerMove': [event: {
    imageCoord: { x: number; y: number } | null;
    volumeCoord: number[] | null;
    worldCoord: number[] | null;
  }];

  /**
   * Fired on pointer down events with coordinate information
   */
  'pointerDown': [event: {
    imageCoord: { x: number; y: number } | null;
    volumeCoord: number[] | null;
    worldCoord: number[] | null;
  }];

  /**
   * Fired when zoom level changes
   */
  'zoomChanged': [level: number];
}

/**
 * Options for creating a SingleSliceViewer
 */
export interface SingleSliceViewerOptions {
  /**
   * Width of the viewer in pixels
   */
  width?: number;

  /**
   * Height of the viewer in pixels
   */
  height?: number;

  /**
   * Show crosshair overlay
   */
  showCrosshair?: boolean;

  /**
   * Show slice navigation slider
   */
  showSlider?: boolean;

  /**
   * Initial coordinate to display (world coordinates in mm)
   */
  initialCoord?: number[];

  /**
   * Show intensity value readout under cursor
   * @default false
   */
  showIntensityReadout?: boolean;

  /**
   * Show orientation labels (L/R/A/P/S/I) at slice edges
   * @default false
   */
  showOrientationLabels?: boolean;

  /**
   * Enable depth-enhanced viewing with blur and parallax effects.
   * When true, adjacent slices are rendered with blur and shift
   * based on cursor position to provide depth cues.
   * @default false
   */
  enableDepthEnhancement?: boolean;

  /**
   * Options for depth-enhanced viewing (only used if enableDepthEnhancement is true)
   */
  depthEnhancementOptions?: DepthEnhancedOptions;
}

// Allow storing both MobX disposers and arbitrary cleanup callbacks
type Disposer = IReactionDisposer | (() => void);

/**
 * SingleSliceViewer provides a simplified, event-driven API for creating
 * individual slice views (axial, sagittal, or coronal) that can be easily
 * composed into custom layouts.
 *
 * **This is the recommended (canonical) composable view API.** For multi-view
 * coordination, combine several `SingleSliceViewer`s with {@link ViewSynchronizer};
 * for a batteries-included 3-up layout use {@link SimpleOrthogonalViewer}. See the
 * architecture note on {@link SliceViewer} for how the viewer layers relate.
 *
 * This class wraps SliceViewer and adds:
 * - Convenient factory methods for standard orientations
 * - Type-safe event system for coordination
 * - Direct access to coordinate transformers
 * - Easy-to-use API for external applications
 *
 * @example
 * ```typescript
 * // Create a standalone axial view
 * const axialView = await SingleSliceViewer.createAxial(
 *   document.getElementById('axial-panel'),
 *   volStack,
 *   { showCrosshair: true }
 * );
 *
 * // Listen to coordinate changes
 * axialView.onCoordChange(coord => {
 *   console.log('New coordinate:', coord);
 * });
 *
 * // Listen to pointer events
 * axialView.on('pointerMove', ({ worldCoord }) => {
 *   console.log('Mouse at:', worldCoord);
 * });
 * ```
 */
export class SingleSliceViewer {
  /**
   * Internal SliceViewer instance that handles the actual rendering
   */
  private readonly viewer: SliceViewer;

  /**
   * Event emitter for type-safe events
   */
  private readonly events: EventEmitter<SingleSliceViewerEvents>;

  /**
   * Disposers for MobX reactions
   */
  private readonly disposers: Disposer[] = [];

  /**
   * The orientation of this view
   */
  private readonly orientation: AxisSet3D;

  /**
   * Depth enhancement layer (if enabled)
   */
  private depthEnhancedLayer: DepthEnhancedLayer | null = null;

  /**
   * Reference to the image layer for depth enhancement
   */
  private imageLayer: ImageLayer | null = null;

  /**
   * Private constructor. Use static factory methods to create instances.
   */
  private constructor(viewer: SliceViewer, orientation: AxisSet3D) {
    this.viewer = viewer;
    this.orientation = orientation;
    this.events = new EventEmitter<SingleSliceViewerEvents>();

    // Set up event forwarding from the underlying viewer
    this.setupEventForwarding();
  }

  /**
   * Create an axial view (looking down through the head)
   *
   * @param container - DOM element to attach the viewer to
   * @param volStack - Volume data to display
   * @param options - Configuration options
   * @returns Promise resolving to the created viewer
   */
  public static async createAxial(
    container: HTMLElement,
    volStack: VolStack,
    options?: SingleSliceViewerOptions
  ): Promise<SingleSliceViewer> {
    return SingleSliceViewer.create(container, volStack, AXIAL_LPI, options);
  }

  /**
   * Create a sagittal view (looking from the side)
   *
   * @param container - DOM element to attach the viewer to
   * @param volStack - Volume data to display
   * @param options - Configuration options
   * @returns Promise resolving to the created viewer
   */
  public static async createSagittal(
    container: HTMLElement,
    volStack: VolStack,
    options?: SingleSliceViewerOptions
  ): Promise<SingleSliceViewer> {
    return SingleSliceViewer.create(container, volStack, SAGITTAL_AIL, options);
  }

  /**
   * Create a coronal view (looking from the front)
   *
   * @param container - DOM element to attach the viewer to
   * @param volStack - Volume data to display
   * @param options - Configuration options
   * @returns Promise resolving to the created viewer
   */
  public static async createCoronal(
    container: HTMLElement,
    volStack: VolStack,
    options?: SingleSliceViewerOptions
  ): Promise<SingleSliceViewer> {
    return SingleSliceViewer.create(container, volStack, CORONAL_LIP, options);
  }

  /**
   * Create a view with a custom orientation
   *
   * @param container - DOM element to attach the viewer to
   * @param volStack - Volume data to display
   * @param orientation - Custom axis set defining the orientation
   * @param options - Configuration options
   * @returns Promise resolving to the created viewer
   */
  public static async create(
    container: HTMLElement,
    volStack: VolStack,
    orientation: AxisSet3D,
    options?: SingleSliceViewerOptions
  ): Promise<SingleSliceViewer> {
    // Create the image layer
    const imageLayer = new ImageLayer(volStack);

    // Create the underlying SliceViewer
    const sliceViewer = await SliceViewer.create(
      container,
      imageLayer,
      orientation,
      {
        width: options?.width,
        height: options?.height,
        showCrosshair: options?.showCrosshair,
        showSlider: options?.showSlider
      }
    );

    // If initial coordinate is provided, set it
    if (options?.initialCoord) {
      sliceViewer.setPosition(options.initialCoord);
    }

    // Create and return the SingleSliceViewer wrapper
    const viewer = new SingleSliceViewer(sliceViewer, orientation);

    // Store reference to image layer for depth enhancement
    viewer.imageLayer = imageLayer;

    // Add depth enhancement layer if requested
    if (options?.enableDepthEnhancement && sliceViewer.view.addLayer) {
      const depthLayer = new DepthEnhancedLayer(
        imageLayer,
        options.depthEnhancementOptions
      );
      // Add as first layer so it renders behind the main image
      sliceViewer.view.addLayer('depth-enhanced', depthLayer);
      viewer.depthEnhancedLayer = depthLayer;
    }

    // Add orientation labels if requested
    if (options?.showOrientationLabels && sliceViewer.view.addLayer) {
      const labelLayer = new OrientationLabelLayer(volStack.space);
      sliceViewer.view.addLayer('orientation-labels', labelLayer);
    }

    // Add intensity readout if requested
    if (options?.showIntensityReadout && sliceViewer.view.addLayer) {
      const transformer = sliceViewer.view.getCoordinateTransformer() as any;
      const readoutLayer = new IntensityReadout(
        volStack.space,
        volStack,
        transformer
      );
      sliceViewer.view.addLayer('intensity-readout', readoutLayer);
    }

    // Emit ready event
    viewer.events.emit('ready');

    return viewer;
  }

  /**
   * Set up event forwarding from the underlying viewer
   */
  private setupEventForwarding(): void {
    // Forward coordinate changes
    const coordDisposer = this.viewer.onCurrentCoordChange(coord => {
      this.events.emit('coordChanged', coord);
    });
    this.disposers.push(coordDisposer);

    // Forward slice index changes
    const sliceDisposer = this.viewer.onCurrentSliceIndexChange(index => {
      this.events.emit('sliceChanged', index);
    });
    this.disposers.push(sliceDisposer);

    // Forward pointer move events
    const pointerMoveHandler: PointerEventHandler = () => {
      this.events.emit('pointerMove', {
        imageCoord: this.viewer.mouseImagePosition,
        volumeCoord: this.viewer.mouseVolumeCoordinate,
        worldCoord: this.viewer.mouseWorldCoordinate
      });
    };
    this.viewer.view.addPointerMoveListener(pointerMoveHandler);

    // Forward pointer down events
    const pointerDownHandler: PointerEventHandler = () => {
      this.events.emit('pointerDown', {
        imageCoord: this.viewer.mouseImagePosition,
        volumeCoord: this.viewer.mouseVolumeCoordinate,
        worldCoord: this.viewer.mouseWorldCoordinate
      });
    };
    this.viewer.view.addPointerDownListener(pointerDownHandler);

    // Store handlers for cleanup
    this.disposers.push(() => {
      this.viewer.view.removePointerMoveListener(pointerMoveHandler);
      this.viewer.view.removePointerDownListener(pointerDownHandler);
    });
  }

  /**
   * Subscribe to an event
   *
   * @param event - Event name
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  public on<K extends keyof SingleSliceViewerEvents>(
    event: K,
    handler: (...args: SingleSliceViewerEvents[K]) => void
  ): () => void {
    return this.events.on(event, handler);
  }

  /**
   * Subscribe to coordinate changes (convenience method)
   *
   * @param handler - Function called when coordinate changes
   * @returns Unsubscribe function
   */
  public onCoordChange(handler: (coord: number[]) => void): () => void {
    return this.on('coordChanged', handler);
  }

  /**
   * Subscribe to slice index changes (convenience method)
   *
   * @param handler - Function called when slice index changes
   * @returns Unsubscribe function
   */
  public onSliceChange(handler: (index: number) => void): () => void {
    return this.on('sliceChanged', handler);
  }

  /**
   * Subscribe to pointer move events (convenience method)
   *
   * @param handler - Function called on pointer move
   * @returns Unsubscribe function
   */
  public onPointerMove(handler: (event: {
    imageCoord: { x: number; y: number } | null;
    volumeCoord: number[] | null;
    worldCoord: number[] | null;
  }) => void): () => void {
    return this.on('pointerMove', handler);
  }

  /**
   * Subscribe to pointer down events (convenience method)
   *
   * @param handler - Function called on pointer down
   * @returns Unsubscribe function
   */
  public onPointerDown(handler: (event: {
    imageCoord: { x: number; y: number } | null;
    volumeCoord: number[] | null;
    worldCoord: number[] | null;
  }) => void): () => void {
    return this.on('pointerDown', handler);
  }

  /**
   * Get the current coordinate in world space (mm)
   */
  public getCurrentCoord(): number[] {
    return this.viewer.currentCoord;
  }

  /**
   * Set the current coordinate in world space (mm)
   *
   * @param coord - World coordinate [x, y, z] in mm
   */
  public setCoord(coord: number[]): void {
    this.viewer.setPosition(coord);
  }

  /**
   * Get the current slice index
   */
  public getCurrentSliceIndex(): number {
    return this.viewer.currentSliceIndex;
  }

  /**
   * Get the current mouse position in image coordinates
   */
  public getMouseImagePosition(): { x: number; y: number } | null {
    return this.viewer.mouseImagePosition;
  }

  /**
   * Get the current mouse position in volume coordinates
   */
  public getMouseVolumeCoordinate(): number[] | null {
    return this.viewer.mouseVolumeCoordinate;
  }

  /**
   * Get the current mouse position in world coordinates
   */
  public getMouseWorldCoordinate(): number[] | null {
    return this.viewer.mouseWorldCoordinate;
  }

  /**
   * Get the coordinate transformer for this view
   * Useful for custom coordinate conversions
   */
  public getCoordinateTransformer(): ICoordinateTransformer {
    return this.viewer.view.getCoordinateTransformer();
  }

  /**
   * Get the orientation of this view
   */
  public getOrientation(): AxisSet3D {
    return this.orientation;
  }

  /**
   * Get the canvas element
   */
  public getCanvas(): HTMLCanvasElement {
    return this.viewer.view.getCanvas();
  }

  /**
   * Toggle crosshair visibility
   *
   * @param visible - Whether to show the crosshair
   */
  public setCrosshairVisible(visible: boolean): void {
    this.viewer.setCrosshairVisible(visible);
  }

  /**
   * Handle resize events (call when container size changes)
   */
  public handleResize(): void {
    this.viewer.handleResize();
  }

  /**
   * Get the current scale/zoom level
   */
  public getScale(): number {
    return this.viewer.scale;
  }

  /**
   * Get the width of the view in pixels
   */
  public getWidth(): number {
    return this.viewer.view.width;
  }

  /**
   * Get the height of the view in pixels
   */
  public getHeight(): number {
    return this.viewer.view.height;
  }

  /**
   * Get the ImageLayer used by this viewer.
   * Useful for connecting external controls (e.g. LayerControlPanel) to the VolStack.
   */
  public getImageLayer(): ImageLayer | null {
    return this.imageLayer;
  }

  /**
   * Access the underlying SliceViewer for advanced use cases
   *
   * @internal
   */
  public getViewer(): SliceViewer {
    return this.viewer;
  }

  // ─────────────────────────────────────────────────────────────
  // Zoom & Pan Controls
  // ─────────────────────────────────────────────────────────────

  /**
   * Set the zoom level for this view
   *
   * @param level - Zoom level (1.0 = no zoom, >1 = zoom in, <1 = zoom out)
   */
  public setZoom(level: number): void {
    const view = this.viewer.view as any;
    if (typeof view.setZoom === 'function') {
      view.setZoom(level);
      this.events.emit('zoomChanged', view.getZoom());
    }
  }

  /**
   * Get the current zoom level
   */
  public getZoom(): number {
    const view = this.viewer.view as any;
    return typeof view.getZoom === 'function' ? view.getZoom() : 1.0;
  }

  /**
   * Set the pan offset
   *
   * @param offset - Pan offset in pixels { x, y }
   */
  public setPan(offset: { x: number; y: number }): void {
    const view = this.viewer.view as any;
    if (typeof view.setPan === 'function') {
      view.setPan(offset);
    }
  }

  /**
   * Get the current pan offset
   */
  public getPan(): { x: number; y: number } {
    const view = this.viewer.view as any;
    return typeof view.getPan === 'function' ? view.getPan() : { x: 0, y: 0 };
  }

  /**
   * Reset zoom and pan to defaults
   */
  public resetView(): void {
    const view = this.viewer.view as any;
    if (typeof view.resetView === 'function') {
      view.resetView();
      this.events.emit('zoomChanged', 1.0);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Depth Enhancement Controls
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if depth enhancement is enabled
   */
  public isDepthEnhancementEnabled(): boolean {
    return this.depthEnhancedLayer?.enabled ?? false;
  }

  /**
   * Enable or disable depth enhancement
   *
   * @param enabled - Whether to enable depth enhancement
   */
  public setDepthEnhancementEnabled(enabled: boolean): void {
    if (this.depthEnhancedLayer) {
      this.depthEnhancedLayer.setEnabled(enabled);
    }
  }

  /**
   * Get current depth enhancement options
   */
  public getDepthEnhancementOptions(): DepthEnhancedOptions | null {
    return this.depthEnhancedLayer?.getOptions() ?? null;
  }

  /**
   * Update depth enhancement options
   *
   * @param options - Partial options to update
   */
  public setDepthEnhancementOptions(options: Partial<DepthEnhancedOptions>): void {
    if (this.depthEnhancedLayer) {
      this.depthEnhancedLayer.setOptions(options);
    }
  }

  /**
   * Check if depth enhancement layer is available
   * (only true if enableDepthEnhancement was set during creation)
   */
  public hasDepthEnhancement(): boolean {
    return this.depthEnhancedLayer !== null;
  }

  /**
   * Dispose of the viewer and clean up all resources
   */
  public dispose(): void {
    // Dispose all reaction disposers
    this.disposers.forEach(disposer => disposer());

    // Clear event listeners
    this.events.removeAllListeners();

    // Dispose the underlying viewer
    this.viewer.dispose();
  }
}
