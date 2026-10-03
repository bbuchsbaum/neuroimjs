// File: tests/SliceStorageOrientation.test.ts
//
// The displayed slices of a volume must not depend on its storage order. The
// same image stored LPI and RPI (first axis right-to-left, negative x scale)
// must give identical slices in every view the orthogonal viewer uses.

import { describe, it, expect } from 'vitest';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../src/geometry/Axis';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { VolLayer } from '../src/display/VolLayer';
import { SliceModel } from '../src/display/SliceModel';
import { ColorMap } from '../src/display/ColorMap';
import { SparseNeuroVol } from '../src/sparse/SparseNeuroVol';
import { NeuroVol } from '../src/volume/NeuroVol';

const DIM = [19, 23, 17];

const lpiSpace = () => new NeuroSpace(DIM, [2, 2, 2], [-18, -22, -16], AxisSet3D.AXIAL_LPI);

const rpiSpace = () => new NeuroSpace(DIM, [2, 2, 2], [18, -22, -16], AxisSet3D.AXIAL_RPI,
  [[-2, 0, 0, 18], [0, 2, 0, -22], [0, 0, 2, -16], [0, 0, 0, 1]]);

// Value depends on all three LPI voxel indices so that any flip is visible.
const value = (i: number, j: number, k: number) => 1 + i + 100 * j + 10000 * k;

function makeVolume(space: NeuroSpace, mirrorX: boolean, f = value): FloatNeuroVol {
  const [nx, ny, nz] = DIM;
  const data = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        data[i + nx * (j + ny * k)] = f(mirrorX ? nx - 1 - i : i, j, k);
  return new FloatNeuroVol(space, data);
}

const lpi = () => makeVolume(lpiSpace(), false);
const rpi = () => makeVolume(rpiSpace(), true);

// The views of OrthogonalImageViewer.
const VIEWS = [
  ['axial', AxisSet3D.AXIAL_LPI],
  ['coronal', AxisSet3D.CORONAL_LIP],
  ['sagittal', AxisSet3D.SAGITTAL_AIL],
] as const;

describe('slice extraction is independent of storage order', () => {
  it('stores the same world image in both volumes', () => {
    const a = lpi();
    const b = rpi();
    for (const world of [[-14, 4, 2], [10, -20, 14], [0, 0, 0]]) {
      const ga = a.space.coordToGrid(world).map(Math.round);
      const gb = b.space.coordToGrid(world).map(Math.round);
      expect(b.getAt(gb[0], gb[1], gb[2])).toBe(a.getAt(ga[0], ga[1], ga[2]));
    }
  });

  // The slice index the viewers use (SliceModel.currentSliceIndex and the
  // extract*Slice helpers): the volume's own voxel index along the pinned axis.
  const sliceIndexAt = (vol: FloatNeuroVol, axes: AxisSet3D, world: number[]) =>
    Math.round(vol.space.coordToGrid(world)[vol.space.whichDim(axes.k)]);

  // One world point per plane along x, y and z.
  const planes = (): number[][] => {
    const pts: number[][] = [];
    for (let i = 0; i < DIM[0]; i++) pts.push([-18 + 2 * i, 4, 2]);
    for (let j = 0; j < DIM[1]; j++) pts.push([-14, -22 + 2 * j, 2]);
    for (let k = 0; k < DIM[2]; k++) pts.push([-14, 4, -16 + 2 * k]);
    return pts;
  };

  it.each(VIEWS)('%s: the slice through a world point has the same pixels and geometry', (_name, axes) => {
    const a = lpi();
    const b = rpi();
    for (const world of planes()) {
      const sa = a.getSlice(sliceIndexAt(a, axes, world), axes);
      const sb = b.getSlice(sliceIndexAt(b, axes, world), axes);
      expect(Array.from(sb.data)).toEqual(Array.from(sa.data));
      expect(sb.space.dim).toEqual(sa.space.dim);
      expect(sb.space.gridToCoord([0, 0])).toEqual(sa.space.gridToCoord([0, 0]));
    }
  });

  it.each(VIEWS)('%s: getSlice agrees with world-coordinate sampling (getSliceAt)', (_name, axes) => {
    for (const vol of [lpi(), rpi()]) {
      for (const world of planes()) {
        const byIndex = vol.getSlice(sliceIndexAt(vol, axes, world), axes);
        const byWorld = vol.getSliceAt(world, axes, 'nearest');
        expect(Array.from(byIndex.data)).toEqual(Array.from(byWorld.data));
      }
    }
  });

  it.each(VIEWS)('%s: a left-hemisphere marker lands in its LPI pixel', (_name, axes) => {
    // World (-14, 4, 2) is left of the midline: LPI voxel (2, 13, 9).
    const world = [-14, 4, 2];
    const expected = lpi();
    const g0 = expected.space.coordToGrid(world).map(Math.round);
    expected.setAt(g0[0], g0[1], g0[2], -1);
    const want = Array.from(expected.getSlice(sliceIndexAt(expected, axes, world), axes).data).indexOf(-1);
    expect(want).toBeGreaterThanOrEqual(0);

    const vol = rpi();
    const g = vol.space.coordToGrid(world).map(Math.round);
    expect(g[0]).toBe(16);
    vol.setAt(g[0], g[1], g[2], -1);
    const slice = vol.getSlice(sliceIndexAt(vol, axes, world), axes);
    expect(Array.from(slice.data).indexOf(-1)).toBe(want);
  });

  it('coronal: column 0 is the patient\'s left', () => {
    const world = [-14, 4, 2];
    const vol = rpi();
    const g = vol.space.coordToGrid(world).map(Math.round);
    vol.setAt(g[0], g[1], g[2], -1);
    const slice = vol.getSlice(sliceIndexAt(vol, AxisSet3D.CORONAL_LIP, world), AxisSet3D.CORONAL_LIP);
    // x = -18 mm is column 0, so x = -14 mm is column 2 (not 16).
    expect(Array.from(slice.data).indexOf(-1) % slice.space.dim[0]).toBe(2);
  });

  it.each(VIEWS)('%s: the viewer path (SliceModel index -> VolLayer.getSlice) renders identical RGBA', (_name, axes) => {
    // A coarse pattern that survives 8-bit colour mapping: left-right ramp
    // plus a step in y and z.
    const pattern = (i: number, j: number, k: number) => i + 20 * (j % 2) + 40 * (k % 2);
    const world = [-14, 4, 2];
    const rgba = (vol: FloatNeuroVol) => {
      const layer = new VolLayer('v', vol, ColorMap.fromPreset('Viridis'), [0, 80]);
      const model = new SliceModel(vol.space.dim[vol.space.whichDim(axes.k)], world, vol.space, axes);
      return Array.from(layer.getSlice(model.currentSliceIndex, axes).data.data);
    };
    const want = rgba(makeVolume(lpiSpace(), false, pattern));
    expect(new Set(want).size).toBeGreaterThan(10);
    expect(rgba(makeVolume(rpiSpace(), true, pattern))).toEqual(want);
  });
});

// Every storage order with flipped in-plane axes, as dense and sparse volumes.
// LAI and RAI flip the posterior-anterior axis, which is the pinned axis of
// the coronal view.
const STORAGE = [
  ['RPI', true, false],
  ['LAI', false, true],
  ['RAI', true, true],
] as const;

function storedSpace(flipX: boolean, flipY: boolean): NeuroSpace {
  const axes = new AxisSet3D(
    flipX ? NamedAxis.RIGHT_LEFT : NamedAxis.LEFT_RIGHT,
    flipY ? NamedAxis.ANT_POST : NamedAxis.POST_ANT,
    NamedAxis.INF_SUP
  );
  const sx = flipX ? -2 : 2;
  const sy = flipY ? -2 : 2;
  const ox = flipX ? 18 : -18;
  const oy = flipY ? 22 : -22;
  return new NeuroSpace(DIM, [2, 2, 2], [ox, oy, -16], axes,
    [[sx, 0, 0, ox], [0, sy, 0, oy], [0, 0, 2, -16], [0, 0, 0, 1]]);
}

function storedVolume(flipX: boolean, flipY: boolean): FloatNeuroVol {
  const [nx, ny, nz] = DIM;
  const data = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        data[i + nx * (j + ny * k)] = value(flipX ? nx - 1 - i : i, flipY ? ny - 1 - j : j, k);
  return new FloatNeuroVol(storedSpace(flipX, flipY), data);
}

describe.each(STORAGE)('%s storage gives the LPI slices', (_name, flipX, flipY) => {
  const sliceIndexAt = (vol: NeuroVol, axes: AxisSet3D, world: number[]) =>
    Math.round(vol.space.coordToGrid(world)[vol.space.whichDim(axes.k)]);
  const worlds = [[-14, 4, 2], [10, -20, 14], [0, 18, -16], [18, 22, 16]];

  it.each([
    ['dense', (v: FloatNeuroVol): NeuroVol => v],
    ['sparse', (v: FloatNeuroVol): NeuroVol => SparseNeuroVol.fromDense(v)],
  ] as const)('%s', (_kind, wrap) => {
    const reference = lpi();
    const vol = wrap(storedVolume(flipX, flipY));
    for (const [, axes] of VIEWS) {
      for (const world of worlds) {
        const want = reference.getSlice(sliceIndexAt(reference, axes, world), axes);
        const got = vol.getSlice(sliceIndexAt(vol, axes, world), axes);
        expect(Array.from(got.data)).toEqual(Array.from(want.data));
      }
    }
  });
});

