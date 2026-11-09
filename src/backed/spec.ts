/**
 * What to draw, as data. A spec maps design columns to x, color and facet,
 * keeps some levels, and says which interval to show. Everything unmapped is
 * averaged away (within subject first). Controls only ever edit the spec.
 */
import type { Backing, Column, Extract, Row } from './types';
import { type Cell, type ErrorKind, cellMeans, long, summarise, variesWithin } from './frame';
import { type Fit, fitLine, spearman } from './stats';

export interface PlotSpec {
  x?: string;
  color?: string;
  facet?: string;
  /** Levels to keep, per factor; absent means all. */
  keep?: Record<string, string[]>;
  error?: 'auto' | ErrorKind;
  subjects?: 'points' | 'lines' | 'hidden';
}

/** Factors worth mapping: more than one level, not the subject. */
export function factors(b: Backing): Column[] {
  return b.columns.filter((c) => c.kind === 'factor' && c.name !== b.subject && (c.levels?.length ?? 0) > 1 &&
    new Set(b.design.map((r) => r[c.name])).size > 1 && new Set(b.design.map((r) => r[c.name])).size < b.design.length);
}

export function covariates(b: Backing): Column[] {
  return b.columns.filter((c) => c.kind === 'numeric' && (!b.subject || !variesWithin(b.design, b.subject, c.name)));
}

/** The axis column name rows carry after `long()`, if any. */
export const axisName = (b: Backing) => b.axis?.basis?.name ?? b.axis?.name;

/** A first view chosen from the design (see the plan's table of shapes). */
export function inferSpec(b: Backing): PlotSpec {
  const fs = factors(b);
  const within = fs.filter((f) => variesWithin(b.design, b.subject, f.name));
  const between = fs.filter((f) => !within.includes(f));
  const byRole = (cs: Column[], role: string) => cs.find((c) => c.role === role);
  const cond = byRole(within, 'condition') ?? within[0];
  const group = byRole(between, 'group') ?? between[0];
  const ax = axisName(b);
  if (ax) return { x: ax, color: cond?.name ?? group?.name, facet: cond && group ? group.name : undefined, error: 'auto', subjects: 'hidden' };
  if (cond) return { x: cond.name, color: group?.name, error: 'auto', subjects: 'lines' };
  if (group) return { x: group.name, error: 'auto', subjects: 'points' };
  return { error: 'auto', subjects: 'points' };
}

export interface Series {
  level: string | null;
  cells: (Cell & { x: string | number })[];
  subjects: { id: string; points: { x: string | number; y: number }[] }[];
  fit?: Fit;
  /** Fit without the influential points, and which subjects those are. */
  robust?: { fit: Fit; subjects: string[] };
  /** Spearman's rank correlation, a check that does not drop any point. */
  rank?: { rho: number; p: number };
}

export interface Panel { facet: string | null; series: Series[] }

export interface Scene {
  probe: string;
  voxels: number;
  nSubjects: number;
  x: { name: string | null; kind: 'band' | 'linear'; levels: string[]; unit?: string };
  y: { label: string };
  color: { name: string | null; levels: string[] };
  facet: { name: string | null };
  panels: Panel[];
  error: ErrorKind;
  /** Within-subject x: per-subject lines are meaningful. */
  paired: boolean;
  subjects: 'points' | 'lines' | 'hidden';
  covariate: boolean;
  /** What was averaged away. */
  collapsed: string[];
  /** Subjects per color level (or overall), and per facet. */
  nByLevel: Record<string, number>;
  nByFacet: Record<string, number>;
  /** A between-subject factor is mapped while intervals are within-subject. */
  mixed: boolean;
  /** Subjects left out of within-subject intervals for a missing cell. */
  incomplete: string[];
  /** The probe was chosen on a map of these data: no inferential statistics. */
  circular: boolean;
  provenance?: Backing['provenance'];
  /** Set for stored summaries (NFTab Summary Profile): drawn as stored, never recomputed. */
  stored?: { meta: string; foot: string[]; mark: 'point' | 'line' | 'interval' };
}

const levelsOf = (b: Backing, name: string | undefined, rows: Row[]): string[] => {
  if (!name) return [];
  const declared = b.columns.find((c) => c.name === name)?.levels;
  const present = new Set(rows.map((r) => String(r[name])));
  return (declared ?? [...present]).filter((l) => present.has(l));
};

export function buildScene(b: Backing, ext: Extract, spec: PlotSpec, circular = false): Scene {
  let rows = long(b, ext);
  for (const [col, keep] of Object.entries(spec.keep ?? {})) {
    if (keep?.length) rows = rows.filter((r) => keep.includes(String(r[col])));
  }
  const ax = axisName(b);
  const isCov = !!spec.x && b.columns.some((c) => c.name === spec.x && c.kind === 'numeric');
  const keys = [spec.facet, spec.color, isCov ? undefined : spec.x].filter((k): k is string => !!k);
  const within = keys.filter((k) => k !== ax && variesWithin(b.design, b.subject, k));
  const paired = !!spec.x && spec.x !== ax && within.includes(spec.x);
  const error: ErrorKind = spec.error === 'auto' || !spec.error ? (within.length ? 'within' : 'between') : spec.error;
  const sum = summarise(rows, { subject: b.subject, keys, within, axis: ax, error });
  const used = new Set([...keys, spec.x, b.subject]);
  const collapsed = factors(b).map((f) => f.name).filter((n) => !used.has(n) && new Set(rows.map((r) => r[n])).size > 1);
  if (ax && !used.has(ax)) collapsed.push(ax);

  const colorLevels = levelsOf(b, spec.color, rows);
  const facetLevels = spec.facet ? levelsOf(b, spec.facet, rows) : [null];
  const xLevels = spec.x && !isCov && spec.x !== ax ? levelsOf(b, spec.x, rows) : [];
  const xKind: 'band' | 'linear' = spec.x && (isCov || spec.x === ax) ? 'linear' : 'band';
  const xv = (r: Row) => (spec.x ? (xKind === 'linear' ? (r[spec.x] as number) : String(r[spec.x])) : '');
  const match = (r: Row, f: string | null, c: string | null) =>
    (!spec.facet || String(r[spec.facet]) === f) && (!spec.color || String(r[spec.color]) === c);

  // Covariate: one point per subject (cells averaged), x from the design.
  let covRows: Row[] = [];
  if (isCov && b.subject) {
    const covOf = new Map(b.design.map((r) => [r[b.subject as string], r[spec.x as string]]));
    covRows = cellMeans(sum.subjects, [b.subject, ...keys]).map((r) => ({ ...r, [spec.x as string]: covOf.get(r[b.subject as string]) as number }));
  }

  const panels: Panel[] = facetLevels.map((f) => ({
    facet: f,
    series: (spec.color ? colorLevels : [null]).map((c) => {
      const subjectRows = (isCov ? covRows : sum.subjects).filter((r) => match(r, f, c));
      const bySubject = new Map<string, { x: string | number; y: number }[]>();
      for (const r of subjectRows) {
        const id = b.subject ? String(r[b.subject]) : String(bySubject.size);
        const pts = bySubject.get(id) ?? [];
        pts.push({ x: xv(r), y: r.value as number });
        bySubject.set(id, pts);
      }
      const order = (x: string | number) => (xKind === 'band' ? xLevels.indexOf(String(x)) : (x as number));
      const cells = isCov ? [] : sum.cells.filter((cell) => match(cell.key, f, c)).map((cell) => ({ ...cell, x: xv(cell.key) }))
        .sort((p, q) => order(p.x) - order(q.x));
      const subjects = [...bySubject].map(([id, points]) => ({ id, points: points.sort((p, q) => order(p.x) - order(q.x)) }));
      const s: Series = { level: c, cells, subjects };
      const pts = isCov ? subjectRows.filter((r) => Number.isFinite(r[spec.x as string] as number)) : [];
      if (pts.length > 2) {
        const xs = pts.map((r) => r[spec.x as string] as number), ys = pts.map((r) => r.value as number);
        s.fit = fitLine(xs, ys);
        s.rank = spearman(xs, ys);
        const out = new Set(s.fit.influential);
        if (out.size && pts.length - out.size > 2) {
          const keep = (_: unknown, i: number) => !out.has(i);
          s.robust = { fit: fitLine(xs.filter(keep), ys.filter(keep)), subjects: [...out].map((i) => String(pts[i][b.subject as string])) };
        }
      }
      return s;
    }),
  }));

  const nByLevel: Record<string, number> = {};
  if (b.subject) for (const l of spec.color ? colorLevels : ['']) {
    nByLevel[l] = new Set(rows.filter((r) => !spec.color || String(r[spec.color]) === l).map((r) => r[b.subject as string])).size;
  }
  const nByFacet: Record<string, number> = {};
  if (b.subject && spec.facet) for (const l of facetLevels as string[]) {
    nByFacet[l] = new Set(rows.filter((r) => String(r[spec.facet as string]) === l).map((r) => r[b.subject as string])).size;
  }
  const unitOf = (n: string | undefined) => (n === b.axis?.name ? b.axis?.unit : n === b.axis?.basis?.name ? b.axis?.basis?.unit :
    b.columns.find((c) => c.name === n)?.unit);
  return {
    probe: ext.label,
    voxels: ext.voxels,
    nSubjects: b.subject ? new Set(rows.map((r) => r[b.subject as string])).size : rows.length,
    x: { name: spec.x ?? null, kind: xKind, levels: xLevels, unit: unitOf(spec.x) },
    y: { label: b.valueLabel ?? 'value' },
    color: { name: spec.color ?? null, levels: colorLevels },
    facet: { name: spec.facet ?? null },
    panels,
    error: isCov ? 'none' : sum.error,
    paired,
    subjects: spec.subjects ?? 'points',
    covariate: isCov,
    collapsed,
    nByLevel,
    nByFacet,
    mixed: sum.error === 'within' && keys.some((k) => k !== ax && !within.includes(k)),
    incomplete: sum.incomplete,
    circular,
    provenance: b.provenance,
  };
}
