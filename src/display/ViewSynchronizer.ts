// File: src/display/ViewSynchronizer.ts

import { SingleSliceViewer } from './SingleSliceViewer';
import { arraysNearlyEqual, COORDINATE_EPSILON } from './NumericalUtils';

/**
 * Options for ViewSynchronizer behavior
 */
export interface ViewSynchronizerOptions {
  /**
   * Synchronize on hover (pointer move) events
   * Default: false (only sync on clicks)
   */
  syncOnHover?: boolean;

  /**
   * Epsilon tolerance for coordinate comparisons
   * Default: COORDINATE_EPSILON
   */
  epsilon?: number;

  /**
   * Whether to sync immediately when views are added
   * If true, all views will be set to the first view's coordinate
   * Default: false
   */
  syncOnAdd?: boolean;
}

/**
 * Manages synchronization of coordinates across multiple SingleSliceViewer instances.
 *
 * This class allows you to create custom layouts with arbitrary numbers of views
 * and control how they synchronize. You can sync on hover or only on clicks,
 * add/remove views dynamically, and temporarily disable synchronization.
 *
 * @example
 * ```typescript
 * // Create a synchronizer that syncs on click only
 * const sync = new ViewSynchronizer({ syncOnHover: false });
 *
 * // Add views
 * const axial = await SingleSliceViewer.createAxial(axialContainer, volStack);
 * const sagittal = await SingleSliceViewer.createSagittal(sagContainer, volStack);
 *
 * sync.addView('axial', axial);
 * sync.addView('sagittal', sagittal);
 *
 * // Now clicks in one view will update the other
 * // You can also programmatically sync a coordinate across all views:
 * sync.syncCoordinate([50, 60, 70]);
 * ```
 */
export class ViewSynchronizer {
  /**
   * Map of view IDs to viewer instances
   */
  private readonly views: Map<string, SingleSliceViewer> = new Map();

  /**
   * Map of view IDs to their cleanup functions
   */
  private readonly cleanupFunctions: Map<string, (() => void)[]> = new Map();

  /**
   * Configuration options
   */
  private readonly options: Required<ViewSynchronizerOptions>;

  /**
   * Whether synchronization is currently enabled
   */
  private enabled: boolean = true;

  /**
   * The ID of the view that is currently updating (to prevent circular updates)
   */
  private updatingViewId: string | null = null;

  /**
   * Create a new ViewSynchronizer
   *
   * @param options - Configuration options
   */
  constructor(options?: ViewSynchronizerOptions) {
    this.options = {
      syncOnHover: options?.syncOnHover ?? false,
      epsilon: options?.epsilon ?? COORDINATE_EPSILON,
      syncOnAdd: options?.syncOnAdd ?? false
    };
  }

  /**
   * Add a view to the synchronization group
   *
   * @param viewId - Unique identifier for this view
   * @param viewer - The SingleSliceViewer instance to add
   */
  public addView(viewId: string, viewer: SingleSliceViewer): void {
    if (this.views.has(viewId)) {
      throw new Error(`View with ID "${viewId}" already exists in synchronizer`);
    }

    // Store the view
    this.views.set(viewId, viewer);

    // If syncOnAdd is true and this isn't the first view, sync to existing coordinate
    if (this.options.syncOnAdd && this.views.size > 1) {
      // Get the first view's coordinate
      const firstViewer = Array.from(this.views.values())[0];
      const coord = firstViewer.getCurrentCoord();
      viewer.setCoord(coord);
    }

    // Set up synchronization listeners
    const cleanups: (() => void)[] = [];

    // Always listen to coordinate changes (for programmatic updates)
    const coordCleanup = viewer.onCoordChange(coord => {
      if (this.enabled && this.updatingViewId !== viewId) {
        this.syncCoordinateFromView(viewId, coord);
      }
    });
    cleanups.push(coordCleanup);

    // Listen to pointer down (click) events
    const clickCleanup = viewer.onPointerDown(({ worldCoord }) => {
      if (this.enabled && worldCoord) {
        this.syncCoordinateFromView(viewId, worldCoord);
      }
    });
    cleanups.push(clickCleanup);

    // Optionally listen to hover events
    if (this.options.syncOnHover) {
      const hoverCleanup = viewer.onPointerMove(({ worldCoord }) => {
        if (this.enabled && worldCoord) {
          this.syncCoordinateFromView(viewId, worldCoord);
        }
      });
      cleanups.push(hoverCleanup);
    }

    // Store cleanup functions
    this.cleanupFunctions.set(viewId, cleanups);
  }

  /**
   * Remove a view from the synchronization group
   *
   * @param viewId - ID of the view to remove
   * @returns The removed viewer instance, or undefined if not found
   */
  public removeView(viewId: string): SingleSliceViewer | undefined {
    const viewer = this.views.get(viewId);

    if (viewer) {
      // Clean up event listeners
      const cleanups = this.cleanupFunctions.get(viewId);
      if (cleanups) {
        cleanups.forEach(cleanup => cleanup());
        this.cleanupFunctions.delete(viewId);
      }

      // Remove the view
      this.views.delete(viewId);
    }

    return viewer;
  }

  /**
   * Get a view by ID
   *
   * @param viewId - ID of the view to get
   * @returns The viewer instance, or undefined if not found
   */
  public getView(viewId: string): SingleSliceViewer | undefined {
    return this.views.get(viewId);
  }

  /**
   * Get all view IDs
   *
   * @returns Array of view IDs
   */
  public getViewIds(): string[] {
    return Array.from(this.views.keys());
  }

  /**
   * Check if a view exists
   *
   * @param viewId - ID to check
   * @returns True if the view exists
   */
  public hasView(viewId: string): boolean {
    return this.views.has(viewId);
  }

  /**
   * Get the number of views in the synchronizer
   *
   * @returns Number of views
   */
  public getViewCount(): number {
    return this.views.size;
  }

  /**
   * Programmatically sync a specific coordinate across all views
   *
   * @param coord - World coordinate [x, y, z] in mm
   */
  public syncCoordinate(coord: number[]): void {
    if (!this.enabled) {
      return;
    }

    // Update all views
    for (const [viewId, viewer] of this.views) {
      const currentCoord = viewer.getCurrentCoord();

      // Only update if coordinate is different (avoid redundant updates)
      if (!arraysNearlyEqual(currentCoord, coord, this.options.epsilon)) {
        // Mark as updating to prevent circular updates
        const previousUpdatingView = this.updatingViewId;
        this.updatingViewId = viewId;

        try {
          viewer.setCoord(coord);
        } finally {
          this.updatingViewId = previousUpdatingView;
        }
      }
    }
  }

  /**
   * Internal method to sync coordinate from a specific view to all others
   *
   * @param sourceViewId - ID of the view that triggered the sync
   * @param coord - Coordinate to sync
   */
  private syncCoordinateFromView(sourceViewId: string, coord: number[]): void {
    // Update all views except the source
    for (const [viewId, viewer] of this.views) {
      if (viewId === sourceViewId) {
        continue;
      }

      const currentCoord = viewer.getCurrentCoord();

      // Only update if coordinate is different
      if (!arraysNearlyEqual(currentCoord, coord, this.options.epsilon)) {
        // Mark as updating to prevent circular updates
        const previousUpdatingView = this.updatingViewId;
        this.updatingViewId = viewId;

        try {
          viewer.setCoord(coord);
        } finally {
          this.updatingViewId = previousUpdatingView;
        }
      }
    }
  }

  /**
   * Enable synchronization
   */
  public enable(): void {
    this.enabled = true;
  }

  /**
   * Disable synchronization (views will stop syncing)
   */
  public disable(): void {
    this.enabled = false;
  }

  /**
   * Check if synchronization is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Toggle synchronization on/off
   *
   * @returns The new enabled state
   */
  public toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /**
   * Remove all views and clean up resources
   */
  public dispose(): void {
    // Remove all views (this will clean up their listeners)
    const viewIds = Array.from(this.views.keys());
    for (const viewId of viewIds) {
      this.removeView(viewId);
    }
  }

  /**
   * Create a synchronizer with pre-configured views
   *
   * @param views - Map of view IDs to viewer instances
   * @param options - Configuration options
   * @returns A new ViewSynchronizer with the views already added
   */
  public static fromViews(
    views: Map<string, SingleSliceViewer> | Record<string, SingleSliceViewer>,
    options?: ViewSynchronizerOptions
  ): ViewSynchronizer {
    const sync = new ViewSynchronizer(options);

    // Convert Record to Map if needed
    const viewMap = views instanceof Map ? views : new Map(Object.entries(views));

    // Add all views
    for (const [viewId, viewer] of viewMap) {
      sync.addView(viewId, viewer);
    }

    return sync;
  }

  /**
   * Create a synchronizer for a standard orthogonal view setup
   *
   * @param axial - Axial view
   * @param sagittal - Sagittal view
   * @param coronal - Coronal view
   * @param options - Configuration options
   * @returns A new ViewSynchronizer with the three views
   */
  public static createOrthogonal(
    axial: SingleSliceViewer,
    sagittal: SingleSliceViewer,
    coronal: SingleSliceViewer,
    options?: ViewSynchronizerOptions
  ): ViewSynchronizer {
    return ViewSynchronizer.fromViews(
      { axial, sagittal, coronal },
      options
    );
  }
}
