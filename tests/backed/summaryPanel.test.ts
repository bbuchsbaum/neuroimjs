/** Stored summaries (NFTab Summary Profile) drawn by PlotPanel, as stored. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PlotPanel } from '../../src/backed/PlotPanel';
import { summaryScene } from '../../src/backed/summaryScene';
import { openSummary, type SummaryTable } from '../../src/tabs';

const dir = join(__dirname, '..', 'tabs', 'summary-profile');
const fixture = async () => (await openSummary({
  'summary.json': readFileSync(join(dir, 'descriptor.json'), 'utf8'), 'summaries.csv': readFileSync(join(dir, 'summaries.csv'), 'utf8') }))[0];
const table = (csv: string, plot: object = { mark: 'point', x: 'condition' }, extra: object = {}): Promise<SummaryTable[]> => openSummary({
  'summary.json': JSON.stringify({ version: '0.1.0', tables: { effects: { table: { path: 's.csv', format: 'csv' }, statistic: 'mean', counting_unit: 'subject', unit: 'percent_signal_change', plot, ...extra } } }),
  's.csv': csv });

describe('stored summaries in PlotPanel', () => {
  it('draws the reference table as stored, named by its interval', async () => {
    const t = await fixture();
    const panel = PlotPanel.fromSummary(t, { width: 400 });
    const scene = summaryScene(t);
    expect(scene.panels[0].series[0].cells.map((c) => [c.x, c.mean, c.lo, c.hi])).toEqual([['A', 2, 1, 3], ['B', 4, 3, 5]]);
    expect(scene.y.label).toBe('Mean (percent signal change)');
    expect(panel.element.querySelectorAll('.nij-err')).toHaveLength(2);
    expect(panel.element.querySelector('.nij-plot-meta')?.textContent).toBe('2 stored rows · mean over subjects');
    expect(panel.element.querySelector('.nij-plot-foot')?.textContent).toBe('Bars: 95% CI (t). Stored values, drawn as stored; nothing is recalculated.');
    expect(panel.element.querySelector('.nij-plot-controls')).toBeNull(); // the profile's plot does not aggregate
  });

  it('never merges mixed interval kinds into one label, and says which rows lack bounds or estimates', async () => {
    const csv = 'condition,estimate,lower,upper,interval_kind,interval_level,df,n,interval_reason\n' +
      'A,2,1,3,ci_t,0.95,9,10,\nB,4,3.5,4.5,se,,,10,\nC,1,,,ci_t,0.95,,1,Fewer than two observations\nD,,,,ci_t,0.95,,0,No observations\n';
    const [t] = await table(csv);
    const panel = PlotPanel.fromSummary(t, { width: 400 });
    const foot = panel.element.querySelector('.nij-plot-foot')?.textContent ?? '';
    expect(foot).toContain('Bars differ between rows: 95% CI (t) (3 rows); ± SE (1 row).');
    expect(foot).toContain('1 row has no stored bounds.');
    expect(foot).toContain('1 row has no estimate and is not drawn.');
    expect(panel.element.querySelectorAll('.nij-mean')).toHaveLength(3); // D has no estimate
    const c = summaryScene(t).panels[0].series[0].cells.find((x) => x.x === 'C')!;
    expect(c.note).toEqual(['95% CI (t)', 'no interval: Fewer than two observations', 'n = 1 subject']);
  });

  it('lays out color, facet and order from the plot block, and connects lines for mark: line', async () => {
    const csv = 'region,group,condition,estimate,lower,upper,interval_kind,interval_level,df\n' +
      'FFA,control,houses,1,0.5,1.5,ci_t,0.95,9\nFFA,control,faces,2,1.5,2.5,ci_t,0.95,9\nFFA,patient,faces,1.5,1,2,ci_t,0.95,9\nFFA,patient,houses,1,0.5,1.5,ci_t,0.95,9\n' +
      'PPA,control,faces,0.5,0,1,ci_t,0.95,9\nPPA,control,houses,2,1.5,2.5,ci_t,0.95,9\n';
    const [t] = await table(csv, { mark: 'line', x: 'condition', color: 'group', facet: 'region', order: { condition: ['faces', 'houses'] } });
    const scene = summaryScene(t);
    expect(scene.x.levels).toEqual(['faces', 'houses']);
    expect(scene.panels.map((p) => p.facet)).toEqual(['FFA', 'PPA']);
    expect(scene.panels[0].series.map((s) => [s.level, s.cells.map((c) => c.x)])).toEqual([['control', ['faces', 'houses']], ['patient', ['faces', 'houses']]]);
    const panel = PlotPanel.fromSummary(t, { width: 500 });
    expect(panel.element.querySelectorAll('.nij-mean-line')).toHaveLength(3);
  });

  it('draws a numeric x with mark: line on a linear axis (e.g. lags)', async () => {
    const csv = 'time,estimate,lower,upper,interval_kind,interval_level,df\n0,0,-0.2,0.2,ci_t,0.95,9\n2,1,0.8,1.2,ci_t,0.95,9\n4,0.5,0.3,0.7,ci_t,0.95,9\n';
    const [t] = await table(csv, { mark: 'line', x: 'time' });
    expect(summaryScene(t).x.kind).toBe('linear');
    const panel = PlotPanel.fromSummary(t, { width: 400 });
    expect(panel.element.querySelector('.nij-ribbon')).not.toBeNull();
  });
});
