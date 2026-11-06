/** Synthetic studies, one per data shape, with planted effects at the centre voxel. */
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { MemoryBacking } from '../../src/backed';
import type { Axis, Row } from '../../src/backed';

export const space = new NeuroSpace([5, 5, 5], [2, 2, 2], [-4, -4, -4]);
export const centre = [0, 0, 0];
const NV = 125;

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const norm = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

function data(rows: Row[], width: number, f: (r: Row, a: number) => number, noise: number) {
  return rows.map((r) => {
    const d = new Float32Array(NV * width);
    for (let m = 0; m < NV; m++) for (let a = 0; a < width; a++) d[m * width + a] = f(r, a) + noise * norm();
    return d;
  });
}
const subjects = (n: number) => Array.from({ length: n }, (_, i) => `sub-${String(i + 1).padStart(2, '0')}`);

export function onePerSubject() {
  const offs = new Map<string, number>();
  const design = subjects(24).map((s) => { offs.set(s, 0.6 + 0.5 * norm()); return { subject: s }; });
  return new MemoryBacking({ space, design, data: data(design, 1, (r) => offs.get(r.subject as string)!, 0.3), valueLabel: 'faces − houses (β)' });
}

export function groupByCondition() {
  const design: Row[] = [];
  const ids = subjects(20);
  const base = new Map(ids.map((s) => [s, 0.4 * norm()]));
  ids.forEach((s, i) => {
    for (const condition of ['faces', 'houses', 'scrambled']) for (const run of [1, 2])
      design.push({ subject: s, group: i < 10 ? 'control' : 'patient', condition, run });
  });
  const eff = (r: Row) => {
    const c = r.condition === 'faces' ? 1.1 : r.condition === 'houses' ? 0.45 : 0.1;
    return base.get(r.subject as string)! + c * (r.group === 'patient' ? 0.6 : 1);
  };
  return new MemoryBacking({ space, design, data: data(design, 1, eff, 0.35), valueLabel: 'β',
    columns: [{ name: 'subject', kind: 'factor', role: 'subject' }, { name: 'group', kind: 'factor', role: 'group' },
      { name: 'condition', kind: 'factor', role: 'condition', levels: ['faces', 'houses', 'scrambled'] },
      { name: 'run', kind: 'factor', role: 'run' }] });
}

const hrf = (t: number) => (t <= 0 ? 0 : (t ** 5 * Math.exp(-t)) / 120 - (t ** 15 * Math.exp(-t)) / (6 * 1307674368000));

export function fir() {
  const lags = [0, 2, 4, 6, 8, 10, 12, 14, 16];
  const axis: Axis = { name: 'time', values: lags, unit: 's' };
  const design: Row[] = [];
  const ids = subjects(18);
  const amp = new Map(ids.map((s) => [s, 1 + 0.3 * norm()]));
  for (const s of ids) for (const condition of ['faces', 'houses']) design.push({ subject: s, condition });
  const f = (r: Row, a: number) => amp.get(r.subject as string)! * (r.condition === 'faces' ? 3 : 1.6) * hrf(lags[a]) / 0.1;
  return new MemoryBacking({ space, design, axis, data: data(design, lags.length, f, 0.25), valueLabel: '% signal' });
}

export function basis() {
  const t = Array.from({ length: 41 }, (_, i) => i * 0.5);
  const d = (k: number) => (x: number) => (k === 0 ? hrf(x) : k === 1 ? hrf(x) - hrf(x - 1) : hrf(x / 1.3) * 0.8);
  const weights = t.map((x) => [0, 1, 2].map((k) => d(k)(x) / 0.1));
  const axis: Axis = { name: 'basis', values: [1, 2, 3], basis: { name: 'time', values: t, unit: 's', weights } };
  const design: Row[] = [];
  const ids = subjects(16);
  for (const s of ids) for (const condition of ['faces', 'houses']) design.push({ subject: s, condition });
  const coef = (r: Row, a: number) => (r.condition === 'faces' ? [1.4, 0.5, 0.1] : [0.8, -0.2, 0.05])[a];
  return new MemoryBacking({ space, design, axis, data: data(design, 3, coef, 0.15), valueLabel: '% signal' });
}

export function covariate() {
  const ids = subjects(30);
  const ages = new Map(ids.map((s) => [s, Math.round(20 + 50 * rand())]));
  const design = ids.map((s) => ({ subject: s, age: ages.get(s)! }));
  return new MemoryBacking({ space, design, data: data(design, 1, (r) => 1.4 - 0.015 * (r.age as number), 0.3),
    valueLabel: 'faces − houses (β)', columns: [{ name: 'age', kind: 'numeric', unit: 'years', role: 'covariate' }] });
}
