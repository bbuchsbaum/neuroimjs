import { describe, it, expect } from 'vitest';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import {
  VolumeSet,
  sliceGrid,
  slicePixelToGrid,
  gridToSlicePixel,
} from '../src/volumeset/VolumeSet';
import {
  setMean,
  setOneSampleT,
  setPrevalence,
  correlationMatrix,
  looSimilarity,
  looDistance,
  robustZ,
  pearson,
} from '../src/volumeset/stats';
import { seriate, pathLength, cutTree, chooseClusterCount, suggestClusters } from '../src/volumeset/seriation';
import { guidedSmooth, maskedBoxMean, smoothingEffect } from '../src/volumeset/smooth';
import { clusterExtentFilter } from '../src/volumeset/clusterExtent';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

describe('set statistics', () => {
  const a = Float32Array.from([1, 2, 3, NaN]);
  const b = Float32Array.from([3, 2, 1, 5]);
  const c = Float32Array.from([2, 2, 2, NaN]);

  it('computes the mean, skipping non-finite values', () => {
    const m = setMean([a, b, c]);
    expect(Array.from(m)).toEqual([2, 2, 2, 5]);
  });

  it('computes a one-sample t that matches the textbook formula', () => {
    const x = [Float32Array.of(1), Float32Array.of(2), Float32Array.of(4)];
    const mean = 7 / 3;
    const sd = Math.sqrt(((1 - mean) ** 2 + (2 - mean) ** 2 + (4 - mean) ** 2) / 2);
    expect(setOneSampleT(x)[0]).toBeCloseTo(mean / (sd / Math.sqrt(3)), 5);
  });

  it('computes signed prevalence', () => {
    const x = [Float32Array.of(3), Float32Array.of(-3), Float32Array.of(4), Float32Array.of(0)];
    expect(setPrevalence(x, 2)[0]).toBeCloseTo((2 - 1) / 4);
  });

  it('pearson is 1 / -1 for linear relations and NaN for constants', () => {
    expect(pearson(a, a)).toBeCloseTo(1);
    expect(pearson(Float32Array.from([1, 2, 3]), Float32Array.from([3, 2, 1]))).toBeCloseTo(-1);
    expect(Number.isNaN(pearson(c, a))).toBe(true);
  });

  it('builds a symmetric correlation matrix with unit diagonal', () => {
    const r = rng(1);
    const data = Array.from({ length: 4 }, () => Float32Array.from({ length: 50 }, () => gauss(r)));
    const M = correlationMatrix(data);
    for (let i = 0; i < 4; i++) {
      expect(M[i * 4 + i]).toBe(1);
      for (let j = 0; j < 4; j++) expect(M[i * 4 + j]).toBeCloseTo(M[j * 4 + i]);
    }
  });

  it('leave-one-out similarity flags the member that does not share the pattern', () => {
    const r = rng(7);
    const pattern = Float32Array.from({ length: 400 }, () => gauss(r));
    const data = Array.from({ length: 8 }, (_, s) =>
      Float32Array.from(pattern, (p) => (s === 5 ? gauss(r) : p + 0.5 * gauss(r)))
    );
    const sim = looSimilarity(data);
    const worst = Array.from(sim).indexOf(Math.min(...sim));
    expect(worst).toBe(5);
    const dist = looDistance(data);
    expect(Array.from(dist).indexOf(Math.max(...dist))).toBe(5);
    expect(robustZ(sim)[5]).toBeLessThan(-3);
  });

  it('leave-one-out similarity is lower than similarity to the full mean', () => {
    const r = rng(3);
    const data = Array.from({ length: 5 }, () => Float32Array.from({ length: 200 }, () => gauss(r)));
    const loo = looSimilarity(data);
    const full = setMean(data);
    for (let i = 0; i < 5; i++) expect(loo[i]).toBeLessThan(pearson(data[i], full));
  });
});

describe('seriation', () => {
  it('recovers planted clusters as contiguous runs', () => {
    const r = rng(11);
    const protos = [0, 1, 2].map(() => Float32Array.from({ length: 300 }, () => gauss(r)));
    // Interleave cluster membership so the input order is maximally mixed.
    const labels = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2];
    const data = labels.map((l) => Float32Array.from(protos[l], (p) => p + 0.4 * gauss(r)));
    const k = data.length;
    const { order } = seriate(correlationMatrix(data), k);
    expect([...order].sort((x, y) => x - y)).toEqual(labels.map((_, i) => i));
    const seq = order.map((i) => labels[i]);
    let changes = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) changes++;
    expect(changes).toBe(2);
  });

  it('chooses three clusters for three planted groups and labels them consistently', () => {
    const r = rng(12);
    const protos = [0, 1, 2].map(() => Float32Array.from({ length: 300 }, () => gauss(r)));
    const labels = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2];
    const data = labels.map((l) => Float32Array.from(protos[l], (p) => p + 0.4 * gauss(r)));
    const { tree } = seriate(correlationMatrix(data), data.length);
    const k = chooseClusterCount(tree);
    expect(k).toBe(3);
    const cl = cutTree(tree, k);
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        expect(cl[i] === cl[j]).toBe(labels[i] === labels[j]);
      }
    }
  });

  it('does not report a lone outlier as a cluster', () => {
    const r = rng(14);
    const proto = Float32Array.from({ length: 400 }, () => gauss(r));
    const data = Array.from({ length: 12 }, (_, s) => Float32Array.from(proto, (p) => (s === 4 ? gauss(r) * 2 : p + 0.8 * gauss(r))));
    const { tree } = seriate(correlationMatrix(data), data.length);
    expect(chooseClusterCount(tree)).toBe(1);
  });

  it('finds two groups when an outlier is present, and leaves the outlier unassigned', () => {
    const r = rng(15);
    const protos = [0, 1].map(() => Float32Array.from({ length: 400 }, () => gauss(r)));
    const labels = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2];
    const data = labels.map((l) => (l === 2 ? Float32Array.from({ length: 400 }, () => gauss(r)) : Float32Array.from(protos[l], (p) => p + 0.5 * gauss(r))));
    const { tree } = seriate(correlationMatrix(data), data.length);
    const sug = suggestClusters(tree);
    expect(sug.k).toBe(2);
    expect([...sug.sizes].sort()).toEqual([8, 8]);
    expect(sug.unassigned).toEqual([16]);
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) expect(sug.labels[i] === sug.labels[j]).toBe(labels[i] === labels[j]);
  });

  it('reports a single cluster for unstructured noise', () => {
    const r = rng(13);
    const data = Array.from({ length: 10 }, () => Float32Array.from({ length: 2000 }, () => gauss(r)));
    const { tree } = seriate(correlationMatrix(data), data.length);
    expect(chooseClusterCount(tree)).toBe(1);
  });

  it('optimal leaf ordering never lengthens the path relative to the input order', () => {
    const r = rng(5);
    const data = Array.from({ length: 9 }, () => Float32Array.from({ length: 80 }, () => gauss(r)));
    const k = data.length;
    const sim = correlationMatrix(data);
    const dist = Float64Array.from(sim, (s) => 1 - s);
    const { order } = seriate(sim, k);
    const identity = Array.from({ length: k }, (_, i) => i);
    expect(pathLength(order, dist, k)).toBeLessThanOrEqual(pathLength(identity, dist, k) + 1e-9);
  });
});

describe('VolumeSet', () => {
  const dim = [4, 3, 2];
  const space = new NeuroSpace(dim, [2, 2, 2], [0, 0, 0]);
  const n = 24;
  const mk = (f: (g: number) => number): FloatNeuroVol =>
    new FloatNeuroVol(space, Float32Array.from({ length: n }, (_, g) => f(g)));

  it('masks to voxels where any member is non-zero and keeps metadata', () => {
    const v1 = mk((g) => (g % 2 ? g : 0));
    const v2 = mk((g) => (g === 2 ? -1 : 0));
    const set = VolumeSet.fromVolumes([v1, v2], [{ subject: 'a' }, { subject: 'b' }]);
    expect(set.size).toBe(2);
    expect(Array.from(set.maskIndex)).toEqual([1, 2, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]);
    expect(set.valueAt(set.members[0].values, [1, 0, 0])).toBe(1);
    expect(set.valueAt(set.members[1].values, [2, 0, 0])).toBe(-1);
    expect(Number.isNaN(set.valueAt(set.members[0].values, [0, 0, 0]))).toBe(true);
    expect(set.where({ subject: 'b' })).toEqual([1]);
  });

  it('rejects members on different grids', () => {
    const other = new FloatNeuroVol(new NeuroSpace([4, 3, 3], [2, 2, 2], [0, 0, 0]), new Float32Array(36));
    expect(() => VolumeSet.fromVolumes([mk(() => 1), other], [{}, {}])).toThrow();
  });

  it('slices in neurological display orientation and round-trips pixels', () => {
    const grid = Float32Array.from({ length: n }, (_, g) => g);
    for (const o of ['axial', 'coronal', 'sagittal'] as const) {
      const idx = 1;
      const s = sliceGrid(dim, o, idx, (g) => grid[g]);
      for (let row = 0; row < s.height; row++) {
        for (let col = 0; col < s.width; col++) {
          const [i, j, k] = slicePixelToGrid(dim, o, idx, col, row);
          expect(s.data[row * s.width + col]).toBe(i + j * 4 + k * 12);
          expect(gridToSlicePixel(dim, o, [i, j, k])).toEqual([col, row]);
        }
      }
    }
    // Axial: top row is the most anterior j; coronal/sagittal: top row is the most superior k.
    expect(slicePixelToGrid(dim, 'axial', 0, 0, 0)[1]).toBe(2);
    expect(slicePixelToGrid(dim, 'coronal', 0, 0, 0)[2]).toBe(1);
    // Sagittal matches the orthoviewer (SAGITTAL_AIL): anterior (max j) on the left.
    expect(slicePixelToGrid(dim, 'sagittal', 0, 0, 0)[1]).toBe(2);
    expect(slicePixelToGrid(dim, 'sagittal', 0, 2, 0)[1]).toBe(0);
  });
});

describe('guided smoothing', () => {
  const dim = [12, 10, 8];
  const n = 12 * 10 * 8;
  // Mask: everything except a border slab at i = 0.
  const maskIndex = Int32Array.from(Array.from({ length: n }, (_, g) => g).filter((g) => g % 12 !== 0));

  it('returns a constant map unchanged (weights normalised, mask respected)', () => {
    const values = new Float32Array(maskIndex.length).fill(3);
    const guide = Float32Array.from({ length: n }, (_, g) => (g % 12 < 6 ? 100 : 300));
    const out = guidedSmooth(dim, maskIndex, values, guide, { radius: 2, epsilon: 0.01 });
    for (const v of out) expect(v).toBeCloseTo(3, 4);
  });

  it('reduces noise while keeping a step that follows a guide edge', () => {
    const r = rng(9);
    const guide = Float32Array.from({ length: n }, (_, g) => (g % 12 < 6 ? 0 : 1));
    const clean = Float32Array.from(maskIndex, (g) => (g % 12 < 6 ? 0 : 5));
    const noisy = Float32Array.from(clean, (c) => c + gauss(r));
    const out = guidedSmooth(dim, maskIndex, noisy, guide, { radius: 2, epsilon: 0.001 });
    const err = (x: Float32Array): number => Math.sqrt(x.reduce((s, v, i) => s + (v - clean[i]) ** 2, 0) / x.length);
    expect(err(out)).toBeLessThan(err(noisy) * 0.5);
    // Edge kept: voxels right next to the step stay on their own side.
    const at = (i: number): number => {
      const m = Array.from(maskIndex).indexOf(i + 5 * 12 + 4 * 120);
      return out[m];
    };
    expect(at(5)).toBeLessThan(1);
    expect(at(6)).toBeGreaterThan(4);
  });

  it('ignores NaN inputs and leaves them NaN', () => {
    const values = new Float32Array(maskIndex.length).fill(1);
    values[10] = NaN;
    const out = guidedSmooth(dim, maskIndex, values, new Float32Array(n).fill(1), { radius: 1, epsilon: 0.1 });
    expect(Number.isNaN(out[10])).toBe(true);
    expect(out[11]).toBeCloseTo(1, 4);
  });
});

describe('self-guided smoothing', () => {
  it('keeps a strong cluster near full amplitude while removing isolated noise', () => {
    const dim = [16, 16, 16];
    const n = 16 ** 3;
    const maskIndex = Int32Array.from({ length: n }, (_, g) => g);
    const r = rng(21);
    const inCluster = (g: number): boolean => {
      const i = g % 16, j = Math.floor(g / 16) % 16, k = Math.floor(g / 256);
      return Math.abs(i - 8) <= 2 && Math.abs(j - 8) <= 2 && Math.abs(k - 8) <= 2;
    };
    const values = Float32Array.from({ length: n }, (_, g) => (inCluster(g) ? 10 : 0) + gauss(r));
    const out = guidedSmooth(dim, maskIndex, values, 'self', { radius: 1, epsilon: 1 });
    const centre = 8 + 8 * 16 + 8 * 256;
    expect(out[centre]).toBeGreaterThan(9);
    // Noise far from the cluster shrinks.
    const bgIn = Array.from(maskIndex).filter((g) => !inCluster(g) && g % 16 < 3);
    const sd = (a: ArrayLike<number>, idx: number[]): number => Math.sqrt(idx.reduce((s, g) => s + a[g] ** 2, 0) / idx.length);
    expect(sd(out, bgIn)).toBeLessThan(sd(values, bgIn) * 0.8);
  });

  it('matches the full-grid reference when cropping to the mask bounding box', () => {
    const dim = [10, 9, 8];
    const n = 720;
    const r = rng(4);
    // Mask: a small interior block, so the bounding box crop is active.
    const maskIndex = Int32Array.from(Array.from({ length: n }, (_, g) => g).filter((g) => {
      const i = g % 10, j = Math.floor(g / 10) % 9, k = Math.floor(g / 90);
      return i > 2 && i < 8 && j > 1 && j < 7 && k > 1 && k < 6;
    }));
    const values = Float32Array.from(maskIndex, () => gauss(r));
    const guide = Float32Array.from({ length: n }, () => r());
    const out = guidedSmooth(dim, maskIndex, values, guide, { radius: 1, epsilon: 0.1 });
    // Reference: plain masked box mean pipeline on the full grid.
    const w = new Float32Array(n);
    const I = new Float32Array(n);
    const p = new Float32Array(n);
    const gvals = Array.from(maskIndex, (g) => guide[g]);
    const gmean = gvals.reduce((s, x) => s + x, 0) / gvals.length;
    const gsd = Math.sqrt(gvals.reduce((s, x) => s + x * x, 0) / gvals.length - gmean * gmean);
    maskIndex.forEach((g, m) => {
      w[g] = 1;
      p[g] = values[m];
      I[g] = (guide[g] - gmean) / gsd;
    });
    const mI = maskedBoxMean(dim, I, w, 1);
    const mp = maskedBoxMean(dim, p, w, 1);
    const mII = maskedBoxMean(dim, I.map((x) => x * x), w, 1);
    const mIp = maskedBoxMean(dim, I.map((x, g) => x * p[g]), w, 1);
    const A = new Float32Array(n);
    const B = new Float32Array(n);
    for (let g = 0; g < n; g++) {
      if (!w[g]) continue;
      A[g] = (mIp[g] - mI[g] * mp[g]) / (mII[g] - mI[g] * mI[g] + 0.1);
      B[g] = mp[g] - A[g] * mI[g];
    }
    const mA = maskedBoxMean(dim, A, w, 1);
    const mB = maskedBoxMean(dim, B, w, 1);
    maskIndex.forEach((g, m) => expect(out[m]).toBeCloseTo(mA[g] * I[g] + mB[g], 4));
  });
});

describe('smoothing effect and pooled guide scale', () => {
  it('matches a sort-based reference for the top-1% peak ratio and names the worst member', () => {
    const r = rng(32);
    const raw = [0, 1, 2].map(() => Float32Array.from({ length: 3000 }, () => 3 * gauss(r)));
    const sm = raw.map((x, i) => Float32Array.from(x, (v) => v * (1 - 0.2 * i)));
    const e = smoothingEffect(raw, sm, 2.3);
    // Uniform shrink by (1 - 0.2 i): peak ratios are exactly 1, .8, .6.
    expect(e.peakKept).toBeCloseTo(0.8, 5);
    expect(e.peakKeptMin).toBeCloseTo(0.6, 5);
    expect(e.peakKeptWorst).toBe(2);
    expect(e.extentKeptWorst).toBe(2);
  });

  it('measures identity smoothing as fully kept and agreeing', () => {
    const r = rng(30);
    const raw = [Float32Array.from({ length: 500 }, () => 3 * gauss(r))];
    const e = smoothingEffect(raw, raw, 2.3);
    expect(e.peakKept).toBeCloseTo(1, 6);
    expect(e.extentKept).toBeCloseTo(1, 6);
    expect(e.disagree).toBe(0);
  });

  it('smooths maps of different variance equally when given a pooled scale', () => {
    const dim = [12, 12, 12];
    const n = 1728;
    const maskIndex = Int32Array.from({ length: n }, (_, g) => g);
    const r = rng(31);
    const base = Float32Array.from({ length: n }, () => gauss(r));
    const loud = Float32Array.from(base, (x) => 3 * x);
    const pooled = { mean: 0, sd: 2 };
    const a = guidedSmooth(dim, maskIndex, base, 'self', { radius: 1, epsilon: 1, guideScale: pooled });
    const b = guidedSmooth(dim, maskIndex, loud, 'self', { radius: 1, epsilon: 1, guideScale: pooled });
    // Same filter applied to a 3x-louder copy: per-map scaling would make these differ in shape;
    // with a pooled scale the louder map is smoothed less (edge-preserving), never identically scaled.
    const shrink = (x: Float32Array, y: Float32Array): number => Math.sqrt(y.reduce((s, v) => s + v * v, 0) / x.reduce((s, v) => s + v * v, 0));
    expect(shrink(loud, b)).toBeGreaterThan(shrink(base, a));
    // Without a pooled scale both are z-scored separately, so their relative shrinkage is identical.
    const a2 = guidedSmooth(dim, maskIndex, base, 'self', { radius: 1, epsilon: 1 });
    const b2 = guidedSmooth(dim, maskIndex, loud, 'self', { radius: 1, epsilon: 1 });
    expect(shrink(loud, b2)).toBeCloseTo(shrink(base, a2), 4);
  });
});

describe('cluster-extent display filter', () => {
  const dim = [10, 10, 10];
  const n = 1000;
  const maskIndex = Int32Array.from({ length: n }, (_, g) => g);
  const gridToMask = Int32Array.from({ length: n }, (_, g) => g);
  const at = (i: number, j: number, k: number): number => i + j * 10 + k * 100;

  it('removes small clusters, keeps large ones, and separates signs', () => {
    const v = new Float32Array(n);
    // 3x3x3 positive block (27 voxels)
    for (let i = 2; i <= 4; i++) for (let j = 2; j <= 4; j++) for (let k = 2; k <= 4; k++) v[at(i, j, k)] = 5;
    // isolated positive voxel and a 2-voxel diagonal (26-connected) pair
    v[at(8, 8, 8)] = 4;
    v[at(7, 1, 1)] = 3;
    v[at(8, 2, 2)] = 3;
    // negative voxel touching the positive block: a separate cluster of size 1
    v[at(5, 3, 3)] = -6;
    const r = clusterExtentFilter(dim, maskIndex, gridToMask, v, 2.3, 3);
    expect(r.kept).toBe(1);
    expect(r.removed).toBe(3);
    expect(r.voxelsRemoved).toBe(4);
    expect(r.values[at(3, 3, 3)]).toBe(5);
    expect(r.values[at(8, 8, 8)]).toBe(0);
    expect(r.values[at(7, 1, 1)]).toBe(0);
    expect(r.values[at(5, 3, 3)]).toBe(0);
    // the input is untouched
    expect(v[at(8, 8, 8)]).toBe(4);
  });

  it('keeps a diagonal pair when minSize is 2 (26-connectivity)', () => {
    const v = new Float32Array(n);
    v[at(1, 1, 1)] = 3;
    v[at(2, 2, 2)] = 3;
    const r = clusterExtentFilter(dim, maskIndex, gridToMask, v, 2.3, 2);
    expect(r.kept).toBe(1);
    expect(r.values[at(2, 2, 2)]).toBe(3);
  });
});
