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
