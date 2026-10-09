import { describe, it, expect } from 'vitest';
import {
  nmds,
  kruskalStress1,
  isotonicPrimary,
  neighborPreservation,
  sourceNeighbors,
  metricSmacof,
  NMDS_SOLVER,
  type EmbeddingResult,
} from '../src/volumeset/nmds';

// ---------------------------------------------------------------------------
// Test helpers (deliberately independent of the implementation)
// ---------------------------------------------------------------------------

/** Small LCG so test data do not share the implementation's PRNG. */
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

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `m${i}`);

function euclidMatrix(pts: number[][], f: (d: number) => number = (d) => d): Float64Array {
  const n = pts.length;
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let s = 0;
      for (let c = 0; c < pts[i].length; c++) s += (pts[i][c] - pts[j][c]) ** 2;
      d[i * n + j] = f(Math.sqrt(s));
    }
  return d;
}

function pearson(a: number[], b: number[]): number {
  const m = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / m;
  const mb = b.reduce((s, v) => s + v, 0) / m;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < m; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

/** 1 − r dissimilarity matrix (exactly symmetric, zero diagonal). */
function corrDissim(rows: number[][]): Float64Array {
  const n = rows.length;
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) d[i * n + j] = d[j * n + i] = 1 - pearson(rows[i], rows[j]);
  return d;
}

function randomSymmetric(n: number, rnd: () => number, f: () => number = () => 2 * rnd()): Float64Array {
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d[i * n + j] = d[j * n + i] = f();
  return d;
}

function dist2(c: ArrayLike<number>, i: number, j: number): number {
  return Math.hypot(c[2 * i] - c[2 * j], c[2 * i + 1] - c[2 * j + 1]);
}

function upper(d: ArrayLike<number>, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push(d[i * n + j]);
  return out;
}

/** Isotonic regression by the min–max formula: ŷ_i = max_{a≤i} min_{b≥i} mean(y_a..y_b). */
function isoMinMax(y: number[]): number[] {
  const m = y.length;
  const out: number[] = [];
  for (let i = 0; i < m; i++) {
    let best = -Infinity;
    for (let a = 0; a <= i; a++) {
      let inner = Infinity;
      for (let b = i; b < m; b++) {
        let s = 0;
        for (let t = a; t <= b; t++) s += y[t];
        inner = Math.min(inner, s / (b - a + 1));
      }
      best = Math.max(best, inner);
    }
    out.push(best);
  }
  return out;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const p of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

/**
 * Reference Stress-1 under the primary tie approach, by brute force: minimum
 * over every ordering of pairs inside each tie block of the min–max isotonic loss.
 */
function referenceStress1(dissim: number[], d: number[]): number {
  const idx = dissim.map((_, i) => i).sort((a, b) => dissim[a] - dissim[b]);
  const blocks: number[][] = [];
  for (const i of idx) {
    const last = blocks[blocks.length - 1];
    if (last && dissim[last[0]] === dissim[i]) last.push(i);
    else blocks.push([i]);
  }
  const den = d.reduce((s, v) => s + v * v, 0);
  let best = Infinity;
  const rec = (b: number, prefix: number[]): void => {
    if (b === blocks.length) {
      const y = prefix.map((p) => d[p]);
      const fit = isoMinMax(y);
      let num = 0;
      for (let t = 0; t < y.length; t++) num += (y[t] - fit[t]) ** 2;
      best = Math.min(best, num);
      return;
    }
    for (const perm of permutations(blocks[b])) rec(b + 1, [...prefix, ...perm]);
  };
  rec(0, []);
  return Math.sqrt(best / den);
}

/** Stress-1 with ties broken by a FIXED order: isoMDS's order(dis) on the column-major lower triangle. */
function isoMdsFixedTieStress(dist: ArrayLike<number>, coords: ArrayLike<number>, n: number): number {
  const dis: number[] = [];
  const dd: number[] = [];
  for (let j = 0; j < n; j++)
    for (let i = j + 1; i < n; i++) {
      dis.push(dist[i * n + j]);
      dd.push(dist2(coords, i, j));
    }
  const ord = dis.map((_, k) => k).sort((a, b) => dis[a] - dis[b] || a - b);
  const y = ord.map((k) => dd[k]);
  const fit = isoMinMax(y);
  let num = 0;
  for (let t = 0; t < y.length; t++) num += (y[t] - fit[t]) ** 2;
  return Math.sqrt(num / dd.reduce((s, v) => s + v * v, 0));
}

/** Spearman rank correlation (average ranks for ties). */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]): number[] => {
    const o = v.map((_, i) => i).sort((x, y) => v[x] - v[y]);
    const r = new Array<number>(v.length);
    for (let s = 0; s < o.length; ) {
      let e = s;
      while (e + 1 < o.length && v[o[e + 1]] === v[o[s]]) e++;
      for (let t = s; t <= e; t++) r[o[t]] = (s + e) / 2;
      s = e + 1;
    }
    return r;
  };
  return pearson(rank(a), rank(b));
}

/** Relative residual ||A − s·Q·B|| / ||A|| after optimal similarity Procrustes (rotation or reflection). */
function procrustesResidual(truth: number[][], c: ArrayLike<number>): number {
  const n = truth.length;
  const centreRows = (m: number[][]): number[][] => {
    const mx = m.reduce((s, p) => s + p[0], 0) / n;
    const my = m.reduce((s, p) => s + p[1], 0) / n;
    return m.map((p) => [p[0] - mx, p[1] - my]);
  };
  const A = centreRows(truth);
  let best = Infinity;
  for (const refl of [1, -1]) {
    const B = centreRows(Array.from({ length: n }, (_, i) => [c[2 * i], refl * c[2 * i + 1]]));
    let sc = 0;
    let ss = 0;
    let bb = 0;
    for (let i = 0; i < n; i++) {
      sc += A[i][0] * B[i][0] + A[i][1] * B[i][1];
      ss += A[i][1] * B[i][0] - A[i][0] * B[i][1];
      bb += B[i][0] ** 2 + B[i][1] ** 2;
    }
    const th = Math.atan2(ss, sc);
    const co = Math.cos(th);
    const si = Math.sin(th);
    let dot = 0;
    const RB = B.map(([x, y]) => [x * co - y * si, x * si + y * co]);
    for (let i = 0; i < n; i++) dot += A[i][0] * RB[i][0] + A[i][1] * RB[i][1];
    const s = dot / bb;
    let res = 0;
    let aa = 0;
    for (let i = 0; i < n; i++) {
      res += (A[i][0] - s * RB[i][0]) ** 2 + (A[i][1] - s * RB[i][1]) ** 2;
      aa += A[i][0] ** 2 + A[i][1] ** 2;
    }
    best = Math.min(best, Math.sqrt(res / aa));
  }
  return best;
}

function expectFiniteCoords(r: EmbeddingResult): void {
  expect(r.coords.length).toBe(2 * r.n);
  for (const v of r.coords) expect(Number.isFinite(v)).toBe(true);
}

function planarPoints(n: number, seed: number): number[][] {
  const rnd = lcg(seed);
  return Array.from({ length: n }, () => [2 * rnd() - 1, 2 * rnd() - 1]);
}

// ---------------------------------------------------------------------------
// Goldens from R
// ---------------------------------------------------------------------------

/*
 * Generated 2026-10-09 with R 4.5.1 (2025-06-13), MASS 7.3-65, by the scratch
 * script goldens.R:
 *   fit <- MASS::isoMDS(d, y = cmdscale(d, k = 2), k = 2, maxit = 1000, tol = 1e-8, trace = FALSE)
 * Dissimilarities were rounded (6 decimals, or 1 decimal for tiedCoarse) BEFORE
 * fitting, so the constants below are exactly what R saw. `config` is fit$points
 * (row i = member i), `stressPercent` is fit$stress = 100 × Kruskal Stress-1.
 *
 * Tie semantics: isoMDS computes `ord <- order(dis)` once on the column-major lower
 * triangle and keeps that order throughout, i.e. tied dissimilarities are ordered by
 * pair position (a fixed tie order), NOT Kruskal's primary approach. Hence the
 * Stress-1 equality check uses only tie-free matrices; for tiedCoarse we check the
 * fixed-order reproduction and that primary Stress-1 ≤ R's (primary minimises over
 * tie orders). Note: twoGroups is a classic nonmetric degeneracy — isoMDS collapses
 * each well-separated group to (almost) a point with near-zero stress.
 */
const GOLDENS: Record<string, { n: number; dist: number[]; config: number[]; stressPercent: number; ties: boolean }> = {
  planarNoisy: {
    n: 8,
    dist: [
      0.000000, 1.346000, 0.562538, 1.590322, 0.967870, 1.375291, 0.909949, 1.801004,
      1.346000, 0.000000, 0.649907, 1.736198, 0.409972, 1.092013, 1.445634, 1.120802,
      0.562538, 0.649907, 0.000000, 1.348548, 0.635641, 1.281586, 1.034112, 1.879761,
      1.590322, 1.736198, 1.348548, 0.000000, 1.210084, 0.285700, 1.067964, 0.939027,
      0.967870, 0.409972, 0.635641, 1.210084, 0.000000, 0.774683, 1.040906, 1.135663,
      1.375291, 1.092013, 1.281586, 0.285700, 0.774683, 0.000000, 0.854018, 0.794703,
      0.909949, 1.445634, 1.034112, 1.067964, 1.040906, 0.854018, 0.000000, 1.650512,
      1.801004, 1.120802, 1.879761, 0.939027, 1.135663, 0.794703, 1.650512, 0.000000,
    ],
    config: [
      0.98201888196666431, -0.29248877927602723,
      0.20806908697894208, 0.86121210980999519,
      0.81558240309111762, 0.11929329836285937,
      -0.75750022766241576, -0.53139924775846281,
      0.20239845834350711, 0.34953052049152822,
      -0.5589319339672878, -0.23268075293569296,
      0.21244932636332733, -0.7238966848669588,
      -1.1040859951138515, 0.45042953617275761,
    ],
    stressPercent: 3.8166806955582584,
    ties: false,
  },
  twoGroups: {
    n: 10,
    dist: [
      0.000000, 0.173446, 0.249213, 0.246120, 0.236389, 1.137287, 1.048419, 1.234894, 1.182727, 1.001515,
      0.173446, 0.000000, 0.249936, 0.266498, 0.176692, 1.085584, 1.067896, 1.158939, 1.061537, 1.039336,
      0.249213, 0.249936, 0.000000, 0.328481, 0.388724, 0.922729, 1.058704, 1.029474, 0.963542, 0.922747,
      0.246120, 0.266498, 0.328481, 0.000000, 0.367642, 1.130433, 1.176530, 1.148338, 1.237982, 1.044858,
      0.236389, 0.176692, 0.388724, 0.367642, 0.000000, 1.020635, 0.975482, 1.112880, 0.998450, 0.985893,
      1.137287, 1.085584, 0.922729, 1.130433, 1.020635, 0.000000, 0.294219, 0.247375, 0.215237, 0.232717,
      1.048419, 1.067896, 1.058704, 1.176530, 0.975482, 0.294219, 0.000000, 0.292292, 0.344224, 0.403335,
      1.234894, 1.158939, 1.029474, 1.148338, 1.112880, 0.247375, 0.292292, 0.000000, 0.239037, 0.366715,
      1.182727, 1.061537, 0.963542, 1.237982, 0.998450, 0.215237, 0.344224, 0.239037, 0.000000, 0.373171,
      1.001515, 1.039336, 0.922747, 1.044858, 0.985893, 0.232717, 0.403335, 0.366715, 0.373171, 0.000000,
    ],
    config: [
      -0.85477373849872218, 0.012151847880116695,
      -0.8546098726903113, 0.012105965874914429,
      -0.8545443527826786, 0.011984094717410583,
      -0.85472165008965406, 0.012031145719271736,
      -0.85461761822664473, 0.011794325129986155,
      0.85461653299197771, -0.012126785009419423,
      0.85471537185816071, -0.01219183575494058,
      0.85471606298859459, -0.011921691199250978,
      0.8546232093369911, -0.011822999213537374,
      0.85459605511228021, -0.012004068144547098,
    ],
    stressPercent: 0.0055492691426735925,
    ties: false,
  },
  randomNonmetric: {
    n: 7,
    dist: [
      0.000000, 1.408228, 1.724709, 1.378184, 0.974957, 0.861452, 0.473466,
      1.408228, 0.000000, 0.527858, 1.091159, 0.875672, 0.896360, 0.370352,
      1.724709, 0.527858, 0.000000, 0.526860, 0.297298, 0.511276, 0.877385,
      1.378184, 1.091159, 0.526860, 0.000000, 1.493319, 1.142195, 1.014263,
      0.974957, 0.875672, 0.297298, 1.493319, 0.000000, 0.688937, 1.146511,
      0.861452, 0.896360, 0.511276, 1.142195, 0.688937, 0.000000, 1.113811,
      0.473466, 0.370352, 0.877385, 1.014263, 1.146511, 1.113811, 0.000000,
    ],
    config: [
      0.71192745894990073, -0.12438466001993548,
      -0.3761201872032704, 0.15583988308053501,
      -0.40280799757410918, -0.15674589804304045,
      -0.33091015085109232, 0.63292149576453471,
      -0.065997253109245438, -0.58603178002082135,
      0.21002557508208688, -0.26719721746899333,
      0.25388255470572718, 0.34559817670771825,
    ],
    stressPercent: 14.73747049983487,
    ties: false,
  },
  tiedCoarse: {
    n: 9,
    dist: [
      0.000000, 1.100000, 1.200000, 0.900000, 1.200000, 1.300000, 1.100000, 1.000000, 0.900000,
      1.100000, 0.000000, 0.700000, 1.000000, 1.000000, 1.300000, 0.900000, 1.000000, 1.300000,
      1.200000, 0.700000, 0.000000, 1.200000, 1.000000, 1.200000, 0.500000, 1.000000, 1.300000,
      0.900000, 1.000000, 1.200000, 0.000000, 0.800000, 1.300000, 1.200000, 1.000000, 0.900000,
      1.200000, 1.000000, 1.000000, 0.800000, 0.000000, 1.400000, 1.100000, 1.400000, 1.700000,
      1.300000, 1.300000, 1.200000, 1.300000, 1.400000, 0.000000, 1.200000, 0.400000, 0.600000,
      1.100000, 0.900000, 0.500000, 1.200000, 1.100000, 1.200000, 0.000000, 0.800000, 1.000000,
      1.000000, 1.000000, 1.000000, 1.000000, 1.400000, 0.400000, 0.800000, 0.000000, 0.600000,
      0.900000, 1.300000, 1.300000, 0.900000, 1.700000, 0.600000, 1.000000, 0.600000, 0.000000,
    ],
    config: [
      0.18943197219252017, 0.55282058480295004,
      -0.54758574414755889, -0.26281144313015747,
      -0.34526393684635154, -0.52269291753945912,
      -0.27596938229973506, 0.54483657419298293,
      -0.86377377075244011, 0.41543904448669366,
      0.77126432338693474, -0.21466863389180665,
      -0.12287382393792697, -0.503688392217989,
      0.53300454649899398, -0.22829369929972274,
      0.6617658159055565, 0.2190588825965043,
    ],
    stressPercent: 7.2546150559856057,
    ties: true,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('nmds: objective (Stress-1 and primary isotonic regression)', () => {
  it('matches a brute-force primary-tie reference (min–max isotonic over all tie orders)', () => {
    const rnd = lcg(42);
    for (let trial = 0; trial < 25; trial++) {
      const n = 4 + (trial % 2); // 6 or 10 pairs
      // Coarse dissimilarity levels (including 0) to force ties.
      const dist = randomSymmetric(n, rnd, () => Math.floor(rnd() * 4) * 0.5);
      const coords = Array.from({ length: 2 * n }, () => 2 * rnd() - 1);
      const ours = kruskalStress1(dist, coords, n);
      const dissim = upper(dist, n);
      const d: number[] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d.push(dist2(coords, i, j));
      expect(ours.stress1).toBeCloseTo(referenceStress1(dissim, d), 12);
      ours.distances.forEach((v, p) => expect(v).toBeCloseTo(d[p], 14));
      // Disparities are monotone in the dissimilarity order across tie blocks.
      for (let p = 0; p < dissim.length; p++)
        for (let q = 0; q < dissim.length; q++)
          if (dissim[p] < dissim[q]) expect(ours.disparities[p]).toBeLessThanOrEqual(ours.disparities[q] + 1e-12);
    }
  });

  it('isotonicPrimary equals the min–max formula when there are no ties', () => {
    const rnd = lcg(7);
    const dissim = Array.from({ length: 30 }, () => rnd());
    const d = Array.from({ length: 30 }, () => rnd());
    const ord = dissim.map((_, i) => i).sort((a, b) => dissim[a] - dissim[b]);
    const ref = isoMinMax(ord.map((i) => d[i]));
    const ours = isotonicPrimary(dissim, d);
    ord.forEach((i, t) => expect(ours[i]).toBeCloseTo(ref[t], 13));
  });

  it('primary ties let tied pairs keep different disparities', () => {
    // Two tied pairs whose distances are out of input order: primary fits them exactly.
    const out = isotonicPrimary([1, 1, 2], [3, 1, 4]);
    expect(Array.from(out)).toEqual([3, 1, 4]);
  });

  it('is scale-invariant and NaN for a collapsed configuration', () => {
    const dist = euclidMatrix(planarPoints(6, 3));
    const c = Array.from({ length: 12 }, (_, i) => Math.sin(i * 1.7));
    const a = kruskalStress1(dist, c, 6).stress1;
    const b = kruskalStress1(dist, c.map((v) => 37 * v), 6).stress1;
    expect(b).toBeCloseTo(a, 12);
    expect(kruskalStress1(dist, new Float64Array(12), 6).stress1).toBeNaN();
  });
});

describe('nmds: goldens from MASS::isoMDS', () => {
  for (const [name, g] of Object.entries(GOLDENS)) {
    if (!g.ties) {
      it(`${name}: our Stress-1 of R's configuration equals R's stress / 100`, () => {
        expect(kruskalStress1(g.dist, g.config, g.n).stress1).toBeCloseTo(g.stressPercent / 100, 6);
      });
    } else {
      it(`${name}: R's stress reproduces with isoMDS's fixed tie order, and primary ≤ fixed`, () => {
        const fixed = isoMdsFixedTieStress(g.dist, g.config, g.n);
        expect(fixed).toBeCloseTo(g.stressPercent / 100, 6);
        expect(kruskalStress1(g.dist, g.config, g.n).stress1).toBeLessThanOrEqual(fixed + 1e-12);
      });
    }
    it(`${name}: nmds() reaches Stress-1 ≤ R's + 1e-4`, () => {
      const r = nmds(g.dist, ids(g.n));
      expectFiniteCoords(r);
      expect(r.nmdsStress1).not.toBeNull();
      expect(r.nmdsStress1!).toBeLessThanOrEqual(g.stressPercent / 100 + 1e-4);
      if (name === 'twoGroups') {
        // R's isoMDS collapses the two groups too; we detect it and fall back.
        expect([r.method, r.status]).toEqual(['metric-smacof', 'degenerate-fallback']);
        expect(r.degenerate!.collapsedPairs).toBeGreaterThan(0);
      } else {
        expect([r.method, r.degenerate]).toEqual(['nmds', null]);
        expect(r.stress1).toBe(r.nmdsStress1);
        // The reported stress is the stress of the returned coordinates.
        expect(kruskalStress1(g.dist, r.coords, g.n).stress1).toBeCloseTo(r.stress1, 12);
      }
    });
  }
});

describe('nmds: known geometry', () => {
  // n = 20: with only ~10 points the zero-stress solution set of NMDS is a region,
  // not a point (Procrustes residual ≈ 0.03 at Stress-1 ≈ 1e-12, measured), so
  // recovery up to similarity is only well-defined with enough points.
  const N = 20;
  const truth = planarPoints(N, 11);
  for (const [label, f] of [
    ['Euclidean', (d: number) => d],
    ['cubed (monotone transform)', (d: number) => d ** 3],
  ] as const) {
    it(`recovers a planar configuration from ${label} dissimilarities`, () => {
      const dist = euclidMatrix(truth, f);
      const r = nmds(dist, ids(N));
      expect(r.method).toBe('nmds');
      expect(r.degenerate).toBeNull();
      expect(r.stress1).toBeLessThan(1e-4);
      expect(procrustesResidual(truth, r.coords)).toBeLessThan(1e-2);
      const emb: number[] = [];
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) emb.push(dist2(r.coords, i, j));
      expect(spearman(upper(dist, N), emb)).toBeGreaterThan(0.999);
    });
  }

  it('returns coordinates in the documented canonical pose', () => {
    const rnd = lcg(5);
    const pts = planarPoints(12, 99);
    const base = euclidMatrix(pts);
    const dist = new Float64Array(144);
    for (let i = 0; i < 12; i++)
      for (let j = i + 1; j < 12; j++) dist[i * 12 + j] = dist[j * 12 + i] = base[i * 12 + j] * (1 + 0.1 * (rnd() - 0.5));
    const r = nmds(dist, ids(12));
    const c = r.coords;
    let mx = 0;
    let my = 0;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < 12; i++) {
      mx += c[2 * i];
      my += c[2 * i + 1];
      sxy += c[2 * i] * c[2 * i + 1];
      sxx += c[2 * i] ** 2;
      syy += c[2 * i + 1] ** 2;
      cx += c[2 * i] ** 3;
      cy += c[2 * i + 1] ** 3;
    }
    expect(Math.abs(mx)).toBeLessThan(1e-12);
    expect(Math.abs(my)).toBeLessThan(1e-12);
    expect(Math.abs(sxy)).toBeLessThan(1e-10);
    expect(sxx).toBeGreaterThanOrEqual(syy);
    expect(cx).toBeGreaterThanOrEqual(0);
    expect(cy).toBeGreaterThanOrEqual(0);
    let msd = 0;
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) msd += dist2(c, i, j) ** 2;
    expect(msd / 66).toBeCloseTo(1, 12);
  });
});

describe('nmds: determinism and permutation', () => {
  const rnd = lcg(2024);
  const pts = planarPoints(12, 77);
  const base = euclidMatrix(pts);
  const dist = new Float64Array(144);
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++) dist[i * 12 + j] = dist[j * 12 + i] = base[i * 12 + j] * Math.exp(0.2 * gauss(rnd));

  it('gives bitwise-identical results for identical input', () => {
    const a = nmds(dist, ids(12));
    const b = nmds(Float64Array.from(dist), ids(12));
    expect(Array.from(b.coords)).toEqual(Array.from(a.coords));
    expect(b.stress1).toBe(a.stress1);
    expect(b.starts).toEqual(a.starts);
    expect(a.solver).toEqual(NMDS_SOLVER);
    expect(a.params).toEqual({
      restarts: 8,
      seed: 1,
      maxIter: 500,
      tol: 1e-7,
      ties: 'primary',
      stress: 'kruskal-1',
      init: 'classical+random',
    });
    expect(a.starts.length).toBe(9);
    expect(a.starts[0].init).toBe('classical');
    expect(a.starts.slice(1).map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a.bestHits).toBeGreaterThanOrEqual(1);
    expect(a.stress1).toBeCloseTo(Math.min(...a.starts.map((s) => s.stress1)), 12);
  });

  it('is invariant (up to rotation/reflection) to the input order', () => {
    const perm = [5, 0, 11, 3, 8, 1, 10, 2, 7, 4, 9, 6];
    const pd = new Float64Array(144);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) pd[i * 12 + j] = dist[perm[i] * 12 + perm[j]];
    const idsA = ids(12);
    const idsB = perm.map((p) => idsA[p]);
    // Default tol: same optimum to the solver's precision (Stress-1 to 1e-6).
    expect(nmds(pd, idsB).stress1).toBeCloseTo(nmds(dist, idsA).stress1, 6);
    // Tight tol: the configurations themselves agree (distances mapped by id).
    const tight = { tol: 1e-12, maxIter: 20000 };
    const a = nmds(dist, idsA, tight);
    const b = nmds(pd, idsB, tight);
    expect(b.ids).toEqual(idsB);
    expect(b.stress1).toBeCloseTo(a.stress1, 9);
    const posB = new Map(idsB.map((id, k) => [id, k]));
    for (let i = 0; i < 12; i++)
      for (let j = i + 1; j < 12; j++) {
        const bi = posB.get(idsA[i])!;
        const bj = posB.get(idsA[j])!;
        expect(dist2(b.coords, bi, bj)).toBeCloseTo(dist2(a.coords, i, j), 4);
      }
  });
});

describe('nmds: duplicates, zeros and anticorrelation', () => {
  it('keeps pattern-identical members addressable and coincident; anticorrelated members far apart', () => {
    const rnd = lcg(31);
    const rows = Array.from({ length: 10 }, () => Array.from({ length: 30 }, () => gauss(rnd)));
    rows.push(rows[3].slice()); // m10 duplicates m3
    rows.push(rows[0].map((v) => -v)); // m11 anticorrelates with m0
    const n = rows.length;
    const dist = corrDissim(rows);
    dist[3 * n + 10] = dist[10 * n + 3] = 0; // exactly zero (valid data, not missing)
    expect(dist[0 * n + 11]).toBeCloseTo(2, 12);
    const r = nmds(dist, ids(n));
    // An exact duplicate may coincide without being declared degenerate.
    expect([r.method, r.degenerate]).toEqual(['nmds', null]);
    expect(r.ids).toHaveLength(n);
    expect(r.ids[10]).toBe('m10');
    expectFiniteCoords(r);
    // Scale: mean squared inter-point distance is 1, so 0.05 is small relative to it.
    expect(dist2(r.coords, 3, 10)).toBeLessThan(0.05);
    const all: number[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) all.push(dist2(r.coords, i, j));
    all.sort((a, b) => a - b);
    expect(dist2(r.coords, 0, 11)).toBeGreaterThanOrEqual(all[Math.floor(0.75 * all.length)]);
    // The zero-dissimilarity pair is the smallest rank, so it gets the smallest disparity.
    let p = 0;
    for (let i = 0; i < 3; i++) p += n - 1 - i;
    p += 10 - 3 - 1; // row-major pair index of (3, 10)
    expect(r.pairs.dissimilarity[p]).toBe(0);
    expect(r.pairs.disparity[p]).toBe(Math.min(...r.pairs.disparity));
  });

  it('places planted noisy groups closer within than between (any good optimum)', () => {
    const rnd = lcg(8);
    const centroids = Array.from({ length: 3 }, () => Array.from({ length: 40 }, () => gauss(rnd)));
    const rows: number[][] = [];
    const group: number[] = [];
    for (let g = 0; g < 3; g++)
      for (let m = 0; m < 8; m++) {
        rows.push(centroids[g].map((v) => v + 1.0 * gauss(rnd)));
        group.push(g);
      }
    const n = rows.length;
    const r = nmds(corrDissim(rows), ids(n));
    let within = 0;
    let nw = 0;
    let between = 0;
    let nb = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const d = dist2(r.coords, i, j);
        if (group[i] === group[j]) {
          within += d;
          nw++;
        } else {
          between += d;
          nb++;
        }
      }
    expect(within / nw).toBeLessThan(between / nb);
  });
});

/** Planted groups where EVERY within-group δ is smaller than EVERY between-group δ. */
function separatedGroups(sizes: number[], seed: number): { dist: Float64Array; group: number[] } {
  const rnd = lcg(seed);
  const group = sizes.flatMap((s, g) => new Array<number>(s).fill(g));
  const n = group.length;
  const dist = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      dist[i * n + j] = dist[j * n + i] = group[i] === group[j] ? 0.1 + 0.3 * rnd() : 0.9 + 0.4 * rnd();
  return { dist, group };
}

/** Independent ratio Stress-1: b = Σdδ/Σδ², sqrt(Σ(d − bδ)²/Σd²). */
function ratioStress(dist: ArrayLike<number>, c: ArrayLike<number>, n: number): { stress: number; b: number } {
  const del = upper(dist, n);
  const d: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d.push(dist2(c, i, j));
  const b = d.reduce((s, v, k) => s + v * del[k], 0) / del.reduce((s, v) => s + v * v, 0);
  const num = d.reduce((s, v, k) => s + (v - b * del[k]) ** 2, 0);
  return { stress: Math.sqrt(num / d.reduce((s, v) => s + v * v, 0)), b };
}

function meanWithinBetween(c: ArrayLike<number>, group: number[]): [number, number, number] {
  const n = group.length;
  let w = 0;
  let nw = 0;
  let b = 0;
  let nb = 0;
  let ss = 0;
  let minWithin = Infinity;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = dist2(c, i, j);
      ss += d * d;
      if (group[i] === group[j]) {
        w += d;
        nw++;
        minWithin = Math.min(minWithin, d);
      } else {
        b += d;
        nb++;
      }
    }
  const rms = Math.sqrt(ss / ((n * (n - 1)) / 2));
  return [w / nw, b / nb, minWithin / rms];
}

describe('nmds: degeneracy detection and metric fallback', () => {
  for (const sizes of [
    [7, 8],
    [5, 5, 5],
  ]) {
    it(`separated groups ${sizes.join('+')}: collapse detected, metric SMACOF shown instead`, () => {
      const { dist, group } = separatedGroups(sizes, 3 + sizes.length);
      const n = group.length;
      const r = nmds(dist, ids(n));
      expect([r.method, r.status]).toEqual(['metric-smacof', 'degenerate-fallback']);
      expect(r.degenerate).not.toBeNull();
      expect(r.degenerate!.collapsedPairs).toBeGreaterThan(0);
      expect(r.degenerate!.rule).toMatch(/Stress-1 < 0.0001/);
      expect(r.nmdsStress1!).toBeLessThan(1e-4);
      expect(r.message).toMatch(/degenerate/);
      expect(r.message).toMatch(/metric/);
      expectFiniteCoords(r);
      const [within, between, minWithinRel] = meanWithinBetween(r.coords, group);
      expect(minWithinRel).toBeGreaterThan(1e-3); // not collapsed
      expect(within).toBeLessThan(between);
      // Reported stress and Shepard disparities are those of the metric fit.
      const ref = ratioStress(dist, r.coords, n);
      expect(r.stress1).toBeCloseTo(ref.stress, 12);
      const del = upper(dist, n);
      r.pairs.disparity.forEach((v, k) => expect(v).toBeCloseTo(ref.b * del[k], 12));
      // The fallback equals a direct metric fit, and the direct fit's own status is plain.
      const m = metricSmacof(dist, ids(n));
      expect(Array.from(m.coords)).toEqual(Array.from(r.coords));
      expect([m.method, m.status, m.degenerate, m.nmdsStress1]).toEqual(['metric-smacof', 'converged', null, null]);
    });
  }

  it('the noisy planar golden is untouched (no fallback)', () => {
    const g = GOLDENS.planarNoisy;
    const r = nmds(g.dist, ids(g.n));
    expect([r.method, r.status, r.degenerate]).toEqual(['nmds', 'converged', null]);
  });

  it('exact duplicates alone do not trigger the fallback, even at zero stress', () => {
    // Exact planar distances (perfect fit, Stress-1 ≈ 0) plus a duplicated point.
    const pts = planarPoints(12, 4);
    pts.push(pts[2].slice());
    const n = pts.length;
    const r = nmds(euclidMatrix(pts), ids(n));
    expect([r.method, r.degenerate]).toEqual(['nmds', null]);
    expect(r.stress1).toBeLessThan(1e-4);
    expect(dist2(r.coords, 2, n - 1)).toBeLessThan(1e-3);
  });

  it('metricSmacof recovers Euclidean geometry exactly and reports maxIter honestly', () => {
    const truth = planarPoints(9, 21);
    const dist = euclidMatrix(truth);
    const r = metricSmacof(dist, ids(9));
    expect(r.method).toBe('metric-smacof');
    expect(r.stress1).toBeLessThan(1e-6);
    expect(procrustesResidual(truth, r.coords)).toBeLessThan(1e-5);
    expect(ratioStress(dist, r.coords, 9).stress).toBeCloseTo(r.stress1, 12);
    const noisy = metricSmacof(GOLDENS.randomNonmetric.dist, ids(7), { maxIter: 1 });
    expect([noisy.status, noisy.converged]).toEqual(['max-iterations', false]);
    expect(metricSmacof([], []).status).toBe('empty');
  });
});

describe('nmds: degenerate cases', () => {
  const noNaN = (r: EmbeddingResult): void => {
    for (const v of r.coords) expect(Number.isNaN(v)).toBe(false);
  };

  it('n = 0', () => {
    const r = nmds([], []);
    expect([r.status, r.method, r.n, r.coords.length]).toEqual(['empty', 'none', 0, 0]);
    expect(r.stress1).toBeNaN();
    expect(r.message).toMatch(/nothing/i);
  });

  it('n = 1', () => {
    const r = nmds([0], ['a']);
    expect([r.status, r.method]).toEqual(['exact-small-n', 'exact']);
    expect(Array.from(r.coords)).toEqual([0, 0]);
    expect(r.stress1).toBeNaN();
    expect(r.pairs.dissimilarity.length).toBe(0);
  });

  it('n = 2 (separated and coincident)', () => {
    const r = nmds([0, 0.7, 0.7, 0], ['a', 'b']);
    expect([r.status, r.method, r.stress1]).toEqual(['exact-small-n', 'exact', 0]);
    expect(Array.from(r.coords)).toEqual([-0.5, 0, 0.5, 0]);
    expect(r.message).toMatch(/not identifiable/);
    const z = nmds([0, 0, 0, 0], ['a', 'b']);
    expect([z.status, z.method, z.stress1]).toEqual(['all-coincident', 'exact', 0]);
    expect(Array.from(z.coords)).toEqual([0, 0, 0, 0]);
  });

  it('n = 3: exact triangle when metric, rank-preserving triangle otherwise', () => {
    const cases: [number, number, number][] = [
      [0.3, 0.4, 0.5], // metric
      [0.1, 0.2, 1.5], // violates the triangle inequality
      [0, 0.4, 1.2], // zero dissimilarity, non-metric
      [0.6, 0.6, 1.9], // tie + violation
      [0, 0.5, 0.5], // zero, metric (two members coincide)
    ];
    for (const [a, b, c] of cases) {
      const dist = [0, a, b, a, 0, c, b, c, 0];
      const r = nmds(dist, ['x', 'y', 'z']);
      expect([r.status, r.method, r.stress1]).toEqual(['exact-small-n', 'exact', 0]);
      expect(r.message).toMatch(/not identifiable for n ≤ 3/);
      noNaN(r);
      const dis = [a, b, c];
      const emb = [dist2(r.coords, 0, 1), dist2(r.coords, 0, 2), dist2(r.coords, 1, 2)];
      for (let p = 0; p < 3; p++)
        for (let q = 0; q < 3; q++) {
          if (dis[p] < dis[q]) expect(emb[p]).toBeLessThan(emb[q]);
          if (dis[p] === dis[q]) expect(emb[p]).toBeCloseTo(emb[q], 12);
        }
      if (c <= a + b && b <= a + c && a <= b + c) {
        // Exact metric triangle up to the scale normalisation.
        const s = emb[2] / c;
        expect(emb[0]).toBeCloseTo(a * s, 10);
        expect(emb[1]).toBeCloseTo(b * s, 10);
      }
    }
  });

  it('n = 3: an exact-pattern pair stays coincident when the third distances differ by roundoff', () => {
    // r = 1 pair (d01 = 0); d02 and d12 differ only by float32 noise, as for 2x + 0.5 copies.
    for (const [b, c] of [
      [0.73, 0.73 + 1e-10],
      [0.73 + 1e-10, 0.73],
    ]) {
      const r = nmds([0, 0, b, 0, 0, c, b, c, 0], ['x', 'y', 'z']);
      expect(r.method).toBe('exact');
      noNaN(r);
      // Coincident relative to the configuration scale, and equally far from the third member.
      expect(dist2(r.coords, 0, 1)).toBeLessThan(1e-6 * dist2(r.coords, 0, 2));
      expect(dist2(r.coords, 0, 2)).toBeCloseTo(dist2(r.coords, 1, 2), 6);
    }
  });

  it('neighbours: an exact-pattern pair ranks together despite float roundoff', () => {
    // Members 1 and 2 share a pattern (d12 = 0); their distances to member 0 differ by 1e-10.
    const n = 5;
    const d = [
      [0, 0.29, 0.29 + 1e-10, 0.9, 0.8],
      [0.29, 0, 0, 0.6, 0.7],
      [0.29 + 1e-10, 0, 0, 0.6 + 2e-10, 0.7],
      [0.9, 0.6, 0.6 + 2e-10, 0, 0.4],
      [0.8, 0.7, 0.7, 0.4, 0],
    ];
    const dist = d.flat();
    const near = sourceNeighbors(dist, n, 0, 1);
    expect(near.map((e) => [e.index, e.rank])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    // From member 3, k = 2: both members of the pair are included as a tie at rank 2.
    expect(sourceNeighbors(dist, n, 3, 2).map((e) => [e.index, e.rank])).toEqual([
      [4, 1],
      [1, 2],
      [2, 2],
    ]);
    // Ties never chain: 1e-9 steps beyond the block head are separate ranks.
    const chain = [0, 0.1, 0.1 + 0.6e-9, 0.1 + 1.2e-9, 0.1, 0, 0, 0, 0.1 + 0.6e-9, 0, 0, 0, 0.1 + 1.2e-9, 0, 0, 0];
    expect(sourceNeighbors(chain, 4, 0, 3).map((e) => e.rank)).toEqual([1, 1, 3]);
  });

  it('all tied: regular polygon, no information', () => {
    const n = 6;
    const dist = new Float64Array(n * n).map((_, k) => (Math.floor(k / n) === k % n ? 0 : 0.8));
    const r = nmds(dist, ids(n));
    expect([r.status, r.method, r.stress1]).toEqual(['all-tied', 'exact', 0]);
    expect(r.message).toMatch(/carry no information/);
    noNaN(r);
    const radius = Math.hypot(r.coords[0], r.coords[1]);
    for (let i = 0; i < n; i++) {
      expect(Math.hypot(r.coords[2 * i], r.coords[2 * i + 1])).toBeCloseTo(radius, 12);
      expect(dist2(r.coords, i, (i + 1) % n)).toBeCloseTo(dist2(r.coords, 0, 1), 12);
    }
  });

  it('all coincident', () => {
    const r = nmds(new Float64Array(25), ids(5));
    expect([r.status, r.method, r.stress1]).toEqual(['all-coincident', 'exact', 0]);
    expect(Array.from(r.coords)).toEqual(new Array(10).fill(0));
    expect(r.message).toMatch(/coincide/);
  });

  it('maxIter = 1 forces max-iterations with finite coordinates', () => {
    const r = nmds(GOLDENS.randomNonmetric.dist, ids(7), { maxIter: 1 });
    expect([r.status, r.method, r.converged, r.iterations]).toEqual(['max-iterations', 'nmds', false, 1]);
    expectFiniteCoords(r);
    expect(r.message).toMatch(/maxIter/);
  });
});

describe('nmds: input validation', () => {
  it('rejects malformed input', () => {
    expect(() => nmds([0, 1, 1.1, 0], ['a', 'b'])).toThrow(/symmetric/);
    expect(() => nmds([0, NaN, NaN, 0], ['a', 'b'])).toThrow(/finite/);
    expect(() => nmds([0, Infinity, Infinity, 0], ['a', 'b'])).toThrow(/finite/);
    expect(() => nmds([0, 1, 1], ['a', 'b'])).toThrow(/entries/);
    expect(() => nmds([0, 1, 1, 0], ['a', 'b', 'c'])).toThrow(/entries/);
    expect(() => nmds([0.5, 1, 1, 0], ['a', 'b'])).toThrow(/diagonal/);
    expect(() => nmds([0, -1, -1, 0], ['a', 'b'])).toThrow(/negative/);
    expect(() => nmds([0, 1, 1, 0], ['a', 'a'])).toThrow(/unique/);
    expect(() => nmds([0, 1, 1, 0], ['a', 'b'], { maxIter: 0 })).toThrow(/maxIter/);
    // Asymmetry below 1e-12 is tolerated.
    expect(() => nmds([0, 1, 1 + 1e-13, 0], ['a', 'b'])).not.toThrow();
  });
});

describe('neighbourhood diagnostics', () => {
  // Hand-built 5-member table with ties.
  //        0  1  2  3  4
  const D = [
    [0, 1, 2, 2, 5],
    [1, 0, 3, 4, 1],
    [2, 3, 0, 1, 6],
    [2, 4, 1, 0, 2],
    [5, 1, 6, 2, 0],
  ].flat();
  // Embedding on a line: x = 0, 1, 3, 4, 2.
  const C = [0, 0, 1, 0, 3, 0, 4, 0, 2, 0];

  it('neighborPreservation matches a hand-computed table (k = 2, ties included)', () => {
    // N_src: 0:{1,2,3} 1:{0,4} 2:{0,3} 3:{0,2,4} 4:{1,3}
    // N_emb: 0:{1,4}   1:{0,4} 2:{3,4} 3:{2,4}   4:{1,2}
    const r = neighborPreservation(D, C, 5, 2);
    expect(r.k).toBe(2);
    const expected = [1 / 3, 1, 1 / 2, 2 / 3, 1 / 2];
    r.perPoint.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 14));
    expect(r.mean).toBeCloseTo(0.6, 14);
    expect(r.definition).toMatch(/nearest neighbours/);
  });

  it('neighborPreservation default k and the uninformative small-n case', () => {
    expect(neighborPreservation(D, C, 5).k).toBe(3);
    const D4 = [0, 1, 2, 3, 1, 0, 1, 2, 2, 1, 0, 1, 3, 2, 1, 0];
    const C4 = [0, 0, 1, 0, 2, 0, 3, 0];
    const r = neighborPreservation(D4, C4, 4);
    expect(r.k).toBe(3);
    expect(Array.from(r.perPoint).every(Number.isNaN)).toBe(true);
    expect(r.mean).toBeNaN();
    expect(r.definition).toMatch(/Not informative/);
    const r2 = neighborPreservation(D4, C4, 4, 1);
    expect(Array.from(r2.perPoint)).toEqual([1, 1, 1, 1]);
    expect(neighborPreservation([0], [0, 0], 1).mean).toBeNaN();
  });

  it('sourceNeighbors is tie-inclusive with competition ranks', () => {
    expect(sourceNeighbors(D, 5, 0, 2)).toEqual([
      { index: 1, dissimilarity: 1, rank: 1 },
      { index: 2, dissimilarity: 2, rank: 2 },
      { index: 3, dissimilarity: 2, rank: 2 },
    ]);
    expect(sourceNeighbors(D, 5, 0, 4).map((e) => e.rank)).toEqual([1, 2, 2, 4]);
    expect(sourceNeighbors(D, 5, 3, 1)).toEqual([{ index: 2, dissimilarity: 1, rank: 1 }]);
    expect(sourceNeighbors(D, 5, 3, 2).map((e) => e.index)).toEqual([2, 0, 4]);
    expect(sourceNeighbors(D, 5, 4, 3).map((e) => [e.index, e.rank])).toEqual([
      [1, 1],
      [3, 2],
      [0, 3],
    ]);
    expect(sourceNeighbors(D, 5, 1, 10)).toHaveLength(4);
    expect(sourceNeighbors([0], 1, 0, 3)).toEqual([]);
    expect(() => sourceNeighbors(D, 5, 5, 1)).toThrow(/range/);
  });
});

describe('nmds: timing sanity', () => {
  for (const n of [50, 200]) {
    it(`n = ${n} random dissimilarities with default options`, () => {
      const dist = randomSymmetric(n, lcg(n));
      const t0 = performance.now();
      const r = nmds(dist, ids(n));
      const ms = performance.now() - t0;
      console.info(
        `nmds n=${n}: ${ms.toFixed(0)} ms, status ${r.status}, stress1 ${r.stress1.toFixed(4)}, ` +
          `bestHits ${r.bestHits}/${r.starts.length}, winner iterations ${r.iterations}`,
      );
      expectFiniteCoords(r);
      expect(ms).toBeLessThan(20000);
    }, 60000);
  }
});
