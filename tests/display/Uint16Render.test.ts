/**
 * A uint16 volume must render through the display path (VolLayer colour
 * mapping and ImageLayer sprites), and its 0..65535 intensities must spread
 * across the colour map rather than saturating or collapsing to one level.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createPixiMock } from '../mocks/pixi.mock';
import { setupConsoleMocks } from './test-console-mock';

vi.mock('pixi.js', () => createPixiMock());

import * as PIXI from 'pixi.js';
import type { NumericTypedArray } from '../../src/display/ColorMap';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolLayer } from '../../src/display/VolLayer';
import { VolStack } from '../../src/display/VolStack';
import { AxisSet3D } from '../../src/geometry/Axis';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { readNiftiArrayBuffer } from '../../src/io/browserNifti';
import { readVol } from '../../src/io/io';
import { UInt16NeuroVol } from '../../src/volume/DenseNeuroVol';
import type { NeuroVol } from '../../src/volume/NeuroVol';
import { fixtureBytes, manifest } from '../conformance/manifest';

const VIEWS = [AxisSet3D.AXIAL_LPI, AxisSet3D.CORONAL_LIP, AxisSet3D.SAGITTAL_AIL];

/** Red channel of every pixel (grayscale map, so R = G = B). */
function grays(rgba: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) out.push(rgba[i]);
  return out;
}

function syntheticUint16(): UInt16NeuroVol {
  const space = new NeuroSpace([4, 4, 3], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
  const data = new Uint16Array(48);
  // Axial slice 0 holds a ramp over the full uint16 range.
  for (let i = 0; i < 16; i++) data[i] = Math.round((i / 15) * 65535);
  return new UInt16NeuroVol(space, data);
}

describe('uint16 display path', () => {
  beforeAll(() => setupConsoleMocks());

  it('VolLayer auto-ranges a uint16 volume to its data range', () => {
    const layer = new VolLayer('u16', syntheticUint16(), ColorMapFactory.createGrayscale());
    expect(layer.getRange()).toEqual([0, 65535]);
  });

  it('VolLayer maps the 0..65535 ramp across the grayscale LUT', () => {
    const layer = new VolLayer('u16', syntheticUint16(), ColorMapFactory.createGrayscale());
    const slice = layer.getSlice(0, AxisSet3D.AXIAL_LPI);
    const g = grays(slice.data.data);
    expect(g).toHaveLength(16);
    expect(g[0]).toBe(0);
    expect(g[15]).toBe(255);
    // Monotone and spread out: 16 ramp steps land on 16 distinct gray levels.
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeGreaterThan(g[i - 1]);
    expect(new Set(g).size).toBe(16);
    // Mid-ramp maps near mid-gray (windowing is linear over the full range).
    expect(Math.abs(g[7] - 255 * (7 / 15))).toBeLessThanOrEqual(2);
    // Every pixel opaque: no threshold set.
    for (let i = 3; i < slice.data.data.length; i += 4) expect(slice.data.data[i]).toBe(255);
  });

  it('VolLayer honours an explicit uint16 window', () => {
    const layer = new VolLayer('u16', syntheticUint16(), ColorMapFactory.createGrayscale(), [0, 32767]);
    const g = grays(layer.getSlice(0, AxisSet3D.AXIAL_LPI).data.data);
    // Values at or above the window max saturate; below it they still ramp.
    expect(g.filter(v => v === 255).length).toBe(8);
    expect(g[0]).toBe(0);
    expect(g[7]).toBeLessThan(255);
    expect(g[7]).toBeGreaterThan(200);
  });

  const u16 = manifest.cases.filter(c => c.id.startsWith('dtype_uint16'));
  for (const c of u16) {
    const loaders: Array<[string, () => Promise<NeuroVol> | NeuroVol]> = [
      ['readVol', () => readVol(fixtureBytes(c))],
      ['readNiftiArrayBuffer', () => readNiftiArrayBuffer(fixtureBytes(c))],
    ];
    for (const [name, load] of loaders) {
      it(`${c.id} via ${name}: renders non-degenerate slices in every view`, async () => {
        const vol = await load();
        const layer = new VolLayer('u16', vol, ColorMapFactory.createGrayscale());
        expect(layer.getRange()).toEqual([0, 65535]);
        for (const axes of VIEWS) {
          const slice = layer.getSliceAt(vol.space.gridToCoord([1, 2, 2]), axes, 'nearest');
          const g = grays(slice.data.data);
          expect(new Set(g).size).toBeGreaterThan(3);
        }
        // Native k = 0 contains the 65535 voxel, which must map to white.
        const native = grays(layer.getSlice(0, vol.space.axes).data.data);
        expect(native).toContain(255);
        expect(native).toContain(0);
      });

      it(`${c.id} via ${name}: ImageLayer renders a sprite`, async () => {
        const vol = await load();
        const imageLayer = new ImageLayer(new VolStack(new VolLayer('u16', vol, ColorMapFactory.createGrayscale())));
        const parent = new PIXI.Container();
        for (const axes of VIEWS) {
          const k = Math.floor(vol.space.reorient(axes).dim[2] / 2);
          const result = imageLayer.renderSlice(k, vol.space.gridToCoord([1, 2, 2]), axes, parent);
          expect(result).toBeDefined();
          expect(result?.addChild).toHaveBeenCalled();
        }
      });
    }
  }
});

describe('ColorMap.getColorArray accepts every numeric TypedArray', () => {
  const ctors = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
  for (const Ctor of ctors) {
    it(Ctor.name, () => {
      const cmap = ColorMapFactory.createGrayscale();
      cmap.setRange([0, 100]);
      const colors = cmap.getColorArray(Ctor.from([0, 100]) as NumericTypedArray);
      expect(colors.length).toBe(6);
      expect(Array.from(colors.subarray(0, 3))).toEqual([0, 0, 0]);
      expect(Array.from(colors.subarray(3, 6))).toEqual([1, 1, 1]);
    });
  }

  it('maps a uint16 slice over 0..65535', () => {
    const cmap = ColorMapFactory.createGrayscale();
    cmap.setRange([0, 65535]);
    const colors = cmap.getColorArray(Uint16Array.from([0, 32768, 65535]));
    expect(colors[0]).toBe(0);
    expect(colors[3]).toBeGreaterThan(0.45);
    expect(colors[3]).toBeLessThan(0.55);
    expect(colors[6]).toBe(1);
  });

  it('still rejects non-numeric input', () => {
    const cmap = ColorMapFactory.createGrayscale();
    expect(() => cmap.getColorArray(new DataView(new ArrayBuffer(4)) as unknown as NumericTypedArray)).toThrow(TypeError);
    expect(() => cmap.getColorArray(new Uint16Array(0))).toThrow(TypeError);
  });
});
