/**
 * Atlas loaders must convert label volumes to Int32 by value for every NIfTI
 * datatype (GH #13): Schaefer used to reinterpret the buffer of non-float
 * volumes and Glasser rejected int16/int8/uint8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NeuroAtlas } from '../../src/atlas/NeuroAtlas';
import { toInt32Labels } from '../../src/atlas/labels';
import { Downloader } from '../../src/utils/Downloader';
import {
  GLASSER_SPEC,
  SMALL_GLASSER_SPEC,
  buildLabelVolume,
  schaeferSpec,
  smallSchaeferSpec,
  syntheticAtlasText,
  type LabelVolumeOptions,
  type LabelVolumeSpec,
  type NiftiLabelDatatype,
} from '../helpers/syntheticAtlas';

type Loader = 'glasser' | 'schaefer';

// Small grids keep each file's datatype, spacing and affine; their voxel
// counts are odd (23x27x21, 21x25x19), which made the old int16 path throw.
const SPECS: Record<Loader, LabelVolumeSpec> = {
  glasser: SMALL_GLASSER_SPEC,
  schaefer: smallSchaeferSpec(2),
};

// The published grids (97x115x97, 91x109x91), for one end-to-end case each.
const PUBLISHED_SPECS: Record<Loader, LabelVolumeSpec> = {
  glasser: GLASSER_SPEC,
  schaefer: schaeferSpec(2),
};

let volume: ArrayBuffer;

beforeEach(() => {
  vi.spyOn(Downloader, 'downloadBuffer').mockImplementation(async () => volume);
  vi.spyOn(Downloader, 'downloadText').mockImplementation(syntheticAtlasText);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function load(
  loader: Loader,
  datatype: NiftiLabelDatatype,
  nLabels: number,
  options: LabelVolumeOptions = {},
  spec: LabelVolumeSpec = SPECS[loader]
): Promise<NeuroAtlas> {
  volume = buildLabelVolume({ ...spec, datatype }, nLabels, options);
  return loader === 'glasser'
    ? NeuroAtlas.loadGlasserAtlas(false)
    : NeuroAtlas.loadSchaeferAtlas({ parcels: 100, networks: 7, resolution: 2, useCache: false });
}

/** Labels the fixture places in its central box (1..nLabels cycling), rim 0. */
function expectedLabels(spec: LabelVolumeSpec, nLabels: number): Int32Array {
  const [nx, ny, nz] = spec.dims;
  const out = new Int32Array(nx * ny * nz);
  const lo = spec.dims.map(d => Math.floor(d * 0.2));
  const hi = spec.dims.map(d => Math.ceil(d * 0.8));
  let next = 0;
  for (let z = lo[2]; z < hi[2]; z++) {
    for (let y = lo[1]; y < hi[1]; y++) {
      for (let x = lo[0]; x < hi[0]; x++) {
        out[x + nx * (y + ny * z)] = 1 + (next++ % nLabels);
      }
    }
  }
  return out;
}

function expectLabels(
  atlas: NeuroAtlas,
  loader: Loader,
  nLabels: number,
  spec: LabelVolumeSpec = SPECS[loader]
): void {
  const expected = expectedLabels(spec, nLabels);
  const actual = atlas.atlas.getData();
  expect(actual.length).toBe(expected.length);
  // Compare in bulk; toEqual on ~1M-element arrays is slow.
  let mismatches = 0;
  for (let i = 0; i < expected.length; i++) if (actual[i] !== expected[i]) mismatches++;
  expect(mismatches).toBe(0);
  expect(atlas.atlas.getRange()).toEqual([1, nLabels]);
  expect(atlas.atlas.numClusters()).toBe(nLabels);
}

// Max label each datatype can hold within the 100-parcel Schaefer / 360-region
// Glasser label sets: int8 tops out at 127, uint8 at 255.
const CASES: Array<[string, NiftiLabelDatatype, number]> = [
  ['uint8', 2, 100],
  ['int8', 256, 100],
  ['int16', 4, 100],
  ['uint16', 512, 100],
  ['int32', 8, 100],
  ['float32', 16, 100],
  ['float64', 64, 100],
];

describe.each<Loader>(['glasser', 'schaefer'])('%s loader label datatypes', loader => {
  it.each(CASES)('converts %s label volumes by value', async (_name, datatype, nLabels) => {
    const atlas = await load(loader, datatype, nLabels);
    expectLabels(atlas, loader, nLabels);
  });

  it('converts an int16 volume on the published grid', async () => {
    const spec = PUBLISHED_SPECS[loader];
    const atlas = await load(loader, 4, 100, {}, spec);
    expectLabels(atlas, loader, 100, spec);
  });

  it('honours scl_slope/scl_inter applied by the reader (int16 * 2 - 4)', async () => {
    // Stored label + 2 scales to 2 * (label + 2) - 4 = 2 * label.
    const atlas = await load(loader, 4, 50, {
      sclSlope: 2,
      sclInter: -4,
      stored: label => label + 2,
    });
    const expected = expectedLabels(SPECS[loader], 50).map(v => (v === 0 ? 0 : 2 * v));
    // Background voxels are stored as 0 and scale to -4, a (negative) label.
    const actual = atlas.atlas.getData();
    const [nx, ny, nz] = SPECS[loader].dims;
    expect(actual.length).toBe(nx * ny * nz);
    let mismatches = 0;
    for (let i = 0; i < actual.length; i++) {
      const want = expected[i] === 0 ? -4 : expected[i];
      if (actual[i] !== want) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('rejects non-integral float labels with a clear error', async () => {
    await expect(load(loader, 16, 100, { stored: label => label + 0.5 })).rejects.toThrow(
      /non-integer value \(1\.5\) at voxel \d+/
    );
  });

  it('rejects labels made non-integral by scl_slope', async () => {
    await expect(load(loader, 4, 100, { sclSlope: 0.5 })).rejects.toThrow(/non-integer value/);
  });

  it('rejects non-finite labels', async () => {
    await expect(load(loader, 16, 100, { stored: () => Number.NaN })).rejects.toThrow(
      /non-finite value \(NaN\)/
    );
  });
});

describe('toInt32Labels', () => {
  it('returns an Int32Array unchanged', () => {
    const a = new Int32Array([0, 1, 2]);
    expect(toInt32Labels(a)).toBe(a);
  });

  it('converts typed-array views with a non-zero byteOffset by value', () => {
    const buf = new ArrayBuffer(16);
    const view = new Int16Array(buf, 2, 3); // odd length, offset 2
    view.set([7, -3, 300]);
    expect(Array.from(toInt32Labels(view))).toEqual([7, -3, 300]);
    const u8 = new Uint8Array(buf, 1, 5);
    u8.fill(255);
    expect(Array.from(toInt32Labels(u8))).toEqual([255, 255, 255, 255, 255]);
  });

  it('rounds floats within tolerance and accepts plain arrays', () => {
    expect(Array.from(toInt32Labels(new Float32Array([0, 2.00001, -1])))).toEqual([0, 2, -1]);
    expect(Array.from(toInt32Labels([0, 3, 12]))).toEqual([0, 3, 12]);
  });

  it('accepts a NeuroVol-like object', () => {
    const vol = { space: {}, getData: () => new Uint16Array([0, 65535]) };
    expect(Array.from(toInt32Labels(vol as never))).toEqual([0, 65535]);
  });

  it('rejects non-finite, non-integral and out-of-range values', () => {
    expect(() => toInt32Labels(new Float64Array([1, Infinity]))).toThrow(
      /non-finite value \(Infinity\) at voxel 1/
    );
    expect(() => toInt32Labels(new Float32Array([0, 0, 2.25]))).toThrow(
      /non-integer value \(2\.25\) at voxel 2/
    );
    expect(() => toInt32Labels(new Uint32Array([4294967295]))).toThrow(/outside the int32 range/);
  });
});
