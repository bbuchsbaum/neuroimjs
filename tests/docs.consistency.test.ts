// Guards documentation claims that drifted from the code or the repo (#34).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { searchlightIterator, randomSearchlight, bootstrapSearchlight } from '../src/searchlight/searchlight';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import { Float32NeuroVec } from '../src/vec/NeuroVec';
import { splitReduce, StatFunctions } from '../src/stats/stats';
import { DenseNeuroHyperVec } from '../src/hypervec/NeuroHyperVec';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkgVersion: string = JSON.parse(read('package.json')).version;

describe('documentation consistency (#34)', () => {
  it.each(['docs/index.md', 'docs/guide/index.md'])(
    '%s states the current package version',
    (file) => {
      const text = read(file);
      expect(text).toContain(`\`${pkgVersion}\``);
      // A maturity note must not name any other x.y.z as the current version.
      const stated = text.match(/(?:is at |pre-1\.0 \()`(\d+\.\d+\.\d+)`/g) ?? [];
      expect(stated.length).toBeGreaterThan(0);
      for (const s of stated) expect(s).toContain(pkgVersion);
    }
  );

  it('I/O guide links ADR-0004 in the repo, not the merged PR', () => {
    const io = read('docs/guide/io.md');
    expect(io).not.toContain('pull/19');
    expect(io).toContain('](/adr/0004-nifti-transform-selection)');
    expect(fs.existsSync(path.join(root, 'docs/adr/0004-nifti-transform-selection.md'))).toBe(true);
    // The guide must flag that the ADR is only a proposal while it is one.
    const adr = read('docs/adr/0004-nifti-transform-selection.md');
    if (/\*\*Status:\*\* Proposed/.test(adr)) {
      expect(io).toMatch(/ADR-0004\]\([^)]*\)[^.]*Proposed/);
    }
  });

  it('showIntensityReadout TSDoc does not present the option as working', () => {
    // Neither viewer feeds the readout layer (no callers of updateIntensity),
    // so both option docs must carry the caveat.
    const src = (rel: string) => read(rel);
    const docFor = (text: string) => {
      const idx = text.indexOf('showIntensityReadout?: boolean;');
      expect(idx).toBeGreaterThan(-1);
      const before = text.slice(0, idx);
      return before.slice(before.lastIndexOf('/**'));
    };
    expect(docFor(src('src/display/SingleSliceViewer.ts'))).toMatch(/Known issue/);
    expect(docFor(src('src/display/SimpleOrthogonalViewer.ts'))).toMatch(/currently ignored/);

    // If someone wires the readout, these caveats (and this test) must be revisited.
    const all = ['src/display/SingleSliceViewer.ts', 'src/display/SimpleOrthogonalViewer.ts', 'src/display/SliceController.ts']
      .map(src)
      .join('\n');
    expect(all).not.toMatch(/\.updateIntensity\(/);
  });
});

// The stability matrix must describe the code as it is (#35).
describe('stability matrix matches the code (#35)', () => {
  const stability = read('docs/guide/stability.md');
  /** The table row whose first cell is exactly `feature`. */
  const row = (feature: string): string => {
    const line = stability.split('\n').find(l => l.startsWith(`| ${feature} |`));
    expect(line, `no stability row for ${feature}`).toBeDefined();
    return line!;
  };

  it('documents that nonzero and random/bootstrap searchlights clip spheres to the mask', () => {
    const space = new NeuroSpace([6, 6, 6], [1, 1, 1], [0, 0, 0]);
    const mask = new LogicalNeuroVol(space);
    const maskData = mask.getData() as Uint8Array;
    maskData[space.gridToIndex([2, 2, 2])] = 1;
    maskData[space.gridToIndex([3, 2, 2])] = 1;
    type Win = { indices(): number[] };
    const inMask = (w: Win) => w.indices().every(i => maskData[i] === 1);

    const clipped = searchlightIterator(mask, 1.5, { nonzero: true, eager: true }) as Win[];
    const geometric = searchlightIterator(mask, 1.5, { nonzero: true, eager: true, clipToMask: false }) as Win[];
    expect(clipped.length).toBe(2);
    expect(clipped.every(inMask)).toBe(true);
    expect(geometric.some(w => !inMask(w))).toBe(true);
    expect(randomSearchlight(mask, 1.5, { seed: 1 }).every(inMask)).toBe(true);
    expect(bootstrapSearchlight(mask, 1.5, 2, { seed: 1 }).every(inMask)).toBe(true);

    const notes = row('Searchlight sphere membership');
    expect(notes).not.toMatch(/not clipped to the mask \(`nonzero` restricts centres only\)/);
    expect(notes).toMatch(/`nonzero: true`, sphere members as well as centres are restricted to the mask/);
    expect(notes).toMatch(/`randomSearchlight` and `bootstrapSearchlight` also clip by default/);
    expect(notes).toContain('`clipToMask: false`');
    expect(notes).toContain('stability-badge stable');
    // The roadmap must not list it as an open known issue either.
    const roadmap = stability.slice(stability.indexOf('## Roadmap'));
    expect(roadmap).not.toMatch(/searchlight sphere membership/i);
  });

  it('documents that splitReduce keeps the affine and still averages levels', () => {
    const affine = [
      [0, -2, 0, 10],
      [2, 0, 0, -5],
      [0, 0, 2, 3],
      [0, 0, 0, 1],
    ];
    const space = new NeuroSpace([3, 3, 3, 4], [2, 2, 2, 1], [0, 0, 0, 0], undefined, affine);
    const vec = new Float32NeuroVec(space, new Float32Array(27 * 4).map((_, i) => Math.floor(i / 27)));
    const out = splitReduce(vec, new Int32Array([0, 0, 1, 1]), StatFunctions.mean);
    expect(out.dim).toEqual([3, 3, 3]);
    expect(out.space.trans.to2DArray()).toEqual(affine);
    // Level means 0.5 and 2.5 are averaged into one volume.
    expect(out.getData()[0]).toBeCloseTo(1.5);

    const notes = row('`splitReduce`');
    expect(notes).not.toMatch(/dropping axes and affine/);
    expect(notes).toMatch(/keeps the input's 3D geometry, including the affine/);
    expect(notes).toMatch(/mean of the per-level reductions/);
  });

  it('does not claim StatFunctions.median avoids NaN', () => {
    expect(StatFunctions.median(new Float32Array([3, NaN, 1, 2]))).toBeNaN();
    const notes = row('`StatFunctions` (mean/sum/min/max/std/median)');
    expect(notes).not.toMatch(/not NaN/);
    expect(notes).toMatch(/`median` does not skip NaN/);
  });

  it('documents that DenseNeuroHyperVec.save rejects rather than throws', async () => {
    const space = new NeuroSpace([2, 2, 2], [1, 1, 1], [0, 0, 0]);
    const hv = new DenseNeuroHyperVec(space, [{ name: 'a', size: 2 }]);
    expect(() => hv.extractFeatures({} as never)).toThrow(/not yet implemented/);
    let saved: Promise<void> | undefined;
    expect(() => {
      saved = hv.save('x.h5');
    }).not.toThrow();
    await expect(saved).rejects.toThrow(/not yet implemented/);
    const notes = row('`DenseNeuroHyperVec.glm`, `extractFeatures`, `save`');
    expect(notes).toMatch(/async `save` returns a promise that rejects/);
  });
});
