// File: src/display/OrientationLabelLayer.ts

import * as PIXI from 'pixi.js';
import { SliceLayer } from './SliceLayer';
import { AxisSet3D } from '../geometry/Axis';
import { NamedAxis } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { SlicePointerEvent } from './types/display';

/**
 * Options for orientation labels.
 */
export interface OrientationLabelOptions {
  fontSize?: number;
  color?: number;
  fontFamily?: string;
  margin?: number;
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
 * at the edges of a slice view. The labels are derived from the viewAxes:
 * - viewAxes.i defines the horizontal axis (labels on left/right edges)
 * - viewAxes.j defines the vertical axis (labels on top/bottom edges)
 */
export class OrientationLabelLayer implements SliceLayer {
  public neuroSpace: NeuroSpace;
  private container: PIXI.Container;
  private labels: PIXI.Text[] = [];
  private options: Required<OrientationLabelOptions>;

  constructor(neuroSpace: NeuroSpace, options?: OrientationLabelOptions) {
    this.neuroSpace = neuroSpace;
    this.options = {
      fontSize: options?.fontSize ?? 14,
      color: options?.color ?? 0xffffff,
      fontFamily: options?.fontFamily ?? 'sans-serif',
      margin: options?.margin ?? 6,
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
    parentContainer: PIXI.Container
  ): PIXI.Container | null {
    // Clear previous labels
    this.container.removeChildren();
    this.labels = [];

    // We need the parent container's content bounds to position labels.
    // Use the parent's first child (the image sprite) for sizing.
    // Since this container will be added to the same parent as the image,
    // we need to estimate the content size from the neuroSpace dimensions.
    const iDimIndex = this.neuroSpace.whichDim(viewAxes.i);
    const jDimIndex = this.neuroSpace.whichDim(viewAxes.j);
    const contentW = this.neuroSpace.dim[iDimIndex];
    const contentH = this.neuroSpace.dim[jDimIndex];

    // Get labels for the i-axis (horizontal: left/right edges)
    const iLabels = this.getLabelsForAxis(viewAxes.i);
    // Get labels for the j-axis (vertical: top/bottom edges)
    const jLabels = this.getLabelsForAxis(viewAxes.j);

    const textStyle = {
      fontSize: this.options.fontSize,
      fill: this.options.color,
      fontFamily: this.options.fontFamily,
      fontWeight: 'bold',
    } as any;

    const margin = this.options.margin;

    // Left edge label (negative i direction)
    const leftLabel = new PIXI.Text(iLabels[1], textStyle);
    leftLabel.anchor.set(0, 0.5);
    leftLabel.position.set(margin, contentH / 2);
    this.container.addChild(leftLabel);
    this.labels.push(leftLabel);

    // Right edge label (positive i direction)
    const rightLabel = new PIXI.Text(iLabels[0], textStyle);
    rightLabel.anchor.set(1, 0.5);
    rightLabel.position.set(contentW - margin, contentH / 2);
    this.container.addChild(rightLabel);
    this.labels.push(rightLabel);

    // Note: The Y-axis is flipped in the container (scale.y is negative),
    // so "top" in screen space corresponds to the positive j direction.
    // Bottom edge label (negative j direction)
    const bottomLabel = new PIXI.Text(jLabels[1], textStyle);
    bottomLabel.anchor.set(0.5, 1);
    bottomLabel.position.set(contentW / 2, contentH - margin);
    this.container.addChild(bottomLabel);
    this.labels.push(bottomLabel);

    // Top edge label (positive j direction)
    const topLabel = new PIXI.Text(jLabels[0], textStyle);
    topLabel.anchor.set(0.5, 0);
    topLabel.position.set(contentW / 2, margin);
    this.container.addChild(topLabel);
    this.labels.push(topLabel);

    return this.container;
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
