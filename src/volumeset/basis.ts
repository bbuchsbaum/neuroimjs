/**
 * Similarity basis: one explicit, reproducible definition of how similar the
 * members of a volume set are, shared by every view that compares members
 * (similarity matrix, seriation, Space layout, neighbour lists).
 *
 * Measure: signed Pearson r between members' maps on the *common support*,
 * dissimilarity 1 - r in [0, 2]. The common support is the set of analysis-mask
 * voxels at which every eligible member is finite, so every pair is compared on
 * exactly the same voxels (unlike pairwise deletion). Finite zeros are valid data.
 *
 * Members are excluded, with a recorded reason, in this order:
 *   1. all-missing   — no finite voxel in the analysis mask;
 *   2. low-coverage  — finite on fewer than `minCoverage` x the median member's
 *                      number of finite mask voxels (so one patchy map cannot shrink
 *                      the support for everyone, while a set whose maps all stop at
 *                      their own brain masks is not excluded wholesale);
 *   3. constant      — no variance over its own finite voxels;
 *   4. constant-on-support — no variance over the common support.
 * If the support then has fewer than `minSupport` voxels, the basis reports
 * `insufficient-support` and provides no distances (documented fallback: other
 * views keep working; nothing is placed).
 *
 * Excluded members keep their identity and remain available to other views;
 * their rows of `r` are NaN.
 */

export const BASIS_VERSION = 'common-support-pearson/1';

export type ExclusionReason = 'all-missing' | 'low-coverage' | 'constant' | 'constant-on-support' | 'insufficient-support';

export interface BasisOptions {
  /** Minimum coverage relative to the median member's coverage of the analysis mask. Default 0.9. */
  minCoverage?: number;
  /** Minimum number of common-support voxels needed to compare members. Default 30. */
  minSupport?: number;
  /** Labels that identify the source (model, contrast, statistic…); part of the key. */
  labels?: Record<string, string>;
  /** Description of the analysis mask, for provenance. */
  maskRule?: string;
}

export interface BasisExclusion {
  /** Member index in set order. */
  index: number;
  id: string;
  reason: ExclusionReason;
  detail: string;
}

export interface SimilarityBasis {
  /** Stable identity: version, data fingerprint, policy and labels. */
  key: string;
  version: typeof BASIS_VERSION;
  measure: 'pearson';
  dissimilarity: '1-r';
  scope: 'whole-mask';
  status: 'ok' | 'insufficient-support' | 'no-eligible-members';
  /** Member IDs in set order. */
  ids: string[];
  /** Set indices of eligible members, ascending. */
  eligible: number[];
  excluded: BasisExclusion[];
  /** Per member: fraction of analysis-mask voxels that are finite (absolute, not relative to the median). */
  coverage: Float64Array;
  /** Analysis-mask size (voxels). */
  maskVoxels: number;
  /** Mask positions of the common support. */
  support: Int32Array;
  /** k x k correlation over all members (row-major); NaN where either member is excluded; 1 on eligible diagonal. */
  r: Float64Array;
  /** m x m dissimilarity (1 - r) over eligible members, symmetric, zero diagonal. Empty unless status is ok. */
  dist: Float64Array;
  /** Data fingerprint used in the key. */
  fingerprint: string;
  params: Required<Omit<BasisOptions, 'labels' | 'maskRule'>> & { labels: Record<string, string>; maskRule: string };
}

/** Relative tolerance for treating r as exactly +/-1 (floating-point roundoff only). */
export const R_ROUNDOFF = 1e-12;

/** FNV-1a over a string, as 8 hex digits. */
export function fnv1a(text: string, seed = 0x811c9dc5): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Cheap content fingerprint of a set: member IDs, vector length and the float
 * bits of a strided sample of every member. Detects a dataset that changes
 * under the same labels; not a cryptographic hash.
 */
export function dataFingerprint(data: readonly Float32Array[], ids: readonly string[]): string {
  const bits = new Uint32Array(1);
  const f = new Float32Array(bits.buffer);
  let h = 0x811c9dc5;
  const mix = (x: number): void => {
    h ^= x;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let m = 0; m < data.length; m++) {
    const d = data[m];
    mix(d.length);
    const step = Math.max(1, Math.floor(d.length / 4096));
    for (let v = m % step; v < d.length; v += step) {
      f[0] = d[v];
      mix(bits[0]);
    }
  }
  return `${fnv1a(ids.join('\u0000'))}${h.toString(16).padStart(8, '0')}`;
}

/** Mean and sum of squared deviations over an index list (two-pass, float64). */
function moments(d: Float32Array, index: ArrayLike<number>): { mean: number; ss: number } {
  let s = 0;
  for (let t = 0; t < index.length; t++) s += d[index[t]];
  const mean = index.length ? s / index.length : NaN;
  let ss = 0;
  for (let t = 0; t < index.length; t++) {
    const x = d[index[t]] - mean;
    ss += x * x;
  }
  return { mean, ss };
}

/** True when a sum of squares is zero relative to the data's magnitude. */
function isConstant(ss: number, mean: number, n: number): boolean {
  if (n < 2) return true;
  const scale = Math.max(1e-300, mean * mean);
  return ss / n <= scale * 1e-20 || ss === 0;
}

/** Pearson r on a common index set, clamped to [-1, 1] only within roundoff. */
export function supportPearson(a: Float32Array, b: Float32Array, index: ArrayLike<number>, ma: { mean: number; ss: number }, mb: { mean: number; ss: number }): number {
  let cov = 0;
  for (let t = 0; t < index.length; t++) {
    const v = index[t];
    cov += (a[v] - ma.mean) * (b[v] - mb.mean);
  }
  const r = cov / Math.sqrt(ma.ss * mb.ss);
  if (!(Math.abs(r) <= 1 + 1e-9)) throw new Error(`correlation ${r} is outside [-1, 1] beyond roundoff`);
  if (r >= 1 - R_ROUNDOFF) return 1;
  if (r <= -1 + R_ROUNDOFF) return -1;
  return r;
}

const pct = (x: number): string => (x === 0 || x === 1 ? `${x * 100}%` : `${(x * 100).toFixed(x < 0.995 && x > 0.005 ? 0 : 1)}%`);

/**
 * Build the similarity basis for a set given as one masked vector per member
 * (all the same length, aligned voxel order; non-finite = missing).
 */
export function similarityBasis(data: readonly Float32Array[], ids: readonly string[], opts: BasisOptions = {}): SimilarityBasis {
  const k = data.length;
  if (ids.length !== k) throw new Error('one id per member is required');
  if (new Set(ids).size !== k) throw new Error('member ids must be unique');
  const V = k ? data[0].length : 0;
  for (const d of data) if (d.length !== V) throw new Error('set members have different lengths');
  const params = {
    minCoverage: opts.minCoverage ?? 0.9,
    minSupport: opts.minSupport ?? 30,
    labels: opts.labels ?? {},
    maskRule: opts.maskRule ?? 'analysis mask supplied by caller',
  };

  const coverage = new Float64Array(k);
  const excluded: BasisExclusion[] = [];
  const out = new Set<number>();
  const exclude = (i: number, reason: ExclusionReason, detail: string): void => {
    out.add(i);
    excluded.push({ index: i, id: ids[i], reason, detail });
  };

  const counts = new Float64Array(k);
  const sums = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const d = data[i];
    for (let v = 0; v < V; v++) {
      const x = d[v];
      if (Number.isFinite(x)) {
        counts[i]++;
        sums[i] += x;
      }
    }
    coverage[i] = V ? counts[i] / V : 0;
  }
  const covered = Array.from(coverage).filter((c) => c > 0).sort((x, y) => x - y);
  const h = covered.length >> 1;
  const medianCoverage = covered.length ? (covered.length % 2 ? covered[h] : (covered[h - 1] + covered[h]) / 2) : 0;
  for (let i = 0; i < k; i++) {
    const d = data[i];
    const c = counts[i];
    const s = sums[i];
    let ss = 0;
    if (c === 0) {
      exclude(i, 'all-missing', 'no finite value in the analysis mask');
      continue;
    }
    if (coverage[i] < params.minCoverage * medianCoverage) {
      exclude(i, 'low-coverage', `finite on ${pct(coverage[i])} of the mask, below ${pct(params.minCoverage)} of the median map's ${pct(medianCoverage)}`);
      continue;
    }
    const mean = s / c;
    for (let v = 0; v < V; v++) {
      const x = d[v];
      if (Number.isFinite(x)) ss += (x - mean) * (x - mean);
    }
    if (isConstant(ss, mean, c)) exclude(i, 'constant', `constant map (every finite value is ${mean})`);
  }

  // Common support over the remaining members; dropping a member constant on the
  // support can only enlarge it, so iterate to a fixed point (at most k rounds).
  let support = new Int32Array(0);
  let mom: ({ mean: number; ss: number } | null)[] = [];
  for (let round = 0; round <= k; round++) {
    const live = [...Array(k).keys()].filter((i) => !out.has(i));
    const keep: number[] = [];
    for (let v = 0; v < V; v++) {
      let ok = true;
      for (const i of live) {
        if (!Number.isFinite(data[i][v])) {
          ok = false;
          break;
        }
      }
      if (ok) keep.push(v);
    }
    support = Int32Array.from(keep);
    mom = data.map((d, i) => (out.has(i) ? null : moments(d, support)));
    let changed = false;
    if (support.length >= params.minSupport) {
      for (const i of live) {
        const m = mom[i]!;
        if (isConstant(m.ss, m.mean, support.length)) {
          exclude(i, 'constant-on-support', `constant over the ${support.length.toLocaleString()} common-support voxels`);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  let eligible = [...Array(k).keys()].filter((i) => !out.has(i));
  let status: SimilarityBasis['status'] = 'ok';
  if (eligible.length === 0) status = 'no-eligible-members';
  else if (support.length < params.minSupport) {
    status = 'insufficient-support';
    for (const i of eligible) exclude(i, 'insufficient-support', `common support has ${support.length} voxels (minimum ${params.minSupport})`);
    eligible = [];
  }
  excluded.sort((a, b) => a.index - b.index);

  const r = new Float64Array(k * k).fill(NaN);
  const m = eligible.length;
  const dist = new Float64Array(status === 'ok' ? m * m : 0);
  for (let p = 0; p < m; p++) {
    const i = eligible[p];
    r[i * k + i] = 1;
    for (let q = p + 1; q < m; q++) {
      const j = eligible[q];
      const rij = supportPearson(data[i], data[j], support, mom[i]!, mom[j]!);
      r[i * k + j] = rij;
      r[j * k + i] = rij;
      const dij = 1 - rij;
      dist[p * m + q] = dij;
      dist[q * m + p] = dij;
    }
  }

  const fingerprint = dataFingerprint(data, ids);
  const labelText = Object.keys(params.labels)
    .sort()
    .map((key) => `${key}=${params.labels[key]}`)
    .join(',');
  const key = `${BASIS_VERSION}|${fingerprint}|cov${params.minCoverage}|sup${params.minSupport}|V${V}|mask=${fnv1a(params.maskRule)}|${labelText}`;
  return {
    key,
    version: BASIS_VERSION,
    measure: 'pearson',
    dissimilarity: '1-r',
    scope: 'whole-mask',
    status,
    ids: [...ids],
    eligible,
    excluded,
    coverage,
    maskVoxels: V,
    support,
    r,
    dist,
    fingerprint,
    params,
  };
}

/** Correlation between two members by ID (NaN when either is excluded or unknown). */
export function basisR(b: SimilarityBasis, a: string, c: string): number {
  const i = b.ids.indexOf(a);
  const j = b.ids.indexOf(c);
  return i < 0 || j < 0 ? NaN : b.r[i * b.ids.length + j];
}
