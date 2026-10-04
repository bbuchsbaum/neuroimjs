import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPackedConsumer, repositoryRoot } from './lib/packed-consumer.mjs';

const { consumerRoot, tarballName, run, cleanup } = createPackedConsumer({
  prefix: 'neuroimjs-package-',
  name: 'neuroimjs-package-smoke',
});

try {
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

  console.log(`Package smoke test passed: ${tarballName}`);
} catch (error) {
  if (error?.stderr) process.stderr.write(String(error.stderr));
  throw error;
} finally {
  cleanup();
}
