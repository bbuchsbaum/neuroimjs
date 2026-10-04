/**
 * Opt-in nibabel check of the NIfTI writers: neuroimjs writes files, nibabel
 * loads them, and the two must agree on shape, datatype, qform, sform, zooms
 * and voxel values.
 *
 * Needs uv and network access on first run, so it is skipped unless
 * NIJ_NIBABEL=1. Run it with `npm run conformance:writers`. The Python and
 * nibabel/numpy versions are the ones recorded in fixtures/manifest.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeVec, writeVol } from '../../src/io/io';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol, Int16NeuroVol } from '../../src/volume/DenseNeuroVol';
import { Float32NeuroVec, Int16NeuroVec, type NeuroVec } from '../../src/vec/NeuroVec';
import { BigNeuroVec } from '../../src/vector/BigNeuroVec';

const enabled = process.env.NIJ_NIBABEL === '1';
const root = join(__dirname, '..', '..');

interface NibabelView {
  shape: number[];
  dtype: string;
  affine: number[][];
  qform: number[][] | null;
  qform_code: number;
  sform: number[][] | null;
  sform_code: number;
  zooms: number[];
  units: (string | null)[];
  data: number[];
}

function findUv(): string {
  if (process.env.UV) return process.env.UV;
  if (spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0) return 'uv';
  const local = join(homedir(), '.local', 'bin', 'uv');
  if (existsSync(local)) return local;
  throw new Error('uv not found; install it or set UV=/path/to/uv');
}

function nibabelInspect(files: string[]): Record<string, NibabelView> {
  const manifest = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'manifest.json'), 'utf8'));
  const { python, nibabel, numpy } = manifest.generator as { python: string; nibabel: string; numpy: string };
  const pythonMinor = python.split('.').slice(0, 2).join('.');
  const result = spawnSync(
    findUv(),
    [
      'run', '--no-project', '--python', pythonMinor,
      '--with', `nibabel==${nibabel}`, '--with', `numpy==${numpy}`,
      'python', 'scripts/conformance/inspect_written_nifti.py', ...files,
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status !== 0) throw new Error(`nibabel inspection failed:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Oblique, left-handed affine with voxel sizes 2/3/4. */
function obliqueAffine(): number[][] {
  const a = (25 * Math.PI) / 180;
  const b = (-15 * Math.PI) / 180;
  const rz = [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  const rx = [[1, 0, 0], [0, Math.cos(b), -Math.sin(b)], [0, Math.sin(b), Math.cos(b)]];
  const r = rz.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * rx[k][j], 0)));
  const scale = [-2, 3, 4];
  const offset = [40.5, -62.25, 18];
  return [
    [r[0][0] * scale[0], r[0][1] * scale[1], r[0][2] * scale[2], offset[0]],
    [r[1][0] * scale[0], r[1][1] * scale[1], r[1][2] * scale[2], offset[1]],
    [r[2][0] * scale[0], r[2][1] * scale[1], r[2][2] * scale[2], offset[2]],
    [0, 0, 0, 1],
  ];
}

const [X, Y, Z, T] = [3, 4, 5, 6];
const tag = (i: number, j: number, k: number, t: number): number => t * 1000 + i * 100 + j * 10 + k;

/** Expected NIfTI-order (x fastest, then time) values. */
function expectedData(nt: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < Z; k++) for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) out.push(tag(i, j, k, t));
  return out;
}

function fillVec(vec: NeuroVec): void {
  for (let t = 0; t < T; t++)
    for (let k = 0; k < Z; k++) for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) vec.setAt(i, j, k, t, tag(i, j, k, t));
}

function expectAffineClose(actual: number[][] | null, expected: number[][]): void {
  expect(actual).not.toBeNull();
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      expect(Math.abs(actual![r][c] - expected[r][c]), `[${r}][${c}]`).toBeLessThanOrEqual(
        1e-5 * Math.max(1, Math.abs(expected[r][c]))
      );
}

describe.skipIf(!enabled)('NIfTI writers checked by nibabel (opt-in: NIJ_NIBABEL=1)', () => {
  let dir: string;
  let views: Record<string, NibabelView>;
  const affine = obliqueAffine();
  const files: Record<string, string> = {};

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'nij-nibabel-writers-'));
    files.vol = join(dir, 'vol.nii.gz');
    files.volInt16 = join(dir, 'vol_int16.nii');
    files.dense = join(dir, 'dense.nii.gz');
    files.denseInt16 = join(dir, 'dense_int16.nii');
    files.big = join(dir, 'big.nii');

    const space3 = new NeuroSpace([X, Y, Z], undefined, undefined, undefined, affine);
    const volData = new Float32Array(expectedData(1));
    await writeVol(new FloatNeuroVol(space3, volData), files.vol);
    await writeVol(new Int16NeuroVol(space3, new Int16Array(expectedData(1))), files.volInt16);

    const dense = new Float32NeuroVec(new NeuroSpace([X, Y, Z, T], undefined, undefined, undefined, affine));
    fillVec(dense);
    await writeVec(dense, files.dense);

    const denseInt16 = new Int16NeuroVec(new NeuroSpace([X, Y, Z, T], [2, 3, 4, 2.5], undefined, undefined, affine));
    fillVec(denseInt16);
    await writeVec(denseInt16, files.denseInt16);

    const big = new BigNeuroVec(
      new Float32Array(T * X * Y * Z),
      new NeuroSpace([T, X, Y, Z], [1, ...space3.spacing], [0, ...space3.origin]),
      { storage: 'memory', volumeSpace: space3 }
    );
    fillVec(big);
    await writeVec(big, files.big);

    views = nibabelInspect(Object.values(files));
  }, 300_000);

  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it.each([
    ['vol', [X, Y, Z], 'float32', 1],
    ['volInt16', [X, Y, Z], 'int16', 1],
    ['dense', [X, Y, Z, T], 'float32', T],
    ['denseInt16', [X, Y, Z, T], 'int16', T],
    ['big', [X, Y, Z, T], 'float32', T],
  ] as const)('%s: shape, dtype, qform, sform and values agree', (key, shape, dtype, nt) => {
    const view = views[files[key]];
    expect(view.shape).toEqual(shape);
    expect(view.dtype).toBe(dtype);
    expect(view.qform_code).toBe(1);
    expect(view.sform_code).toBe(1);
    expectAffineClose(view.qform, affine);
    expectAffineClose(view.sform, affine);
    expectAffineClose(view.affine, affine);
    for (let d = 0; d < 3; d++) expect(view.zooms[d]).toBeCloseTo([2, 3, 4][d], 5);
    expect(view.units[0]).toBe('mm');
    expect(view.data).toEqual(expectedData(nt));
  });

  it('writes the time spacing as the fourth zoom', () => {
    expect(views[files.denseInt16].zooms[3]).toBeCloseTo(2.5, 6);
    expect(views[files.dense].zooms[3]).toBe(1);
    expect(views[files.big].zooms[3]).toBe(1);
  });
});
