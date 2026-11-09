/**
 * A stored summary table (NFTab Summary Profile) as a plot scene: estimates
 * and bounds exactly as stored, laid out by the table's plot block. Nothing is
 * aggregated, filtered or recomputed (§4, §7).
 */
import type { Scene, Panel, Series } from './spec';
import type { Cell } from './frame';
import { type SummaryTable, type SummaryRow, intervalLabel, intervalLabels } from '../tabs/summary';

const plural = (unit: string, n: number) => (n === 1 ? unit : unit.endsWith('s') ? unit : `${unit}s`);
const STATISTIC: Record<string, string> = { mean: 'Mean', median: 'Median' };

export function summaryScene(table: SummaryTable): Scene {
  const d = table.descriptor;
  const plot = d.plot ?? { mark: 'point' as const };
  const rows = table.rows;
  const text = (r: SummaryRow, c?: string) => (c ? String(r[c] ?? '') : '');
  const levels = (c?: string): string[] => {
    if (!c) return [];
    const present = [...new Set(rows.map((r) => text(r, c)))];
    const declared = plot.order?.[c]?.map(String);
    return declared ? declared.filter((l) => present.includes(l)) : present;
  };
  const xs = levels(plot.x);
  const linear = plot.mark === 'line' && xs.length > 1 && xs.every((v) => v !== '' && Number.isFinite(Number(v)));
  const colors = levels(plot.color);
  const facets = plot.facet ? levels(plot.facet) : [null];
  const details = plot.detail ? levels(plot.detail) : [null];
  const statistic = d.statistic === 'custom' ? d.definition ?? 'custom statistic' : STATISTIC[d.statistic] ?? d.statistic;

  const cellOf = (r: SummaryRow): Cell & { x: string | number } => {
    const note: string[] = [];
    if (r.interval_kind !== 'none') note.push(intervalLabel(r));
    if (r.interval_kind !== 'none' && r.lower == null) note.push(`no interval: ${r.interval_reason ?? 'unavailable'}`);
    if (r.n != null) note.push(`n = ${r.n} ${plural(d.counting_unit, r.n)}`);
    if (r.method) note.push(String(r.method));
    if (r.estimate == null) note.push('no estimate');
    const key: Record<string, string | number | null> = {};
    for (const c of [plot.x, plot.color, plot.facet, plot.detail]) if (c) key[c] = text(r, c);
    return {
      key, x: plot.x ? (linear ? Number(text(r, plot.x)) : text(r, plot.x)) : '',
      mean: r.estimate ?? NaN, lo: r.lower ?? NaN, hi: r.upper ?? NaN, n: r.n ?? NaN, note,
    };
  };
  const order = (c: { x: string | number }) => (linear ? (c.x as number) : xs.indexOf(String(c.x)));
  const panels: Panel[] = facets.map((f) => ({
    facet: f,
    series: (plot.color ? colors : [null]).flatMap((col) => details.map((det): Series => ({
      level: col,
      subjects: [],
      cells: rows.filter((r) => (!plot.facet || text(r, plot.facet) === f) && (!plot.color || text(r, plot.color) === col) && (!plot.detail || text(r, plot.detail) === det))
        .map(cellOf).sort((a, b) => order(a) - order(b)),
    }))).filter((s) => s.cells.length),
  }));

  // §4: one label may name the plot; mixed kinds or levels are listed, never merged.
  const labels = intervalLabels(rows);
  const foot: string[] = [];
  if (labels.length === 1) foot.push(`Bars: ${labels[0].label}.`);
  else if (labels.length > 1) foot.push(`Bars differ between rows: ${labels.map((l) => `${l.label} (${l.rows} row${l.rows === 1 ? '' : 's'})`).join('; ')}. Point at a bar for its interval.`);
  const unavailable = rows.filter((r) => r.interval_kind !== 'none' && r.lower == null && r.estimate != null).length;
  if (unavailable) foot.push(`${unavailable} row${unavailable === 1 ? ' has' : 's have'} no stored bounds.`);
  const noEstimate = rows.filter((r) => r.estimate == null).length;
  if (noEstimate) foot.push(`${noEstimate} row${noEstimate === 1 ? ' has' : 's have'} no estimate and ${noEstimate === 1 ? 'is' : 'are'} not drawn.`);
  if (d.statistic === 'custom' || d.definition) foot.push(`${d.definition ?? ''}`.trim() ? `Statistic: ${d.definition}.` : '');
  foot.push('Stored values, drawn as stored; nothing is recalculated.');

  const unit = d.unit ? ` (${d.unit.replace(/_/g, ' ')})` : '';
  const ns = rows.map((r) => r.n).filter((n): n is number => n != null);
  return {
    probe: table.name,
    voxels: rows.length,
    nSubjects: ns.length ? Math.max(...ns) : 0,
    x: { name: plot.x ?? null, kind: linear ? 'linear' : 'band', levels: linear ? [] : xs },
    y: { label: plot.y_label ?? `${statistic}${unit}` },
    color: { name: plot.color ?? null, levels: colors },
    facet: { name: plot.facet ?? null },
    panels,
    error: 'none',
    paired: plot.mark === 'line',
    subjects: 'hidden',
    covariate: false,
    collapsed: [],
    nByLevel: {},
    nByFacet: {},
    mixed: false,
    incomplete: [],
    circular: false,
    stored: {
      meta: `${rows.length} stored row${rows.length === 1 ? '' : 's'} · ${statistic.toLowerCase()} over ${plural(d.counting_unit, 2)}`,
      foot: foot.filter(Boolean),
      mark: plot.mark,
    },
  };
}
