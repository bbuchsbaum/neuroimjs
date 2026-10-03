import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as pako from 'pako';

vi.mock('pako', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pako')>();
  return { ...actual, ungzip: vi.fn(actual.ungzip) };
});

import { readVol, readVec } from '../src/io/io';
import { BigNeuroVec } from '../src/vector/BigNeuroVec';

/**
 * Build a 4D int16 NIfTI-1 (.nii) with an oblique sform, so geometry loss is
 * detectable: an axis-aligned identity affine would hide a dropped affine.
 */
function buildNifti4D(dims: [number, number, number, number], srow: number[][]): ArrayBuffer {
  const le = true;
  const [nx, ny, nz, nt] = dims;
  const nvox = nx * ny * nz * nt;
  const voxOffset = 352;
  const buf = new ArrayBuffer(voxOffset + nvox * 2);
  const view = new DataView(buf);
  view.setInt32(0, 348, le);
  view.setInt16(40, 4, le);
  view.setInt16(42, nx, le);
  view.setInt16(44, ny, le);
  view.setInt16(46, nz, le);
  view.setInt16(48, nt, le);
  view.setInt16(50, 1, le);
  view.setInt16(52, 1, le);
  view.setInt16(54, 1, le);
  view.setInt16(70, 4, le); // int16
  view.setInt16(72, 16, le);
  const colNorm = (c: number) => Math.hypot(srow[0][c], srow[1][c], srow[2][c]);
  view.setFloat32(76, 1, le);
  view.setFloat32(80, colNorm(0), le);
  view.setFloat32(84, colNorm(1), le);
  view.setFloat32(88, colNorm(2), le);
  view.setFloat32(92, 2, le); // TR
  view.setFloat32(108, voxOffset, le);
  view.setFloat32(112, 1, le);
  view.setFloat32(116, 0, le);
  view.setInt16(252, 0, le);
  view.setInt16(254, 1, le);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) view.setFloat32(280 + r * 16 + c * 4, srow[r][c], le);
  }
  view.setUint8(344, 0x6e);
  view.setUint8(345, 0x2b);
  view.setUint8(346, 0x31);
  view.setUint8(347, 0x00);
  // value encodes (i, j, k, t) so any transpose or offset error is visible
  let p = voxOffset;
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          view.setInt16(p, t * 1000 + k * 100 + j * 10 + i, le);
          p += 2;
        }
  return buf;
}

// 2 mm voxels rotated 30 degrees about z, with a non-trivial origin.
const c = Math.cos(Math.PI / 6);
const s = Math.sin(Math.PI / 6);
const OBLIQUE = [
  [2 * c, -2 * s, 0, -40.5],
  [2 * s, 2 * c, 0, 12.25],
  [0, 0, 2.5, -30],
];

const listing = async (dir: string) => (await fs.readdir(dir)).sort();

describe('readVec geometry and side effects', () => {
  let dataDir: string;
  let tmpDir: string;
  const savedTmp = process.env.TMPDIR;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimj-data-'));
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimj-tmp-'));
    process.env.TMPDIR = tmpDir;
    vi.mocked(pako.ungzip).mockClear();
  });

  afterEach(async () => {
    if (savedTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmp;
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('carries the full oblique affine of the file into every volume', async () => {
    const file = path.join(dataDir, 'oblique4d.nii');
    await fs.writeFile(file, new Uint8Array(buildNifti4D([4, 3, 2, 5], OBLIQUE)));

    const vec = (await readVec(file)) as BigNeuroVec;
    expect(vec.dim).toEqual([5, 4, 3, 2]); // legacy time-first shape is unchanged

    for (let t = 0; t < 5; t++) {
      const ref = await readVol(file, { index: t });
      const vol = vec.getVolume(t);
      expect(vol.space.dim).toEqual(ref.space.dim);
      expect(vol.space.trans.to2DArray()).toEqual(ref.space.trans.to2DArray());
      expect(Array.from(vol.getData())).toEqual(Array.from(ref.getData()));
    }

    const ref0 = await readVol(file, { index: 0 });
    for (const g of [[0, 0, 0], [3, 2, 1], [1, 2, 0]]) {
      const expected = ref0.space.gridToCoord(g);
      const actual = vec.volumeSpace.gridToCoord(g);
      actual.forEach((v: number, a: number) => expect(v).toBeCloseTo(expected[a], 5));
    }
    expect(vec.getAt(3, 2, 1, 4)).toBe(4000 + 100 + 20 + 3);
  });

  it('preserves geometry when reading a subset of volumes', async () => {
    const file = path.join(dataDir, 'subset.nii');
    await fs.writeFile(file, new Uint8Array(buildNifti4D([3, 3, 2, 6], OBLIQUE)));
    const vec = (await readVec(file, { indices: [5, 1] })) as BigNeuroVec;
    const ref = await readVol(file, { index: 5 });
    expect(vec.getVolume(0).space.trans.to2DArray()).toEqual(ref.space.trans.to2DArray());
    expect(vec.getAt(2, 1, 1, 0)).toBe(5000 + 100 + 10 + 2);
    expect(vec.getAt(2, 1, 1, 1)).toBe(1000 + 100 + 10 + 2);
  });

  it.each([
    ['many volumes (formerly the temp-file path)', 101, {}],
    ['useBigVec: true', 3, { useBigVec: true }],
    ['the in-memory path', 3, {}],
  ])('writes no files for %s', async (_label, nt, opts) => {
    const file = path.join(dataDir, 'run.nii');
    await fs.writeFile(file, new Uint8Array(buildNifti4D([2, 2, 2, nt], OBLIQUE)));
    const beforeData = await listing(dataDir);

    const vec = (await readVec(file, opts)) as BigNeuroVec;
    expect(vec.dim[0]).toBe(nt);
    expect(vec.getVolume(nt - 1).space.trans.to2DArray()).toEqual(
      (await readVol(file, { index: nt - 1 })).space.trans.to2DArray()
    );

    expect(await listing(dataDir)).toEqual(beforeData);
    expect(await listing(tmpDir)).toEqual([]);
  });

  it('decompresses a .nii.gz exactly once regardless of volume count', async () => {
    const file = path.join(dataDir, 'run.nii.gz');
    const raw = new Uint8Array(buildNifti4D([3, 3, 3, 12], OBLIQUE));
    await fs.writeFile(file, pako.gzip(raw));

    const vec = await readVec(file);
    expect(vec.dim[0]).toBe(12);
    expect(vi.mocked(pako.ungzip)).toHaveBeenCalledTimes(1);
  });
});
