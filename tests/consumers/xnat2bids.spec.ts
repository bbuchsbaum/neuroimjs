/**
 * xnat2bids (Electron desktop app) — Node main-process consumer.
 *
 * Mirrors packages/desktop/electron/nifti.ts in xnat2bids
 * (~/code/jscode/xnat2bids, dependency "link:../../../neuroimjs"), which
 * builds NIfTI thumbnails by resolving the package root from
 * require.resolve('neuroimjs') and importing two DEEP paths directly:
 *   dist/esm/io/nifti.js              -> read_vol(path)
 *   dist/esm/volume/orthogonalSlices.js -> extractOrthogonalSlices(vol, world)
 * Deep paths are not part of the package's `exports` map, so this is a
 * tolerated layout contract: moving either file breaks the thumbnail code
 * even though the root entry still exports both functions. The spec checks
 * the deep paths in the installed tarball AND the root exports.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { encodeNifti1, underlayVolume } from './pages/harness';
import { consumerEnvironment } from './support';

interface NeuroSliceLike {
  dim: readonly number[];
  getData(): ArrayLike<number>;
}

interface NeuroVolLike {
  dim: readonly number[];
  space: { gridToCoord(voxel: number[]): number[] };
}

type ReadVol = (path: string) => Promise<NeuroVolLike>;
type ExtractSlices = (vol: NeuroVolLike, centerWorld: number[]) => Record<'axial' | 'sagittal' | 'coronal', NeuroSliceLike>;

const DEEP_NIFTI = 'dist/esm/io/nifti.js';
const DEEP_SLICES = 'dist/esm/volume/orthogonalSlices.js';

test.describe('xnat2bids thumbnail reader', () => {
  let workDir: string;
  let packageRoot: string;

  test.beforeAll(() => {
    const { root } = consumerEnvironment();
    workDir = mkdtempSync(join(tmpdir(), 'neuroimjs-xnat2bids-'));
    // loadNeuroimjsReader(): resolve the CJS entry, then walk up to the root.
    const require = createRequire(join(root, 'package.json'));
    const entry = require.resolve('neuroimjs');
    packageRoot = resolve(dirname(entry), '..', '..');
    expect(entry.split(/[\\/]/).slice(-3).join('/')).toBe('dist/cjs/index.js');
  });

  test.afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  test('deep module paths exist in the packed tarball', () => {
    expect(existsSync(join(packageRoot, 'package.json'))).toBe(true);
    expect(existsSync(join(packageRoot, DEEP_NIFTI))).toBe(true);
    expect(existsSync(join(packageRoot, DEEP_SLICES))).toBe(true);
  });

  test('createNiftiThumbnail call sequence on .nii and .nii.gz', async () => {
    const niftiModule = await import(pathToFileURL(join(packageRoot, DEEP_NIFTI)).href);
    const sliceModule = await import(pathToFileURL(join(packageRoot, DEEP_SLICES)).href);
    const readVol = (niftiModule as { read_vol?: unknown }).read_vol;
    const extractOrthogonalSlices = (sliceModule as { extractOrthogonalSlices?: unknown }).extractOrthogonalSlices;
    expect(typeof readVol).toBe('function');
    expect(typeof extractOrthogonalSlices).toBe('function');

    const synthetic = underlayVolume();
    const bytes = Buffer.from(encodeNifti1(synthetic));
    const files = [join(workDir, 'anat.nii'), join(workDir, 'anat.nii.gz')];
    writeFileSync(files[0], bytes);
    writeFileSync(files[1], gzipSync(bytes));

    for (const file of files) {
      const vol = await (readVol as ReadVol)(file);
      const dims = vol.dim.slice(0, 3).map(dim => Number(dim));
      expect(dims).toEqual(synthetic.dim);
      const centerVoxel = dims.map(dim => (dim - 1) / 2);
      const centerWorld = vol.space.gridToCoord(centerVoxel);
      expect(centerWorld).toHaveLength(3);
      const slices = (extractOrthogonalSlices as ExtractSlices)(vol, centerWorld);
      for (const name of ['axial', 'sagittal', 'coronal'] as const) {
        const slice = slices[name];
        const width = Math.round(Number(slice.dim[0]));
        const height = Math.round(Number(slice.dim[1]));
        const data = slice.getData();
        expect(width * height, `${name} slice size`).toBe(data.length);
        let max = -Infinity;
        for (let index = 0; index < data.length; index += 1) max = Math.max(max, Number(data[index]));
        expect(max, `${name} slice through the head centre`).toBeGreaterThan(0);
      }
    }
  });

  test('the root entry exports the same functions (ESM and CJS)', () => {
    const { root } = consumerEnvironment();
    const probe = [
      "import { read_vol, extractOrthogonalSlices } from 'neuroimjs';",
      "if (typeof read_vol !== 'function' || typeof extractOrthogonalSlices !== 'function') process.exit(3);",
    ].join('\n');
    execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, stdio: 'pipe' });
    const require = createRequire(join(root, 'package.json'));
    const cjs = require('neuroimjs') as Record<string, unknown>;
    expect(typeof cjs.read_vol).toBe('function');
    expect(typeof cjs.extractOrthogonalSlices).toBe('function');
  });
});
