/**
 * Decomposed correlation: the per-voxel terms whose sum is Pearson r.
 *
 * On a support of n voxels, standardise each map with the support mean and the
 * *population* SD (divide by n): z_a(v) = (a_v − mean_a) / sd_a. Then
 *
 *   contrib_v = z_a(v) · z_b(v) / n,   and   Σ_v contrib_v = r  (exactly, up to roundoff),
 *
 * because Σ z_a z_b / n = cov(a, b) / (sd_a · sd_b) with both moments taken with
 * divisor n. Positive terms are voxels where both maps sit on the same side of
 * their means (agreement); negative terms are voxels where they sit on opposite
 * sides (disagreement).
 *
 * The contributions are descriptive: they say where the value of r comes from on
 * this support. They are not significance tests and carry no p-values; a large
 * term at one voxel is not evidence that the voxel is "reliably" shared.
 *
 * Browser-safe and dependency-free (runs in a Web Worker).
 */

export interface PairContributions {
  /** Same length as the input maps; contrib_v on the support, NaN elsewhere. */
  contrib: Float32Array;
  /** Pearson r on the support (= Σ contrib, accumulated in double precision). */
  r: number;
  /** Sum of the positive contributions (agreement). */
  positive: number;
  /** Sum of the negative contributions (disagreement), ≤ 0. */
  negative: number;
  /** Number of support voxels. */
  n: number;
}

/**
 * Per-voxel contributions to Pearson r between `a` and `b` on `support`
 * (positions into `a`/`b`; every map value at those positions must be finite).
 * Throws if the support is empty, contains a non-finite value or out-of-range
 * position, or if either map is constant on it (r undefined).
 */
export function pairContributions(a: Float32Array, b: Float32Array, support: ArrayLike<number>): PairContributions {
  if (a.length !== b.length) throw new Error(`pairContributions: maps differ in length (${a.length} vs ${b.length})`);
  const n = support.length;
  if (n === 0) throw new Error('pairContributions: empty support');
  let sa = 0;
  let sb = 0;
  for (let k = 0; k < n; k++) {
    const v = support[k];
    if (!(v >= 0 && v < a.length) || !Number.isInteger(v)) {
      throw new Error(`pairContributions: support position ${v} is not a valid index`);
    }
    const x = a[v];
    const y = b[v];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`pairContributions: non-finite value at support position ${v}`);
    }
    sa += x;
    sb += y;
  }
  const ma = sa / n;
  const mb = sb / n;
  let va = 0;
  let vb = 0;
  for (let k = 0; k < n; k++) {
    const v = support[k];
    const x = a[v] - ma;
    const y = b[v] - mb;
    va += x * x;
    vb += y * y;
  }
  const sda = Math.sqrt(va / n);
  const sdb = Math.sqrt(vb / n);
  // Relative test: a map whose spread is pure roundoff of its mean is constant.
  const tiny = (m: number) => 1e-12 * Math.max(1, Math.abs(m));
  if (!(sda > tiny(ma))) throw new Error('pairContributions: first map is constant on the support (r undefined)');
  if (!(sdb > tiny(mb))) throw new Error('pairContributions: second map is constant on the support (r undefined)');

  const contrib = new Float32Array(a.length).fill(NaN);
  let positive = 0;
  let negative = 0;
  for (let k = 0; k < n; k++) {
    const v = support[k];
    const c = (((a[v] - ma) / sda) * ((b[v] - mb) / sdb)) / n;
    contrib[v] = c;
    if (c > 0) positive += c;
    else negative += c;
  }
  return { contrib, r: positive + negative, positive, negative, n };
}

/**
 * Sum of `contrib` over `positions` (e.g. the support voxels of one slice), skipping
 * NaN entries and out-of-range positions. Dividing by the pair's r gives the share
 * of r from that subset.
 */
export function sumOver(contrib: ArrayLike<number>, positions: ArrayLike<number>): number {
  let s = 0;
  for (let k = 0; k < positions.length; k++) {
    const v = positions[k];
    if (!(v >= 0 && v < contrib.length)) continue;
    const c = contrib[v];
    if (Number.isFinite(c)) s += c;
  }
  return s;
}
