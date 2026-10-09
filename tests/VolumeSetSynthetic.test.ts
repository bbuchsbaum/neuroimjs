/**
 * Synthetic data mode of the volume-set demo (examples/volume-set/synthetic.ts):
 * NIfTI encoder round-trip through the browser reader, manifest shape, planted
 * similarity roles, and byte-level determinism.
 */
import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { readNiftiArrayBuffer } from '../src/io/browserNifti';
import { VolumeSet } from '../src/volumeset/VolumeSet';
import { pearson } from '../src/volumeset/stats';
import type { NeuroVol } from '../src/volume/NeuroVol';
import {
  SYNTHETIC_DESCRIPTION as D,
  clearSyntheticCache,
  encodeNifti,
  parseSyntheticFile,
  syntheticGrid,
  syntheticManifest,
  syntheticMemberFile,
  syntheticTemplateFile,
} from '../examples/volume-set/synthetic';

const STAT = { beta: 0, t: 1, p: 2, se: 3 };

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function read(buf: Buffer, index = 0): NeuroVol {
  return readNiftiArrayBuffer(toArrayBuffer(buf), { index });
}

describe('encodeNifti round-trip through readNiftiArrayBuffer', { timeout: 30_000 }, () => {
  const grid = syntheticGrid();
  const [nx, ny, nz] = grid.dim;
  const n = nx * ny * nz;
  const frames = [0, 1, 2].map((f) => Float32Array.from({ length: n }, (_, g) => (g % 97) * 0.25 - 7 + f * 1000));
  frames[1][5] = NaN;

  for (const gzip of [true, false]) {
    it(`preserves dims, spacing, affine, frames and values (gzip=${gzip})`, () => {
      const buf = encodeNifti({ dim: grid.dim, spacing: grid.spacing, affine: grid.affine, frames, gzip });
      if (gzip) expect([buf[0], buf[1]]).toEqual([0x1f, 0x8b]);
      const raw = gzip ? gunzipSync(buf) : buf;
      expect(raw.length).toBe(352 + n * 4 * 3);
      expect(raw.readInt32LE(0)).toBe(348);
      expect(raw.readFloatLE(108)).toBe(352);
      expect(raw.toString('latin1', 344, 348)).toBe('n+1\0');

      for (let f = 0; f < 3; f++) {
        const vol = read(buf, f);
        expect(vol.space.dim).toEqual([nx, ny, nz]);
        const spacing = vol.space.spacing as number[];
        grid.spacing.forEach((s, a) => expect(spacing[a]).toBeCloseTo(s, 5));
        const data = vol.getData() as Float32Array;
        expect(data).toBeInstanceOf(Float32Array);
        expect(data.length).toBe(n);
        for (const g of [0, 1, 5, 1234, n - 1]) {
          if (Number.isNaN(frames[f][g])) expect(Number.isNaN(data[g])).toBe(true);
          else expect(data[g]).toBe(frames[f][g]);
        }
      }

      const vol = read(buf, 0);
      for (const ijk of [
        [0, 0, 0],
        [nx - 1, 0, 0],
        [3, 17, 29],
        [35, 43, 29],
      ]) {
        const world = vol.space.gridToCoord(ijk);
        const expected = [0, 1, 2].map((a) => grid.origin[a] + ijk[a] * grid.spacing[a]);
        world.forEach((w, a) => expect(w).toBeCloseTo(expected[a], 4));
      }
      // World (0,0,0) is near the centre but not on a voxel centre.
      const g0 = vol.space.coordToGrid([0, 0, 0]);
      expect(g0[0]).toBeCloseTo(17.4, 4);
      expect(g0[1]).toBeCloseTo(21.36, 4);
      expect(g0[2]).toBeCloseTo(14.6, 4);
      expect(() => read(buf, 3)).toThrow(/outside/);
    });
  }

  it('writes a 3D header for one frame', () => {
    const buf = encodeNifti({ dim: grid.dim, spacing: grid.spacing, affine: grid.affine, frames: [frames[0]], gzip: false });
    expect(buf.readInt16LE(40)).toBe(3);
    expect(read(buf).getData()[10]).toBe(frames[0][10]);
  });
});

describe('synthetic manifest', { timeout: 30_000 }, () => {
  const members = syntheticManifest();

  it('lists 17x3 synth + 50 + 200 members', () => {
    expect(members.length).toBe(17 * 3 + 50 + 200);
    const synth = members.filter((m) => m.model === 'synth');
    expect(synth.length).toBe(51);
    expect(new Set(synth.map((m) => m.contrast))).toEqual(new Set(['cue', 'delayearly', 'delaylate']));
    expect(new Set(synth.map((m) => m.subject)).size).toBe(17);
    for (const [model, count] of [
      ['synth50', 50],
      ['synth200', 200],
    ] as const) {
      const ms = members.filter((m) => m.model === model);
      expect(ms.length).toBe(count);
      expect(ms.every((m) => m.contrast === 'cue')).toBe(true);
      expect(new Set(ms.map((m) => m.subject)).size).toBe(count);
    }
    expect(new Set(members.map((m) => m.url)).size).toBe(members.length);
  });

  it('URLs resolve back to their member through the plugin parser', () => {
    for (const m of members) {
      expect(m.url.startsWith('/vs/files/')).toBe(true);
      expect(m.url.endsWith('.nii.gz')).toBe(true);
      const rel = decodeURIComponent(m.url.slice('/vs/files/'.length));
      expect(parseSyntheticFile(rel)).toEqual({ model: m.model, subject: m.subject, contrast: m.contrast });
    }
    expect(parseSyntheticFile('synth/sub-s99/sub-s99_contrast-cue_stats.nii.gz')).toBeNull();
    expect(parseSyntheticFile('synth/sub-s01/sub-s02_contrast-cue_stats.nii.gz')).toBeNull();
    expect(parseSyntheticFile('../etc/passwd')).toBeNull();
  });
});

describe('synthetic templates', { timeout: 30_000 }, () => {
  it('serves T1 and mask on the member grid, no atlas', () => {
    const t1 = read(syntheticTemplateFile('T1w.nii.gz')!);
    const mask = read(syntheticTemplateFile('mask.nii.gz')!);
    expect(syntheticTemplateFile('atlas.nii.gz')).toBeNull();
    expect(syntheticTemplateFile('atlas.tsv')).toBeNull();
    const member = read(syntheticMemberFile('synth', 's01', 'cue'), STAT.t);
    expect(t1.space.dim).toEqual(member.space.dim);
    expect(mask.space.gridToCoord([5, 6, 7])).toEqual(member.space.gridToCoord([5, 6, 7]));
    const m = mask.getData() as Float32Array;
    const t = t1.getData() as Float32Array;
    let inside = 0;
    let meanIn = 0;
    let meanOut = 0;
    for (let g = 0; g < m.length; g++) {
      expect(m[g] === 0 || m[g] === 1).toBe(true);
      if (m[g]) {
        inside++;
        meanIn += t[g];
      } else meanOut += t[g];
    }
    meanIn /= inside;
    meanOut /= m.length - inside;
    expect(inside / m.length).toBeGreaterThan(0.3);
    expect(inside / m.length).toBeLessThan(0.7);
    expect(meanIn).toBeGreaterThan(5 * meanOut);
  });
});

describe('planted roles in the synth cue set', { timeout: 30_000 }, () => {
  const mask = read(syntheticTemplateFile('mask.nii.gz')!);
  const maskData = mask.getData() as Float32Array;
  const subjects = D.subjects as readonly string[];
  const files = subjects.map((s) => syntheticMemberFile('synth', s, 'cue'));
  const vols = files.map((f) => read(f, STAT.t));
  const set = VolumeSet.fromVolumes(
    vols,
    subjects.map((subject) => ({ subject, contrast: 'cue', model: 'synth' })),
    mask
  );
  const values = (s: string): Float32Array => set.members[subjects.indexOf(s)].values;
  const r = (a: string, b: string): number => pearson(values(a), values(b));
  const meanR = (as: readonly string[], bs: readonly string[]): number => {
    let sum = 0;
    let n = 0;
    for (const a of as)
      for (const b of bs)
        if (a !== b) {
          sum += r(a, b);
          n++;
        }
    return sum / n;
  };

  it('is dense inside the brain and zero outside', () => {
    let brain = 0;
    for (const v of maskData) brain += v > 0.5 ? 1 : 0;
    expect(set.maskIndex.length / brain).toBeGreaterThan(0.99);
    for (const s of subjects) {
      if (s === D.constant) continue;
      const data = vols[subjects.indexOf(s)].getData() as Float32Array;
      let nonzero = 0;
      let outsideNonzero = 0;
      for (let g = 0; g < data.length; g++) {
        if (maskData[g] <= 0.5) {
          if (data[g] !== 0) outsideNonzero++;
        } else if (data[g] !== 0) nonzero++;
      }
      expect(outsideNonzero).toBe(0);
      expect(nonzero / brain).toBeGreaterThan(s === D.lowCoverage ? 0.55 : 0.99);
    }
  });

  it('identical-pattern pair: r = 1 but different raw values', () => {
    const { source, scaled } = D.identicalPattern;
    expect(r(source, scaled)).toBeGreaterThan(0.999999);
    const a = values(source);
    const b = values(scaled);
    let differ = 0;
    let maxErr = 0;
    for (let m = 0; m < a.length; m++) {
      if (a[m] !== b[m]) differ++;
      maxErr = Math.max(maxErr, Math.abs(b[m] - (2 * a[m] + 0.5)));
    }
    expect(differ).toBe(a.length);
    expect(maxErr).toBeLessThan(1e-5);
    expect(Buffer.compare(files[subjects.indexOf(source)], files[subjects.indexOf(scaled)])).not.toBe(0);
  });

  it('sign-flipped subject anticorrelates with group A', () => {
    const rs = D.groupA.map((a) => r(D.signFlip, a));
    expect(Math.max(...rs)).toBeLessThan(-0.3);
  });

  it('group A members correlate more with each other than with group B', () => {
    const within = meanR(D.groupA, D.groupA);
    const between = meanR(D.groupA, D.groupB);
    expect(within).toBeGreaterThan(0.5);
    expect(meanR(D.groupB, D.groupB)).toBeGreaterThan(0.5);
    expect(within - between).toBeGreaterThan(0.3);
    // Every A member is closer to the A centroid than to any B member on average.
    for (const a of D.groupA) {
      expect(meanR([a], D.groupA)).toBeGreaterThan(meanR([a], D.groupB));
    }
  });

  it('outlier is unrelated to both groups', () => {
    expect(Math.abs(meanR([D.outlier], D.groupA))).toBeLessThan(0.35);
    expect(Math.abs(meanR([D.outlier], D.groupB))).toBeLessThan(0.35);
  });

  it('low-coverage subject is NaN on ~40% of the set mask, finite elsewhere', () => {
    const v = values(D.lowCoverage);
    let nan = 0;
    for (const x of v) if (Number.isNaN(x)) nan++;
    const frac = nan / v.length;
    expect(frac).toBeGreaterThan(0.33);
    expect(frac).toBeLessThan(0.47);
    // Still a group-A pattern where observed.
    expect(meanR([D.lowCoverage], D.groupA)).toBeGreaterThan(0.4);
  });

  it('constant subject is all zeros', () => {
    const v = values(D.constant);
    expect(v.every((x) => x === 0)).toBe(true);
    const all = vols[subjects.indexOf(D.constant)].getData() as Float32Array;
    expect(all.every((x) => x === 0)).toBe(true);
  });

  it('frames are consistent: beta = t * se, p two-sided, se > 0 in brain', () => {
    const file = files[0];
    const [beta, t, p, se] = [STAT.beta, STAT.t, STAT.p, STAT.se].map((i) => read(file, i).getData() as Float32Array);
    let checked = 0;
    for (let g = 0; g < t.length; g += 7) {
      if (maskData[g] <= 0.5) continue;
      expect(se[g]).toBeGreaterThan(0);
      expect(beta[g]).toBeCloseTo(t[g] * se[g], 4);
      expect(p[g]).toBeGreaterThan(0);
      expect(p[g]).toBeLessThanOrEqual(1);
      if (Math.abs(t[g]) > 3) expect(p[g]).toBeLessThan(0.003);
      if (Math.abs(t[g]) < 0.5) expect(p[g]).toBeGreaterThan(0.6);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('other contrasts are variations of cue', () => {
    const cue = values('s02');
    const early = read(syntheticMemberFile('synth', 's02', 'delayearly'), STAT.t).getData() as Float32Array;
    const earlyMasked = Float32Array.from(set.maskIndex, (g) => early[g]);
    expect(pearson(cue, earlyMasked)).toBeGreaterThan(0.3);
    expect(pearson(cue, earlyMasked)).toBeLessThan(0.99);
  });
});

describe('performance sets', { timeout: 30_000 }, () => {
  it('have planted groups (subject i in group (i-1) % 4)', () => {
    const mask = read(syntheticTemplateFile('mask.nii.gz')!);
    const subjects = ['n001', 'n005', 'n009', 'n002', 'n006'];
    const vols = subjects.map((s) => read(syntheticMemberFile('synth50', s, 'cue'), STAT.t));
    const set = VolumeSet.fromVolumes(vols, subjects.map((subject) => ({ subject })), mask);
    const r = (a: number, b: number): number => pearson(set.members[a].values, set.members[b].values);
    const within = (r(0, 1) + r(0, 2) + r(1, 2) + r(3, 4)) / 4;
    const between = (r(0, 3) + r(1, 4) + r(2, 3)) / 3;
    expect(within - between).toBeGreaterThan(0.3);
    expect(() => syntheticMemberFile('synth200', 'n200', 'cue')).not.toThrow();
  });
});

describe('determinism', { timeout: 30_000 }, () => {
  it('regenerating a file yields identical bytes', () => {
    const a = syntheticMemberFile('synth', 's16', 'delaylate');
    const t = syntheticTemplateFile('T1w.nii.gz');
    clearSyntheticCache();
    const b = syntheticMemberFile('synth', 's16', 'delaylate');
    expect(b).not.toBe(a);
    expect(Buffer.compare(a, b)).toBe(0);
    expect(Buffer.compare(t!, syntheticTemplateFile('T1w.nii.gz')!)).toBe(0);
    clearSyntheticCache();
    const c = syntheticMemberFile('synth200', 'n137', 'cue');
    clearSyntheticCache();
    expect(Buffer.compare(c, syntheticMemberFile('synth200', 'n137', 'cue'))).toBe(0);
  });
});
