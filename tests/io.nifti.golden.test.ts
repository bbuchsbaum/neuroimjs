import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { readVol, readHeader, writeVol, readVec, writeVec } from '../src/io/io';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { BigNeuroVec } from '../src/vector/BigNeuroVec';

/**
 * Build a minimal but valid NIfTI-1 single-file (.nii) buffer in memory with
 * full control over endianness, datatype scaling, and the sform affine. Used to
 * exercise read-path correctness (scaling / byte order / affine) without
 * depending on external golden fixtures.
 */
function buildNiftiInt16(opts: {
  dims: [number, number, number];
  values: number[]; // raw int16 values, x-fastest
  littleEndian?: boolean;
  spacing?: [number, number, number];
  srow?: number[][]; // 3x4
  sclSlope?: number;
  sclInter?: number;
}): ArrayBuffer {
  const le = opts.littleEndian !== false;
  const spacing = opts.spacing ?? [1, 1, 1];
  const [nx, ny, nz] = opts.dims;
  const voxOffset = 352;
  const total = voxOffset + opts.values.length * 2;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);

  view.setInt32(0, 348, le); // sizeof_hdr
  // dims
  view.setInt16(40, 3, le);
  view.setInt16(42, nx, le);
  view.setInt16(44, ny, le);
  view.setInt16(46, nz, le);
  view.setInt16(48, 1, le);
  view.setInt16(50, 1, le);
  view.setInt16(52, 1, le);
  view.setInt16(54, 1, le);
  // datatype int16 (=4), bitpix 16
  view.setInt16(70, 4, le);
  view.setInt16(72, 16, le);
  // pixdim: [0]=qfac, [1..3]=spacing
  view.setFloat32(76, 1, le);
  view.setFloat32(80, spacing[0], le);
  view.setFloat32(84, spacing[1], le);
  view.setFloat32(88, spacing[2], le);
  // vox_offset
  view.setFloat32(108, voxOffset, le);
  // scl_slope / scl_inter
  view.setFloat32(112, opts.sclSlope ?? 1, le);
  view.setFloat32(116, opts.sclInter ?? 0, le);
  // qform_code 0, sform_code 1
  view.setInt16(252, 0, le);
  view.setInt16(254, 1, le);
  // srow (sform affine)
  const srow = opts.srow ?? [
    [spacing[0], 0, 0, 0],
    [0, spacing[1], 0, 0],
    [0, 0, spacing[2], 0],
  ];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      view.setFloat32(280 + r * 16 + c * 4, srow[r][c], le);
    }
  }
  // magic 'n+1\0'
  view.setUint8(344, 0x6e); // n
  view.setUint8(345, 0x2b); // +
  view.setUint8(346, 0x31); // 1
  view.setUint8(347, 0x00);
  // image data int16
  for (let i = 0; i < opts.values.length; i++) {
    view.setInt16(voxOffset + i * 2, opts.values[i], le);
  }
  return buf;
}

describe('NIfTI read-path correctness', () => {
  it('applies scl_slope and scl_inter on read', async () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7]; // 2x2x2
    const buf = buildNiftiInt16({
      dims: [2, 2, 2],
      values,
      sclSlope: 2,
      sclInter: 10,
    });
    const vol = await readVol(buf);
    const data = vol.getData();
    // Each voxel must be raw * slope + inter.
    for (let i = 0; i < values.length; i++) {
      expect(data[i]).toBeCloseTo(values[i] * 2 + 10, 5);
    }
  });

  it('treats scl_slope = 0 as "no scaling"', async () => {
    const values = [3, 4, 5, 6, 7, 8, 9, 10];
    const buf = buildNiftiInt16({ dims: [2, 2, 2], values, sclSlope: 0, sclInter: 0 });
    const vol = await readVol(buf);
    const data = vol.getData();
    for (let i = 0; i < values.length; i++) {
      expect(data[i]).toBe(values[i]);
    }
  });

  it('byte-swaps big-endian image data so it matches the little-endian read', async () => {
    const values = [0, 256, 1000, -1000, 32000, -32000, 7, 9];
    const leBuf = buildNiftiInt16({ dims: [2, 2, 2], values, littleEndian: true });
    const beBuf = buildNiftiInt16({ dims: [2, 2, 2], values, littleEndian: false });

    const leVol = await readVol(leBuf);
    const beVol = await readVol(beBuf);

    const leData = leVol.getData();
    const beData = beVol.getData();
    for (let i = 0; i < values.length; i++) {
      expect(beData[i]).toBe(values[i]);
      expect(beData[i]).toBe(leData[i]);
    }
  });

  it('reconstructs an anisotropic, translated affine from the sform', async () => {
    const srow = [
      [2, 0, 0, 100],
      [0, 2.5, 0, 120],
      [0, 0, 3, 140],
    ];
    const buf = buildNiftiInt16({
      dims: [2, 2, 2],
      values: [0, 0, 0, 0, 0, 0, 0, 0],
      spacing: [2, 2.5, 3],
      srow,
    });
    const vol = await readVol(buf);
    expect(vol.space.spacing[0]).toBeCloseTo(2, 5);
    expect(vol.space.spacing[1]).toBeCloseTo(2.5, 5);
    expect(vol.space.spacing[2]).toBeCloseTo(3, 5);
    expect(vol.space.origin[0]).toBeCloseTo(100, 5);
    expect(vol.space.origin[1]).toBeCloseTo(120, 5);
    expect(vol.space.origin[2]).toBeCloseTo(140, 5);
  });
});

describe('NIfTI write-path correctness', () => {
  const tmp = path.join(process.env.TMPDIR || '/tmp', `io_golden_${process.pid}`);

  it('round-trips an anisotropic, translated affine through write -> readHeader', async () => {
    await fs.mkdir(tmp, { recursive: true });
    const space = new NeuroSpace([4, 5, 6], [2, 2.5, 3], [100, 120, 140]);
    const vol = new FloatNeuroVol(space, new Float32Array(4 * 5 * 6));
    const file = path.join(tmp, 'affine.nii');
    await writeVol(vol, file);

    const header = await readHeader(file);
    // sform affine diagonal = spacing, translation column = origin.
    expect(header.affine[0][0]).toBeCloseTo(2, 4);
    expect(header.affine[1][1]).toBeCloseTo(2.5, 4);
    expect(header.affine[2][2]).toBeCloseTo(3, 4);
    expect(header.origin[0]).toBeCloseTo(100, 4);
    expect(header.origin[1]).toBeCloseTo(120, 4);
    expect(header.origin[2]).toBeCloseTo(140, 4);
    expect(header.qformCode).toBe(1); // qform is now written
    expect(header.sformCode).toBe(1);
    await fs.unlink(file).catch(() => {});
  });

  it('writes a qform whose quaternion alone reconstructs the affine', async () => {
    await fs.mkdir(tmp, { recursive: true });
    const space = new NeuroSpace([3, 3, 3], [2, 2, 2], [10, 20, 30]);
    const vol = new FloatNeuroVol(space, new Float32Array(27));
    const file = path.join(tmp, 'qform.nii');
    await writeVol(vol, file);

    // Zero out sform_code so nifti-reader-js must use the qform to build affine.
    const bytes = await fs.readFile(file);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    new DataView(ab).setInt16(254, 0, true); // sform_code = 0
    const qfile = path.join(tmp, 'qform_only.nii');
    await fs.writeFile(qfile, Buffer.from(ab));

    const vol2 = await readVol(qfile);
    // qform encodes orientation+scale via quaternion; recover spacing & origin.
    expect(vol2.space.spacing[0]).toBeCloseTo(2, 3);
    expect(vol2.space.spacing[1]).toBeCloseTo(2, 3);
    expect(vol2.space.spacing[2]).toBeCloseTo(2, 3);
    expect(vol2.space.origin[0]).toBeCloseTo(10, 3);
    expect(vol2.space.origin[1]).toBeCloseTo(20, 3);
    expect(vol2.space.origin[2]).toBeCloseTo(30, 3);

    await fs.unlink(file).catch(() => {});
    await fs.unlink(qfile).catch(() => {});
  });

  it('round-trips a NON-CUBIC 4D volume with per-voxel fidelity', async () => {
    await fs.mkdir(tmp, { recursive: true });
    // Distinct nx, ny, nz, nt so any axis/time transpose corrupts values.
    const T = 2, X = 2, Y = 3, Z = 4;
    const space = new NeuroSpace([T, X, Y, Z], [1, 1, 1, 1], [0, 0, 0, 0]);
    const vec = new BigNeuroVec(new Float32Array(T * X * Y * Z), space);
    const tag = (i: number, j: number, k: number, t: number) =>
      t * 1000 + i * 100 + j * 10 + k;
    for (let t = 0; t < T; t++)
      for (let i = 0; i < X; i++)
        for (let j = 0; j < Y; j++)
          for (let k = 0; k < Z; k++) vec.setAt(i, j, k, t, tag(i, j, k, t));

    const file = path.join(tmp, 'vec4d.nii');
    await writeVec(vec, file);
    const back = await readVec(file);

    expect(back.dim).toEqual([T, X, Y, Z]);
    for (let t = 0; t < T; t++)
      for (let i = 0; i < X; i++)
        for (let j = 0; j < Y; j++)
          for (let k = 0; k < Z; k++)
            expect(back.getAt(i, j, k, t)).toBe(tag(i, j, k, t));

    if ('cleanup' in vec && typeof (vec as any).cleanup === 'function') (vec as any).cleanup();
    await fs.unlink(file).catch(() => {});
  });
});
