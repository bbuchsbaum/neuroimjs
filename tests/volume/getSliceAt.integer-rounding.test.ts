import { describe, expect, it } from 'vitest';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol, Int16NeuroVol, UInt16NeuroVol } from '../../src/volume/DenseNeuroVol';

const axes = new AxisSet3D(
  NamedAxis.LEFT_RIGHT,
  NamedAxis.POST_ANT,
  NamedAxis.INF_SUP,
);
const space = new NeuroSpace([3, 3, 2], [1, 1, 1], [0, 0, 0], axes);

function planes(Ctor: typeof Int16Array | typeof Uint16Array | typeof Float32Array, low: number, high: number) {
  const data = new Ctor(18);
  for (let i = 0; i < 9; i++) {
    data[i] = low;
    data[i + 9] = high;
  }
  return data;
}

describe('DenseNeuroVol.getSliceAt() integer trilinear rounding', () => {
  it('rounds positive uint16 interpolation instead of truncating it', () => {
    const vol = new UInt16NeuroVol(space, planes(Uint16Array, 1, 2));
    const slice = vol.getSliceAt([0, 0, 0.6], axes, 'trilinear');

    expect(slice.getData()).toBeInstanceOf(Uint16Array);
    expect(slice.getData()[0]).toBe(2);
  });

  it('rounds signed int16 interpolation to the nearest integer', () => {
    const vol = new Int16NeuroVol(space, planes(Int16Array, -1, -2));
    const slice = vol.getSliceAt([0, 0, 0.6], axes, 'trilinear');

    expect(slice.getData()).toBeInstanceOf(Int16Array);
    expect(slice.getData()[0]).toBe(-2);
  });

  it('retains fractional trilinear values for float storage', () => {
    const vol = new FloatNeuroVol(space, planes(Float32Array, 1, 2));
    const slice = vol.getSliceAt([0, 0, 0.6], axes, 'trilinear');

    expect(slice.getData()).toBeInstanceOf(Float32Array);
    expect(slice.getData()[0]).toBeCloseTo(1.6, 6);
  });
});
