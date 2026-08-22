/**
 * Common interface for providing state information from neuroimaging viewers
 * to support UI components like the StatusBar. This allows components to access
 * essential viewer state without depending on specific viewer implementations.
 */
import type { AxisSet3D } from '../geometry/Axis';

export interface ViewerStateInfo {
  /**
   * Current 3D coordinate position in the volume.
   * This is typically the focal point or crosshair position.
   */
  readonly currentCoord: number[];

  /**
   * Information about the current mouse position and related coordinates.
   * Contains details about which view the mouse is over and coordinates
   * in both 2D (image) and 3D (volume) space.
   */
  readonly mouseState: {
    viewName: string | null;
    imageCoordinate: { x: number; y: number } | null;
    volumeCoordinate: number[] | null;
    worldCoordinate: number[] | null; // World coordinate in the original NeuroSpace
  };

  /**
   * Information about current slice indices in different orientations.
   * For single-slice viewers, this may have only one relevant property.
   * For orthogonal viewers, it has properties for each orientation.
   */
  readonly sliceIndices: Record<string, number>;
  
  /**
   * Information about the total number of slices available in each view.
   * For single-slice viewers, this may have only one property.
   * For orthogonal viewers, it has properties for each orientation.
   */
  readonly totalSlices?: Record<string, number>;
  
  /**
   * The axis orientation(s) currently being displayed.
   * For SliceViewer, this is a single AxisSet3D.
   * For OrthogonalImageViewer, this could be a record of orientations by view name.
   */
  readonly viewOrientation?: AxisSet3D | Record<string, AxisSet3D>;
  
  /**
   * The current scaling/zoom level of the viewer(s).
   * For single-slice viewers, this is a single value.
   * For orthogonal viewers, it may have multiple values by view name.
   */
  readonly scale?: number | Record<string, number>;
  
  /**
   * Identifies the type of viewer.
   * Useful for UI components that need to adapt based on viewer type.
   */
  readonly viewerType: 'slice' | 'orthogonal' | string;
  
  /**
   * Information about which layers are currently visible/active.
   * This can include layer IDs, opacity values, etc.
   */
  readonly visibleLayers?: Array<{
    id: string;
    visible: boolean;
    opacity?: number;
  }>;
}
