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

/**
 * Voxel sizes implied by a 4x4 voxel-to-world affine: the Euclidean norms of
 * its first three columns. This is what nibabel reports as the zooms of the
 * selected transform. Unlike `pixdim[1..3]` it always agrees with the affine,
 * including when the sform's scaling differs from pixdim.
 */
export function affineVoxelSizes(affine: ArrayLike<ArrayLike<number>>): number[] {
  return [0, 1, 2].map(column =>
    Math.hypot(Number(affine[0][column]), Number(affine[1][column]), Number(affine[2][column]))
  );
}
