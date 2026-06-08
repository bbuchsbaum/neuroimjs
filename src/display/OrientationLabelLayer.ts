// File: src/display/OrientationLabelLayer.ts

import * as PIXI from 'pixi.js';
import { SliceLayer, ScreenLayoutContext } from './SliceLayer';
import { AxisSet3D } from '../geometry/Axis';
import { NamedAxis } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { SlicePointerEvent } from './types/display';

/**
 * Options for orientation labels.
 */
export interface OrientationLabelOptions {
  /** Font size in screen pixels (labels do NOT scale with the image). */
  fontSize?: number;
  /** Fill color of the letters (PIXI numeric color). */
  color?: number;
  /** Font family. */
  fontFamily?: string;
  /** Distance from the viewport edge, in screen pixels. */
  margin?: number;
  /** Outline color drawn around the letters for contrast over bright/dark anatomy. */
  strokeColor?: number;
  /** Outline width in pixels. Set to 0 to disable. */
  strokeWidth?: number;
}

/**
 * Maps a NamedAxis name to its positive and negative anatomical direction label.
 * The positive label corresponds to the direction of the axis vector.
 */
const AXIS_LABEL_MAP: Record<string, [string, string]> = {
  // [positive direction label, negative direction label]
  LEFT_RIGHT: ['R', 'L'],
  RIGHT_LEFT: ['L', 'R'],
  POST_ANT: ['A', 'P'],
  ANT_POST: ['P', 'A'],
  INF_SUP: ['S', 'I'],
  SUP_INF: ['I', 'S'],
};

/**
 * OrientationLabelLayer renders anatomical direction labels (L/R/A/P/S/I)
 * pinned to the four edges of the viewport, at a fixed screen size — exactly
 * as typical neuroimaging viewers (FSLeyes, MRIcron) display them.
 *
 * ## Why this is a screen-space layer
 * The slice image is rendered into a container that is scaled to fit and
 * Y-flipped. Anything placed in that container scales and flips with the image.
 * Orientation labels must instead stay a constant pixel size and stay pinned to
 * the viewport edges through zoom/pan/resize, so this layer declares
 * {@link screenSpace} and is rendered by {@link SliceView} into an unscaled,
 * stage-level overlay container.
 *
 * ## How the letters are assigned to edges (correctness)
 * The letters for the in-plane axes (`viewAxes.i`, `viewAxes.j`) come from the
 * orientation, but *which screen edge* each letter belongs to is derived from
 * the live image transform via {@link ScreenLayoutContext.project}. We project
 * the endpoints of the i- and j-axes to screen pixels and assign each label to
 * the edge it actually points to. This guarantees the labels can never disagree
 * with the rendered image, regardless of axis flips, zoom, or pan — which is
 * essential because mislabeling Left/Right is a serious error in neuroimaging.
 */
export class OrientationLabelLayer implements SliceLayer {
  public readonly screenSpace = true;
  public neuroSpace: NeuroSpace;
  private container: PIXI.Container;
  private options: Required<OrientationLabelOptions>;

  // One PIXI.Text per in-plane axis endpoint. Each keeps a fixed letter; only
  // its screen position is updated in layoutScreen().
  private textNegI: PIXI.Text | null = null; // negative i direction
  private textPosI: PIXI.Text | null = null; // positive i direction
  private textNegJ: PIXI.Text | null = null; // negative j direction
  private textPosJ: PIXI.Text | null = null; // positive j direction

  // Dimension indices and content extent for the current view, resolved in
  // renderSlice() (where viewAxes is known) and consumed in layoutScreen().
  private contentW = 1;
  private contentH = 1;

  constructor(neuroSpace: NeuroSpace, options?: OrientationLabelOptions) {
    this.neuroSpace = neuroSpace;
    this.options = {
      fontSize: options?.fontSize ?? 16,
      color: options?.color ?? 0xffffff,
      fontFamily: options?.fontFamily ?? 'sans-serif',
      margin: options?.margin ?? 6,
      strokeColor: options?.strokeColor ?? 0x000000,
      strokeWidth: options?.strokeWidth ?? 3,
    };
    this.container = new PIXI.Container();
  }

  initialize(): void {
    // no-op
  }

  renderSlice(
    _sliceIndex: number,
    _coord: number[],
    viewAxes: AxisSet3D,
    _parentContainer: PIXI.Container
  ): PIXI.Container | null {
    // Resolve the in-plane content extent (x spans the i-axis, y spans the j-axis).
    this.contentW = this.neuroSpace.dim[this.neuroSpace.whichDim(viewAxes.i)];
    this.contentH = this.neuroSpace.dim[this.neuroSpace.whichDim(viewAxes.j)];

    // Rebuild the label texts from the current orientation. The four texts hold
    // fixed letters; positioning happens in layoutScreen() once the viewport
    // geometry is known.
    this.container.removeChildren();

    const iLabels = this.getLabelsForAxis(viewAxes.i); // [positive, negative]
    const jLabels = this.getLabelsForAxis(viewAxes.j);

    this.textNegI = this.makeLabel(iLabels[1]);
    this.textPosI = this.makeLabel(iLabels[0]);
    this.textNegJ = this.makeLabel(jLabels[1]);
    this.textPosJ = this.makeLabel(jLabels[0]);

    this.container.addChild(this.textNegI);
    this.container.addChild(this.textPosI);
    this.container.addChild(this.textNegJ);
    this.container.addChild(this.textPosJ);

    return this.container;
  }

  /**
   * Pin the four labels to the viewport edges. The edge each label belongs to is
   * derived from the live image transform so the labels always match the image.
   */
  layoutScreen(ctx: ScreenLayoutContext): void {
    if (!this.textNegI || !this.textPosI || !this.textNegJ || !this.textPosJ) {
      return;
    }

    const { width, height, project } = ctx;
    const insets = ctx.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const margin = this.options.margin;

    // Safe-area edges: keep labels clear of reserved UI (e.g. the slice slider).
    const left = insets.left + margin;
    const right = width - insets.right - margin;
    const top = insets.top + margin;
    const bottom = height - insets.bottom - margin;
    const midX = insets.left + (width - insets.left - insets.right) / 2;
    const midY = insets.top + (height - insets.top - insets.bottom) / 2;

    // The i-axis endpoints are horizontal on screen: the one with the smaller
    // screen-x is the left edge, the other the right edge.
    const negI = project(0, this.contentH / 2);
    const posI = project(this.contentW, this.contentH / 2);
    if (negI.x <= posI.x) {
      this.placeLeft(this.textNegI, left, midY);
      this.placeRight(this.textPosI, right, midY);
    } else {
      this.placeRight(this.textNegI, right, midY);
      this.placeLeft(this.textPosI, left, midY);
    }

    // The j-axis endpoints are vertical on screen: smaller screen-y is the top.
    const negJ = project(this.contentW / 2, 0);
    const posJ = project(this.contentW / 2, this.contentH);
    if (negJ.y <= posJ.y) {
      this.placeTop(this.textNegJ, midX, top);
      this.placeBottom(this.textPosJ, midX, bottom);
    } else {
      this.placeBottom(this.textNegJ, midX, bottom);
      this.placeTop(this.textPosJ, midX, top);
    }
  }

  private placeLeft(t: PIXI.Text, x: number, y: number) {
    t.anchor.set(0, 0.5);
    t.position.set(x, y);
  }
  private placeRight(t: PIXI.Text, x: number, y: number) {
    t.anchor.set(1, 0.5);
    t.position.set(x, y);
  }
  private placeTop(t: PIXI.Text, x: number, y: number) {
    t.anchor.set(0.5, 0);
    t.position.set(x, y);
  }
  private placeBottom(t: PIXI.Text, x: number, y: number) {
    t.anchor.set(0.5, 1);
    t.position.set(x, y);
  }

  private makeLabel(text: string): PIXI.Text {
    const style: any = {
      fontSize: this.options.fontSize,
      fill: this.options.color,
      fontFamily: this.options.fontFamily,
      fontWeight: 'bold',
    };
    if (this.options.strokeWidth > 0) {
      style.stroke = { color: this.options.strokeColor, width: this.options.strokeWidth };
    }
    const label = new PIXI.Text(text, style);
    label.anchor.set(0.5, 0.5);
    return label;
  }

  /**
   * Returns [positiveLabel, negativeLabel] for a given NamedAxis.
   */
  private getLabelsForAxis(axis: NamedAxis): [string, string] {
    return AXIS_LABEL_MAP[axis.name] ?? ['?', '?'];
  }

  setPosition(_coord: number[]): void {
    // no-op — labels don't move with coordinate
  }

  onPointerMove(_event: SlicePointerEvent): boolean {
    return false;
  }

  onPointerDown(_event: SlicePointerEvent): boolean {
    return false;
  }

  dispose(): void {
    this.container.destroy({ children: true });
  }
}
