import { describe, it, expect } from 'vitest';
import * as PIXI from 'pixi.js';
import { OrientationLabelLayer } from '../../src/display/OrientationLabelLayer';
import { ScreenLayoutContext } from '../../src/display/SliceLayer';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';

/**
 * Helper: render the layer for an orientation, lay it out against a viewport
 * with the given projection, and return the four labels keyed by viewport edge
 * (determined by the anchor each label ends up with).
 */
function layout(
  axes: AxisSet3D,
  width: number,
  height: number,
  project: ScreenLayoutContext['project'],
  insets: ScreenLayoutContext['insets'] = { top: 0, right: 0, bottom: 0, left: 0 }
): { left: any; right: any; top: any; bottom: any } {
  const space = new NeuroSpace([10, 12, 14], [1, 1, 1], [0, 0, 0], axes);
  const layer = new OrientationLabelLayer(space);
  const container = layer.renderSlice(0, [0, 0, 0], axes, new PIXI.Container())!;
  layer.layoutScreen({ width, height, insets, project });

  const byEdge: any = { left: null, right: null, top: null, bottom: null };
  for (const child of container.children as any[]) {
    const { x: ax, y: ay } = child.anchor;
    if (ax === 0 && ay === 0.5) byEdge.left = child;
    else if (ax === 1 && ay === 0.5) byEdge.right = child;
    else if (ax === 0.5 && ay === 0) byEdge.top = child;
    else if (ax === 0.5 && ay === 1) byEdge.bottom = child;
  }
  return byEdge;
}

// Production-like projection: x preserved, y flipped (scale.y < 0). Content
// height is 12 (the j-dim of the test space). This mirrors how SliceView fits
// content: content y=0 lands at the screen bottom, y=H at the screen top.
const FLIP_Y = (cx: number, cy: number) => ({ x: cx, y: 12 - cy });
// A non-flipped projection (content y increases downward on screen).
const NO_FLIP = (cx: number, cy: number) => ({ x: cx, y: cy });

describe('OrientationLabelLayer', () => {
  it('is a screen-space layer', () => {
    const space = new NeuroSpace([10, 12, 14], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
    const layer = new OrientationLabelLayer(space);
    expect(layer.screenSpace).toBe(true);
  });

  it('labels axial (LPI) correctly: L-left, R-right, A-top, P-bottom', () => {
    const e = layout(AxisSet3D.AXIAL_LPI, 200, 200, FLIP_Y);
    expect(e.left.text).toBe('L');
    expect(e.right.text).toBe('R');
    expect(e.top.text).toBe('A');
    expect(e.bottom.text).toBe('P');
  });

  it('labels coronal (LIP) correctly: L-left, R-right, S-top, I-bottom', () => {
    const e = layout(AxisSet3D.CORONAL_LIP, 200, 200, FLIP_Y);
    expect(e.left.text).toBe('L');
    expect(e.right.text).toBe('R');
    expect(e.top.text).toBe('S');
    expect(e.bottom.text).toBe('I');
  });

  it('labels sagittal (AIL) correctly: S-top, I-bottom', () => {
    const e = layout(AxisSet3D.SAGITTAL_AIL, 200, 200, FLIP_Y);
    // i = ANT_POST (positive=P, negative=A); j = INF_SUP (positive=S, negative=I)
    expect(e.top.text).toBe('S');
    expect(e.bottom.text).toBe('I');
    expect(e.left.text).toBe('A');
    expect(e.right.text).toBe('P');
  });

  it('derives edge assignment from the live transform (flip swaps top/bottom)', () => {
    // Same orientation, but a non-flipped projection must swap the vertical labels,
    // proving the layer reads the actual image transform rather than assuming one.
    const flipped = layout(AxisSet3D.AXIAL_LPI, 200, 200, FLIP_Y);
    const unflipped = layout(AxisSet3D.AXIAL_LPI, 200, 200, NO_FLIP);
    expect(flipped.top.text).toBe('A');
    expect(flipped.bottom.text).toBe('P');
    expect(unflipped.top.text).toBe('P');
    expect(unflipped.bottom.text).toBe('A');
    // Horizontal labels are unaffected (x is not flipped in either case).
    expect(flipped.left.text).toBe('L');
    expect(unflipped.left.text).toBe('L');
  });

  it('pins labels to the viewport edges with the configured margin', () => {
    const margin = 6;
    const W = 300;
    const H = 240;
    const e = layout(AxisSet3D.AXIAL_LPI, W, H, FLIP_Y);
    expect(e.left.position.x).toBe(margin);
    expect(e.left.position.y).toBe(H / 2);
    expect(e.right.position.x).toBe(W - margin);
    expect(e.top.position.x).toBe(W / 2);
    expect(e.top.position.y).toBe(margin);
    expect(e.bottom.position.y).toBe(H - margin);
  });

  it('keeps labels inside the safe area when an edge is inset (e.g. the slider)', () => {
    const margin = 6;
    const W = 300;
    const H = 240;
    const bottomInset = 34;
    const e = layout(AxisSet3D.AXIAL_LPI, W, H, FLIP_Y, {
      top: 0,
      right: 0,
      bottom: bottomInset,
      left: 0,
    });
    // Bottom label sits above the reserved band, not at the very bottom edge.
    expect(e.bottom.position.y).toBe(H - bottomInset - margin);
    // Side labels recenter within the (shorter) safe area rather than the full height.
    expect(e.left.position.y).toBe((H - bottomInset) / 2);
    expect(e.right.position.y).toBe((H - bottomInset) / 2);
    // Top is unaffected (no top inset).
    expect(e.top.position.y).toBe(margin);
  });
});
