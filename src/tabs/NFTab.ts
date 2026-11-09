/**
 * NFTab reader for the browser (and Node): the manifest, the observation
 * table and the resource registry, read over HTTP or from supplied files.
 * Nothing here needs a server or R; a static directory is enough.
 *
 * Supported: `columns` encodings; `ref` encodings with the `nifti` backend
 * (selector `{ "index": { "t": k } }`); volume features with a fourth,
 * non-spatial axis (FIR lags, basis coefficients); the `x-backing`
 * and `x-volume-series` draft extensions (neurotabs spec/extensions). A feature's rows become
 * a {@link MemoryBacking} for plotting.
 */
import * as nifti from 'nifti-reader-js';
import { readNiftiArrayBuffer } from '../io/browserNifti';
import { NeuroSpace } from '../geometry/NeuroSpace';
import type { NeuroVol } from '../volume/NeuroVol';
import { MemoryBacking } from '../backed/MemoryBacking';
import type { Axis, Column, Row } from '../backed/types';
import { type Dtype, convert, parseDelimited } from './table';
import { type SummaryTable, readSummaries } from './summary';

type ValueSource = string | number | boolean | null | { column: string } | Record<string, unknown>;

export interface ColumnSchema { dtype: Dtype; nullable?: boolean; semantic_role?: string; levels?: string[]; unit?: string; description?: string }
export interface Encoding {
  type: 'ref' | 'columns';
  binding: { resource_id?: ValueSource; backend?: ValueSource; locator?: ValueSource; selector?: ValueSource; checksum?: ValueSource; columns?: string[] };
}
export interface AxisDomain { id?: string; labels?: string; size?: number; description?: string }
export interface FeatureSchema {
  logical: {
    kind: string; axes: string[]; dtype: string; shape?: number[]; support_ref?: string; space?: string; alignment?: string;
    unit?: string; description?: string; axis_domains?: Record<string, AxisDomain>;
  };
  encodings: Encoding[];
  nullable?: boolean;
  description?: string;
}
export interface TableRef { path: string; format: 'csv' | 'tsv' | 'parquet' }
export interface Manifest {
  spec_version: string;
  dataset_id: string;
  storage_profile: string;
  observation_table: TableRef;
  row_id: string;
  observation_axes: string[];
  observation_columns: Record<string, ColumnSchema>;
  features: Record<string, FeatureSchema>;
  supports?: Record<string, Record<string, unknown>>;
  primary_feature?: string;
  resources?: TableRef;
  extensions?: Record<string, unknown>;
}

/** Where a map came from: the `x-backing` extension of a result dataset (draft 0.1.0). */
export interface BackingLink {
  version?: string;
  /** Path of the source dataset's manifest (or its directory), relative to this one. */
  source: string;
  /** The source feature the map was computed from. */
  feature: string;
  /** What the map shows, e.g. "faces − houses". */
  map?: string;
  /** The map's statistic, e.g. "t". */
  stat?: string;
  formula?: string;
  /** sha256 of the source manifest when the map was written. */
  source_checksum?: string;
}

export const BACKING_VERSION = '0.1.0';
export const VOLUME_SERIES_VERSION = '0.1.0';

/** A volume with a fourth, non-spatial axis: `data[voxel + a * nVoxels]`. */
export interface VolumeSeries { space: NeuroSpace; data: Float32Array; width: number }

/** How to read files: a base URL, a reader, or files already in hand (by relative path). */
export type NFTabSource =
  | string
  | { read(path: string): Promise<ArrayBuffer> }
  | Record<string, ArrayBuffer | Uint8Array | string>;

export interface OpenOptions {
  /** Parses a YAML manifest; JSON manifests need nothing. */
  parseYaml?: (text: string) => unknown;
  /**
   * Where the manifest is within the source: a manifest path or a directory
   * (default the root). Links between datasets (x-backing) resolve against it.
   */
  at?: string;
  /** Verify sha256 checksums given in the registry or bindings. Default true. */
  verifyChecksums?: boolean;
}

type Reader = (path: string) => Promise<ArrayBuffer>;
type Table = { header: string[]; rows: (string | null)[][] };

const FACTOR_ROLES = new Set(['subject', 'group', 'condition', 'session', 'run', 'contrast', 'site', 'row_id']);
const fail = (msg: string): never => { throw new Error(`NFTab: ${msg}`); };
const isManifestName = (p: string) => /\.(json|ya?ml)$/i.test(p);
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

/** "a/./b/../c" → "a/c"; leading ".." is kept (a URL source can go above its root). */
function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

/** Open a dataset: a manifest URL or path, a directory holding nftab.json / nftab.yaml, or a set of files. */
export async function openNFTab(source: NFTabSource, opts: OpenOptions = {}): Promise<NFTab> {
  if (typeof source === 'string' && isManifestName(source)) {
    const cut = source.lastIndexOf('/') + 1;
    return openAt(makeReader(source.slice(0, cut) || './'), normalize(source.slice(cut)), opts);
  }
  return openAt(makeReader(source), normalize(opts.at ?? ''), opts);
}

/** Open the manifest at `ref` (a manifest path, a directory, or '' for the root) through `read`. */
async function openAt(read: Reader, ref: string, opts: OpenOptions): Promise<NFTab> {
  const base = isManifestName(ref) ? dirOf(ref) : ref && !ref.endsWith('/') ? ref + '/' : ref;
  const candidates = isManifestName(ref) ? [ref] : ['nftab.json', 'nftab.yaml', 'nftab.yml'].map((n) => base + n);
  let text: string | null = null, name = '';
  for (const c of candidates) {
    try { text = new TextDecoder().decode(await read(normalize(c))); name = c; break; } catch { /* try the next name */ }
  }
  if (text == null) return fail(`no manifest found (looked for ${candidates.join(', ')})`);
  let raw: unknown;
  if (/\.ya?ml$/i.test(name)) {
    if (!opts.parseYaml) return fail(`${name} is YAML; pass options.parseYaml, or provide nftab.json`);
    raw = opts.parseYaml(text);
  } else {
    try { raw = JSON.parse(text); } catch (e) { return fail(`${name} is not valid JSON (${(e as Error).message})`); }
  }
  const manifest = validateManifest(raw);
  const rel = (p: string) => read(normalize(base + p));
  const obs = await readTable(rel, manifest.observation_table, 'observation table');
  const resources = manifest.resources ? await readTable(rel, manifest.resources, 'resource registry') : null;
  return new NFTab(manifest, obs, resources, read, base, opts);
}

function makeReader(source: NFTabSource): Reader {
  if (typeof source === 'string') {
    const here = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
    const root = new URL(source.replace(/\/?$/, '/'), here);
    return async (p) => {
      const url = new URL(p, root).href;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url} answered ${r.status}`);
      return r.arrayBuffer();
    };
  }
  if (typeof (source as { read?: unknown }).read === 'function') {
    const s = source as { read(path: string): Promise<ArrayBuffer> };
    return (p) => s.read(normalize(p));
  }
  const files = source as Record<string, ArrayBuffer | Uint8Array | string>;
  return async (p) => {
    const v = files[normalize(p)];
    if (v === undefined) throw new Error(`${normalize(p)} is not among the supplied files`);
    if (typeof v === 'string') return new TextEncoder().encode(v).buffer as ArrayBuffer;
    // isView rather than instanceof: files may come from another realm (a worker, Node's Buffer, jsdom).
    return ArrayBuffer.isView(v) ? (new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice().buffer as ArrayBuffer) : v;
  };
}

const MANIFEST_KEYS = new Set(['spec_version', 'dataset_id', 'storage_profile', 'observation_table', 'row_id', 'observation_axes',
  'observation_columns', 'features', 'supports', 'primary_feature', 'import_recipe', 'resources', 'extensions']);

function validateManifest(raw: unknown): Manifest {
  const m = raw as Manifest;
  if (!m || typeof m !== 'object') return fail('the manifest is not an object');
  for (const k of ['spec_version', 'dataset_id', 'storage_profile', 'observation_table', 'row_id', 'observation_axes', 'observation_columns', 'features'] as const) {
    if (m[k] === undefined) fail(`the manifest has no "${k}"`);
  }
  if (Number(String(m.spec_version).split('.')[0]) !== 0) fail(`spec_version ${m.spec_version} is not supported (this reader reads 0.x)`);
  if (!m.observation_columns[m.row_id]) fail(`row_id "${m.row_id}" is not a declared observation column`);
  for (const a of m.observation_axes) if (!m.observation_columns[a]) fail(`observation axis "${a}" is not a declared observation column`);
  // §4.3: unknown top-level keys MUST NOT be present; extension keys begin with x-.
  for (const k of Object.keys(m)) if (!MANIFEST_KEYS.has(k)) fail(`unknown top-level manifest key "${k}" (extensions go under "extensions" as x- keys)`);
  for (const k of Object.keys(m.extensions ?? {})) if (!k.startsWith('x-')) fail(`extension key "${k}" must begin with "x-"`);
  if (!Object.keys(m.features).length) fail('the manifest declares no features');
  if (m.primary_feature !== undefined && !m.features[m.primary_feature]) fail(`primary_feature "${m.primary_feature}" is not a declared feature`);
  for (const [name, sup] of Object.entries(m.supports ?? {})) {
    if (sup.support_type === 'volume' && !sup.grid_id) fail(`volume support "${name}" declares no grid_id`);
  }
  const referenced = (v: unknown) => (v && typeof v === 'object' && 'column' in v ? [(v as { column: string }).column] : []);
  for (const [name, f] of Object.entries(m.features)) {
    if (!f.logical?.axes?.length) fail(`feature "${name}" has no logical axes`);
    if (!f.encodings?.length) fail(`feature "${name}" has no encodings`);
    const kind = f.logical.kind;
    const ref = f.logical.support_ref;
    if ((kind === 'volume' || kind === 'surface') && !ref) fail(`${kind} feature "${name}" must declare logical.support_ref`);
    if (ref && !m.supports?.[ref]) fail(`feature "${name}" refers to support "${ref}", which is not in supports`);
    if (f.logical.shape && f.logical.shape.length !== f.logical.axes.length) fail(`feature "${name}": shape has ${f.logical.shape.length} entries for ${f.logical.axes.length} axes`);
    for (const e of f.encodings) {
      const cols = [...Object.values(e.binding ?? {}).flatMap(referenced), ...(e.type === 'columns' ? e.binding.columns ?? [] : [])];
      for (const c of cols) if (!m.observation_columns[c]) fail(`feature "${name}" encodes from column "${c}", which is not declared in observation_columns`);
      if (e.type === 'columns') {
        if (f.logical.axes.length !== 1) fail(`feature "${name}": a columns encoding needs exactly one logical axis`);
        if (!e.binding.columns?.length) fail(`feature "${name}": a columns encoding needs a non-empty column list`);
        if (f.logical.shape && f.logical.shape[0] !== e.binding.columns!.length) fail(`feature "${name}": shape [${f.logical.shape[0]}] but ${e.binding.columns!.length} bound columns`);
      } else if (e.type === 'ref') {
        const b = e.binding;
        if (b.resource_id === undefined && (b.backend === undefined || b.locator === undefined)) fail(`feature "${name}": a ref encoding needs resource_id, or backend and locator`);
      } else fail(`feature "${name}": unknown encoding type "${(e as { type: string }).type}"`);
    }
  }
  if (m.observation_table.format === 'parquet' || m.resources?.format === 'parquet') fail('parquet tables are not supported in the browser; use csv or tsv');
  return m;
}

async function readTable(read: Reader, ref: TableRef, what: string): Promise<Table> {
  let bytes: ArrayBuffer;
  try { bytes = await read(ref.path); } catch (e) { return fail(`cannot read the ${what} ${ref.path} (${(e as Error).message})`); }
  return parseDelimited(new TextDecoder().decode(bytes), ref.format === 'tsv' ? '\t' : ',');
}

export class NFTab {
  /** Typed observation rows, in table order. */
  readonly rows: Record<string, unknown>[];
  private readonly resourceById = new Map<string, { backend: string; locator: string; checksum?: string }>();
  private readonly images = new Map<string, Promise<ArrayBuffer>>();

  constructor(
    readonly manifest: Manifest,
    obs: Table,
    resources: Table | null,
    private readonly root: Reader,
    private readonly base: string,
    private readonly opts: OpenOptions,
  ) {
    const cols = manifest.observation_columns;
    for (const h of obs.header) if (!cols[h]) fail(`observation table column "${h}" is not declared in observation_columns`);
    this.rows = obs.rows.map((r, i) => {
      const row: Record<string, unknown> = {};
      obs.header.forEach((h, j) => { row[h] = convert(r[j] ?? null, cols[h].dtype, `row ${i + 1}, column ${h}`); });
      for (const [h, c] of Object.entries(cols)) if (row[h] == null && c.nullable === false) fail(`row ${i + 1}: "${h}" is required`);
      // §5.1: row_id and every observation axis are present and non-null in every row.
      for (const h of [manifest.row_id, ...manifest.observation_axes]) if (row[h] == null) fail(`row ${i + 1}: "${h}" is null, but row_id and observation axes may not be`);
      return row;
    });
    const ids = new Set<unknown>(), tuples = new Set<string>();
    for (const r of this.rows) {
      if (ids.has(r[manifest.row_id])) fail(`row_id "${String(r[manifest.row_id])}" is not unique`);
      ids.add(r[manifest.row_id]);
      const t = JSON.stringify(manifest.observation_axes.map((a) => r[a]));
      if (tuples.has(t)) fail(`two rows share the observation axes ${t}`);
      tuples.add(t);
    }
    if (resources) {
      const iId = resources.header.indexOf('resource_id'), iB = resources.header.indexOf('backend'), iL = resources.header.indexOf('locator');
      if (iId < 0 || iB < 0 || iL < 0) fail('the resource registry needs resource_id, backend and locator columns');
      const iC = resources.header.indexOf('checksum');
      for (const r of resources.rows) {
        const id = String(r[iId]);
        if (this.resourceById.has(id)) fail(`resource_id "${id}" is not unique in the resource registry`);
        this.resourceById.set(id, { backend: String(r[iB]), locator: String(r[iL]), checksum: iC >= 0 && r[iC] != null ? String(r[iC]) : undefined });
      }
    }
  }

  get features(): string[] { return Object.keys(this.manifest.features); }

  /** Read a file relative to this dataset's manifest (e.g. a label table). */
  readFile(path: string): Promise<ArrayBuffer> {
    return this.root(normalize(this.base + path));
  }

  /** The scalar design: every observation column not used only to encode a feature. */
  design(): { rows: Row[]; columns: Column[]; subject?: string } {
    const used = new Set<string>();
    for (const f of Object.values(this.manifest.features)) for (const e of f.encodings) {
      for (const v of Object.values(e.binding)) if (v && typeof v === 'object' && 'column' in v) used.add((v as { column: string }).column);
      for (const c of e.binding.columns ?? []) used.add(c);
    }
    const keep = Object.entries(this.manifest.observation_columns).filter(([n]) => !used.has(n) && n !== this.manifest.row_id);
    const columns: Column[] = keep.map(([name, c]) => {
      const numeric = ['int32', 'int64', 'float32', 'float64'].includes(c.dtype) && !FACTOR_ROLES.has(c.semantic_role ?? '');
      return { name, kind: numeric ? 'numeric' : 'factor', role: c.semantic_role, levels: c.levels, unit: c.unit };
    });
    const rows = this.rows.map((r) => {
      const out: Row = {};
      for (const c of columns) {
        const v = r[c.name];
        out[c.name] = v == null ? null : c.kind === 'numeric' ? Number(v) : String(v);
      }
      return out;
    });
    return { rows, columns, subject: columns.find((c) => c.role === 'subject')?.name };
  }

  /**
   * The value of a feature for one row: a NeuroVol for 3D volumes, a
   * {@link VolumeSeries} for volumes with a fourth axis, numbers for column
   * vectors; null when the feature is missing for that row.
   */
  async resolve(row: number, feature: string): Promise<NeuroVol | VolumeSeries | number[] | null> {
    const f = this.feature(feature);
    const r = this.rows[row] ?? fail(`there is no row ${row + 1}`);
    for (const e of f.encodings) {
      if (e.type === 'columns') {
        const vals = (e.binding.columns ?? []).map((c) => r[c]);
        if (vals.length && vals.every((v) => v != null)) {
          const out = vals.map(Number);
          if (out.some((v) => !Number.isFinite(v))) fail(`row ${row + 1}: feature "${feature}" has a non-numeric value`);
          return out;
        }
      } else if (e.type === 'ref') {
        const target = this.target(e, r);
        if (target) return this.volumeAt(target.locator, target.backend, this.value(e.binding.selector, r), f, target.checksum);
      }
    }
    if (f.nullable) return null;
    return fail(`row ${row + 1} has no value for feature "${feature}", which is not nullable`);
  }

  /** A 3D volume feature's value for one row, for display. */
  async volume(row: number, feature: string): Promise<NeuroVol> {
    const v = await this.resolve(row, feature);
    if (!v || Array.isArray(v) || isSeries(v)) return fail(`feature "${feature}" is not a 3D volume`);
    return v;
  }

  /**
   * The stored summaries of the Summary Profile (`extensions.x-summary`),
   * validated; an empty list when the dataset has none. Generic reading is
   * unaffected by the extension (the profile does not change core conformance).
   */
  async summaries(): Promise<SummaryTable[]> {
    const x = this.manifest.extensions?.['x-summary'];
    return x === undefined ? [] : readSummaries(x, (p) => this.readFile(p));
  }

  /**
   * The `x-backing` link of this dataset (or of one feature, in the
   * per-feature form), if it records one.
   */
  backingLink(feature?: string): BackingLink | null {
    const x = this.manifest.extensions?.['x-backing'] as (BackingLink & { features?: Record<string, BackingLink> }) | undefined;
    if (!x) return null;
    if (x.version !== BACKING_VERSION) fail(`x-backing version ${String(x.version)} is not supported (this reader reads ${BACKING_VERSION})`);
    if (x.features && (x.source !== undefined || x.feature !== undefined)) fail('x-backing uses either dataset-level fields or features, not both');
    const link = x.features ? (feature ? x.features[feature] : Object.values(x.features)[0]) : x;
    if (!link) return null;
    if (typeof link.source !== 'string' || typeof link.feature !== 'string') fail('x-backing needs source and feature');
    if (link.source.startsWith('/') || /[:\\]/.test(link.source)) fail(`x-backing source "${link.source}" must be a relative path`);
    return { ...link, version: x.version };
  }

  /**
   * Open the dataset a map was computed from, and read its feature as a
   * backing. `stale` is true when the source manifest no longer matches the
   * recorded source_checksum.
   */
  async followBacking(o: { feature?: string; onProgress?: (done: number, total: number) => void } = {}): Promise<{ source: NFTab; backing: MemoryBacking; link: BackingLink; stale: boolean } | null> {
    const link = this.backingLink(o.feature);
    if (!link) return null;
    const path = normalize(this.base + link.source);
    const source = await openAt(this.root, path, this.opts);
    if (!source.manifest.features[link.feature]) fail(`x-backing names feature "${link.feature}", which the source dataset does not declare`);
    let stale = false;
    if (link.source_checksum) {
      const manifestPath = isManifestName(path) ? path : path.replace(/\/?$/, '/') + 'nftab.json';
      try { await verifyChecksum(await this.root(manifestPath), link.source_checksum, 'the source manifest'); } catch { stale = true; }
    }
    const backing = await source.backing(link.feature, { map: link.map, onProgress: o.onProgress });
    return { source, backing, link, stale };
  }

  /**
   * Every row's values for a feature, as a backing to plot from. Volumes are
   * kept where any row is finite and non-zero (or inside `mask`). Rows with
   * no value for the feature (nullable) are left out.
   */
  async backing(feature: string, o: {
    mask?: ArrayLike<number>; map?: string; onProgress?: (done: number, total: number) => void;
    /**
     * The grid's space, for an x-masked-volume feature: the extension gives
     * only the grid's shape. Without it, world coordinates are voxel indices.
     */
    space?: NeuroSpace;
  } = {}): Promise<MemoryBacking> {
    const f = this.feature(feature);
    const design = this.design();
    const unit = f.logical.unit;
    const valueLabel = (f.description ?? feature) + (unit ? ` (${unit})` : '');
    const provenance = { space: f.logical.space, map: o.map };
    const values: (NeuroVol | VolumeSeries | number[] | null)[] = [];
    for (let i = 0; i < this.rows.length; i++) { values.push(await this.resolve(i, feature)); o.onProgress?.(i + 1, this.rows.length); }
    const keep = values.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (!keep.length) return fail(`feature "${feature}" has no values`);
    const rows = keep.map((i) => design.rows[i]);
    const first = values[keep[0]];
    if (Array.isArray(first)) {
      const masked = await this.maskedVolume(feature, first.length, o.space);
      if (masked) {
        return new MemoryBacking({ space: masked.space, mask: masked.mask, design: rows, data: keep.map((i) => Float32Array.from(values[i] as number[])),
          columns: design.columns, subject: design.subject, valueLabel, provenance });
      }
      const space = new NeuroSpace([first.length, 1, 1], [1, 1, 1], [0, 0, 0]);
      return new MemoryBacking({ space, design: rows, data: keep.map((i) => Float32Array.from(values[i] as number[])), columns: design.columns,
        subject: design.subject, valueLabel, provenance });
    }
    const series = keep.map((i) => asSeries(values[i] as NeuroVol | VolumeSeries));
    const { space, width } = series[0];
    const dim = (space.dim as number[]).slice(0, 3);
    const nvox = dim[0] * dim[1] * dim[2];
    let mask: number[];
    if (o.mask) mask = Array.from(o.mask);
    else {
      const any = new Uint8Array(nvox);
      for (const v of series) for (let i = 0; i < v.data.length; i++) { const x = v.data[i]; if (x !== 0 && Number.isFinite(x)) any[i % nvox] = 1; }
      mask = [];
      for (let i = 0; i < nvox; i++) if (any[i]) mask.push(i);
    }
    const data = series.map((v, r) => {
      if (v.width !== width || (v.space.dim as number[]).slice(0, 3).some((d, i) => d !== dim[i])) {
        fail(`row ${keep[r] + 1}: feature "${feature}" has a different grid from row ${keep[0] + 1}`);
      }
      const out = new Float32Array(mask.length * width);
      for (let m = 0; m < mask.length; m++) for (let a = 0; a < width; a++) out[m * width + a] = v.data[mask[m] + a * nvox];
      return out;
    });
    const axis = width > 1 || f.logical.axes.length > 3 ? await this.seriesAxis(feature, f, width) : undefined;
    return new MemoryBacking({ space, design: rows, mask, data, axis, columns: design.columns, subject: design.subject, valueLabel, provenance });
  }

  /**
   * The series axis of a volume with a fourth, non-spatial axis, from the
   * x-volume-series draft extension (positions, unit, and an optional basis).
   * Without the extension the positions are 0, 1, 2, ...
   */
  private async seriesAxis(feature: string, f: FeatureSchema, width: number): Promise<Axis> {
    const name = f.logical.axes[3] ?? 'axis';
    const xs = this.manifest.extensions?.['x-volume-series'] as { version?: string; features?: Record<string, {
      axis: string; values: number[]; unit?: string;
      basis?: { name: string; unit?: string; values: number[]; weights: number[][] | TableRef };
    }> } | undefined;
    const e = xs?.features?.[feature];
    if (!e) return { name, values: Array.from({ length: width }, (_, i) => i) };
    if (xs!.version !== VOLUME_SERIES_VERSION) fail(`x-volume-series version ${String(xs!.version)} is not supported (this reader reads ${VOLUME_SERIES_VERSION})`);
    const where = `x-volume-series "${feature}"`;
    if (e.axis !== name) fail(`${where}: axis "${e.axis}" is not the feature's fourth axis ("${name}")`);
    if (!Array.isArray(e.values) || e.values.length !== width || e.values.some((v) => !Number.isFinite(v))) fail(`${where}: values must be ${width} finite numbers`);
    if (new Set(e.values).size !== e.values.length) fail(`${where}: values must be distinct`);
    const axis: Axis = { name, values: e.values, unit: e.unit };
    if (e.basis) {
      const b = e.basis;
      let weights: number[][];
      if (Array.isArray(b.weights)) weights = b.weights;
      else {
        const t = await readTable((p) => this.readFile(p), b.weights, `${where} basis weights`);
        weights = t.rows.map((r) => r.map(Number));
      }
      if (!Array.isArray(b.values) || weights.length !== b.values.length) fail(`${where}: basis weights need one row per grid point (${b.values?.length})`);
      if (weights.some((r) => r.length !== width || r.some((v) => !Number.isFinite(v)))) fail(`${where}: each basis row needs ${width} finite weights`);
      axis.basis = { name: b.name, values: b.values, unit: b.unit, weights };
    }
    return axis;
  }

  /**
   * Appendix C: a vector over voxels mapped back onto its grid. Returns the
   * grid indices of vector positions 1..N, or null when the feature has no
   * x-masked-volume mapping.
   */
  private async maskedVolume(feature: string, n: number, space?: NeuroSpace): Promise<{ space: NeuroSpace; mask: number[] } | null> {
    type Masked = { grid_axes: string[]; grid_shape: number[]; grid_index_base?: number; index_map: TableRef };
    const x = (this.manifest.extensions?.['x-masked-volume'] as { features?: Record<string, Masked> } | undefined)?.features?.[feature];
    if (!x) return null;
    const shape = x.grid_shape;
    if (!Array.isArray(shape) || shape.length !== 3 || shape.some((d) => !Number.isInteger(d) || d < 1)) fail(`x-masked-volume "${feature}": grid_shape must be three positive integers`);
    const base = x.grid_index_base ?? 0;
    if (base !== 0 && base !== 1) fail(`x-masked-volume "${feature}": grid_index_base must be 0 or 1`);
    if (!x.index_map?.path) fail(`x-masked-volume "${feature}": index_map is required`);
    const t = await readTable((p) => this.readFile(p), x.index_map, `index map of "${feature}"`);
    const col = (name: string) => { const i = t.header.indexOf(name); return i >= 0 ? i : fail(`x-masked-volume "${feature}": the index map has no "${name}" column`); };
    const [ii, ix, iy, iz] = ['index', 'x', 'y', 'z'].map(col);
    if (t.rows.length !== n) fail(`x-masked-volume "${feature}": the index map has ${t.rows.length} rows for a vector of ${n}`);
    const [nx, ny, nz] = shape;
    const mask = new Array<number>(n).fill(-1);
    for (const r of t.rows) {
      const k = Number(r[ii]), g = [Number(r[ix]) - base, Number(r[iy]) - base, Number(r[iz]) - base];
      if (!Number.isInteger(k) || k < 1 || k > n || mask[k - 1] !== -1) fail(`x-masked-volume "${feature}": index ${r[ii]} is not one of 1..${n} exactly once`);
      if (g.some((v, d) => !Number.isInteger(v) || v < 0 || v >= shape[d])) fail(`x-masked-volume "${feature}": voxel (${r[ix]}, ${r[iy]}, ${r[iz]}) lies outside grid_shape`);
      mask[k - 1] = g[0] + g[1] * nx + g[2] * nx * ny;
    }
    if (space && (space.dim as number[]).slice(0, 3).some((d, i) => d !== shape[i])) fail(`x-masked-volume "${feature}": the supplied space does not have grid_shape [${shape.join(', ')}]`);
    return { space: space ?? new NeuroSpace([nx, ny, nz], [1, 1, 1], [0, 0, 0]), mask };
  }

  private feature(name: string): FeatureSchema {
    return this.manifest.features[name] ?? fail(`no feature "${name}" (features: ${this.features.join(', ')})`);
  }

  private value(src: ValueSource | undefined, row: Record<string, unknown>): unknown {
    if (src && typeof src === 'object' && 'column' in src && Object.keys(src).length === 1) return row[(src as { column: string }).column] ?? null;
    return src ?? null;
  }

  private target(e: Encoding, row: Record<string, unknown>): { backend: string; locator: string; checksum?: string } | null {
    const bound = this.value(e.binding.checksum, row);
    const checksum = bound == null ? undefined : String(bound);
    const id = this.value(e.binding.resource_id, row);
    if (id != null) {
      const r = this.resourceById.get(String(id)) ?? fail(`resource "${String(id)}" is not in the resource registry`);
      // §10.2: a registry checksum and a binding checksum for one resource MUST agree.
      if (checksum && r.checksum && checksum !== r.checksum) fail(`resource "${String(id)}": checksum ${checksum} in the row disagrees with ${r.checksum} in the registry`);
      return { ...r, checksum: checksum ?? r.checksum };
    }
    const backend = this.value(e.binding.backend, row), locator = this.value(e.binding.locator, row);
    return backend != null && locator != null ? { backend: String(backend), locator: String(locator), checksum } : null;
  }

  private async volumeAt(locator: string, backend: string, selector: unknown, f: FeatureSchema, checksum?: string): Promise<NeuroVol | VolumeSeries> {
    if (backend !== 'nifti') fail(`backend "${backend}" is not supported by this reader (supported: nifti)`);
    // Relative paths and http(s) only; other schemes are refused (spec §15).
    if (/^[a-z][a-z0-9+.-]*:/i.test(locator) && !/^https?:/i.test(locator)) fail(`locator "${locator}" uses a scheme this reader does not follow`);
    let buf = this.images.get(locator);
    if (!buf) {
      buf = this.root(/^https?:/i.test(locator) ? locator : normalize(this.base + locator))
        .then(async (b) => {
          if (checksum && this.opts.verifyChecksums !== false) await verifyChecksum(b, checksum, locator);
          let gz = false;
          try { gz = nifti.isCompressed(b); } catch { /* too short to be a gzip stream */ }
          return gz ? toBuffer(nifti.decompress(b)) : b;
        })
        .catch((e: Error) => fail(`cannot read ${locator} (${e.message})`));
      this.images.set(locator, buf);
    }
    const bytes = await buf;
    const value = f.logical.axes.length > 3 ? readSeries(bytes) : readNiftiArrayBuffer(bytes, (() => {
      const t = (selector as { index?: { t?: number } } | null)?.index?.t;
      return t === undefined ? {} : { index: t };
    })());
    // The spec requires every resolved value to match a declared shape.
    const shape = f.logical.shape;
    if (shape) {
      const got = [...(value.space.dim as number[]).slice(0, 3), ...(isSeries(value) && value.width > 1 ? [value.width] : [])];
      if (shape.length !== got.length || shape.some((d, i) => d !== got[i])) {
        fail(`${locator} has shape [${got.join(', ')}], but the feature declares [${shape.join(', ')}]`);
      }
    }
    return value;
  }
}

const isSeries = (v: unknown): v is VolumeSeries => !!v && typeof v === 'object' && 'width' in v && 'data' in v;
const asSeries = (v: NeuroVol | VolumeSeries): VolumeSeries =>
  isSeries(v) ? v : { space: v.space, data: Float32Array.from(v.getData() as ArrayLike<number>), width: 1 };

/** Every volume of a 4D file, on the first volume's (3D) space. */
function readSeries(bytes: ArrayBuffer): VolumeSeries {
  const first = readNiftiArrayBuffer(bytes, { index: 0 });
  const header = nifti.readHeader(bytes);
  const width = header && header.dims[0] >= 4 ? header.dims[4] : 1;
  const n = (first.space.dim as number[]).slice(0, 3).reduce((a, b) => a * b, 1);
  const data = new Float32Array(n * width);
  data.set(first.getData() as ArrayLike<number>, 0);
  for (let t = 1; t < width; t++) data.set(readNiftiArrayBuffer(bytes, { index: t }).getData() as ArrayLike<number>, t * n);
  return { space: first.space, data, width };
}

/**
 * §9.2/§15: checksums are verified when this reader knows the algorithm. The
 * spec leaves the token format to profiles; recognized here: "sha256:<hex>",
 * "sha256-<hex>" or 64 bare hex digits, over the file's bytes as stored.
 * Other tokens cannot be checked and are left alone.
 */
export async function verifyChecksum(bytes: ArrayBuffer, token: string, what: string): Promise<void> {
  const m = /^(?:sha256[:-])?([0-9a-f]{64})$/i.exec(token.trim());
  if (!m) return;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return;
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== m[1].toLowerCase()) fail(`${what} does not match its checksum (expected ${m[1].toLowerCase()}, got ${hex})`);
}

function toBuffer(x: ArrayBuffer | ArrayBufferLike | ArrayBufferView): ArrayBuffer {
  if (x instanceof ArrayBuffer) return x;
  if (ArrayBuffer.isView(x)) return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer;
  return new Uint8Array(x).slice().buffer;
}

/**
 * Open a standalone Summary Profile descriptor (summary.json or summary.yaml
 * beside its tables). It is not an NFTab dataset; only its summaries are read.
 */
export async function openSummary(source: NFTabSource, opts: { at?: string; parseYaml?: (text: string) => unknown } = {}): Promise<SummaryTable[]> {
  let read: Reader, ref: string;
  if (typeof source === 'string' && isManifestName(source)) {
    const cut = source.lastIndexOf('/') + 1;
    read = makeReader(source.slice(0, cut) || './');
    ref = normalize(source.slice(cut));
  } else {
    read = makeReader(source);
    ref = normalize(opts.at ?? '');
  }
  const base = isManifestName(ref) ? dirOf(ref) : ref && !ref.endsWith('/') ? ref + '/' : ref;
  const candidates = isManifestName(ref) ? [ref] : ['summary.json', 'summary.yaml', 'summary.yml'].map((n) => base + n);
  for (const c of candidates) {
    let text: string;
    try { text = new TextDecoder().decode(await read(normalize(c))); } catch { continue; }
    let raw: unknown;
    if (/\.ya?ml$/i.test(c)) {
      if (!opts.parseYaml) return fail(`${c} is YAML; pass parseYaml, or provide summary.json`);
      raw = opts.parseYaml(text);
    } else raw = JSON.parse(text);
    // An NFTab manifest carries the descriptor in its extensions.
    const x = raw && typeof raw === 'object' && 'spec_version' in raw ? (raw as Manifest).extensions?.['x-summary'] : raw;
    if (x === undefined) return fail(`${c} has no x-summary descriptor`);
    return readSummaries(x, (p) => read(normalize(base + p)));
  }
  return fail(`no summary descriptor found (looked for ${candidates.join(', ')})`);
}
