import { describe, it, expect } from 'vitest';
import { buildScatterField } from '../../src/utils/ScatterFieldBuilder';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';

describe('buildScatterField', () => {
  const space = new NeuroSpace(
    [8, 8, 8],
    [1, 1, 1],
    [0, 0, 0],
    new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
  );

  it('builds a Gaussian scatter volume and reports stats', () => {
    const { volume, data, maxValue, nonZeroCount } = buildScatterField({
      space,
      points: [{ x: 0, y: 0, z: 0 }],
      kernelParams: { sigma: 2 },
      cutoffMm: 6,
      combine: 'max',
    });

    expect(volume.space.dim).toEqual([8, 8, 8]);
    expect(data.length).toBe(8 * 8 * 8);
    expect(maxValue).toBeGreaterThan(0);
    expect(nonZeroCount).toBeGreaterThan(0);
  });

  it('supports buffer reuse and sum combine', () => {
    const reuse = new Float32Array(8 * 8 * 8);
    const { data, maxValue } = buildScatterField({
      space,
      points: [
        { x: 0, y: 0, z: 0, weight: 1 },
        { x: 0, y: 0, z: 0, weight: 1 },
      ],
      kernelParams: { sigma: 1 },
      combine: 'sum',
      reuseBuffer: reuse,
    });

    expect(data).toBe(reuse); // buffer reused
    expect(maxValue).toBeGreaterThan(0);
  });
});
