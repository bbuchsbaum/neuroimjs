/**
 * Space v3 numerical core: exact decompositions of the similarity basis, noise
 * reliability, parcel summaries, leave-one-parcel-out influence, effect
 * heterogeneity and envfit-style covariate fits on a layout.
 *
 * Notation (docs/plans/volume-set-space-v3.md). k maps (the basis-eligible
 * members) on a support S of N positions into the masked vectors. zᵢ is map i
 * standardised on S with its mean and *population* SD, so Σ_S zᵢ = 0 and
 * Σ_S zᵢ² = N. Then
 *
 *   rᵢⱼ = (1/N)·Σᵥ zᵢzⱼ   and   dᵢⱼ = 1 − rᵢⱼ = (1/2N)·Σᵥ (zᵢ − zⱼ)².
 *
 * Every per-voxel output is a Float64Array of length N in support order, and is
 * accumulated in float64. Each decomposition below states the quantity its terms
 * sum to; the identities are exact up to float64 roundoff and are unit-tested
 * against an independent Pearson. They are descriptive: no term is a test.
 *
 * Browser- and worker-safe; no dependencies.
 */

/** Standardised maps (length N each, support order). Float64 keeps the identities exact. */
export type ZMaps = readonly ArrayLike<number>[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** mulberry32: small, well-mixed 32-bit PRNG returning values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkZ(z: ZMaps, min = 1): number {
  if (z.length < min) throw new Error(`at least ${min} map(s) required, got ${z.length}`);
  const N = z[0].length;
  if (N === 0) throw new Error('empty support');
  for (const m of z) if (m.length !== N) throw new Error('standardised maps differ in length');
  return N;
}

/** Per-voxel mean and population variance over the maps in `idx` (two-pass). */
function voxelMoments(z: ZMaps, idx: readonly number[], N: number): { mean: Float64Array; vari: Float64Array } {
  const mean = new Float64Array(N);
  const vari = new Float64Array(N);
  const n = idx.length;
  for (const i of idx) {
    const zi = z[i];
    for (let v = 0; v < N; v++) mean[v] += zi[v];
  }
  for (let v = 0; v < N; v++) mean[v] /= n;
  for (const i of idx) {
    const zi = z[i];
    for (let v = 0; v < N; v++) {
      const e = zi[v] - mean[v];
      vari[v] += e * e;
    }
  }
  for (let v = 0; v < N; v++) vari[v] /= n;
  return { mean, vari };
}

function median(xs: ArrayLike<number>): number {
  const s = Float64Array.from(xs).sort();
  const n = s.length;
  if (!n) return NaN;
  const h = n >> 1;
  return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Pearson r of two equal-length sequences (two-pass, float64); NaN if either is constant. */
function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let t = 0; t < n; t++) {
    ma += a[t];
    mb += b[t];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let t = 0; t < n; t++) {
    const x = a[t] - ma;
    const y = b[t] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
}

// ---------------------------------------------------------------------------
// 1–4. Standardisation and exact decompositions
// ---------------------------------------------------------------------------

/**
 * zᵢ for each listed member on the support: (x − mean_S) / sd_S with the
 * population SD (divisor N), so Σ zᵢ² = N. Returned as Float64Array (not
 * Float32) because float32 rounding of z breaks Σ zᵢ² = N at ~1e-7, and with it
 * the exact identities below. Throws on a non-finite value, an invalid position
 * or a constant map.
 */
export function standardize(data: readonly Float32Array[], members: readonly number[], support: ArrayLike<number>): Float64Array[] {
  const N = support.length;
  if (N === 0) throw new Error('standardize: empty support');
  return members.map((m) => {
    const d = data[m];
    if (!d) throw new Error(`standardize: member ${m} does not exist`);
    let s = 0;
    for (let t = 0; t < N; t++) {
      const x = d[support[t]];
      if (!Number.isFinite(x)) throw new Error(`standardize: member ${m} is not finite at support position ${support[t]}`);
      s += x;
    }
    const mean = s / N;
    let ss = 0;
    for (let t = 0; t < N; t++) {
      const e = d[support[t]] - mean;
      ss += e * e;
    }
    const sd = Math.sqrt(ss / N);
    if (!(sd > 1e-12 * Math.max(1, Math.abs(mean)))) throw new Error(`standardize: member ${m} is constant on the support`);
    const z = new Float64Array(N);
    for (let t = 0; t < N; t++) z[t] = (d[support[t]] - mean) / sd;
    return z;
  });
}

/**
 * Dispersion D(v) = (1/2N)·Σᵢ<ⱼ (zᵢ(v) − zⱼ(v))² = (k/2N)·Σᵢ (zᵢ(v) − z̄(v))².
 * Identity: Σᵥ D(v) = Σᵢ<ⱼ dᵢⱼ (the total dissimilarity of the set).
 */
export function dispersionTerms(z: ZMaps): Float64Array {
  const N = checkZ(z, 1);
  const k = z.length;
  const { vari } = voxelMoments(z, [...Array(k).keys()], N);
  const c = (k * k) / (2 * N); // (k/2N)·Σᵢ(zᵢ − z̄)² = (k/2N)·k·s²
  const D = new Float64Array(N);
  for (let v = 0; v < N; v++) D[v] = c * vari[v];
  return D;
}

export interface FocusedTerms {
  /** zᵢ − z̄₋ᵢ: where map i sits above (+) or below (−) the mean of the others. */
  signed: Float64Array;
  /** (1/2N)·(zᵢ − z̄₋ᵢ)²: map i's own departure from the others' mean. */
  own: Float64Array;
  /** (1/2N)·s²₋ᵢ(v): population variance of the other k − 1 maps (0 when k = 2). */
  baseline: Float64Array;
}

/**
 * Terms for one focused map i, from mean_{j≠i}(zᵢ − zⱼ)² = (zᵢ − z̄₋ᵢ)² + s²₋ᵢ.
 * Identity: Σᵥ (own + baseline) = mean_{j≠i} dᵢⱼ. With k = 2 the baseline is 0
 * and Σ own = d₁₂. Needs k ≥ 2.
 */
export function focusedTerms(z: ZMaps, i: number): FocusedTerms {
  const N = checkZ(z, 2);
  const k = z.length;
  if (!Number.isInteger(i) || i < 0 || i >= k) throw new Error(`focusedTerms: map ${i} is not in [0, ${k})`);
  const others = [...Array(k).keys()].filter((j) => j !== i);
  const { mean, vari } = voxelMoments(z, others, N);
  const zi = z[i];
  const signed = new Float64Array(N);
  const own = new Float64Array(N);
  const baseline = new Float64Array(N);
  const c = 1 / (2 * N);
  for (let v = 0; v < N; v++) {
    const e = zi[v] - mean[v];
    signed[v] = e;
    own[v] = c * e * e;
    baseline[v] = c * vari[v];
  }
  return { signed, own, baseline };
}

export interface GroupTerms {
  /** z̄_A − z̄_B. */
  signed: Float64Array;
  /** (1/2N)·[(z̄_A − z̄_B)² + s²_A + s²_B] (population variances). Σ = mean_{a∈A,b∈B} d_ab. */
  between: Float64Array;
  /** (1/2N)·(2n_A/(n_A − 1))·s²_A. Σ = mean over pairs a < a′ in A of d. Null when |A| = 1. */
  withinA: Float64Array | null;
  /** As `withinA` for B. */
  withinB: Float64Array | null;
}

/**
 * Group terms for disjoint non-empty groups A, B (indices into z), from
 * mean_{a∈A,b∈B}(z_a − z_b)² = (z̄_A − z̄_B)² + s²_A + s²_B.
 * Identity: Σᵥ between = mean_{a∈A,b∈B} d_ab. Within a group, the mean over
 * unordered pairs of (z_a − z_a′)² is 2n/(n − 1)·s², hence the n/(n − 1) factor.
 */
export function groupTerms(z: ZMaps, A: readonly number[], B: readonly number[]): GroupTerms {
  const N = checkZ(z, 2);
  const k = z.length;
  if (!A.length || !B.length) throw new Error('groupTerms: groups must be non-empty');
  const seen = new Set<number>();
  for (const i of [...A, ...B]) {
    if (!Number.isInteger(i) || i < 0 || i >= k) throw new Error(`groupTerms: map ${i} is not in [0, ${k})`);
    if (seen.has(i)) throw new Error(`groupTerms: map ${i} appears twice (groups must be disjoint)`);
    seen.add(i);
  }
  const a = voxelMoments(z, A, N);
  const b = voxelMoments(z, B, N);
  const c = 1 / (2 * N);
  const signed = new Float64Array(N);
  const between = new Float64Array(N);
  const withinA = A.length > 1 ? new Float64Array(N) : null;
  const withinB = B.length > 1 ? new Float64Array(N) : null;
  const fA = (2 * A.length) / (A.length - 1);
  const fB = (2 * B.length) / (B.length - 1);
  for (let v = 0; v < N; v++) {
    const e = a.mean[v] - b.mean[v];
    signed[v] = e;
    between[v] = c * (e * e + a.vari[v] + b.vari[v]);
    if (withinA) withinA[v] = c * fA * a.vari[v];
    if (withinB) withinB[v] = c * fB * b.vari[v];
  }
  return { signed, between, withinA, withinB };
}

// ---------------------------------------------------------------------------
// 5. Reliability and the noise floor
// ---------------------------------------------------------------------------

export interface Reliability {
  /** 1 − noiseVar/totalVar. May be < 0 (SEs larger than the spread of β); reported raw. */
  rho: number;
  /** totalVar − noiseVar. */
  signalVar: number;
  /** mean over used positions of SE². */
  noiseVar: number;
  /** Population variance of β over used positions. */
  totalVar: number;
  /** √totalVar: the σᵢ to pass to `noiseFloorTerms` so its identity is exact. */
  betaSd: number;
  /** Positions used (support positions with finite β and finite SE > 0). */
  n: number;
}

/**
 * Reliability of one map from its β and SE (masked vectors aligned with the
 * support positions): ρ = 1 − mean_S(SE²)/Var_S(β), with the population
 * variance. Under β = signal + independent noise of variance SE², the expected
 * Var(β) is Var(signal) + mean SE², so ρ estimates Var(signal)/Var(β). Positions
 * with a non-finite β, or a non-finite or non-positive SE, are skipped in both
 * the numerator and the denominator. Assumes the SEs are calibrated.
 */
export function reliability(beta: Float32Array, se: Float32Array, support: ArrayLike<number>): Reliability {
  let n = 0;
  let sb = 0;
  let sse = 0;
  const ok = (v: number): boolean => Number.isFinite(beta[v]) && Number.isFinite(se[v]) && se[v] > 0;
  for (let t = 0; t < support.length; t++) {
    const v = support[t];
    if (!ok(v)) continue;
    n++;
    sb += beta[v];
    sse += se[v] * se[v];
  }
  if (n < 2) return { rho: NaN, signalVar: NaN, noiseVar: NaN, totalVar: NaN, betaSd: NaN, n };
  const mean = sb / n;
  let ss = 0;
  for (let t = 0; t < support.length; t++) {
    const v = support[t];
    if (!ok(v)) continue;
    const e = beta[v] - mean;
    ss += e * e;
  }
  const totalVar = ss / n;
  const noiseVar = sse / n;
  return { rho: 1 - noiseVar / totalVar, signalVar: totalVar - noiseVar, noiseVar, totalVar, betaSd: Math.sqrt(totalVar), n };
}

/**
 * Noise floor F(v) = ((k − 1)/(2N))·Σᵢ SEᵢ(v)²/σᵢ²: the expected contribution of
 * independent measurement noise to D(v). (The noise variance of zᵢ(v) is
 * SEᵢ(v)²/σᵢ²; independent noise adds (k/2N)·(k − 1)/k·Σᵢ of it to
 * E[(k/2N)·Σᵢ(zᵢ − z̄)²].)
 *
 * Identity: Σᵥ F(v) = ((k − 1)/2)·Σᵢ mean_S(SEᵢ²)/σᵢ² = ((k − 1)/2)·Σᵢ (1 − ρᵢ)
 * = Σᵢ<ⱼ ((1 − ρᵢ) + (1 − ρⱼ))/2, exact when σᵢ is `reliability(...).betaSd`
 * on the same support and SE.
 *
 * F is not the whole expected D when the maps share one true pattern: with
 * zᵢ = √ρᵢ·t + noise, E[D] adds (1/2N)·Σᵢ<ⱼ(√ρᵢ − √ρⱼ)²·t², so
 * E Σ dᵢⱼ = Σᵢ<ⱼ (1 − √(ρᵢρⱼ)) ≥ Σ F (AM–GM), with equality when the ρᵢ are equal.
 *
 * Positions where SEᵢ is non-finite or ≤ 0 (skipped by `reliability`) take the
 * mean of member i's valid SE² there, which keeps the identity exact.
 */
export function noiseFloorTerms(se: readonly Float32Array[], betaSd: readonly number[], support: ArrayLike<number>): Float64Array {
  const k = se.length;
  const N = support.length;
  if (betaSd.length !== k) throw new Error('noiseFloorTerms: one betaSd per member is required');
  if (N === 0) throw new Error('noiseFloorTerms: empty support');
  const F = new Float64Array(N);
  const c = (k - 1) / (2 * N);
  for (let i = 0; i < k; i++) {
    const s = se[i];
    const sig2 = betaSd[i] * betaSd[i];
    if (!(sig2 > 0) || !Number.isFinite(sig2)) throw new Error(`noiseFloorTerms: betaSd[${i}] must be finite and positive`);
    let sum = 0;
    let n = 0;
    for (let t = 0; t < N; t++) {
      const x = s[support[t]];
      if (Number.isFinite(x) && x > 0) {
        sum += x * x;
        n++;
      }
    }
    if (n === 0) throw new Error(`noiseFloorTerms: member ${i} has no valid SE on the support`);
    const fill = sum / n;
    for (let t = 0; t < N; t++) {
      const x = s[support[t]];
      F[t] += (c * (Number.isFinite(x) && x > 0 ? x * x : fill)) / sig2;
    }
  }
  return F;
}

/**
 * Spearman-disattenuated correlation r/√(ρᵢρⱼ), clamped to [−1, 1]; NaN when
 * either ρ is below `minRho` (or not finite), where the correction is unstable.
 */
export function correctedR(r: number, rhoI: number, rhoJ: number, minRho = 0.1): number {
  if (!Number.isFinite(r) || !(rhoI >= minRho) || !(rhoJ >= minRho) || !Number.isFinite(rhoI) || !Number.isFinite(rhoJ)) return NaN;
  return Math.max(-1, Math.min(1, r / Math.sqrt(rhoI * rhoJ)));
}

/**
 * 1 − √(ρᵢρⱼ) with each ρ clamped to [0, 1]: the expected 1 − r between two
 * maps with the same true pattern and independent noise (the noise ceiling).
 */
export function noiseDissimilarity(rhoI: number, rhoJ: number): number {
  const c = (x: number): number => Math.max(0, Math.min(1, x));
  return 1 - Math.sqrt(c(rhoI) * c(rhoJ));
}

// ---------------------------------------------------------------------------
// 6. Parcels
// ---------------------------------------------------------------------------

export interface ParcelSums {
  /** Per parcel label (≠ 0): sum of the terms and number of positions. */
  parcels: Map<number, { sum: number; n: number }>;
  /** Positions with label 0 (outside every parcel). */
  outside: { sum: number; n: number };
  /** All positions (parcels + outside). */
  total: { sum: number; n: number };
}

/** Sum per-voxel terms by parcel label (aligned with the support; 0 = outside any parcel). */
export function parcelSums(terms: ArrayLike<number>, labels: Int32Array): ParcelSums {
  if (terms.length !== labels.length) throw new Error('parcelSums: terms and labels differ in length');
  const parcels = new Map<number, { sum: number; n: number }>();
  const outside = { sum: 0, n: 0 };
  for (let v = 0; v < terms.length; v++) {
    const l = labels[v];
    if (l === 0) {
      outside.sum += terms[v];
      outside.n++;
      continue;
    }
    let e = parcels.get(l);
    if (!e) parcels.set(l, (e = { sum: 0, n: 0 }));
    e.sum += terms[v];
    e.n++;
  }
  let sum = outside.sum;
  for (const e of parcels.values()) sum += e.sum;
  return { parcels, outside, total: { sum, n: terms.length } };
}

export interface Concentration {
  /** Labels of the top-K parcels by sum (descending). */
  top: number[];
  /** Share of the total (parcels + outside) carried by the top-K parcels. */
  topShare: number;
  /** Share of all positions in those same parcels: what spreading proportional to size would give. */
  sizeShare: number;
}

/**
 * Concentration of a term in its top-K parcels. `sums` comes from `parcelSums`
 * and carries the parcel sizes; denominators include the outside mass.
 */
export function concentration(sums: ParcelSums, topK: number): Concentration {
  const ranked = [...sums.parcels.entries()].sort((x, y) => y[1].sum - x[1].sum || x[0] - y[0]).slice(0, Math.max(0, topK));
  let s = 0;
  let n = 0;
  for (const [, e] of ranked) {
    s += e.sum;
    n += e.n;
  }
  return { top: ranked.map(([id]) => id), topShare: s / sums.total.sum, sizeShare: n / sums.total.n };
}

/**
 * Reference for `concentration(...).topShare` of a group contrast: the median over
 * `reps` random disjoint splits of the k maps into groups of sizes nA and nB of
 * the top-K share of `groupTerms(...).between`. Seeded (mulberry32), deterministic.
 */
export function randomSplitReference(
  z: ZMaps,
  nA: number,
  nB: number,
  labels: Int32Array,
  reps: number,
  seed: number,
  topK: number,
): { median: number; shares: Float64Array } {
  const k = z.length;
  if (nA < 1 || nB < 1 || nA + nB > k) throw new Error(`randomSplitReference: cannot split ${k} maps into ${nA} + ${nB}`);
  const rnd = mulberry32(seed);
  const shares = new Float64Array(reps);
  const perm = [...Array(k).keys()];
  for (let r = 0; r < reps; r++) {
    for (let t = 0; t < nA + nB; t++) {
      const u = t + Math.floor(rnd() * (k - t));
      [perm[t], perm[u]] = [perm[u], perm[t]];
    }
    const g = groupTerms(z, perm.slice(0, nA), perm.slice(nA, nA + nB));
    shares[r] = concentration(parcelSums(g.between, labels), topK).topShare;
  }
  return { median: median(shares), shares };
}

// ---------------------------------------------------------------------------
// 7. Leave-one-parcel-out influence (exact)
// ---------------------------------------------------------------------------

export interface ParcelMomentsOptions {
  /** Memory budget for the per-parcel sums, in bytes (default 256 MiB). */
  maxBytes?: number;
}

/** Per-parcel sums of the k maps; see `parcelMoments`. */
export interface ParcelMoments {
  k: number;
  N: number;
  /** Parcel labels (≠ 0), ascending; slot p + 1 of the arrays (slot 0 is outside). */
  ids: number[];
  /** n per slot. */
  n: Float64Array;
  /** Σ zᵢ per slot (k per slot). */
  s: Float64Array;
  /** Σ zᵢzⱼ, i ≤ j, packed upper triangle per slot (k(k + 1)/2 per slot). */
  c: Float64Array;
  /** Totals over all slots: n, s, c. */
  totN: number;
  totS: Float64Array;
  totC: Float64Array;
}

const triIndex = (i: number, j: number, k: number): number => i * k - (i * (i - 1)) / 2 + (j - i);

/**
 * Per-parcel first and second moments of the k maps. Accumulated on each map
 * shifted and scaled by its full-support mean and SD (i.e. on z): Pearson r is
 * invariant to a per-map affine map with positive scale, so r on any subset is
 * identical to r on the raw values, and centring avoids the cancellation of
 * raw-moment formulas. Label 0 (outside) is accumulated but never left out.
 *
 * Memory: (P + 1)·(k(k + 1)/2 + k + 1) doubles for P parcels — about 4 MB for
 * k = 50, P = 400. Throws above `maxBytes`.
 */
export function parcelMoments(
  data: readonly Float32Array[],
  members: readonly number[],
  support: ArrayLike<number>,
  labels: Int32Array,
  opts: ParcelMomentsOptions = {},
): ParcelMoments {
  const N = support.length;
  if (labels.length !== N) throw new Error('parcelMoments: labels must be aligned with the support');
  const k = members.length;
  const ids = [...new Set(Array.from(labels))].filter((l) => l !== 0).sort((a, b) => a - b);
  const slotOf = new Map<number, number>([[0, 0]]);
  ids.forEach((id, p) => slotOf.set(id, p + 1));
  const P1 = ids.length + 1;
  const T = (k * (k + 1)) / 2;
  const bytes = 8 * P1 * (T + k + 1);
  const maxBytes = opts.maxBytes ?? 256 * 2 ** 20;
  if (bytes > maxBytes) {
    throw new Error(
      `parcelMoments: ${k} maps x ${ids.length} parcels need ${(bytes / 2 ** 20).toFixed(1)} MiB of sums, above the ${(maxBytes / 2 ** 20).toFixed(1)} MiB budget (raise maxBytes or use fewer parcels)`,
    );
  }
  const z = standardize(data, members, support);
  const slot = new Int32Array(N);
  for (let v = 0; v < N; v++) slot[v] = slotOf.get(labels[v])!;
  const n = new Float64Array(P1);
  const s = new Float64Array(P1 * k);
  const c = new Float64Array(P1 * T);
  const zv = new Float64Array(k);
  for (let v = 0; v < N; v++) {
    const p = slot[v];
    n[p]++;
    const so = p * k;
    for (let i = 0; i < k; i++) {
      const x = z[i][v];
      zv[i] = x;
      s[so + i] += x;
    }
    let o = p * T;
    for (let i = 0; i < k; i++) {
      const x = zv[i];
      for (let j = i; j < k; j++) c[o++] += x * zv[j];
    }
  }
  const totS = new Float64Array(k);
  const totC = new Float64Array(T);
  for (let p = 0; p < P1; p++) {
    for (let i = 0; i < k; i++) totS[i] += s[p * k + i];
    for (let t = 0; t < T; t++) totC[t] += c[p * T + t];
  }
  return { k, N, ids, n, s, c, totN: N, totS, totC };
}

/** k×k dissimilarity 1 − r (row-major) from moment sums; r NaN where a map is constant on the subset. */
function distFromSums(k: number, n: number, S: ArrayLike<number>, C: ArrayLike<number>): Float64Array {
  const d = new Float64Array(k * k);
  const vari = new Float64Array(k);
  for (let i = 0; i < k; i++) vari[i] = C[triIndex(i, i, k)] - (S[i] * S[i]) / n;
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const cov = C[triIndex(i, j, k)] - (S[i] * S[j]) / n;
      const r = vari[i] > 0 && vari[j] > 0 && n >= 2 ? cov / Math.sqrt(vari[i] * vari[j]) : NaN;
      d[i * k + j] = d[j * k + i] = 1 - r;
    }
  }
  return d;
}

/** Full-support dissimilarities from the moment totals (equals the basis `dist` to roundoff). */
export function fullDistances(m: ParcelMoments): Float64Array {
  return distFromSums(m.k, m.totN, m.totS, m.totC);
}

/** k×k dissimilarities (row-major) on S \ P for parcel `id`, recomputed exactly from the sums. */
export function reducedFromMoments(m: ParcelMoments, id: number): Float64Array {
  const p = m.ids.indexOf(id) + 1;
  if (p === 0) throw new Error(`reducedFromMoments: no parcel ${id}`);
  const { k } = m;
  const T = (k * (k + 1)) / 2;
  const S = new Float64Array(k);
  const C = new Float64Array(T);
  for (let i = 0; i < k; i++) S[i] = m.totS[i] - m.s[p * k + i];
  for (let t = 0; t < T; t++) C[t] = m.totC[t] - m.c[p * T + t];
  return distFromSums(k, m.totN - m.n[p], S, C);
}

function upper(d: Float64Array, k: number): Float64Array {
  const out = new Float64Array((k * (k - 1)) / 2);
  let t = 0;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) out[t++] = d[i * k + j];
  return out;
}

export interface ParcelInfluence {
  id: number;
  /** Positions in the parcel. */
  n: number;
  /**
   * Mantel statistic: Pearson r between the upper triangles of the full and the
   * leave-parcel-out dissimilarities. Low = removing the parcel reshapes the
   * dissimilarities most. NaN if removal leaves a map constant or k < 3.
   */
  mantel: number;
}

/** Influence of every parcel from precomputed moments, most influential (lowest mantel, NaN first) first. */
export function influenceFromMoments(m: ParcelMoments): ParcelInfluence[] {
  const full = upper(fullDistances(m), m.k);
  const out = m.ids.map((id, p) => ({ id, n: m.n[p + 1], mantel: m.k < 3 ? NaN : pearson(full, upper(reducedFromMoments(m, id), m.k)) }));
  return out.sort((a, b) => {
    const an = Number.isNaN(a.mantel);
    const bn = Number.isNaN(b.mantel);
    if (an || bn) return an === bn ? a.id - b.id : an ? -1 : 1;
    return a.mantel - b.mantel || a.id - b.id;
  });
}

/**
 * Leave-one-parcel-out influence, exact: for each parcel P, rᵢⱼ is recomputed on
 * S \ P from per-parcel sums (totals minus P) — no refit, no approximation — and
 * compared with the full dissimilarities by a Mantel correlation. Cost O(N·k²/2)
 * plus O(P·k²). Sorted by mantel ascending (NaN first).
 */
export function parcelInfluence(
  data: readonly Float32Array[],
  members: readonly number[],
  support: ArrayLike<number>,
  labels: Int32Array,
  opts: ParcelMomentsOptions = {},
): ParcelInfluence[] {
  return influenceFromMoments(parcelMoments(data, members, support, labels, opts));
}

/** Leave-parcel-out k×k dissimilarities for one parcel (row-major, members order). */
export function reducedDistances(
  data: readonly Float32Array[],
  members: readonly number[],
  support: ArrayLike<number>,
  labels: Int32Array,
  id: number,
  opts: ParcelMomentsOptions = {},
): Float64Array {
  return reducedFromMoments(parcelMoments(data, members, support, labels, opts), id);
}

// ---------------------------------------------------------------------------
// 8. Heterogeneity (DerSimonian–Laird)
// ---------------------------------------------------------------------------

export interface Heterogeneity {
  /** Cochran's Q = Σ w(β − β̄_w)², w = 1/SE². */
  Q: number;
  df: number;
  /** max(0, (Q − df)/Q); 0 when Q = 0; NaN when k < 2. */
  I2: number;
  /** DerSimonian–Laird τ² = max(0, (Q − df)/(Σw − Σw²/Σw)); NaN when k < 2. */
  tau2: number;
  /** Members used (finite β, finite SE > 0). */
  k: number;
}

/**
 * Effect heterogeneity of one parcel across members, from per-member parcel-mean
 * β and parcel-mean SE. Members with a non-finite β or a non-finite or zero SE
 * are skipped. Using the parcel-mean SE treats within-parcel noise as fully
 * correlated (the SE of a mean of correlated voxels is not reduced by averaging),
 * which overstates the sampling variance, so Q and I² are conservative.
 */
export function heterogeneity(betaMeans: readonly number[], seMeans: readonly number[]): Heterogeneity {
  if (betaMeans.length !== seMeans.length) throw new Error('heterogeneity: one SE per β is required');
  const b: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < betaMeans.length; i++) {
    const s = seMeans[i];
    if (Number.isFinite(betaMeans[i]) && Number.isFinite(s) && s > 0) {
      b.push(betaMeans[i]);
      w.push(1 / (s * s));
    }
  }
  const k = b.length;
  if (k < 2) return { Q: 0, df: Math.max(0, k - 1), I2: NaN, tau2: NaN, k };
  let sw = 0;
  let swb = 0;
  let sw2 = 0;
  for (let i = 0; i < k; i++) {
    sw += w[i];
    swb += w[i] * b[i];
    sw2 += w[i] * w[i];
  }
  const mean = swb / sw;
  let Q = 0;
  for (let i = 0; i < k; i++) Q += w[i] * (b[i] - mean) ** 2;
  const df = k - 1;
  const I2 = Q > 0 ? Math.max(0, (Q - df) / Q) : 0;
  const tau2 = Math.max(0, (Q - df) / (sw - sw2 / sw));
  return { Q, df, I2, tau2, k };
}

// ---------------------------------------------------------------------------
// 9. envfit-style covariate fits on a 2D layout
// ---------------------------------------------------------------------------

export interface EnvfitVector {
  /** R² of the OLS fit covariate ~ 1 + x + y. */
  r2: number;
  /** Unit vector of the fitted gradient (the (x, y) coefficients, normalised). */
  direction: [number, number];
  /** (1 + #{permuted R² ≥ observed})/(1 + perms). */
  p: number;
  /** Members with an observed covariate. */
  n: number;
}

/** R² and slopes of y ~ 1 + x₁ + x₂ for centred x₁, x₂, given the inverse of their cross-product matrix. */
function fit2(x1: Float64Array, x2: Float64Array, y: Float64Array, inv: [number, number, number]): { r2: number; b1: number; b2: number } {
  let my = 0;
  for (let t = 0; t < y.length; t++) my += y[t];
  my /= y.length;
  let c1 = 0;
  let c2 = 0;
  let syy = 0;
  for (let t = 0; t < y.length; t++) {
    const e = y[t] - my;
    c1 += x1[t] * e;
    c2 += x2[t] * e;
    syy += e * e;
  }
  const [a, b, d] = inv; // inverse of [[s11, s12], [s12, s22]]
  const b1 = a * c1 + b * c2;
  const b2 = b * c1 + d * c2;
  const ssr = b1 * c1 + b2 * c2;
  return { r2: syy > 0 ? ssr / syy : NaN, b1, b2 };
}

function shuffle(y: Float64Array, rnd: () => number): void {
  for (let t = y.length - 1; t > 0; t--) {
    const u = Math.floor(rnd() * (t + 1));
    const tmp = y[t];
    y[t] = y[u];
    y[u] = tmp;
  }
}

/**
 * envfit-style vector (vegan::vectorfit): OLS of a covariate on the layout
 * coordinates with intercept; the direction is the normalised (x, y) slope, R²
 * the fit's coefficient of determination. Missing values (null / non-finite)
 * are dropped. The permutation p shuffles the covariate among the observed
 * members (valid because the covariate did not build the layout). Rotating the
 * layout rotates the direction and leaves R² and p unchanged.
 */
export function envfitVector(coords: ArrayLike<number>, values: readonly (number | null)[], perms = 999, seed = 1): EnvfitVector {
  const keep: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null && Number.isFinite(v) && Number.isFinite(coords[2 * i]) && Number.isFinite(coords[2 * i + 1])) keep.push(i);
  }
  const n = keep.length;
  const nan: EnvfitVector = { r2: NaN, direction: [NaN, NaN], p: NaN, n };
  if (n < 4) return nan;
  const x1 = new Float64Array(n);
  const x2 = new Float64Array(n);
  const y = new Float64Array(n);
  let m1 = 0;
  let m2 = 0;
  keep.forEach((i, t) => {
    x1[t] = coords[2 * i];
    x2[t] = coords[2 * i + 1];
    y[t] = values[i] as number;
    m1 += x1[t];
    m2 += x2[t];
  });
  m1 /= n;
  m2 /= n;
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  for (let t = 0; t < n; t++) {
    x1[t] -= m1;
    x2[t] -= m2;
    s11 += x1[t] * x1[t];
    s12 += x1[t] * x2[t];
    s22 += x2[t] * x2[t];
  }
  const det = s11 * s22 - s12 * s12;
  if (!(det > 1e-12 * Math.max(s11 * s22, 1e-300))) return nan;
  const inv: [number, number, number] = [s22 / det, -s12 / det, s11 / det];
  const obs = fit2(x1, x2, y, inv);
  if (!Number.isFinite(obs.r2)) return nan;
  const len = Math.hypot(obs.b1, obs.b2);
  const rnd = mulberry32(seed);
  const yp = Float64Array.from(y);
  let hits = 0;
  const tol = 1e-12 * Math.max(1, obs.r2);
  for (let r = 0; r < perms; r++) {
    shuffle(yp, rnd);
    if (fit2(x1, x2, yp, inv).r2 >= obs.r2 - tol) hits++;
  }
  return { r2: obs.r2, direction: len > 0 ? [obs.b1 / len, obs.b2 / len] : [0, 0], p: (1 + hits) / (1 + perms), n };
}

export interface EnvfitFactor {
  /** Between-centroid SS / total SS of the coordinates (both axes). */
  r2: number;
  centroids: { level: string; x: number; y: number; n: number }[];
  /** (1 + #{permuted R² ≥ observed})/(1 + perms). */
  p: number;
  n: number;
}

function factorR2(x: Float64Array, y: Float64Array, g: Int32Array, L: number, sst: number): number {
  const sx = new Float64Array(L);
  const sy = new Float64Array(L);
  const c = new Float64Array(L);
  for (let t = 0; t < g.length; t++) {
    sx[g[t]] += x[t];
    sy[g[t]] += y[t];
    c[g[t]]++;
  }
  let ssb = 0; // coordinates are centred, so SSB = Σ (sx² + sy²)/n per level
  for (let l = 0; l < L; l++) if (c[l]) ssb += (sx[l] * sx[l] + sy[l] * sy[l]) / c[l];
  return ssb / sst;
}

/**
 * envfit-style factor (vegan::factorfit): level centroids of the layout and
 * R² = between-centroid SS / total SS of the coordinates, with a permutation p
 * shuffling the labels among observed members. Missing labels (null) are dropped.
 */
export function envfitFactor(coords: ArrayLike<number>, labels: readonly (string | null)[], perms = 999, seed = 1): EnvfitFactor {
  const keep: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== null && Number.isFinite(coords[2 * i]) && Number.isFinite(coords[2 * i + 1])) keep.push(i);
  }
  const n = keep.length;
  const levels = [...new Set(keep.map((i) => labels[i] as string))].sort();
  const code = new Map(levels.map((l, t) => [l, t]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const g = new Int32Array(n);
  let mx = 0;
  let my = 0;
  keep.forEach((i, t) => {
    x[t] = coords[2 * i];
    y[t] = coords[2 * i + 1];
    g[t] = code.get(labels[i] as string)!;
    mx += x[t];
    my += y[t];
  });
  mx /= n || 1;
  my /= n || 1;
  let sst = 0;
  for (let t = 0; t < n; t++) {
    x[t] -= mx;
    y[t] -= my;
    sst += x[t] * x[t] + y[t] * y[t];
  }
  const centroids = levels.map((level, l) => {
    let cx = 0;
    let cy = 0;
    let c = 0;
    for (let t = 0; t < n; t++) {
      if (g[t] !== l) continue;
      cx += x[t];
      cy += y[t];
      c++;
    }
    return { level, x: cx / c + mx, y: cy / c + my, n: c };
  });
  if (n < 3 || levels.length < 2 || !(sst > 0)) return { r2: NaN, centroids, p: NaN, n };
  const L = levels.length;
  const obs = factorR2(x, y, g, L, sst);
  const rnd = mulberry32(seed);
  const gp = Int32Array.from(g);
  const tol = 1e-12 * Math.max(1, obs);
  let hits = 0;
  for (let r = 0; r < perms; r++) {
    for (let t = n - 1; t > 0; t--) {
      const u = Math.floor(rnd() * (t + 1));
      const tmp = gp[t];
      gp[t] = gp[u];
      gp[u] = tmp;
    }
    if (factorR2(x, y, gp, L, sst) >= obs - tol) hits++;
  }
  return { r2: obs, centroids, p: (1 + hits) / (1 + perms), n };
}
