import { describe, it, expect } from 'vitest';
import { similarityBasis, basisR, BASIS_VERSION } from '../src/volumeset/basis';
import { correlationMatrix } from '../src/volumeset/stats';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { VolumeSet } from '../src/volumeset/VolumeSet';

const f32 = (xs: number[]): Float32Array => Float32Array.from(xs);

/** Independent reference: textbook Pearson in float64 over an explicit voxel list. */
function refPearson(a: ArrayLike<number>, b: ArrayLike<number>, idx: number[]): number {
  const n = idx.length;
  const ma = idx.reduce((s, v) => s + a[v], 0) / n;
  const mb = idx.reduce((s, v) => s + b[v], 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (const v of idx) {
    sab += (a[v] - ma) * (b[v] - mb);
    saa += (a[v] - ma) ** 2;
    sbb += (b[v] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('similarity basis: common support', () => {
  it('compares every pair on the same voxels, unlike pairwise deletion', () => {
    // Voxel 4 is missing in a only. b and c are finite there, so pairwise deletion
    // would include it for (b, c); the common support does not.
    const a = f32([1, 2, 3, 4, NaN]);
    const b = f32([2, 4, 6, 8, 100]);
    const c = f32([4, 3, 2, 1, 100]);
    const basis = similarityBasis([a, b, c], ['a', 'b', 'c'], { minCoverage: 0.7, minSupport: 3 });
    expect(basis.status).toBe('ok');
    expect(Array.from(basis.support)).toEqual([0, 1, 2, 3]);
    expect(basisR(basis, 'a', 'b')).toBe(1);
    expect(basisR(basis, 'a', 'c')).toBe(-1);
    expect(basisR(basis, 'b', 'c')).toBe(-1);
    // Pairwise deletion gives a different (b, c) value, which is why the demo no longer uses it.
    const pairwise = correlationMatrix([a, b, c]);
    expect(pairwise[1 * 3 + 2]).toBeGreaterThan(0);
    // Distances: exact 0 for r = 1, exact 2 for r = -1, symmetric, zero diagonal.
    expect(Array.from(basis.dist)).toEqual([0, 0, 2, 0, 0, 2, 2, 2, 0]);
  });

  it('keeps finite zeros as valid data', () => {
    const a = f32([0, 0, 1, 2, 0, 3]);
    const b = f32([0, 1, 0, 2, 0, 3]);
    const basis = similarityBasis([a, b], ['a', 'b'], { minSupport: 3 });
    expect(basis.support.length).toBe(6);
    expect(basisR(basis, 'a', 'b')).toBeCloseTo(refPearson(a, b, [0, 1, 2, 3, 4, 5]), 12);
  });

  it('excludes an all-missing member without annihilating the support', () => {
    const a = f32([1, 2, 3, 4, 5]);
    const b = f32([2, 1, 4, 3, 5]);
    const gone = f32([NaN, NaN, NaN, NaN, NaN]);
    const basis = similarityBasis([a, gone, b], ['a', 'x', 'b'], { minSupport: 3 });
    expect(basis.status).toBe('ok');
    expect(basis.eligible).toEqual([0, 2]);
    expect(basis.excluded).toEqual([{ index: 1, id: 'x', reason: 'all-missing', detail: expect.any(String) }]);
    expect(basis.support.length).toBe(5);
    expect(basisR(basis, 'a', 'b')).toBeCloseTo(refPearson(a, b, [0, 1, 2, 3, 4]), 12);
    // The excluded member keeps its identity; its correlations are NaN, not a fabricated distance.
    expect(basis.ids).toEqual(['a', 'x', 'b']);
    expect(Number.isNaN(basisR(basis, 'x', 'a'))).toBe(true);
    expect(basis.dist.length).toBe(4);
  });

  it('excludes low-coverage members explicitly and reports their coverage', () => {
    const n = 20;
    const r = rng(3);
    const a = Float32Array.from({ length: n }, () => r());
    const b = Float32Array.from({ length: n }, () => r());
    const patchy = Float32Array.from({ length: n }, (_, v) => (v < 12 ? NaN : r()));
    const basis = similarityBasis([a, b, patchy], ['a', 'b', 'p'], { minCoverage: 0.9, minSupport: 5 });
    expect(basis.coverage[2]).toBeCloseTo(0.4, 12);
    expect(basis.excluded.map((e) => [e.id, e.reason])).toEqual([['p', 'low-coverage']]);
    expect(basis.excluded[0].detail).toMatch(/40%.*90%.*100%/);
    expect(basis.support.length).toBe(n);
    // Lowering the coverage rule admits it, at the cost of a smaller common support.
    const loose = similarityBasis([a, b, patchy], ['a', 'b', 'p'], { minCoverage: 0.3, minSupport: 5 });
    expect(loose.eligible).toEqual([0, 1, 2]);
    expect(loose.support.length).toBe(8);
    expect(basisR(loose, 'a', 'b')).toBeCloseTo(refPearson(a, b, [12, 13, 14, 15, 16, 17, 18, 19]), 12);
  });

  it('measures coverage relative to the median map, so uniformly partial maps are not all excluded', () => {
    // Every map is missing on its own 20% (e.g. NaN outside each subject's brain mask).
    const n = 50;
    const r = rng(9);
    const data = [0, 1, 2, 3].map((m) => Float32Array.from({ length: n }, (_, v) => (Math.floor(v / 10) === m ? NaN : r())));
    const basis = similarityBasis(data, ['a', 'b', 'c', 'd'], { minSupport: 5 });
    expect(Array.from(basis.coverage)).toEqual([0.8, 0.8, 0.8, 0.8]);
    expect(basis.status).toBe('ok');
    expect(basis.eligible).toEqual([0, 1, 2, 3]);
    expect(basis.support.length).toBe(10);
    // A map with half the median coverage is still excluded.
    const patchy = Float32Array.from({ length: n }, (_, v) => (v < 30 ? NaN : r()));
    const b2 = similarityBasis([...data, patchy], ['a', 'b', 'c', 'd', 'p'], { minSupport: 5 });
    expect(b2.excluded.map((e) => [e.id, e.reason])).toEqual([['p', 'low-coverage']]);
  });

  it('excludes constant maps, including maps constant only on the common support', () => {
    const a = f32([1, 2, 3, 4, 5, 6]);
    const b = f32([3, 1, 2, 6, 5, 4]);
    const flat = f32([0, 0, 0, 0, 0, 0]);
    // Varies only where c is missing, so it is constant on the common support.
    const edge = f32([7, 7, 7, 7, 1, 9]);
    const c = f32([2, 5, 1, 3, NaN, NaN]);
    const basis = similarityBasis([a, b, flat, edge, c], ['a', 'b', 'f', 'e', 'c'], { minCoverage: 0.5, minSupport: 3 });
    const reasons = Object.fromEntries(basis.excluded.map((e) => [e.id, e.reason]));
    expect(reasons).toEqual({ f: 'constant', e: 'constant-on-support' });
    expect(basis.eligible).toEqual([0, 1, 4]);
    expect(Array.from(basis.support)).toEqual([0, 1, 2, 3]);
  });

  it('reports insufficient support instead of producing distances', () => {
    const a = f32([1, 2, NaN, NaN]);
    const b = f32([NaN, NaN, 1, 2]);
    const basis = similarityBasis([a, b], ['a', 'b'], { minCoverage: 0.5, minSupport: 2 });
    expect(basis.status).toBe('insufficient-support');
    expect(basis.eligible).toEqual([]);
    expect(basis.dist.length).toBe(0);
    expect(basis.excluded.every((e) => e.reason === 'insufficient-support')).toBe(true);
    expect(basis.r.every(Number.isNaN)).toBe(true);
  });

  it('is invariant to scale and offset and flips sign under inversion', () => {
    const r = rng(11);
    const a = Float32Array.from({ length: 200 }, () => r() * 4 - 2);
    const scaled = Float32Array.from(a, (x) => 2 * x + 0.5);
    const flipped = Float32Array.from(a, (x) => -x);
    const other = Float32Array.from({ length: 200 }, () => r());
    const basis = similarityBasis([a, scaled, flipped, other], ['a', 's', 'f', 'o']);
    expect(basisR(basis, 'a', 's')).toBe(1);
    expect(basisR(basis, 'a', 'f')).toBe(-1);
    expect(basisR(basis, 's', 'o')).toBeCloseTo(basisR(basis, 'a', 'o'), 6);
    expect(basis.dist[0 * 4 + 1]).toBe(0);
    expect(basis.dist[0 * 4 + 2]).toBe(2);
  });

  it('matches an independent calculation on random data with scattered NaNs', () => {
    const r = rng(42);
    const k = 7;
    const n = 500;
    const data = Array.from({ length: k }, (_, m) =>
      Float32Array.from({ length: n }, (_, v) => ((v * 7 + m * 13) % 97 === 0 ? NaN : r() * 3 - 1 + (m % 2) * Math.sin(v / 9)))
    );
    const ids = data.map((_, m) => `m${m}`);
    const basis = similarityBasis(data, ids);
    const support = [...Array(n).keys()].filter((v) => data.every((d) => Number.isFinite(d[v])));
    expect(Array.from(basis.support)).toEqual(support);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        const d = basis.dist[i * k + j];
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBe(basis.dist[j * k + i]);
        if (i === j) expect(d).toBe(0);
        else expect(d).toBeCloseTo(1 - refPearson(data[i], data[j], support), 10);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(2);
      }
    }
  });

  it('has a key that tracks data, policy and labels, not just labels', () => {
    const a = f32([1, 2, 3, 4]);
    const b = f32([4, 1, 3, 2]);
    const labels = { model: 'm', contrast: 'c', stat: 't' };
    const k1 = similarityBasis([a, b], ['a', 'b'], { labels, minSupport: 3 }).key;
    expect(similarityBasis([a.slice(), b.slice()], ['a', 'b'], { labels, minSupport: 3 }).key).toBe(k1);
    expect(k1.startsWith(BASIS_VERSION)).toBe(true);
    // Same labels, changed data.
    expect(similarityBasis([a, f32([4, 1, 3, 2.5])], ['a', 'b'], { labels, minSupport: 3 }).key).not.toBe(k1);
    // Same data, different member order or ids.
    expect(similarityBasis([b, a], ['b', 'a'], { labels, minSupport: 3 }).key).not.toBe(k1);
    // Policy and labels.
    expect(similarityBasis([a, b], ['a', 'b'], { labels, minSupport: 3, minCoverage: 0.5 }).key).not.toBe(k1);
    expect(similarityBasis([a, b], ['a', 'b'], { labels: { ...labels, stat: 'beta' }, minSupport: 3 }).key).not.toBe(k1);
    expect(similarityBasis([a, b], ['a', 'b'], { labels, minSupport: 3, maskRule: 'other mask' }).key).not.toBe(k1);
  });

  it('rejects malformed input', () => {
    expect(() => similarityBasis([f32([1, 2]), f32([1, 2, 3])], ['a', 'b'])).toThrow();
    expect(() => similarityBasis([f32([1, 2])], ['a', 'b'])).toThrow();
    expect(() => similarityBasis([f32([1, 2]), f32([2, 1])], ['a', 'a'])).toThrow();
  });

  it('works on a VolumeSet built from aligned volumes', () => {
    const space = new NeuroSpace([5, 4, 3], [2, 3, 4], [-4, -6, -4]);
    const r = rng(5);
    const vol = (f: (g: number) => number): FloatNeuroVol => new FloatNeuroVol(space, Float32Array.from({ length: 60 }, (_, g) => f(g)));
    const base = Float32Array.from({ length: 60 }, () => r() - 0.5);
    const set = VolumeSet.fromVolumes(
      [vol((g) => base[g]), vol((g) => 3 * base[g] + 1), vol((g) => -base[g]), vol(() => r() - 0.5)],
      ['s1', 's2', 's3', 's4'].map((subject) => ({ subject }))
    );
    const basis = similarityBasis(
      set.members.map((m) => m.values),
      set.members.map((m) => String(m.meta.subject))
    );
    expect(basis.maskVoxels).toBe(set.maskIndex.length);
    expect(basisR(basis, 's1', 's2')).toBe(1);
    expect(basisR(basis, 's1', 's3')).toBe(-1);
  });
});
