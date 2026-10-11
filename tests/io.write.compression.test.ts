/**
 * Compression for writeVol / writeVec / write_vol follows the file extension
 * (mote bd-01M4298YPGHKDWBSV61RAMF2VB). A `.nii.gz` path is gzipped, a `.nii`
 * path is not, and options that contradict a NIfTI extension are rejected
 * instead of producing a file no reader can open.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readHeader, readVec, readVol, writeVec, writeVol } from '../src/io/io';
import { write_vol } from '../src/io/nifti';
import { isNeuroimError } from '../src/errors';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { BigNeuroVec } from '../src/vector/BigNeuroVec';

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nij-compress-'));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeVol(): FloatNeuroVol {
  const space = new NeuroSpace([3, 4, 5], [2, 2, 2], [-3, -4, -5]);
  const data = new Float32Array(60);
  for (let i = 0; i < data.length; i++) data[i] = i * 0.5;
  return new FloatNeuroVol(space, data);
}

function makeVec(): BigNeuroVec {
  // Time-first [T, X, Y, Z], the layout readVec returns.
  const space = new NeuroSpace([2, 3, 4, 5], [1, 2, 2, 2], [0, -3, -4, -5]);
  const data = new Float32Array(120);
  for (let i = 0; i < data.length; i++) data[i] = i;
  return new BigNeuroVec(data, space, { storage: 'memory' });
}

async function isGzip(file: string): Promise<boolean> {
  const bytes = await fs.readFile(file);
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('writeVol: compression follows the extension', () => {
  it('gzips a .nii.gz path with no options, and readVol/readHeader read it back', async () => {
    const vol = makeVol();
    const file = path.join(dir, 'default.nii.gz');
    await writeVol(vol, file);

    expect(await isGzip(file)).toBe(true);
    const back = await readVol(file);
    expect(Array.from(back.getData())).toEqual(Array.from(vol.getData()));
    expect((await readHeader(file)).datatype).toBe('FLOAT32');
  });

  it('writes a .nii path uncompressed by default', async () => {
    const file = path.join(dir, 'default.nii');
    await writeVol(makeVol(), file);
    expect(await isGzip(file)).toBe(false);
    expect((await readVol(file)).space.dim).toEqual([3, 4, 5]);
  });

  it('treats the extension case-insensitively', async () => {
    const file = path.join(dir, 'UPPER.NII.GZ');
    await writeVol(makeVol(), file);
    expect(await isGzip(file)).toBe(true);
  });

  it("honours the extension when format is 'NIFTI' (the encoding-neutral default)", async () => {
    const file = path.join(dir, 'format-nifti.nii.gz');
    await writeVol(makeVol(), file, { format: 'NIFTI' });
    expect(await isGzip(file)).toBe(true);
    expect((await readVol(file)).space.dim).toEqual([3, 4, 5]);
  });

  it('accepts options that agree with the extension', async () => {
    const gz = path.join(dir, 'agree.nii.gz');
    await writeVol(makeVol(), gz, { compress: true });
    await writeVol(makeVol(), gz, { format: 'NIFTI_GZ' });
    await writeVol(makeVol(), gz, { format: 'NIFTI', compress: true });
    expect(await isGzip(gz)).toBe(true);

    const raw = path.join(dir, 'agree.nii');
    await writeVol(makeVol(), raw, { compress: false });
    expect(await isGzip(raw)).toBe(false);
  });

  it.each([
    ['conflict-a.nii.gz', { compress: false }],
    ['conflict-b.nii', { compress: true }],
    ['conflict-c.nii', { format: 'NIFTI_GZ' }],
    ['conflict-d.nii.gz', { format: 'NIFTI_GZ', compress: false }],
    ['conflict-e.bin', { format: 'NIFTI_GZ', compress: false }],
  ])('rejects %s with %o as INVALID_ARGUMENT and writes nothing', async (name, options) => {
    const file = path.join(dir, name);
    const error = await rejection(writeVol(makeVol(), file, options));
    expect(isNeuroimError(error, 'INVALID_ARGUMENT')).toBe(true);
    await expect(fs.stat(file)).rejects.toThrow();
  });

  it('uses the options for a path without a NIfTI extension', async () => {
    const plain = path.join(dir, 'other.bin');
    await writeVol(makeVol(), plain);
    expect(await isGzip(plain)).toBe(false);

    const gz = path.join(dir, 'other-gz.bin');
    await writeVol(makeVol(), gz, { compress: true });
    expect(await isGzip(gz)).toBe(true);

    const gz2 = path.join(dir, 'other-gz2.bin');
    await writeVol(makeVol(), gz2, { format: 'NIFTI_GZ' });
    expect(await isGzip(gz2)).toBe(true);
  });
});

describe('write_vol: legacy alias', () => {
  it('gzips a .nii.gz path and readVol reads it back', async () => {
    const file = path.join(dir, 'alias.nii.gz');
    await write_vol(makeVol(), file);
    expect(await isGzip(file)).toBe(true);
    expect((await readVol(file)).space.dim).toEqual([3, 4, 5]);
  });

  it('writes a .nii path uncompressed', async () => {
    const file = path.join(dir, 'alias.nii');
    await write_vol(makeVol(), file);
    expect(await isGzip(file)).toBe(false);
  });
});

describe('writeVec: compression follows the extension', () => {
  it('gzips a .nii.gz path with no options, and readVec/readVol read it back', async () => {
    const vec = makeVec();
    const file = path.join(dir, 'vec.nii.gz');
    await writeVec(vec, file);

    expect(await isGzip(file)).toBe(true);
    const back = await readVec(file);
    expect(back.getAt(1, 2, 3, 1)).toBe(vec.getAt(1, 2, 3, 1));
    expect(Array.from((await readVol(file, { index: 1 })).getData())).toEqual(
      Array.from(vec.getVolume(1).getData())
    );
  });

  it('rejects compress: false on a .nii.gz path', async () => {
    const file = path.join(dir, 'vec-conflict.nii.gz');
    const error = await rejection(writeVec(makeVec(), file, { compress: false }));
    expect(isNeuroimError(error, 'INVALID_ARGUMENT')).toBe(true);
    await expect(fs.stat(file)).rejects.toThrow();
  });
});
