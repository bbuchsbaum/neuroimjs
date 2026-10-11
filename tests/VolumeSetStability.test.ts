import { describe, it, expect } from 'vitest';
import {
  blockPartition,
  bootstrapWeights,
  weightedCorrelationDistances,
  blockMoments,
  momentCorrelationDistances,
  ellipse68,
  runStability,
  ELLIPSE_CHI2,
  type StabilityReplicate,
} from '../src/volumeset/stability';
import { similarityBasis } from '../src/volumeset/basis';
import { nmds } from '../src/volumeset/nmds';

// ---------------------------------------------------------------------------
// Helpers (independent of the implementation)
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gauss(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** Textbook weighted Pearson r in float64. */
function refWeightedR(a: ArrayLike<number>, b: ArrayLike<number>, idx: number[], w: number[]): number {
  const W = w.reduce((s, x) => s + x, 0);
  const ma = idx.reduce((s, v, t) => s + w[t] * a[v], 0) / W;
  const mb = idx.reduce((s, v, t) => s + w[t] * b[v], 0) / W;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  idx.forEach((v, t) => {
    sab += w[t] * (a[v] - ma) * (b[v] - mb);
    saa += w[t] * (a[v] - ma) ** 2;
    sbb += w[t] * (b[v] - mb) ** 2;
  });
  return sab / Math.sqrt(saa * sbb);
}

/** Similarity Procrustes of source onto target (rotation/reflection + scale + translation), 2D. */
function procrustes(source: Float64Array, target: Float64Array): Float64Array {
  const n = source.length / 2;
  const mean = (x: Float64Array, c: number): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[2 * i + c];
    return s / n;
  };
  const [sx, sy, tx, ty] = [mean(source, 0), mean(source, 1), mean(target, 0), mean(target, 1)];
  let best: Float64Array | null = null;
  let bestErr = Infinity;
  for (const refl of [1, -1]) {
    let a = 0;
    let b = 0;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const x = source[2 * i] - sx;
      const y = refl * (source[2 * i + 1] - sy);
      const u = target[2 * i] - tx;
      const v = target[2 * i + 1] - ty;
      a += x * u + y * v;
      b += x * v - y * u;
      ss += x * x + y * y;
    }
    const th = Math.atan2(b, a);
    const s = Math.hypot(a, b) / ss;
    const out = new Float64Array(2 * n);
    let err = 0;
    for (let i = 0; i < n; i++) {
      const x = source[2 * i] - sx;
      const y = refl * (source[2 * i + 1] - sy);
      out[2 * i] = tx + s * (Math.cos(th) * x - Math.sin(th) * y);
      out[2 * i + 1] = ty + s * (Math.sin(th) * x + Math.cos(th) * y);
      err += (out[2 * i] - target[2 * i]) ** 2 + (out[2 * i + 1] - target[2 * i + 1]) ** 2;
    }
    if (err < bestErr) {
      bestErr = err;
      best = out;
    }
  }
  return best!;
}

const fullMask = (n: number): Int32Array => Int32Array.from({ length: n }, (_, i) => i);

// ---------------------------------------------------------------------------

describe('blockPartition', () => {
  it('matches hand counts on an anisotropic grid', () => {
    // 6 mm blocks at 2 x 3 x 6 mm voxels -> 3 x 2 x 1 voxels per block.
    const dim = [10, 7, 5];
    const V = 350;
    const p = blockPartition(dim, [2, 3, 6], fullMask(V), fullMask(V), 6);
    expect(p.blockSize).toEqual([3, 2, 1]);
    expect(p.blockMmActual).toEqual([6, 6, 6]);
    // i: 3,3,3,1 ; j: 2,2,2,1 ; k: 5 slabs of 1 -> 4 * 4 * 5 = 80 blocks.
    expect(p.nBlocks).toBe(80);
    const sizes = Array.from(p.voxelsPerBlock).sort((a, b) => a - b);
    const expected = [3, 3, 3, 1]
      .flatMap((a) => [2, 2, 2, 1].map((b) => a * b))
      .flatMap((s) => new Array<number>(5).fill(s))
      .sort((a, b) => a - b);
    expect(sizes).toEqual(expected);
    expect(sizes.reduce((s, x) => s + x, 0)).toBe(V);
    // Voxel (i,j,k) = (4,3,2): block (1,1,2) -> id 1 + 4*(1 + 4*2) = 37 (all cells used).
    expect(p.blockOf[4 + 3 * 10 + 2 * 70]).toBe(37);
    expect(p.blockOf[0]).toBe(0);
    expect(p.blockOf[V - 1]).toBe(79);
  });

  it('rounds the block edge to the nearest voxel count per axis and counts only occupied blocks', () => {
    const p = blockPartition([20, 20, 20], [2.5, 3.5, 13], fullMask(1), [0], 12);
    expect(p.blockSize).toEqual([5, 3, 1]); // round(4.8), round(3.43), max(1, round(0.92))
    expect(p.blockMmActual).toEqual([12.5, 10.5, 13]);
    // Sparse mask: positions point to grid voxels; support is a subset of positions.
    const maskIndex = Int32Array.from([0, 1, 5, 25, 400, 7999]);
    const q = blockPartition([20, 20, 20], [2.5, 3.5, 13], maskIndex, [5, 0, 2, 1, 3], 12);
    // Grid 0, 1 -> cell (0,0,0); grid 5 = (5,0,0) and 25 = (5,1,0) -> cell (1,0,0); 7999 = (19,19,19) -> (3,6,19).
    expect(q.nBlocks).toBe(3);
    expect(Array.from(q.blockOf)).toEqual([2, 0, 1, 0, 1]);
    expect(Array.from(q.voxelsPerBlock)).toEqual([2, 2, 1]);
  });

  it('rejects bad input', () => {
    expect(() => blockPartition([4, 4, 4], [2, 2, 2], fullMask(64), [0], 0)).toThrow();
    expect(() => blockPartition([4, 4, 4], [2, 0, 2], fullMask(64), [0], 6)).toThrow();
    expect(() => blockPartition([4, 4, 4], [2, 2, 2], fullMask(64), [64], 6)).toThrow();
  });
});

describe('bootstrapWeights', () => {
  it('sums to nBlocks per replicate, is reproducible by seed and differs across seeds', () => {
    const w = bootstrapWeights(57, 30, 9);
    expect(w).toHaveLength(30);
    for (const r of w) expect(r.reduce((s, x) => s + x, 0)).toBe(57);
    expect(bootstrapWeights(57, 30, 9).map((r) => Array.from(r))).toEqual(w.map((r) => Array.from(r)));
    expect(Array.from(bootstrapWeights(57, 1, 10)[0])).not.toEqual(Array.from(w[0]));
    // Replicate r depends only on seed + r.
    expect(Array.from(bootstrapWeights(57, 1, 10)[0])).toEqual(Array.from(w[1]));
    // Replicates differ and leave out roughly 1/e of the blocks.
    expect(Array.from(w[0])).not.toEqual(Array.from(w[1]));
    const zeros = w.reduce((s, r) => s + r.filter((x) => x === 0).length, 0) / (30 * 57);
    expect(zeros).toBeGreaterThan(0.3);
    expect(zeros).toBeLessThan(0.44);
  });

  it('rejects bad input', () => {
    expect(() => bootstrapWeights(0, 1, 1)).toThrow();
    expect(() => bootstrapWeights(70000, 1, 1)).toThrow();
    expect(() => bootstrapWeights(5, -1, 1)).toThrow();
    expect(() => bootstrapWeights(5, 1, 0.5)).toThrow();
  });
});

describe('weighted correlation distances', () => {
  const rnd = lcg(5);
  const V = 300;
  const k = 5;
  const data = Array.from({ length: k }, (_, m) =>
    Float32Array.from({ length: V }, (_, v) => (v % 37 === m ? NaN : 100 + gauss(rnd) + (m % 2) * Math.sin(v / 7)))
  );
  const ids = data.map((_, m) => `m${m}`);
  const basis = similarityBasis(data, ids, { minSupport: 10 });
  const support = basis.support;
  const members = basis.eligible;
  const m = members.length;
  const blockOf = Int32Array.from(support, (_, t) => Math.floor(t / 7));
  const nBlocks = blockOf[blockOf.length - 1] + 1;

  it('with all-ones weights equals the basis r exactly and a textbook formula', () => {
    const ones = new Uint16Array(nBlocks).fill(1);
    const d = weightedCorrelationDistances(data, members, support, blockOf, ones)!;
    expect(Array.from(d)).toEqual(Array.from(basis.dist));
    const all = Array.from(support);
    for (let p = 0; p < m; p++)
      for (let q = 0; q < m; q++) {
        if (p === q) expect(d[p * m + q]).toBe(0);
        else expect(d[p * m + q]).toBeCloseTo(1 - refWeightedR(data[members[p]], data[members[q]], all, all.map(() => 1)), 12);
      }
    const bm = blockMoments(data, members, support, blockOf, nBlocks);
    const dm = momentCorrelationDistances(bm, ones)!;
    for (let e = 0; e < m * m; e++) expect(dm[e]).toBeCloseTo(d[e], 10);
  });

  it('treats integer weights as duplicated voxels and matches a textbook weighted r', () => {
    const w = bootstrapWeights(nBlocks, 3, 4)[2];
    const d = weightedCorrelationDistances(data, members, support, blockOf, w)!;
    // Physically duplicate each voxel w times; evaluate unweighted.
    const dupIdx: number[] = [];
    support.forEach((v, t) => {
      for (let c = 0; c < w[blockOf[t]]; c++) dupIdx.push(v);
    });
    const dup = data.map((x) => Float32Array.from(dupIdx, (v) => x[v]));
    const dupSupport = fullMask(dupIdx.length);
    const dd = weightedCorrelationDistances(dup, members, dupSupport, fullMask(dupIdx.length), new Uint16Array(dupIdx.length).fill(1))!;
    for (let e = 0; e < m * m; e++) expect(d[e]).toBeCloseTo(dd[e], 12);
    const idx = Array.from(support);
    const ww = idx.map((_, t) => w[blockOf[t]]);
    expect(d[1]).toBeCloseTo(1 - refWeightedR(data[members[0]], data[members[1]], idx, ww), 12);
    const dm = momentCorrelationDistances(blockMoments(data, members, support, blockOf, nBlocks), w)!;
    for (let e = 0; e < m * m; e++) expect(dm[e]).toBeCloseTo(d[e], 10);
    // Symmetric, zero diagonal, in [0, 2].
    for (let p = 0; p < m; p++)
      for (let q = 0; q < m; q++) {
        expect(d[p * m + q]).toBe(d[q * m + p]);
        expect(d[p * m + q]).toBeGreaterThanOrEqual(0);
        expect(d[p * m + q]).toBeLessThanOrEqual(2);
      }
  });

  it('flags a replicate invalid when a member is constant under its weights', () => {
    // Member 2 varies only inside block 0; give block 0 zero weight.
    const x = data.map((d) => Float32Array.from(d));
    support.forEach((v, t) => {
      x[members[2]][v] = blockOf[t] === 0 ? t : 1000;
    });
    const w = new Uint16Array(nBlocks).fill(1);
    expect(weightedCorrelationDistances(x, members, support, blockOf, w)).not.toBeNull();
    w[0] = 0;
    w[1] = 2;
    expect(weightedCorrelationDistances(x, members, support, blockOf, w)).toBeNull();
    const bm = blockMoments(x, members, support, blockOf, nBlocks);
    expect(momentCorrelationDistances(bm, w)).toBeNull();
    // Only one voxel with weight: everyone is constant.
    const one = new Uint16Array(nBlocks);
    one[3] = nBlocks;
    const blockOf1 = Int32Array.from(support, (_, t) => (t === 0 ? 3 : t % 3 === 0 ? 4 : 5));
    expect(weightedCorrelationDistances(data, members, support, blockOf1, one.subarray(0, 6))).toBeNull();
  });
});

describe('ellipse68', () => {
  it('covers ~68% of a large bivariate normal sample and recovers axes and angle', () => {
    const rnd = lcg(31);
    const N = 20000;
    const th = Math.PI / 6;
    const pts = new Float64Array(2 * N);
    for (let i = 0; i < N; i++) {
      const a = 3 * gauss(rnd);
      const b = 1 * gauss(rnd);
      pts[2 * i] = 2 + Math.cos(th) * a - Math.sin(th) * b;
      pts[2 * i + 1] = -1 + Math.sin(th) * a + Math.cos(th) * b;
    }
    const e = ellipse68(pts)!;
    expect(e.cx).toBeCloseTo(2, 1);
    expect(e.cy).toBeCloseTo(-1, 1);
    expect(e.rx / e.ry).toBeGreaterThan(2.85);
    expect(e.rx / e.ry).toBeLessThan(3.15);
    expect(Math.abs(e.angle - th)).toBeLessThan(0.02);
    expect(e.rx).toBeCloseTo(3 * Math.sqrt(ELLIPSE_CHI2), 1);
    let inside = 0;
    for (let i = 0; i < N; i++) {
      const dx = pts[2 * i] - e.cx;
      const dy = pts[2 * i + 1] - e.cy;
      const u = Math.cos(e.angle) * dx + Math.sin(e.angle) * dy;
      const v = -Math.sin(e.angle) * dx + Math.cos(e.angle) * dy;
      if ((u / e.rx) ** 2 + (v / e.ry) ** 2 <= 1) inside++;
    }
    expect(inside / N).toBeGreaterThan(0.67);
    expect(inside / N).toBeLessThan(0.69);
  });

  it('is null for fewer than three points or non-finite input', () => {
    expect(ellipse68([0, 0, 1, 1])).toBeNull();
    expect(ellipse68([])).toBeNull();
    expect(ellipse68([0, 0, 1, NaN, 2, 2])).toBeNull();
    const deg = ellipse68([0, 0, 1, 1, 2, 2])!;
    expect(deg.ry).toBeCloseTo(0, 12);
    expect(deg.angle).toBeCloseTo(Math.PI / 4, 12);
  });
});

describe('runStability', () => {
  const dim = [8, 8, 8];
  const spacing = [2, 2, 2];
  const V = 512;
  const rnd = lcg(12);
  const data = Array.from({ length: 6 }, () => Float32Array.from({ length: V }, () => gauss(rnd)));
  const support = fullMask(V);
  const members = [0, 1, 2, 3, 4, 5];
  const reference = Float64Array.from({ length: 12 }, (_, k) => Math.cos(k * 1.7));
  // Deterministic fake fit: the warm start nudged by each member's mean dissimilarity.
  const fakeFit = (dist: Float64Array, init: Float64Array): Float64Array => {
    const n = init.length / 2;
    const out = Float64Array.from(init);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += dist[i * n + j];
      out[2 * i] += 0.5 * s;
      out[2 * i + 1] -= 0.25 * s * s;
    }
    return out;
  };
  const identity = (s: Float64Array): Float64Array => s;
  const base = { data, members, support, dim, spacingMm: spacing, maskIndex: fullMask(V), reference, fit: fakeFit, align: identity, blockMm: 4 };

  it('produces per-member clouds and ellipses of the right shape, progressively', async () => {
    const seen: StabilityReplicate[] = [];
    const res = await runStability({ ...base, replicates: 10, onReplicate: (r) => seen.push(r) });
    expect(res.nBlocks).toBe(64);
    expect(res.blockSize).toEqual([2, 2, 2]);
    expect(res.method).toBe('block-moments');
    expect(seen.map((r) => r.index)).toEqual([...Array(10).keys()]);
    expect(seen.map((r) => r.done)).toEqual([...Array(10).keys()].map((i) => i + 1));
    expect(res.invalid).toEqual([]);
    expect(res.clouds).toHaveLength(6);
    for (const c of res.clouds) expect(c.length).toBe(20);
    expect(res.ellipses.every((e) => e !== null && Number.isFinite(e.rx))).toBe(true);
    expect(Array.from(res.clouds[3].subarray(0, 2))).toEqual(Array.from(seen[0].coords!.subarray(6, 8)));
    expect(res.spread.every((s) => s > 0)).toBe(true);
    expect(res.definition).toMatch(/resampled/);
  });

  it('is deterministic and agrees between the block-moment and two-pass paths', async () => {
    const a = await runStability({ ...base, replicates: 6, seed: 3 });
    const b = await runStability({ ...base, replicates: 6, seed: 3 });
    expect(b.clouds.map((c) => Array.from(c))).toEqual(a.clouds.map((c) => Array.from(c)));
    const slow = await runStability({ ...base, replicates: 6, seed: 3, maxMomentBytes: 0 });
    expect(slow.method).toBe('two-pass');
    for (let p = 0; p < 6; p++) for (let e = 0; e < 12; e++) expect(slow.clouds[p][e]).toBeCloseTo(a.clouds[p][e], 9);
    const c = await runStability({ ...base, replicates: 6, seed: 4 });
    expect(Array.from(c.clouds[0])).not.toEqual(Array.from(a.clouds[0]));
  });

  it('honours an AbortSignal before and during the run', async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(runStability({ ...base, signal: pre.signal })).rejects.toThrow();
    const ctl = new AbortController();
    let calls = 0;
    const run = runStability({
      ...base,
      replicates: 24,
      signal: ctl.signal,
      onReplicate: () => {
        calls++;
        if (calls === 3) ctl.abort();
      },
    });
    await expect(run).rejects.toThrow();
    expect(calls).toBe(3);
    // Abort while a (slow, async) fit is pending.
    const ctl2 = new AbortController();
    let fits = 0;
    const slowFit = async (d: Float64Array, init: Float64Array): Promise<Float64Array> => {
      fits++;
      ctl2.abort();
      return fakeFit(d, init);
    };
    await expect(runStability({ ...base, fit: slowFit, signal: ctl2.signal })).rejects.toThrow(/abort/i);
    expect(fits).toBe(1);
  });

  it('records invalid replicates instead of NaN positions', async () => {
    // Member 5 varies in a single voxel only: replicates that miss its block are invalid.
    const x = data.map((d) => Float32Array.from(d));
    x[5].fill(1);
    x[5][0] = 2;
    const res = await runStability({ ...base, data: x, replicates: 12 });
    expect(res.invalid.length).toBeGreaterThan(0);
    expect(res.invalid.length).toBeLessThan(12);
    const valid = 12 - res.invalid.length;
    for (const c of res.clouds) {
      expect(c.length).toBe(2 * valid);
      expect(c.every(Number.isFinite)).toBe(true);
    }
  });

  it('rejects a reference of the wrong length', async () => {
    await expect(runStability({ ...base, reference: [0, 0] })).rejects.toThrow(/reference/);
  });

  it('gives tighter clouds to a strong planted pattern than to a noise-only member', async () => {
    // 12^3 grid at 2 mm; fields smooth at the 6 mm block scale, so blocks matter.
    const n = 12;
    const Vg = n * n * n;
    const r = lcg(2024);
    const smooth = (): Float32Array => {
      const coarse = Float64Array.from({ length: 64 }, () => gauss(r));
      return Float32Array.from({ length: Vg }, (_, g) => {
        const i = g % n;
        const j = Math.floor(g / n) % n;
        const k = Math.floor(g / (n * n));
        return coarse[Math.floor(i / 3) + 4 * (Math.floor(j / 3) + 4 * Math.floor(k / 3))] + 0.3 * gauss(r);
      });
    };
    const patA = smooth();
    const patB = smooth();
    const maps: Float32Array[] = [];
    for (let s = 0; s < 6; s++) maps.push(Float32Array.from(patA, (x) => x + 0.6 * gauss(r)));
    for (let s = 0; s < 6; s++) maps.push(Float32Array.from(patB, (x) => x + 0.6 * gauss(r)));
    maps.push(smooth()); // noise-only member
    const ids = maps.map((_, i) => `s${i}`);
    const basis = similarityBasis(maps, ids);
    expect(basis.status).toBe('ok');
    const ref = nmds(basis.dist, ids).coords;
    const res = await runStability({
      data: maps,
      members: basis.eligible,
      support: basis.support,
      dim: [n, n, n],
      spacingMm: [2, 2, 2],
      maskIndex: fullMask(Vg),
      reference: ref,
      fit: (d, init) => nmds(d, ids, { init, restarts: 0 }).coords,
      align: procrustes,
      blockMm: 6,
      replicates: 24,
      seed: 1,
    });
    expect(res.invalid).toEqual([]);
    const strong = Array.from(res.spread.subarray(0, 12));
    const meanStrong = strong.reduce((s, x) => s + x, 0) / strong.length;
    expect(res.spread[12]).toBeGreaterThan(1.3 * meanStrong); // observed: 0.142 vs mean 0.087
    const area = (e: { rx: number; ry: number } | null): number => (e ? e.rx * e.ry : NaN);
    const meanArea = res.ellipses.slice(0, 12).reduce((s, e) => s + area(e), 0) / 12;
    expect(area(res.ellipses[12])).toBeGreaterThan(meanArea);
  });
});
