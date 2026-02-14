import { describe, it, expect } from 'vitest';
import { concat } from '../../src/stats/stats';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';

describe('concat', () => {
  const space = new NeuroSpace([4, 5, 6], [1, 1, 1], [0, 0, 0]);
  const spatialSize = 4 * 5 * 6;

  function makeVol(fill: number): FloatNeuroVol {
    const d = new Float32Array(spatialSize);
    d.fill(fill);
    return new FloatNeuroVol(space, d);
  }

  it('concatenates volumes into a 4D vec', () => {
    const vols = [makeVol(1), makeVol(2), makeVol(3)];
    const vec = concat(vols);

    expect(vec.dim).toEqual([4, 5, 6, 3]);
    expect(vec.getAt(0, 0, 0, 0)).toBeCloseTo(1);
    expect(vec.getAt(0, 0, 0, 1)).toBeCloseTo(2);
    expect(vec.getAt(0, 0, 0, 2)).toBeCloseTo(3);
  });

  it('preserves per-volume spatial data', () => {
    const v1 = new FloatNeuroVol(space, Float32Array.from({ length: spatialSize }, (_, i) => i));
    const v2 = new FloatNeuroVol(space, Float32Array.from({ length: spatialSize }, (_, i) => i * 2));
    const vec = concat([v1, v2]);

    // Check specific voxel across time
    for (let i = 0; i < spatialSize; i++) {
      expect(vec.getData()[i]).toBeCloseTo(i);                  // t=0
      expect(vec.getData()[i + spatialSize]).toBeCloseTo(i * 2); // t=1
    }
  });

  it('throws on empty input', () => {
    expect(() => concat([])).toThrow(/at least one/i);
  });

  it('throws on dimension mismatch', () => {
    const other = new NeuroSpace([3, 5, 6], [1, 1, 1], [0, 0, 0]);
    const v1 = makeVol(1);
    const v2 = new FloatNeuroVol(other, new Float32Array(3 * 5 * 6));
    expect(() => concat([v1, v2])).toThrow(/dimensions/i);
  });

  it('single volume produces T=1 vec', () => {
    const vec = concat([makeVol(42)]);
    expect(vec.dim[3]).toBe(1);
    expect(vec.getAt(0, 0, 0, 0)).toBeCloseTo(42);
  });
});
