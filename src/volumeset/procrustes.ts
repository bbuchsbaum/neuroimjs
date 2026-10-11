/**
 * Presentation alignment of 2D layouts: least-squares similarity Procrustes.
 *
 * Given source points p_k and target points q_k (interleaved x,y), find a scale
 * s ≥ 0, an orthogonal 2×2 matrix R (a rotation, or with `reflection` a rotation
 * composed with a reflection) and a translation t minimising
 *
 *   Σ_k | s·R·p_k + t − q_k |².
 *
 * With both sets centred (p̃, q̃), the 2×2 orthogonal Procrustes problem has a
 * closed form equivalent to the SVD solution: for a rotation by θ the objective
 * depends on θ only through C·cosθ + S·sinθ with C = Σ(p̃ₓq̃ₓ + p̃ᵧq̃ᵧ) and
 * S = Σ(p̃ₓq̃ᵧ − p̃ᵧq̃ₓ), maximised at θ = atan2(S, C) with value √(C² + S²) (the sum
 * of singular values of the cross-covariance). The reflected branch is the same
 * problem after flipping the source y-axis; the branch with the larger value wins
 * (ties keep the proper rotation). Then s = value / Σ|p̃|² and t = q̄ − s·R·p̄.
 *
 * This is a display transform only: it changes the pose of a layout, never its
 * inter-point distance ratios. Degenerate inputs (no points, one point, all
 * source points coincident) fall back to a translation of the centroid with
 * R = I and s = 1, so the output is always finite.
 *
 * Browser-safe and dependency-free (runs in a Web Worker).
 */

export interface ProcrustesOptions {
  /** Fit a uniform scale (default true). If false, s = 1. */
  scale?: boolean;
  /** Allow an improper (reflecting) R (default true). */
  reflection?: boolean;
}

export interface ProcrustesResult {
  /** Transformed source points, interleaved, length 2n. */
  aligned: Float64Array;
  /** R in row-major order [r00, r01, r10, r11]; x' = s·R·p + t. */
  rotation: [number, number, number, number];
  scale: number;
  translation: [number, number];
  /** Root mean squared distance between aligned and target points (0 when n = 0). */
  rmsd: number;
}

interface Transform {
  rotation: [number, number, number, number];
  scale: number;
  translation: [number, number];
}

function applyTransform(coords: ArrayLike<number>, tf: Transform): Float64Array {
  const [r00, r01, r10, r11] = tf.rotation;
  const s = tf.scale;
  const [tx, ty] = tf.translation;
  const n = coords.length >> 1;
  const out = new Float64Array(2 * n);
  for (let k = 0; k < n; k++) {
    const x = coords[2 * k];
    const y = coords[2 * k + 1];
    out[2 * k] = s * (r00 * x + r01 * y) + tx;
    out[2 * k + 1] = s * (r10 * x + r11 * y) + ty;
  }
  return out;
}

/** Fit the transform on matched point lists (index k of `src` ↔ index k of `tgt`). */
function fitTransform(src: ArrayLike<number>, tgt: ArrayLike<number>, opts: ProcrustesOptions): Transform {
  const n = src.length >> 1;
  if (n === 0) return { rotation: [1, 0, 0, 1], scale: 1, translation: [0, 0] };
  let px = 0;
  let py = 0;
  let qx = 0;
  let qy = 0;
  for (let k = 0; k < n; k++) {
    px += src[2 * k];
    py += src[2 * k + 1];
    qx += tgt[2 * k];
    qy += tgt[2 * k + 1];
  }
  px /= n;
  py /= n;
  qx /= n;
  qy /= n;
  let ss = 0; // Σ|p̃|²
  let c = 0; // rotation branch
  let sn = 0;
  let cr = 0; // reflected branch (source y flipped)
  let snr = 0;
  for (let k = 0; k < n; k++) {
    const a = src[2 * k] - px;
    const b = src[2 * k + 1] - py;
    const u = tgt[2 * k] - qx;
    const v = tgt[2 * k + 1] - qy;
    ss += a * a + b * b;
    c += a * u + b * v;
    sn += a * v - b * u;
    cr += a * u - b * v;
    snr += a * v + b * u;
  }
  // Collapsed when the spread is roundoff relative to the centroid's magnitude.
  if (!(ss > 1e-24 * n * (1 + px * px + py * py))) {
    // Source collapsed to a point: only the translation is identifiable.
    return { rotation: [1, 0, 0, 1], scale: 1, translation: [qx - px, qy - py] };
  }
  const val = Math.hypot(c, sn);
  const valR = Math.hypot(cr, snr);
  let rotation: [number, number, number, number];
  let value: number;
  if (opts.reflection !== false && valR > val * (1 + 1e-12)) {
    const th = Math.atan2(snr, cr);
    const co = Math.cos(th);
    const si = Math.sin(th);
    // R = Rot(θ) · diag(1, −1)
    rotation = [co, si, si, -co];
    value = valR;
  } else {
    const th = Math.atan2(sn, c);
    const co = Math.cos(th);
    const si = Math.sin(th);
    rotation = [co, -si, si, co];
    value = val;
  }
  const s = opts.scale === false ? 1 : value / ss;
  const [r00, r01, r10, r11] = rotation;
  const translation: [number, number] = [qx - s * (r00 * px + r01 * py), qy - s * (r10 * px + r11 * py)];
  return { rotation, scale: s, translation };
}

function rmsdOf(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length >> 1;
  if (n === 0) return 0;
  let s = 0;
  for (let k = 0; k < 2 * n; k++) {
    const d = a[k] - b[k];
    s += d * d;
  }
  return Math.sqrt(s / n);
}

/**
 * Least-squares similarity transform of `source` onto `target` (both interleaved,
 * length 2n, matched by index). See the module comment for the definition.
 */
export function procrustesAlign(
  source: ArrayLike<number>,
  target: ArrayLike<number>,
  opts: ProcrustesOptions = {},
): ProcrustesResult {
  if (source.length !== target.length || source.length % 2 !== 0) {
    throw new Error(`procrustesAlign: source and target must be interleaved 2n arrays of equal length`);
  }
  const tf = fitTransform(source, target, opts);
  const aligned = applyTransform(source, tf);
  return { aligned, ...tf, rmsd: rmsdOf(aligned, target) };
}

export interface AlignByIdResult extends ProcrustesResult {
  /** Number of ids present in both layouts (the points the transform was fitted on). */
  shared: number;
  /** Set when fewer than 2 ids are shared and the transform was reduced. */
  note?: string;
}

/**
 * Align a source layout onto a target layout by member id. The transform is fitted
 * on the ids present in both, then applied to every source point (ids absent from
 * the target are transformed too). `aligned` is in source order; `rmsd` is over the
 * shared ids. With exactly one shared id the fit is translation-only; with none it
 * is the identity; `note` says which.
 */
export function alignById(
  sourceIds: readonly string[],
  sourceCoords: ArrayLike<number>,
  targetIds: readonly string[],
  targetCoords: ArrayLike<number>,
  opts: ProcrustesOptions = {},
): AlignByIdResult {
  if (sourceCoords.length !== 2 * sourceIds.length) throw new Error('alignById: sourceCoords must have 2 entries per source id');
  if (targetCoords.length !== 2 * targetIds.length) throw new Error('alignById: targetCoords must have 2 entries per target id');
  const tIndex = new Map<string, number>();
  targetIds.forEach((id, k) => {
    if (!tIndex.has(id)) tIndex.set(id, k);
  });
  const src: number[] = [];
  const tgt: number[] = [];
  const seen = new Set<string>();
  sourceIds.forEach((id, k) => {
    const t = tIndex.get(id);
    if (t === undefined || seen.has(id)) return;
    seen.add(id);
    src.push(sourceCoords[2 * k], sourceCoords[2 * k + 1]);
    tgt.push(targetCoords[2 * t], targetCoords[2 * t + 1]);
  });
  const shared = src.length >> 1;
  let tf: Transform;
  let note: string | undefined;
  if (shared === 0) {
    tf = { rotation: [1, 0, 0, 1], scale: 1, translation: [0, 0] };
    note = 'no shared ids: identity transform';
  } else if (shared === 1) {
    tf = { rotation: [1, 0, 0, 1], scale: 1, translation: [tgt[0] - src[0], tgt[1] - src[1]] };
    note = 'one shared id: translation only';
  } else {
    tf = fitTransform(src, tgt, opts);
  }
  const aligned = applyTransform(sourceCoords, tf);
  const result: AlignByIdResult = { aligned, ...tf, rmsd: rmsdOf(applyTransform(src, tf), tgt), shared };
  if (note) result.note = note;
  return result;
}
