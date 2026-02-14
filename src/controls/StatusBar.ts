/**
 * @file StatusBar.ts
 * 
 * This file defines the StatusBar web component that displays viewer state information
 * from SliceViewer or OrthogonalImageViewer. The StatusBar provides users with
 * real-time feedback about positions, coordinates, and slice information.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { reaction, IReactionDisposer } from 'mobx';
import { ViewerStateInfo } from '../display/ViewerStateInfo';

/**
 * The StatusBar component displays critical state information from neuroimaging viewers.
 * It shows five main pieces of information:
 * 1. Mouse Position - 2D pixel coordinates within the current slice view
 * 2. Volume Coordinate - 3D voxel coordinates in the volume coordinate system
 * 3. World Coordinate - 3D coordinates in the original world space (millimeters)
 * 4. Current Coord - The current 3D position (typically crosshair location)
 * 5. Slice Indices - Current slice number(s) being displayed
 *
 * This component works with both single-slice viewers (SliceViewer) and
 * orthogonal multi-view displays (OrthogonalImageViewer) by implementing
 * adaptive rendering based on the viewer type.
 */
@customElement('status-bar')
export class StatusBar extends LitElement {
  /**
   * The viewer property accepts any object that implements the ViewerStateInfo interface.
   * This allows the StatusBar to work with different viewer implementations like 
   * SliceViewer and OrthogonalImageViewer.
   */
  @property({ type: Object }) viewer!: ViewerStateInfo;

  /**
   * Array of disposer functions for MobX reactions.
   * These are used to clean up reactions when the component is disconnected.
   */
  private disposers: IReactionDisposer[] = [];

  /**
   * CSS styles for the StatusBar component.
   * Defines layout, spacing, colors, and typography for the status display.
   */
  static styles = css`
    .status-bar {
      display: flex;
      flex-direction: row; /* Arrange items horizontally */
      padding: 15px;
      background-color: #f0f0f0;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      font-family: Arial, sans-serif;
    }
    .status-item {
      margin: 0 10px; /* Add horizontal spacing */
      font-size: 13px;
    }
    .label {
      font-weight: bold;
      margin-right: 5px;
      color: #333;
    }
    .value {
      color: #0066cc;
    }
    .separator {
      color: #ccc;
      margin: 0 5px;
    }
  `;

  /**
   * Called when the component is added to the DOM.
   * Sets up MobX reactions if a viewer is available.
   */
  connectedCallback() {
    super.connectedCallback();
    if (this.viewer) {
      this.setupReactions();
    }
  }

  /**
   * Called when the component is removed from the DOM.
   * Cleans up MobX reactions to prevent memory leaks.
   */
  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanupReactions();
  }

  /**
   * Called when the component's properties change.
   * If the viewer property changes, sets up new reactions to track its state.
   * 
   * @param changedProperties - Map of properties that have changed
   */
  updated(changedProperties: Map<string, any>) {
    //console.log('StatusBar updated');
     //console.log('changedProperties:', Array.from(changedProperties.keys()));
    if (changedProperties.has('viewer') && this.viewer) {
      //console.log('Viewer set in StatusBar:', this.viewer);
      // console.log('Viewer type:', this.viewer.viewerType);
      this.setupReactions();
    }
  }

  /**
   * Sets up MobX reactions to update the UI when viewer state changes.
   * These reactions track changes to:
   * 1. Current 3D coordinates (focus point/crosshair position)
   * 2. Mouse state information (2D image coordinates and 3D volume coordinates)
   * 3. Slice indices (which slices are currently shown)
   */
  setupReactions() {
    // React to changes in the viewer's currentCoord
    // This coord represents the 3D focus point or crosshair position
    // - In SliceViewer: from model.currentCoord
    // - In OrthogonalImageViewer: stored directly as a class property
    this.disposers.push(
      reaction(
        () => this.viewer.currentCoord.slice(),
        () => this.requestUpdate()
      )
    );

    // React to changes in the viewer's mouse state
    // This includes 2D image coordinates and corresponding 3D volume coordinates
    // - In SliceViewer: from controller.mouseImagePosition and controller.mouseVolumeCoordinate
    // - In OrthogonalImageViewer: from _mouseState tracking which view the mouse is in
    this.disposers.push(
      reaction(
        () => this.viewer.mouseState,
        () => this.requestUpdate()
      )
    );

    // React to changes in the viewer's slice indices
    // These are the slice numbers currently being displayed
    // - In SliceViewer: a single slice index in the viewing dimension
    // - In OrthogonalImageViewer: three indices for axial, coronal, and sagittal views
    this.disposers.push(
      reaction(
        () => this.viewer.sliceIndices,
        () => this.requestUpdate()
      )
    );
  }

  /**
   * Cleans up all MobX reactions by disposing them.
   * Called when the component is disconnected or when the viewer changes.
   */
  cleanupReactions() {
    this.disposers.forEach(disposer => disposer());
    this.disposers = [];
  }

  /**
   * Renders the StatusBar component with five main information sections:
   * 1. Mouse Position: Shows x,y coordinates within the current slice view
   *    These are 2D pixel coordinates from viewer.mouseState.imageCoordinate
   * 
   * 2. Volume Coordinate: Shows x,y,z coordinates in the 3D volume
   *    These are volume voxel coordinates from viewer.mouseState.volumeCoordinate
   *    Calculated using SliceTransform.sliceToVolumeCoord() to convert from 2D to 3D
   * 
   * 3. World Coordinate: Shows x,y,z coordinates in the original world space
   *    These are millimeter coordinates from viewer.mouseState.worldCoordinate
   *    Calculated using SliceTransform.sliceToWorldCoord() to convert from 2D to world space
   * 
   * 4. Current Coord: Shows the current position (crosshair location)
   *    This is the 3D focus point from viewer.currentCoord
   *    Used to synchronize positions across multiple views
   * 
   * 5. Slice Indices: Shows current slice numbers
   *    - For SliceViewer: Single slice index along the viewing axis
   *    - For OrthogonalImageViewer: Slice indices for axial, coronal, and sagittal planes
   * 
   * The display adapts based on the viewer type (single slice vs. orthogonal).
   */
  render() {
    if (!this.viewer) {
      return html`<div class="status-bar">No viewer connected</div>`;
    }

    const mouseState = this.viewer.mouseState;
    const currentCoord = this.viewer.currentCoord;
    const sliceIndices = this.viewer.sliceIndices;
    
    // Determine if we're using a single-slice or orthogonal viewer
    const isSingleSliceViewer = 'slice' in sliceIndices;

    return html`
      <div class="status-bar">
        <div class="status-item">
          <span class="label">Mouse Position:</span>
          <span class="value">X: ${Math.round(mouseState?.imageCoordinate?.x ?? 0)}, Y: ${Math.round(mouseState?.imageCoordinate?.y ?? 0)}</span>
        </div>
        <span class="separator">|</span>
        <div class="status-item">
          <span class="label">Volume Coordinate:</span>
          <span class="value">X: ${Math.round(mouseState?.volumeCoordinate?.[0] ?? 0)}, Y: ${Math.round(mouseState?.volumeCoordinate?.[1] ?? 0)}, Z: ${Math.round(mouseState?.volumeCoordinate?.[2] ?? 0)}</span>
        </div>
        <span class="separator">|</span>
        <div class="status-item">
          <span class="label">World Coordinate:</span>
          <span class="value">X: ${Math.round(mouseState?.worldCoordinate?.[0] ?? 0)}, Y: ${Math.round(mouseState?.worldCoordinate?.[1] ?? 0)}, Z: ${Math.round(mouseState?.worldCoordinate?.[2] ?? 0)}</span>
        </div>
        <span class="separator">|</span>
        <div class="status-item">
          <span class="label">Current Coord:</span>
          <span class="value">X: ${Math.round(currentCoord?.[0] ?? 0)}, Y: ${Math.round(currentCoord?.[1] ?? 0)}, Z: ${Math.round(currentCoord?.[2] ?? 0)}</span>
        </div>
        <span class="separator">|</span>
        <div class="status-item">
          <span class="label">Slice ${isSingleSliceViewer ? 'Index' : 'Indices'}:</span>
          <span class="value">
            ${isSingleSliceViewer ? 
              `Current: ${sliceIndices.slice}` : 
              `Axial: ${sliceIndices.axial ?? 0}, Coronal: ${sliceIndices.coronal ?? 0}, Sagittal: ${sliceIndices.sagittal ?? 0}`
            }
          </span>
        </div>
      </div>
    `;
  }
}
