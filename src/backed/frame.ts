/**
 * From extracted values to what is drawn: long rows, subject cells, and
 * summaries with honest intervals.
 *
 * Anything not mapped to the plot is averaged away, always within subject
 * first, so runs, trials or collapsed conditions never count as subjects.
 */
import type { Backing, Extract, Row, Value } from './types';
import { mean, sd, tQuantile } from './stats';

/** One row per observation (and axis position), with `value`. */
export function long(b: Backing, ext: Extract): Row[] {
  const out: Row[] = [];
  const axis = b.axis;
  const basis = axis?.basis;
  b.design.forEach((row, r) => {
    const base = r * ext.width;
    if (!axis) {
      out.push({ ...row, value: ext.values[base] });
    } else if (basis) {
      basis.values.forEach((t, ti) => {
        let s = 0;
        const w = basis.weights[ti];
        for (let a = 0; a < ext.width; a++) s += w[a] * ext.values[base + a];
        out.push({ ...row, [basis.name]: t, value: s });
      });
    } else {
      axis.values.forEach((t, a) => out.push({ ...row, [axis.name]: t, value: ext.values[base + a] }));
    }
  });
  return out.filter((r) => Number.isFinite(r.value as number));
}

const keyOf = (r: Row, cols: string[]) => cols.map((c) => String(r[c])).join('\u0001');

function groupBy(rows: Row[], cols: string[]): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = keyOf(r, cols);
    const g = m.get(k);
    if (g) g.push(r); else m.set(k, [r]);
  }
  return m;
}

/** Mean `value` per combination of `cols`; other columns are averaged away. */
export function cellMeans(rows: Row[], cols: string[]): Row[] {
  const out: Row[] = [];
  for (const g of groupBy(rows, cols).values()) {
    const r: Row = {};
    for (const c of cols) r[c] = g[0][c];
    r.value = mean(g.map((x) => x.value as number));
    out.push(r);
  }
  return out;
}

/** True when every subject has more than one level of `col`: a within-subject factor. */
export function variesWithin(rows: Row[], subject: string | undefined, col: string): boolean {
  if (!subject) return false;
  const levels = new Map<Value, Set<Value>>();
  for (const r of rows) {
    const s = levels.get(r[subject]) ?? new Set<Value>();
    s.add(r[col]);
    levels.set(r[subject], s);
  }
  return levels.size > 0 && [...levels.values()].every((s) => s.size > 1);
}

export type ErrorKind = 'between' | 'within' | 'none';

export interface Cell {
  key: Row;
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

export interface Summary {
  cells: Cell[];
  /** Per-subject cell means over the same keys: the dots and lines. */
  subjects: Row[];
  /** The interval actually drawn (within falls back to between with one within cell). */
  error: ErrorKind;
  /** Number of within-subject cells the Morey correction used. */
  withinCells: number;
  /** Subjects left out of within-subject intervals for lacking a cell. */
  incomplete: string[];
}

export interface SummaryOptions {
  subject?: string;
  /** Columns that stay: the plot's x, color, facet (and axis). */
  keys: string[];
  /** Of `keys`, those that vary within subject. */
  within?: string[];
  /** Of `keys`, the continuous axis (kept as context, never normalized across). */
  axis?: string;
  error?: ErrorKind;
  level?: number;
}

/**
 * Subject cells, then a mean and interval per cell across subjects. With
 * `error: 'within'`, intervals use Cousineau–Morey normalisation: each
 * subject's cells are centred on that subject's mean over the within-subject
 * cells (per between-subject group and axis position), the grand mean added
 * back, and the variance scaled by J/(J−1).
 */
export function summarise(rows: Row[], o: SummaryOptions): Summary {
  const level = o.level ?? 0.95;
  const subj = o.subject;
  const keys = o.keys;
  const subjects = subj ? cellMeans(rows, [subj, ...keys]) : rows.map((r) => ({ ...r }));
  const within = (o.within ?? []).filter((k) => keys.includes(k) && k !== o.axis);
  const context = keys.filter((k) => !within.includes(k));
  const cellsJ = within.length ? new Set(subjects.map((r) => keyOf(r, within))).size : 1;
  let error: ErrorKind = o.error ?? 'between';
  if (error === 'within' && (cellsJ < 2 || !subj)) error = 'between';

  // Values whose spread gives the interval. Within-subject intervals need
  // every subject in every within cell; incomplete subjects are left out.
  const spreadOf = new Map<Row, number>();
  const incomplete = new Set<string>();
  let used = subjects;
  if (error === 'within' && subj) {
    for (const ctx of groupBy(subjects, context).values())
      for (const own of groupBy(ctx, [subj]).values())
        if (own.length < cellsJ) incomplete.add(String(own[0][subj]));
    used = subjects.filter((r) => !incomplete.has(String(r[subj])));
    for (const ctx of groupBy(used, context).values()) {
      const grand = mean(ctx.map((r) => r.value as number));
      for (const own of groupBy(ctx, [subj]).values()) {
        const m = mean(own.map((r) => r.value as number));
        for (const r of own) spreadOf.set(r, (r.value as number) - m + grand);
      }
    }
  }
  const scale = error === 'within' ? Math.sqrt(cellsJ / (cellsJ - 1)) : 1;

  const cells: Cell[] = [];
  for (const g of groupBy(used, keys).values()) {
    const vals = g.map((r) => r.value as number);
    const m = mean(vals);
    const n = vals.length;
    const spread = error === 'within' ? g.map((r) => spreadOf.get(r) as number) : vals;
    const half = error === 'none' || n < 2 ? NaN : (tQuantile(1 - (1 - level) / 2, n - 1) * sd(spread) * scale) / Math.sqrt(n);
    const key: Row = {};
    for (const k of keys) key[k] = g[0][k];
    cells.push({ key, mean: m, lo: m - half, hi: m + half, n });
  }
  return { cells, subjects, error, withinCells: cellsJ, incomplete: [...incomplete] };
}
