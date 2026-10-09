/**
 * Mask-aware guided smoothing for display.
 *
 * Guided filter (He, Sun & Tang, 2013) with normalized convolution, so voxels
 * outside the mask (or non-finite) neither contribute nor receive values. Box
 * filters use running sums: cost is O(voxels) independent of the radius, and
 * work is restricted to the mask's bounding box.
 *
 * - Self-guided (guide = the map itself): edge-preserving in value space,
 *   much like a bilateral filter. Flat noisy regions are averaged; strong,
 *   coherent clusters keep their amplitude. `epsilon` is in units of the
 *   map's in-mask variance (the map is z-scored as its own guide).
 * - Anatomy-guided (guide = e.g. a T1): smoothing follows the guide's tissue
 *   boundaries. On typical fMRI t-maps this behaves close to a masked box
 *   mean, so it denoises more and attenuates thin clusters more.
 *
 * Weights are normalized, so a constant map is returned unchanged.
 */

export interface GuidedSmoothOptions {
  /** Box radius in voxels (window = 2r+1). */
  radius: number;
  /** Regularisation, relative to the (z-scored) guide variance. Larger = closer to a plain masked mean. */
  epsilon: number;
  /**
   * Fixed centre/scale for z-scoring the guide. By default each map is scaled
   * by its own in-mask SD, so for self-guided smoothing the effective strength
   * varies with each map's variance. Pass pooled values (e.g. across a set of
   * subjects) to smooth every map with the same strength.
   */
  guideScale?: { mean: number; sd: number };
}

interface Box {
  /** Bounding-box origin and size in the full grid. */
  o: [number, number, number];
  d: [number, number, number];
}

function boundingBox(dim: readonly number[], maskIndex: Int32Array, pad: number): Box {
  const [nx, ny, nz] = dim;
  let x0 = nx;
  let y0 = ny;
  let z0 = nz;
  let x1 = -1;
  let y1 = -1;
  let z1 = -1;
  for (let m = 0; m < maskIndex.length; m++) {
    const g = maskIndex[m];
    const i = g % nx;
    const j = Math.floor(g / nx) % ny;
    const k = Math.floor(g / (nx * ny));
    if (i < x0) x0 = i;
    if (i > x1) x1 = i;
    if (j < y0) y0 = j;
    if (j > y1) y1 = j;
    if (k < z0) z0 = k;
    if (k > z1) z1 = k;
  }
  if (x1 < 0) return { o: [0, 0, 0], d: [1, 1, 1] };
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  z0 = Math.max(0, z0 - pad);
  x1 = Math.min(nx - 1, x1 + pad);
  y1 = Math.min(ny - 1, y1 + pad);
  z1 = Math.min(nz - 1, z1 + pad);
  return { o: [x0, y0, z0], d: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1] };
}

/** In-place running-sum box filter (window sums, not means) along one axis of a cropped grid. */
function box1d(a: Float32Array, d: readonly number[], r: number, axis: 0 | 1 | 2, buf: Float64Array): void {
  const [nx, ny, nz] = d;
  const len = axis === 0 ? nx : axis === 1 ? ny : nz;
  const stride = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  const lines = (nx * ny * nz) / len;
  for (let l = 0; l < lines; l++) {
    let base: number;
    if (axis === 0) base = l * nx;
    else if (axis === 1) base = (l % nx) + Math.floor(l / nx) * nx * ny;
    else base = l;
    for (let t = 0; t < len; t++) buf[t] = a[base + t * stride];
    let sum = 0;
    for (let t = 0; t <= Math.min(r, len - 1); t++) sum += buf[t];
    for (let t = 0; t < len; t++) {
      a[base + t * stride] = sum;
      const add = t + r + 1;
      const rem = t - r;
      if (add < len) sum += buf[add];
      if (rem >= 0) sum -= buf[rem];
    }
  }
}

function boxSum3(a: Float32Array, d: readonly number[], r: number, buf: Float64Array): void {
  box1d(a, d, r, 0, buf);
  box1d(a, d, r, 1, buf);
  box1d(a, d, r, 2, buf);
}

/**
 * Masked mean over a (2r+1)^3 box on a full grid: sum(x*w) / sum(w).
 * Kept for callers that want a plain masked box mean.
 */
export function maskedBoxMean(dim: readonly number[], src: Float32Array, weight: Float32Array, radius: number): Float32Array {
  const n = dim[0] * dim[1] * dim[2];
  const num = new Float32Array(n);
  const den = Float32Array.from(weight);
  for (let g = 0; g < n; g++) num[g] = weight[g] ? src[g] * weight[g] : 0;
  const buf = new Float64Array(Math.max(dim[0], dim[1], dim[2]));
  boxSum3(num, dim, radius, buf);
  boxSum3(den, dim, radius, buf);
  const out = new Float32Array(n);
  for (let g = 0; g < n; g++) out[g] = den[g] > 1e-6 ? num[g] / den[g] : 0;
  return out;
}

/**
 * Guided smoothing of a masked map.
 * @param dim grid dimensions
 * @param maskIndex grid indices of in-mask voxels (defines both input and output)
 * @param values in-mask values (NaN treated as missing)
 * @param guide full-grid guide image (e.g. a T1), or 'self' to use the map as its own guide
 */
export function guidedSmooth(
  dim: readonly number[],
  maskIndex: Int32Array,
  values: Float32Array,
  guide: ArrayLike<number> | 'self',
  opts: GuidedSmoothOptions
): Float32Array {
  const r = Math.max(1, Math.round(opts.radius));
  const bb = boundingBox(dim, maskIndex, r);
  const [nx, ny] = dim;
  const [ox, oy, oz] = bb.o;
  const [cx, cy, cz] = bb.d;
  const n = cx * cy * cz;
  // Map each in-mask voxel to its position in the cropped grid.
  const pos = new Int32Array(maskIndex.length);
  for (let m = 0; m < maskIndex.length; m++) {
    const g = maskIndex[m];
    const i = (g % nx) - ox;
    const j = (Math.floor(g / nx) % ny) - oy;
    const k = Math.floor(g / (nx * ny)) - oz;
    pos[m] = i + j * cx + k * cx * cy;
  }
  // Guide values for in-mask voxels, z-scored within the mask.
  const gv = new Float32Array(maskIndex.length);
  let gs = 0;
  let gss = 0;
  let gc = 0;
  for (let m = 0; m < maskIndex.length; m++) {
    const x = guide === 'self' ? values[m] : guide[maskIndex[m]];
    gv[m] = x;
    if (Number.isFinite(x) && Number.isFinite(values[m])) {
      gs += x;
      gss += x * x;
      gc++;
    }
  }
  const gm = opts.guideScale ? opts.guideScale.mean : gc ? gs / gc : 0;
  const gsd = opts.guideScale ? Math.max(1e-12, opts.guideScale.sd) : gc > 1 ? Math.sqrt(Math.max(1e-12, gss / gc - gm * gm)) : 1;

  const w = new Float32Array(n);
  const I = new Float32Array(n);
  const p = new Float32Array(n);
  for (let m = 0; m < maskIndex.length; m++) {
    const v = values[m];
    if (!Number.isFinite(v) || !Number.isFinite(gv[m])) continue;
    const c = pos[m];
    w[c] = 1;
    p[c] = v;
    I[c] = (gv[m] - gm) / gsd;
  }
  const buf = new Float64Array(Math.max(cx, cy, cz));
  const d = bb.d;
  // Shared denominator: number of in-mask voxels per window.
  const den = Float32Array.from(w);
  boxSum3(den, d, r, buf);
  const mean = (src: Float32Array): Float32Array => {
    const a = new Float32Array(n);
    for (let c = 0; c < n; c++) a[c] = w[c] ? src[c] : 0;
    boxSum3(a, d, r, buf);
    for (let c = 0; c < n; c++) a[c] = den[c] > 1e-6 ? a[c] / den[c] : 0;
    return a;
  };
  const II = new Float32Array(n);
  const Ip = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    II[c] = I[c] * I[c];
    Ip[c] = I[c] * p[c];
  }
  const mI = mean(I);
  const mp = mean(p);
  const mII = mean(II);
  const mIp = mean(Ip);
  // Reuse buffers for the per-window linear coefficients.
  const A = II;
  const B = Ip;
  for (let c = 0; c < n; c++) {
    if (!w[c]) {
      A[c] = 0;
      B[c] = 0;
      continue;
    }
    const varI = mII[c] - mI[c] * mI[c];
    const cov = mIp[c] - mI[c] * mp[c];
    A[c] = cov / (varI + opts.epsilon);
    B[c] = mp[c] - A[c] * mI[c];
  }
  const mA = mean(A);
  const mB = mean(B);
  const out = new Float32Array(maskIndex.length);
  for (let m = 0; m < maskIndex.length; m++) {
    const c = pos[m];
    out[m] = w[c] ? mA[c] * I[c] + mB[c] : NaN;
  }
  return out;
}

/**
 * Display smoothing presets. Self-guided presets are meant to be run with a
 * pooled `guideScale` so every member of a set is smoothed equally; their
 * effect on amplitude and extent depends on the data and should be measured
 * per set (see `smoothingEffect`), not quoted as a constant.
 */
export const SMOOTH_PRESETS = {
  /** Self-guided, light: mostly removes isolated speckle. */
  light: { guide: 'self', radius: 1, epsilon: 0.25 },
  /** Self-guided, medium: stronger denoising; erodes cluster edges. */
  medium: { guide: 'self', radius: 1, epsilon: 1 },
  /** Anatomy-guided (template T1): close to a 3x3x3 masked mean; blurs, can flip weak voxels. */
  strong: { guide: 'anatomy', radius: 1, epsilon: 0.01 },
} as const;
export type SmoothPreset = keyof typeof SMOOTH_PRESETS;

export interface SmoothingEffect {
  /** Median over members of smoothed/raw at each member's top-1% |raw| voxels (sign-aware sum ratio). */
  peakKept: number;
  peakKeptMin: number;
  /** Member index with the lowest peakKept. */
  peakKeptWorst: number;
  /** Median over members of (#|smoothed| >= thr) / (#|raw| >= thr). */
  extentKept: number;
  extentKeptRange: [number, number];
  /** Member index with the lowest extentKept. */
  extentKeptWorst: number;
  /** Fraction of displayed suprathreshold voxels whose raw value is sub-threshold or of opposite sign. */
  disagree: number;
}

/** k-th smallest value (0-based) of an array, in expected O(n); reorders `a`. */
function quickselect(a: Float32Array, k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}

/** Measure what smoothing did to a set of maps (raw vs smoothed, same voxel order). O(voxels) per member. */
export function smoothingEffect(raw: readonly Float32Array[], smooth: readonly Float32Array[], thr: number): SmoothingEffect {
  const med = (a: number[]): number => {
    const s = a.filter(Number.isFinite).sort((x, y) => x - y);
    if (!s.length) return NaN;
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  const argmin = (a: number[]): number => {
    let b = -1;
    for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && (b < 0 || a[i] < a[b])) b = i;
    return b;
  };
  const peak: number[] = [];
  const extent: number[] = [];
  let shown = 0;
  let bad = 0;
  raw.forEach((r, i) => {
    const sm = smooth[i];
    const abs = new Float32Array(r.length);
    let n = 0;
    for (let v = 0; v < r.length; v++) if (Number.isFinite(r[v])) abs[n++] = Math.abs(r[v]);
    const top = Math.max(1, Math.floor(n * 0.01));
    // Threshold for the top-1% |raw| voxels (ties at the cut are included).
    const cut = n ? quickselect(abs.subarray(0, n), n - top) : Infinity;
    let num = 0;
    let den = 0;
    let nr = 0;
    let ns = 0;
    for (let v = 0; v < r.length; v++) {
      const x = r[v];
      if (!Number.isFinite(x)) continue;
      const ax = Math.abs(x);
      if (ax >= cut) {
        num += sm[v] * Math.sign(x);
        den += ax;
      }
      if (ax >= thr) nr++;
      if (Math.abs(sm[v]) >= thr) {
        ns++;
        shown++;
        if (!(ax >= thr) || Math.sign(x) !== Math.sign(sm[v])) bad++;
      }
    }
    peak.push(den > 0 ? num / den : NaN);
    extent.push(nr > 0 ? ns / nr : NaN);
  });
  const ext = extent.filter(Number.isFinite);
  const pw = argmin(peak);
  const ew = argmin(extent);
  return {
    peakKept: med(peak),
    peakKeptMin: pw >= 0 ? peak[pw] : NaN,
    peakKeptWorst: pw,
    extentKept: med(extent),
    extentKeptRange: [Math.min(...ext), Math.max(...ext)],
    extentKeptWorst: ew,
    disagree: shown ? bad / shown : 0,
  };
}
