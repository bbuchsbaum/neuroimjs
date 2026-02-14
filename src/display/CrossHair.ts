// File: src/display/CrossHair.ts

import * as PIXI from 'pixi.js';
import { SliceLayer } from './SliceLayer';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { CoordinateTransformer } from './CoordinateTransformer';
import { SlicePointerEvent } from './types/display';

interface CrossHairOptions {
  crossColor?: number;
  crossThickness?: number;
  crossSize?: number;
  crossLineType?: 'solid' | 'dashed';
  crosshairGap?: number;
}

/**
 * SliceLayer for rendering a crosshair at the current position.
 * IMPORTANT: this.currentCoord is stored in mm space if your model/viewer also uses mm.
 * So we must convert mm => voxel => local 2D when drawing.
 */
export class CrossHair implements SliceLayer {
  public neuroSpace: NeuroSpace;
  private currentCoord: number[] = []; // Typically real-world mm
  private viewAxes: AxisSet3D;

  private coordinateTransformer: CoordinateTransformer;
  private mainContainer: PIXI.Container;

  private crossColor: number;
  private crossThickness: number;
  private crosshairGap: number;
  private crosshairAlpha = 1.0; // Full opacity for better visibility

  constructor(
    neuroSpace: NeuroSpace,
    viewAxes: AxisSet3D,
    coordinateTransformer: CoordinateTransformer,
    options: CrossHairOptions = {}
  ) {
    this.neuroSpace = neuroSpace;
    this.viewAxes = viewAxes;
    this.coordinateTransformer = coordinateTransformer;
    this.mainContainer = new PIXI.Container();

    this.crossColor = options.crossColor ?? 0xff0000; // Bright red
    this.crossThickness = options.crossThickness ?? 1; // Default thickness
    this.crosshairGap = options.crosshairGap ?? 4; // Gap size
  }

  initialize(): void {
    // no-op
  }

  /**
   * Renders the crosshair lines if we have a valid 3D coordinate.
   * Note: currentCoord is in mm, but volumeToLocalSliceCoord wants voxel coords.
   */
  renderSlice(
    sliceIndex: number,
    coord: number[],
    viewAxes: AxisSet3D,
    parentContainer: PIXI.Container
  ): PIXI.Container | null {
    if (this.currentCoord.length !== 3) {
      return null; // crosshair not yet set
    }

    // 1) Convert mm => voxel
    const voxelCoord = this.neuroSpace.coordToGrid(this.currentCoord);

    // 2) Update the transformer's slice index so volume->slice is pinned correctly
    this.coordinateTransformer.setSliceIndex(sliceIndex);

    // 3) Convert pinned voxel => local 2D slice
    const pt = this.coordinateTransformer.volumeToLocalSliceCoord(voxelCoord);
    
    // Check if the point coordinates are valid numbers
    if (isNaN(pt.x) || isNaN(pt.y)) {
      console.warn('CrossHair: Invalid point coordinates', pt);
      return null;
    }
    

    // 4) Clear existing
    this.mainContainer.removeChildren();

    // 5) Create a new Graphics object for drawing
    const g = new PIXI.Graphics();

    // 6) Determine slice area (local coordinate bounds)
    const bounds = parentContainer.getLocalBounds();
    
    // Use fallback values if bounds are invalid
    const w = (bounds && bounds.width > 0) ? bounds.width : 800;
    const h = (bounds && bounds.height > 0) ? bounds.height : 600;

    // 7) Draw the crosshair lines with a gap in the middle
    // In Pixi v8, lines are stroked with setStrokeStyle + stroke()
    const strokeStyle = {
      width: this.crossThickness,
      color: this.crossColor,
      alpha: this.crosshairAlpha
    };

    const halfGap = this.crosshairGap * 0.5;

    // Set stroke style once and build the path
    g.setStrokeStyle({ width: strokeStyle.width, color: strokeStyle.color, alpha: strokeStyle.alpha });

    // Vertical line segments - top part
    g.moveTo(pt.x, 0);
    g.lineTo(pt.x, pt.y - halfGap);

    // Vertical line segments - bottom part
    g.moveTo(pt.x, pt.y + halfGap);
    g.lineTo(pt.x, h);

    // Horizontal line segments - left part
    g.moveTo(0, pt.y);
    g.lineTo(pt.x - halfGap, pt.y);

    // Horizontal line segments - right part
    g.moveTo(pt.x + halfGap, pt.y);
    g.lineTo(w, pt.y);

    // Commit the stroke so it actually renders
    try { (g as any).stroke?.(); } catch {}

    this.mainContainer.addChild(g);
    return this.mainContainer;
  }

  /**
   * Sets the crosshair volume coordinate in mm-space (typical in this code).
   */
  setPosition(coord: number[]): void {
    this.currentCoord = coord.slice();
  }

  onPointerMove(event: SlicePointerEvent): boolean {
    return false;
  }

  onPointerDown(event: SlicePointerEvent): boolean {
    return false;
  }

  dispose(): void {
    this.mainContainer.destroy({ children: true });
  }

  public setCrossColor(color: number): void {
    this.crossColor = color;
  }
  public setCrossThickness(thickness: number): void {
    this.crossThickness = thickness;
  }
  public setCrosshairGap(gap: number): void {
    this.crosshairGap = gap;
  }
}
