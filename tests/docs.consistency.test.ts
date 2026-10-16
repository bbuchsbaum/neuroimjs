// Guards documentation claims that drifted from the code or the repo (#34).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
