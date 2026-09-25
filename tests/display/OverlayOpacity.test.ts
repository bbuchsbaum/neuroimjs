import { describe, it, expect } from 'vitest';
import { ColorMap } from '../../src/display/ColorMap';
import { VolLayer, upsampleBilinear } from '../../src/display/VolLayer';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';

function fill(cmap: ColorMap, values: number[]): Uint8ClampedArray {
  const img = { data: new Uint8ClampedArray(values.length * 4), width: values.length, height: 1 } as ImageData;
  cmap.fillImageData(img, new Float32Array(values));
  return img.data;
}

describe('preset colormaps', () => {
  it('are fully opaque (chroma alpha is already in [0, 1])', () => {
    for (const name of ['BlueRed', 'Inferno', 'Viridis']) {
      const cmap = ColorMap.fromPreset(name, { range: [0, 1] });
      const px = fill(cmap, [0, 0.5, 1]);
      expect([px[3], px[7], px[11]], name).toEqual([255, 255, 255]);
    }
  });
});

describe('VolLayer opacity', () => {
  const space = new NeuroSpace([2, 2, 2], [1, 1, 1], [0, 0, 0]);
  const vol = new FloatNeuroVol(space, new Float32Array(8).fill(5));

  it('is not baked into the colormap, so it is applied exactly once', () => {
    const cmap = ColorMap.fromPreset('BlueRed');
    const layer = new VolLayer('overlay', vol, cmap, [-6, 6], [-3, 3], 0.7);
    expect(layer.opacity).toBe(0.7);
    expect(fill(layer.colorMap, [5])[3]).toBe(255);

    layer.setOpacity(0.4);
    expect(layer.opacity).toBe(0.4);
    expect(fill(layer.colorMap, [5])[3]).toBe(255);
  });

  it('bumps the render version when opacity or interpolation changes', () => {
    const layer = new VolLayer('overlay', vol, ColorMap.fromPreset('BlueRed'), [-6, 6], [-3, 3], 1);
    const v0 = layer.version;
    layer.setOpacity(0.5);
    layer.setInterpolation('nearest');
    expect(layer.interpolation).toBe('nearest');
    expect(layer.version).toBe(v0 + 2);
  });
});

describe('upsampleBilinear', () => {
  it('interpolates at output pixel centres and preserves a constant field', () => {
    const src = new Float32Array([0, 4, 8, 12]); // 2x2, row-major
    const out = upsampleBilinear(src, 2, 2, 2);
    expect(out.length).toBe(16);
    // Corners clamp to the source voxels; interior samples blend them.
    expect(out[0]).toBeCloseTo(0);
    expect(out[15]).toBeCloseTo(12);
    expect(out[5]).toBeCloseTo(3); // (0.25, 0.25) of the voxel grid
    const flat = upsampleBilinear(new Float32Array(9).fill(2.5), 3, 3, 4);
    expect(Array.from(flat).every((v) => Math.abs(v - 2.5) < 1e-6)).toBe(true);
  });

  it('never smears non-finite "no data" into neighbours', () => {
    const src = new Float32Array([1, NaN, 1, 1]);
    const out = upsampleBilinear(src, 2, 2, 2);
    expect(out.some((v) => Number.isNaN(v))).toBe(true);
    expect(out.filter((v) => Number.isFinite(v)).every((v) => v === 1)).toBe(true);
  });
});
