/** A synthetic faces/houses study on a 4 mm grid over a template, and its group t map. */
import { FloatNeuroVol, NeuroSpace } from '../../src/browser';
import { MemoryBacking } from '../../src/backed';
import type { Row } from '../../src/backed';

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const norm = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

/** The study: 20 subjects in two groups, faces / houses / scrambled, on a 4 mm grid. */
export function makeStudy(template: FloatNeuroVol) {
  const [lo, hi] = template.space.bounds();
  const min = lo.map((v, i) => Math.min(v, hi[i])), max = lo.map((v, i) => Math.max(v, hi[i]));
  const dim = min.map((v, i) => Math.floor((max[i] - v) / 4) + 1);
  const space = new NeuroSpace(dim, [4, 4, 4], min);
  const t = template.getData() as ArrayLike<number>;
  let peak = 0;
  for (let i = 0; i < t.length; i++) if (t[i] > peak) peak = t[i];
  const mask: number[] = [], mm: number[][] = [];
  const [nx, ny, nz] = dim;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const w = space.gridToCoord([i, j, k]);
    const g = template.space.coordToGrid(w).map(Math.round);
    const tdim = template.space.dim as number[];
    if (g.some((v, d) => v < 0 || v >= tdim[d])) continue;
    if (t[g[0] + g[1] * tdim[0] + g[2] * tdim[0] * tdim[1]] > 0.3 * peak) { mask.push(i + j * nx + k * nx * ny); mm.push(w); }
  }
  const blob = (w: number[], c: number[], s: number) => Math.exp(-((w[0] - c[0]) ** 2 + (w[1] - c[1]) ** 2 + (w[2] - c[2]) ** 2) / (2 * s * s));
  const ffaR = mm.map((w) => blob(w, [42, -52, -18], 7)), ffaL = mm.map((w) => blob(w, [-40, -54, -18], 6));
  const v1 = mm.map((w) => blob(w, [0, -90, 0], 12));
  const conds = ['faces', 'houses', 'scrambled'];
  const design: Row[] = [];
  const ids = Array.from({ length: 20 }, (_, s) => `sub-${String(s + 1).padStart(2, '0')}`);
  const gain = new Map(ids.map((s) => [s, 1 + 0.35 * norm()]));
  ids.forEach((s, i) => conds.forEach((condition) => design.push({ subject: s, group: i < 10 ? 'control' : 'patient', condition })));
  const data = design.map((r) => {
    const g = gain.get(r.subject as string)!;
    const face = r.condition === 'faces' ? (r.group === 'patient' ? 0.55 : 1.1) : 0;
    const visual = r.condition === 'scrambled' ? 0.9 : 1.2;
    const rowDev = 0.25 * norm();
    const d = new Float32Array(mask.length);
    for (let m = 0; m < mask.length; m++) d[m] = g * (face * (ffaR[m] + 0.7 * ffaL[m]) + visual * v1[m]) + rowDev * (ffaR[m] + ffaL[m] + v1[m]) + 0.45 * norm();
    return d;
  });
  const backing = new MemoryBacking({
    space, design, mask, data, valueLabel: 'β (% signal change)', provenance: { space: 'MNI', map: 'faces − houses, t' },
    columns: [{ name: 'subject', kind: 'factor', role: 'subject' }, { name: 'group', kind: 'factor', role: 'group' },
      { name: 'condition', kind: 'factor', role: 'condition', levels: conds }],
  });
  // The group map: one-sample t of faces − houses across subjects.
  const tmap = new Float32Array(nx * ny * nz);
  const fi = design.map((r, i) => (r.condition === 'faces' ? i : -1)).filter((i) => i >= 0);
  const hi2 = design.map((r, i) => (r.condition === 'houses' ? i : -1)).filter((i) => i >= 0);
  for (let m = 0; m < mask.length; m++) {
    let s = 0, ss = 0;
    for (let k = 0; k < fi.length; k++) { const d = data[fi[k]][m] - data[hi2[k]][m]; s += d; ss += d * d; }
    const n = fi.length, mean = s / n, sd = Math.sqrt((ss - n * mean * mean) / (n - 1));
    tmap[mask[m]] = mean / (sd / Math.sqrt(n));
  }
  return { backing, tmap: new FloatNeuroVol(space, tmap) };
}
