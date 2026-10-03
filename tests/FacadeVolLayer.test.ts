// File: tests/FacadeVolLayer.test.ts
//
// Unmocked VolStack/FacadeVolLayer tests: a layer whose storage axes differ from
// the reference layer's is wrapped in a FacadeVolLayer (issue #7).

import { describe, it, expect } from 'vitest';
import { autorun } from 'mobx';
import { VolStack } from '../src/display/VolStack';
import { VolLayer } from '../src/display/VolLayer';
import { FacadeVolLayer } from '../src/display/FacadeVolLayer';
import { ColorMap } from '../src/display/ColorMap';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { AxisSet3D } from '../src/geometry/Axis';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';

const DIM = [19, 23, 17];

function lpiSpace(): NeuroSpace {
  return new NeuroSpace(DIM, [2, 2, 2], [-18, -22, -16], AxisSet3D.AXIAL_LPI);
}

// The same grid stored right-to-left along the first axis (negative x scale).
function rpiSpace(): NeuroSpace {
  return new NeuroSpace(DIM, [2, 2, 2], [18, -22, -16], AxisSet3D.AXIAL_RPI,
    [[-2, 0, 0, 18], [0, 2, 0, -22], [0, 0, 2, -16], [0, 0, 0, 1]]);
}

// A pattern that survives 8-bit colour mapping: a left-right ramp plus a
// step in y and z, so that flips and wrong planes change the RGBA output.
const value = (i: number, j: number, k: number) => i + 20 * (j % 2) + 40 * (k % 2);

function lpiData(): Float32Array {
  const [nx, ny, nz] = DIM;
  const out = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) out[i + nx * (j + ny * k)] = value(i, j, k);
  return out;
}

// RPI voxel i holds the LPI voxel at nx - 1 - i: identical world content.
function rpiData(): Float32Array {
  const [nx, ny, nz] = DIM;
  const out = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) out[i + nx * (j + ny * k)] = value(nx - 1 - i, j, k);
  return out;
}

const cmap = () => ColorMap.fromPreset('Viridis');
const RANGE: [number, number] = [0, 80];

describe('FacadeVolLayer (issue #7)', () => {
  it('VolStack accepts a layer stored in a different orientation', () => {
    const template = new VolLayer('template', new FloatNeuroVol(lpiSpace(), lpiData()), cmap(), RANGE);
    const rpi = new VolLayer('rpi', new FloatNeuroVol(rpiSpace(), rpiData()), cmap(), RANGE);

    const stack = new VolStack(template, rpi);

    expect(stack.length).toBe(2);
    const wrapped = stack.getLayer(1);
    expect(wrapped).toBeInstanceOf(FacadeVolLayer);
    expect(wrapped.space.axes.equals(AxisSet3D.AXIAL_LPI)).toBe(true);
  });

  it('keeps the wrapped layer id, and display changes reach both layers', () => {
    const template = new VolLayer('template', new FloatNeuroVol(lpiSpace(), lpiData()), cmap(), RANGE);
    const rpi = new VolLayer('rpi', new FloatNeuroVol(rpiSpace(), rpiData()), cmap(), RANGE);
    const stack = new VolStack(template, rpi);
    const wrapped = stack.getLayerById('rpi');
    expect(wrapped).toBe(stack.getLayer(1));

    // Renderers re-draw when a layer's `version` changes.
    const seen: number[] = [];
    const dispose = autorun(() => { seen.push(wrapped!.version); });
    wrapped!.setOpacity(0.5);
    wrapped!.setRange([10, 20]);
    wrapped!.setThreshold([1, 2]);
    wrapped!.setVisible(false);
    wrapped!.setInterpolation('nearest');
    dispose();
    expect(seen.length).toBeGreaterThan(1);

    for (const layer of [wrapped!, rpi]) {
      expect(layer.opacity).toBe(0.5);
      expect(layer.getRange()).toEqual([10, 20]);
      expect(layer.getThreshold()).toEqual([1, 2]);
      expect(layer.visible).toBe(false);
      expect(layer.interpolation).toBe('nearest');
    }
  });

  it('serves the same axial slice as the equivalent LPI-stored layer', () => {
    const template = new VolLayer('template', new FloatNeuroVol(lpiSpace(), lpiData()), cmap(), RANGE);
    const rpi = new VolLayer('rpi', new FloatNeuroVol(rpiSpace(), rpiData()), cmap(), RANGE);
    const stack = new VolStack(template, rpi);

    const k = 8;
    const [ref, wrapped] = stack.getSlice(k, AxisSet3D.AXIAL_LPI);
    expect(wrapped.width).toBe(ref.width);
    expect(wrapped.height).toBe(ref.height);
    expect(Array.from(wrapped.data.data)).toEqual(Array.from(ref.data.data));
  });

  it('serves the same sagittal slices as the equivalent LPI-stored layer', () => {
    const template = new VolLayer('template', new FloatNeuroVol(lpiSpace(), lpiData()), cmap(), RANGE);
    const rpi = new VolLayer('rpi', new FloatNeuroVol(rpiSpace(), rpiData()), cmap(), RANGE);
    const stack = new VolStack(template, rpi);

    for (let index = 0; index < DIM[0]; index++) {
      const [ref, wrapped] = stack.getSlice(index, AxisSet3D.SAGITTAL_AIL);
      expect([wrapped.width, wrapped.height]).toEqual([ref.width, ref.height]);
      expect(Array.from(wrapped.data.data)).toEqual(Array.from(ref.data.data));
    }
  });

  it('slices the wrapped layer at its own index for the reference plane', () => {
    const template = new VolLayer('template', new FloatNeuroVol(lpiSpace(), lpiData()), cmap(), RANGE);
    const rpi = new VolLayer('rpi', new FloatNeuroVol(rpiSpace(), rpiData()), cmap(), RANGE);
    const stack = new VolStack(template, rpi);
    const calls: number[] = [];
    const original = rpi.getSlice.bind(rpi);
    rpi.getSlice = (index: number, axes: AxisSet3D) => { calls.push(index); return original(index, axes); };

    // LPI voxel i and RPI voxel 18 - i lie on the same sagittal plane; the
    // coronal and axial indices are shared.
    stack.getLayer(1).getSlice(2, AxisSet3D.SAGITTAL_AIL);
    stack.getLayer(1).getSlice(5, AxisSet3D.CORONAL_LIP);
    stack.getLayer(1).getSlice(7, AxisSet3D.AXIAL_LPI);
    expect(calls).toEqual([16, 5, 7]);
  });

  it('reads world coordinates unchanged', () => {
    const template = new VolLayer('template', new FloatNeuroVol(lpiSpace(), lpiData()), cmap(), RANGE);
    const rpi = new VolLayer('rpi', new FloatNeuroVol(rpiSpace(), rpiData()), cmap(), RANGE);
    const stack = new VolStack(template, rpi);

    // x = -14 mm is LPI voxel 2 and RPI voxel 16.
    for (const axes of [AxisSet3D.AXIAL_LPI, AxisSet3D.SAGITTAL_AIL, AxisSet3D.CORONAL_LIP]) {
      const [ref, wrapped] = stack.getSliceAt([-14, 4, 2], axes, 'nearest');
      expect(Array.from(wrapped.data.data)).toEqual(Array.from(ref.data.data));
    }
    const ortho = stack.getOrthoSliceAt([-14, 4, 2], 'nearest');
    for (const view of ['axial', 'sagittal', 'coronal'] as const) {
      expect(Array.from(ortho[view][1].data.data)).toEqual(Array.from(ortho[view][0].data.data));
    }
  });
});
