/**
 * Slice extraction must work for every voxel datatype a NeuroVol can hold.
 *
 * Regression for the uint16 gap: createNeuroVol accepted 'uint16' but
 * createNeuroSlice did not, so a UInt16 NIfTI loaded fine and then threw on the
 * first slice (and therefore in every viewer).
 */
import { describe, expect, it } from 'vitest';
import { AxisSet3D } from '../../src/geometry/Axis';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { readNiftiArrayBuffer } from '../../src/io/browserNifti';
import { readVol } from '../../src/io/io';
import { isNeuroimError } from '../../src/errors';
import type { NumericType, TypedArray } from '../../src/types';
import { createNeuroSlice, createNeuroVol } from '../../src/volume/NeuroIm';
import { Float64NeuroVol, UInt16NeuroVol } from '../../src/volume/DenseNeuroVol';
import type { NeuroVol } from '../../src/volume/NeuroVol';
import { extractOrthogonalSlices } from '../../src/volume/orthogonalSlices';
import { Resampler } from '../../src/volume/Resampler';
import { SparseNeuroVol } from '../../src/sparse/SparseNeuroVol';
import { fixtureBytes, fixturePath, manifest } from '../conformance/manifest';

const VIEWS: Array<[string, AxisSet3D]> = [
  ['axial', AxisSet3D.AXIAL_LPI],
  ['coronal', AxisSet3D.CORONAL_LIP],
  ['sagittal', AxisSet3D.SAGITTAL_AIL],
];

const ARRAYS: Record<Exclude<NumericType, 'uint32'>, new (n: number) => TypedArray> = {
  int8: Int8Array,
  uint8: Uint8Array,
  int16: Int16Array,
  uint16: Uint16Array,
  int32: Int32Array,
  float32: Float32Array,
  float64: Float64Array,
};

function lpiSpace(dim: number[] = [4, 3, 5]): NeuroSpace {
  return new NeuroSpace(dim, [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
}

/** Same voxels promoted to Float64: the reference every dtype's slice must match. */
function asFloat64(vol: NeuroVol): Float64NeuroVol {
  return new Float64NeuroVol(vol.space, Float64Array.from(vol.getData()));
}

function sliceValues(vol: NeuroVol, k: number, axes: AxisSet3D): number[] {
  return Array.from(vol.getSlice(k, axes).getData());
}

function expectNumericallyEqualSlices(vol: NeuroVol): void {
  const ref = asFloat64(vol);
  for (const [, axes] of VIEWS) {
    const reoriented = vol.space.reorient(axes);
    for (let k = 0; k < reoriented.dim[2]; k++) {
      expect(sliceValues(vol, k, axes)).toEqual(sliceValues(ref, k, axes));
    }
  }
}

const uint16Cases = manifest.cases.filter(c => c.id.startsWith('dtype_uint16'));

describe('uint16 slice extraction from NIfTI (both decoders)', () => {
  it('has the uint16 conformance fixtures', () => {
    expect(uint16Cases.map(c => c.id).sort()).toEqual(['dtype_uint16_be', 'dtype_uint16_le']);
  });

  for (const c of uint16Cases) {
    const loaders: Array<[string, () => Promise<NeuroVol> | NeuroVol]> = [
      ['readVol(path)', () => readVol(fixturePath(c))],
      ['readVol(ArrayBuffer)', () => readVol(fixtureBytes(c))],
      ['readNiftiArrayBuffer', () => readNiftiArrayBuffer(fixtureBytes(c))],
    ];

    for (const [name, load] of loaders) {
      it(`${c.id} via ${name}: extractOrthogonalSlices returns uint16 slices`, async () => {
        const vol = await load();
        expect(vol).toBeInstanceOf(UInt16NeuroVol);

        const centre = vol.space.gridToCoord([1, 2, 2]);
        const slices = extractOrthogonalSlices(vol, centre);
        expect(Object.keys(slices).sort()).toEqual(['axial', 'coronal', 'sagittal']);
        for (const slice of Object.values(slices)) {
          expect(slice.getData()).toBeInstanceOf(Uint16Array);
          expect(slice.getData().length).toBe(slice.dim[0] * slice.dim[1]);
        }
      });

      it(`${c.id} via ${name}: every view and level matches the float64 reference`, async () => {
        const vol = await load();
        expectNumericallyEqualSlices(vol);
      });

      it(`${c.id} via ${name}: getSliceAt keeps the full 0..65535 range`, async () => {
        const vol = await load();
        const expected = c.volumes[0].scaled as number[];
        expect(Math.min(...expected)).toBe(0);
        expect(Math.max(...expected)).toBe(65535);
        expect(vol.getRange()).toEqual([0, 65535]);

        // k = 0 of the native grid holds voxel (1,0,0) = 65535 in the fixture.
        const native = vol.space.axes;
        const slice = vol.getSlice(0, native);
        expect(slice.getData()).toBeInstanceOf(Uint16Array);
        expect(Array.from(slice.getData())).toEqual(expected.slice(0, 12));
        expect(Math.max(...slice.getData())).toBe(65535);

        const at = vol.getSliceAt(vol.space.gridToCoord([1, 1, 0]), native, 'nearest');
        expect(at.getData()).toBeInstanceOf(Uint16Array);
        expect(Array.from(at.getData())).toEqual(expected.slice(0, 12));
      });
    }
  }
});

describe('dtype parity of slice extraction', () => {
  for (const [type, Ctor] of Object.entries(ARRAYS) as Array<[NumericType, new (n: number) => TypedArray]>) {
    it(`${type}: createNeuroSlice builds a ${Ctor.name}-backed slice`, () => {
      const space2 = new NeuroSpace([2, 3], [1, 1], [0, 0]);
      const data = new Ctor(6);
      const slice = createNeuroSlice(type, space2, data);
      expect(slice.getData()).toBe(data);
    });

    it(`${type}: getSlice / getSliceAt agree with float64 in every view`, () => {
      const space = lpiSpace();
      const data = new Ctor(space.dim[0] * space.dim[1] * space.dim[2]);
      for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 100;
      const vol = createNeuroVol(type, space, data);
      expect(vol.getSliceTypedArrayType()).toBe(type);
      expectNumericallyEqualSlices(vol);
      for (const [, axes] of VIEWS) {
        const slice = vol.getSliceAt([1, 1, 2], axes, 'nearest');
        expect(slice.getData()).toBeInstanceOf(Ctor);
      }
    });

    it(`${type}: SparseNeuroVol slices`, () => {
      const space = lpiSpace();
      const vol = new SparseNeuroVol(space, type, 0, [0, 13, 59], [3, 7, 9]);
      for (const [, axes] of VIEWS) {
        expect(vol.getSlice(0, axes).getData()).toBeInstanceOf(Ctor);
        expect(vol.getSliceAt([0, 0, 0], axes, 'nearest').getData()).toBeInstanceOf(Ctor);
      }
    });

    it(`${type}: Resampler keeps the datatype`, () => {
      const space = lpiSpace();
      const data = new Ctor(space.dim[0] * space.dim[1] * space.dim[2]).fill(5);
      const vol = createNeuroVol(type, space, data);
      const out = Resampler.resample(vol, lpiSpace([2, 2, 2]), 'nearest');
      expect(out.getSliceTypedArrayType()).toBe(type);
      expect(out.getSlice(0, AxisSet3D.AXIAL_LPI).getData()).toBeInstanceOf(Ctor);
    });
  }
});

describe('unsupported datatypes fail with UNSUPPORTED_DATATYPE', () => {
  const expectUnsupported = (fn: () => unknown, pattern: RegExp) => {
    let caught: unknown;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    expect(isNeuroimError(caught, 'UNSUPPORTED_DATATYPE'), String(caught)).toBe(true);
    expect((caught as Error).message).toMatch(pattern);
  };

  it('createNeuroSlice("uint32")', () => {
    const space2 = new NeuroSpace([2, 3], [1, 1], [0, 0]);
    expectUnsupported(() => createNeuroSlice('uint32', space2, new Uint32Array(6)), /uint32/);
  });

  it('createNeuroVol("uint32") keeps the message the conformance KNOWN entry pins', () => {
    expectUnsupported(() => createNeuroVol('uint32', lpiSpace(), new Uint32Array(60)), /^Unsupported TypedArray type: uint32$/);
  });

  it('SparseNeuroVol with uint32 is rejected up front', () => {
    expectUnsupported(() => new SparseNeuroVol(lpiSpace(), 'uint32'), /uint32/);
  });
});
