/**
 * Stability of a Space layout under a spatial block bootstrap.
 *
 * Neighbouring voxels are strongly correlated, so resampling voxels one by one
 * would understate how much the between-map correlations depend on *which brain
 * regions* happen to be in the mask. Instead the common support is cut into
 * cubes of about `blockMm` (default 12 mm), and each replicate draws nBlocks
 * blocks with replacement (multinomial counts). Every voxel is weighted by the
 * count of its block, weighted Pearson r gives replicate dissimilarities 1 − r,
 * the layout is refitted warm-started from the reference layout, and the refit is
 * aligned to the reference. Each member's replicate positions form a point cloud
 * summarised by a 68% covariance ellipse.
 *
 * Read the clouds as "where a map would sit if the brain's regions were
 * resampled"; they are not confidence intervals for a biological quantity.
 *
 * Browser/worker-safe and dependency-free. The layout fit and the alignment
 * (e.g. Procrustes) are injected, so this module never depends on either.
 */
import { R_ROUNDOFF } from './basis';

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface BlockPartition {
  /** Per support element: block id in [0, nBlocks). */
  blockOf: Int32Array;
  /** Blocks containing at least one support voxel. */
  nBlocks: number;
  /** Block edge in voxels along i, j, k: max(1, round(blockMm / spacing)) per axis. */
  blockSize: number[];
  /** Block edge in mm along i, j, k actually used (blockSize × spacing). */
  blockMmActual: number[];
  /** Support voxels per block. */
  voxelsPerBlock: Int32Array;
}

/**
 * Partition support voxels into grid-aligned cuboids of about `blockMm` per side.
 * The edge along each axis is round(blockMm / spacing) voxels (at least 1), so an
 * anisotropic grid gets different voxel counts per axis and each edge is within
 * half a voxel of `blockMm`. Cuboids start at voxel 0 of each axis; only those
 * containing support voxels count, and they are numbered in ascending grid order
 * (k slowest, then j, then i).
 *
 * `support` lists positions into the masked vectors; `maskIndex` maps them to
 * linear grid indices (i fastest).
 */
export function blockPartition(
  dim: readonly number[],
  spacingMm: readonly number[],
  maskIndex: Int32Array,
  support: ArrayLike<number>,
  blockMm: number,
): BlockPartition {
  if (dim.length < 3 || spacingMm.length < 3) throw new Error('blockPartition: dim and spacing need three axes');
  if (!(blockMm > 0) || !Number.isFinite(blockMm)) throw new Error('blockPartition: blockMm must be a positive number');
  for (let a = 0; a < 3; a++) {
    if (!(spacingMm[a] > 0) || !Number.isFinite(spacingMm[a])) throw new Error('blockPartition: spacing must be positive');
  }
  const [nx, ny, nz] = dim;
  const blockSize = [0, 1, 2].map((a) => Math.max(1, Math.round(blockMm / Math.abs(spacingMm[a]))));
  const nbx = Math.ceil(nx / blockSize[0]);
  const nby = Math.ceil(ny / blockSize[1]);
  const nbz = Math.ceil(nz / blockSize[2]);
  const cell = new Int32Array(support.length);
  const used = new Uint8Array(nbx * nby * nbz);
  for (let t = 0; t < support.length; t++) {
    const s = support[t];
    if (!(s >= 0 && s < maskIndex.length)) throw new Error(`blockPartition: support[${t}] = ${s} is not a mask position`);
    const g = maskIndex[s];
    const i = g % nx;
    const j = Math.floor(g / nx) % ny;
    const k = Math.floor(g / (nx * ny));
    if (k >= nz) throw new Error(`blockPartition: grid index ${g} is outside dim`);
    const c = Math.floor(i / blockSize[0]) + nbx * (Math.floor(j / blockSize[1]) + nby * Math.floor(k / blockSize[2]));
    cell[t] = c;
    used[c] = 1;
  }
  const id = new Int32Array(used.length).fill(-1);
  let nBlocks = 0;
  for (let c = 0; c < used.length; c++) if (used[c]) id[c] = nBlocks++;
  const blockOf = new Int32Array(support.length);
  const voxelsPerBlock = new Int32Array(nBlocks);
  for (let t = 0; t < support.length; t++) {
    blockOf[t] = id[cell[t]];
    voxelsPerBlock[blockOf[t]]++;
  }
  return {
    blockOf,
    nBlocks,
    blockSize,
    blockMmActual: blockSize.map((b, a) => b * Math.abs(spacingMm[a])),
    voxelsPerBlock,
  };
}

/** mulberry32: small, well-mixed 32-bit PRNG returning values in [0, 1). */
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

/**
 * Block bootstrap weights: for each replicate, nBlocks draws with replacement
 * from the blocks, returned as per-block counts (a Multinomial(nBlocks, 1/nBlocks)
 * vector summing to nBlocks). Replicate r uses mulberry32(seed + r), so results
 * depend only on (nBlocks, seed, r).
 */
export function bootstrapWeights(nBlocks: number, replicates: number, seed: number): Uint16Array[] {
  if (!Number.isInteger(nBlocks) || nBlocks < 1 || nBlocks > 65535) {
    throw new Error('bootstrapWeights: nBlocks must be an integer in [1, 65535]');
  }
  if (!Number.isInteger(replicates) || replicates < 0) throw new Error('bootstrapWeights: replicates must be an integer ≥ 0');
  if (!Number.isInteger(seed)) throw new Error('bootstrapWeights: seed must be an integer');
  const out: Uint16Array[] = [];
  for (let r = 0; r < replicates; r++) {
    const rnd = mulberry32(seed + r);
    const w = new Uint16Array(nBlocks);
    for (let d = 0; d < nBlocks; d++) w[Math.min(nBlocks - 1, Math.floor(rnd() * nBlocks))]++;
    out.push(w);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weighted correlation
// ---------------------------------------------------------------------------

/**
 * Snap a correlation to ±1 within R_ROUNDOFF (the basis.ts policy) and throw
 * when it lies outside [−1, 1] by more than `tol`; smaller excursions are clamped.
 */
function clampR(r: number, tol: number): number {
  if (!(Math.abs(r) <= 1 + tol)) throw new Error(`correlation ${r} is outside [-1, 1] beyond roundoff`);
  if (r >= 1 - R_ROUNDOFF) return 1;
  if (r <= -1 + R_ROUNDOFF) return -1;
  return r;
}

/**
 * Dissimilarities 1 − r_w between the listed members, where r_w is Pearson r with
 * each support voxel weighted by its block's count w:
 *   mean_w(x) = Σ w x / Σ w,   r_w = Σ w (x − x̄)(y − ȳ) / sqrt( Σ w (x − x̄)² · Σ w (y − ȳ)² ).
 * Integer weights are equivalent to duplicating voxels. Computed two-pass in
 * float64; with all weights 1 the result equals the basis.ts r bit for bit.
 * Roundoff policy as in basis.ts: r within 1e-12 of ±1 is snapped to ±1, and a
 * value outside [−1, 1] by more than 1e-9 throws.
 *
 * Returns the m×m row-major matrix (symmetric, zero diagonal), or null when the
 * replicate is invalid: a member is constant under these weights (fewer than two
 * voxels with w > 0, Σ w (x − x̄)² = 0, or Σ w (x − x̄)² / Σ w ≤ 1e-20 · x̄²), so
 * its correlations are undefined. Support voxels must be finite for every member.
 */
export function weightedCorrelationDistances(
  data: readonly Float32Array[],
  members: readonly number[],
  support: ArrayLike<number>,
  blockOf: Int32Array,
  weights: Uint16Array,
): Float64Array | null {
  if (blockOf.length !== support.length) throw new Error('weightedCorrelationDistances: one block id per support voxel is required');
  const act: number[] = [];
  const wa: number[] = [];
  for (let t = 0; t < support.length; t++) {
    const w = weights[blockOf[t]];
    if (w === undefined) throw new Error(`weightedCorrelationDistances: block ${blockOf[t]} has no weight`);
    if (w > 0) {
      act.push(support[t]);
      wa.push(w);
    }
  }
  const S = act.length;
  const m = members.length;
  const means = new Float64Array(m);
  const ss = new Float64Array(m);
  for (let p = 0; p < m; p++) {
    const d = data[members[p]];
    let W = 0;
    let s = 0;
    for (let t = 0; t < S; t++) {
      const x = d[act[t]];
      if (!Number.isFinite(x)) throw new Error(`weightedCorrelationDistances: member ${members[p]} is not finite at position ${act[t]}`);
      W += wa[t];
      s += wa[t] * x;
    }
    const mean = s / W;
    let q = 0;
    for (let t = 0; t < S; t++) {
      const x = d[act[t]] - mean;
      q += wa[t] * x * x;
    }
    if (S < 2 || q === 0 || q / W <= Math.max(1e-300, mean * mean) * 1e-20) return null;
    means[p] = mean;
    ss[p] = q;
  }
  const out = new Float64Array(m * m);
  for (let p = 0; p < m; p++) {
    const a = data[members[p]];
    const ma = means[p];
    for (let q = p + 1; q < m; q++) {
      const b = data[members[q]];
      const mb = means[q];
      let cov = 0;
      for (let t = 0; t < S; t++) {
        const v = act[t];
        cov += wa[t] * (a[v] - ma) * (b[v] - mb);
      }
      const dist = 1 - clampR(cov / Math.sqrt(ss[p] * ss[q]), 1e-9);
      out[p * m + q] = dist;
      out[q * m + p] = dist;
    }
  }
  return out;
}

/**
 * Per-block sufficient statistics for fast replicate correlations. Data are first
 * centred on each member's unweighted support mean c (so the raw-moment formula
 * below does not cancel catastrophically), then per block b:
 * count_b, sum_bi = Σ (x_i − c_i), gram_bij = Σ (x_i − c_i)(x_j − c_j) (packed i ≤ j).
 */
export interface BlockMoments {
  m: number;
  nBlocks: number;
  count: Float64Array;
  /** nBlocks × m. */
  sum: Float64Array;
  /** nBlocks × m(m+1)/2, packed upper triangle (row-major, i ≤ j). */
  gram: Float64Array;
}

/** Bytes needed by `blockMoments` for m members and nBlocks blocks. */
export function blockMomentBytes(m: number, nBlocks: number): number {
  return 8 * nBlocks * (1 + m + (m * (m + 1)) / 2);
}

/** Precompute `BlockMoments` (cost of one full m×m correlation pass). */
export function blockMoments(
  data: readonly Float32Array[],
  members: readonly number[],
  support: ArrayLike<number>,
  blockOf: Int32Array,
  nBlocks: number,
): BlockMoments {
  const m = members.length;
  const P = (m * (m + 1)) / 2;
  const S = support.length;
  const centre = new Float64Array(m);
  for (let p = 0; p < m; p++) {
    const d = data[members[p]];
    let s = 0;
    for (let t = 0; t < S; t++) {
      const x = d[support[t]];
      if (!Number.isFinite(x)) throw new Error(`blockMoments: member ${members[p]} is not finite at position ${support[t]}`);
      s += x;
    }
    centre[p] = S ? s / S : 0;
  }
  const count = new Float64Array(nBlocks);
  const sum = new Float64Array(nBlocks * m);
  const gram = new Float64Array(nBlocks * P);
  const y = new Float64Array(m);
  for (let t = 0; t < S; t++) {
    const v = support[t];
    const b = blockOf[t];
    count[b]++;
    const so = b * m;
    for (let p = 0; p < m; p++) {
      y[p] = data[members[p]][v] - centre[p];
      sum[so + p] += y[p];
    }
    let g = b * P;
    for (let p = 0; p < m; p++) {
      const yp = y[p];
      for (let q = p; q < m; q++) gram[g++] += yp * y[q];
    }
  }
  return { m, nBlocks, count, sum, gram };
}

/**
 * Same quantity as `weightedCorrelationDistances`, from `BlockMoments` in
 * O(nBlocks · m²) per replicate: with W = Σ w_b count_b, s_i = Σ w_b sum_bi and
 * M_ij = Σ w_b gram_bij, cov_ij = M_ij − s_i s_j / W. Equal to the two-pass value
 * up to roundoff. A member is constant (replicate invalid → null) when fewer than
 * two voxels have w > 0 or its weighted sum of squares ≤ 1e-10 · M_ii (relative
 * to its second moment about the centre, the scale at which this formula's
 * cancellation error lives). r is snapped to ±1 within 1e-12 and clamped to
 * [−1, 1] within 1e-6; larger excursions throw.
 */
export function momentCorrelationDistances(bm: BlockMoments, weights: Uint16Array): Float64Array | null {
  const { m, nBlocks, count, sum, gram } = bm;
  if (weights.length !== nBlocks) throw new Error('momentCorrelationDistances: one weight per block is required');
  const P = (m * (m + 1)) / 2;
  const s = new Float64Array(m);
  const M = new Float64Array(P);
  let W = 0;
  for (let b = 0; b < nBlocks; b++) {
    const w = weights[b];
    if (w === 0) continue;
    W += w * count[b];
    const so = b * m;
    for (let p = 0; p < m; p++) s[p] += w * sum[so + p];
    const go = b * P;
    for (let e = 0; e < P; e++) M[e] += w * gram[go + e];
  }
  let nEff = 0;
  for (let b = 0; b < nBlocks && nEff < 2; b++) if (weights[b] > 0) nEff += count[b];
  if (nEff < 2) return null;
  const diag = (p: number): number => p * m - (p * (p - 1)) / 2;
  const ss = new Float64Array(m);
  for (let p = 0; p < m; p++) {
    const Mpp = M[diag(p)];
    ss[p] = Mpp - (s[p] * s[p]) / W;
    if (!(ss[p] > 1e-10 * Mpp)) return null;
  }
  const out = new Float64Array(m * m);
  for (let p = 0; p < m; p++) {
    const row = diag(p) - p;
    for (let q = p + 1; q < m; q++) {
      const cov = M[row + q] - (s[p] * s[q]) / W;
      const r = Math.max(-1, Math.min(1, clampR(cov / Math.sqrt(ss[p] * ss[q]), 1e-6)));
      out[p * m + q] = 1 - r;
      out[q * m + p] = 1 - r;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ellipses
// ---------------------------------------------------------------------------

/** Probability mass inside `ellipse68` under a bivariate normal. */
export const ELLIPSE_MASS = 0.68;
/**
 * Squared Mahalanobis radius of the 68% region: the chi-square (2 dof) quantile,
 * −2 ln(1 − 0.68) ≈ 2.279 (radius ≈ 1.510 standard deviations along each axis).
 */
export const ELLIPSE_CHI2 = -2 * Math.log(1 - ELLIPSE_MASS);

export interface Ellipse {
  cx: number;
  cy: number;
  /** Semi-axis along `angle` (the major axis). */
  rx: number;
  /** Semi-axis perpendicular to it (the minor axis). */
  ry: number;
  /** Major-axis direction, radians from +x, in (−π/2, π/2]. */
  angle: number;
}

/**
 * Covariance ellipse of 2D points (2k interleaved): centred on the mean, axes
 * along the eigenvectors of the sample covariance (divisor k − 1), semi-axes
 * sqrt(ELLIPSE_CHI2 · λ), so it contains 68% of a bivariate normal. Null for
 * fewer than 3 points or non-finite input.
 */
export function ellipse68(points: ArrayLike<number>): Ellipse | null {
  const k = Math.floor(points.length / 2);
  if (k < 3) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < k; i++) {
    cx += points[2 * i];
    cy += points[2 * i + 1];
  }
  cx /= k;
  cy /= k;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < k; i++) {
    const dx = points[2 * i] - cx;
    const dy = points[2 * i + 1] - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= k - 1;
  syy /= k - 1;
  sxy /= k - 1;
  if (![cx, cy, sxx, syy, sxy].every(Number.isFinite)) return null;
  const tr = (sxx + syy) / 2;
  const det = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const l1 = tr + det;
  const l2 = Math.max(0, tr - det);
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (angle <= -Math.PI / 2) angle += Math.PI;
  return { cx, cy, rx: Math.sqrt(ELLIPSE_CHI2 * l1), ry: Math.sqrt(ELLIPSE_CHI2 * l2), angle };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface StabilityOptions {
  /** Masked vectors of the whole set. */
  data: readonly Float32Array[];
  /** Set indices of the laid-out members, in layout order. */
  members: readonly number[];
  /** Common-support positions (into the masked vectors). */
  support: ArrayLike<number>;
  /** Grid dimensions and voxel spacing (mm) of the set. */
  dim: readonly number[];
  spacingMm: readonly number[];
  /** Mask position → linear grid index. */
  maskIndex: Int32Array;
  /** Reference layout (2m interleaved): warm start for each refit and alignment target. */
  reference: ArrayLike<number>;
  /** Refit a layout from an m×m dissimilarity matrix, warm-started at `init` (2m). */
  fit: (dist: Float64Array, init: Float64Array) => Float64Array | Promise<Float64Array>;
  /** Align `source` (2m) to `target` (2m), e.g. Procrustes; returns the aligned copy. */
  align: (source: Float64Array, target: Float64Array) => Float64Array;
  /** Block edge in mm (default 12). */
  blockMm?: number;
  /** Number of replicates (default 24). */
  replicates?: number;
  /** Seed of the block draws (default 1). */
  seed?: number;
  signal?: AbortSignal;
  /** Called after each replicate, in order, so clouds can fill in progressively. */
  onReplicate?: (rep: StabilityReplicate) => void;
  /**
   * Memory budget for per-block moments (default 256 MiB). Within it, replicates
   * cost O(nBlocks · m²) after one O(support · m²) pass; above it each replicate
   * is a full two-pass weighted correlation.
   */
  maxMomentBytes?: number;
}

export interface StabilityReplicate {
  index: number;
  /** Aligned layout (2m), or null for an invalid replicate. */
  coords: Float64Array | null;
  /** Why the replicate is invalid, else null. */
  invalid: string | null;
  done: number;
  total: number;
}

export interface StabilityResult {
  definition: string;
  blockMm: number;
  blockSize: number[];
  blockMmActual: number[];
  nBlocks: number;
  replicates: number;
  seed: number;
  method: 'block-moments' | 'two-pass';
  /** Indices of replicates that were skipped, with reasons. */
  invalid: { index: number; reason: string }[];
  /** Per member: aligned positions over valid replicates (2 × valid, interleaved). */
  clouds: Float64Array[];
  /** Per member: `ellipse68` of its cloud (null with fewer than 3 valid replicates). */
  ellipses: (Ellipse | null)[];
  /** Per member: RMS distance of its cloud from its reference position (NaN if no valid replicate). */
  spread: Float64Array;
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const e = new Error('stability run aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * Run the block bootstrap (see the module comment). Replicate r draws
 * `bootstrapWeights(nBlocks, replicates, seed)[r]`, computes weighted 1 − r
 * between `members`, refits with `fit(dist, reference)` and aligns with
 * `align(coords, reference)`. A replicate in which some member is constant under
 * its weights is recorded as invalid and skipped (no NaN positions). Between
 * replicates the run yields to the event loop (so a worker can receive an abort)
 * and throws an AbortError once `signal` is aborted. Deterministic for a
 * deterministic `fit` and `align`.
 */
export async function runStability(opts: StabilityOptions): Promise<StabilityResult> {
  const { data, members, support, signal } = opts;
  const blockMm = opts.blockMm ?? 12;
  const replicates = opts.replicates ?? 24;
  const seed = opts.seed ?? 1;
  const m = members.length;
  const reference = Float64Array.from(opts.reference);
  if (reference.length !== 2 * m) throw new Error(`runStability: reference has ${reference.length} entries; expected ${2 * m}`);
  if (!reference.every(Number.isFinite)) throw new Error('runStability: reference is not finite');
  if (signal?.aborted) throw abortError(signal);

  const part = blockPartition(opts.dim, opts.spacingMm, opts.maskIndex, support, blockMm);
  if (part.nBlocks < 1) throw new Error('runStability: the support is empty');
  const weights = bootstrapWeights(part.nBlocks, replicates, seed);
  const useMoments = blockMomentBytes(m, part.nBlocks) <= (opts.maxMomentBytes ?? 256 * 1024 * 1024);
  const bm = useMoments ? blockMoments(data, members, support, part.blockOf, part.nBlocks) : null;

  const valid: Float64Array[] = [];
  const invalid: { index: number; reason: string }[] = [];
  for (let r = 0; r < replicates; r++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) throw abortError(signal);
    const dist = bm
      ? momentCorrelationDistances(bm, weights[r])
      : weightedCorrelationDistances(data, members, support, part.blockOf, weights[r]);
    let coords: Float64Array | null = null;
    let reason: string | null = null;
    if (dist === null) {
      reason = 'a member is constant over the resampled blocks';
    } else {
      const fitted = await opts.fit(dist, Float64Array.from(reference));
      if (signal?.aborted) throw abortError(signal);
      if (fitted.length !== 2 * m || !fitted.every(Number.isFinite)) throw new Error('runStability: fit returned an invalid layout');
      coords = Float64Array.from(opts.align(Float64Array.from(fitted), Float64Array.from(reference)));
      if (coords.length !== 2 * m || !coords.every(Number.isFinite)) throw new Error('runStability: align returned an invalid layout');
    }
    if (coords) valid.push(coords);
    else invalid.push({ index: r, reason: reason! });
    opts.onReplicate?.({ index: r, coords, invalid: reason, done: r + 1, total: replicates });
  }

  const clouds: Float64Array[] = [];
  const ellipses: (Ellipse | null)[] = [];
  const spread = new Float64Array(m);
  for (let p = 0; p < m; p++) {
    const cloud = new Float64Array(2 * valid.length);
    let sq = 0;
    valid.forEach((c, r) => {
      cloud[2 * r] = c[2 * p];
      cloud[2 * r + 1] = c[2 * p + 1];
      sq += (c[2 * p] - reference[2 * p]) ** 2 + (c[2 * p + 1] - reference[2 * p + 1]) ** 2;
    });
    clouds.push(cloud);
    ellipses.push(ellipse68(cloud));
    spread[p] = valid.length ? Math.sqrt(sq / valid.length) : NaN;
  }
  return {
    definition:
      `Spatial block bootstrap: ${replicates} replicates resampling ${part.nBlocks} blocks of ` +
      `${part.blockMmActual.map((x) => +x.toFixed(2)).join(' × ')} mm with replacement; each refit is warm-started ` +
      'from the current layout and aligned to it. Clouds show where a map would sit if the brain’s regions were resampled.',
    blockMm,
    blockSize: part.blockSize,
    blockMmActual: part.blockMmActual,
    nBlocks: part.nBlocks,
    replicates,
    seed,
    method: bm ? 'block-moments' : 'two-pass',
    invalid,
    clouds,
    ellipses,
    spread,
  };
}
