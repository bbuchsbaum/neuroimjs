import { describe, it, expect } from 'vitest';
import { SpatialFilter } from '../../src/spatial/SpatialFilter';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';

describe('Guided Filter', () => {
  const space = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0]);
  const n = 1000;

  it('uniform input returns same values', () => {
    const d = new Float32Array(n);
    d.fill(42);
    const vol = new FloatNeuroVol(space, d);
    const filter = new SpatialFilter(vol);

    const result = filter.guidedFilter({ radius: 2, epsilon: 0.01 });
    const rd = result.getData();
    for (let i = 0; i < n; i++) {
      expect(rd[i]).toBeCloseTo(42, 2);
    }
  });

  it('preserves edges (step function)', () => {
    const d = new Float32Array(n);
    // Step function: left half = 0, right half = 100
    for (let k = 0; k < 10; k++) {
      for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 10; i++) {
          const idx = i + j * 10 + k * 100;
          d[idx] = i < 5 ? 0 : 100;
        }
      }
    }
    const vol = new FloatNeuroVol(space, d);
    const filter = new SpatialFilter(vol);

    const result = filter.guidedFilter({ radius: 1, epsilon: 0.001 });
    const rd = result.getData();

    // Deep interior of left side should still be near 0
    expect(rd[0 + 5 * 10 + 5 * 100]).toBeCloseTo(0, 0);
    // Deep interior of right side should still be near 100
    expect(rd[9 + 5 * 10 + 5 * 100]).toBeCloseTo(100, 0);
  });

  it('smooths noisy data while preserving structure', () => {
    const d = new Float32Array(n);
    // Sphere with additive noise
    for (let k = 0; k < 10; k++) {
      for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 10; i++) {
          const idx = i + j * 10 + k * 100;
          const dist = Math.sqrt((i - 5) ** 2 + (j - 5) ** 2 + (k - 5) ** 2);
          d[idx] = (dist <= 3 ? 100 : 0) + (Math.sin(i * 7 + j * 13 + k * 17) * 5);
        }
      }
    }
    const vol = new FloatNeuroVol(space, d);
    const filter = new SpatialFilter(vol);

    const result = filter.guidedFilter({ radius: 2, epsilon: 10 });
    const rd = result.getData();

    // Center should still be high
    expect(rd[5 + 5 * 10 + 5 * 100]).toBeGreaterThan(50);
    // Corner should still be low
    expect(rd[0]).toBeLessThan(50);
  });

  it('works with external guide volume', () => {
    const signal = new Float32Array(n);
    const guide = new Float32Array(n);

    for (let k = 0; k < 10; k++) {
      for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 10; i++) {
          const idx = i + j * 10 + k * 100;
          signal[idx] = i < 5 ? 10 : 50;
          guide[idx] = i < 5 ? 0 : 100;
        }
      }
    }

    const signalVol = new FloatNeuroVol(space, signal);
    const guideVol = new FloatNeuroVol(space, guide);
    const filter = new SpatialFilter(signalVol);

    const result = filter.guidedFilter({ radius: 2, epsilon: 0.01, guide: guideVol });
    const rd = result.getData();

    // Interior left should be near 10
    expect(rd[0 + 5 * 10 + 5 * 100]).toBeCloseTo(10, 0);
    // Interior right should be near 50
    expect(rd[9 + 5 * 10 + 5 * 100]).toBeCloseTo(50, 0);
  });

  it('returns FloatNeuroVol with same space', () => {
    const d = new Float32Array(n).fill(1);
    const vol = new FloatNeuroVol(space, d);
    const filter = new SpatialFilter(vol);
    const result = filter.guidedFilter({ radius: 1, epsilon: 0.1 });
    expect(result.dim).toEqual(vol.dim);
  });
});
