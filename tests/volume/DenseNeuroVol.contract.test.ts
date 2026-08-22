import { describe, expect, it } from 'vitest';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';

describe('DenseNeuroVol contracts', () => {
  it('requires exactly three dimensions and an exact-sized backing array', () => {
    expect(() => new FloatNeuroVol(
      new NeuroSpace([2, 2, 2]),
      new Float32Array(1)
    )).toThrow(/Data length mismatch/);

    expect(() => new FloatNeuroVol(
      new NeuroSpace([2, 2, 2, 2]),
      new Float32Array(16)
    )).toThrow(/3-dimensional/);
  });

  it('throws for invalid flat and voxel coordinates instead of returning undefined', () => {
    const volume = new FloatNeuroVol(
      new NeuroSpace([2, 2, 2]),
      Float32Array.from({ length: 8 }, (_, index) => index)
    );

    expect(() => volume.get(-1)).toThrow(RangeError);
    expect(() => volume.get(8)).toThrow(RangeError);
    expect(() => volume.getAt(2, 0, 0)).toThrow(RangeError);
    expect(() => volume.getAt(0.5, 0, 0)).toThrow(RangeError);
    expect(() => volume.setAt(0, 0, -1, 3)).toThrow(RangeError);
  });

  it('ignores non-finite values when deriving a display range', () => {
    const volume = new FloatNeuroVol(
      new NeuroSpace([2, 2, 1]),
      new Float32Array([Number.NaN, Number.NEGATIVE_INFINITY, -2, 4])
    );

    expect(volume.getRange()).toEqual([-2, 4]);
  });
});
