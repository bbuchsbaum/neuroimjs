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
});
