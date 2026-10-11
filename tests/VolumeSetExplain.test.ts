import { describe, it, expect } from 'vitest';
import { similarityBasis } from '../src/volumeset/basis';
import {
  standardize,
  dispersionTerms,
  focusedTerms,
  groupTerms,
  reliability,
  noiseFloorTerms,
  correctedR,
  noiseDissimilarity,
  parcelSums,
  concentration,
  randomSplitReference,
  parcelMoments,
  fullDistances,
  parcelInfluence,
  reducedDistances,
  heterogeneity,
  envfitVector,
  envfitFactor,
} from '../src/volumeset/explain';

// ---------------------------------------------------------------------------
// Independent references and generators (no code shared with explain.ts)
// ---------------------------------------------------------------------------

/** Textbook Pearson in float64 over an explicit list of positions. */
function refPearson(a: ArrayLike<number>, b: ArrayLike<number>, idx: ArrayLike<number>): number {
  const n = idx.length;
  let ma = 0;
  let mb = 0;
  for (let t = 0; t < n; t++) {
    ma += a[idx[t]];
    mb += b[idx[t]];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let t = 0; t < n; t++) {
    const x = a[idx[t]] - ma;
    const y = b[idx[t]] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb);
}

/** LCG uniform + Box–Muller normal. */
function gen(seed: number): { u: () => number; n: () => number } {
  let s = seed >>> 0;
  const u = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  const n = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

const sum = (xs: ArrayLike<number>): number => {
  let s = 0;
  for (let t = 0; t < xs.length; t++) s += xs[t];
  return s;
};
const relClose = (a: number, b: number, tol = 1e-9): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
};

/** k random maps of length V with distinct means/scales and some shared structure. */
function randomMaps(k: number, V: number, seed: number): Float32Array[] {
  const g = gen(seed);
  const common = Array.from({ length: V }, () => g.n());
  return Array.from({ length: k }, (_, i) => {
    const w = g.u();
    return Float32Array.from({ length: V }, (_, v) => 10 * i - 3 + (1 + i) * (w * common[v] + g.n()));
  });
}

const range = (n: number): number[] => [...Array(n).keys()];

// ---------------------------------------------------------------------------
// Exact decompositions
// ---------------------------------------------------------------------------

describe('exact decompositions', () => {
  const k = 7;
  const V = 900;
  const data = randomMaps(k, V, 11);
  const support = Int32Array.from(range(V).filter((v) => v % 9 !== 4)); // a proper subset
  const members = range(k);
  const z = standardize(data, members, support);
  const r = (i: number, j: number): number => refPearson(data[i], data[j], support);

  it('standardize gives mean 0 and Σz² = N', () => {
    for (const zi of z) {
      expect(zi.length).toBe(support.length);
      expect(Math.abs(sum(zi))).toBeLessThan(1e-9);
      relClose(sum(zi.map((x) => x * x)), support.length, 1e-12);
    }
  });

  it('Σ D = Σ_{i<j} (1 − r_ij)', () => {
    const D = dispersionTerms(z);
    let ref = 0;
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) ref += 1 - r(i, j);
    relClose(sum(D), ref);
    // pairwise form at one voxel
    const v = 17;
    let pw = 0;
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pw += (z[i][v] - z[j][v]) ** 2;
    relClose(D[v], pw / (2 * support.length), 1e-12);
  });

  it('focused: Σ (own + baseline) = mean_{j≠i} (1 − r_ij) for every i', () => {
    for (let i = 0; i < k; i++) {
      const f = focusedTerms(z, i);
      let ref = 0;
      for (let j = 0; j < k; j++) if (j !== i) ref += 1 - r(i, j);
      relClose(sum(f.own) + sum(f.baseline), ref / (k - 1));
      for (const x of f.baseline) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it('focused with k = 2: baseline 0, Σ own = d_12', () => {
    const f = focusedTerms(z.slice(0, 2), 0);
    expect(sum(f.baseline)).toBe(0);
    relClose(sum(f.own), 1 - r(0, 1));
  });

  it('groups: Σ between = mean_{A×B} d; Σ within = mean over pairs inside each group', () => {
    const A = [0, 2, 5];
    const B = [1, 6];
    const gt = groupTerms(z, A, B);
    let ref = 0;
    for (const a of A) for (const b of B) ref += 1 - r(a, b);
    relClose(sum(gt.between), ref / (A.length * B.length));
    let wa = 0;
    for (let p = 0; p < A.length; p++) for (let q = p + 1; q < A.length; q++) wa += 1 - r(A[p], A[q]);
    relClose(sum(gt.withinA!), wa / 3);
    relClose(sum(gt.withinB!), 1 - r(1, 6));
    const v = 3;
    const mA = A.reduce((s, i) => s + z[i][v], 0) / A.length;
    const mB = B.reduce((s, i) => s + z[i][v], 0) / B.length;
    relClose(gt.signed[v], mA - mB, 1e-12);
    expect(groupTerms(z, [0], [1]).withinA).toBeNull();
  });

  it('rejects bad input', () => {
    const c = Float32Array.from({ length: V }, () => 2.5);
    expect(() => standardize([...data, c], [k], support)).toThrow(/constant/);
    const bad = Float32Array.from(data[0]);
    bad[support[3]] = NaN;
    expect(() => standardize([bad], [0], support)).toThrow(/not finite/);
    expect(() => groupTerms(z, [0, 1], [1, 2])).toThrow(/disjoint/);
    expect(() => groupTerms(z, [], [1])).toThrow(/non-empty/);
    expect(() => focusedTerms(z, k)).toThrow();
  });

  it('standardize + dispersion reproduce similarityBasis dist on its support', () => {
    const d2 = randomMaps(6, 1200, 5);
    for (let v = 0; v < 1200; v += 37) d2[v % 6][v] = NaN; // shrink the common support
    const ids = range(6).map((i) => `m${i}`);
    const basis = similarityBasis(d2, ids);
    expect(basis.status).toBe('ok');
    const m = basis.eligible.length;
    const zz = standardize(d2, basis.eligible, basis.support);
    const N = basis.support.length;
    let tot = 0;
    for (let p = 0; p < m; p++) {
      for (let q = p + 1; q < m; q++) {
        let s = 0;
        for (let v = 0; v < N; v++) s += (zz[p][v] - zz[q][v]) ** 2;
        relClose(s / (2 * N), basis.dist[p * m + q], 1e-10);
        tot += basis.dist[p * m + q];
      }
    }
    relClose(sum(dispersionTerms(zz)), tot);
  });
});

// ---------------------------------------------------------------------------
// Reliability and noise floor
// ---------------------------------------------------------------------------

describe('reliability and noise floor', () => {
  it('ρ ≈ var(signal)/(var(signal) + mean SE²) on simulated β = signal + noise', () => {
    const g = gen(3);
    const N = 40000;
    const signal = Array.from({ length: N }, () => 2 * g.n());
    const se = Float32Array.from({ length: N }, () => 0.5 + g.u());
    const beta = Float32Array.from({ length: N }, (_, v) => 5 + signal[v] + se[v] * g.n());
    const support = Int32Array.from(range(N));
    const rel = reliability(beta, se, support);
    const ms = sum(signal) / N;
    const vs = signal.reduce((s, x) => s + (x - ms) ** 2, 0) / N;
    const mse = sum(Array.from(se, (x) => x * x)) / N;
    expect(Math.abs(rel.rho - vs / (vs + mse))).toBeLessThan(0.01);
    expect(rel.n).toBe(N);
    relClose(rel.signalVar, rel.totalVar - rel.noiseVar, 1e-12);
    // invalid SE positions are skipped in both terms
    const se2 = Float32Array.from(se);
    se2[0] = 0;
    se2[1] = NaN;
    se2[2] = -1;
    expect(reliability(beta, se2, support).n).toBe(N - 3);
  });

  it('Σ_v F = ((k − 1)/2)·Σ(1 − ρ_i) exactly (including imputed invalid SE)', () => {
    const k = 5;
    const V = 2000;
    const g = gen(8);
    const beta = randomMaps(k, V, 9);
    const se = Array.from({ length: k }, (_, i) => Float32Array.from({ length: V }, () => (0.3 + g.u()) * (1 + i)));
    se[2][12] = NaN;
    se[3][11] = 0;
    const support = Int32Array.from(range(V).filter((v) => v % 5));
    // reliability skips position 12 for member 2 and 11 for member 3; keep β/σ consistent by
    // using betaSd from reliability on the same support.
    const rels = beta.map((b, i) => reliability(b, se[i], support));
    // identity in the documented form: σ_i = betaSd, noiseVar = mean of valid SE²
    const F = noiseFloorTerms(se, rels.map((x) => x.betaSd), support);
    const ref = ((k - 1) / 2) * rels.reduce((s, x) => s + x.noiseVar / x.totalVar, 0);
    relClose(sum(F), ref);
    // Members without skipped positions: 1 − ρ equals noiseVar/totalVar exactly
    const clean = [0, 1, 4];
    for (const i of clean) relClose(1 - rels[i].rho, rels[i].noiseVar / rels[i].totalVar, 1e-12);
  });

  it('noise floor identity in terms of ρ when no position is skipped', () => {
    const k = 4;
    const V = 1500;
    const g = gen(21);
    const beta = randomMaps(k, V, 22);
    const se = Array.from({ length: k }, () => Float32Array.from({ length: V }, () => 0.2 + 3 * g.u()));
    const support = Int32Array.from(range(V));
    const rels = beta.map((b, i) => reliability(b, se[i], support));
    const F = noiseFloorTerms(se, rels.map((x) => x.betaSd), support);
    const rho = rels.map((x) => x.rho);
    relClose(sum(F), ((k - 1) / 2) * rho.reduce((s, x) => s + (1 - x), 0));
    let pairs = 0;
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs += (1 - rho[i] + (1 - rho[j])) / 2;
    relClose(sum(F), pairs);
  });

  /** k maps β_i = a_i·t + SE_i·ε with one shared true pattern t. */
  function shared(k: number, N: number, amp: number[], seed: number) {
    const g = gen(seed);
    const t = Array.from({ length: N }, () => g.n());
    const se = amp.map(() => Float32Array.from({ length: N }, () => 0.5 + g.u()));
    const beta = amp.map((a, i) => Float32Array.from({ length: N }, (_, v) => 3 * i + a * t[v] + se[i][v] * g.n()));
    const support = Int32Array.from(range(N));
    const rels = beta.map((b, i) => reliability(b, se[i], support));
    return { beta, se, support, rels };
  }

  it('shared pattern + independent noise: observed 1 − r ≈ 1 − √(ρ_iρ_j); F ≈ D when ρ are equal', () => {
    const N = 40000;
    const unequal = shared(5, N, [0.5, 1, 1.5, 2.5, 4], 31);
    const rho = unequal.rels.map((x) => x.rho);
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        const d = 1 - refPearson(unequal.beta[i], unequal.beta[j], unequal.support);
        expect(Math.abs(d - noiseDissimilarity(rho[i], rho[j]))).toBeLessThan(0.02);
      }
    }
    // F is the noise part; observed Σd exceeds it by the (√ρ_i − √ρ_j)² scale term
    const F = noiseFloorTerms(unequal.se, unequal.rels.map((x) => x.betaSd), unequal.support);
    let floorPairs = 0;
    let ceil = 0;
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        floorPairs += (1 - rho[i] + (1 - rho[j])) / 2;
        ceil += noiseDissimilarity(rho[i], rho[j]);
      }
    }
    relClose(sum(F), floorPairs);
    const D = dispersionTerms(standardize(unequal.beta, range(5), unequal.support));
    expect(Math.abs(sum(D) - ceil) / ceil).toBeLessThan(0.03);
    expect(sum(D)).toBeGreaterThan(sum(F));

    const equal = shared(6, N, [1.2, 1.2, 1.2, 1.2, 1.2, 1.2], 32);
    const F2 = noiseFloorTerms(equal.se, equal.rels.map((x) => x.betaSd), equal.support);
    const D2 = dispersionTerms(standardize(equal.beta, range(6), equal.support));
    expect(Math.abs(sum(D2) - sum(F2)) / sum(F2)).toBeLessThan(0.03);
  });

  it('correctedR and noiseDissimilarity rules', () => {
    relClose(correctedR(0.4, 0.64, 0.25), 0.4 / 0.4, 1e-15);
    expect(correctedR(0.9, 0.5, 0.5)).toBe(1);
    expect(correctedR(-0.9, 0.5, 0.5)).toBe(-1);
    relClose(correctedR(0.2, 0.5, 0.8), 0.2 / Math.sqrt(0.4), 1e-15);
    expect(correctedR(0.2, 0.05, 0.9)).toBeNaN();
    expect(correctedR(0.2, 0.9, -0.1)).toBeNaN();
    expect(correctedR(0.2, 0.3, 0.3, 0.5)).toBeNaN();
    expect(correctedR(0.2, NaN, 0.9)).toBeNaN();
    expect(correctedR(NaN, 0.9, 0.9)).toBeNaN();
    relClose(noiseDissimilarity(0.81, 0.64), 1 - 0.72, 1e-15);
    expect(noiseDissimilarity(-0.5, 0.9)).toBe(1);
    expect(noiseDissimilarity(1.5, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Parcels
// ---------------------------------------------------------------------------

describe('parcels', () => {
  it('parcelSums and concentration on a hand table', () => {
    const terms = Float64Array.from([1, 2, 3, 4, 5, 6, 0.5, 0.5]);
    const labels = Int32Array.from([1, 1, 2, 2, 3, 3, 0, 0]);
    const ps = parcelSums(terms, labels);
    expect(ps.parcels.get(1)).toEqual({ sum: 3, n: 2 });
    expect(ps.parcels.get(2)).toEqual({ sum: 7, n: 2 });
    expect(ps.parcels.get(3)).toEqual({ sum: 11, n: 2 });
    expect(ps.outside).toEqual({ sum: 1, n: 2 });
    expect(ps.total).toEqual({ sum: 22, n: 8 });
    const c = concentration(ps, 2);
    expect(c.top).toEqual([3, 2]);
    expect(c.topShare).toBeCloseTo(18 / 22, 15);
    expect(c.sizeShare).toBeCloseTo(4 / 8, 15);
    expect(concentration(ps, 10).topShare).toBeCloseTo(21 / 22, 15);
  });

  it('random-split reference is deterministic by seed', () => {
    const k = 8;
    const V = 600;
    const data = randomMaps(k, V, 41);
    const z = standardize(data, range(k), Int32Array.from(range(V)));
    const labels = Int32Array.from(range(V), (v) => (v % 13 === 0 ? 0 : 1 + (v % 12)));
    const a = randomSplitReference(z, 3, 3, labels, 25, 7, 3);
    const b = randomSplitReference(z, 3, 3, labels, 25, 7, 3);
    const c = randomSplitReference(z, 3, 3, labels, 25, 8, 3);
    expect(Array.from(a.shares)).toEqual(Array.from(b.shares));
    expect(a.median).toBe(b.median);
    expect(Array.from(a.shares)).not.toEqual(Array.from(c.shares));
    expect(a.median).toBeGreaterThan(0);
    expect(a.median).toBeLessThan(1);
    expect(() => randomSplitReference(z, 5, 4, labels, 2, 1, 3)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Leave-one-parcel-out influence
// ---------------------------------------------------------------------------

describe('parcel influence', () => {
  const k = 6;
  const V = 3300;
  const g = gen(77);
  const data = randomMaps(k, V, 78);
  // 10 parcels of ~300 voxels plus an outside band; parcel 7 carries a planted group difference.
  const labelOf = (v: number): number => (v < 300 ? 0 : 1 + Math.floor((v - 300) / 300));
  const plant = Array.from({ length: V }, () => g.n());
  for (let v = 0; v < V; v++) {
    if (labelOf(v) !== 7) continue;
    for (let i = 0; i < k; i++) data[i][v] += (i < 3 ? 1 : -1) * 12 * (1 + i) * plant[v];
  }
  const support = Int32Array.from(range(V).filter((v) => v % 11 !== 3));
  const labels = Int32Array.from(support, labelOf);
  const members = [0, 1, 2, 3, 4, 5];

  it('full distances from the moments equal textbook Pearson', () => {
    const m = parcelMoments(data, members, support, labels);
    const full = fullDistances(m);
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) relClose(full[i * k + j], 1 - refPearson(data[i], data[j], support), 1e-10);
  });

  it('leave-out r equals a direct recompute on S \\ P for every parcel and pair', () => {
    for (let id = 1; id <= 10; id++) {
      const reduced = reducedDistances(data, members, support, labels, id);
      const keep = Array.from(support).filter((_, t) => labels[t] !== id);
      for (let i = 0; i < k; i++) {
        for (let j = i + 1; j < k; j++) {
          relClose(reduced[i * k + j], 1 - refPearson(data[i], data[j], keep), 1e-10);
          expect(reduced[j * k + i]).toBe(reduced[i * k + j]);
        }
      }
    }
  });

  it('the parcel with the planted group difference is the most influential', () => {
    const inf = parcelInfluence(data, members, support, labels);
    expect(inf).toHaveLength(10);
    expect(inf[0].id).toBe(7);
    expect(inf[0].mantel).toBeLessThan(inf[1].mantel);
    for (let t = 1; t < inf.length; t++) expect(inf[t].mantel).toBeGreaterThanOrEqual(inf[t - 1].mantel);
    expect(inf.find((x) => x.id === 3)!.n).toBe(labels.filter((l) => l === 3).length);
  });

  it('throws a clear error above the memory budget', () => {
    expect(() => parcelInfluence(data, members, support, labels, { maxBytes: 1000 })).toThrow(/budget/);
  });
});

// ---------------------------------------------------------------------------
// Heterogeneity
// ---------------------------------------------------------------------------

describe('heterogeneity (DerSimonian–Laird)', () => {
  it('matches a hand computation on 4 studies', () => {
    // β = [0.5, 1.0, 0.2, 0.8], SE = [0.2, 0.25, 0.1, 0.4] → w = [25, 16, 100, 6.25]
    // Σw = 147.25, Σwβ = 53.5, Σwβ² = 30.25, Σw² = 10920.0625
    const h = heterogeneity([0.5, 1.0, 0.2, 0.8, NaN, 3], [0.2, 0.25, 0.1, 0.4, 0.3, 0]);
    const Q = 30.25 - (53.5 * 53.5) / 147.25;
    expect(h.k).toBe(4);
    expect(h.df).toBe(3);
    relClose(h.Q, Q, 1e-12);
    relClose(h.I2, (Q - 3) / Q, 1e-12);
    relClose(h.tau2, (Q - 3) / (147.25 - 10920.0625 / 147.25), 1e-12);
    expect(heterogeneity([1, 1, 1], [0.1, 0.2, 0.3])).toMatchObject({ Q: 0, I2: 0, tau2: 0 });
  });

  /**
   * Exact null expectation of the truncated I² = max(0, 1 − df/Q) for Q ~ χ²(df), by
   * Simpson integration of the χ² density (Γ(df/2) by recursion from Γ(1) or Γ(1/2)).
   * Under homogeneity E[I²] is small but not 0 (≈ 0.106 at df = 11, ≈ 0.090 at df = 19),
   * because the truncation at 0 discards the negative half.
   */
  function nullMeanI2(df: number): number {
    let gamma = df % 2 ? Math.sqrt(Math.PI) : 1;
    for (let x = df % 2 ? 0.5 : 1; x < df / 2; x++) gamma *= x;
    const pdf = (q: number): number => Math.exp((df / 2 - 1) * Math.log(q) - q / 2) / (2 ** (df / 2) * gamma);
    const f = (q: number): number => (1 - df / q) * pdf(q);
    const a = df;
    const b = df + 60 * Math.sqrt(2 * df);
    const m = 20000;
    const h = (b - a) / m;
    let s = f(a) + f(b);
    for (let t = 1; t < m; t++) s += (t % 2 ? 4 : 2) * f(a + t * h);
    return (s * h) / 3;
  }

  it('homogeneous data match the exact null E[I²]; heterogeneous data give large I²', () => {
    const g = gen(5);
    const reps = 4000;
    for (const k of [12, 20]) {
      let homo = 0;
      let hetero = 0;
      for (let r = 0; r < reps; r++) {
        const se = Array.from({ length: k }, () => 0.2 + 0.5 * g.u());
        homo += heterogeneity(se.map((s) => 1 + s * g.n()), se).I2;
        hetero += heterogeneity(se.map((s) => 1 + 1.5 * g.n() + s * g.n()), se).I2;
      }
      const expected = nullMeanI2(k - 1);
      expect(expected).toBeGreaterThan(0.08);
      expect(expected).toBeLessThan(0.11);
      expect(Math.abs(homo / reps - expected)).toBeLessThan(0.01);
      expect(hetero / reps).toBeGreaterThan(0.8);
      if (k === 20) expect(homo / reps).toBeLessThan(0.1);
    }
  });
});

// ---------------------------------------------------------------------------
// envfit
// ---------------------------------------------------------------------------

describe('envfit', () => {
  const n = 40;
  const g = gen(99);
  const coords = Float64Array.from({ length: 2 * n }, () => 3 * g.n());
  const rotate = (c: ArrayLike<number>, th: number): Float64Array => {
    const out = new Float64Array(c.length);
    for (let i = 0; i < c.length / 2; i++) {
      out[2 * i] = Math.cos(th) * c[2 * i] - Math.sin(th) * c[2 * i + 1];
      out[2 * i + 1] = Math.sin(th) * c[2 * i] + Math.cos(th) * c[2 * i + 1];
    }
    return out;
  };

  it('recovers a planted linear gradient', () => {
    const values = range(n).map((i) => 5 + 2 * coords[2 * i] - coords[2 * i + 1] + 0.3 * g.n());
    values[4] = NaN;
    const vals: (number | null)[] = values.map((x) => (Number.isNaN(x) ? null : x));
    vals[7] = null;
    const fit = envfitVector(coords, vals, 999, 1);
    expect(fit.n).toBe(n - 2);
    expect(fit.r2).toBeGreaterThan(0.95);
    expect(fit.p).toBeCloseTo(1 / 1000, 12);
    expect(fit.direction[0]).toBeCloseTo(2 / Math.sqrt(5), 1);
    expect(fit.direction[1]).toBeCloseTo(-1 / Math.sqrt(5), 1);
    expect(Math.hypot(...fit.direction)).toBeCloseTo(1, 12);
  });

  it('pure-noise covariates give roughly uniform p', () => {
    const ps: number[] = [];
    for (let r = 0; r < 60; r++) ps.push(envfitVector(coords, range(n).map(() => g.n()), 199, r + 1).p);
    const mean = ps.reduce((s, x) => s + x, 0) / ps.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);
    expect(ps.filter((p) => p < 0.05).length).toBeLessThanOrEqual(9);
  });

  it('rotation rotates the direction and leaves r2 and p unchanged', () => {
    const vals = range(n).map((i) => coords[2 * i] + 0.5 * coords[2 * i + 1] + 2 * g.n());
    const th = 0.7;
    const a = envfitVector(coords, vals, 499, 3);
    const b = envfitVector(rotate(coords, th), vals, 499, 3);
    relClose(b.r2, a.r2, 1e-10);
    expect(b.p).toBe(a.p);
    expect(b.direction[0]).toBeCloseTo(Math.cos(th) * a.direction[0] - Math.sin(th) * a.direction[1], 10);
    expect(b.direction[1]).toBeCloseTo(Math.sin(th) * a.direction[0] + Math.cos(th) * a.direction[1], 10);
    const labs = range(n).map((i) => (i % 3 === 0 ? 'a' : i % 3 === 1 ? 'b' : 'c'));
    const fa = envfitFactor(coords, labs, 499, 4);
    const fb = envfitFactor(rotate(coords, th), labs, 499, 4);
    relClose(fb.r2, fa.r2, 1e-10);
    expect(fb.p).toBe(fa.p);
  });

  it('factor centroids and R² are correct; separated groups give small p', () => {
    const c = [0, 0, 2, 0, 0, 2, 10, 10, 12, 10, 10, 12, 5, 5];
    const labs: (string | null)[] = ['a', 'a', 'a', 'b', 'b', 'b', null];
    const f = envfitFactor(c, labs, 999, 1);
    expect(f.n).toBe(6);
    expect(f.centroids).toHaveLength(2);
    const [ca, cb] = f.centroids;
    expect(ca.level).toBe('a');
    expect(ca.x).toBeCloseTo(2 / 3, 12);
    expect(ca.y).toBeCloseTo(2 / 3, 12);
    expect(ca.n).toBe(3);
    expect(cb.x).toBeCloseTo(32 / 3, 12);
    expect(cb.y).toBeCloseTo(32 / 3, 12);
    // total SS about the grand mean (17/3, 17/3), between SS = 3·2·(5)²·2
    const xs = [0, 2, 0, 10, 12, 10];
    const ys = [0, 0, 2, 10, 10, 12];
    const gm = 34 / 6;
    const sst = xs.reduce((s, x) => s + (x - gm) ** 2, 0) + ys.reduce((s, y) => s + (y - gm) ** 2, 0);
    const ssb = 3 * 2 * (2 / 3 - gm) ** 2 + 3 * 2 * (32 / 3 - gm) ** 2;
    relClose(f.r2, ssb / sst, 1e-12);
    // 6 points in two groups of 3: 10 distinct splits, so the best attainable p is ~2/20
    expect(f.p).toBeLessThan(0.15);
    const big = range(n).map((i) => (coords[2 * i] > 0 ? 'right' : 'left'));
    expect(envfitFactor(coords, big, 999, 2).p).toBeCloseTo(1 / 1000, 12);
  });
});
