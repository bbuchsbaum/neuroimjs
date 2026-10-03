// File: tests/display/CrosshairVoxelCentre.test.ts
//
// The crosshair must sit on the centre of the voxel it marks. ImageLayer draws
// the reference slice texture at the origin of image-content space with one
// texel per unit, so texel (c, r) covers [c, c + 1] x [r, r + 1] and its
// centre is (c + 0.5, r + 0.5). Clicking anywhere inside that texel must
// select the same voxel.

import { describe, it, expect, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import { CrossHair } from '../../src/display/CrossHair';
import { CoordinateTransformer } from '../../src/display/CoordinateTransformer';
import { SliceTransform } from '../../src/display/SliceTransform';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';

const space = () => new NeuroSpace([5, 6, 7], [2, 3, 4], [-4, -9, -12], AxisSet3D.AXIAL_LPI);
const VOXEL = [1, 4, 2];

// The views of OrthogonalImageViewer. SAGITTAL_AIL runs the volume's
// posterior-anterior axis backwards, which exercises the flipped branch.
const VIEWS = [
  ['axial', AxisSet3D.AXIAL_LPI],
  ['coronal', AxisSet3D.CORONAL_LIP],
  ['sagittal', AxisSet3D.SAGITTAL_AIL],
] as const;

/** Column and row of the marked voxel's texel in the slice texture. */
function markedTexel(axes: AxisSet3D): { c: number; r: number; index: number } {
  const s = space();
  const vol = new FloatNeuroVol(s);
  vol.setAt(VOXEL[0], VOXEL[1], VOXEL[2], 1);
  const index = VOXEL[s.whichDim(axes.k)];
  const slice = vol.getSlice(index, axes);
  const at = Array.from(slice.data).indexOf(1);
  expect(at).toBeGreaterThanOrEqual(0);
  const width = slice.space.dim[0];
  return { c: at % width, r: Math.floor(at / width), index };
}

describe('crosshair and picking use voxel centres', () => {
  it.each(VIEWS)('%s: the crosshair is drawn through the centre of the marked texel', (_name, axes) => {
    const s = space();
    const { c, r, index } = markedTexel(axes);

    const crosshair = new CrossHair(s, axes, new CoordinateTransformer(s, axes, index), {
      crossThickness: 2,
      crosshairGap: 0,
    });
    const graphics = (crosshair as unknown as { graphics: PIXI.Graphics }).graphics;
    // tests/setup.ts mocks PIXI.Graphics without clear().
    const clearable = graphics as unknown as { clear?: () => unknown };
    if (typeof clearable.clear !== 'function') clearable.clear = () => graphics;
    const moveTo = vi.spyOn(graphics, 'moveTo');

    // 10 screen pixels per content unit, no flip, so content (x, y) maps to (10x, 10y).
    const scale = 10;
    crosshair.layoutScreen({
      width: 1000,
      height: 1000,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      project: (x: number, y: number) => ({ x: x * scale, y: y * scale }),
    });
    crosshair.setPosition(s.gridToCoord(VOXEL));
    crosshair.renderSlice(index, s.gridToCoord(VOXEL), axes, new PIXI.Container());

    // The vertical line starts at (x, top) and the horizontal one at (left, y).
    const points = moveTo.mock.calls.map(([x, y]) => [x, y]);
    const verticalX = points.find(([, y]) => y === 0)?.[0];
    const horizontalY = points.find(([x]) => x === 0)?.[1];
    expect(verticalX).toBe((c + 0.5) * scale);
    expect(horizontalY).toBe((r + 0.5) * scale);
  });

  it.each(VIEWS)('%s: SliceTransform maps the voxel to its texel centre and back', (_name, axes) => {
    const s = space();
    const { c, r, index } = markedTexel(axes);
    const xform = new SliceTransform(s, axes, index);

    expect(xform.volumeToImageCoord(VOXEL)).toEqual({ x: c + 0.5, y: r + 0.5 });
    expect(xform.worldToImageCoord(s.gridToCoord(VOXEL))).toEqual({ x: c + 0.5, y: r + 0.5 });
    expect(xform.imageToVolumeCoord({ x: c + 0.5, y: r + 0.5 })).toEqual(VOXEL);
    const world = xform.imageToWorldCoord({ x: c + 0.5, y: r + 0.5 });
    s.gridToCoord(VOXEL).forEach((v, d) => expect(world[d]).toBeCloseTo(v, 9));
  });

  it.each(VIEWS)('%s: a click anywhere inside the texel selects that voxel', (_name, axes) => {
    const s = space();
    const { c, r, index } = markedTexel(axes);
    const transformer = new CoordinateTransformer(s, axes, index);

    for (const [dx, dy] of [[0.05, 0.05], [0.5, 0.5], [0.95, 0.95], [0.05, 0.95], [0.95, 0.05]]) {
      const pt = { x: c + dx, y: r + dy };
      // SliceController.onPointerDown and the readout in onPointerMove.
      expect(transformer.sliceToVolumeCoord(pt).map(Math.round)).toEqual(VOXEL);
      expect(transformer.sliceToVolumeCoordSafe(pt, { clamp: true })!.map(Math.round)).toEqual(VOXEL);
    }
    expect(transformer.volumeToLocalSliceCoordSafe(VOXEL)).toEqual({ x: c + 0.5, y: r + 0.5 });
  });
});
