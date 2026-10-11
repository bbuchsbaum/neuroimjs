import { describe, expect, it } from 'vitest';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';

describe('ColorMapFactory normalized tuple inputs', () => {
  it('preserves normalized RGB endpoints when creating a gradient', () => {
    const colors = ColorMapFactory.createGradient([1, 0, 0], [0, 0, 1], 3).getColorMap();

    expect(colors[0]).toEqual([1, 0, 0]);
    expect(colors[2]).toEqual([0, 0, 1]);
  });

  it('preserves normalized RGB stops in a multi-stop map', () => {
    const colors = ColorMapFactory.createMultiStop(
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      3
    ).getColorMap();

    expect(colors[0]).toEqual([1, 0, 0]);
    expect(colors[2]).toEqual([0, 0, 1]);
  });

  it('defaults diverging interpolation to RGB and permits an explicit LCH mode', () => {
    const args = ['#4f9de0', '#fff2c0', '#ec6b28'] as const;
    const rgb = ColorMapFactory.createDiverging(...args, 5).getColorMap();
    const lch = ColorMapFactory.createDiverging(...args, 5, { mode: 'lch' }).getColorMap();
    expect(rgb[1][2]).toBeGreaterThan(rgb[1][1]); // blue-to-cream, without a green sweep
    expect(rgb[2][0]).toBeCloseTo(1, 2);
    expect(rgb[2][1]).toBeCloseTo(242 / 255, 2);
    expect(lch[1]).not.toEqual(rgb[1]);
  });
});
