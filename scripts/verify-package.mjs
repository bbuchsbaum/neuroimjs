import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'neuroimjs-package-'));
const npmCache = join(temporaryRoot, 'npm-cache');
const environment = { ...process.env, npm_config_cache: npmCache };

function run(command, args, cwd = repositoryRoot) {
  return execFileSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

try {
  const packResult = JSON.parse(run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    temporaryRoot,
  ]));
  const tarball = join(temporaryRoot, packResult[0].filename);
  const consumerRoot = join(temporaryRoot, 'consumer');

  writeFileSync(join(temporaryRoot, 'package.json'), JSON.stringify({ private: true }));
  mkdirSync(consumerRoot);
  writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({
    name: 'neuroimjs-package-smoke',
    private: true,
    type: 'module',
  }));

  run('npm', [
    'install',
    tarball,
    '--ignore-scripts',
    '--omit=optional',
    '--no-audit',
    '--no-fund',
  ], consumerRoot);

  run('node', [
    '-e',
    "const pkg=require('neuroimjs'); const s=new pkg.NeuroSpace([2,2,2]); if(s.size!==8) process.exit(1)",
  ], consumerRoot);
  run('node', [
    '-e',
    "(async()=>{const pkg=require('neuroimjs');try{await pkg.readVol(new ArrayBuffer(4));throw new Error('invalid NIfTI accepted')}catch(error){if(!String(error.message).includes('not a valid NIfTI'))throw error}})()",
  ], consumerRoot);
  run('node', [
    '--input-type=module',
    '-e',
    "import {NeuroSpace} from 'neuroimjs'; const s=new NeuroSpace([2,2,2]); if(s.size!==8) process.exit(1)",
  ], consumerRoot);

  writeFileSync(join(consumerRoot, 'root-types.ts'), `
import {
  ColorMapFactory,
  Float64NeuroVol,
  NeuroSpace,
  type Color,
  type OrthogonalImageViewerOptions,
  type ScatterFieldOptions,
  type StatisticalNeuroVec,
} from 'neuroimjs';
const color: Color = [1, 0, 0];
const viewerOptions: OrthogonalImageViewerOptions = { showCrosshair: true };
const space = new NeuroSpace([2, 2, 2]);
const scatterOptions: ScatterFieldOptions = { space, points: [{ x: 0, y: 0, z: 0 }] };
const volume = new Float64NeuroVol(space, new Float64Array(8));
const map = ColorMapFactory.createGradient(color, [0, 0, 1]);
declare const reviewVector: StatisticalNeuroVec;
void [viewerOptions, scatterOptions, volume, map, reviewVector];
`);

  writeFileSync(join(consumerRoot, 'browser-types.ts'), `
import { NeuroSpace, type SimpleOrthogonalViewerOptions } from 'neuroimjs/browser';
// @ts-expect-error The browser entry must not claim to export Node-only I/O.
import { readVol } from 'neuroimjs/browser';
const space = new NeuroSpace([2, 2, 2]);
const viewerOptions: SimpleOrthogonalViewerOptions = { layout: 'top-bottom' };
void space;
void viewerOptions;
void readVol;
`);
  writeFileSync(join(consumerRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      lib: ['ES2020', 'DOM', 'ESNext.Collection'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ['browser-types.ts', 'root-types.ts'],
  }, null, 2));

  const typescript = join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  run('node', [typescript, '--project', 'tsconfig.json'], consumerRoot);

  const packedPackage = JSON.parse(readFileSync(
    join(consumerRoot, 'node_modules', 'neuroimjs', 'package.json'),
    'utf8'
  ));
  if (packedPackage.exports['./browser'].types !== './dist/types/browser.d.ts') {
    throw new Error('Browser export does not point to browser-specific declarations');
  }

  console.log(`Package smoke test passed: ${packResult[0].filename}`);
} catch (error) {
  if (error?.stderr) process.stderr.write(String(error.stderr));
  throw error;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
