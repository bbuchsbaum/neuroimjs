/**
 * File: src/display/PositionLabel.ts
 *
 * A simple overlay layer to display the current 3D position in text form (e.g. "Position: (x, y, z)").
 * Useful for showing the user’s current crosshair or cursor coordinate in a slice view.
 *
 * This class implements the SliceLayer interface, so it can be included alongside image or crosshair overlays.
 */

import * as PIXI from 'pixi.js';
import { SliceLayer } from './SliceLayer';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { SlicePointerEvent } from './types/display';

/**
 * The PositionLabel class displays a small text overlay in the bottom-left corner
 * of the slice. It displays the current 3D coordinate (X, Y, Z) in real-world or voxel units.
 */
export class PositionLabel implements SliceLayer {
  private container: PIXI.Container;     // Holds the text and any graphical background
  private text: PIXI.Text;               // The text object for displaying coordinates
  private background: PIXI.Graphics;     // Optionally used for a background box or highlight
  private currentPosition: number[] = [0, 0, 0];  // The current coordinate to display
  public neuroSpace: NeuroSpace;         // The underlying NeuroSpace (dims, spacing, etc.)
  private baseScale: number = 1;         // A reference scale factor to keep text size consistent

  /**
   * Constructs a PositionLabel layer.
   * @param neuroSpace - The NeuroSpace describing voxel dimensions, orientation, etc.
   */
  constructor(neuroSpace: NeuroSpace) {
    this.container = new PIXI.Container();
    this.background = new PIXI.Graphics();
    this.neuroSpace = neuroSpace;

    // Create a PIXI.Text object for coordinate display
    this.text = new PIXI.Text('Position: (0, 0, 0)', {
      fontFamily: 'Arial',
      fontSize: 10,
      fill: 0xffffff
    });

    // Add background + text to the main container
    this.container.addChild(this.background);
    this.container.addChild(this.text);

    // Update the text position/appearance
    this.updatePosition();
  }

  /**
   * Required by the SliceLayer interface, but no specific initialization is needed.
   */
  initialize(): void {
    // No setup needed for this text overlay
  }

  /**
   * Renders this position label overlay. Positions the text in the bottom-left of the parent container.
   * @param sliceIndex - The index of the slice (unused in this label).
   * @param viewAxes - The 3D orientation axes (unused here).
   * @param parentContainer - The parent container for the overlay (used for sizing/position).
   * @returns The container with the text label, so the SliceView can add it to the stage.
   */
  renderSlice(
    sliceIndex: number,
    coord: number[],
    viewAxes: AxisSet3D,
    parentContainer: PIXI.Container
  ): PIXI.Container | null {
    this.updatePosition(parentContainer);
    return this.container;
  }

  /**
   * Updates the coordinate text displayed in the label.
   * @param coord - A 3-element array [x, y, z] for the new position.
   */
  setPosition(coord: number[]): void {
    // Round to 2 decimal places for readability
    this.currentPosition = coord.map(val => Math.round(val * 100) / 100);
    this.updatePosition();
  }

  /**
   * Internal helper that updates the displayed text and re-positions the label in the bottom-left corner.
   * Also applies scaling so the text remains a consistent size regardless of zoom.
   * @param parentContainer - The parent container to read its bounds. If omitted, just re-draw text.
   */
  private updatePosition(parentContainer?: PIXI.Container): void {
    const [x, y, z] = this.currentPosition;
    this.text.text = `Position: (${x}, ${y}, ${z})`;

    // If we have a parentContainer, position label at bottom-left with some margin
    if (parentContainer) {
      const padding = 5;
      const parentBounds = parentContainer.getLocalBounds();

      this.container.position.set(
        parentBounds.x + padding,
        parentBounds.y + parentBounds.height - this.container.height - padding
      );

      // Scale fix so text size doesn't blow up if parent container is scaled heavily
      const parentScale = parentContainer.scale.x; // Assuming uniform X=Y scaling
      const newScale = this.baseScale / parentScale;
      this.container.scale.set(newScale);
    }
  }

  /**
   * The SliceLayer interface requires these pointer event methods,
   * but this label is passive and doesn't respond to mouse events.
   */
  onPointerMove(event: SlicePointerEvent): boolean {
    return false;
  }

  onPointerDown(event: SlicePointerEvent): boolean {
    return false;
  }

  /**
   * Cleans up Pixi resources.
   */
  dispose(): void {
    this.container.destroy({ children: true });
  }

  /**
   * Adjusts the 'baseScale' reference factor if the viewer changes default text sizing.
   * @param scale - The new desired base scale.
   */
  setBaseScale(scale: number): void {
    this.baseScale = scale;
    this.updatePosition();
  }
}
