import { describe, expect, it } from 'vitest';
import { ColorMap } from '../../src/display/ColorMap';

describe('ColorMap legend helpers', () => {
  it('samples the current range using the same discrete LUT lookup as rendering', () => {
    const map = new ColorMap([[0, 0, 1], [1, 1, 1], [1, 0, 0]], { range: [-2, 2] });
    expect(map.toStops(3)).toEqual([
      { value: -2, color: 'rgba(0, 0, 255, 1)' },
      { value: 0, color: 'rgba(255, 255, 255, 1)' },
      { value: 2, color: 'rgba(255, 0, 0, 1)' },
    ]);
    expect(() => map.toStops(1)).toThrow(RangeError);
    map.setRange([0, 4]);
    expect(map.toStops(2).map(stop => stop.value)).toEqual([0, 4]);
  });

  it('uses LUT colors and alpha, with a transparent threshold band', () => {
    const map = new ColorMap([[0, 0, 1, 0.5], [1, 1, 1, 0.75], [1, 0, 0, 1]],
      { range: [-2, 2], threshold: [-0.5, 0.5] });
    const gradient = map.toCSSGradient('to right');
    expect(gradient).toContain('rgba(0, 0, 255, 0.5) 0%');
    expect(gradient).toContain('rgba(255, 255, 255, 0) 50%');
    expect(gradient).toContain('rgba(255, 0, 0, 1) 100%');
    expect(map.toStops(5)[2].color).toBe('rgba(255, 255, 255, 0)');
  });
});
