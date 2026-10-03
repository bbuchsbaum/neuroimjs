/**
 * Header interpretation shared by the Node (`io.ts`) and browser
 * (`browserNifti.ts`) NIfTI decoders, so the two cannot drift apart.
 * Internal module: not part of the public API.
 */

/**
 * Effective NIfTI intensity scaling.
 *
 * Per the NIfTI-1 spec (and nibabel), a `scl_slope` of 0 or a non-finite slope
 * disables scaling entirely: the stored values are used as-is and `scl_inter`
 * is ignored as well. A non-finite `scl_inter` paired with a valid slope is
 * treated as 0. Returns `{ slope: 1, inter: 0 }` when no scaling applies.
 */
export function niftiScaling(rawSlope: unknown, rawInter: unknown): { slope: number; inter: number } {
  const slope = Number(rawSlope);
  if (!Number.isFinite(slope) || slope === 0) return { slope: 1, inter: 0 };
  const inter = Number(rawInter);
  return { slope, inter: Number.isFinite(inter) ? inter : 0 };
}
