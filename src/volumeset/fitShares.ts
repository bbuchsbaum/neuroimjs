/**
 * Per-map fit diagnostics for a 2D embedding: each map's share of the stress
 * numerator.
 *
 * With pair distances d_ij and disparities d̂_ij (i < j, row-major pair order as
 * in `nmds.ts`), the stress numerator is Σ_{i<j} (d_ij − d̂_ij)². Each pair's
 * squared residual is split equally between its two members, and the per-member
 * totals are normalised to sum to 1:
 *
 *   share_i = ½ Σ_{j≠i} (d_ij − d̂_ij)² / Σ_{i<j} (d_ij − d̂_ij)².
 *
 * This is the share of the stress numerator attributable to each map: a relative,
 * descriptive measure of where the misfit lives. It is not a quality score and has
 * no "good" or "bad" cutoff (shares average 1/n by construction). Pairs with a
 * non-finite residual are skipped. If the numerator is 0 (perfect fit) every
 * share is 0.
 *
 * Browser-safe and dependency-free.
 */
export function stressShares(distances: ArrayLike<number>, disparities: ArrayLike<number>, n: number): Float64Array {
  const m = (n * (n - 1)) / 2;
  if (!Number.isInteger(n) || n < 0) throw new Error(`stressShares: n must be a non-negative integer`);
  if (distances.length !== m || disparities.length !== m) {
    throw new Error(`stressShares: expected ${m} pairs for n = ${n}`);
  }
  const shares = new Float64Array(n);
  let total = 0;
  let p = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++, p++) {
      const r = distances[p] - disparities[p];
      const r2 = r * r;
      if (!Number.isFinite(r2)) continue;
      shares[i] += r2 / 2;
      shares[j] += r2 / 2;
      total += r2;
    }
  }
  if (total > 0) for (let i = 0; i < n; i++) shares[i] /= total;
  else shares.fill(0);
  return shares;
}
