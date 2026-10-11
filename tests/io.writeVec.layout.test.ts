/**
 * writeVec must write each NeuroVec class in its own layout and keep the full
 * spatial affine (mote bd-01M428VJ5XVV8SHTD0BNGMAAN7).
 *
 * - BigNeuroVec is time-first ([T, X, Y, Z]); its geometry is `volumeSpace`.
 * - DenseNeuroVec (Float32NeuroVec, Int16NeuroVec, ...) and SparseNeuroVec are
 *   time-last ([X, Y, Z, T]); their 4D space carries the 3D affine.
 *
 * Every file is re-read with both neuroimjs decoders (readVol/readVec and the
 * browser readNiftiArrayBuffer), and the qform is decoded independently from
 * the header bytes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as pako from 'pako';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readHeader, readVec, readVol, writeVec } from '../src/io/io';
import { readNiftiArrayBuffer } from '../src/io/browserNifti';
import { isNeuroimError } from '../src/errors';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { BigNeuroVec } from '../src/vector/BigNeuroVec';
import { Float32NeuroVec, Int16NeuroVec, type NeuroVec } from '../src/vec/NeuroVec';
import { SparseNeuroVec } from '../src/vec/SparseNeuroVec';

const X = 3;
const Y = 4;
const Z = 5;
const T = 6;

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nij-writevec-'));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** An oblique, left-handed affine: rotations about x and z, a flip, voxel sizes 2/3/4. */
function obliqueAffine(): number[][] {
  const a = (25 * Math.PI) / 180;
  const b = (-15 * Math.PI) / 180;
  const rz = [
    [Math.cos(a), -Math.sin(a), 0],
    [Math.sin(a), Math.cos(a), 0],
    [0, 0, 1],
  ];
  const rx = [
    [1, 0, 0],
    [0, Math.cos(b), -Math.sin(b)],
    [0, Math.sin(b), Math.cos(b)],
  ];
  const r = rz.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * rx[k][j], 0)));
  const scale = [-2, 3, 4]; // negative x: left-handed (qfac = -1)
  const offset = [40.5, -62.25, 18];
  return [
    [r[0][0] * scale[0], r[0][1] * scale[1], r[0][2] * scale[2], offset[0]],
    [r[1][0] * scale[0], r[1][1] * scale[1], r[1][2] * scale[2], offset[1]],
    [r[2][0] * scale[0], r[2][1] * scale[1], r[2][2] * scale[2], offset[2]],
    [0, 0, 0, 1],
  ];
}

/** Distinct value for every (i, j, k, t), so any transpose changes values. */
const tag = (i: number, j: number, k: number, t: number): number => t * 1000 + i * 100 + j * 10 + k;

function fill(vec: NeuroVec): void {
  for (let t = 0; t < T; t++)
    for (let k = 0; k < Z; k++)
      for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) vec.setAt(i, j, k, t, tag(i, j, k, t));
}

function expectAffineClose(actual: number[][], expected: number[][]): void {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const tol = 1e-5 * Math.max(1, Math.abs(expected[r][c]));
      expect(Math.abs(actual[r][c] - expected[r][c]), `affine[${r}][${c}]`).toBeLessThanOrEqual(tol);
    }
  }
}

/** Decode the qform from raw NIfTI-1 header bytes (nifti_quatern_to_mat44). */
function qformFromBytes(bytes: Uint8Array): number[][] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const f = (o: number): number => v.getFloat32(o, true);
  const [b, c, d] = [f(256), f(260), f(264)];
  const [qx, qy, qz] = [f(268), f(272), f(276)];
  const qfac = f(76) < 0 ? -1 : 1;
  const [dx, dy, dz] = [f(80), f(84), f(88) * qfac];
  const a = Math.sqrt(Math.max(0, 1 - (b * b + c * c + d * d)));
  return [
    [(a * a + b * b - c * c - d * d) * dx, 2 * (b * c - a * d) * dy, 2 * (b * d + a * c) * dz, qx],
    [2 * (b * c + a * d) * dx, (a * a + c * c - b * b - d * d) * dy, 2 * (c * d - a * b) * dz, qy],
    [2 * (b * d - a * c) * dx, 2 * (c * d + a * b) * dy, (a * a + d * d - c * c - b * b) * dz, qz],
    [0, 0, 0, 1],
  ];
}

function rawHeader(bytes: Uint8Array): { dim: number[]; pixdim4: number; units: number; codes: number[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    dim: Array.from({ length: 8 }, (_, i) => v.getInt16(40 + 2 * i, true)),
    pixdim4: v.getFloat32(92, true),
    units: v.getUint8(123),
    codes: [v.getInt16(252, true), v.getInt16(254, true)],
  };
}

/** Raw NIfTI bytes of a written file, gunzipped when needed. */
async function niftiBytes(file: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await fs.readFile(file));
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? pako.ungzip(bytes) : bytes;
}

/** Check a written file against the expected [X, Y, Z, T] data and affine with every reader. */
async function verifyFile(file: string, affine: number[][]): Promise<void> {
  const bytes = await niftiBytes(file);
  const raw = rawHeader(bytes);
  expect(raw.dim).toEqual([4, X, Y, Z, T, 1, 1, 1]);
  expect(raw.codes).toEqual([1, 1]); // qform_code, sform_code
  expectAffineClose(qformFromBytes(bytes), affine);

  const hdr = await readHeader(file);
  expectAffineClose(hdr.affine, affine);

  // Node decoder, one frame at a time.
  for (const t of [0, 3, T - 1]) {
    const vol = await readVol(file, { index: t });
    expect(vol.space.dim).toEqual([X, Y, Z]);
    expectAffineClose(vol.space.trans.to2DArray(), affine);
    for (let k = 0; k < Z; k++)
      for (let j = 0; j < Y; j++)
        for (let i = 0; i < X; i++) expect(vol.getAt(i, j, k)).toBe(tag(i, j, k, t));
  }

  // Node decoder, whole run.
  const back = (await readVec(file)) as BigNeuroVec;
  expect(back.dim).toEqual([T, X, Y, Z]);
  expectAffineClose(back.volumeSpace.trans.to2DArray(), affine);
  for (let t = 0; t < T; t++) expect(back.getAt(2, 3, 4, t)).toBe(tag(2, 3, 4, t));
  expect(back.getSeries(1, 2, 3)).toEqual(Array.from({ length: T }, (_, t) => tag(1, 2, 3, t)));

  // Browser decoder.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const bvol = readNiftiArrayBuffer(ab, { index: 4 });
  expect(bvol.space.dim).toEqual([X, Y, Z]);
  expectAffineClose(bvol.space.trans.to2DArray(), affine);
  expect(bvol.getAt(2, 1, 3)).toBe(tag(2, 1, 3, 4));
}

describe('writeVec: time-last DenseNeuroVec', () => {
  it('writes [X, Y, Z, T] dims, values and the full oblique affine (qform + sform)', async () => {
    const affine = obliqueAffine();
    const vec = new Float32NeuroVec(new NeuroSpace([X, Y, Z, T], undefined, undefined, undefined, affine));
    fill(vec);
    const file = path.join(dir, 'dense-oblique.nii.gz');
    await writeVec(vec, file);
    await verifyFile(file, affine);
  });

  it('writes the time spacing as pixdim[4] and keeps an Int16 datatype', async () => {
    const affine = obliqueAffine();
    const space = new NeuroSpace([X, Y, Z, T], [2, 3, 4, 2.5], undefined, undefined, affine);
    const vec = new Int16NeuroVec(space);
    fill(vec);
    const file = path.join(dir, 'dense-int16.nii');
    await writeVec(vec, file);

    const bytes = await niftiBytes(file);
    expect(rawHeader(bytes).pixdim4).toBeCloseTo(2.5, 6);
    expect(rawHeader(bytes).units).toBe(10); // NIFTI_UNITS_MM | NIFTI_UNITS_SEC
    expect((await readHeader(file)).datatype).toBe('INT16');
    await verifyFile(file, affine);
  });

  it('writes pixdim[4] = 1 when the vec has no time spacing', async () => {
    const vec = new Float32NeuroVec(new NeuroSpace([X, Y, Z, T], [2, 2, 2], [-3, -4, -5]));
    fill(vec);
    const file = path.join(dir, 'dense-no-tr.nii');
    await writeVec(vec, file);
    const bytes = await niftiBytes(file);
    expect(rawHeader(bytes).pixdim4).toBe(1);
    expect(rawHeader(bytes).units).toBe(2); // NIFTI_UNITS_MM, time unit unspecified
  });

  it('round-trips readVol({ index }) for every frame against getVolume(t)', async () => {
    const affine = obliqueAffine();
    const vec = new Float32NeuroVec(new NeuroSpace([X, Y, Z, T], undefined, undefined, undefined, affine));
    fill(vec);
    const file = path.join(dir, 'dense-frames.nii');
    await writeVec(vec, file);
    for (let t = 0; t < T; t++) {
      const vol = await readVol(file, { index: t });
      expect(Array.from(vol.getData())).toEqual(Array.from(vec.getVolume(t).getData()));
    }
  });
});

describe('writeVec: time-last SparseNeuroVec', () => {
  it('densifies the frames in [X, Y, Z, T] order with the affine', async () => {
    const affine = obliqueAffine();
    const vec = new SparseNeuroVec(new NeuroSpace([X, Y, Z, T], undefined, undefined, undefined, affine), new Map());
    fill(vec);
    const file = path.join(dir, 'sparse.nii');
    await writeVec(vec, file);
    await verifyFile(file, affine);
  });
});

describe('writeVec: time-first BigNeuroVec', () => {
  it('writes [X, Y, Z, T] dims, values and the oblique affine from volumeSpace', async () => {
    const affine = obliqueAffine();
    const volumeSpace = new NeuroSpace([X, Y, Z], undefined, undefined, undefined, affine);
    const space = new NeuroSpace([T, X, Y, Z], [1, ...volumeSpace.spacing], [0, ...volumeSpace.origin]);
    const vec = new BigNeuroVec(new Float32Array(T * X * Y * Z), space, { storage: 'memory', volumeSpace });
    fill(vec);
    const file = path.join(dir, 'big-oblique.nii.gz');
    await writeVec(vec, file);
    await verifyFile(file, affine);
  });

  it('round-trips readVec output, including its geometry', async () => {
    const affine = obliqueAffine();
    const dense = new Float32NeuroVec(new NeuroSpace([X, Y, Z, T], undefined, undefined, undefined, affine));
    fill(dense);
    const first = path.join(dir, 'roundtrip-1.nii');
    await writeVec(dense, first);

    const big = await readVec(first);
    const second = path.join(dir, 'roundtrip-2.nii');
    await writeVec(big, second);
    await verifyFile(second, affine);
  });
});

describe('writeVec: TR round trip', () => {
  it('readVec takes the time spacing from pixdim[4], so readVec -> writeVec keeps the TR', async () => {
    const affine = obliqueAffine();
    const vec = new Float32NeuroVec(new NeuroSpace([X, Y, Z, T], [2, 3, 4, 2.5], undefined, undefined, affine));
    fill(vec);
    const first = path.join(dir, 'tr-1.nii');
    await writeVec(vec, first);

    const big = await readVec(first);
    expect(big.space.spacing[0]).toBeCloseTo(2.5, 6);
    const second = path.join(dir, 'tr-2.nii.gz');
    await writeVec(big, second);
    const raw = rawHeader(await niftiBytes(second));
    expect(raw.pixdim4).toBeCloseTo(2.5, 6);
    expect(raw.units).toBe(10);
    await verifyFile(second, affine);
  });
});

describe('writeVec / writeVol: sheared affines', () => {
  const sheared = [
    [2, 0.5, 0, -10],
    [0, 2, 0, 20],
    [0, 0, 2, 5],
    [0, 0, 0, 1],
  ];

  it('omits the qform (code 0) and keeps the exact sform', async () => {
    const vec = new Float32NeuroVec(new NeuroSpace([X, Y, Z, T], undefined, undefined, undefined, sheared));
    fill(vec);
    const file = path.join(dir, 'sheared.nii');
    await writeVec(vec, file);

    const raw = rawHeader(await niftiBytes(file));
    expect(raw.codes).toEqual([0, 1]);
    expectAffineClose((await readHeader(file)).affine, sheared);
    const vol = await readVol(file, { index: 2 });
    expectAffineClose(vol.space.trans.to2DArray(), sheared);
    expect(vol.getAt(1, 2, 3)).toBe(tag(1, 2, 3, 2));
    const bytes = await niftiBytes(file);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expectAffineClose(readNiftiArrayBuffer(ab).space.trans.to2DArray(), sheared);
  });

  it('still writes a qform for an oblique affine without shear', async () => {
    const vec = new Float32NeuroVec(new NeuroSpace([X, Y, Z, T], undefined, undefined, undefined, obliqueAffine()));
    const file = path.join(dir, 'not-sheared.nii');
    await writeVec(vec, file);
    expect(rawHeader(await niftiBytes(file)).codes).toEqual([1, 1]);
  });
});

describe('writeVec: dimension limits', () => {
  it('rejects a dimension above the NIfTI-1 int16 limit with INVALID_ARGUMENT', async () => {
    const vec = new SparseNeuroVec(new NeuroSpace([1, 1, 1, 40000]), new Map());
    const file = path.join(dir, 'too-long.nii');
    let error: unknown;
    try {
      await writeVec(vec, file);
    } catch (e) {
      error = e;
    }
    expect(isNeuroimError(error, 'INVALID_ARGUMENT')).toBe(true);
    await expect(fs.stat(file)).rejects.toThrow();
  });
});

describe('writeVec: unknown NeuroVec classes', () => {
  it('rejects a vec whose layout it cannot tell with INVALID_ARGUMENT', async () => {
    const dense = new Float32NeuroVec(new NeuroSpace([X, Y, Z, T]));
    const impostor: NeuroVec = {
      space: dense.space,
      length: dense.length,
      dim: dense.dim,
      spacing: dense.spacing,
      origin: dense.origin,
      getAt: (i, j, k, t) => dense.getAt(i, j, k, t),
      setAt: (i, j, k, t, v) => dense.setAt(i, j, k, t, v),
      getVolume: (t) => dense.getVolume(t),
      getSeries: (i, j, k) => dense.getSeries(i, j, k),
      getData: () => dense.getData(),
      getRange: () => [0, 0],
    };
    const file = path.join(dir, 'impostor.nii');
    let error: unknown;
    try {
      await writeVec(impostor, file);
    } catch (e) {
      error = e;
    }
    expect(isNeuroimError(error, 'INVALID_ARGUMENT')).toBe(true);
    await expect(fs.stat(file)).rejects.toThrow();
  });
});
