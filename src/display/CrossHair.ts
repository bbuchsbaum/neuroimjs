// File: src/display/CrossHair.ts

import * as PIXI from 'pixi.js';
import { SliceLayer } from './SliceLayer';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { CoordinateTransformer } from './CoordinateTransformer';
import { SlicePointerEvent } from './types/display';
import { ScreenLayoutContext } from './SliceLayer';

export interface CrossHairOptions {
  /** Line colour (PIXI numeric colour). Default red 0xff0000. */
  crossColor?: number;
  /** Line opacity in [0, 1]. Default 1. */
  crossAlpha?: number;
  /** Line width in screen (CSS) pixels. Default 1. */
  crossThickness?: number;
  /** Retained for API compatibility; unused. */
  crossSize?: number;
  /** Retained for API compatibility; only 'solid' is drawn. */
  crossLineType?: 'solid' | 'dashed';
  /** Gap left open around the cursor, in screen (CSS) pixels. Default 8. */
  crosshairGap?: number;
  /** Optional contrasting halo drawn under the line (PIXI numeric colour). */
  haloColor?: number;
  /** Halo opacity in [0, 1]. Default 0 (no halo). */
  haloAlpha?: number;
}

/**
 * Screen-space SliceLayer that renders a crosshair at the current position.
 *
 * The cursor position is resolved in image-content space (mm => voxel => local
 * slice coordinate) but the lines are drawn in viewport pixels, so they stay a
 * crisp, constant width at any zoom and never cover the voxel under the cursor.
 * Lines are clipped to the rendered image rectangle.
 */
export class CrossHair implements SliceLayer {
  public readonly screenSpace = true;
  public neuroSpace: NeuroSpace;
  private currentCoord: number[] = []; // world mm
  private viewAxes: AxisSet3D;

  private coordinateTransformer: CoordinateTransformer;
  private mainContainer: PIXI.Container;
  private graphics: PIXI.Graphics;

  private crossColor: number;
  private crossThickness: number;
  private crosshairGap: number;
  private crosshairAlpha: number;
  private haloColor: number;
  private haloAlpha: number;

  // Resolved in renderSlice(), consumed in layoutScreen().
  private contentPoint: { x: number; y: number } | null = null;
  private contentW = 1;
  private contentH = 1;
  private lastCtx: ScreenLayoutContext | null = null;

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
    this.graphics = new PIXI.Graphics();
    this.mainContainer.addChild(this.graphics);

    this.crossColor = options.crossColor ?? 0xff0000;
    this.crossThickness = options.crossThickness ?? 1;
    this.crosshairGap = options.crosshairGap ?? 8;
    this.crosshairAlpha = options.crossAlpha ?? 1;
    this.haloColor = options.haloColor ?? 0x000000;
    this.haloAlpha = options.haloAlpha ?? 0;
  }

  initialize(): void {
    // no-op
  }

  /**
   * Resolves the cursor in content space. Drawing happens in layoutScreen(),
   * once the viewport transform for this frame is known.
   */
  renderSlice(
    sliceIndex: number,
    _coord: number[],
    viewAxes: AxisSet3D,
    _parentContainer: PIXI.Container
  ): PIXI.Container | null {
    if (this.currentCoord.length !== 3) {
      return null; // crosshair not yet set
    }

    const voxelCoord = this.neuroSpace.coordToGrid(this.currentCoord);
    this.coordinateTransformer.setSliceIndex(sliceIndex);
    const pt = this.coordinateTransformer.volumeToLocalSliceCoord(voxelCoord);
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      return null;
    }

    this.contentPoint = { x: pt.x, y: pt.y };
    this.contentW = this.neuroSpace.dim[this.neuroSpace.whichDim(viewAxes.i)];
    this.contentH = this.neuroSpace.dim[this.neuroSpace.whichDim(viewAxes.j)];
    if (this.lastCtx) this.layoutScreen(this.lastCtx);
    return this.mainContainer;
  }

  /**
   * Draws the crosshair in viewport pixels, clipped to the image rectangle.
   */
  layoutScreen(ctx: ScreenLayoutContext): void {
    this.lastCtx = ctx;
    const g = this.graphics;
    g.clear();
    if (!this.contentPoint) return;

    const r = ctx.contentRect ?? { x0: 0, y0: 0, x1: this.contentW, y1: this.contentH };
    const a = ctx.project(r.x0, r.y0);
    const b = ctx.project(r.x1, r.y1);
    const left = Math.max(0, Math.min(a.x, b.x));
    const right = Math.min(ctx.width, Math.max(a.x, b.x));
    const top = Math.max(0, Math.min(a.y, b.y));
    const bottom = Math.min(ctx.height, Math.max(a.y, b.y));
    if (right <= left || bottom <= top) return;

    const p = ctx.project(this.contentPoint.x, this.contentPoint.y);
    // Snap to the pixel grid so odd-width lines render crisply.
    const w = this.crossThickness;
    const snap = (v: number) => (w % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v));
    const x = snap(p.x);
    const y = snap(p.y);
    const half = this.crosshairGap / 2;

    const segments = (): void => {
      if (x >= left && x <= right) {
        if (y - half > top) { g.moveTo(x, top); g.lineTo(x, Math.min(bottom, y - half)); }
        if (y + half < bottom) { g.moveTo(x, Math.max(top, y + half)); g.lineTo(x, bottom); }
      }
      if (y >= top && y <= bottom) {
        if (x - half > left) { g.moveTo(left, y); g.lineTo(Math.min(right, x - half), y); }
        if (x + half < right) { g.moveTo(Math.max(left, x + half), y); g.lineTo(right, y); }
      }
    };

    if (this.haloAlpha > 0) {
      segments();
      g.stroke({ width: w + 2, color: this.haloColor, alpha: this.haloAlpha });
    }
    segments();
    g.stroke({ width: w, color: this.crossColor, alpha: this.crosshairAlpha });
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
  public setCrossAlpha(alpha: number): void {
    this.crosshairAlpha = alpha;
  }
  public setCrossThickness(thickness: number): void {
    this.crossThickness = thickness;
  }
  public setCrosshairGap(gap: number): void {
    this.crosshairGap = gap;
  }
}
