import { describe, it, expect } from 'vitest';
import { ColorMap } from '../../src/display/ColorMap';
import { VolLayer, upsampleBilinear, upsampleCubicClamped, clusterSizes } from '../../src/display/VolLayer';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
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

describe('upsampleCubicClamped', () => {
  it('preserves a constant field and never overshoots a step edge', () => {
    const flat = upsampleCubicClamped(new Float32Array(16).fill(3), 4, 4, 4);
    expect(Array.from(flat).every((v) => Math.abs(v - 3) < 1e-6)).toBe(true);
    // A hard 0 -> 10 edge: plain Catmull-Rom rings below 0 and above 10.
    const step = new Float32Array([0, 0, 10, 10, 0, 0, 10, 10]);
    const out = upsampleCubicClamped(step, 4, 2, 4);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...out)).toBeLessThanOrEqual(10);
  });

  it('interpolates smoothly between samples on a linear ramp', () => {
    const ramp = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const out = upsampleCubicClamped(ramp, 8, 1, 2);
    // Output pixel centres sit at x = 0.25, 0.75, 1.25, ... in source units.
    expect(out[3]).toBeCloseTo(1.25, 5);
    expect(out[8]).toBeCloseTo(3.75, 5);
  });
});

describe('clusterSizes', () => {
  it('labels 26-connected same-sign clusters beyond the threshold', () => {
    const dim = [4, 4, 2];
    const data = new Float32Array(32);
    const at = (i: number, j: number, k: number) => i + j * 4 + k * 16;
    // Positive cluster joined only diagonally across slices (26-connectivity).
    data[at(0, 0, 0)] = 5;
    data[at(1, 1, 1)] = 6;
    // A negative voxel touching the positive one is a separate cluster.
    data[at(1, 0, 0)] = -5;
    // Isolated positive speck and a sub-threshold voxel.
    data[at(3, 3, 0)] = 4;
    data[at(3, 0, 1)] = 1;
    const sizes = clusterSizes(data, dim, -3, 3);
    expect(sizes[at(0, 0, 0)]).toBe(2);
    expect(sizes[at(1, 1, 1)]).toBe(2);
    expect(sizes[at(1, 0, 0)]).toBe(1);
    expect(sizes[at(3, 3, 0)]).toBe(1);
    expect(sizes[at(3, 0, 1)]).toBe(0);
  });
});

describe('VolLayer outline with a minimum cluster size', () => {
  it('outlines only clusters of at least the minimum size', () => {
    const space = new NeuroSpace([6, 6, 1], [1, 1, 1], [0, 0, 0]);
    const data = new Float32Array(36);
    // A 3x3 block (9 voxels) and a single-voxel speck, both suprathreshold.
    for (let j = 1; j <= 3; j++) for (let i = 1; i <= 3; i++) data[i + j * 6] = 5;
    data[5 + 5 * 6] = 5;
    const vol = new FloatNeuroVol(space, data);
    const layer = new VolLayer('o', vol, ColorMap.fromPreset('BlueRed'), [-6, 6], [-3, 3], 1);
    layer.setOutline(1); // full darkening: outlined pixels become black
    layer.setMinOutlineClusterSize(4);
    const axes = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);
    const px = layer.getSlice(0, axes).data.data;
    const rgbAt = (i: number, j: number) => {
      const o = (i + j * 6) * 4;
      return [px[o], px[o + 1], px[o + 2], px[o + 3]];
    };
    expect(rgbAt(1, 1).slice(0, 3)).toEqual([0, 0, 0]); // block edge: outlined
    expect(rgbAt(2, 2).slice(0, 3)).not.toEqual([0, 0, 0]); // block interior
    const speck = rgbAt(5, 5);
    expect(speck[3]).toBe(255); // speck is still drawn...
    expect(speck.slice(0, 3)).not.toEqual([0, 0, 0]); // ...but not outlined
  });
});

describe('upsampleCubicClamped no-data handling', () => {
  it('falls back to the nearest voxel and never smears NaN', () => {
    const src = new Float32Array([1, 1, 1, 1, NaN, 1, 1, 1, 1]);
    const out = upsampleCubicClamped(src, 3, 3, 2);
    // Pixels nearest the NaN voxel stay NaN; everything else is exactly 1.
    const nan = Array.from(out).filter((v) => Number.isNaN(v)).length;
    expect(nan).toBe(4);
    expect(Array.from(out).filter((v) => !Number.isNaN(v)).every((v) => v === 1)).toBe(true);
  });
});
