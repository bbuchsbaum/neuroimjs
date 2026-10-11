/**
 * Two-dimensional nonmetric multidimensional scaling (NMDS) of a small set of
 * members (~1–200) from a dissimilarity matrix, typically `1 − r` between brain
 * maps (values in [0, 2], not guaranteed to be metric).
 *
 * Browser-safe and dependency-free so it can run in a Web Worker. Everything is
 * deterministic: the same input and options give a bitwise-identical result.
 *
 * Definitions used throughout (pairs are i < j in row-major order):
 * - d_ij: Euclidean distance between points i and j of the 2D configuration.
 * - d̂_ij (disparities): least-squares monotone (non-decreasing in the
 *   dissimilarity order) fit to d, using Kruskal's *primary* approach to ties:
 *   pairs whose dissimilarities are exactly equal may receive different
 *   disparities (implemented by ordering tied pairs by their current d before
 *   pool-adjacent-violators).
 * - Kruskal Stress-1 = sqrt( Σ (d − d̂)² / Σ d² ). It is scale-invariant and 0
 *   for a configuration whose distances are in the same (weak) order as the
 *   dissimilarities.
 *
 * Off-diagonal zero dissimilarities are valid data (the smallest rank), not
 * missing values; members with identical patterns stay individually addressable.
 */

export const NMDS_SOLVER = { name: 'neuroimjs-nmds-smacof', version: '1.0.0' } as const;

export interface NmdsOptions {
  /** Random starts in addition to the classical-MDS start (default 8). */
  restarts?: number;
  /** PRNG seed; random start r uses seed + r (default 1). */
  seed?: number;
  /** Maximum Guttman iterations per start (default 500). */
  maxIter?: number;
  /** Converge when the relative Stress-1 decrease falls below this (default 1e-7). */
  tol?: number;
  /**
   * Warm start: a 2D configuration (length 2n, interleaved x0,y0,x1,y1,…, finite,
   * not all coincident) that replaces the classical-MDS start as the first start;
   * the `restarts` random starts still follow (set restarts = 0 for a fast refit).
   * Only a `warmStart` flag is recorded in `params`, never the coordinates.
   */
  init?: ArrayLike<number>;
}

export type EmbeddingStatus =
  | 'converged'
  | 'max-iterations'
  | 'exact-small-n'
  | 'all-tied'
  | 'all-coincident'
  | 'degenerate-fallback'
  | 'empty';

export interface NmdsStart {
  /** 'given' is the caller's warm-start configuration (`NmdsOptions.init`). */
  init: 'classical' | 'random' | 'given';
  /** PRNG seed of a random start. */
  seed?: number;
  /** Final Stress-1 of this start (NaN if the start was unusable). */
  stress1: number;
  iterations: number;
  converged: boolean;
}

export interface EmbeddingResult {
  /**
   * 'nmds' only for the iterative nonmetric fit; 'metric-smacof' for the ratio
   * (metric) fit used by `metricSmacof` and as the degeneracy fallback; trivial
   * cases are 'exact' or 'none'.
   */
  method: 'nmds' | 'metric-smacof' | 'exact' | 'none';
  solver: typeof NMDS_SOLVER;
  /**
   * Options in effect. With a warm start, `init` is 'given+random' and
   * `warmStart` is true; without one, `warmStart` is absent, so the params of an
   * ordinary fit are unchanged.
   */
  params: Required<Omit<NmdsOptions, 'init'>> & {
    ties: 'primary';
    stress: 'kruskal-1';
    init: 'classical+random' | 'given+random';
    warmStart?: true;
  };
  n: number;
  /** Input ids, in input order. */
  ids: string[];
  /**
   * Length 2n, interleaved x0,y0,x1,y1,… in canonical pose (see `canonicalPose`):
   * centred, rotated to principal axes, axis signs fixed by skewness, scaled so the
   * mean squared inter-point distance is 1. Axes and signs carry no meaning.
   */
  coords: Float64Array;
  /**
   * Stress-1 of `coords` against `pairs.disparity` of the returned method: primary
   * isotonic disparities for 'nmds'/'exact', ratio disparities b·δ (b the
   * least-squares scalar) for 'metric-smacof'. 0 for exact/trivial cases, NaN only when n < 2.
   */
  stress1: number;
  /** Stress-1 of the winning nonmetric fit whenever one was run ('nmds' or the fallback), else null. */
  nmdsStress1: number | null;
  /** Set when the nonmetric fit collapsed (see `nmds`), else null. */
  degenerate: { collapsedPairs: number; rule: string } | null;
  status: EmbeddingStatus;
  converged: boolean;
  /** Iterations of the winning start (0 for non-iterative cases). */
  iterations: number;
  starts: NmdsStart[];
  /** Starts whose Stress-1 is within max(1e-6, 1e-4·best) of the best. */
  bestHits: number;
  /** Per pair i < j in row-major pair order, for Shepard plots (disparity matches `method`). */
  pairs: { dissimilarity: Float64Array; distance: Float64Array; disparity: Float64Array };
  /** Human-readable explanation of `status`. */
  message: string;
}

const DEFAULTS: Required<Omit<NmdsOptions, 'init'>> = { restarts: 8, seed: 1, maxIter: 500, tol: 1e-7 };

// ---------------------------------------------------------------------------
// Small numerical helpers
// ---------------------------------------------------------------------------

/** mulberry32: tiny, fast, well-mixed 32-bit PRNG returning values in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Upper-triangle (i < j, row-major) values of an n×n matrix. */
function upperPairs(dist: ArrayLike<number>, n: number): Float64Array {
  const out = new Float64Array((n * (n - 1)) / 2);
  let p = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out[p++] = dist[i * n + j];
  return out;
}

/** Pairwise Euclidean distances of a 2D configuration, in pair order. */
function configDistances(x: ArrayLike<number>, n: number, out: Float64Array): Float64Array {
  let p = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[2 * i];
    const yi = x[2 * i + 1];
    for (let j = i + 1; j < n; j++) {
      const dx = xi - x[2 * j];
      const dy = yi - x[2 * j + 1];
      out[p++] = Math.sqrt(dx * dx + dy * dy);
    }
  }
  return out;
}

/** In-place pool-adjacent-violators on `y` (unit weights): non-decreasing LS fit. */
function pava(y: Float64Array): void {
  const m = y.length;
  const val = new Float64Array(m);
  const cnt = new Int32Array(m);
  let top = -1;
  for (let i = 0; i < m; i++) {
    top++;
    val[top] = y[i];
    cnt[top] = 1;
    while (top > 0 && val[top - 1] > val[top]) {
      const c = cnt[top - 1] + cnt[top];
      val[top - 1] = (val[top - 1] * cnt[top - 1] + val[top] * cnt[top]) / c;
      cnt[top - 1] = c;
      top--;
    }
  }
  let k = 0;
  for (let b = 0; b <= top; b++) for (let c = 0; c < cnt[b]; c++) y[k++] = val[b];
}

/**
 * Sorted pair order by dissimilarity (then pair index, for determinism), and the
 * tie blocks [start, end) of exactly equal dissimilarities within that order.
 */
interface PairOrder {
  order: Int32Array;
  blocks: Int32Array; // flattened start,end pairs for blocks of size > 1
}

function pairOrder(dissim: ArrayLike<number>): PairOrder {
  const m = dissim.length;
  const idx = Array.from({ length: m }, (_, i) => i);
  idx.sort((a, b) => dissim[a] - dissim[b] || a - b);
  const blocks: number[] = [];
  let s = 0;
  for (let i = 1; i <= m; i++) {
    if (i === m || dissim[idx[i]] !== dissim[idx[s]]) {
      if (i - s > 1) blocks.push(s, i);
      s = i;
    }
  }
  return { order: Int32Array.from(idx), blocks: Int32Array.from(blocks) };
}

/**
 * Primary-approach isotonic fit using a precomputed dissimilarity order: within
 * each tie block, order pairs by current distance (then pair index), then PAV.
 */
function isotonicWithOrder(po: PairOrder, d: ArrayLike<number>, out: Float64Array): Float64Array {
  const ord = Int32Array.from(po.order);
  const { blocks } = po;
  for (let b = 0; b < blocks.length; b += 2) {
    const seg = Array.from(ord.subarray(blocks[b], blocks[b + 1]));
    seg.sort((x, y) => d[x] - d[y] || x - y);
    ord.set(seg, blocks[b]);
  }
  const y = new Float64Array(ord.length);
  for (let i = 0; i < ord.length; i++) y[i] = d[ord[i]];
  pava(y);
  for (let i = 0; i < ord.length; i++) out[ord[i]] = y[i];
  return out;
}

/**
 * Least-squares fit to `d` that is non-decreasing in `dissim` (Kruskal primary
 * approach to ties: exactly tied dissimilarities may get different fitted values;
 * ties are resolved by ordering on `d`, which is optimal). Returns disparities in
 * the input order.
 */
export function isotonicPrimary(dissim: ArrayLike<number>, d: ArrayLike<number>): Float64Array {
  if (dissim.length !== d.length) throw new Error('isotonicPrimary: dissim and d differ in length');
  return isotonicWithOrder(pairOrder(dissim), d, new Float64Array(d.length));
}

function stressFrom(d: ArrayLike<number>, dhat: ArrayLike<number>): number {
  let num = 0;
  let den = 0;
  for (let p = 0; p < d.length; p++) {
    const e = d[p] - dhat[p];
    num += e * e;
    den += d[p] * d[p];
  }
  return den > 0 ? Math.sqrt(num / den) : NaN;
}

/**
 * Kruskal Stress-1 of a 2D configuration (`coords` interleaved, length 2n)
 * against an n×n row-major dissimilarity matrix (upper triangle used):
 * sqrt( Σ_{i<j} (d_ij − d̂_ij)² / Σ_{i<j} d_ij² ), d̂ = `isotonicPrimary`.
 * Returns NaN when the configuration is collapsed (Σ d² = 0, Stress-1 undefined)
 * or n < 2 (no pairs). Distances and disparities are returned in pair order.
 */
export function kruskalStress1(
  dist: ArrayLike<number>,
  coords: ArrayLike<number>,
  n: number,
): { stress1: number; disparities: Float64Array; distances: Float64Array } {
  if (dist.length !== n * n) throw new Error(`kruskalStress1: dist must have ${n * n} entries`);
  if (coords.length !== 2 * n) throw new Error(`kruskalStress1: coords must have ${2 * n} entries`);
  const dissim = upperPairs(dist, n);
  const distances = configDistances(coords, n, new Float64Array(dissim.length));
  const disparities = isotonicPrimary(dissim, distances);
  return { stress1: stressFrom(distances, disparities), disparities, distances };
}

/**
 * Eigen-decomposition of a symmetric n×n matrix (row-major, copied) by cyclic
 * Jacobi rotations. Returns eigenvalues and column eigenvectors (row-major n×n).
 */
function jacobiEigen(src: ArrayLike<number>, n: number): { values: Float64Array; vectors: Float64Array } {
  const a = Float64Array.from(src as ArrayLike<number>);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  let total = 0;
  for (let i = 0; i < n * n; i++) total += a[i] * a[i];
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
    if (off <= 1e-30 * total || off === 0) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (apq === 0) continue;
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p];
          const akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k];
          const aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p];
          const vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = a[i * n + i];
  return { values, vectors: v };
}

/**
 * Classical (Torgerson) MDS start: top-2 eigenvectors of −½ J D² J scaled by
 * sqrt(max(λ, 0)). If the second dimension is (numerically) empty, it is
 * replaced by a small centred x² term, then PRNG jitter, so SMACOF is not
 * trapped in a 1D subspace (a Guttman update never leaves it).
 */
function classicalStart(dissim: Float64Array, n: number, seed: number): Float64Array {
  const b = new Float64Array(n * n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = dissim[p++];
      b[i * n + j] = b[j * n + i] = -0.5 * s * s;
    }
  }
  const rowMean = new Float64Array(n);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += b[i * n + j];
    rowMean[i] = s / n;
    grand += s;
  }
  grand /= n * n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) b[i * n + j] += grand - rowMean[i] - rowMean[j];
  const { values, vectors } = jacobiEigen(b, n);
  const idx = Array.from({ length: n }, (_, i) => i).sort((x, y) => values[y] - values[x] || x - y);
  const x = new Float64Array(2 * n);
  for (let c = 0; c < 2; c++) {
    const k = idx[c];
    const scale = Math.sqrt(Math.max(values[k], 0));
    for (let i = 0; i < n; i++) x[2 * i + c] = vectors[i * n + k] * scale;
  }
  const varOf = (c: number): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[2 * i + c] * x[2 * i + c];
    return s;
  };
  const v0 = varOf(0);
  if (varOf(1) <= 1e-12 * v0) {
    let m = 0;
    for (let i = 0; i < n; i++) m += x[2 * i] * x[2 * i];
    m /= n;
    for (let i = 0; i < n; i++) x[2 * i + 1] = x[2 * i] * x[2 * i] - m;
    const v1 = varOf(1);
    if (v1 <= 1e-12 * v0) {
      const rnd = mulberry32(seed ^ 0x9e3779b9);
      for (let i = 0; i < n; i++) x[2 * i + 1] = rnd() - 0.5;
    }
    const f = 0.05 * Math.sqrt(v0 / varOf(1));
    for (let i = 0; i < n; i++) x[2 * i + 1] *= f;
  }
  return x;
}

function centre(x: Float64Array, n: number): void {
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[2 * i];
    my += x[2 * i + 1];
  }
  mx /= n;
  my /= n;
  for (let i = 0; i < n; i++) {
    x[2 * i] -= mx;
    x[2 * i + 1] -= my;
  }
}

/**
 * Canonical pose, for reproducibility only (axes and signs carry no meaning):
 * 1. centre at the origin;
 * 2. rotate so x is the major and y the minor principal axis of the configuration;
 * 3. flip each axis so that Σ coord³ ≥ 0 (left unchanged when |Σ coord³| is
 *    negligible, i.e. for symmetric configurations the sign is unspecified);
 * 4. scale so the mean squared inter-point distance over pairs i < j is 1.
 * All four rules depend only on the point set, not on input order.
 * Collapsed configurations are left at the origin. `rotate = false` skips step 2.
 */
function canonicalPose(x: Float64Array, n: number, rotate = true): void {
  if (n === 0) return;
  centre(x, n);
  if (rotate) {
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += x[2 * i] * x[2 * i];
      syy += x[2 * i + 1] * x[2 * i + 1];
      sxy += x[2 * i] * x[2 * i + 1];
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (let i = 0; i < n; i++) {
      const a = x[2 * i];
      const b = x[2 * i + 1];
      x[2 * i] = c * a + s * b;
      x[2 * i + 1] = -s * a + c * b;
    }
  }
  let ss = 0;
  for (let i = 0; i < 2 * n; i++) ss += x[i] * x[i];
  if (n < 2 || ss === 0) {
    x.fill(0);
    return;
  }
  // Mean squared inter-point distance of a centred configuration = 2n Σ|x|² / (n(n−1)).
  const msd = (2 * ss) / (n - 1);
  const f = 1 / Math.sqrt(msd);
  const rms = Math.sqrt(ss / n);
  for (let c = 0; c < 2; c++) {
    let cubes = 0;
    for (let i = 0; i < n; i++) cubes += x[2 * i + c] ** 3;
    const sign = cubes < -1e-9 * n * rms ** 3 ? -1 : 1;
    for (let i = 0; i < n; i++) x[2 * i + c] *= sign * f;
  }
  for (let i = 0; i < 2 * n; i++) if (x[i] === 0) x[i] = 0; // normalise −0
}

// ---------------------------------------------------------------------------
// SMACOF (nonmetric with primary isotonic regression, or metric/ratio)
// ---------------------------------------------------------------------------

/** Writes the disparities for current distances `d` into `out` (pair order). */
type DisparityFit = (d: Float64Array, out: Float64Array) => void;

const isotonicFit =
  (po: PairOrder): DisparityFit =>
  (d, out) => {
    isotonicWithOrder(po, d, out);
  };

/** Ratio (metric) disparities b·δ with the least-squares scalar b = Σ dδ / Σ δ². */
function ratioDisparities(dissim: Float64Array, d: ArrayLike<number>, out: Float64Array): Float64Array {
  let num = 0;
  let den = 0;
  for (let p = 0; p < dissim.length; p++) {
    num += d[p] * dissim[p];
    den += dissim[p] * dissim[p];
  }
  const b = den > 0 ? num / den : 0;
  for (let p = 0; p < dissim.length; p++) out[p] = b * dissim[p];
  return out;
}

const ratioFit =
  (dissim: Float64Array): DisparityFit =>
  (d, out) => {
    ratioDisparities(dissim, d, out);
  };

interface StartFit {
  x: Float64Array;
  stress1: number;
  iterations: number;
  converged: boolean;
}

/**
 * SMACOF from one start. Each iteration: disparities (primary isotonic fit of the
 * current distances for NMDS; b·δ for the metric/ratio fit), normalised to Σ d̂² = n(n−1)/2, then the
 * unit-weight Guttman transform X ← (1/n) B(X) X with b_ij = −d̂_ij/d_ij
 * (0 when d_ij = 0). Stops when the relative Stress-1 decrease < tol or
 * Stress-1 < 1e-12; if an update increases Stress-1 the previous configuration is kept.
 */
function smacof(x0: Float64Array, n: number, fit: DisparityFit, maxIter: number, tol: number): StartFit {
  const m = (n * (n - 1)) / 2;
  let x = Float64Array.from(x0);
  centre(x, n);
  const d = configDistances(x, n, new Float64Array(m));
  const dhat = new Float64Array(m);
  fit(d, dhat);
  let s = stressFrom(d, dhat);
  if (!Number.isFinite(s)) return { x, stress1: NaN, iterations: 0, converged: false };
  if (s < 1e-12) return { x, stress1: s, iterations: 0, converged: true };
  const xn = new Float64Array(2 * n);
  for (let it = 1; it <= maxIter; it++) {
    let sumsq = 0;
    for (let p = 0; p < m; p++) sumsq += dhat[p] * dhat[p];
    const norm = Math.sqrt(m / sumsq);
    xn.fill(0);
    let p = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++, p++) {
        if (d[p] <= 0) continue;
        const r = (dhat[p] * norm) / d[p];
        const dx = r * (x[2 * i] - x[2 * j]);
        const dy = r * (x[2 * i + 1] - x[2 * j + 1]);
        xn[2 * i] += dx;
        xn[2 * i + 1] += dy;
        xn[2 * j] -= dx;
        xn[2 * j + 1] -= dy;
      }
    }
    for (let k = 0; k < 2 * n; k++) xn[k] /= n;
    configDistances(xn, n, d);
    fit(d, dhat);
    const sNew = stressFrom(d, dhat);
    if (!(sNew <= s)) {
      // Increase (or collapse): keep the previous configuration and stop.
      return { x, stress1: s, iterations: it, converged: true };
    }
    const done = sNew < 1e-12 || (s - sNew) / s < tol;
    x = Float64Array.from(xn);
    s = sNew;
    if (done) return { x, stress1: s, iterations: it, converged: true };
  }
  return { x, stress1: s, iterations: maxIter, converged: false };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function validate(dist: ArrayLike<number>, ids: readonly string[]): number {
  const n = ids.length;
  if (dist.length !== n * n) {
    throw new Error(`nmds: dist has ${dist.length} entries; expected ${n}×${n} = ${n * n} for ${n} ids`);
  }
  if (new Set(ids).size !== n) throw new Error('nmds: ids must be unique');
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = dist[i * n + j];
      if (!Number.isFinite(v)) throw new Error(`nmds: dist[${i},${j}] is not finite (${v})`);
      if (v < 0) throw new Error(`nmds: dist[${i},${j}] is negative (${v})`);
      if (i === j && Math.abs(v) > 1e-12) throw new Error(`nmds: diagonal dist[${i},${i}] is not zero (${v})`);
      if (j > i && Math.abs(v - dist[j * n + i]) > 1e-12) {
        throw new Error(`nmds: dist is not symmetric at [${i},${j}] (${v} vs ${dist[j * n + i]})`);
      }
    }
  }
  return n;
}

function checkOptions(o: Required<Omit<NmdsOptions, 'init'>>): void {
  if (!Number.isInteger(o.restarts) || o.restarts < 0) throw new Error('nmds: restarts must be an integer ≥ 0');
  if (!Number.isInteger(o.seed)) throw new Error('nmds: seed must be an integer');
  if (!Number.isInteger(o.maxIter) || o.maxIter < 1) throw new Error('nmds: maxIter must be an integer ≥ 1');
  if (!(o.tol >= 0) || !Number.isFinite(o.tol)) throw new Error('nmds: tol must be a finite number ≥ 0');
}

/**
 * Exact metric triangle for three dissimilarities (a = d01, b = d02, c = d12;
 * the inequality is checked with a 1e-9 relative roundoff tolerance), or, when
 * they violate the triangle inequality, a triangle with side lengths
 * 1 + dense rank (2, 3, 4 or with ties equal), which always closes and keeps
 * the rank order of the dissimilarities.
 */
function triangle(a: number, b: number, c: number): Float64Array {
  const sorted = [a, b, c].sort((u, v) => u - v);
  // Roundoff tolerance: an exact-pattern pair (d = 0) with a third member whose two
  // dissimilarities differ only by float noise is a (degenerate) metric triangle.
  const metric = sorted[2] <= sorted[0] + sorted[1] + 1e-9 * Math.max(1, sorted[2]);
  if (!metric) {
    const distinct = Array.from(new Set(sorted));
    const len = (v: number): number => 2 + distinct.indexOf(v);
    [a, b, c] = [len(a), len(b), len(c)];
  }
  // P0 = (0,0), P1 = (a,0), P2 from |P0P2| = b, |P1P2| = c.
  const x = new Float64Array(6);
  x[2] = a;
  if (a > 0) {
    const px = (a * a + b * b - c * c) / (2 * a);
    x[4] = px;
    x[5] = Math.sqrt(Math.max(b * b - px * px, 0));
  } else {
    x[4] = b; // P0 and P1 coincide; then b === c for a metric triangle
  }
  return x;
}

type Params = EmbeddingResult['params'];

interface Prepared {
  n: number;
  o: Required<Omit<NmdsOptions, 'init'>>;
  params: Params;
  dissim: Float64Array;
  /** Validated warm-start configuration, or null for the classical start. */
  init: Float64Array | null;
}

/** Copy and check a warm-start configuration: length 2n, finite, not all coincident. */
function checkInit(init: ArrayLike<number>, n: number): Float64Array {
  if (init.length !== 2 * n) throw new Error(`nmds: init has ${init.length} entries; expected 2n = ${2 * n}`);
  const x = Float64Array.from(init);
  for (let k = 0; k < x.length; k++) {
    if (!Number.isFinite(x[k])) throw new Error(`nmds: init[${k}] is not finite (${x[k]})`);
  }
  if (n >= 2) {
    let spread = false;
    for (let i = 1; i < n && !spread; i++) spread = x[2 * i] !== x[0] || x[2 * i + 1] !== x[1];
    if (!spread) throw new Error('nmds: init places every member at the same point');
  }
  return x;
}

function prepare(dist: ArrayLike<number>, ids: readonly string[], opts: NmdsOptions): Prepared {
  const n = validate(dist, ids);
  const o: Required<Omit<NmdsOptions, 'init'>> = {
    restarts: opts.restarts ?? DEFAULTS.restarts,
    seed: opts.seed ?? DEFAULTS.seed,
    maxIter: opts.maxIter ?? DEFAULTS.maxIter,
    tol: opts.tol ?? DEFAULTS.tol,
  };
  checkOptions(o);
  const init = opts.init === undefined ? null : checkInit(opts.init, n);
  const params: Params = init
    ? { ...o, ties: 'primary', stress: 'kruskal-1', init: 'given+random', warmStart: true }
    : { ...o, ties: 'primary', stress: 'kruskal-1', init: 'classical+random' };
  return { n, o, params, dissim: upperPairs(dist, n), init };
}

type Extra = Partial<Pick<EmbeddingResult, 'converged' | 'iterations' | 'starts' | 'bestHits' | 'nmdsStress1' | 'degenerate'>>;

/**
 * Assemble a result: distances of `coords`, disparities of the returned method
 * (primary isotonic, or ratio b·δ when `metric`), and the Stress-1 against them.
 */
function result(
  p: Prepared,
  ids: readonly string[],
  coords: Float64Array,
  method: EmbeddingResult['method'],
  status: EmbeddingStatus,
  message: string,
  extra: Extra = {},
): EmbeddingResult {
  const { n, dissim } = p;
  const distance = configDistances(coords, n, new Float64Array(dissim.length));
  const disparity =
    method === 'metric-smacof'
      ? ratioDisparities(dissim, distance, new Float64Array(dissim.length))
      : isotonicPrimary(dissim, distance);
  let stress1 = stressFrom(distance, disparity);
  // Coincident configurations have undefined Stress-1; they fit all-zero dissimilarities exactly.
  if (n >= 2 && Number.isNaN(stress1) && status === 'all-coincident') stress1 = 0;
  return {
    method,
    solver: NMDS_SOLVER,
    params: p.params,
    n,
    ids: ids.slice(),
    coords,
    stress1,
    nmdsStress1: extra.nmdsStress1 ?? null,
    degenerate: extra.degenerate ?? null,
    status,
    converged: extra.converged ?? true,
    iterations: extra.iterations ?? 0,
    starts: extra.starts ?? [],
    bestHits: extra.bestHits ?? 0,
    pairs: { dissimilarity: dissim, distance, disparity },
    message,
  };
}

/** n = 0, n = 1 and all-zero dissimilarities: identical for every method. */
function trivial(p: Prepared, ids: readonly string[]): EmbeddingResult | null {
  const { n, dissim } = p;
  if (n === 0) return result(p, ids, new Float64Array(0), 'none', 'empty', 'No members: nothing to embed.');
  if (n === 1) {
    return result(p, ids, new Float64Array(2), 'exact', 'exact-small-n',
      'One member: placed at the origin; Stress-1 is undefined for fewer than two members.');
  }
  if (dissim.every((v) => v === 0)) {
    return result(p, ids, new Float64Array(2 * n), 'exact', 'all-coincident',
      'All dissimilarities are 0: every member has the same pattern, so all positions coincide at the origin.');
  }
  return null;
}

interface MultiStart {
  win: StartFit;
  starts: NmdsStart[];
  bestHits: number;
  where: string;
}

/**
 * Classical start (or the caller's warm start in its place), then `restarts`
 * uniform random starts in [−1, 1]² seeded seed, seed+1, …; lowest Stress-1
 * wins, ties broken by start order.
 */
function multiStart(p: Prepared, fit: DisparityFit): MultiStart {
  const { n, o, dissim } = p;
  const starts: NmdsStart[] = [];
  let best: StartFit | null = null;
  let bestIdx = -1;
  const consider = (f: StartFit, info: Omit<NmdsStart, 'stress1' | 'iterations' | 'converged'>): void => {
    starts.push({ ...info, stress1: f.stress1, iterations: f.iterations, converged: f.converged });
    if (Number.isFinite(f.stress1) && (best === null || f.stress1 < best.stress1)) {
      best = f;
      bestIdx = starts.length - 1;
    }
  };
  if (p.init) consider(smacof(p.init, n, fit, o.maxIter, o.tol), { init: 'given' });
  else consider(smacof(classicalStart(dissim, n, o.seed), n, fit, o.maxIter, o.tol), { init: 'classical' });
  for (let r = 0; r < o.restarts; r++) {
    const seed = o.seed + r;
    const rnd = mulberry32(seed);
    const x = new Float64Array(2 * n);
    for (let k = 0; k < 2 * n; k++) x[k] = 2 * rnd() - 1;
    consider(smacof(x, n, fit, o.maxIter, o.tol), { init: 'random', seed });
  }
  if (best === null) throw new Error('nmds: every start produced a collapsed configuration');
  const win: StartFit = best;
  const thr = Math.max(1e-6, 1e-4 * win.stress1);
  const bestHits = starts.filter((s) => Number.isFinite(s.stress1) && s.stress1 - win.stress1 <= thr).length;
  const w = starts[bestIdx];
  const where =
    w.init === 'classical' ? 'the classical-MDS start' : w.init === 'given' ? 'the given warm start' : `random start seed ${w.seed}`;
  return { win, starts, bestHits, where };
}

/** Thresholds of the degeneracy rule (see `nmds`). */
const DEGENERACY = { stress: 1e-4, collapse: 1e-3, zero: 1e-9 } as const;
const DEGENERACY_RULE =
  `Stress-1 < ${DEGENERACY.stress} and at least one pair with dissimilarity > ${DEGENERACY.zero} × max dissimilarity ` +
  `lies closer than ${DEGENERACY.collapse} × the RMS inter-point distance`;

/** Count of distinct-member pairs (δ above the zero tolerance) collapsed in `coords`. */
function collapsedPairs(dissim: Float64Array, coords: Float64Array, n: number): number {
  const d = configDistances(coords, n, new Float64Array(dissim.length));
  let ss = 0;
  let dmax = 0;
  for (let q = 0; q < d.length; q++) {
    ss += d[q] * d[q];
    dmax = Math.max(dmax, dissim[q]);
  }
  const rms = Math.sqrt(ss / d.length);
  let count = 0;
  for (let q = 0; q < d.length; q++) {
    if (dissim[q] > DEGENERACY.zero * dmax && d[q] < DEGENERACY.collapse * rms) count++;
  }
  return count;
}

/**
 * Two-dimensional nonmetric MDS of an n×n row-major dissimilarity matrix
 * (symmetric within 1e-12, zero diagonal, finite, non-negative; throws otherwise).
 *
 * Fit: nonmetric SMACOF (see `smacof`) with Kruskal's primary tie approach, from
 * the classical (Torgerson) MDS start (or `opts.init`, a warm start that replaces
 * it; exact small-n and all-tied cases ignore it) and then `restarts` random uniform starts
 * seeded seed, seed+1, …; the start with lowest Stress-1 wins (ties broken by
 * start order). The winning configuration is put in canonical pose.
 *
 * Degeneracy: when every within-group dissimilarity is smaller than every
 * between-group one, a perfect ordinal fit exists with each group collapsed to a
 * point, which is useless for display. The winning NMDS configuration (n ≥ 4) is
 * declared degenerate when its Stress-1 < 1e-4 AND at least one pair with
 * dissimilarity > 1e-9 × max dissimilarity (i.e. not a numerically exact
 * duplicate) lies closer than 1e-3 × the RMS inter-point distance. Exact
 * duplicates (δ = 0) may coincide without triggering it. Partial collapse with
 * Stress-1 ≥ 1e-4 is not detected. A degenerate fit is replaced by `metricSmacof`
 * (method 'metric-smacof', status 'degenerate-fallback'); `stress1` and
 * `pairs.disparity` then refer to the metric fit and `nmdsStress1` keeps the
 * NMDS winner's Stress-1.
 *
 * Degenerate inputs are explicit and never labelled 'nmds':
 * n = 0 'empty'; n = 1, 2, 3 'exact-small-n' (NMDS is not identifiable);
 * all dissimilarities 0 'all-coincident'; n ≥ 4 with all off-diagonal values
 * equal and > 0 'all-tied' (regular polygon in input order).
 */
export function nmds(dist: ArrayLike<number>, ids: readonly string[], opts: NmdsOptions = {}): EmbeddingResult {
  const p = prepare(dist, ids, opts);
  const { n, o, dissim } = p;
  const t = trivial(p, ids);
  if (t) return t;
  if (n === 2) {
    return result(p, ids, Float64Array.from([-0.5, 0, 0.5, 0]), 'exact', 'exact-small-n',
      'Two members: placed on the x axis at unit distance. NMDS is not identifiable for n ≤ 3; only the rank order of dissimilarities is represented.');
  }
  if (n === 3) {
    const x = triangle(dissim[0], dissim[1], dissim[2]);
    canonicalPose(x, n);
    return result(p, ids, x, 'exact', 'exact-small-n',
      'Three members: drawn as a triangle whose side lengths follow the rank order of the dissimilarities (exact metric triangle when the triangle inequality holds). NMDS is not identifiable for n ≤ 3.');
  }
  if (dissim.every((v) => v === dissim[0])) {
    const x = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      x[2 * i] = Math.cos(a);
      x[2 * i + 1] = Math.sin(a);
    }
    canonicalPose(x, n, false);
    return result(p, ids, x, 'exact', 'all-tied',
      'All dissimilarities are equal: members are drawn on a regular polygon in input order, and their positions carry no information.');
  }

  const { win, starts, bestHits, where } = multiStart(p, isotonicFit(pairOrder(dissim)));
  const coords = Float64Array.from(win.x);
  canonicalPose(coords, n);

  const collapsed = win.stress1 < DEGENERACY.stress ? collapsedPairs(dissim, coords, n) : 0;
  if (collapsed > 0) {
    const m = multiStart(p, ratioFit(dissim));
    const mc = Float64Array.from(m.win.x);
    canonicalPose(mc, n);
    return result(p, ids, mc, 'metric-smacof', 'degenerate-fallback',
      `The nonmetric fit is degenerate: it collapsed groups of members onto single points (Stress-1 ≈ ${win.stress1.toExponential(1)}, ` +
        `${collapsed} pairs of distinct members coincide), because rank order alone cannot place members within well-separated groups. ` +
        `A metric (ratio) SMACOF fit of the dissimilarities is shown instead; its Stress-1 is against b·δ.` +
        (m.win.converged ? '' : ` The metric fit stopped at maxIter = ${o.maxIter} without meeting tol.`),
      {
        converged: m.win.converged,
        iterations: m.win.iterations,
        starts: m.starts,
        bestHits: m.bestHits,
        nmdsStress1: win.stress1,
        degenerate: { collapsedPairs: collapsed, rule: DEGENERACY_RULE },
      });
  }

  const status: EmbeddingStatus = win.converged ? 'converged' : 'max-iterations';
  const message = win.converged
    ? `NMDS converged in ${win.iterations} iterations from ${where}; ${bestHits} of ${starts.length} starts reached the best Stress-1.`
    : `NMDS stopped at maxIter = ${o.maxIter} without meeting tol from ${where}; the best configuration found is shown.`;
  const out = result(p, ids, coords, 'nmds', status, message, {
    converged: win.converged,
    iterations: win.iterations,
    starts,
    bestHits,
  });
  out.nmdsStress1 = out.stress1; // identical by definition (pose does not change Stress-1 beyond rounding)
  return out;
}

/**
 * Metric (ratio) SMACOF: the same Guttman iterations, starts and canonical pose
 * as `nmds`, but with disparities b·δ (δ the dissimilarities, b the
 * least-squares scalar), so 2D distances are fitted proportionally to δ.
 * `stress1` = sqrt( Σ (d − b·δ)² / Σ d² ) and `pairs.disparity` = b·δ.
 * Method 'metric-smacof', status 'converged' / 'max-iterations' (trivial inputs:
 * 'empty', 'exact-small-n' for n = 1, 'all-coincident').
 */
export function metricSmacof(dist: ArrayLike<number>, ids: readonly string[], opts: NmdsOptions = {}): EmbeddingResult {
  const p = prepare(dist, ids, opts);
  const t = trivial(p, ids);
  if (t) return t;
  const { win, starts, bestHits, where } = multiStart(p, ratioFit(p.dissim));
  const coords = Float64Array.from(win.x);
  canonicalPose(coords, p.n);
  const message = win.converged
    ? `Metric SMACOF converged in ${win.iterations} iterations from ${where}; ${bestHits} of ${starts.length} starts reached the best Stress-1.`
    : `Metric SMACOF stopped at maxIter = ${p.o.maxIter} without meeting tol from ${where}; the best configuration found is shown.`;
  return result(p, ids, coords, 'metric-smacof', win.converged ? 'converged' : 'max-iterations', message, {
    converged: win.converged,
    iterations: win.iterations,
    starts,
    bestHits,
  });
}

// ---------------------------------------------------------------------------
// Neighbourhood diagnostics
// ---------------------------------------------------------------------------

/** Tie-inclusive k-neighbourhood of i given a distance accessor. */
/**
 * Dissimilarities closer than this are ties. Maps with an identical spatial pattern
 * (r = 1, e.g. y = 2x + 0.5 stored in float32) have correlations with third maps
 * that differ only by float roundoff (~1e-10); they must rank together.
 */
export const DISSIMILARITY_TIE_TOL = 1e-9;

function kNeighbourhood(n: number, i: number, k: number, get: (j: number) => number, tol = 0): Set<number> {
  const vals: number[] = [];
  for (let j = 0; j < n; j++) if (j !== i) vals.push(get(j));
  vals.sort((a, b) => a - b);
  const thr = vals[k - 1] + tol;
  const out = new Set<number>();
  for (let j = 0; j < n; j++) if (j !== i && get(j) <= thr) out.add(j);
  return out;
}

/**
 * Neighbour preservation of a 2D embedding. For point i, N_src(i) = { j ≠ i :
 * dist_ij ≤ the k-th smallest dist_i· + DISSIMILARITY_TIE_TOL } (tie-inclusive), N_emb(i) likewise on the
 * embedding's Euclidean distances (exact float comparison), and
 * perPoint_i = |N_src ∩ N_emb| / |N_src|. k defaults to min(3, n − 1). When
 * k ≥ n − 1 every neighbourhood is "everyone", so values are NaN (uninformative).
 */
export function neighborPreservation(
  dist: ArrayLike<number>,
  coords: ArrayLike<number>,
  n: number,
  k?: number,
): { k: number; perPoint: Float64Array; mean: number; definition: string } {
  if (dist.length !== n * n) throw new Error(`neighborPreservation: dist must have ${n * n} entries`);
  if (coords.length !== 2 * n) throw new Error(`neighborPreservation: coords must have ${2 * n} entries`);
  const kk = k ?? Math.max(0, Math.min(3, n - 1));
  if (k !== undefined && (!Number.isInteger(k) || k < 1)) throw new Error('neighborPreservation: k must be an integer ≥ 1');
  const perPoint = new Float64Array(n);
  if (n - 1 <= kk) {
    perPoint.fill(NaN);
    return {
      k: kk,
      perPoint,
      mean: NaN,
      definition: `Not informative: with ${n} members and k = ${kk}, every neighbourhood contains all other members, so preservation is undefined (NaN).`,
    };
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const src = kNeighbourhood(n, i, kk, (j) => dist[i * n + j], DISSIMILARITY_TIE_TOL);
    const emb = kNeighbourhood(n, i, kk, (j) => Math.hypot(coords[2 * i] - coords[2 * j], coords[2 * i + 1] - coords[2 * j + 1]));
    let hit = 0;
    for (const j of src) if (emb.has(j)) hit++;
    perPoint[i] = hit / src.size;
    sum += perPoint[i];
  }
  return {
    k: kk,
    perPoint,
    mean: sum / n,
    definition: `Fraction of each member's ${kk} nearest neighbours by dissimilarity (ties at the boundary included) that are also among its ${kk} nearest neighbours in the 2D layout (ties included).`,
  };
}

/**
 * The k nearest members to i by dissimilarity (excluding i), including every
 * member tied with the k-th, sorted by dissimilarity then index; `rank` is the
 * competition rank (1, 2, 2, 4). Dissimilarities within DISSIMILARITY_TIE_TOL of
 * the first member of a tie block count as tied.
 */
export function sourceNeighbors(
  dist: ArrayLike<number>,
  n: number,
  i: number,
  k: number,
): { index: number; dissimilarity: number; rank: number }[] {
  if (dist.length !== n * n) throw new Error(`sourceNeighbors: dist must have ${n * n} entries`);
  if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`sourceNeighbors: index ${i} out of range`);
  if (!Number.isInteger(k) || k < 1) throw new Error('sourceNeighbors: k must be an integer ≥ 1');
  const all: { index: number; dissimilarity: number; rank: number }[] = [];
  for (let j = 0; j < n; j++) if (j !== i) all.push({ index: j, dissimilarity: dist[i * n + j], rank: 0 });
  all.sort((a, b) => a.dissimilarity - b.dissimilarity || a.index - b.index);
  if (all.length === 0) return [];
  const thr = all[Math.min(k, all.length) - 1].dissimilarity + DISSIMILARITY_TIE_TOL;
  const out = all.filter((e) => e.dissimilarity <= thr);
  // Ties within roundoff share a rank; compare with the first member of the tie block so ties never chain.
  let head = 0;
  for (let r = 0; r < out.length; r++) {
    if (r > 0 && out[r].dissimilarity - out[head].dissimilarity <= DISSIMILARITY_TIE_TOL) out[r].rank = out[head].rank;
    else {
      head = r;
      out[r].rank = r + 1;
    }
  }
  return out;
}
