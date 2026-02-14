import { AxisSet3D } from '../geometry/Axis';
import { SliceViewer } from './SliceViewer';
import { ImageLayer } from './ImageLayer';
import { observable, action, makeObservable, computed, reaction, IReactionDisposer, makeAutoObservable } from 'mobx';
import { ViewerStateInfo } from './ViewerStateInfo';
import { arraysNearlyEqual, COORDINATE_EPSILON } from './NumericalUtils';

/**
 * Enumerates the names for the three standard orthogonal views:
 *   - Axial
 *   - Coronal
 *   - Sagittal
 */
enum ViewName {
  Axial = 'axial',
  Coronal = 'coronal',
  Sagittal = 'sagittal',
}

/**
 * Optional configuration for how each orthogonal viewer is displayed and operated.
 */
interface OrthogonalImageViewerOptions {
  /**
   * Width in pixels for each of the sub-viewers (optional if auto-resizing).
   */
  width?: number;

  /**
   * Height in pixels for each of the sub-viewers (optional if auto-resizing).
   */
  height?: number;

  /**
   * Whether to display crosshair lines in the sub-viewers.
   */
  showCrosshair?: boolean;

  /**
   * Whether to display a slider in each sub-viewer for changing slice indices.
   */
  showSlider?: boolean;

  /**
   * Layout mode for arranging the three views.
   * - 'left-tall': axial occupies left column (both rows); coronal/sagittal on right (default, current)
   * - 'top-bottom': axial spans full width on top; sagittal and coronal split bottom row horizontally
   */
  layout?: 'left-tall' | 'top-bottom';

  /**
   * CSS gap between grid cells, in pixels (default: '8px').
   */
  gapPx?: number;
}

/**
 * Parameters required to instantiate the OrthogonalImageViewer.
 */
interface OrthogonalImageViewerParams {
  /**
   * The DOM container in which this orthogonal viewer's layout will be placed.
   */
  container: HTMLElement;

  /**
   * The ImageLayer instance that holds the volume data in a VolStack.
   */
  imageLayer: ImageLayer;

  /**
   * Viewer options for layout or interactive features.
   */
  options?: OrthogonalImageViewerOptions;
}

/**
 * OrthogonalImageViewer manages three simultaneous SliceViewers (Axial, Coronal, Sagittal),
 * each displaying a different orientation of the same data. The user can interact with
 * any sub-view to change the shared coordinate, updating the other sub-views in sync.
 *
 * All the sub-viewers are arranged in a grid layout. The class handles:
 *   - Creating the DOM elements for each view.
 *   - Initializing and disposing the sub-viewers.
 *   - Synchronizing the position (currentCoord) among the sub-viewers.
 *   - Handling window resize events and re-drawing each view.
 *   - Reactively updating the sub-viewers if the user adjusts slice indices in any one viewer.
 */
export class OrthogonalImageViewer implements ViewerStateInfo {
  /**
   * The current 3D coordinate shared by all sub-viewers. 
   * This is updated whenever one of the SliceViewers changes its currentCoord.
   */
  @observable public currentCoord: number[];

  /**
   * An observable storing the mouse state: which view's mouse changed,
   * and the image and volume coordinates under the pointer.
   */
  @observable private _mouseState: {
    viewName: string | null;
    imageCoordinate: { x: number; y: number } | null;
    volumeCoordinate: number[] | null;
    worldCoordinate: number[] | null;
  } = {
    viewName: null,
    imageCoordinate: null,
    volumeCoordinate: null,
    worldCoordinate: null
  };

  /**
   * The currently focused view for keyboard navigation.
   * Arrow keys affect this view's slice position.
   */
  @observable private focusedView: ViewName | null = null;

  // The top-level parameters for container and layer.
  private params: OrthogonalImageViewerParams;
  private container: HTMLElement;
  private imageLayer: ImageLayer;
  private perViewImageLayers: Partial<Record<ViewName, ImageLayer>> = {};

  // A dictionary of SliceViewers: keys are "axial", "coronal", "sagittal".
  private sliceViewers: Record<ViewName, SliceViewer>;

  // A dictionary of AxisSet3D for each standard orientation.
  private axesSets: Record<ViewName, AxisSet3D>;
  private baseViewSizes: Record<ViewName, { width: number; height: number }> = {} as Record<ViewName, { width: number; height: number }>;
  private resizeObserver?: ResizeObserver;

  // Additional user-defined options like "showCrosshair" or "showSlider".
  private options: OrthogonalImageViewerOptions;

  // A dictionary of DOM elements (HTML divs) for each sub-view.
  private viewDivs: Record<ViewName, HTMLElement> = {} as Record<ViewName, HTMLElement>;

  // Bound method for handling container resize events.
  private handleResizeBound = this.handleResize.bind(this);

  // Bound method for handling keyboard events.
  private handleKeydownBound = this.handleKeydown.bind(this);

  // A collection of MobX disposers for cleaning up reactive side effects.
  private disposers: IReactionDisposer[] = [];

  /**
   * Private constructor to force usage of the async factory method `.create()`.
   * 
   * @param params - The container, imageLayer, and optional settings.
   */
  private constructor(params: OrthogonalImageViewerParams) {
    this.params = params;
    this.container = params.container;
    this.imageLayer = params.imageLayer;
    this.options = params.options ?? {};

    // Predefined orientation sets for each sub-view
    this.axesSets = {
      [ViewName.Axial]: AxisSet3D.AXIAL_LPI,
      [ViewName.Coronal]: AxisSet3D.CORONAL_LIP,
      [ViewName.Sagittal]: AxisSet3D.SAGITTAL_AIL,
    };
    this.computeBaseViewSizes();

    // Initialize currentCoord to the space's centroid (center of volume).
    const centroid = this.imageLayer.neuroSpace.centroid();
    this.currentCoord = centroid.slice();

    // Prepare an empty record for the 3 SliceViewers
    this.sliceViewers = {} as Record<ViewName, SliceViewer>;

    makeObservable(this);
  }
  private computeBaseViewSizes(): void {
    const space = this.imageLayer.neuroSpace;
    const dims = space.dim;
    const spacing = space.spacing;
    Object.entries(this.axesSets).forEach(([viewKey, axesSet]) => {
      const idxI = space.whichDim(axesSet.i);
      const idxJ = space.whichDim(axesSet.j);
      const physicalWidth = dims[idxI] * (spacing[idxI] ?? 1);
      const physicalHeight = dims[idxJ] * (spacing[idxJ] ?? 1);
      this.baseViewSizes[viewKey as ViewName] = {
        width: physicalWidth,
        height: physicalHeight,
      };
    });
  }

  /**
   * Creates an OrthogonalImageViewer, asynchronously building its sub-viewers.
   * 
   * @param params - Contains the container HTMLElement, imageLayer, and viewer options.
   * @returns A fully-initialized instance of OrthogonalImageViewer.
   */
  public static async create(
    params: OrthogonalImageViewerParams
  ): Promise<OrthogonalImageViewer> {
    const viewer = new OrthogonalImageViewer(params);
    await viewer.initialize();
    return viewer;
  }

  /**
   * Main async init routine that sets up the layout grid, creates each SliceViewer,
   * and wires up MobX reactions.
   */
  private async initialize(): Promise<void> {
    // 1) Create the layout DOM structure
    await this.initializeLayout();

    // 2) Instantiate each of the three sub-viewers
    await this.initializeViewers();

    // 3) Set up cross-view property syncing
    this.setupReactions();

    // 3b) Connect resize listeners (window + container)
    window.addEventListener('resize', this.handleResizeBound);
    try {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    } catch {}

    // 3c) Connect keyboard listener for arrow key navigation
    document.addEventListener('keydown', this.handleKeydownBound);

    // 4) Perform initial sizing AFTER browser layout completes
    // CRITICAL FIX: Use requestAnimationFrame to ensure CSS Grid layout is complete
    // before reading clientWidth/clientHeight for resize
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => {
        this.handleResize();
        resolve();
      });
    });
  }

  /**
   * Creates HTML divs for each orientation (axial, coronal, sagittal) inside a 2x2 CSS grid.
   */
  private async initializeLayout(): Promise<void> {
    // Create sub-viewer divs
    const axialDiv = document.createElement('div');
    const coronalDiv = document.createElement('div');
    const sagittalDiv = document.createElement('div');

    // Define a style object to share across the sub-view divs
    // CRITICAL FIX: Grid items should fill their cells - use height: 100% on items
    // The key is ensuring the grid container itself establishes row heights properly
    const viewStyle: Partial<CSSStyleDeclaration> = {
      width: 'auto',
      height: 'auto',
      position: 'relative',
      overflow: 'hidden',
      minWidth: '0',
      minHeight: '0',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    };

    // Apply the styles to each sub-view div
    Object.assign(axialDiv.style, viewStyle);
    Object.assign(coronalDiv.style, viewStyle);
    Object.assign(sagittalDiv.style, viewStyle);

    // Name each div for a CSS grid area
    axialDiv.style.gridArea = 'axial';
    coronalDiv.style.gridArea = 'coronal';
    sagittalDiv.style.gridArea = 'sagittal';

    // Apply requested layout. If not specified, keep the legacy 'left-tall' layout.
    const viewerContainer = this.container;
    viewerContainer.style.display = 'grid';
    viewerContainer.style.width = '100%';
    viewerContainer.style.height = '100%';
    const layout = this.options.layout ?? 'left-tall';
    if (layout === 'top-bottom') {
      // Axial spans entire top row; sagittal/coronal on bottom row
      viewerContainer.style.gridTemplateAreas = `
        "axial axial"
        "sagittal coronal"
      `;
      // Track sizes follow content; we then center the grid as a whole.
      // This keeps sagittal/coronal tight with only the configured gap between them.
      viewerContainer.style.gridTemplateColumns = 'max-content max-content';
      viewerContainer.style.gridTemplateRows = 'max-content max-content';
      viewerContainer.style.justifyContent = 'center';
      viewerContainer.style.alignContent = 'center';
      viewerContainer.style.alignItems = 'center';
      viewerContainer.style.justifyItems = 'center';
    } else {
      // Legacy default: axial tall on left; coronal top-right; sagittal bottom-right
      viewerContainer.style.gridTemplateAreas = `
        "axial coronal"
        "axial sagittal"
      `;
      // Use fractional units to properly fill the container
      viewerContainer.style.gridTemplateColumns = '1fr 1fr';
      viewerContainer.style.gridTemplateRows = '1fr 1fr';
      viewerContainer.style.justifyContent = 'stretch';
      viewerContainer.style.alignContent = 'stretch';
      viewerContainer.style.alignItems = 'stretch';
      viewerContainer.style.justifyItems = 'stretch';
    }
    const gap = this.options.gapPx ?? 12;
    viewerContainer.style.gap = `${gap}px`;

    // For left-tall layout, ensure divs fill their grid cells
    if (layout !== 'top-bottom') {
      [axialDiv, coronalDiv, sagittalDiv].forEach(div => {
        div.style.width = '100%';
        div.style.height = '100%';
      });
    }

    // Add the new sub-view divs to the container
    viewerContainer.appendChild(axialDiv);
    viewerContainer.appendChild(coronalDiv);
    viewerContainer.appendChild(sagittalDiv);

    // Store references in a dictionary keyed by the ViewName enum
    this.viewDivs = {
      [ViewName.Axial]: axialDiv,
      [ViewName.Coronal]: coronalDiv,
      [ViewName.Sagittal]: sagittalDiv,
    };

    // Set up focus tracking for keyboard navigation
    // Make divs focusable and add mouse enter handlers
    Object.entries(this.viewDivs).forEach(([viewName, div]) => {
      const view = viewName as ViewName;

      // Make div focusable (allows visual focus, though we use hover for keyboard focus)
      div.tabIndex = 0;

      // Track focus via mouse enter for keyboard navigation
      div.addEventListener('mouseenter', () => {
        this.setFocusedView(view);
      });

      // Optional: Add visual focus indicator styles
      div.addEventListener('mouseenter', () => {
        div.style.outline = '2px solid rgba(100, 150, 255, 0.6)';
      });

      div.addEventListener('mouseleave', () => {
        div.style.outline = '';
      });
    });
  }

  /**
   * Programmatically set the shared world coordinate for all sub-views.
   */
  @action
  public setWorldCoord(coord: number[]): void {
    this.setAllViewersPosition(coord);
    this.currentCoord = coord.slice();
  }

  /**
   * Creates a SliceViewer for each orientation (axial, coronal, sagittal),
   * connecting them to the same ImageLayer. Also sets up reaction watchers
   * to keep them in sync.
   */
  private async initializeViewers(): Promise<void> {
    // For each axis set in this.axesSets, we create a corresponding SliceViewer
    const baseVolStack = this.imageLayer.getVolStack();
    const creationPromises = Object.entries(this.axesSets).map(async ([viewKey, axesSet]) => {
      const viewName = viewKey as ViewName;
      const domElement = this.viewDivs[viewName];

      // Each view receives its own ImageLayer instance so renders do not clobber other views
      const viewImageLayer = new ImageLayer(baseVolStack);
      viewImageLayer.initialize();
      this.perViewImageLayers[viewName] = viewImageLayer;

      const viewer = await SliceViewer.create(domElement, viewImageLayer, axesSet, {
        showCrosshair: this.options.showCrosshair,
        showSlider: this.options.showSlider,
      });
      this.sliceViewers[viewName] = viewer;

      // Observe changes in each viewer's internal state
      this.setupViewerReactions(viewName, viewer);

    });

    // Wait for all three sub-viewers to be created
    await Promise.all(creationPromises);

    // After creation, set them all to the same initial currentCoord
    this.setAllViewersPosition(this.currentCoord);
  }

  /**
   * Sets up a global reaction so if our shared currentCoord changes, 
   * all sub-viewers are updated to match.
   */
  private setupReactions(): void {
    // Reaction: watch currentCoord in this OrthogonalImageViewer
    // and call setAllViewersPosition() when it changes.
    const coordDisposer = reaction(
      () => this.currentCoord.slice(), // track changes by copying array
      (coord) => {
        this.setAllViewersPosition(coord);
      }
    );
    this.disposers.push(coordDisposer);

    
  }

  /**
   * Sets up watchers on each sub-viewer so that if it changes coordinate or mouse
   * state, we reflect that in the shared state here. This ensures that interacting
   * with one view updates the others.
   */
  private setupViewerReactions(viewName: ViewName, viewer: SliceViewer): void {
    // 1) Whenever the sub-viewer's model.currentCoord changes,
    //    see if it's different from our shared currentCoord. If so, update ours.
    const coordDisposer = reaction(
      () => viewer.model.currentCoord.slice(),
      (coord) => {
        if (!this.positionsAreEqual(this.currentCoord, coord)) {
          this.setCurrentCoord(coord, viewName); // Update the global coordinate
        } else {
        }
      }
    );
    this.disposers.push(coordDisposer);

    // 2) Watch for mouse state changes in the sub-viewer (image & volume coords).
    const mouseImagePositionDisposer = reaction(
      () => viewer.mouseImagePosition,
      (imagePosition) => {
        this.updateMouseState(viewName, imagePosition, viewer.mouseVolumeCoordinate, viewer.mouseWorldCoordinate);
      }
    );
    this.disposers.push(mouseImagePositionDisposer);

    const mouseVolumeCoordinateDisposer = reaction(
      () => viewer.mouseVolumeCoordinate?.slice() || null,
      (volumeCoordinate) => {
        this.updateMouseState(viewName, viewer.mouseImagePosition, volumeCoordinate, viewer.mouseWorldCoordinate);
      }
    );
    this.disposers.push(mouseVolumeCoordinateDisposer);

    const mouseWorldDisposer = reaction(
      () => viewer.mouseWorldCoordinate?.slice() || null,
      (worldCoord) => {
        this.updateMouseState(
          viewName,
          viewer.mouseImagePosition,
          viewer.mouseVolumeCoordinate,
          worldCoord
        );
      }
    );
    this.disposers.push(mouseWorldDisposer);
  }

  /**
   * Toggle crosshair overlay at runtime across all sub-views.
   */
  public setCrosshairVisible(visible: boolean): void {
    Object.values(this.sliceViewers).forEach(v => v.setCrosshairVisible(visible));
  }

  /**
   * Writes a new shared currentCoord, typically after receiving a sub-viewer's updated coordinate.
   * @param coord The newly updated coordinate from one sub-view.
   * @param sourceView The name of the sub-view that triggered the change (if any).
   */
  @action
  private setCurrentCoord(coord: number[], sourceView: ViewName): void {
    this.currentCoord = coord.slice();
  }

  /**
   * Checks if two coordinate arrays are approximately equal within epsilon tolerance.
   * Uses epsilon comparison to handle floating-point precision issues.
   */
  private positionsAreEqual(coord1: number[], coord2: number[]): boolean {
    return arraysNearlyEqual(coord1, coord2, COORDINATE_EPSILON);
  }

  /**
   * Updates all sub-viewers' positions (currentCoord) to match the provided coordinate,
   * skipping the sub-view that originated the change (if specified).
   */
  @action
  private setAllViewersPosition(coord: number[], sourceView?: ViewName): void {
    Object.entries(this.sliceViewers).forEach(([viewName, viewer]) => {
      if (viewName !== sourceView) {
        if (!this.positionsAreEqual(viewer.model.currentCoord, coord)) {
          viewer.setPosition(coord);
        } else {
        }
      }
    });
  }

  /**
   * Handler for resizing events, which instructs each sub-viewer to update
   * its internal PIXI canvas size and re-fit images.
   */
  private handleResize(): void {
    this.applyResponsiveLayout();

    Object.values(this.sliceViewers).forEach((viewer) => {
      viewer.handleResize();
    });
  }

  /**
   * Handler for keyboard events to navigate slices with arrow keys.
   * Left arrow: previous slice, Right arrow: next slice
   * Only affects the currently focused view.
   */
  private handleKeydown(e: KeyboardEvent): void {
    if (!this.focusedView) return;

    const viewer = this.sliceViewers[this.focusedView];
    if (!viewer) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        viewer.model.previousSlice();
        break;
      case 'ArrowRight':
        e.preventDefault();
        viewer.model.nextSlice();
        break;
    }
  }

  /**
   * Sets which view receives keyboard input for slice navigation.
   * @param viewName - The view to focus ('axial', 'coronal', or 'sagittal')
   */
  @action
  public setFocusedView(viewName: ViewName | null): void {
    this.focusedView = viewName;
  }

  private applyResponsiveLayout(): void {
    if (!this.container || !this.container.isConnected) {
      return;
    }

    const layoutMode = this.options.layout ?? 'left-tall';
    if (layoutMode !== 'top-bottom') {
      return;
    }

    const containerWidth = this.container.clientWidth;
    const containerHeight = this.container.clientHeight;
    if (containerWidth <= 0 || containerHeight <= 0) {
      return;
    }

    const gap = this.options.gapPx ?? 12;
    const axialBase = this.baseViewSizes[ViewName.Axial];
    const sagittalBase = this.baseViewSizes[ViewName.Sagittal];
    const coronalBase = this.baseViewSizes[ViewName.Coronal];

    const usableWidth = Math.max(1, containerWidth - gap);
    const usableHeight = Math.max(1, containerHeight - gap);

    const widthLimitAxial = axialBase.width > 0 ? containerWidth / axialBase.width : Number.POSITIVE_INFINITY;
    const widthLimitBottom = (sagittalBase.width + coronalBase.width) > 0
      ? usableWidth / (sagittalBase.width + coronalBase.width)
      : Number.POSITIVE_INFINITY;
    const heightLimit = axialBase.height + Math.max(sagittalBase.height, coronalBase.height) > 0
      ? usableHeight / (axialBase.height + Math.max(sagittalBase.height, coronalBase.height))
      : Number.POSITIVE_INFINITY;

    const limitedScale = Math.min(widthLimitAxial, widthLimitBottom, heightLimit);
    const scale = Math.max(0.01, Number.isFinite(limitedScale) && limitedScale > 0 ? limitedScale : 1);

    const axialSize = {
      width: axialBase.width * scale,
      height: axialBase.height * scale,
    };
    const sagittalSize = {
      width: sagittalBase.width * scale,
      height: sagittalBase.height * scale,
    };
    const coronalSize = {
      width: coronalBase.width * scale,
      height: coronalBase.height * scale,
    };

    const clampSize = (value: number) => `${Math.max(1, Math.round(value))}px`;

    this.viewDivs[ViewName.Axial].style.width = clampSize(axialSize.width);
    this.viewDivs[ViewName.Axial].style.height = clampSize(axialSize.height);

    this.viewDivs[ViewName.Sagittal].style.width = clampSize(sagittalSize.width);
    this.viewDivs[ViewName.Sagittal].style.height = clampSize(sagittalSize.height);

    this.viewDivs[ViewName.Coronal].style.width = clampSize(coronalSize.width);
    this.viewDivs[ViewName.Coronal].style.height = clampSize(coronalSize.height);
  }

  /**
   * Gets the underlying ImageLayer used by these sub-viewers,
   * which provides the actual volume data stack.
   */
  getImageLayer(): ImageLayer {
    return this.imageLayer;
  }

  public applyToImageLayers(handler: (layer: ImageLayer) => void): void {
    handler(this.imageLayer);
    Object.values(this.perViewImageLayers).forEach(layer => {
      if (layer) handler(layer);
    });
  }

  /**
   * Retrieves the SliceViewer corresponding to one of the standard views.
   * 
   * @param viewName - e.g. 'axial', 'coronal', or 'sagittal'.
   */
  public getSliceViewer(viewName: 'axial' | 'coronal' | 'sagittal'): SliceViewer {
    return this.sliceViewers[viewName];
  }

  /**
   * Cleans up all sub-viewers and DOM elements, removing them from the container,
   * and unsubscribes from MobX reactions.
   */
  public dispose(): void {
    // Dispose each sub-viewer
    Object.values(this.sliceViewers).forEach((viewer) => {
      viewer.dispose();
    });

    // Remove their container elements
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    window.removeEventListener('resize', this.handleResizeBound);
    document.removeEventListener('keydown', this.handleKeydownBound);
    try { this.resizeObserver?.disconnect(); } catch {}

    // Dispose all reactive watchers
    this.disposers.forEach((disposer) => disposer());
    this.disposers = [];
  }

  /**
   * Tracks changes from each sub-viewer's pointer event, storing them in _mouseState.
   */
  @action
  private updateMouseState(
    viewName: ViewName,
    imageCoordinate: { x: number; y: number } | null,
    volumeCoordinate: number[] | null,
    worldCoordinate: number[] | null  // <-- new
  ) {
    const sanitizePt = (pt: { x: number; y: number } | null) =>
      pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) ? pt : null;
    const sanitizeVec = (v: number[] | null) =>
      v && v.length === 3 && v.every(Number.isFinite) ? v : null;
    this._mouseState = {
      viewName,
      imageCoordinate: sanitizePt(imageCoordinate),
      volumeCoordinate: sanitizeVec(volumeCoordinate),
      worldCoordinate: sanitizeVec(worldCoordinate),
    };
  }

  /**
   * Exposes the current mouse state as a computed property for external read-only usage.
   * This includes which sub-view triggered it, the 2D image coordinate, and the 3D volume coordinate.
   */
  @computed
  get mouseState() {
    return {
      viewName: this._mouseState.viewName,
      imageCoordinate: this._mouseState.imageCoordinate,
      volumeCoordinate: this._mouseState.volumeCoordinate,
      worldCoordinate: this._mouseState.worldCoordinate,
    };
  }

  /**
   * Returns an object with slice indices for each view.
   */
  @computed
  get sliceIndices(): Record<ViewName, number> {
    const indices: Record<ViewName, number> = {
      [ViewName.Axial]: this.sliceViewers[ViewName.Axial].currentSliceIndex,
      [ViewName.Coronal]: this.sliceViewers[ViewName.Coronal].currentSliceIndex,
      [ViewName.Sagittal]: this.sliceViewers[ViewName.Sagittal].currentSliceIndex,
    };
    return indices;
  }
  
  /**
   * Returns the total number of slices available in each view.
   */
  @computed
  get totalSlices(): Record<ViewName, number> {
    const totalSlices: Record<ViewName, number> = {
      [ViewName.Axial]: this.sliceViewers[ViewName.Axial].model.totalSlices,
      [ViewName.Coronal]: this.sliceViewers[ViewName.Coronal].model.totalSlices,
      [ViewName.Sagittal]: this.sliceViewers[ViewName.Sagittal].model.totalSlices,
    };
    return totalSlices;
  }
  
  /**
   * Returns the view orientation information for each view.
   */
  @computed
  get viewOrientation(): Record<ViewName, any> {
    return this.axesSets;
  }
  
  /**
   * Returns the current scale/zoom level for each view.
   */
  @computed
  get scale(): Record<ViewName, number> {
    const scales: Record<ViewName, number> = {
      [ViewName.Axial]: this.sliceViewers[ViewName.Axial].scale,
      [ViewName.Coronal]: this.sliceViewers[ViewName.Coronal].scale,
      [ViewName.Sagittal]: this.sliceViewers[ViewName.Sagittal].scale,
    };
    return scales;
  }
  
  /**
   * Identifies this as an orthogonal viewer.
   */
  @computed
  get viewerType(): string {
    return 'orthogonal';
  }
  
  /**
   * Returns information about visible layers.
   */
  @computed
  get visibleLayers(): Array<{ id: string; visible: boolean; opacity?: number }> {
    // Get layer IDs from the image layer
    const layerIds = this.imageLayer.getLayerIds();
    
    // Map to the required format
    return layerIds.map((id: string) => {
      // Get the layer to access its properties
      const layer = this.imageLayer.getVolStack().getLayerById(id);
      return {
        id,
        visible: true, // Assuming all layers in the stack are visible
        opacity: layer ? layer.opacity : 1.0
      };
    });
  }
}
