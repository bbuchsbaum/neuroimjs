import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as nij from '../src/index';
import * as browser from '../src/browser';
import {
  IOError,
  NEUROIM_ERROR_CODES,
  NeuroimError,
  NeuroimTypeError,
  NotImplementedError,
  ValueError,
  isNeuroimError,
  type NeuroimErrorCode,
} from '../src/errors';
import { readVol, readVec, readHeader, writeVol } from '../src/io/io';
import { getFormat } from '../src/io/formats';
import { readNiftiArrayBuffer } from '../src/io/browserNifti';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { AxisSet2D, AxisSet3D, NamedAxis, findAnatomy3D } from '../src/geometry/Axis';
import { assertSameVolumeGeometry } from '../src/geometry/VolumeGeometry';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { getTypedArrayConstructor } from '../src/types';

const FIXTURES = path.join(__dirname, 'conformance', 'fixtures', 'nifti');

function fixture(name: string): ArrayBuffer {
  const bytes = fs.readFileSync(path.join(FIXTURES, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** NIfTI-1 fixture with its datatype code rewritten (offset 70, int16). */
function withDatatype(name: string, datatype: number): ArrayBuffer {
  const buffer = fixture(name);
  const view = new DataView(buffer);
  const littleEndian = view.getInt32(0, true) === 348;
  view.setInt16(70, datatype, littleEndian);
  return buffer;
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected function to throw');
}

async function caughtAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

function expectCode(error: unknown, code: NeuroimErrorCode): asserts error is NeuroimError {
  expect(error).toBeInstanceOf(NeuroimError);
  expect(error).toBeInstanceOf(Error);
  expect(isNeuroimError(error, code)).toBe(true);
  expect((error as NeuroimError).code).toBe(code);
}

describe('NeuroimError', () => {
  it('carries code, name, message, details and cause', () => {
    const cause = new Error('root');
    const error = new NeuroimError('CORRUPT_FILE', 'bad bytes', { cause, details: { offset: 4 } });
    expect(error.name).toBe('NeuroimError');
    expect(error.message).toBe('bad bytes');
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.details).toEqual({ offset: 4 });
    expect(error.cause).toBe(cause);
    expect(Object.keys(error)).not.toContain('cause');
    expect(error.stack).toContain('bad bytes');
  });

  it('omits cause when none is given', () => {
    expect('cause' in new NeuroimError('IO_ERROR', 'x')).toBe(false);
  });

  it('keeps legacy subclasses on the hierarchy with stable names and codes', () => {
    const cases: Array<[Error, string, NeuroimErrorCode]> = [
      [new ValueError('v'), 'ValueError', 'INVALID_ARGUMENT'],
      [new ValueError('v', { code: 'OUT_OF_RANGE' }), 'ValueError', 'OUT_OF_RANGE'],
      [new NeuroimTypeError('t'), 'NeuroimTypeError', 'INVALID_ARGUMENT'],
      [new NotImplementedError(), 'NotImplementedError', 'NOT_IMPLEMENTED'],
      [new IOError('io'), 'IOError', 'IO_ERROR'],
    ];
    for (const [error, name, code] of cases) {
      expectCode(error, code);
      expect(error.name).toBe(name);
    }
    expect(new NotImplementedError().message).toBe('Method not implemented');
  });

  it('isNeuroimError rejects foreign errors and wrong codes', () => {
    expect(isNeuroimError(new Error('x'))).toBe(false);
    expect(isNeuroimError(new globalThis.TypeError('x'))).toBe(false);
    expect(isNeuroimError({ code: 'INVALID_ARGUMENT', name: 'NeuroimError' })).toBe(false);
    expect(isNeuroimError(null)).toBe(false);
    expect(isNeuroimError('INVALID_ARGUMENT')).toBe(false);
    expect(isNeuroimError(new ValueError('x'), 'CORRUPT_FILE')).toBe(false);
  });

  it('isNeuroimError recognises errors from a duplicate copy of the library', () => {
    // Simulate a second module instance: a distinct class whose prototype
    // carries the shared Symbol.for brand.
    class OtherCopy extends Error {
      code = 'OUT_OF_RANGE';
    }
    Object.defineProperty(OtherCopy.prototype, Symbol.for('neuroimjs.NeuroimError'), { value: true });
    const foreign = new OtherCopy('x');
    expect(foreign instanceof NeuroimError).toBe(false);
    expect(isNeuroimError(foreign)).toBe(true);
    expect(isNeuroimError(foreign, 'OUT_OF_RANGE')).toBe(true);
    expect(isNeuroimError(foreign, 'IO_ERROR')).toBe(false);
  });

  it('lists every code exactly once', () => {
    expect(new Set(NEUROIM_ERROR_CODES).size).toBe(NEUROIM_ERROR_CODES.length);
    expect(Object.isFrozen(NEUROIM_ERROR_CODES)).toBe(true);
  });
});

describe('public entry points', () => {
  it('no longer shadow the global TypeError', () => {
    expect((nij as Record<string, unknown>).TypeError).toBeUndefined();
    expect((browser as Record<string, unknown>).TypeError).toBeUndefined();
    expect(TypeError).toBe(globalThis.TypeError);
  });

  it('export the error hierarchy', () => {
    expect(nij.NeuroimError).toBe(NeuroimError);
    expect(nij.NeuroimTypeError).toBe(NeuroimTypeError);
    expect(nij.ValueError).toBe(ValueError);
    expect(nij.isNeuroimError).toBe(isNeuroimError);
    expect(browser.NeuroimError).toBe(NeuroimError);
    expect(browser.isNeuroimError).toBe(isNeuroimError);
  });
});

describe('io error codes', () => {
  it('readVol: non-NIfTI bytes are CORRUPT_FILE and still a ValueError', async () => {
    const error = await caughtAsync(() => readVol(new ArrayBuffer(4)));
    expectCode(error, 'CORRUPT_FILE');
    expect(error).toBeInstanceOf(ValueError);
    expect(error.message).toBe('The file is not a valid NIfTI file.');
  });

  it('readVol: unknown extension is UNSUPPORTED_FORMAT', async () => {
    const error = await caughtAsync(() => readVol('/nonexistent/volume.xyz'));
    expectCode(error, 'UNSUPPORTED_FORMAT');
    expect(error.details).toEqual({ path: '/nonexistent/volume.xyz' });
  });

  it('readHeader: unknown extension is UNSUPPORTED_FORMAT', async () => {
    expectCode(await caughtAsync(() => readHeader('/nonexistent/volume.xyz')), 'UNSUPPORTED_FORMAT');
  });

  it('readVol: out-of-range 4D index is OUT_OF_RANGE with details', async () => {
    const error = await caughtAsync(() =>
      readVol(fixture('vec4d_int16_sform_oblique.nii'), { index: 99 })
    );
    expectCode(error, 'OUT_OF_RANGE');
    expect(error.details).toMatchObject({ index: 99 });
    expect(error.message).toMatch(/^Index 99 out of range for 4D data with \d+ volumes$/);
  });

  it('readVec: out-of-range index is OUT_OF_RANGE, empty selection INVALID_ARGUMENT', async () => {
    const file = path.join(FIXTURES, 'vec4d_int16_sform_oblique.nii');
    expectCode(await caughtAsync(() => readVec(file, { indices: [99] })), 'OUT_OF_RANGE');
    expectCode(await caughtAsync(() => readVec(file, { indices: [] })), 'INVALID_ARGUMENT');
  });

  it('readVol: unsupported datatype is UNSUPPORTED_DATATYPE', async () => {
    // 1536 = FLOAT128, recognised by nifti-reader-js but not by neuroimjs.
    const error = await caughtAsync(() => readVol(withDatatype('dtype_int16_le.nii', 1536)));
    expectCode(error, 'UNSUPPORTED_DATATYPE');
    expect(error.details).toEqual({ datatypeCode: 1536 });
  });

  it('writeVol and getFormat: unknown format is UNSUPPORTED_FORMAT', async () => {
    const vol = new FloatNeuroVol(new NeuroSpace([2, 2, 2]), new Float32Array(8));
    expectCode(
      await caughtAsync(() => writeVol(vol, '/nonexistent/out.nii', { format: 'BOGUS' as never })),
      'UNSUPPORTED_FORMAT'
    );
    expectCode(caught(() => getFormat('BOGUS')), 'UNSUPPORTED_FORMAT');
  });

  it('getTypedArrayConstructor: unknown numeric type is UNSUPPORTED_DATATYPE', () => {
    expectCode(caught(() => getTypedArrayConstructor('complex64' as never)), 'UNSUPPORTED_DATATYPE');
  });
});

describe('browser NIfTI error codes', () => {
  it('non-NIfTI input is CORRUPT_FILE', () => {
    const error = caught(() => readNiftiArrayBuffer(new ArrayBuffer(4)));
    expectCode(error, 'CORRUPT_FILE');
    expect(error.message).toBe('Input is not a valid NIfTI-1 or NIfTI-2 image.');
  });

  it('out-of-range volume index is OUT_OF_RANGE', () => {
    const error = caught(() =>
      readNiftiArrayBuffer(fixture('vec4d_int16_sform_oblique.nii'), { index: 99 })
    );
    expectCode(error, 'OUT_OF_RANGE');
    expect(error.details).toMatchObject({ index: 99 });
  });

  it('unsupported datatype is UNSUPPORTED_DATATYPE', () => {
    expectCode(
      caught(() => readNiftiArrayBuffer(withDatatype('dtype_int16_le.nii', 1536))),
      'UNSUPPORTED_DATATYPE'
    );
  });

  it('truncated image data is CORRUPT_FILE', () => {
    const truncated = fixture('dtype_int16_le.nii').slice(0, 352 + 2);
    const error = caught(() => readNiftiArrayBuffer(truncated));
    expectCode(error, 'CORRUPT_FILE');
  });
});

describe('geometry error codes', () => {
  it('invalid NeuroSpace arguments are INVALID_ARGUMENT', () => {
    expectCode(caught(() => new NeuroSpace([])), 'INVALID_ARGUMENT');
    expectCode(caught(() => new NeuroSpace([2, 2, 2], [1, -1, 1])), 'INVALID_ARGUMENT');
  });

  it('a singular affine is INVALID_ARGUMENT with the matrix in details', () => {
    const singular = [
      [1, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    // Without explicit axes, orientation inference rejects the matrix first.
    const inferred = caught(() => new NeuroSpace([2, 2, 2], undefined, undefined, undefined, singular));
    expectCode(inferred, 'INVALID_ARGUMENT');
    expect(inferred.message).toBe('Invalid matrix input, columns are degenerate');

    const lpi = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);
    const error = caught(() => new NeuroSpace([2, 2, 2], undefined, undefined, lpi, singular));
    expectCode(error, 'INVALID_ARGUMENT');
    expect(error.message).toBe('Failed to create NeuroSpace: transformation matrix is not invertible');
    expect(error.details).toEqual({ transform: singular });
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('slice extraction past the end of an axis is OUT_OF_RANGE', () => {
    const space = new NeuroSpace([4, 4, 4]);
    expectCode(caught(() => space.extractSliceNeuroSpace(9, 2)), 'OUT_OF_RANGE');
    expectCode(caught(() => space.extractSliceNeuroSpace(0, 7)), 'OUT_OF_RANGE');
  });

  it('too many coordinates is INVALID_ARGUMENT', () => {
    expectCode(caught(() => new NeuroSpace([4, 4, 4]).gridToCoord([0, 0, 0, 0])), 'INVALID_ARGUMENT');
  });

  it('unknown axis orientation is INVALID_ARGUMENT', () => {
    expectCode(caught(() => findAnatomy3D('NOPE', 'NOPE', 'NOPE')), 'INVALID_ARGUMENT');
  });

  it('spaces of different rank are GEOMETRY_MISMATCH', () => {
    const space = new NeuroSpace([4, 4, 4]);
    expectCode(caught(() => space.withDimensions([4, 4])), 'GEOMETRY_MISMATCH');
    const plane = new AxisSet2D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT);
    expectCode(caught(() => space.getPermutationMatrixTo(plane)), 'GEOMETRY_MISMATCH');
  });

  it('volumes on different grids are GEOMETRY_MISMATCH', () => {
    const a = new FloatNeuroVol(new NeuroSpace([2, 2, 2]), new Float32Array(8));
    const b = new FloatNeuroVol(new NeuroSpace([2, 2, 3]), new Float32Array(12));
    const error = caught(() => assertSameVolumeGeometry(a, b));
    expectCode(error, 'GEOMETRY_MISMATCH');
    expect(error.message).toMatch(/^Volume geometry mismatch in dimensions/);
  });
});
