/**
 * xnat2bids (Electron desktop app) — Node main-process consumer.
 *
 * Mirrors packages/desktop/electron/nifti.ts in xnat2bids
 * (~/code/jscode/xnat2bids, dependency "link:../../../neuroimjs"), which
 * builds NIfTI thumbnails with read_vol(path) and
 * extractOrthogonalSlices(vol, world). It must not import the root entry,
 * because that loads pixi.js, mobx and lit into the Electron main process.
 *
 * Supported route (0.5.x+): the viewer-free subpaths
 *   neuroimjs/io     -> read_vol / readVol
 *   neuroimjs/slices -> extractOrthogonalSlices
 * whose freedom from the display stack is enforced by
 * scripts/verify-subpaths.mjs (`npm run test:package`).
 *
 * Tolerated internals: the app currently resolves the package root from
 * require.resolve('neuroimjs') and imports two DEEP paths directly:
 *   dist/esm/io/nifti.js                -> read_vol(path)
 *   dist/esm/volume/orthogonalSlices.js -> extractOrthogonalSlices(vol, world)
 * Deep paths are not part of the `exports` map; they stay covered here until
 * xnat2bids migrates to the subpaths, after which they may move.
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
const SLICE_NAMES = ['axial', 'sagittal', 'coronal'] as const;

interface SliceSummary {
  name: string;
  width: number;
  height: number;
  length: number;
  max: number;
}

/** createNiftiThumbnail(): read, centre, slice — summarised per slice. */
async function thumbnailSummary(readVol: ReadVol, extract: ExtractSlices, file: string) {
  const vol = await readVol(file);
  const dims = vol.dim.slice(0, 3).map(dim => Number(dim));
  const centerWorld = vol.space.gridToCoord(dims.map(dim => (dim - 1) / 2));
  const slices = extract(vol, centerWorld);
  const summaries: SliceSummary[] = SLICE_NAMES.map(name => {
    const data = slices[name].getData();
    let max = -Infinity;
    for (let index = 0; index < data.length; index += 1) max = Math.max(max, Number(data[index]));
    return {
      name,
      width: Math.round(Number(slices[name].dim[0])),
      height: Math.round(Number(slices[name].dim[1])),
      length: data.length,
      max,
    };
  });
  return { dims, centerWorld, summaries };
}

function expectThumbnail(result: Awaited<ReturnType<typeof thumbnailSummary>>, expectedDims: number[]): void {
  expect(result.dims).toEqual(expectedDims);
  expect(result.centerWorld).toHaveLength(3);
  for (const slice of result.summaries) {
    expect(slice.width * slice.height, `${slice.name} slice size`).toBe(slice.length);
    expect(slice.max, `${slice.name} slice through the head centre`).toBeGreaterThan(0);
  }
}

test.describe('xnat2bids thumbnail reader', () => {
  let workDir: string;
  let packageRoot: string;
  let files: string[];
  const synthetic = underlayVolume();

  test.beforeAll(() => {
    const { root } = consumerEnvironment();
    workDir = mkdtempSync(join(tmpdir(), 'neuroimjs-xnat2bids-'));
    // loadNeuroimjsReader(): resolve the CJS entry, then walk up to the root.
    const require = createRequire(join(root, 'package.json'));
    const entry = require.resolve('neuroimjs');
    packageRoot = resolve(dirname(entry), '..', '..');
    expect(entry.split(/[\\/]/).slice(-3).join('/')).toBe('dist/cjs/index.js');

    const bytes = Buffer.from(encodeNifti1(synthetic));
    files = [join(workDir, 'anat.nii'), join(workDir, 'anat.nii.gz')];
    writeFileSync(files[0], bytes);
    writeFileSync(files[1], gzipSync(bytes));
  });

  test.afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  test('supported subpaths: ESM thumbnail sequence via neuroimjs/io + neuroimjs/slices', () => {
    const { root } = consumerEnvironment();
    // A fresh Node process from the consumer project, importing the subpaths
    // exactly as an Electron main process (ESM) would.
    const probe = `
      import { read_vol } from 'neuroimjs/io';
      import { extractOrthogonalSlices } from 'neuroimjs/slices';
      const thumbnailSummary = ${thumbnailSummary.toString()};
      const SLICE_NAMES = ${JSON.stringify(SLICE_NAMES)};
      const results = [];
      for (const file of ${JSON.stringify(files)}) {
        results.push(await thumbnailSummary(read_vol, extractOrthogonalSlices, file));
      }
      process.stdout.write(JSON.stringify(results));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const results = JSON.parse(output) as Awaited<ReturnType<typeof thumbnailSummary>>[];
    expect(results).toHaveLength(files.length);
    for (const result of results) expectThumbnail(result, synthetic.dim);
  });

  test('supported subpaths: CJS thumbnail sequence via neuroimjs/io + neuroimjs/slices', async () => {
    const { root } = consumerEnvironment();
    const require = createRequire(join(root, 'package.json'));
    expect(require.resolve('neuroimjs/io').split(/[\\/]/).slice(-3).join('/')).toBe('cjs/entries/io.js');
    const io = require('neuroimjs/io') as { read_vol: ReadVol; readVol: ReadVol };
    const slices = require('neuroimjs/slices') as { extractOrthogonalSlices: ExtractSlices };
    const geometry = require('neuroimjs/geometry') as { NeuroSpace: new (dim: number[]) => { size: number } };
    expect(new geometry.NeuroSpace([2, 2, 2]).size).toBe(8);
    for (const file of files) {
      expectThumbnail(await thumbnailSummary(io.read_vol, slices.extractOrthogonalSlices, file), synthetic.dim);
      expectThumbnail(await thumbnailSummary(io.readVol, slices.extractOrthogonalSlices, file), synthetic.dim);
    }
  });

  test('tolerated internals: deep module paths exist in the packed tarball', () => {
    expect(existsSync(join(packageRoot, 'package.json'))).toBe(true);
    expect(existsSync(join(packageRoot, DEEP_NIFTI))).toBe(true);
    expect(existsSync(join(packageRoot, DEEP_SLICES))).toBe(true);
  });

  test('tolerated internals: createNiftiThumbnail call sequence through the deep paths', async () => {
    const niftiModule = await import(pathToFileURL(join(packageRoot, DEEP_NIFTI)).href);
    const sliceModule = await import(pathToFileURL(join(packageRoot, DEEP_SLICES)).href);
    const readVol = (niftiModule as { read_vol?: unknown }).read_vol;
    const extractOrthogonalSlices = (sliceModule as { extractOrthogonalSlices?: unknown }).extractOrthogonalSlices;
    expect(typeof readVol).toBe('function');
    expect(typeof extractOrthogonalSlices).toBe('function');
    for (const file of files) {
      expectThumbnail(
        await thumbnailSummary(readVol as ReadVol, extractOrthogonalSlices as ExtractSlices, file),
        synthetic.dim
      );
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
