/**
 * Cluster-extent display filter: hide suprathreshold voxels that belong to
 * small connected clusters. Display-only; it never changes stored values.
 *
 * Clusters are 26-connected sets of in-mask voxels with |value| >= thr and the
 * same sign (positive and negative clusters are separate).
 */

/**
 * Returns a copy of `values` in which voxels of clusters smaller than
 * `minSize` are set to 0 (below any threshold), plus the number of clusters
 * kept and removed.
 */
export function clusterExtentFilter(
  dim: readonly number[],
  maskIndex: Int32Array,
  gridToMask: Int32Array,
  values: Float32Array,
  thr: number,
  minSize: number
): { values: Float32Array; kept: number; removed: number; voxelsRemoved: number } {
  const out = Float32Array.from(values);
  if (minSize <= 1) return { values: out, kept: 0, removed: 0, voxelsRemoved: 0 };
  const [nx, ny, nz] = dim;
  const nxy = nx * ny;
  const label = new Int32Array(maskIndex.length); // 0 = unvisited
  const stack: number[] = [];
  const members: number[] = [];
  let next = 1;
  let kept = 0;
  let removed = 0;
  let voxelsRemoved = 0;
  for (let m = 0; m < maskIndex.length; m++) {
    const v = values[m];
    if (label[m] || !(Math.abs(v) >= thr)) continue;
    const sign = Math.sign(v);
    const id = next++;
    label[m] = id;
    stack.push(m);
    members.length = 0;
    while (stack.length) {
      const c = stack.pop()!;
      members.push(c);
      const g = maskIndex[c];
      const i = g % nx;
      const j = Math.floor(g / nx) % ny;
      const k = Math.floor(g / nxy);
      for (let dk = -1; dk <= 1; dk++) {
        const kk = k + dk;
        if (kk < 0 || kk >= nz) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= ny) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= nx || (di === 0 && dj === 0 && dk === 0)) continue;
            const nm = gridToMask[ii + jj * nx + kk * nxy];
            if (nm < 0 || label[nm]) continue;
            const nv = values[nm];
            if (Math.abs(nv) >= thr && Math.sign(nv) === sign) {
              label[nm] = id;
              stack.push(nm);
            }
          }
        }
      }
    }
    if (members.length < minSize) {
      removed++;
      voxelsRemoved += members.length;
      for (const c of members) out[c] = 0;
    } else kept++;
  }
  return { values: out, kept, removed, voxelsRemoved };
}
