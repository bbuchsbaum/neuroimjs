import * as PIXI from 'pixi.js';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { CoordinateTransformer } from './CoordinateTransformer';
import { ScreenLayoutContext, SliceLayer } from './SliceLayer';
import { SlicePointerEvent } from './types/display';

export interface PointMarker {
  id: string;
  /** World coordinate in millimeters. */
  xyz: [number, number, number];
  color?: number | string;
  label?: string;
}

export interface PointMarkerOptions {
  /** Full thickness of the visible slab in millimeters. Omit to use nearest-slice rounding. */
  slabMm?: number;
  shape?: 'ring' | 'cross' | 'dot';
  sizePx?: number;
  /** Contrasting outline color; false disables it. */
  outline?: number | string | false;
}

/** Screen-space markers whose selection and drawing use the same slice geometry. */
export class PointMarkerLayer implements SliceLayer {
  readonly screenSpace = true;
  private readonly container = new PIXI.Container();
  private readonly graphics = new PIXI.Graphics();
  private readonly transformer: CoordinateTransformer;
  private markers: PointMarker[] = [];
  private options: PointMarkerOptions = {};
  private candidates: { id: string; x: number; y: number; color: number | string }[] = [];
  private drawnIds: string[] = [];
  private contentW = 0;
  private contentH = 0;

  constructor(public readonly neuroSpace: NeuroSpace, private readonly viewAxes: AxisSet3D) {
    this.transformer = new CoordinateTransformer(neuroSpace, viewAxes);
    this.container.addChild(this.graphics);
  }

  initialize(): void { /* Graphics are created by the constructor. */ }

  setMarkers(markers: PointMarker[], options: PointMarkerOptions = {}): void {
    if (options.slabMm !== undefined && (!Number.isFinite(options.slabMm) || options.slabMm < 0)) {
      throw new RangeError('slabMm must be a non-negative finite number');
    }
    if (options.sizePx !== undefined && (!Number.isFinite(options.sizePx) || options.sizePx <= 0)) {
      throw new RangeError('sizePx must be a positive finite number');
    }
    for (const marker of markers) {
      if (typeof marker.id !== 'string' || marker.xyz.length !== 3 || !marker.xyz.every(Number.isFinite)) {
        throw new TypeError('Each marker needs a string id and finite world xyz');
      }
    }
    this.markers = markers.map(marker => ({ ...marker, xyz: [...marker.xyz] as [number, number, number] }));
    this.options = { ...options };
  }

  worldToSliceIndex(xyz: number[]): number {
    const pinned = this.neuroSpace.whichDim(this.viewAxes.k);
    return Math.round(this.neuroSpace.coordToGrid(xyz)[pinned]);
  }

  markersOnSlice(): string[] {
    return [...this.drawnIds];
  }

  renderSlice(sliceIndex: number, _coord: number[], _axes: AxisSet3D, _parent: PIXI.Container): PIXI.Container {
    const dimI = this.neuroSpace.whichDim(this.viewAxes.i);
    const dimJ = this.neuroSpace.whichDim(this.viewAxes.j);
    const dimK = this.neuroSpace.whichDim(this.viewAxes.k);
    this.contentW = this.neuroSpace.dim[dimI];
    this.contentH = this.neuroSpace.dim[dimJ];
    this.transformer.setSliceIndex(sliceIndex);
    this.candidates = [];
    for (const marker of this.markers) {
      const grid = this.neuroSpace.coordToGrid(marker.xyz);
      if (grid[dimI] < -0.5 || grid[dimI] >= this.contentW - 0.5 ||
          grid[dimJ] < -0.5 || grid[dimJ] >= this.contentH - 0.5) continue;
      if (this.options.slabMm === undefined) {
        if (Math.round(grid[dimK]) !== sliceIndex) continue;
      } else if (this.distanceToPlane(marker.xyz, sliceIndex, dimI, dimJ, dimK) > this.options.slabMm / 2) {
        continue;
      }
      const point = this.transformer.volumeToLocalSliceCoord(grid);
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
        this.candidates.push({ id: marker.id, x: point.x, y: point.y, color: marker.color ?? 0xffd84d });
      }
    }
    return this.container;
  }

  private distanceToPlane(xyz: number[], sliceIndex: number, dimI: number, dimJ: number, dimK: number): number {
    const origin = [0, 0, 0];
    origin[dimK] = sliceIndex;
    const point = this.neuroSpace.gridToCoord(origin);
    const i = [...origin]; i[dimI]++;
    const j = [...origin]; j[dimJ]++;
    const wi = this.neuroSpace.gridToCoord(i).map((v, k) => v - point[k]);
    const wj = this.neuroSpace.gridToCoord(j).map((v, k) => v - point[k]);
    const normal = [wi[1] * wj[2] - wi[2] * wj[1], wi[2] * wj[0] - wi[0] * wj[2], wi[0] * wj[1] - wi[1] * wj[0]];
    const length = Math.hypot(...normal);
    return Math.abs(normal.reduce((sum, n, k) => sum + n * (xyz[k] - point[k]), 0)) / length;
  }

  layoutScreen(ctx: ScreenLayoutContext): void {
    const graphics = this.graphics;
    graphics.clear();
    this.drawnIds = [];
    const rect = ctx.contentRect ?? { x0: 0, y0: 0, x1: this.contentW, y1: this.contentH };
    const size = this.options.sizePx ?? 9;
    const shape = this.options.shape ?? 'ring';
    for (const marker of this.candidates) {
      if (marker.x < rect.x0 || marker.x > rect.x1 || marker.y < rect.y0 || marker.y > rect.y1) continue;
      const { x, y } = ctx.project(marker.x, marker.y);
      if (x < 0 || x > ctx.width || y < 0 || y > ctx.height - ctx.insets.bottom) continue;
      this.drawnIds.push(marker.id);
      const outline = this.options.outline === false ? null : (this.options.outline ?? 0x000000);
      const radius = size / 2;
      if (shape === 'dot') {
        if (outline !== null) { graphics.circle(x, y, radius + 1.5).fill(outline); }
        graphics.circle(x, y, radius).fill(marker.color);
      } else if (shape === 'ring') {
        if (outline !== null) { graphics.circle(x, y, radius).stroke({ width: 4, color: outline }); }
        graphics.circle(x, y, radius).stroke({ width: 2, color: marker.color });
      } else {
        const path = () => {
          graphics.moveTo(x - radius, y).lineTo(x + radius, y);
          graphics.moveTo(x, y - radius).lineTo(x, y + radius);
        };
        if (outline !== null) { path(); graphics.stroke({ width: 4, color: outline }); }
        path(); graphics.stroke({ width: 2, color: marker.color });
      }
    }
  }

  setPosition(_coord: number[]): void { /* Slice selection happens in renderSlice. */ }
  onPointerMove(_event: SlicePointerEvent): boolean { return false; }
  onPointerDown(_event: SlicePointerEvent): boolean { return false; }
  dispose(): void { this.container.destroy({ children: true }); }
}
