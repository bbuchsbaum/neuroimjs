import { AxisSet3D } from '../geometry/Axis';
import { SliceViewer } from './SliceViewer';
import { ImageLayer } from './ImageLayer';
import { OrientationLabelOptions } from './OrientationLabelLayer';
import type { CrossHairOptions } from './CrossHair';
import { observable, action, makeObservable, computed, reaction, IReactionDisposer, makeAutoObservable } from 'mobx';
import { ViewerStateInfo } from './ViewerStateInfo';
import { arraysNearlyEqual, COORDINATE_EPSILON } from './NumericalUtils';

/**
 * Enumerates the names for the three standard orthogonal views:
 *   - Axial
 *   - Coronal
 *   - Sagittal
 */
export enum ViewName {
  Axial = 'axial',
  Coronal = 'coronal',
  Sagittal = 'sagittal',
}

/**
 * Optional configuration for how each orthogonal viewer is displayed and operated.
 */
export interface OrthogonalImageViewerOptions {
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
   * Whether to display anatomical orientation labels (L/R/A/P/S/I) at the edges
   * of each sub-view. Labels are fixed-size and pinned to the viewport.
   */
  showOrientationLabels?: boolean;

  /**
   * Styling for the orientation labels. Only used when
   * {@link showOrientationLabels} is true.
   */
  orientationLabelOptions?: OrientationLabelOptions;

  /**
   * Whether to display a slider in each sub-viewer for changing slice indices.
   */
  showSlider?: boolean;

  /**
   * Layout mode for arranging the three views.
   * - 'left-tall': axial occupies left column (both rows); coronal/sagittal on right (default, current)
   * - 'top-bottom': axial spans full width on top; sagittal and coronal split bottom row horizontally
   * - 'ortho': aligned 2x2 (coronal | sagittal / axial | legend). Tracks are sized from the
   *   volume extents so all three views share one scale and the crosshair lines continue
   *   across neighbouring views. The fourth cell is an empty host element, see
   *   {@link OrthogonalImageViewer.getLegendElement}.
   */
  layout?: 'left-tall' | 'top-bottom' | 'ortho';

  /** Crosshair styling (colour, alpha, width and gap in screen px). */
  crosshairOptions?: CrossHairOptions;

  /** Canvas clear colour for every view (PIXI numeric colour). Default 0x000000. */
  backgroundColor?: number;

  /**
   * Space kept clear around each slice inside its cell, in screen px (room for
   * orientation labels). In the 'ortho' layout the tracks absorb it, so all
   * views keep one shared scale. Default 0.
   */
  cellPaddingPx?: number;

  /**
   * 'ortho' layout only: below this container width (px) the views stack in one
   * column (coronal, sagittal, axial, legend) at a shared scale instead of
   * shrinking the 2x2 grid. 0 disables stacking. Default 0.
   */
  stackBelowPx?: number;

  /** 'ortho' layout only: height of the legend row when stacked. Default 176. */
  stackedLegendHeightPx?: number;

  /**
   * 'ortho' layout only: when stacked, show every view in a column ('column')
   * or one view at a time ('single', switch with setStackedView). Default 'column'.
   */
  stackMode?: 'column' | 'single';

  /**
   * CSS outline drawn on the hovered view, or null for none (hosts can style
   * `[data-nij-hover]` instead). Default '2px solid rgba(100, 150, 255, 0.6)'.
   */
  focusOutline?: string | null;

  /**
   * CSS gap between grid cells, in pixels (default: '8px').
   */
  gapPx?: number;
}

/**
 * Parameters required to instantiate the OrthogonalImageViewer.
 */
export interface OrthogonalImageViewerParams {
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
  private legendDiv: HTMLElement | null = null;
  private stackedView: ViewName = ViewName.Coronal;
  private fitBounds: { min: number[]; max: number[] } | null = null;

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
    if (layout === 'ortho') {
      viewerContainer.style.gridTemplateAreas = `
        "coronal sagittal"
        "axial legend"
      `;
      const ext = this.orthoExtents();
      viewerContainer.style.gridTemplateColumns = `${ext.lr}fr ${ext.ap}fr`;
      viewerContainer.style.gridTemplateRows = `${ext.si}fr ${ext.ap}fr`;
      viewerContainer.style.height = 'auto';
      viewerContainer.style.justifyContent = 'stretch';
      viewerContainer.style.alignContent = 'stretch';
      viewerContainer.style.alignItems = 'stretch';
      viewerContainer.style.justifyItems = 'stretch';
      const legend = document.createElement('div');
      legend.style.gridArea = 'legend';
      legend.style.minWidth = '0';
      legend.style.minHeight = '0';
      legend.style.position = 'relative';
      legend.dataset.nijLegend = '';
      this.legendDiv = legend;
    } else if (layout === 'top-bottom') {
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

    // For left-tall and ortho layouts, ensure divs fill their grid cells
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
    if (this.legendDiv) viewerContainer.appendChild(this.legendDiv);

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

      // Optional: Add visual focus indicator styles.
      // Use a negative outline-offset so the ring is drawn *inside* the panel's
      // edges. A plain outline sits outside the box and gets clipped by the
      // surrounding container/card on whichever side is flush against it,
      // leaving only three of the four sides visible.
      const outline = this.options.focusOutline === undefined
        ? '2px solid rgba(100, 150, 255, 0.6)'
        : this.options.focusOutline;
      div.dataset.nijView = view;
      div.addEventListener('mouseenter', () => {
        div.dataset.nijHover = '';
        if (outline) {
          div.style.outline = outline;
          div.style.outlineOffset = '-2px';
        }
      });

      div.addEventListener('mouseleave', () => {
        delete div.dataset.nijHover;
        if (outline) {
          div.style.outline = '';
          div.style.outlineOffset = '';
        }
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
        crosshairOptions: this.options.crosshairOptions,
        backgroundColor: this.options.backgroundColor,
        fitPadding: this.options.cellPaddingPx,
      });
      this.sliceViewers[viewName] = viewer;

      // Add orientation labels if requested
      if (this.options.showOrientationLabels) {
        viewer.setOrientationLabelsVisible(true, this.options.orientationLabelOptions);
      }

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
   * In-plane extents, in voxels, of the left-right, anterior-posterior and
   * superior-inferior axes (the same units SliceView fits to its viewport).
   */
  private orthoExtents(): { lr: number; ap: number; si: number } {
    const space = this.imageLayer.getVolStack().getLayer(0).space;
    const fb = this.fitBounds;
    const dimOf = (axis: any) => {
      const d = space.whichDim(axis);
      return fb ? fb.max[d] - fb.min[d] + 1 : space.dim[d];
    };
    return {
      lr: dimOf(this.axesSets[ViewName.Coronal].i),
      si: dimOf(this.axesSets[ViewName.Coronal].j),
      ap: dimOf(this.axesSets[ViewName.Sagittal].i),
    };
  }

  /**
   * The empty fourth cell of the 'ortho' layout, for a host-supplied legend or
   * readout. Null for other layouts.
   */
  public getLegendElement(): HTMLElement | null {
    return this.legendDiv;
  }

  /**
   * Fits every view to a 3-D box of reference-grid voxel indices (inclusive),
   * e.g. the head's bounding box, instead of the full field of view. In the
   * 'ortho' layout the tracks follow the box's extents, so all views keep one
   * shared scale. Pass null to fit the whole volume again.
   */
  public setFitBounds(bounds: { min: number[]; max: number[] } | null): void {
    const space = this.imageLayer.getVolStack().getLayer(0).space;
    if (bounds) {
      const min = bounds.min.map((v, d) => Math.max(0, Math.min(space.dim[d] - 1, Math.floor(v))));
      const max = bounds.max.map((v, d) => Math.max(min[d], Math.min(space.dim[d] - 1, Math.ceil(v))));
      this.fitBounds = { min, max };
    } else {
      this.fitBounds = null;
    }
    this.applyFitRegions();
    this.handleResize();
  }

  /**
   * Projects the 3-D fit box into each view's image-content space through that
   * view's own transform (so axis flips are respected) and hands it to the view.
   */
  private applyFitRegions(): void {
    const fb = this.fitBounds;
    (Object.keys(this.sliceViewers) as ViewName[]).forEach(view => {
      const sliceView = (this.sliceViewers[view] as any)?.view;
      if (!sliceView || typeof sliceView.setFitRegion !== 'function') return;
      if (!fb) {
        sliceView.setFitRegion(null);
        return;
      }
      const transformer = sliceView.getCoordinateTransformer?.();
      if (!transformer || typeof transformer.volumeToLocalSliceCoord !== 'function') return;
      const xs: number[] = [];
      const ys: number[] = [];
      // Project voxel indices (not edges): a flipped axis maps index v to
      // dim-1-v, so the pixel span is [min projected, max projected + 1).
      for (const i of [fb.min[0], fb.max[0]]) {
        for (const j of [fb.min[1], fb.max[1]]) {
          for (const k of [fb.min[2], fb.max[2]]) {
            const p = transformer.volumeToLocalSliceCoord([i, j, k]);
            xs.push(p.x);
            ys.push(p.y);
          }
        }
      }
      sliceView.setFitRegion({
        x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1,
      });
    });
  }

  /**
   * Chooses the view shown when the 'ortho' layout is stacked in 'single' mode.
   */
  public setStackedView(view: ViewName | 'axial' | 'coronal' | 'sagittal'): void {
    this.stackedView = view as ViewName;
    this.handleResize();
  }

  /** Whether the 'ortho' layout is currently stacked (narrow container). */
  public isStacked(): boolean {
    return this.container?.dataset.nijStacked !== undefined;
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

  /**
   * Toggle anatomical orientation labels (L/R/A/P/S/I) across all three views.
   *
   * @param visible - Whether the labels should be shown.
   * @param options - Optional styling applied to every sub-view.
   */
  public setOrientationLabelsVisible(visible: boolean, options?: OrientationLabelOptions): void {
    Object.values(this.sliceViewers).forEach((viewer) => {
      viewer.setOrientationLabelsVisible(visible, options);
    });
  }

  private applyResponsiveLayout(): void {
    if (!this.container || !this.container.isConnected) {
      return;
    }

    const layoutMode = this.options.layout ?? 'left-tall';
    if (layoutMode === 'ortho') {
      // Size the tracks in px from one shared px-per-voxel scale s, so each
      // view's fit (content + padding on both sides) resolves to exactly s:
      //   columns: lr*s + 2p | ap*s + 2p      rows: si*s + 2p | ap*s + 2p
      const width = this.container.clientWidth;
      const stackBelow = this.options.stackBelowPx ?? 0;
      if (width > 0 && width < stackBelow) {
        // One column: every view shares the scale that fits the widest extent.
        const gap = this.options.gapPx ?? 12;
        const pad = this.options.cellPaddingPx ?? 0;
        const ext = this.orthoExtents();
        const s = Math.max(0.01, (width - 2 * pad) / Math.max(ext.lr, ext.ap));
        const legendH = this.options.stackedLegendHeightPx ?? 176;
        const viewH: Record<ViewName, number> = {
          [ViewName.Coronal]: ext.si * s + 2 * pad,
          [ViewName.Sagittal]: ext.si * s + 2 * pad,
          [ViewName.Axial]: ext.ap * s + 2 * pad,
        };
        let shown: ViewName[] = [ViewName.Coronal, ViewName.Sagittal, ViewName.Axial];
        if ((this.options.stackMode ?? 'column') === 'single') shown = [this.stackedView];
        (Object.keys(this.viewDivs) as ViewName[]).forEach(v => {
          const display = shown.includes(v) ? '' : 'none';
          if (this.viewDivs[v].style.display !== display) this.viewDivs[v].style.display = display;
        });
        const heights = [...shown.map(v => viewH[v]), legendH];
        const areas = [...shown, 'legend'].map(a => `"${a}"`).join(' ');
        const rows = heights.map(h => `${h.toFixed(2)}px`).join(' ');
        const height = `${Math.round(heights.reduce((a, b) => a + b, 0) + (heights.length - 1) * gap)}px`;
        if (this.container.style.gridTemplateAreas !== areas) this.container.style.gridTemplateAreas = areas;
        if (this.container.style.gridTemplateColumns !== '100%') this.container.style.gridTemplateColumns = '100%';
        if (this.container.style.gridTemplateRows !== rows) this.container.style.gridTemplateRows = rows;
        if (this.container.style.height !== height) this.container.style.height = height;
        this.container.dataset.nijStacked = '';
        return;
      }
      delete this.container.dataset.nijStacked;
      (Object.keys(this.viewDivs) as ViewName[]).forEach(v => {
        if (this.viewDivs[v].style.display === 'none') this.viewDivs[v].style.display = '';
      });
      const gridAreas = '"coronal sagittal" "axial legend"';
      if (this.container.style.gridTemplateAreas !== gridAreas) this.container.style.gridTemplateAreas = gridAreas;
      if (width > 0) {
        const gap = this.options.gapPx ?? 12;
        const pad = this.options.cellPaddingPx ?? 0;
        const ext = this.orthoExtents();
        const s = Math.max(0.01, (width - gap - 4 * pad) / (ext.lr + ext.ap));
        const col1 = ext.lr * s + 2 * pad;
        const col2 = width - gap - col1;
        const row1 = ext.si * s + 2 * pad;
        const row2 = ext.ap * s + 2 * pad;
        const cols = `${col1.toFixed(2)}px ${col2.toFixed(2)}px`;
        const rows = `${row1.toFixed(2)}px ${row2.toFixed(2)}px`;
        const height = `${Math.round(row1 + row2 + gap)}px`;
        if (this.container.style.gridTemplateColumns !== cols) this.container.style.gridTemplateColumns = cols;
        if (this.container.style.gridTemplateRows !== rows) this.container.style.gridTemplateRows = rows;
        if (this.container.style.height !== height) this.container.style.height = height;
      }
      return;
    }
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
    // PIXI's text TexturePool is shared across renderers. Release every
    // sub-view's overlay Text resources before destroying the first renderer,
    // which clears that shared pool.
    Object.values(this.sliceViewers).forEach((viewer) => {
      viewer.view.disposeLayers?.();
    });

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
