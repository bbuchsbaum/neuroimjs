// File: src/display/SliceViewer.ts

import { ImageLayer } from './ImageLayer';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { IReactionDisposer, reaction, action, makeObservable, observable, computed } from 'mobx';
import { ViewerStateInfo } from './ViewerStateInfo';
import { ISliceModel, ISliceView, ISliceController } from './interfaces';
import { ViewerFactory } from './ViewerFactory';
import { CrossHair } from './CrossHair';
import { arraysNearlyEqual, COORDINATE_EPSILON } from './NumericalUtils';

/**
 * SliceViewer is effectively a "manager" or "facade" that ties together:
 *  - A SliceModel: tracks current slice index, coordinate, dimension, etc.
 *  - A SliceView: handles rendering the slice in a PIXI canvas.
 *  - A SliceController: mediates pointer events, keyboard input, or other user interactions.
 *
 * Because `SliceView` also includes its own "layers," `SliceViewer` might look
 * somewhat redundant at first glance. However, it adds:
 *  - A single top-level function (`create`) to initialize model, view, and controller.
 *  - Central control over the slice index and coordinate via the model.
 *  - Optionally, consumer-friendly methods like `setPosition(...)`, `handleResize(...)`.
 *
 * Naming note (`SliceView` vs `SliceViewer`): `SliceView` is the PIXI renderer;
 * `SliceViewer` is the facade that binds model/view/controller. They are distinct
 * layers, not duplicates.
 *
 * VIEWER ARCHITECTURE — two stacks exist; prefer the composable one for new code:
 *  - **Composable (recommended):** `SingleSliceViewer` (a single orientation with an
 *    event API) composed via `ViewSynchronizer` for multi-view coordination.
 *  - **High-level convenience:** `SimpleOrthogonalViewer` — a batteries-included
 *    3-up orthogonal viewer (wraps `OrthogonalImageViewer`).
 *  - **Building blocks (this class, `SliceView`, `SliceController`, `OrthogonalImageViewer`):**
 *    lower-level primitives the above are built from. Use directly only for custom layouts.
 *
 * A future major version may unify the two coordination mechanisms (MobX reactions
 * here vs. the EventEmitter used by `SingleSliceViewer`/`ViewSynchronizer`) into one;
 * until then both are supported.
 */
export class SliceViewer implements ViewerStateInfo {
  /**
   * The SliceModel that stores how many slices exist (totalSlices),
   * which slice index is currently viewed, and the current 3D coordinate.
   */
  public model: ISliceModel;

  /**
   * The SliceView that handles rendering via PIXI.
   */
  public view!: ISliceView;

  /**
   * The SliceController that handles user interactions with the view.
   */
  public controller!: ISliceController;

  /**
   * Stores the ImageLayer instance for reference
   */
  private readonly imageLayer: ImageLayer;

  /**
   * Stores the view axes for reference
   */
  private readonly viewAxes: AxisSet3D;

  /**
   * Private constructor. Use `SliceViewer.create(...)` to instantiate asynchronously.
   *
   * @param domElement - The DOM element to attach the SliceView's canvas and optional slider.
   * @param imageLayer - The primary volume-based slice rendering layer.
   * @param viewAxes   - Specifies orientation (e.g., Axial, Coronal, etc.).
   * @param options    - Control flags for crosshair, slider, width, height, etc.
   */
  private constructor(
    domElement: HTMLElement,
    imageLayer: ImageLayer,
    viewAxes: AxisSet3D,
    options?: {
      width?: number;
      height?: number;
      showCrosshair?: boolean;
      showSlider?: boolean;
    }
  ) {
    // Enable MobX-based reactivity for any properties we mark with @observable, @computed, etc.
    makeObservable(this);

    // Retrieve NeuroSpace to compute total slices along movement axis
    const neuroSpace = imageLayer.neuroSpace;
    const movementAxisIndex = neuroSpace.whichDim(viewAxes.k);
    const totalSlices = neuroSpace.dim[movementAxisIndex];

    // Create an initial 3D coordinate at the center of the volume
    const initialCoord = neuroSpace.dim.map(d => Math.floor((d - 1) / 2));
    
    // Convert grid coordinates to world coordinates
    const worldCoord = neuroSpace.gridToCoord(initialCoord);

    // Build the SliceModel using factory (expects world coordinates)
    this.model = ViewerFactory.createSliceModel(totalSlices, worldCoord, neuroSpace, viewAxes);

    // Store the imageLayer and viewAxes for reference
    this.imageLayer = imageLayer;
    this.viewAxes = viewAxes;
  }

  /**
   * Factory method for building a fully-initialized SliceViewer (model, view, controller).
   * The `view` is created asynchronously since it sets up a PIXI Application.
   *
   * @param domElement - Container element in the DOM for the canvas.
   * @param imageLayer - The main ImageLayer, containing a VolStack of volumetric data.
   * @param viewAxes   - The orientation for slicing.
   * @param options    - Optional config (width, height, showCrosshair, showSlider).
   * @returns A promise that resolves to the created SliceViewer instance.
   */
  public static async create(
    domElement: HTMLElement,
    imageLayer: ImageLayer,
    viewAxes: AxisSet3D,
    options?: {
      width?: number;
      height?: number;
      showCrosshair?: boolean;
      showSlider?: boolean;
    }
  ): Promise<SliceViewer> {
    const viewer = new SliceViewer(domElement, imageLayer, viewAxes, options);
    await viewer.initialize(domElement, imageLayer, viewAxes, options);
    return viewer;
  }

  /**
   * Internal initialization function:
   *   1) Creates a SliceView for rendering.
   *   2) Creates a SliceController for user interactions.
   *   3) Sets an initial slice index.
   *
   * @param domElement - The container for the rendered slice.
   * @param imageLayer - The main volumetric data layer.
   * @param viewAxes   - Desired orientation (AxisSet3D).
   * @param options    - Layout flags (width, height, crosshair, slider).
   */
  private async initialize(
    domElement: HTMLElement,
    imageLayer: ImageLayer,
    viewAxes: AxisSet3D,
    options?: {
      width?: number;
      height?: number;
      showCrosshair?: boolean;
      showSlider?: boolean;
    }
  ) {
    // 1) Create the SliceView (Async) using factory
    const neuroSpace = imageLayer.neuroSpace;
    this.view = await ViewerFactory.createSliceView(
      domElement,
      imageLayer,
      neuroSpace,
      viewAxes,
      this.model,
      options
    );

    // 2) Create a SliceController using factory
    this.controller = ViewerFactory.createSliceController(
      this.model,
      this.view,
      neuroSpace,
      viewAxes
    );

    // 3) The model should already be at the middle slice due to the initial coordinate
    // But let's ensure it's properly set
    const expectedSliceIndex = Math.floor((this.model.totalSlices - 1) / 2);
    if (this.model.currentSliceIndex !== expectedSliceIndex) {
      this.model.setCurrentSliceIndex(expectedSliceIndex);
    }
  }

  /**
   * Toggle crosshair overlay at runtime for this view.
   */
  public setCrosshairVisible(visible: boolean): void {
    const v = this.view as any;
    if (visible) {
      if (typeof v.addLayer === 'function') {
        v.addLayer('crosshair', new CrossHair(
          this.imageLayer.neuroSpace,
          this.viewAxes,
          v.getCoordinateTransformer() as any
        ));
      }
    } else {
      if (typeof v.removeLayer === 'function') {
        v.removeLayer('crosshair');
      }
    }
  }

  /**
   * Sets the 3D coordinate in the model if it differs from the currentCoord.
   * Triggers re-rendering in the SliceView.
   *
   * @param coord - The [x,y,z] coordinate to set (in volume space).
   */
  @action
  public setPosition(coord: number[]): void {
    if (!this.positionsAreEqual(this.model.currentCoord, coord)) {
      this.model.setCurrentCoord(coord);
    } else {
    }
  }

  /**
   * The currently visible coordinate in volume space.
   */
  @computed
  get currentCoord(): number[] {
    return this.model.currentCoord;
  }

  /**
   * The integer-based slice index derived from the model's volume geometry.
   */
  @computed
  get currentSliceIndex(): number {
    return this.model.currentSliceIndex;
  }

  /**
   * The last pointer position in image space from the SliceController,
   * e.g. the local 2D coordinate on the slice.
   */
  @computed
  get mouseImagePosition(): { x: number; y: number } | null {
    return this.controller.mouseImagePosition;
  }

  /**
   * The last pointer position in volume space from the SliceController.
   * (Might be useful for readouts or crosshair).
   */
  @computed
  get mouseVolumeCoordinate(): number[] | null {
    return this.controller.mouseVolumeCoordinate;
  }

  /**
   * The last pointer position in world space from the SliceController.
   */
  @computed
  get mouseWorldCoordinate(): number[] | null {
    return this.controller.mouseWorldCoordinate;
  }

  /**
   * Utility to check if two 3D coordinates are approximately equal within epsilon tolerance.
   * Uses epsilon comparison to handle floating-point precision issues.
   *
   * @param coord1 - First [x,y,z] coordinate.
   * @param coord2 - Second [x,y,z] coordinate.
   * @returns True if all components are within epsilon tolerance, false otherwise.
   */
  private positionsAreEqual(coord1: number[], coord2: number[]): boolean {
    return arraysNearlyEqual(coord1, coord2, COORDINATE_EPSILON);
  }

  /**
   * Forwards a resize event to the SliceView (which resizes the PIXI renderer
   * and re-fits the slice to screen).
   */
  public handleResize(): void {
    this.view.handleResize();
  }

  /**
   * Registers a callback for when the model's currentSliceIndex changes.
   * @param handler - A function receiving the new slice index.
   * @returns A disposer function that unsubscribes the reaction.
   */
  public onCurrentSliceIndexChange(handler: (index: number) => void): IReactionDisposer {
    return this.model.onSliceIndexChange(handler);
  }

  /**
   * Registers a callback for when the model's currentCoord changes.
   * @param handler - A function receiving the new [x,y,z] coordinate.
   * @returns A disposer function that unsubscribes the reaction.
   */
  public onCurrentCoordChange(handler: (coord: number[]) => void): IReactionDisposer {
    return this.model.onCoordChange(handler);
  }

  /**
   * Returns the current mouse state information.
   * This implements the ViewerStateInfo for compatibility with StatusBar.
   */
  @computed
  get mouseState(): { viewName: string | null; imageCoordinate: { x: number; y: number } | null; volumeCoordinate: number[] | null; worldCoordinate: number[] | null } {
    return {
      viewName: 'slice', // Single view for SliceViewer
      imageCoordinate: this.mouseImagePosition,
      volumeCoordinate: this.mouseVolumeCoordinate,
      worldCoordinate: this.mouseWorldCoordinate
    };
  }

  /**
   * Returns the current slice indices.
   * For SliceViewer, this is a single index, but we return it in a format
   * compatible with the ViewerStateInfo.
   */
  @computed
  get sliceIndices(): Record<string, number> {
    return {
      slice: this.currentSliceIndex
    };
  }

  /**
   * Returns the total number of slices available.
   */
  @computed
  get totalSlices(): Record<string, number> {
    return {
      slice: this.model.totalSlices
    };
  }

  /**
   * Returns the view orientation information.
   */
  @computed
  get viewOrientation(): AxisSet3D {
    return this.viewAxes;
  }

  /**
   * Returns the current scale/zoom level of the viewer.
   */
  @computed
  get scale(): number {
    return this.view ? this.view.getScale() : 1;
  }

  /**
   * Identifies this as a slice viewer.
   */
  @computed
  get viewerType(): string {
    return 'slice';
  }

  /**
   * Returns information about visible layers.
   */
  @computed
  get visibleLayers(): Array<{ id: string; visible: boolean; opacity?: number }> {
    // Store reference to imageLayer as a local variable for easy access
    const imageLayer = this.imageLayer; 
    
    if (!imageLayer) {
      return [];
    }
    
    // Get layer IDs from the image layer
    const layerIds = imageLayer.getLayerIds();
    
    // Map to the required format
    return layerIds.map((id: string) => {
      // Get the layer to access its properties
      const layer = imageLayer.getVolStack().getLayerById(id);
      return {
        id,
        visible: true, // Assuming all layers in the stack are visible
        opacity: layer ? layer.opacity : 1.0
      };
    });
  }

  /**
   * Disposes of the viewer and all its resources.
   * Cleans up the view, controller, and any other resources.
   */
  public dispose(): void {
    // Dispose controller first (it has references to view)
    if (this.controller) {
      this.controller.dispose();
    }
    
    // Then dispose view
    if (this.view) {
      this.view.dispose();
    }
    
    // Note: We don't dispose model or imageLayer as they may be shared
  }
}
