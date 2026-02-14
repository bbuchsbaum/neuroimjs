import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ColorMap } from '../src/display/ColorMap';

describe('ColorMap', () => {
  let colorMap;
  let colorMapWithAlpha;

  beforeEach(() => {
    colorMap = new ColorMap([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
      [1, 1, 1]
    ]);
    colorMapWithAlpha = new ColorMap([
      [0, 0, 0, 1],
      [0.5, 0.5, 0.5, 1],
      [1, 1, 1, 1]
    ]);
  });

  it('constructor creates a ColorMap instance', () => {
    expect(colorMap).toBeInstanceOf(ColorMap);
    expect(colorMapWithAlpha).toBeInstanceOf(ColorMap);
  });

  it('getColor returns the correct color for a given value', () => {
    expect(colorMap.getColor(0)).toEqual([0, 0, 0]);
    expect(colorMap.getColor(0.5)).toEqual([0.5, 0.5, 0.5]);
    expect(colorMap.getColor(1)).toEqual([1, 1, 1]);

    expect(colorMapWithAlpha.getColor(0)).toEqual([0, 0, 0, 1]);
    expect(colorMapWithAlpha.getColor(0.5)).toEqual([0.5, 0.5, 0.5, 1]);
    expect(colorMapWithAlpha.getColor(1)).toEqual([1, 1, 1, 1]);
  });

  it('setRange updates the range and emits event', () => {
    const mockHandler = vi.fn();
    colorMap.on('rangeChanged', mockHandler);
    
    colorMap.setRange([0, 100]);
    expect(mockHandler).toHaveBeenCalledWith([0, 100]);
  });

  it('setThreshold updates the threshold and emits event', () => {
    const mockHandler = vi.fn();
    colorMap.on('thresholdChanged', mockHandler);
    
    colorMap.setThreshold([10, 90]);
    expect(mockHandler).toHaveBeenCalledWith([10, 90]);

    // Test invalid threshold (low > high)
    colorMap.setThreshold([90, 10]);
    expect(mockHandler).toHaveBeenCalledWith([0, 0]); // Should reset to default
  });

  it('setAlpha updates alpha values and emits event', () => {
    const mockHandler = vi.fn();
    colorMap.on('alphaChanged', mockHandler);
    
    colorMap.setAlpha(0.5);
    expect(mockHandler).toHaveBeenCalledWith([true]);
    expect(colorMap.getColor(0)[3]).toBe(0.5);
    expect(colorMap.hasAlpha).toBe(true);

    const noAlphaMockHandler = vi.fn();
    const noAlphaColorMap = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    noAlphaColorMap.on('alphaChanged', noAlphaMockHandler);
    expect(noAlphaColorMap.hasAlpha).toBe(false);
    expect(noAlphaColorMap.getColor(0)).toEqual([0, 0, 0]);
  });

  it('getColorArray returns correct Float32Array', () => {
    const values = [0, 0.5, 1];
    const colorArray = colorMap.getColorArray(values);
    
    expect(colorArray).toBeInstanceOf(Float32Array);
    expect(Array.from(colorArray)).toEqual([
      0, 0, 0,
      0.5, 0.5, 0.5,
      1, 1, 1
    ]);

    const colorArrayWithAlpha = colorMapWithAlpha.getColorArray(values);
    expect(colorArrayWithAlpha).toBeInstanceOf(Float32Array);
    expect(Array.from(colorArrayWithAlpha)).toEqual([
      0, 0, 0, 1,
      0.5, 0.5, 0.5, 1,
      1, 1, 1, 1
    ]);

    // Test with threshold
    colorMapWithAlpha.setThreshold([0.25, 0.75]);
    const thresholdColorArray = colorMapWithAlpha.getColorArray(values);
    expect(Array.from(thresholdColorArray)).toEqual([
      0, 0, 0, 1,
      0.5, 0.5, 0.5, 0,
      1, 1, 1, 1
    ]);
  });

  it('fromPreset creates a ColorMap from a preset', () => {
    const presetMap = ColorMap.fromPreset('Viridis');
    expect(presetMap).toBeInstanceOf(ColorMap);
    expect(presetMap.getColor(0)).not.toEqual(presetMap.getColor(1));
  });

  it('copy creates a new ColorMap with new colors', () => {
    // Test copying RGB ColorMap
    const newColorsRGB = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const copiedMapRGB = colorMap.copy(newColorsRGB);
    
    expect(copiedMapRGB).toBeInstanceOf(ColorMap);
    expect(copiedMapRGB.getColor(0)).toEqual([1, 0, 0]);
    expect(copiedMapRGB.getColor(0.5)).toEqual([0, 1, 0]);
    expect(copiedMapRGB.getColor(1)).toEqual([0, 0, 1]);
    expect(copiedMapRGB.hasAlpha).toBe(false);

    // Test copying RGBA ColorMap
    const newColorsRGBA = [[1, 0, 0, 1], [0, 1, 0, 0.5], [0, 0, 1, 0]];
    const copiedMapRGBA = colorMapWithAlpha.copy(newColorsRGBA);
    
    expect(copiedMapRGBA).toBeInstanceOf(ColorMap);
    expect(copiedMapRGBA.getColor(0)).toEqual([1, 0, 0, 1]);
    expect(copiedMapRGBA.getColor(0.5)).toEqual([0, 1, 0, 0.5]);
    expect(copiedMapRGBA.getColor(1)).toEqual([0, 0, 1, 0]);
    expect(copiedMapRGBA.hasAlpha).toBe(true);
  });

  it('throws an error for inconsistent color formats', () => {
    const inconsistentColors = [
      [1, 0, 0],
      [0, 1, 0, 0.5],
      [0, 0, 1]
    ];
    expect(() => new ColorMap(inconsistentColors)).toThrow(TypeError);
  });

  it('applies thresholding correctly', () => {
    const colorMap = new ColorMap([
      [0, 0, 0, 1],
      [0.5, 0.5, 0.5, 1],
      [1, 1, 1, 1]
    ], { range: [0, 100], threshold: [25, 75], alpha: 0.5 });

    // Value below threshold, should be opaque
    expect(colorMap.getColor(0)).toEqual([0, 0, 0, 0.5]);

    // Value within threshold, should be transparent
    expect(colorMap.getColor(50)).toEqual([0.5, 0.5, 0.5, 0]);

    // Value above threshold, should be opaque
    expect(colorMap.getColor(100)).toEqual([1, 1, 1, 0.5]);

    // Test with [0, 0] threshold (everything opaque)
    colorMap.setThreshold([0, 0]);
    expect(colorMap.getColor(50)).toEqual([0.5, 0.5, 0.5, 0.5]);

    // Test with invalid threshold (should default to [0, 0])
    colorMap.setThreshold([75, 25]);
    expect(colorMap.getColor(50)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('respects alpha values for non-thresholded colors', () => {
    const colorMap = new ColorMap([
      [0, 0, 0, 0.2],
      [0.5, 0.5, 0.5, 0.5],
      [1, 1, 1, 0.8]
    ], { range: [0, 100], threshold: [25, 75] });

    // Values outside threshold should keep their original alpha
    expect(colorMap.getColor(0)).toEqual([0, 0, 0, 0.2]);
    expect(colorMap.getColor(100)).toEqual([1, 1, 1, 0.8]);

    // Values within threshold should be fully transparent
    expect(colorMap.getColor(50)).toEqual([0.5, 0.5, 0.5, 0]);
  });
});
