/** Where to read: one voxel, a sphere, or any set of voxels (a cluster, a parcel). */
import type { NeuroSpace } from '../geometry/NeuroSpace';

export type Probe =
  | { kind: 'voxel'; at: number[] }
  | { kind: 'sphere'; at: number[]; radius: number }
  | { kind: 'mask'; indices: ArrayLike<number>; label: string };

export const voxel = (at: number[]): Probe => ({ kind: 'voxel', at });
export const sphere = (at: number[], radius = 6): Probe => ({ kind: 'sphere', at, radius });
export const mask = (indices: ArrayLike<number>, label: string): Probe => ({ kind: 'mask', indices, label });

/** The voxels of a label volume equal to `id`, as a probe. */
export function region(labels: ArrayLike<number>, id: number, label = `region ${id}`): Probe {
  const out: number[] = [];
  for (let i = 0; i < labels.length; i++) if (labels[i] === id) out.push(i);
  return mask(out, label);
}

const mm = (v: number) => (v < 0 ? '−' : '') + Math.abs(Math.round(v));
const at = (p: number[]) => p.map(mm).join(' ');

export function probeLabel(p: Probe): string {
  if (p.kind === 'voxel') return `voxel at ${at(p.at)}`;
  if (p.kind === 'sphere') return `${p.radius} mm sphere at ${at(p.at)}`;
  return p.label;
}

/** Linear grid indices (i fastest) covered by a probe. */
export function probeIndices(p: Probe, space: NeuroSpace): number[] {
  if (p.kind === 'mask') return Array.from(p.indices);
  const [nx, ny, nz] = space.dim as number[];
  const g = space.coordToGrid(p.at).map(Math.round);
  if (p.kind === 'voxel') {
    if (g.some((v, i) => v < 0 || v >= [nx, ny, nz][i])) return [];
    return [g[0] + g[1] * nx + g[2] * nx * ny];
  }
  const sp = space.spacing as number[];
  const reach = sp.map((s) => Math.ceil(p.radius / Math.abs(s)));
  const out: number[] = [];
  for (let k = Math.max(0, g[2] - reach[2]); k <= Math.min(nz - 1, g[2] + reach[2]); k++)
    for (let j = Math.max(0, g[1] - reach[1]); j <= Math.min(ny - 1, g[1] + reach[1]); j++)
      for (let i = Math.max(0, g[0] - reach[0]); i <= Math.min(nx - 1, g[0] + reach[0]); i++) {
        const w = space.gridToCoord([i, j, k]);
        const d2 = (w[0] - p.at[0]) ** 2 + (w[1] - p.at[1]) ** 2 + (w[2] - p.at[2]) ** 2;
        if (d2 <= p.radius * p.radius) out.push(i + j * nx + k * nx * ny);
      }
  return out;
}

/** A map as a probe needs it: values on a grid, and which values are hidden. */
export interface ThresholdedMap {
  space: NeuroSpace;
  values: ArrayLike<number>;
  /** Values inside [low, high] are hidden (the viewer's threshold convention). */
  threshold: readonly [number, number];
}

export interface ClusterResult {
  /** Linear indices on the map's grid. */
  indices: number[];
  /** The seed's value; NaN when the seed is outside the volume. */
  seed: number;
}

/**
 * The connected set of shown voxels holding `at`, with the seed's sign:
 * what a reader sees as "the blob I clicked". Empty when `at` is hidden.
 */
export function clusterAt(map: ThresholdedMap, at: number[], connectivity: 6 | 18 | 26 = 26): ClusterResult {
  const [nx, ny, nz] = map.space.dim as number[];
  const g = map.space.coordToGrid(at).map(Math.round);
  if (g.some((v, i) => v < 0 || v >= [nx, ny, nz][i])) return { indices: [], seed: NaN };
  const [lo, hi] = map.threshold;
  const shown = (v: number) => Number.isFinite(v) && (v < lo || v > hi);
  const start = g[0] + g[1] * nx + g[2] * nx * ny;
  const seed = map.values[start];
  if (!shown(seed)) return { indices: [], seed };
  const positive = seed > hi;
  const keep = (v: number) => shown(v) && (positive ? v > hi : v < lo);
  const steps: number[][] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const n = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (n === 0 || (connectivity === 6 && n > 1) || (connectivity === 18 && n > 2)) continue;
    steps.push([dx, dy, dz]);
  }
  const seen = new Uint8Array(nx * ny * nz);
  const out: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const p = stack.pop() as number;
    out.push(p);
    const x = p % nx, y = Math.floor(p / nx) % ny, z = Math.floor(p / (nx * ny));
    for (const [dx, dy, dz] of steps) {
      const a = x + dx, b = y + dy, c = z + dz;
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
      const q = a + b * nx + c * nx * ny;
      if (seen[q] || !keep(map.values[q])) continue;
      seen[q] = 1;
      stack.push(q);
    }
  }
  return { indices: out.sort((p, q) => p - q), seed };
}

/** Map grid indices onto another grid by world position (identity when the grids match). */
export function regrid(indices: number[], from: NeuroSpace, to: NeuroSpace): number[] {
  const fd = from.dim as number[], td = to.dim as number[];
  const same = fd.slice(0, 3).every((d, i) => d === td[i]) &&
    from.gridToCoord([0, 0, 0]).every((v, i) => Math.abs(v - to.gridToCoord([0, 0, 0])[i]) < 1e-6) &&
    from.gridToCoord([1, 1, 1]).every((v, i) => Math.abs(v - to.gridToCoord([1, 1, 1])[i]) < 1e-6);
  if (same) return indices;
  const [nx, ny, nz] = td;
  const out = new Set<number>();
  for (const i of indices) {
    const g = to.coordToGrid(from.indexToCoord(i)).map(Math.round);
    if (g.some((v, k) => v < 0 || v >= [nx, ny, nz][k])) continue;
    out.add(g[0] + g[1] * nx + g[2] * nx * ny);
  }
  return [...out].sort((p, q) => p - q);
}

/** "|t| > 3.1", "t > 3.1", "t < −2" or "t outside [−1, 2]", for a threshold. */
export function describeThreshold(threshold: readonly [number, number], stat = 'value'): string {
  const [lo, hi] = threshold;
  const f = (v: number) => (v < 0 ? '−' : '') + +Math.abs(v).toPrecision(3);
  if (Math.abs(lo + hi) < 1e-9 * Math.max(1, Math.abs(hi))) return hi === 0 ? `${stat} ≠ 0` : `|${stat}| > ${f(hi)}`;
  if (lo <= -1e8) return `${stat} > ${f(hi)}`;
  if (hi >= 1e8) return `${stat} < ${f(lo)}`;
  return `${stat} outside [${f(lo)}, ${f(hi)}]`;
}
