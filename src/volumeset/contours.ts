/**
 * Density backdrop for a 2D layout: Gaussian kernel density estimate on a regular
 * grid, highest-density levels, and iso-contours by marching squares.
 *
 * KDE: f(x) = (1/n) Σ_k φ_h(x − p_k), with φ_h the isotropic bivariate Gaussian
 * of SD h, evaluated at grid nodes. Default bandwidth is Scott's rule for d = 2,
 * h = σ · n^(−1/6), where σ is the pooled SD √((s_x² + s_y²)/2) of the layout
 * coordinates (sample variances, divisor n − 1). When σ is 0 or undefined (one
 * point, coincident points) h falls back to 0.1 layout units. The grid spans the
 * data range padded by `pad` (default 3h) on every side, so the grid sum times
 * dx·dy approximates 1.
 *
 * Grid layout: `grid[j * nx + i]` is the density at layout point
 * (x0 + i·dx, y0 + j·dy). Contours are returned in fractional grid coordinates
 * (i, j); `gridToLayout` maps them to layout coordinates.
 *
 * Browser-safe and dependency-free (runs in a Web Worker).
 */

export interface Kde2dOptions {
  /** Nodes per axis (default 64, minimum 2). */
  gridSize?: number;
  /** Kernel SD in layout units (default: Scott's rule on the pooled SD). */
  bandwidth?: number;
  /** Margin added beyond the data range on each side (default 3 × bandwidth). */
  pad?: number;
}

export interface Kde2dResult {
  grid: Float64Array;
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  bandwidth: number;
}

/** Fallback bandwidth when the pooled SD is zero or undefined (layout units). */
export const KDE_FALLBACK_BANDWIDTH = 0.1;

/** Scott's rule bandwidth h = σ_pooled · n^(−1/6) for interleaved 2D coords (NaN if n < 2). */
export function scottBandwidth(coords: ArrayLike<number>): number {
  const n = coords.length >> 1;
  if (n < 2) return NaN;
  let mx = 0;
  let my = 0;
  for (let k = 0; k < n; k++) {
    mx += coords[2 * k];
    my += coords[2 * k + 1];
  }
  mx /= n;
  my /= n;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < n; k++) {
    const a = coords[2 * k] - mx;
    const b = coords[2 * k + 1] - my;
    sx += a * a;
    sy += b * b;
  }
  const sigma = Math.sqrt((sx / (n - 1) + sy / (n - 1)) / 2);
  return sigma * Math.pow(n, -1 / 6);
}

/** Gaussian KDE of interleaved 2D `coords` on a regular grid (see module comment). */
export function kde2d(coords: ArrayLike<number>, opts: Kde2dOptions = {}): Kde2dResult {
  if (coords.length % 2 !== 0) throw new Error('kde2d: coords must be interleaved x,y pairs');
  const size = Math.max(2, Math.floor(opts.gridSize ?? 64));
  const n = coords.length >> 1;
  let h = opts.bandwidth ?? scottBandwidth(coords);
  if (!(h > 0) || !Number.isFinite(h)) h = KDE_FALLBACK_BANDWIDTH;
  const pad = opts.pad !== undefined && opts.pad >= 0 ? opts.pad : 3 * h;

  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let k = 0; k < n; k++) {
    const x = coords[2 * k];
    const y = coords[2 * k + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('kde2d: coords must be finite');
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  if (n === 0) {
    xmin = xmax = ymin = ymax = 0;
  }
  const x0 = xmin - pad;
  const y0 = ymin - pad;
  // Guard a zero-width extent (pad = 0 with coincident points).
  const wx = Math.max(xmax + pad - x0, 1e-12);
  const wy = Math.max(ymax + pad - y0, 1e-12);
  const nx = size;
  const ny = size;
  const dx = wx / (nx - 1);
  const dy = wy / (ny - 1);
  const grid = new Float64Array(nx * ny);
  if (n === 0) return { grid, nx, ny, x0, y0, dx, dy, bandwidth: h };

  // The isotropic kernel is separable: φ_h(u, v) = g(u)·g(v)/(2πh²) with g = exp(−·²/2h²).
  const inv2h2 = 1 / (2 * h * h);
  const norm = 1 / (2 * Math.PI * h * h * n);
  const gx = new Float64Array(nx);
  const gy = new Float64Array(ny);
  for (let k = 0; k < n; k++) {
    const px = coords[2 * k];
    const py = coords[2 * k + 1];
    for (let i = 0; i < nx; i++) {
      const u = x0 + i * dx - px;
      gx[i] = Math.exp(-u * u * inv2h2);
    }
    for (let j = 0; j < ny; j++) {
      const v = y0 + j * dy - py;
      gy[j] = Math.exp(-v * v * inv2h2) * norm;
    }
    for (let j = 0; j < ny; j++) {
      const w = gy[j];
      if (w === 0) continue;
      const row = j * nx;
      for (let i = 0; i < nx; i++) grid[row + i] += w * gx[i];
    }
  }
  return { grid, nx, ny, x0, y0, dx, dy, bandwidth: h };
}

/**
 * Highest-density thresholds: for each mass fraction f, the density level L such
 * that the grid nodes with value ≥ L hold (just over) a fraction f of the total
 * grid mass. Fractions are sorted ascending, so the returned levels are highest
 * density first; e.g. [0.5, 0.8, 0.95] gives the 50%, 80% and 95% regions. Fractions
 * are clamped to [0, 1]; returns NaN levels for an all-zero grid.
 */
export function densityLevels(grid: ArrayLike<number>, fractions: readonly number[]): number[] {
  const vals: number[] = [];
  let total = 0;
  for (let k = 0; k < grid.length; k++) {
    const v = grid[k];
    if (v > 0 && Number.isFinite(v)) {
      vals.push(v);
      total += v;
    }
  }
  const fs = fractions.map((f) => Math.min(1, Math.max(0, f))).sort((a, b) => a - b);
  if (!(total > 0)) return fs.map(() => NaN);
  vals.sort((a, b) => b - a);
  const out: number[] = [];
  let cum = 0;
  let idx = 0;
  for (const f of fs) {
    const target = f * total;
    while (idx < vals.length - 1 && cum + vals[idx] < target) {
      cum += vals[idx];
      idx++;
    }
    out.push(vals[idx]);
  }
  return out;
}

/**
 * Marching-squares iso-contours of `grid` (nx × ny, `grid[j * nx + i]`) at `level`.
 * A node is inside when its value is > level (NaN is outside). Crossings are placed
 * by linear interpolation along cell edges. Ambiguous saddle cells (diagonally
 * opposite corners inside) are resolved by the cell-centre value, taken as the
 * average of the four corners: if it is inside, the two inside corners are joined
 * (the outside corners are cut off); otherwise the inside corners are cut off.
 *
 * Returns polylines as flat [i0, j0, i1, j1, …] arrays in fractional grid
 * coordinates. Closed rings repeat their first point at the end; open polylines
 * end on the grid boundary.
 */
export function isoContours(grid: ArrayLike<number>, nx: number, ny: number, level: number): number[][] {
  if (grid.length !== nx * ny) throw new Error(`isoContours: grid must have nx*ny = ${nx * ny} values`);
  if (nx < 2 || ny < 2 || !Number.isFinite(level)) return [];
  const H = (nx - 1) * ny; // number of horizontal edges; vertical edge ids follow
  const hId = (i: number, j: number) => j * (nx - 1) + i;
  const vId = (i: number, j: number) => H + j * nx + i;
  const val = (i: number, j: number) => grid[j * nx + i];
  const inside = (v: number) => v > level;

  const crossing = (edge: number): [number, number] => {
    if (edge < H) {
      const j = Math.floor(edge / (nx - 1));
      const i = edge - j * (nx - 1);
      const a = val(i, j);
      const b = val(i + 1, j);
      return [i + frac(a, b, level), j];
    }
    const e = edge - H;
    const j = Math.floor(e / nx);
    const i = e - j * nx;
    const a = val(i, j);
    const b = val(i, j + 1);
    return [i, j + frac(a, b, level)];
  };

  const segA: number[] = [];
  const segB: number[] = [];
  const edgeSegs = new Map<number, number[]>();
  const addSeg = (e1: number, e2: number) => {
    const s = segA.length;
    segA.push(e1);
    segB.push(e2);
    for (const e of [e1, e2]) {
      const l = edgeSegs.get(e);
      if (l) l.push(s);
      else edgeSegs.set(e, [s]);
    }
  };

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      // Corners c0=(i,j) c1=(i+1,j) c2=(i+1,j+1) c3=(i,j+1);
      // edges e0=c0c1 (bottom) e1=c1c2 (right) e2=c3c2 (top) e3=c0c3 (left).
      const v = [val(i, j), val(i + 1, j), val(i + 1, j + 1), val(i, j + 1)];
      const ins = v.map(inside);
      const e = [hId(i, j), vId(i + 1, j), hId(i, j + 1), vId(i, j)];
      const crossed: number[] = [];
      for (let k = 0; k < 4; k++) if (ins[k] !== ins[(k + 1) % 4]) crossed.push(k);
      if (crossed.length === 2) {
        addSeg(e[crossed[0]], e[crossed[1]]);
      } else if (crossed.length === 4) {
        const centreInside = inside((v[0] + v[1] + v[2] + v[3]) / 4);
        // Corner k lies between edges e[k−1] and e[k]; cut off the corners whose
        // state differs from the centre.
        for (let k = 0; k < 4; k++) {
          if (ins[k] !== centreInside) addSeg(e[(k + 3) % 4], e[k]);
        }
      }
    }
  }

  const used = new Uint8Array(segA.length);
  const lines: number[][] = [];
  const walk = (startSeg: number, startEdge: number, closed: boolean) => {
    const pts: number[] = [];
    const push = (edge: number) => {
      const [x, y] = crossing(edge);
      pts.push(x, y);
    };
    push(startEdge);
    let seg = startSeg;
    let edge = startEdge;
    for (;;) {
      used[seg] = 1;
      edge = segA[seg] === edge ? segB[seg] : segA[seg];
      push(edge);
      const next = (edgeSegs.get(edge) ?? []).find((s) => !used[s]);
      if (next === undefined) break;
      seg = next;
    }
    if (closed && (pts[0] !== pts[pts.length - 2] || pts[1] !== pts[pts.length - 1])) pts.push(pts[0], pts[1]);
    lines.push(pts);
  };
  // Open chains first (they start at an edge used by only one segment: the grid boundary).
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue;
    for (const e of [segA[s], segB[s]]) {
      if (!used[s] && edgeSegs.get(e)!.length === 1) walk(s, e, false);
    }
  }
  for (let s = 0; s < segA.length; s++) if (!used[s]) walk(s, segA[s], true);
  return lines;
}

function frac(a: number, b: number, level: number): number {
  const t = (level - a) / (b - a);
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
}

/** Map a flat [i, j, …] polyline in grid coordinates to layout coordinates [x, y, …]. */
export function gridToLayout(polyline: ArrayLike<number>, kde: Pick<Kde2dResult, 'x0' | 'y0' | 'dx' | 'dy'>): number[] {
  const out = new Array<number>(polyline.length);
  for (let k = 0; k + 1 < polyline.length; k += 2) {
    out[k] = kde.x0 + polyline[k] * kde.dx;
    out[k + 1] = kde.y0 + polyline[k + 1] * kde.dy;
  }
  return out;
}
