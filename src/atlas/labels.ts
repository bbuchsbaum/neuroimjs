import type { NeuroVol } from '../volume/NeuroVol';

/**
 * Largest distance from the nearest integer that is still accepted as an
 * integer label. Covers float rounding in label volumes written as float32 or
 * produced by `scl_slope`/`scl_inter` scaling; anything further off is treated
 * as a non-label value.
 */
const INTEGRAL_TOLERANCE = 1e-4;

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/**
 * Convert a label volume (or its voxel data) to an `Int32Array` of labels.
 *
 * Values are converted one by one, never by reinterpreting the underlying
 * buffer, so every typed-array type (int8/uint8/int16/uint16/int32/uint32/
 * float32/float64, any `byteOffset`) and plain arrays are handled. Volumes
 * read with {@link readVol} already have `scl_slope`/`scl_inter` applied, so
 * the values seen here are the scaled ones.
 *
 * Floating-point values within 1e-4 of an integer are rounded to it.
 *
 * @param source - A `NeuroVol` or its voxel data.
 * @returns A new `Int32Array` (or `source` itself when it is already an
 *   `Int32Array`).
 * @throws {Error} If a value is not finite (NaN, ±Infinity), not an integer,
 *   or outside the int32 range. The message gives the voxel index and value.
 */
export function toInt32Labels(source: NeuroVol | ArrayLike<number>): Int32Array {
  const data: ArrayLike<number> = isNeuroVol(source) ? source.getData() : source;
  if (data instanceof Int32Array) return data;

  const n = data.length;
  const out = new Int32Array(n);
  const exact =
    data instanceof Int8Array ||
    data instanceof Uint8Array ||
    data instanceof Uint8ClampedArray ||
    data instanceof Int16Array ||
    data instanceof Uint16Array;
  if (exact) {
    for (let i = 0; i < n; i++) out[i] = data[i];
    return out;
  }

  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) {
      throw new Error(
        `Label volume contains a non-finite value (${v}) at voxel ${i}; labels must be finite integers.`
      );
    }
    const r = Math.round(v);
    if (Math.abs(v - r) > INTEGRAL_TOLERANCE) {
      throw new Error(
        `Label volume contains a non-integer value (${v}) at voxel ${i}; ` +
          'labels must be integers (check the scl_slope/scl_inter of the file).'
      );
    }
    if (r < INT32_MIN || r > INT32_MAX) {
      throw new Error(
        `Label volume value ${v} at voxel ${i} is outside the int32 range.`
      );
    }
    out[i] = r;
  }
  return out;
}

function isNeuroVol(x: unknown): x is NeuroVol {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { getData?: unknown }).getData === 'function' &&
    'space' in x
  );
}
