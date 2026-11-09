/**
 * NFTab Summary Profile 0.1.0, run against the profile's own conformance
 * fixtures (vendored from neurotabs inst/schema/summary, pinned by SHA-256).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  validateRow, validateDescriptor, parseSummaryTable, writeSummaryTable, importSummaryRow, intervalLabel, intervalLabels,
  openNFTab, openSummary, INTERVAL_KINDS, type SummaryRow, type ImportContext,
} from '../../src/tabs';

const dir = join(__dirname, 'summary-profile');
const file = (f: string) => readFileSync(join(dir, f));
const cases = JSON.parse(file('cases.json').toString());
const byId = new Map<string, { row: SummaryRow; label: string }>(cases.valid.map((c: { id: string }) => [c.id, c]));

describe('the vendored artifact', () => {
  it('matches the compatibility manifest, which matches the pinned digest', () => {
    // Pinned from neurotabs main bb4b35c (inst/schema/summary/compatibility.json).
    expect(createHash('sha256').update(file('compatibility.json')).digest('hex')).toBe('247ac4f366ddd1cc225608f3b0e7707c769128a89bc4d4619bddf5cf9d4fa22c');
    const compat = JSON.parse(file('compatibility.json').toString());
    expect(compat.version).toBe('0.1.0');
    for (const [f, digest] of Object.entries(compat.files)) expect(createHash('sha256').update(file(f)).digest('hex'), f).toBe(digest);
  });
  it('embeds exactly the registry it vendors', () => {
    expect(INTERVAL_KINDS).toEqual(JSON.parse(file('interval-kinds.json').toString()).kinds);
  });
});

describe('canonical rows', () => {
  for (const c of cases.valid) {
    it(`accepts ${c.id} and labels it "${c.label}"`, () => {
      expect(() => validateRow(c.row, 'mean')).not.toThrow();
      expect(intervalLabel(c.row)).toBe(c.label);
    });
  }
  for (const c of cases.invalid) {
    it(`rejects ${c.id}`, () => expect(() => validateRow(c.row, c.statistic ?? 'mean')).toThrow());
  }
});

describe('imports (§5)', () => {
  for (const c of cases.imports) {
    it(`${c.id}${c.error ? ' is an error' : ''}`, () => {
      if (c.error) expect(() => importSummaryRow(c.input, c.context as ImportContext)).toThrow();
      else expect(importSummaryRow(c.input, c.context as ImportContext)).toEqual(c.expected);
    });
  }
});

describe('labels for mixed rows (§4)', () => {
  it('never gives mixed kinds or levels one common label', () => {
    const rows = cases.mixed_rows.map((id: string) => byId.get(id)!.row);
    const labels = intervalLabels(rows);
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.map((l) => l.label)).toEqual(['95% CI (t)', '90% CI (normal)', 'Bootstrap percentile bounds', '95% within-subject CI (Cousineau–Morey)', '90% CI (t)', 'Expert supplied bounds, including "judgment"']);
  });
});

describe('tables', () => {
  it('round-trips roundtrip.csv: values, nulls, precision and text identifiers survive read/write/read', () => {
    const text = file('roundtrip.csv').toString();
    const first = parseSummaryTable(text, 'csv', 'mean');
    expect(first.rows).toHaveLength(cases.roundtrip_rows.length);
    // The rows equal the JSON fixtures (absent optional fields read as null).
    cases.roundtrip_rows.forEach((id: string, i: number) => {
      const want = byId.get(id)!.row as Record<string, unknown>;
      for (const c of first.columns) expect(first.rows[i][c] ?? null, `${id}.${c}`).toEqual(want[c] ?? null);
    });
    const again = parseSummaryTable(writeSummaryTable(first.columns, first.rows), 'csv', 'mean');
    expect(again.rows).toEqual(first.rows);
    const precision = again.rows[cases.roundtrip_rows.indexOf('precision')];
    expect(precision.estimate).toBe(1.2345678901234567);
    expect(precision.region_id).toBe('001');
    expect(precision.text_label).toBe('NA');
  });
  it('reads the reference descriptor and its table', async () => {
    const tables = await openSummary({ 'summary.json': file('descriptor.json').toString(), 'summaries.csv': file('summaries.csv').toString() });
    expect(tables).toHaveLength(1);
    expect(tables[0].rows.map((r) => [r.condition, r.estimate, r.lower, r.upper])).toEqual([['A', 2, 1, 3], ['B', 4, 3, 5]]);
  });
  it('follows the CSV rules: unique headers, trailing empty lines only, strict numbers, text kept as text', () => {
    const h = 'condition,estimate,lower,upper,interval_kind\n';
    expect(parseSummaryTable(h + 'A,2,,,none\n\n\n', 'csv').rows).toHaveLength(1);
    expect(() => parseSummaryTable(h + 'A,2,,,none\n\nB,3,,,none\n', 'csv')).toThrow(/empty line/);
    expect(() => parseSummaryTable('estimate,estimate,lower,upper,interval_kind\n', 'csv')).toThrow(/duplicate/);
    expect(() => parseSummaryTable(h + 'A,NA,,,none\n', 'csv')).toThrow(/invalid numeric cell/);
    expect(() => parseSummaryTable(h + 'A,2,,,none,extra\n', 'csv')).toThrow(/fields/);
    expect(parseSummaryTable(h + '007,2,,,none\n', 'csv').rows[0].condition).toBe('007');
  });
  it('checks descriptors: paths inside the package, custom statistics defined, plot references', async () => {
    const t = (over: object) => ({ version: '0.1.0', tables: { e: { table: { path: 's.csv', format: 'csv' }, statistic: 'mean', counting_unit: 'subject', ...over } } });
    expect(() => validateDescriptor(t({}))).not.toThrow();
    expect(() => validateDescriptor(t({ table: { path: '../s.csv', format: 'csv' } }))).toThrow(/inside the package/);
    expect(() => validateDescriptor(t({ table: { path: 'https://x/s.csv', format: 'csv' } }))).toThrow(/inside the package/);
    expect(() => validateDescriptor(t({ statistic: 'custom' }))).toThrow(/definition/);
    expect(() => validateDescriptor({ ...t({}), version: '0.2.0' })).toThrow(/not supported/);
    const csv = 'condition,estimate,lower,upper,interval_kind\nA,2,,,none\nB,3,,,none\n';
    const files = (plot: object) => ({ 'summary.json': JSON.stringify(t({ plot })), 's.csv': csv });
    await expect(openSummary(files({ mark: 'point', x: 'region' }))).rejects.toThrow(/unknown column "region"/);
    await expect(openSummary(files({ mark: 'point', x: 'condition', order: { condition: ['A'] } }))).rejects.toThrow(/omits table levels/);
  });
  it('reads x-summary embedded in an NFTab manifest without changing core reading', async () => {
    const manifest = {
      spec_version: '0.1.0', dataset_id: 'd', storage_profile: 'table-package', observation_table: { path: 'obs.csv', format: 'csv' },
      row_id: 'row_id', observation_axes: ['subject'], observation_columns: { row_id: { dtype: 'string' }, subject: { dtype: 'string' }, a: { dtype: 'float64' } },
      features: { a: { logical: { kind: 'vector', axes: ['v'], dtype: 'float64' }, encodings: [{ type: 'columns', binding: { columns: ['a'] } }] } },
      extensions: { 'x-summary': JSON.parse(file('descriptor.json').toString()) },
    };
    const tab = await openNFTab({ 'nftab.json': JSON.stringify(manifest), 'obs.csv': 'row_id,subject,a\nr1,s1,1\n', 'summaries.csv': file('summaries.csv').toString() });
    expect(await tab.resolve(0, 'a')).toEqual([1]);
    expect((await tab.summaries())[0].descriptor.plot?.mark).toBe('point');
  });
});
