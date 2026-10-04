/**
 * Viewer-free subpath contract: `neuroimjs/io`, `neuroimjs/slices` and
 * `neuroimjs/geometry` must never load the display layer.
 *
 * Node consumers (e.g. the xnat2bids Electron main process) import these
 * subpaths precisely so that pixi.js, mobx and lit stay out of the process.
 * Two independent checks enforce that:
 *
 *   1. Static: walk the compiled import graph (dist/esm `import`/`export from`
 *      and dist/cjs `require`) from each subpath entry and fail if it reaches
 *      src/display, src/controls, or a forbidden package.
 *   2. Runtime, against the PACKED tarball: import each subpath in plain Node
 *      (ESM, via a module.registerHooks() resolve hook; CJS, via a
 *      Module._resolveFilename wrapper), exercise it (read a NIfTI file,
 *      extract slices, build a space), and fail if any forbidden module was
 *      resolved. A positive control does the same for the root entry and
 *      requires the recorder to see pixi.js, so a broken recorder cannot pass
 *      silently.
 *
 * Requires a built dist/ (`npm run build`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createPackedConsumer, repositoryRoot } from './lib/packed-consumer.mjs';

const SUBPATHS = ['io', 'slices', 'geometry'];

/** Packages that pull in the WebGL/reactive/UI stack. */
const FORBIDDEN_PACKAGE = /^(pixi\.js|@pixi\/.*|mobx|mobx-.*|lit|lit-html|lit-element|@lit\/.*|nouislider)(\/.*)?$/;
/** The same packages, as resolved file paths or URLs. */
const FORBIDDEN_RESOLVED = /[\\/]node_modules[\\/](pixi\.js|@pixi[\\/][^\\/]+|mobx|lit|lit-html|lit-element|@lit[\\/][^\\/]+|nouislider)[\\/]/;
/** Library-internal display modules, in any build. */
const FORBIDDEN_INTERNAL = /[\\/]dist[\\/](esm|cjs)[\\/](display|controls)[\\/]/;

const ESM_SPECIFIER = /(?:^|[\s;}])(?:import|export)\s*(?:[^'"();]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
const CJS_SPECIFIER = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveRelative(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const match = [base, `${base}.js`, join(base, 'index.js')].find(
    candidate => existsSync(candidate) && statSync(candidate).isFile()
  );
  if (!match) throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
  return match;
}

/**
 * Walk the compiled module graph from `entry`, returning every violation as
 * an import chain.
 */
function walkGraph(buildRoot, entry, pattern) {
  const parents = new Map();
  const queue = [[resolve(buildRoot, entry), null]];
  const violations = [];
  const chain = file => {
    const links = [];
    for (let current = file; current; current = parents.get(current)) links.unshift(relative(buildRoot, current));
    return links.join(' -> ');
  };
  while (queue.length > 0) {
    const [file, parent] = queue.pop();
    if (parents.has(file)) continue;
    parents.set(file, parent);
    if (FORBIDDEN_INTERNAL.test(file)) {
      violations.push(chain(file));
      continue;
    }
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith('.')) {
        queue.push([resolveRelative(file, specifier), file]);
      } else if (FORBIDDEN_PACKAGE.test(specifier)) {
        violations.push(`${chain(file)} -> ${specifier}`);
      }
    }
  }
  return { modules: parents.size, violations };
}

function staticCheck() {
  const failures = [];
  for (const subpath of SUBPATHS) {
    for (const [label, buildRoot, pattern] of [
      ['esm', join(repositoryRoot, 'dist', 'esm'), ESM_SPECIFIER],
      ['cjs', join(repositoryRoot, 'dist', 'cjs'), CJS_SPECIFIER],
    ]) {
      const entry = join('entries', `${subpath}.js`);
      if (!existsSync(join(buildRoot, entry))) {
        failures.push(`missing ${label} build of neuroimjs/${subpath} (run \`npm run build\`)`);
        continue;
      }
      const { modules, violations } = walkGraph(buildRoot, entry, pattern);
      failures.push(...violations.map(violation => `neuroimjs/${subpath} (${label}): ${violation}`));
      console.log(`static: neuroimjs/${subpath} (${label}) reaches ${modules} modules, ${violations.length} forbidden`);
    }
  }
  // Sanity check on the walker itself: the root entry must reach the viewer.
  const root = walkGraph(join(repositoryRoot, 'dist', 'esm'), 'index.js', ESM_SPECIFIER);
  if (root.violations.length === 0) failures.push('static walker found no display modules from the root entry; the check is broken');
  return failures;
}

// Prefer the in-thread module.registerHooks() (Node >= 22.15); fall back to
// the off-thread module.register() on older Node 22 releases.
const ESM_REGISTER = `
import * as nodeModule from 'node:module';
import { appendFileSync } from 'node:fs';
const record = url => appendFileSync(process.env.NEUROIMJS_RESOLVE_LOG, url + '\\n');
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      record(result.url);
      return result;
    },
  });
} else {
  nodeModule.register('data:text/javascript,' + encodeURIComponent(\`
    import { appendFileSync } from 'node:fs';
    export async function resolve(specifier, context, nextResolve) {
      const result = await nextResolve(specifier, context);
      appendFileSync(process.env.NEUROIMJS_RESOLVE_LOG, result.url + '\\\\n');
      return result;
    }
  \`));
}
`;
const CJS_RECORDER = `
const Module = require('node:module');
const { appendFileSync } = require('node:fs');
const original = Module._resolveFilename;
Module._resolveFilename = function (...args) {
  const filename = original.apply(this, args);
  appendFileSync(process.env.NEUROIMJS_RESOLVE_LOG, filename + '\\n');
  return filename;
};
`;

/** Exercise each subpath beyond merely importing it. */
const EXERCISE = {
  io: `
    const vol = await mod.readVol(fixture);
    if (vol.dim[0] !== 4) throw new Error('readVol returned dim ' + vol.dim);
    const viaAlias = await mod.read_vol(fixture);
    if (viaAlias.dim[2] !== 4) throw new Error('read_vol returned dim ' + viaAlias.dim);
    const header = await mod.readHeader(fixture);
    if (!header) throw new Error('readHeader returned nothing');
    const bytes = readFileSync(fixture);
    const fromBuffer = await mod.readVol(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (fromBuffer.dim[1] !== 4) throw new Error('readVol(ArrayBuffer) returned dim ' + fromBuffer.dim);
    for (const name of ['writeVol', 'readVec', 'writeVec', 'write_vol', 'getFormat', 'findDescriptor']) {
      if (typeof mod[name] !== 'function') throw new Error('missing ' + name);
    }
  `,
  slices: `
    const io = await load('neuroimjs/io');
    const vol = await io.readVol(fixture);
    const centre = vol.space.gridToCoord([1.5, 1.5, 1.5]);
    const slices = mod.extractOrthogonalSlices(vol, centre);
    for (const name of ['axial', 'sagittal', 'coronal']) {
      if (!(slices[name] instanceof mod.NeuroSlice)) throw new Error(name + ' is not a NeuroSlice');
      if (slices[name].getData().length !== 16) throw new Error(name + ' has the wrong size');
    }
    if (typeof mod.getCenterSliceIndex !== 'function') throw new Error('missing getCenterSliceIndex');
  `,
  geometry: `
    const space = new mod.NeuroSpace([2, 3, 4]);
    if (space.size !== 24) throw new Error('NeuroSpace size ' + space.size);
    if (!(mod.AXIAL_LPI instanceof mod.AxisSet3D)) throw new Error('AXIAL_LPI is not an AxisSet3D');
    if (typeof mod.getVolumeGeometry !== 'function') throw new Error('missing getVolumeGeometry');
  `,
};

function probeSource(kind, subpath, exercise) {
  const load = kind === 'esm' ? 'specifier => import(specifier)' : 'async specifier => require(specifier)';
  const header = kind === 'esm'
    ? "import { readFileSync } from 'node:fs';"
    : "const { readFileSync } = require('node:fs');";
  return `${header}
const fixture = process.env.NEUROIMJS_FIXTURE;
const load = ${load};
(async () => {
  const mod = await load('${subpath}');
  ${exercise}
})().catch(error => { console.error(error); process.exit(1); });
`;
}

function runtimeCheck() {
  const failures = [];
  const { consumerRoot, tarballName, run, cleanup } = createPackedConsumer({
    prefix: 'neuroimjs-subpaths-',
    name: 'neuroimjs-subpath-smoke',
  });
  try {
    writeFileSync(join(consumerRoot, 'record-register.mjs'), ESM_REGISTER);
    writeFileSync(join(consumerRoot, 'record.cjs'), CJS_RECORDER);

    // A 4x4x4 NIfTI fixture, written through the full root entry in a
    // separate process so the probes below start from a clean module graph.
    const fixture = join(consumerRoot, 'fixture.nii.gz');
    run('node', ['--input-type=module', '-e', `
      import { NeuroSpace, FloatNeuroVol, writeVol } from 'neuroimjs';
      // writeVol does not infer gzip from the file name; ask for it.
      const data = new Float32Array(64).map((_, index) => index + 1);
      await writeVol(new FloatNeuroVol(new NeuroSpace([4, 4, 4], [2, 2, 2]), data), ${JSON.stringify(fixture)}, { compress: true });
    `], consumerRoot);

    const probe = (kind, specifier, exercise) => {
      const log = join(consumerRoot, `resolved-${kind}-${specifier.replace(/\W+/g, '_')}.log`);
      writeFileSync(log, '');
      const file = join(consumerRoot, `probe-${kind}-${specifier.replace(/\W+/g, '_')}.${kind === 'esm' ? 'mjs' : 'cjs'}`);
      writeFileSync(file, probeSource(kind, specifier, exercise));
      const flags = kind === 'esm' ? ['--import', './record-register.mjs'] : ['--require', './record.cjs'];
      try {
        execFileSync(process.execPath, [...flags, file], {
          cwd: consumerRoot,
          env: { ...process.env, NEUROIMJS_RESOLVE_LOG: log, NEUROIMJS_FIXTURE: fixture },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        failures.push(`${specifier} (${kind}) failed to run:\n${error.stderr ?? error.message}`);
        return null;
      }
      const resolved = readFileSync(log, 'utf8').split('\n').filter(Boolean);
      return {
        resolved,
        forbidden: [...new Set(resolved.filter(path => FORBIDDEN_RESOLVED.test(path) || FORBIDDEN_INTERNAL.test(path)))],
      };
    };

    for (const kind of ['esm', 'cjs']) {
      for (const subpath of SUBPATHS) {
        const result = probe(kind, `neuroimjs/${subpath}`, EXERCISE[subpath]);
        if (!result) continue;
        const ownModules = result.resolved.filter(path => /[\\/]node_modules[\\/]neuroimjs[\\/]dist[\\/]/.test(path));
        if (ownModules.length === 0) failures.push(`neuroimjs/${subpath} (${kind}): recorder saw no neuroimjs modules`);
        if (result.forbidden.length > 0) {
          failures.push(`neuroimjs/${subpath} (${kind}) loaded:\n    ${result.forbidden.slice(0, 10).join('\n    ')}`);
        }
        console.log(`runtime: neuroimjs/${subpath} (${kind}) resolved ${result.resolved.length} modules, ${result.forbidden.length} forbidden`);
      }
      // Positive control: the root entry does load the viewer stack, so the
      // recorder must report it.
      const control = probe(kind, 'neuroimjs', '');
      if (control && !control.forbidden.some(path => /[\\/]pixi\.js[\\/]/.test(path))) {
        failures.push(`positive control (${kind}): root entry did not register pixi.js; the recorder is broken`);
      }
    }
    console.log(`runtime checks ran against ${tarballName}`);

    // Type-level contract: each subpath resolves to its own declarations under
    // NodeNext, from both an ES module and a CommonJS (.cts) consumer.
    writeFileSync(join(consumerRoot, 'subpath-types.ts'), `
import { readVol, read_vol, writeVol, readHeader, type NeuroVol, type ReadVolOptions } from 'neuroimjs/io';
import { extractOrthogonalSlices, NeuroSlice, getCenterSliceIndex } from 'neuroimjs/slices';
import { NeuroSpace, AxisSet3D, AXIAL_LPI, getVolumeGeometry, type VolumeGeometry } from 'neuroimjs/geometry';
// @ts-expect-error readNiftiArrayBuffer is browser-only (ESM-only nifti-reader-js).
import { readNiftiArrayBuffer } from 'neuroimjs/io';
const options: ReadVolOptions = {};
const space = new NeuroSpace([2, 2, 2]);
const axis: AxisSet3D = AXIAL_LPI;
async function thumbnail(path: string): Promise<NeuroSlice> {
  const vol: NeuroVol = await readVol(path, options);
  const geometry: VolumeGeometry = getVolumeGeometry(vol);
  void geometry;
  return extractOrthogonalSlices(vol, vol.space.gridToCoord([0, 0, 0])).axial;
}
void [read_vol, writeVol, readHeader, space, axis, thumbnail, getCenterSliceIndex, readNiftiArrayBuffer];
`);
    writeFileSync(join(consumerRoot, 'subpath-types.cts'), `
import io = require('neuroimjs/io');
import slices = require('neuroimjs/slices');
import geometry = require('neuroimjs/geometry');
const space: geometry.NeuroSpace = new geometry.NeuroSpace([2, 2, 2]);
void [io.readVol, slices.extractOrthogonalSlices, space];
`);
    writeFileSync(join(consumerRoot, 'tsconfig.subpaths.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      files: ['subpath-types.ts', 'subpath-types.cts'],
    }, null, 2));
    try {
      run('node', [join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.subpaths.json'], consumerRoot);
      console.log('types: subpath declarations type-check under NodeNext (ESM and CJS)');
    } catch (error) {
      failures.push(`subpath type contract failed:\n${String(error.stdout ?? '')}${String(error.stderr ?? '')}`);
    }
  } catch (error) {
    if (error?.stderr) process.stderr.write(String(error.stderr));
    throw error;
  } finally {
    cleanup();
  }
  return failures;
}

const failures = staticCheck();
if (failures.length === 0) failures.push(...runtimeCheck());
if (failures.length > 0) {
  console.error(`\nViewer-free subpath check FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('Viewer-free subpath check passed: neuroimjs/io, neuroimjs/slices, neuroimjs/geometry');
