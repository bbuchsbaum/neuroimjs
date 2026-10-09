/**
 * Set-level statistics over aligned, masked volumes.
 *
 * Every function takes `data`: one Float32Array per set member, all of the
 * same length (the in-mask voxels, in the same order). Non-finite values are
 * treated as missing and skipped pairwise.
 */

export type SetData = readonly Float32Array[];

function checkData(data: SetData): number {
  if (data.length === 0) throw new Error('volume set is empty');
  const n = data[0].length;
  for (const d of data) {
    if (d.length !== n) throw new Error('set members have different lengths');
  }
  return n;
}

/** Voxelwise mean across members (NaN where no member is finite). */
export function setMean(data: SetData): Float32Array {
  const n = checkData(data);
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let s = 0;
    let c = 0;
    for (const d of data) {
      const x = d[v];
      if (Number.isFinite(x)) {
        s += x;
        c++;
      }
    }
    out[v] = c > 0 ? s / c : NaN;
  }
  return out;
}

/** Voxelwise one-sample t (mean / (sd / sqrt(k))) across members. */
export function setOneSampleT(data: SetData): Float32Array {
  const n = checkData(data);
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let s = 0;
    let ss = 0;
    let c = 0;
    for (const d of data) {
      const x = d[v];
      if (Number.isFinite(x)) {
        s += x;
        ss += x * x;
        c++;
      }
    }
    if (c < 2) {
      out[v] = NaN;
      continue;
    }
    const m = s / c;
    const variance = (ss - c * m * m) / (c - 1);
    out[v] = variance > 0 ? m / Math.sqrt(variance / c) : NaN;
  }
  return out;
}

/**
 * Signed prevalence: fraction of members with value > thr minus fraction with
 * value < -thr. Ranges over [-1, 1]; +1 means every member exceeds +thr.
 */
export function setPrevalence(data: SetData, thr: number): Float32Array {
  const n = checkData(data);
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let pos = 0;
    let neg = 0;
    let c = 0;
    for (const d of data) {
      const x = d[v];
      if (!Number.isFinite(x)) continue;
      c++;
      if (x > thr) pos++;
      else if (x < -thr) neg++;
    }
    out[v] = c > 0 ? (pos - neg) / c : NaN;
  }
  return out;
}

/** Pearson correlation of two vectors over an optional index subset. */
export function pearson(a: Float32Array, b: Float32Array, index?: ArrayLike<number>): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  const len = index ? index.length : a.length;
  for (let k = 0; k < len; k++) {
    const i = index ? index[k] : k;
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++;
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
  }
  if (n < 3) return NaN;
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN;
}

/** Symmetric member x member correlation matrix (row-major, length k*k). */
export function correlationMatrix(data: SetData, index?: ArrayLike<number>): Float64Array {
  checkData(data);
  const k = data.length;
  const out = new Float64Array(k * k);
  for (let i = 0; i < k; i++) {
    out[i * k + i] = 1;
    for (let j = i + 1; j < k; j++) {
      const r = pearson(data[i], data[j], index);
      out[i * k + j] = r;
      out[j * k + i] = r;
    }
  }
  return out;
}

/**
 * Correlation of each member with the mean of the *other* members.
 * Using the leave-one-out mean avoids inflating each member's similarity by
 * its own contribution, which matters most at small set sizes.
 */
export function looSimilarity(data: SetData, index?: ArrayLike<number>): Float64Array {
  const n = checkData(data);
  const k = data.length;
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  for (const d of data) {
    for (let v = 0; v < n; v++) {
      const x = d[v];
      if (Number.isFinite(x)) {
        sum[v] += x;
        count[v]++;
      }
    }
  }
  const out = new Float64Array(k);
  const loo = new Float32Array(n);
  for (let i = 0; i < k; i++) {
    const d = data[i];
    for (let v = 0; v < n; v++) {
      const x = d[v];
      const own = Number.isFinite(x);
      const c = count[v] - (own ? 1 : 0);
      loo[v] = c > 0 ? (sum[v] - (own ? x : 0)) / c : NaN;
    }
    out[i] = pearson(d, loo, index);
  }
  return out;
}

/** Root-mean-square distance of each member from the leave-one-out mean. */
export function looDistance(data: SetData, index?: ArrayLike<number>): Float64Array {
  const n = checkData(data);
  const k = data.length;
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  for (const d of data) {
    for (let v = 0; v < n; v++) {
      if (Number.isFinite(d[v])) {
        sum[v] += d[v];
        count[v]++;
      }
    }
  }
  const out = new Float64Array(k);
  const len = index ? index.length : n;
  for (let i = 0; i < k; i++) {
    const d = data[i];
    let ss = 0;
    let c = 0;
    for (let t = 0; t < len; t++) {
      const v = index ? index[t] : t;
      const x = d[v];
      if (!Number.isFinite(x)) continue;
      const cc = count[v] - 1;
      if (cc <= 0) continue;
      const m = (sum[v] - x) / cc;
      ss += (x - m) * (x - m);
      c++;
    }
    out[i] = c > 0 ? Math.sqrt(ss / c) : NaN;
  }
  return out;
}

function median(values: number[]): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Robust z-scores: (x - median) / (1.4826 * MAD). */
export function robustZ(values: ArrayLike<number>): Float64Array {
  const arr = Array.from(values);
  const med = median(arr);
  const mad = median(arr.map((x) => Math.abs(x - med))) * 1.4826;
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = mad > 0 ? (arr[i] - med) / mad : 0;
  }
  return out;
}

/** Per-member z-scoring across voxels (pattern view: removes amplitude). */
export function zscoreMembers(data: SetData): Float32Array[] {
  return data.map((d) => {
    let s = 0;
    let ss = 0;
    let c = 0;
    for (let v = 0; v < d.length; v++) {
      const x = d[v];
      if (Number.isFinite(x)) {
        s += x;
        ss += x * x;
        c++;
      }
    }
    const m = c ? s / c : 0;
    const sd = c > 1 ? Math.sqrt((ss - c * m * m) / (c - 1)) : 1;
    const out = new Float32Array(d.length);
    for (let v = 0; v < d.length; v++) out[v] = sd > 0 ? (d[v] - m) / sd : NaN;
    return out;
  });
}
