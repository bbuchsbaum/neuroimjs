import { describe, test, expect, beforeEach, vi, beforeAll } from 'vitest';
import { ColorMap } from '../../src/display/ColorMap';
import { setupConsoleMocks } from './test-console-mock';

describe('ColorMap', () => {
  let colorMap: ColorMap;
  let colorMapWithAlpha: ColorMap;

  beforeAll(() => {
    setupConsoleMocks();
  });

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

  test('constructor creates a ColorMap instance', () => {
    expect(colorMap).toBeInstanceOf(ColorMap);
    expect(colorMapWithAlpha).toBeInstanceOf(ColorMap);
  });

  test('getColor returns the correct color for a given value', () => {
    expect(colorMap.getColor(0)).toEqual([0, 0, 0]);
    expect(colorMap.getColor(0.5)).toEqual([0.5, 0.5, 0.5]);
    expect(colorMap.getColor(1)).toEqual([1, 1, 1]);

    expect(colorMapWithAlpha.getColor(0)).toEqual([0, 0, 0, 1]);
    expect(colorMapWithAlpha.getColor(0.5)).toEqual([0.5, 0.5, 0.5, 1]);
    expect(colorMapWithAlpha.getColor(1)).toEqual([1, 1, 1, 1]);
  });

  test('setRange updates the range and emits event', () => {
    const mockHandler = vi.fn();
    colorMap.on('rangeChanged', mockHandler);
    
    colorMap.setRange([0, 100]);
    expect(mockHandler).toHaveBeenCalledWith([0, 100]);
  });

  test('setThreshold updates the threshold and emits event', () => {
    const mockHandler = vi.fn();
    colorMap.on('thresholdChanged', mockHandler);
    
    colorMap.setThreshold([10, 90]);
    expect(mockHandler).toHaveBeenCalledWith([10, 90]);

    // Test invalid threshold (low > high)
    colorMap.setThreshold([90, 10]);
    expect(mockHandler).toHaveBeenCalledWith([0, 0]); // Should reset to default
  });

  test('setAlpha updates alpha values and emits event', () => {
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

  test('getColorArray returns correct Float32Array', () => {
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

  test('fromPreset creates a ColorMap from a preset', () => {
    const presetMap = ColorMap.fromPreset('Viridis');
    expect(presetMap).toBeInstanceOf(ColorMap);
    expect(presetMap.getColor(0)).not.toEqual(presetMap.getColor(1));
  });

  test('copy creates a new ColorMap with new colors', () => {
    // Test copying RGB ColorMap
    const newColorsRGB: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const copiedMapRGB = colorMap.copy(newColorsRGB);
    
    expect(copiedMapRGB).toBeInstanceOf(ColorMap);
    expect(copiedMapRGB.getColor(0)).toEqual([1, 0, 0]);
    expect(copiedMapRGB.getColor(0.5)).toEqual([0, 1, 0]);
    expect(copiedMapRGB.getColor(1)).toEqual([0, 0, 1]);
    expect(copiedMapRGB.hasAlpha).toBe(false);

    // Test copying RGBA ColorMap
    const newColorsRGBA: [number, number, number, number][] = [[1, 0, 0, 1], [0, 1, 0, 0.5], [0, 0, 1, 0]];
    const copiedMapRGBA = colorMapWithAlpha.copy(newColorsRGBA);
    
    expect(copiedMapRGBA).toBeInstanceOf(ColorMap);
    expect(copiedMapRGBA.getColor(0)).toEqual([1, 0, 0, 1]);
    expect(copiedMapRGBA.getColor(0.5)).toEqual([0, 1, 0, 0.5]);
    expect(copiedMapRGBA.getColor(1)).toEqual([0, 0, 1, 0]);
    expect(copiedMapRGBA.hasAlpha).toBe(true);
  });

  test('throws an error for inconsistent color formats', () => {
    const inconsistentColors = [
      [1, 0, 0],
      [0, 1, 0, 0.5],
      [0, 0, 1]
    ] as any;
    expect(() => new ColorMap(inconsistentColors)).toThrow(TypeError);
  });

  test('applies thresholding correctly', () => {
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

  test('respects alpha values for non-thresholded colors', () => {
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

  test('handles edge cases for range detection', () => {
    // Test with very large values - range is no longer auto-adjusted
    const largeValueMap = new ColorMap([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
      [1, 1, 1]
    ], { range: [0, 10000000] });

    // 5000000 is at the middle of the range, so should get middle color
    expect(largeValueMap.getColor(5000000)).toEqual([0.5, 0.5, 0.5]);

    // Test with negative values (small range, no adjustment)
    const negativeMap = new ColorMap([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
      [1, 1, 1]
    ], { range: [-100, 100] });

    expect(negativeMap.getColor(-100)).toEqual([0, 0, 0]);
    expect(negativeMap.getColor(0)).toEqual([0.5, 0.5, 0.5]); // 50% maps to middle
    expect(negativeMap.getColor(100)).toEqual([1, 1, 1]);
  });

  test('handles color selection correctly', () => {
    const gradientMap = new ColorMap([
      [1, 0, 0],   // Red (index 0)
      [0, 1, 0],   // Green (index 1)
      [0, 0, 1]    // Blue (index 2)
    ]);

    // The current implementation picks colors by index, not interpolation
    // 0.25 maps to index 0 (red)
    const redSelection = gradientMap.getColor(0.25);
    expect(redSelection).toEqual([1, 0, 0]);

    // 0.75 maps to index 1 (green) - not 2 as expected
    const greenSelection2 = gradientMap.getColor(0.75);
    expect(greenSelection2).toEqual([0, 1, 0]);
    
    // 0.5 maps to index 1 (green)
    const greenSelection = gradientMap.getColor(0.5);
    expect(greenSelection).toEqual([0, 1, 0]);
    
    // 1.0 maps to index 2 (blue)
    const blueSelection = gradientMap.getColor(1.0);
    expect(blueSelection).toEqual([0, 0, 1]);
  });

  test('clamps values outside range', () => {
    colorMap.setRange([0, 100]);

    // Values below range should map to first color
    expect(colorMap.getColor(-50)).toEqual([0, 0, 0]);

    // Values above range should map to last color
    expect(colorMap.getColor(150)).toEqual([1, 1, 1]);
  });

  test('handles single color colormap', () => {
    const singleColorMap = new ColorMap([[0.5, 0.5, 0.5]]);
    
    // All values should return the same color
    expect(singleColorMap.getColor(0)).toEqual([0.5, 0.5, 0.5]);
    expect(singleColorMap.getColor(0.5)).toEqual([0.5, 0.5, 0.5]);
    expect(singleColorMap.getColor(1)).toEqual([0.5, 0.5, 0.5]);
  });

  test('emits events in correct order', () => {
    const events: string[] = [];

    colorMap.on('rangeChanged', () => events.push('range'));
    colorMap.on('thresholdChanged', () => events.push('threshold'));
    colorMap.on('alphaChanged', () => events.push('alpha'));

    colorMap.setRange([0, 200]);
    colorMap.setThreshold([50, 150]);
    colorMap.setAlpha(0.7);

    expect(events).toEqual(['range', 'threshold', 'alpha']);
  });

  describe('non-finite (NaN) values render transparent', () => {
    // Minimal ImageData-like stub; fillImageData only touches `.data`.
    const makeImageData = (numPixels: number) => ({
      data: new Uint8ClampedArray(numPixels * 4),
      width: numPixels,
      height: 1,
      colorSpace: 'srgb' as const,
    });

    test('fillImageData maps a NaN pixel to alpha=0 (transparent)', () => {
      const map = new ColorMap([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ], { range: [0, 100] });

      const img = makeImageData(3) as unknown as ImageData;
      // pixel 0: NaN (no data), pixel 1: in-range finite, pixel 2: Infinity
      map.fillImageData(img, [NaN, 0, Infinity]);

      // NaN pixel => fully transparent black
      expect(img.data[0]).toBe(0);
      expect(img.data[1]).toBe(0);
      expect(img.data[2]).toBe(0);
      expect(img.data[3]).toBe(0);

      // Infinity pixel => also fully transparent
      expect(img.data[8]).toBe(0);
      expect(img.data[9]).toBe(0);
      expect(img.data[10]).toBe(0);
      expect(img.data[11]).toBe(0);
    });

    test('fillImageData maps a finite in-range value to opaque expected RGBA', () => {
      const map = new ColorMap([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ], { range: [0, 100] });

      const img = makeImageData(1) as unknown as ImageData;
      map.fillImageData(img, [0]); // value 0 => first color (red)

      expect(img.data[0]).toBe(255); // R
      expect(img.data[1]).toBe(0);   // G
      expect(img.data[2]).toBe(0);   // B
      expect(img.data[3]).toBe(255); // A => fully opaque
    });

    test('fillImageData maps min and max exactly to the endpoint colors', () => {
      const map = new ColorMap([
        [1, 0, 0],   // index 0
        [0, 1, 0],   // index 1
        [0, 0, 1],   // index 2 (last)
      ], { range: [0, 100] });

      const img = makeImageData(2) as unknown as ImageData;
      map.fillImageData(img, [0, 100]); // min, max

      // min => first color (red), opaque
      expect(Array.from(img.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
      // max => last color (blue), opaque
      expect(Array.from(img.data.slice(4, 8))).toEqual([0, 0, 255, 255]);
    });

    test('getColor with NaN returns a transparent / zero-alpha color', () => {
      // RGBA map => transparent black with alpha 0
      expect(colorMapWithAlpha.getColor(NaN)).toEqual([0, 0, 0, 0]);
      expect(colorMapWithAlpha.getColor(Infinity)).toEqual([0, 0, 0, 0]);
      expect(colorMapWithAlpha.getColor(-Infinity)).toEqual([0, 0, 0, 0]);

      // RGB-only map => no alpha channel, but RGB collapses to black (no LUT lookup)
      expect(colorMap.getColor(NaN)).toEqual([0, 0, 0]);
    });

    test('getColorArray with NaN returns zero color / zero alpha', () => {
      const valsWithAlpha = colorMapWithAlpha.getColorArray([NaN, 0, Infinity]);
      // pixel 0 (NaN): RGBA all zero
      expect(Array.from(valsWithAlpha.slice(0, 4))).toEqual([0, 0, 0, 0]);
      // pixel 1 (finite, value 0 => first color [0,0,0,1]) stays opaque
      expect(valsWithAlpha[7]).toBe(1);
      // pixel 2 (Infinity): RGBA all zero
      expect(Array.from(valsWithAlpha.slice(8, 12))).toEqual([0, 0, 0, 0]);

      // RGB-only map => 3 components, NaN collapses to black
      const valsRGB = colorMap.getColorArray([NaN]);
      expect(Array.from(valsRGB.slice(0, 3))).toEqual([0, 0, 0]);
    });

    test('degenerate range (min === max) does not produce NaN indices', () => {
      const map = new ColorMap([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ], { range: [5, 5] }); // RangeValidator may reset, but guard must hold regardless

      // Should not throw and should return a valid finite color
      const c = map.getColor(5);
      expect(c.every(v => Number.isFinite(v))).toBe(true);

      const arr = map.getColorArray([5]);
      expect(Array.from(arr).every(v => Number.isFinite(v))).toBe(true);
    });
  });
});