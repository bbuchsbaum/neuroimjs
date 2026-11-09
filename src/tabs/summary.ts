/**
 * NFTab Summary Profile 0.1.0 (draft): stored estimates and interval bounds
 * (`extensions.x-summary`), read, written and labelled as the profile says.
 * See neurotabs spec/summary/README.md; the conformance fixtures in
 * tests/tabs/summary-profile are the contract this module is tested against.
 *
 * Nothing here computes a statistic: bounds are shown as stored and never
 * recalculated from n, sd, se or a design (§4).
 */
import { INTERVAL_KINDS, type IntervalKind } from './summaryRegistry';

export const SUMMARY_PROFILE_VERSION = '0.1.0';

/** One summary row: the reserved columns, plus grouping columns kept as text. */
export interface SummaryRow {
  estimate: number | null;
  lower: number | null;
  upper: number | null;
  interval_kind: string;
  interval_level?: number | null;
  df?: number | null;
  n?: number | null;
  sd?: number | null;
  se?: number | null;
  method?: string | null;
  interval_reason?: string | null;
  interval_definition?: string | null;
  original_kind?: string | null;
  mean_voxel_se?: number | null;
  [column: string]: string | number | boolean | null | undefined;
}

export interface SummaryPlot {
  mark: 'point' | 'line' | 'interval';
  x?: string;
  color?: string;
  facet?: string;
  detail?: string;
  y_label?: string;
  order?: Record<string, (string | number | boolean)[]>;
}

export interface SummaryDesign { subject: string; within: Record<string, (string | number | boolean)[]>; between: string[]; repeat?: string[] }

export interface SummaryTableDescriptor {
  table: { path: string; format: 'csv' | 'tsv' };
  statistic: 'mean' | 'median' | 'custom';
  counting_unit: string;
  unit?: string;
  definition?: string;
  design?: SummaryDesign;
  plot?: SummaryPlot;
  extensions?: Record<string, unknown>;
}

export interface SummaryDescriptor { version: string; tables: Record<string, SummaryTableDescriptor> }

export interface SummaryTable {
  name: string;
  descriptor: SummaryTableDescriptor;
  /** Column names in file order. */
  columns: string[];
  rows: SummaryRow[];
}

const fail = (msg: string): never => { throw new Error(`NFTab summary: ${msg}`); };
const KIND = new Map(INTERVAL_KINDS.map((k) => [k.id, k]));
const NUMERIC = ['estimate', 'lower', 'upper', 'interval_level', 'df', 'n', 'sd', 'se', 'mean_voxel_se'];
const TEXT = ['interval_kind', 'method', 'interval_reason', 'interval_definition', 'original_kind'];
const RESERVED = new Set([...NUMERIC, ...TEXT]);
const REQUIRED = ['estimate', 'lower', 'upper', 'interval_kind'];
const ALIASES_OUT = ['conf_level', 'conf.low', 'conf.high', 'lwr', 'upr'];
const nonEmpty = (v: unknown) => typeof v === 'string' && /\S/.test(v);
const isNum = (v: unknown): v is number => typeof v === 'number';

export function intervalKind(id: string): IntervalKind | undefined {
  return KIND.get(id);
}

/** Does this kind take a level (interval_level required)? */
const takesLevel = (k: IntervalKind | undefined) => !!k && k.level !== 'none';

// ---------------------------------------------------------------- descriptor

/** Check an x-summary object (summary.schema.json, plus path rules). */
export function validateDescriptor(x: unknown): SummaryDescriptor {
  const d = x as SummaryDescriptor;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return fail('the x-summary descriptor is not an object');
  for (const k of Object.keys(d)) if (k !== 'version' && k !== 'tables') fail(`unknown descriptor key "${k}"`);
  if (d.version !== SUMMARY_PROFILE_VERSION) fail(`version ${String(d.version)} is not supported (this reader reads ${SUMMARY_PROFILE_VERSION})`);
  if (!d.tables || typeof d.tables !== 'object' || !Object.keys(d.tables).length) fail('tables must name at least one table');
  for (const [name, t] of Object.entries(d.tables)) {
    const where = `table "${name}"`;
    if (!nonEmpty(name)) fail('table names must be non-empty');
    if (!t || typeof t !== 'object') fail(`${where} is not an object`);
    const allowed = new Set(['table', 'statistic', 'counting_unit', 'unit', 'definition', 'design', 'plot', 'extensions']);
    for (const k of Object.keys(t)) if (!allowed.has(k)) fail(`${where}: unknown key "${k}"`);
    if (!t.table || typeof t.table !== 'object') fail(`${where}: table is required`);
    for (const k of Object.keys(t.table)) if (k !== 'path' && k !== 'format') fail(`${where}: unknown table key "${k}"`);
    checkPath(t.table.path, where);
    if (t.table.format !== 'csv' && t.table.format !== 'tsv') fail(`${where}: format must be csv or tsv`);
    if (!['mean', 'median', 'custom'].includes(t.statistic)) fail(`${where}: statistic must be mean, median or custom`);
    if (!nonEmpty(t.counting_unit)) fail(`${where}: counting_unit is required`);
    if (t.unit !== undefined && !nonEmpty(t.unit)) fail(`${where}: unit must be non-empty when given`);
    if (t.statistic === 'custom' && !nonEmpty(t.definition)) fail(`${where}: a custom statistic needs a definition`);
    if (t.definition !== undefined && !nonEmpty(t.definition)) fail(`${where}: definition must be non-empty when given`);
    if (t.design !== undefined) checkDesign(t.design, where);
    if (t.plot !== undefined) checkPlot(t.plot, where);
    if (t.extensions !== undefined) for (const k of Object.keys(t.extensions)) if (!k.startsWith('x-')) fail(`${where}: extension key "${k}" must begin with "x-"`);
  }
  return d;
}

function checkPath(p: unknown, where: string): void {
  // §1: relative, inside the package; no absolute paths, URLs, drive letters or "..".
  if (typeof p !== 'string' || !p.length || p.startsWith('/') || /[:\\]/.test(p) || p.split('/').includes('..')) {
    fail(`${where}: path must be a relative path inside the package`);
  }
}

function checkDesign(d: SummaryDesign, where: string): void {
  if (!d || typeof d !== 'object') fail(`${where}: design must be an object`);
  for (const k of Object.keys(d)) if (!['subject', 'within', 'between', 'repeat'].includes(k)) fail(`${where}: unknown design key "${k}"`);
  if (!nonEmpty(d.subject)) fail(`${where}: design.subject is required`);
  if (!d.within || typeof d.within !== 'object' || Array.isArray(d.within)) fail(`${where}: design.within must map factors to levels`);
  for (const [f, levels] of Object.entries(d.within)) uniqueList(levels, `${where}: design.within.${f}`, 1);
  if (!Array.isArray(d.between)) fail(`${where}: design.between must be a list`);
  uniqueList(d.between, `${where}: design.between`, 0, true);
  if (d.repeat !== undefined) uniqueList(d.repeat, `${where}: design.repeat`, 0, true);
}

function checkPlot(p: SummaryPlot, where: string): void {
  if (!p || typeof p !== 'object') fail(`${where}: plot must be an object`);
  for (const k of Object.keys(p)) if (!['mark', 'x', 'color', 'facet', 'detail', 'y_label', 'order'].includes(k)) fail(`${where}: unknown plot key "${k}"`);
  if (!['point', 'line', 'interval'].includes(p.mark)) fail(`${where}: plot.mark must be point, line or interval`);
  for (const k of ['x', 'color', 'facet', 'detail', 'y_label'] as const) if (p[k] !== undefined && !nonEmpty(p[k])) fail(`${where}: plot.${k} must be non-empty`);
  if (p.order !== undefined) for (const [c, levels] of Object.entries(p.order)) uniqueList(levels, `${where}: plot.order.${c}`, 1);
}

function uniqueList(v: unknown, where: string, min: number, strings = false): void {
  if (!Array.isArray(v) || v.length < min) fail(`${where} must be a list of at least ${min}`);
  const seen = new Set<string>();
  for (const x of v as unknown[]) {
    if (strings ? !nonEmpty(x) : !['string', 'number', 'boolean'].includes(typeof x)) fail(`${where} has an invalid entry`);
    const k = JSON.stringify(x);
    if (seen.has(k)) fail(`${where} repeats ${k}`);
    seen.add(k);
  }
}

// ---------------------------------------------------------------- rows

/**
 * Check one canonical row (summary-row.schema.json and the semantic pass of
 * §9: finite numbers, bound order, registry applicability). Throws the reason.
 */
export function validateRow(row: SummaryRow, statistic: 'mean' | 'median' | 'custom' = 'mean'): void {
  for (const k of REQUIRED) if (!(k in row)) fail(`missing required column "${k}"`);
  for (const k of ALIASES_OUT) if (k in row) fail(`"${k}" is an import alias, not a canonical column`);
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) continue;
    if (NUMERIC.includes(k)) {
      if (!isNum(v)) fail(`"${k}" must be a number`);
      if (!Number.isFinite(v)) fail(`summary numbers must be finite ("${k}")`);
    } else if (TEXT.includes(k) && k !== 'interval_kind' && !nonEmpty(v)) fail(`"${k}" must be non-empty text when given`);
    else if (!RESERVED.has(k) && !['string', 'number', 'boolean'].includes(typeof v)) fail(`"${k}" must be a scalar`);
  }
  const kind = KIND.get(String(row.interval_kind));
  if (!kind) fail(`interval_kind "${String(row.interval_kind)}" is not a canonical kind (import it to keep it as custom)`);
  const lv = row.interval_level ?? null, lo = row.lower ?? null, hi = row.upper ?? null, est = row.estimate ?? null;
  if (takesLevel(kind)) {
    if (lv === null) fail(`${kind!.id} needs interval_level`);
    if (!((lv as number) > 0 && (lv as number) < 1)) fail('interval_level must lie strictly between 0 and 1');
  } else if (lv !== null) fail(`${kind!.id} takes no interval_level`);
  if (kind!.id === 'none' && (lo !== null || hi !== null)) fail('interval_kind none has no bounds');
  if ((lo === null) !== (hi === null)) fail('lower and upper must both be numbers or both be null');
  if (lo !== null && est === null) fail('finite bounds need a finite estimate');
  if (lo !== null && hi !== null && lo > hi) fail('lower exceeds upper');
  if (kind!.id !== 'none' && kind!.id !== 'custom' && lo === null && !nonEmpty(row.interval_reason)) fail('a requested interval without bounds needs interval_reason');
  if (kind!.id === 'custom') {
    if (!nonEmpty(row.interval_definition)) fail('custom needs interval_definition');
    if (lo === null) fail('custom needs stored bounds');
  }
  if ((kind!.id === 'ci_t' || kind!.id === 'wsci_cm') && lo !== null && !(isNum(row.df) && row.df > 0)) fail(`${kind!.id} with bounds needs df > 0`);
  if (row.df != null && !(row.df > 0)) fail('df must be positive');
  if (row.n != null && !(Number.isInteger(row.n) && row.n >= 0)) fail('n must be a non-negative integer');
  for (const k of ['sd', 'se', 'mean_voxel_se'] as const) if (row[k] != null && !((row[k] as number) >= 0)) fail(`${k} must be non-negative`);
  if (kind!.id === 'heuristic_se' && row.se != null) fail('heuristic_se keeps its input in mean_voxel_se, never se');
  if (row.original_kind != null && kind!.id !== 'custom') fail('original_kind belongs to custom rows');
  if (!kind!.statistics.includes(statistic)) fail(`interval kind ${kind!.id} does not apply to statistic ${statistic}`);
}

// ---------------------------------------------------------------- tables

const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

/**
 * Read a canonical summary table (§3): UTF-8 with a header of unique names,
 * the empty field as null, empty lines only after the last record; reserved
 * columns typed, every other column kept as text. Each row is validated.
 */
export function parseSummaryTable(text: string, format: 'csv' | 'tsv', statistic: 'mean' | 'median' | 'custom' = 'mean'): { columns: string[]; rows: SummaryRow[] } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const records = splitRecords(text, format === 'tsv' ? '\t' : ',');
  if (!records.length) fail('the table has no header');
  const [header, ...body] = records;
  const columns = header.map((h) => h ?? '');
  if (columns.some((h) => !h.length)) fail('summary columns must have non-empty names');
  if (new Set(columns).size !== columns.length) fail('duplicate summary columns');
  for (const k of REQUIRED) if (!columns.includes(k)) fail('missing required summary columns');
  const rows = body.map((r, i) => {
    if (r.length === 1 && r[0] === null && columns.length > 1) fail(`row ${i + 1}: empty line between records`);
    if (r.length !== columns.length) fail(`row ${i + 1}: ${r.length} fields for ${columns.length} columns`);
    const row: SummaryRow = { estimate: null, lower: null, upper: null, interval_kind: '' };
    columns.forEach((c, j) => {
      const v = r[j];
      if (NUMERIC.includes(c)) {
        if (v === null) row[c] = null;
        else if (!NUMBER.test(v)) fail(`row ${i + 1}: invalid numeric cell in "${c}"`);
        else row[c] = Number(v);
      } else row[c] = v;
    });
    try { validateRow(row, statistic); } catch (e) { fail(`row ${i + 1}: ${(e as Error).message.replace(/^NFTab summary: /, '')}`); }
    return row;
  });
  return { columns, rows };
}

/** RFC 4180 records; the empty unquoted field is null, a quoted empty field is "". */
function splitRecords(text: string, delim: string): (string | null)[][] {
  const out: (string | null)[][] = [];
  if (!text.length) return out;
  let rec: (string | null)[] = [];
  let field = '', quoted = false, wasQuoted = false;
  const end = () => { rec.push(field === '' && !wasQuoted ? null : field); field = ''; wasQuoted = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"' && field === '' && !wasQuoted) { quoted = true; wasQuoted = true; }
    else if (c === delim) end();
    else if (c === '\n') { end(); out.push(rec); rec = []; }
    else field += c;
  }
  if (quoted) fail('unterminated quoted field');
  end();
  out.push(rec);
  return out;
}

/** Write rows round-trip safely: shortest exact decimals, empty cells for null, quoting as needed. */
export function writeSummaryTable(columns: string[], rows: SummaryRow[], format: 'csv' | 'tsv' = 'csv'): string {
  const delim = format === 'tsv' ? '\t' : ',';
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('NaN and infinities cannot be written');
      return String(v); // JS shortest round-trip representation
    }
    const s = String(v);
    return s === '' || /["\n\r]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(delim), ...rows.map((r) => columns.map((c) => cell(r[c])).join(delim))].join('\n') + '\n';
}

// ---------------------------------------------------------------- import (§5)

/** The source a legacy table came from, when a bare `ci95` needs it. */
export type ImportContext = 'brainflow-population-v1' | 'brainflow-trace-v1' | 'row' | 'frame' | null;

/**
 * Map an older or unfamiliar row onto the canonical columns (§5). Aliases are
 * accepted here only; unknown kinds become custom with original_kind kept;
 * malformed known metadata and conflicting aliases are errors.
 */
export function importSummaryRow(input: Record<string, unknown>, context: ImportContext = null): SummaryRow {
  const row: Record<string, unknown> = {};
  const take = (canonical: string, ...aliases: string[]) => {
    const present = [canonical, ...aliases].filter((k) => input[k] !== undefined && input[k] !== null);
    const values = new Set(present.map((k) => JSON.stringify(input[k])));
    if (values.size > 1) fail(`conflicting values for ${canonical} (${present.join(', ')})`);
    if (present.length) row[canonical] = input[present[0]];
  };
  take('estimate', 'value');
  take('lower', 'conf.low', 'lwr');
  take('upper', 'conf.high', 'upr');
  take('interval_level', 'conf_level');
  const used = new Set(['estimate', 'value', 'lower', 'conf.low', 'lwr', 'upper', 'conf.high', 'upr', 'interval_level', 'conf_level', 'interval_kind']);
  for (const [k, v] of Object.entries(input)) if (!used.has(k)) row[k] = v;
  // A bare "level" is never an interval level.
  let kind = input.interval_kind == null ? null : String(input.interval_kind);
  const legacy: Record<string, [string, number]> = { ci95_t: ['ci_t', 0.95], wsci95_cm: ['wsci_cm', 0.95] };
  if (kind === 'ci95') {
    if (context === 'brainflow-population-v1') legacy.ci95 = ['ci_t', 0.95];
    else if (context === 'brainflow-trace-v1') legacy.ci95 = ['quantile_range', 0.95];
  }
  if (kind && legacy[kind]) {
    const [id, level] = legacy[kind];
    if (row.interval_level != null && row.interval_level !== level) fail(`${kind} means level ${level}, but ${String(row.interval_level)} was supplied`);
    kind = id;
    row.interval_level = level;
  }
  const hasBounds = row.lower != null || row.upper != null;
  if (kind === null) {
    if (hasBounds) { row.interval_kind = 'custom'; row.interval_definition = row.interval_definition ?? 'Definition not supplied'; }
    else row.interval_kind = 'none';
  } else if (!KIND.has(kind)) {
    row.interval_kind = 'custom';
    row.original_kind = kind;
    if (!nonEmpty(row.interval_definition)) row.interval_definition = `Unknown interval kind: ${kind}`;
  } else row.interval_kind = kind;
  for (const k of REQUIRED) if (!(k in row)) row[k] = null;
  const out = row as SummaryRow;
  validateRow(out, out.interval_kind === 'custom' ? 'custom' : 'mean');
  return out;
}

// ---------------------------------------------------------------- labels (§4)

const pct = (level: number) => String(+(100 * level).toPrecision(12));

/** The reference English label of a row's interval. */
export function intervalLabel(row: Pick<SummaryRow, 'interval_kind' | 'interval_level' | 'interval_definition'>): string {
  if (row.interval_kind === 'custom') return String(row.interval_definition ?? '');
  const kind = KIND.get(row.interval_kind) ?? fail(`unknown interval kind ${row.interval_kind}`);
  if (kind.label.includes('{percent}')) {
    if (row.interval_level == null) fail(`${kind.id} has no level to label`);
    return kind.label.replace('{percent}', pct(row.interval_level as number));
  }
  return kind.label;
}

/**
 * The distinct interval labels among rows. One label may name a whole plot;
 * several must not be merged into one (§4).
 */
export function intervalLabels(rows: SummaryRow[]): { label: string; rows: number }[] {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.interval_kind === 'none') continue;
    const l = intervalLabel(r);
    out.set(l, (out.get(l) ?? 0) + 1);
  }
  return [...out].map(([label, n]) => ({ label, rows: n }));
}

// ---------------------------------------------------------------- reading x-summary

/** Read every table of an x-summary descriptor through `read` (paths relative to the descriptor). */
export async function readSummaries(x: unknown, read: (path: string) => Promise<ArrayBuffer>): Promise<SummaryTable[]> {
  const d = validateDescriptor(x);
  const out: SummaryTable[] = [];
  for (const [name, t] of Object.entries(d.tables)) {
    let bytes: ArrayBuffer;
    try { bytes = await read(t.table.path); } catch (e) { return fail(`table "${name}": cannot read ${t.table.path} (${(e as Error).message})`); }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail(`table "${name}": summary table must be UTF-8`); }
    let parsed: { columns: string[]; rows: SummaryRow[] };
    try { parsed = parseSummaryTable(text, t.table.format, t.statistic); } catch (e) { return fail(`table "${name}": ${(e as Error).message.replace(/^NFTab summary: /, '')}`); }
    const plot = t.plot;
    if (plot) {
      for (const c of [plot.x, plot.color, plot.facet, plot.detail, ...Object.keys(plot.order ?? {})]) {
        if (c !== undefined && !parsed.columns.includes(c)) fail(`table "${name}": plot references unknown column "${c}"`);
      }
      for (const [c, levels] of Object.entries(plot.order ?? {})) {
        const allowed = new Set(levels.map(String));
        for (const r of parsed.rows) if (r[c] != null && !allowed.has(String(r[c]))) fail(`table "${name}": plot order omits table levels in "${c}"`);
      }
    }
    out.push({ name, descriptor: t, ...parsed });
  }
  return out;
}
