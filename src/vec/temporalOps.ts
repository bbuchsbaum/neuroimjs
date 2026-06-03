/**
 * Shared, pure temporal-reduction helpers for 4D NeuroVec time series.
 *
 * These functions operate on a single voxel time series supplied as any
 * `ArrayLike<number>` (e.g. `number[]`, `Float32Array`, `Float64Array`). They
 * are deliberately written with explicit loops and never use argument spreading
 * (`Math.min(...series)` / `Math.max(...series)`), so they remain safe on very
 * long series that would otherwise overflow the JS call-stack argument limit.
 *
 * NaN behaviour (documented and consistent across all helpers):
 * - These helpers do NOT special-case `NaN`. Inputs are assumed to be finite
 *   numeric samples (the existing NeuroVec implementations they replace made the
 *   same assumption).
 * - `seriesMean` / `seriesStd`: a `NaN` sample propagates to the result via the
 *   running sum, yielding `NaN`.
 * - `seriesMin` / `seriesMax`: comparisons against `NaN` are always false, so a
 *   `NaN` is simply skipped and the min/max of the remaining values is returned;
 *   an all-`NaN` (or empty) series returns `+Infinity` / `-Infinity`
 *   respectively (matching the identity element of the reduction).
 * - `seriesMedian`: `NaN` sorts to the end (the comparator returns 0 for any
 *   pair involving `NaN`), so results are unspecified if `NaN` is present.
 *
 * Empty-series behaviour:
 * - `seriesMean` -> `NaN` (0 / 0)
 * - `seriesStd`  -> `NaN`
 * - `seriesMin`  -> `Infinity`, `seriesMax` -> `-Infinity`
 * - `seriesMedian` -> `NaN`
 */

/**
 * Arithmetic mean of a time series.
 */
export function seriesMean(data: ArrayLike<number>): number {
  const n = data.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += data[i];
  }
  return sum / n;
}

/**
 * Sample standard deviation (n - 1 denominator, i.e. Bessel-corrected).
 *
 * This is the convention already used throughout the NeuroVec implementations;
 * it is applied uniformly here.
 */
export function seriesStd(data: ArrayLike<number>): number {
  const n = data.length;
  const m = seriesMean(data);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = data[i] - m;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / (n - 1));
}

/**
 * Minimum value of a time series.
 *
 * Uses an explicit loop (no `Math.min(...spread)`) so it is safe for arbitrarily
 * long series.
 */
export function seriesMin(data: ArrayLike<number>): number {
  const n = data.length;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v < min) {
      min = v;
    }
  }
  return min;
}

/**
 * Maximum value of a time series.
 *
 * Uses an explicit loop (no `Math.max(...spread)`) so it is safe for arbitrarily
 * long series.
 */
export function seriesMax(data: ArrayLike<number>): number {
  const n = data.length;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v > max) {
      max = v;
    }
  }
  return max;
}

/**
 * Median of a time series.
 *
 * Copies the input before sorting, so the caller's array is never mutated.
 * For an even-length series returns the average of the two central values.
 */
export function seriesMedian(data: ArrayLike<number>): number {
  const n = data.length;
  if (n === 0) {
    return NaN;
  }
  // Copy before sorting so the caller's data is never mutated.
  const sorted = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sorted[i] = data[i];
  }
  sorted.sort();
  const mid = n >> 1;
  return n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
