import { ColorMapFactory } from '../../src/display/ColorMapFactory';
import type { ColorMap } from '../../src/display/ColorMap';
import { VolLayer } from '../../src/display/VolLayer';
import { VolStack } from '../../src/display/VolStack';
import { SimpleOrthogonalViewer } from '../../src/display/SimpleOrthogonalViewer';
import type { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolumeSet, slicePixelToGrid, gridToSlicePixel, type SetOrientation } from '../../src/volumeset/VolumeSet';
import { setMean, correlationMatrix, looSimilarity, looDistance, robustZ } from '../../src/volumeset/stats';
import { clusterExtentFilter } from '../../src/volumeset/clusterExtent';
import { seriate, suggestClusters, type DendrogramNode, type ClusterSuggestion } from '../../src/volumeset/seriation';
import { SMOOTH_PRESETS, smoothingEffect, type SmoothPreset, type SmoothingEffect } from '../../src/volumeset/smooth';
import { SmoothPool } from './smooth-pool';
import { fetchManifest, loadTemplate, loadAtlas, prettyParcel, loadSet, toVolume, type VsMember, type StatName, type Template, type Atlas } from './data';
import {
  THEME,
  FONT,
  fmt,
  thresholdedDiverging,
  compose,
  underlaySlice,
  placeCrop,
  drawCellImage,
  drawCrosshair,
  drawOrientationLetters,
  drawColorbar,
  hidpi,
  simRamp,
  CellView,
  type Rect,
} from './render';

type Mode = 'montage' | 'ortho' | 'facet';
type SortKey = 'similarity' | 'loo' | 'distance' | 'cursor' | 'id';
type Smooth = 'off' | SmoothPreset;
const SMOOTH_LABEL: Record<Smooth, string> = { off: 'No smoothing', light: 'Smooth · light', medium: 'Smooth · medium', strong: 'Smooth · strong (blur)' };
const SMOOTH_NOTE: Record<SmoothPreset, string> = {
  light: 'Light: self-guided (the map is its own edge guide), same strength for all subjects; removes speckle and can hide much of a weak subject\'s extent',
  medium: 'Medium: self-guided, same strength for all subjects; stronger denoising that also erodes cluster edges',
  strong: 'Strong: template-T1-guided, close to a 3×3×3 average; blurs, and can show weak voxels with the sign of their neighbours. Not for QC',
};

interface Zoom {
  s: number;
  cx: number;
  cy: number;
}

interface State {
  mode: Mode;
  prevMode: Mode;
  model: string;
  contrast: string;
  facets: string[];
  stat: StatName;
  orient: SetOrientation;
  slice: number | null;
  cursor: [number, number, number] | null;
  sort: SortKey;
  thr: number;
  range: number;
  subject: string | null;
  smooth: Smooth;
  zoom: Zoom | null;
  /** Facet focus: show the selected subject and its neighbours, large. */
  focus: boolean;
  /** Display-only cluster-extent filter: hide suprathreshold clusters smaller than this (voxels); 0 = off. */
  minc: number;
}

const SORT_LABEL: Record<SortKey, string> = {
  similarity: 'Similarity (seriated)',
  loo: 'Similarity to mean',
  distance: 'Distance from mean',
  cursor: 'Value at cursor',
  id: 'Subject ID',
};
const STAT_LABEL: Record<string, string> = { t: 't', beta: 'β' };
const DEFAULTS: Record<string, { thr: number; range: number }> = { t: { thr: 2.3, range: 6 }, beta: { thr: 0, range: 1 } };
const AXIS: Record<SetOrientation, 0 | 1 | 2> = { sagittal: 0, coronal: 1, axial: 2 };

function parseSmooth(v: string | null): Smooth {
  if (v === 'guided') return 'medium';
  return v && v in SMOOTH_LABEL ? (v as Smooth) : 'off';
}

function pick<T extends string>(v: string | null, allowed: readonly T[], d: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : d;
}

function readState(): State {
  const q = new URLSearchParams(location.search);
  const stat = pick<StatName>(q.get('stat'), ['t', 'beta'], 't');
  const d = DEFAULTS[stat] ?? DEFAULTS.t;
  const num = (k: string, v: number): number => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : v);
  const cursor = q.get('cursor');
  const z = q.get('zoom')?.split(',').map(Number);
  const mode = pick<Mode>(q.get('mode'), ['montage', 'ortho', 'facet'], 'montage');
  return {
    mode,
    prevMode: mode === 'ortho' ? 'montage' : mode,
    model: q.get('model') ?? 'glm4',
    contrast: q.get('contrast') ?? 'cue',
    facets: (q.get('facets') ?? 'cue,delayearly,delaylate').split(','),
    stat,
    orient: pick<SetOrientation>(q.get('orient'), ['axial', 'coronal', 'sagittal'], 'axial'),
    slice: q.has('slice') ? num('slice', 0) : null,
    cursor: cursor && cursor !== 'peak' ? (cursor.split(',').map(Number) as [number, number, number]) : null,
    sort: pick<SortKey>(q.get('sort'), ['similarity', 'loo', 'distance', 'cursor', 'id'], 'similarity'),
    thr: num('thr', d.thr),
    range: num('range', d.range),
    subject: q.get('subject'),
    smooth: parseSmooth(q.get('smooth')),
    zoom: z && z.length === 3 && z.every(Number.isFinite) ? { s: z[0], cx: z[1], cy: z[2] } : null,
    focus: q.get('focus') === '1',
    minc: [0, 5, 10, 20].includes(Number(q.get('minc'))) ? Number(q.get('minc')) : 0,
  };
}

const state = readState();
const wantPeak = !state.cursor;

function writeState(): void {
  const q = new URLSearchParams();
  q.set('mode', state.mode);
  q.set('model', state.model);
  q.set('contrast', state.contrast);
  if (state.mode === 'facet') q.set('facets', state.facets.join(','));
  q.set('stat', state.stat);
  q.set('orient', state.orient);
  if (state.slice !== null) q.set('slice', String(state.slice));
  if (state.cursor) q.set('cursor', state.cursor.join(','));
  q.set('sort', state.sort);
  q.set('thr', String(state.thr));
  q.set('range', String(state.range));
  if (state.subject) q.set('subject', state.subject);
  if (state.smooth !== 'off') q.set('smooth', state.smooth);
  if (state.minc) q.set('minc', String(state.minc));
  if (state.focus && state.mode === 'facet') q.set('focus', '1');
  if (state.zoom) q.set('zoom', [state.zoom.s, state.zoom.cx, state.zoom.cy].map((v) => +v.toFixed(2)).join(','));
  history.replaceState(null, '', `?${q}`);
}

// ---------------------------------------------------------------------------
// Analysis cache: one entry per (model, contrast, stat)

interface Analysis {
  key: string;
  contrast: string;
  set: VolumeSet;
  mean: Float32Array;
  sim: Float64Array;
  loo: Float64Array;
  dist: Float64Array;
  looZ: Float64Array;
  seriation: number[];
  tree: DendrogramNode;
  /** Suggested subgroups (largest-gap rule); labels are -1 for unassigned members. */
  sug: ClusterSuggestion;
  clusters: Int32Array;
  k: number;
  /** Pooled centre/scale of all members' values, so self-guided smoothing is equally strong for everyone. */
  pooled: { mean: number; sd: number };
  /** Measured effect of each smoothing preset on this set, keyed by preset|thr. */
  effects: Map<string, SmoothingEffect>;
  /** Smoothed display maps, keyed by preset then member. */
  smoothed: Map<string, Float32Array>;
}

let manifest: VsMember[] = [];
let template: Template;
let atlas: Atlas | null = null;
const analyses = new Map<string, Promise<Analysis>>();
const ATYPICAL_Z = -2.5;

function analyse(key: string, contrast: string, set: VolumeSet): Analysis {
  const data = set.members.map((m) => m.values);
  const sim = correlationMatrix(data);
  const loo = looSimilarity(data);
  const { order, tree } = seriate(sim, set.size);
  const sug = suggestClusters(tree);
  let ps = 0;
  let pss = 0;
  let pc = 0;
  for (const d of data)
    for (let v = 0; v < d.length; v++)
      if (Number.isFinite(d[v])) {
        ps += d[v];
        pss += d[v] * d[v];
        pc++;
      }
  const pm = pc ? ps / pc : 0;
  return {
    key,
    contrast,
    set,
    mean: setMean(data),
    sim,
    loo,
    dist: looDistance(data),
    looZ: robustZ(loo),
    seriation: order,
    tree,
    sug,
    clusters: sug.labels,
    k: sug.k,
    pooled: { mean: pm, sd: pc > 1 ? Math.sqrt(Math.max(1e-12, pss / pc - pm * pm)) : 1 },
    effects: new Map(),
    smoothed: new Map(),
  };
}

function getAnalysis(model: string, contrast: string, stat: StatName): Promise<Analysis> {
  const key = `${model}|${contrast}|${stat}`;
  let p = analyses.get(key);
  if (!p) {
    const members = manifest
      .filter((m) => m.model === model && m.contrast === contrast)
      .sort((a, b) => a.subject.localeCompare(b.subject));
    if (members.length === 0) return Promise.reject(new Error(`no maps for ${model} / ${contrast}`));
    p = loadSet(members, stat, template.mask, (d, t) => setStatus(`Loading ${contrast} ${d}/${t}`)).then((set) =>
      analyse(key, contrast, set)
    );
    analyses.set(key, p);
  }
  return p;
}

let pool: SmoothPool | null = null;

/**
 * Values to *display* for a member: the smoothed map when smoothing is on and
 * ready, otherwise raw. Readouts, the rail, similarity and ordering use raw values.
 */
/** Raw or smoothed values (before the cluster-extent filter). */
function smoothedValues(a: Analysis, member: number | 'mean'): Float32Array {
  const raw = member === 'mean' ? a.mean : a.set.members[member].values;
  if (state.smooth === 'off') return raw;
  return a.smoothed.get(`${state.smooth}|${member}`) ?? raw;
}

const filtered = new Map<string, Float32Array>();
/** What is drawn: smoothed (if on) then cluster-extent filtered (if on). */
function displayValues(a: Analysis, member: number | 'mean'): Float32Array {
  const base = smoothedValues(a, member);
  if (state.minc <= 1) return base;
  const ready = state.smooth === 'off' || a.smoothed.has(`${state.smooth}|${member}`);
  const key = `${a.key}|${member}|${ready ? state.smooth : 'off'}|${state.thr}|${state.minc}`;
  let f = filtered.get(key);
  if (!f) {
    if (filtered.size > 400) filtered.clear();
    f = clusterExtentFilter(a.set.dim, a.set.maskIndex, a.set.gridToMask, base, state.thr, state.minc).values;
    filtered.set(key, f);
  }
  return f;
}

function displayValueAt(a: Analysis, member: number | 'mean', ijk: readonly number[]): number {
  return a.set.valueAt(displayValues(a, member), ijk);
}

/**
 * Smooth maps in the worker pool (cached per preset). By default every member of
 * each analysis plus its mean; `only` restricts the work (e.g. ortho shows one subject).
 */
async function ensureSmoothed(list: Analysis[], only?: (number | 'mean')[], quiet = false): Promise<void> {
  if (state.smooth === 'off') return;
  const preset = SMOOTH_PRESETS[state.smooth];
  pool ??= new SmoothPool(Float32Array.from(template.t1Data));
  const jobs: Promise<void>[] = [];
  let done = 0;
  let total = 0;
  const t0 = performance.now();
  for (const a of list) {
    const members: (number | 'mean')[] = only ?? ['mean', ...a.set.members.map((_, m) => m)];
    for (const m of members) {
      const key = `${state.smooth}|${m}`;
      if (a.smoothed.has(key)) continue;
      total++;
      const values = m === 'mean' ? a.mean : a.set.members[m].values;
      jobs.push(
        pool
          .run({
            dim: [...a.set.dim],
            maskIndex: a.set.maskIndex,
            values,
            guide: preset.guide === 'self' ? 'self' : 'anatomy',
            radius: preset.radius,
            epsilon: preset.epsilon,
            guideScale: preset.guide === 'self' ? a.pooled : undefined,
          })
          .then((out) => {
            a.smoothed.set(key, out);
            ++done;
            if (!quiet) setStatus(`Smoothing ${done}/${total}`);
          })
      );
    }
  }
  await Promise.all(jobs);
  if (total && !quiet) lastSmoothMs = performance.now() - t0;
}

/** Measured effect of the current preset on this set (members only, at the current threshold). */
function smoothEffectOf(a: Analysis): SmoothingEffect | null {
  if (state.smooth === 'off') return null;
  const key = `${state.smooth}|${state.thr}`;
  let e = a.effects.get(key);
  if (!e) {
    const sm = a.set.members.map((_, m) => a.smoothed.get(`${state.smooth}|${m}`));
    if (sm.some((x) => !x)) return null;
    e = smoothingEffect(a.set.members.map((m) => m.values), sm as Float32Array[], state.thr);
    a.effects.set(key, e);
  }
  return e;
}
let lastSmoothMs = 0;

function valueAtCursor(a: Analysis, m: number | 'mean'): number {
  if (!state.cursor) return NaN;
  return a.set.valueAt(m === 'mean' ? a.mean : a.set.members[m].values, state.cursor);
}

function orderOf(a: Analysis): number[] {
  const idx = a.set.members.map((_, i) => i);
  const subj = (i: number): string => String(a.set.members[i].meta.subject);
  switch (state.sort) {
    case 'similarity':
      return a.seriation;
    case 'loo':
      return idx.sort((x, y) => a.loo[y] - a.loo[x]);
    case 'distance':
      return idx.sort((x, y) => a.dist[y] - a.dist[x]);
    case 'cursor': {
      const v = (i: number): number => {
        const x = valueAtCursor(a, i);
        return Number.isFinite(x) ? x : -Infinity;
      };
      return idx.sort((x, y) => v(y) - v(x));
    }
    default:
      return idx.sort((x, y) => subj(x).localeCompare(subj(y)));
  }
}

// ---------------------------------------------------------------------------
// DOM + controls

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const view = $<HTMLDivElement>('#view');
const side = $<HTMLDivElement>('#side-body');
const railCanvas = $<HTMLCanvasElement>('#rail');
const statusEl = $<HTMLDivElement>('#status');
const readoutEl = $<HTMLDivElement>('#readout');

let statusTimer: number | undefined;
function setStatus(text: string, clearAfterMs = 0): void {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  if (clearAfterMs) statusTimer = window.setTimeout(() => statusEl.textContent === text && (statusEl.textContent = ''), clearAfterMs);
}

let cmap: ColorMap;
function buildColormap(): void {
  cmap = thresholdedDiverging(state.range, state.thr);
}
const digits = (): number => (state.range >= 10 ? 0 : state.range >= 2 ? 1 : 2);

function setupControls(): void {
  const models = [...new Set(manifest.map((m) => m.model))];
  const fill = (sel: HTMLSelectElement, items: string[], value: string, label = (s: string) => s): void => {
    sel.innerHTML = items.map((s) => `<option value="${s}">${label(s)}</option>`).join('');
    sel.value = value;
  };
  const fillContrasts = (): void => {
    const contrasts = [...new Set(manifest.filter((m) => m.model === state.model).map((m) => m.contrast))];
    if (!contrasts.includes(state.contrast)) state.contrast = contrasts[0];
    fill($('#contrast'), contrasts, state.contrast);
  };
  fill($('#model'), models, state.model);
  fillContrasts();
  fill($('#sort'), Object.keys(SORT_LABEL), state.sort, (s) => SORT_LABEL[s as SortKey]);
  fill($('#stat'), ['t', 'beta'], state.stat, (s) => STAT_LABEL[s]);
  fill($('#smooth'), Object.keys(SMOOTH_LABEL), state.smooth, (s) => SMOOTH_LABEL[s as Smooth]);
  fill($('#minc'), ['0', '5', '10', '20'], String(state.minc), (s) => (s === '0' ? 'All clusters' : `Clusters ≥ ${s} vox`));
  ($('#minc') as HTMLSelectElement).onchange = (e) => {
    state.minc = Number((e.target as HTMLSelectElement).value);
    void render();
  };
  for (const [id, name] of [['model', 'Model'], ['contrast', 'Contrast'], ['stat', 'Map'], ['sort', 'Order'], ['smooth', 'Smoothing']])
    $(`#${id}`).setAttribute('aria-label', name);
  $('#minc').setAttribute('aria-label', 'Minimum cluster size shown');
  ($('#focus') as HTMLButtonElement).onclick = () => toggleFocus();
  const gotoEl = $('#goto') as HTMLInputElement;
  gotoEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const xyz = gotoEl.value.replace(/[\u2212\u2013]/g, '-').split(/[\s,;()]+/).filter(Boolean).map(Number);
    const dim = template.t1.space.dim as number[];
    const ijk = xyz.length === 3 && xyz.every(Number.isFinite) ? (template.t1.space.coordToGrid(xyz).map(Math.round) as [number, number, number]) : null;
    if (!ijk || ijk.some((v, i) => v < 0 || v >= dim[i])) {
      setStatus('Enter x, y, z in mm inside the template', 1800);
      return;
    }
    state.cursor = ijk;
    state.slice = ijk[AXIS[state.orient]];
    gotoEl.blur();
    if (state.mode === 'ortho' && ortho) ortho.viewer.setWorldCoord(template.t1.space.gridToCoord(ijk));
    void render();
  });
  ($('#copy-rail') as HTMLButtonElement).onclick = () => void copyRail();
  // After a select changes, return focus to the page so ← → Esc keep working.
  ($('#zoom-reset') as HTMLButtonElement).onclick = () => {
    state.zoom = null;
    scheduleDraw();
  };
  document.querySelectorAll('header select, .display-controls select').forEach((el) => el.addEventListener('change', () => (el as HTMLSelectElement).blur()));

  const seg = (attr: string, apply: (v: string) => void): void => {
    document.querySelectorAll<HTMLButtonElement>(`[${attr}]`).forEach((b) => {
      b.onclick = () => apply(b.getAttribute(attr)!);
    });
  };
  seg('data-mode', (v) => {
    if (v === 'ortho' && state.mode !== 'ortho') state.prevMode = state.mode;
    state.mode = v as Mode;
    void render();
  });
  seg('data-orient', (v) => {
    state.orient = v as SetOrientation;
    state.slice = null;
    state.zoom = null;
    void render();
  });
  ($('#smooth') as HTMLSelectElement).onchange = (e) => {
    state.smooth = (e.target as HTMLSelectElement).value as Smooth;
    void render();
  };
  ($('#model') as HTMLSelectElement).onchange = (e) => {
    state.model = (e.target as HTMLSelectElement).value;
    fillContrasts();
    void render();
  };
  ($('#contrast') as HTMLSelectElement).onchange = (e) => {
    state.contrast = (e.target as HTMLSelectElement).value;
    void render();
  };
  ($('#stat') as HTMLSelectElement).onchange = (e) => {
    state.stat = (e.target as HTMLSelectElement).value as StatName;
    const d = DEFAULTS[state.stat];
    state.thr = d.thr;
    state.range = d.range;
    void autoRange().then(() => render());
  };
  ($('#sort') as HTMLSelectElement).onchange = (e) => {
    state.sort = (e.target as HTMLSelectElement).value as SortKey;
    void render();
  };
  for (const key of ['thr', 'range'] as const) {
    ($(`#${key}`) as HTMLInputElement).onchange = (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v) && v >= 0) state[key] = v;
      if (state.thr >= state.range) state.thr = Math.max(0, state.range * 0.5);
      void render();
    };
  }
}

/** For β, pick a symmetric range from the 99th percentile of |β| across the set. */
async function autoRange(): Promise<void> {
  if (state.stat === 't') return;
  const a = await getAnalysis(state.model, state.contrast, state.stat);
  const sample: number[] = [];
  for (const m of a.set.members) for (let v = 0; v < m.values.length; v += 37) if (Number.isFinite(m.values[v])) sample.push(Math.abs(m.values[v]));
  sample.sort((x, y) => x - y);
  const p99 = sample[Math.floor(sample.length * 0.99)] || 1;
  const mag = 10 ** Math.floor(Math.log10(p99));
  state.range = Math.ceil(p99 / mag) * mag;
  state.thr = +(state.range * 0.15).toPrecision(2);
}

function syncControls(): void {
  const press = (attr: string, value: string): void =>
    document.querySelectorAll<HTMLButtonElement>(`[${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value)));
  press('data-mode', state.mode);
  press('data-orient', state.orient);
  ($('#smooth') as HTMLSelectElement).value = state.smooth;
  ($('#minc') as HTMLSelectElement).value = String(state.minc);
  // Truncated selects: the full option text is always available as a tooltip.
  document.querySelectorAll<HTMLSelectElement>('header select, .display-controls select').forEach((sel) => (sel.title = sel.selectedOptions[0]?.textContent ?? ''));
  ($('#contrast') as HTMLSelectElement).value = state.contrast;
  ($('#stat') as HTMLSelectElement).value = state.stat;
  ($('#thr') as HTMLInputElement).value = String(state.thr);
  ($('#range') as HTMLInputElement).value = String(state.range);
  $('#thr-label').textContent = `|${STAT_LABEL[state.stat]}| ≥`;
  $('#orient-group').style.visibility = state.mode === 'ortho' ? 'hidden' : 'visible';
}

// ---------------------------------------------------------------------------
// Crop windows: brain bounding box per orientation, then linked zoom inside it

const boxCache = new Map<SetOrientation, Rect>();
function brainBox(set: VolumeSet, o: SetOrientation): Rect {
  let b = boxCache.get(o);
  if (b) return b;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const [nx, ny] = set.dim;
  for (let m = 0; m < set.maskIndex.length; m++) {
    const g = set.maskIndex[m];
    const ijk = [g % nx, Math.floor(g / nx) % ny, Math.floor(g / (nx * ny))];
    const [c, r] = gridToSlicePixel(set.dim, o, ijk);
    if (c < x0) x0 = c;
    if (c > x1) x1 = c;
    if (r < y0) y0 = r;
    if (r > y1) y1 = r;
  }
  const pad = 3;
  b = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 1 + 2 * pad, h: y1 - y0 + 1 + 2 * pad };
  boxCache.set(o, b);
  return b;
}

function cropWindow(set: VolumeSet): Rect {
  const b = brainBox(set, state.orient);
  const z = state.zoom;
  if (!z || z.s <= 1.001) return b;
  const w = b.w / z.s;
  const h = b.h / z.s;
  const cx = Math.max(b.x + w / 2, Math.min(b.x + b.w - w / 2, z.cx));
  const cy = Math.max(b.y + h / 2, Math.min(b.y + b.h - h / 2, z.cy));
  // Snap the window to whole voxels so crisp (nearest) drawing and hit-testing agree exactly.
  const sw = Math.max(2, Math.round(w));
  const sh = Math.max(2, Math.round(h));
  return { x: Math.round(cx - sw / 2), y: Math.round(cy - sh / 2), w: sw, h: sh };
}

function setZoom(set: VolumeSet, s: number, cx: number, cy: number): void {
  const b = brainBox(set, state.orient);
  s = Math.max(1, Math.min(12, s));
  if (s <= 1.001) {
    state.zoom = null;
    return;
  }
  const w = b.w / s;
  const h = b.h / s;
  state.zoom = {
    s,
    cx: Math.max(b.x + w / 2, Math.min(b.x + b.w - w / 2, cx)),
    cy: Math.max(b.y + h / 2, Math.min(b.y + b.h - h / 2, cy)),
  };
}

// ---------------------------------------------------------------------------
// Montage / facet (single canvas)

interface Hit {
  view: CellView;
  outer: Rect;
  member: number | 'mean';
  analysis: Analysis;
}

let hits: Hit[] = [];
let canvas: HTMLCanvasElement | null = null;
let hover: { a: Analysis; member: number | 'mean'; ijk: [number, number, number] } | null = null;
let railHover: string | null = null;
const imgCache = new Map<string, HTMLCanvasElement>();

function sliceIndex(): number {
  return state.slice ?? 0;
}

function toCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** Grayscale underlay for the current slice (shared by every cell). */
function underImage(a: Analysis): HTMLCanvasElement {
  const key = `under|${state.orient}|${sliceIndex()}`;
  let c = imgCache.get(key);
  if (!c) {
    const under = underlaySlice(a.set.dim, template.t1Data, state.orient, sliceIndex());
    c = toCanvas(compose(under, template.range, null, cmap));
    imgCache.set(key, c);
  }
  return c;
}

/** Colour-mapped overlay (transparent below threshold) for one member, cached as a canvas. */
function overImage(a: Analysis, member: number | 'mean'): HTMLCanvasElement {
  const ready = state.smooth === 'off' || a.smoothed.has(`${state.smooth}|${member}`);
  const key = `${a.key}|${member}|${state.orient}|${sliceIndex()}|${ready ? state.smooth : 'off'}|${state.thr}|${state.range}|${state.minc}`;
  let c = imgCache.get(key);
  if (!c) {
    if (imgCache.size > 600) imgCache.clear();
    const over = a.set.slice(displayValues(a, member), state.orient, sliceIndex());
    c = toCanvas(cmap.fillImageData(new ImageData(over.width, over.height), over.data));
    imgCache.set(key, c);
  }
  return c;
}

let lastClickAt = 0;
let cursorBeforeClicks: [number, number, number] | null = null;
let drag: { x: number; y: number; moved: boolean; shift: boolean; hit: Hit | null; zoom0: Zoom | null } | null = null;
let boxSel: Rect | null = null;

function ensureCanvas(): HTMLCanvasElement {
  if (canvas && canvas.parentElement === view) return canvas;
  view.innerHTML = '';
  canvas = document.createElement('canvas');
  canvas.className = 'montage';
  canvas.tabIndex = 0;
  overlay = document.createElement('canvas');
  overlay.className = 'montage-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('aria-label', 'Montage of subject maps. Wheel changes slice; Ctrl or Cmd plus wheel zooms all cells; drag pans; Shift-drag zooms to a box; 0 resets.');
  view.appendChild(canvas);
  view.appendChild(overlay);
  const c = canvas;
  c.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const h = hitAt(e);
      const a = (h?.hit ?? hits[0])?.analysis;
      if (!a) return;
      if (e.ctrlKey || e.metaKey) {
        const crop = cropWindow(a.set);
        const s0 = state.zoom?.s ?? 1;
        const s1 = s0 * Math.exp(-e.deltaY * 0.0025);
        // Zoom about the pointer: keep the slice pixel under the pointer fixed.
        let cx = crop.x + crop.w / 2;
        let cy = crop.y + crop.h / 2;
        if (h) {
          const [px, py] = h.slice;
          const f = s0 / s1;
          cx = px + (cx - px) * f;
          cy = py + (cy - py) * f;
        }
        setZoom(a.set, s1, cx, cy);
      } else {
        const n = a.set.sliceCount(state.orient);
        state.slice = Math.max(0, Math.min(n - 1, sliceIndex() + (e.deltaY > 0 ? -1 : 1)));
        if (state.cursor) state.cursor[AXIS[state.orient]] = state.slice;
      }
      scheduleDraw();
    },
    { passive: false }
  );
  c.addEventListener('pointerdown', (e) => {
    const h = hitAt(e);
    drag = { x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey, hit: h?.hit ?? null, zoom0: state.zoom ? { ...state.zoom } : null };
    c.setPointerCapture(e.pointerId);
  });
  c.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved && drag.hit) {
        const r = c.getBoundingClientRect();
        if (drag.shift) {
          const x0 = drag.x - r.left;
          const y0 = drag.y - r.top;
          boxSel = { x: Math.min(x0, e.clientX - r.left), y: Math.min(y0, e.clientY - r.top), w: Math.abs(dx), h: Math.abs(dy) };
          scheduleDraw(true);
        } else if (drag.zoom0) {
          const v = drag.hit.view;
          const k = v.crop.w / v.dest.w;
          setZoom(drag.hit.analysis.set, drag.zoom0.s, drag.zoom0.cx - dx * k, drag.zoom0.cy - dy * k);
          scheduleDraw();
        }
      }
      return;
    }
    const h = hitAt(e);
    const next = h ? { a: h.hit.analysis, member: h.hit.member, ijk: h.ijk } : null;
    hover = next;
    c.style.cursor = state.zoom ? 'grab' : 'crosshair';
    updateReadout();
    scheduleDraw(true);
  });
  c.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.moved && d.shift && boxSel && d.hit) {
      const v = d.hit.view;
      const [c0, r0] = v.toSlice(boxSel.x, boxSel.y);
      const [c1, r1] = v.toSlice(boxSel.x + boxSel.w, boxSel.y + boxSel.h);
      const b = brainBox(d.hit.analysis.set, state.orient);
      const s = Math.min(b.w / Math.max(4, c1 - c0), b.h / Math.max(4, r1 - r0));
      setZoom(d.hit.analysis.set, s, (c0 + c1) / 2, (r0 + r1) / 2);
      boxSel = null;
      scheduleDraw();
      return;
    }
    boxSel = null;
    if (!d.moved) {
      const r0 = c.getBoundingClientRect();
      const px = e.clientX - r0.left;
      const py = e.clientY - r0.top;
      const head = facetHeads.find((f) => px >= f.x && px < f.x + f.w && py >= f.y && py < f.y + f.h);
      if (head) {
        toggleFocus(head.subject);
        return;
      }
      const h = hitAt(e);
      if (!h) return;
      // Remember the cursor before this click so a double-click can open ortho without moving it.
      if (performance.now() - lastClickAt > 450) cursorBeforeClicks = state.cursor ? [...state.cursor] as [number, number, number] : null;
      lastClickAt = performance.now();
      state.cursor = h.ijk;
      if (h.hit.member !== 'mean') state.subject = String(h.hit.analysis.set.members[h.hit.member].meta.subject);
      if (state.sort === 'cursor') void render();
      else scheduleDraw();
    }
  });
  c.addEventListener('pointerleave', () => {
    hover = null;
    updateReadout();
    scheduleDraw(true);
  });
  c.addEventListener('dblclick', (e) => {
    const h = hitAt(e);
    if (!h || h.hit.member === 'mean') return;
    const meta = h.hit.analysis.set.members[h.hit.member].meta;
    if (cursorBeforeClicks) state.cursor = cursorBeforeClicks;
    state.subject = String(meta.subject);
    state.contrast = String(meta.contrast);
    state.prevMode = state.mode;
    state.mode = 'ortho';
    void render();
  });
  return c;
}

function hitAt(e: MouseEvent): { hit: Hit; ijk: [number, number, number]; slice: [number, number] } | null {
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  for (const h of hits) {
    if (h.view.contains(x, y)) {
      const [col, row] = h.view.toSlice(x, y);
      return { hit: h, ijk: slicePixelToGrid(h.analysis.set.dim, state.orient, sliceIndex(), col, row), slice: [col, row] };
    }
  }
  return null;
}

let drawPending = false;
let lightOnly = true;
function scheduleDraw(light = false): void {
  lightOnly = lightOnly && light;
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    const light = lightOnly;
    lightOnly = true;
    if (light && canvas && canvas.parentElement === view && state.mode !== 'ortho') {
      drawOverlay();
      if (lastRail) drawRail(lastRail.a, lastRail.order);
    } else if (state.mode === 'montage') void drawMontage();
    else if (state.mode === 'facet') void drawFacet();
    syncZoom();
    writeState();
  });
}

function prepCanvas(): { ctx: CanvasRenderingContext2D; W: number; H: number } {
  const c = ensureCanvas();
  const W = view.clientWidth;
  const H = view.clientHeight;
  const ctx = hidpi(c, W, H);
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  return { ctx, W, H };
}

function selectedMember(a: Analysis): number | undefined {
  return state.subject ? a.set.where({ subject: state.subject })[0] : undefined;
}

/** Draw one cell: optional label strip on top, image below. */
function drawCell(
  ctx: CanvasRenderingContext2D,
  a: Analysis,
  member: number | 'mean',
  outer: Rect,
  label: { left: string; right?: string; flag?: boolean } | null,
  letters: boolean
): void {
  const LH = label ? 18 : 0;
  const imgRect = { x: outer.x, y: outer.y + LH, w: outer.w, h: outer.h - LH };
  const crop = cropWindow(a.set);
  const v = placeCrop(crop, imgRect);
  ctx.fillStyle = '#000';
  ctx.fillRect(v.dest.x, v.dest.y, v.dest.w, v.dest.h);
  drawCellImage(ctx, underImage(a), overImage(a, member), v);
  if (state.cursor) {
    const [col, row] = gridToSlicePixel(a.set.dim, state.orient, state.cursor);
    drawCrosshair(ctx, v, col, row);
  }
  if (letters) drawOrientationLetters(ctx, v.dest, state.orient, 10);
  const subj = member === 'mean' ? null : String(a.set.members[member].meta.subject);
  const isSel = subj !== null && subj === state.subject;
  if (member === 'mean' || isSel) {
    ctx.strokeStyle = THEME.brand;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(v.dest.x - 1.5, v.dest.y - 1.5, v.dest.w + 3, v.dest.h + 3);
  }
  if (label) {
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 12px ${FONT.sans}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = member === 'mean' ? THEME.brand : isSel ? THEME.brand : THEME.text;
    ctx.fillText(label.left, v.dest.x, outer.y + 13);
    if (label.right) {
      ctx.font = `11px ${FONT.mono}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = label.flag ? THEME.warn : THEME.muted;
      ctx.fillText(label.right, v.dest.x + v.dest.w, outer.y + 13);
    }
  }
  hits.push({ view: v, outer, member, analysis: a });
}

/** Hover marks, rail-linked highlight and the zoom box live on a separate canvas: hover never repaints cells. */
let overlay: HTMLCanvasElement | null = null;
let lastRail: { a: Analysis; order: number[] } | null = null;

function drawOverlay(): void {
  if (!canvas || !overlay) return;
  const W = view.clientWidth;
  const H = view.clientHeight;
  const ctx = hidpi(overlay, W, H);
  ctx.clearRect(0, 0, W, H);
  for (const h of hits) {
    if (h.member === 'mean') continue;
    const subj = String(h.analysis.set.members[h.member].meta.subject);
    const isHover = subj === railHover || (hover && hover.a === h.analysis && hover.member === h.member);
    if (!isHover || subj === state.subject) continue;
    const d = h.view.dest;
    ctx.strokeStyle = THEME.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(d.x - 1.5, d.y - 1.5, d.w + 3, d.h + 3);
  }
  drawBoxSel(ctx);
}

function drawBoxSel(ctx: CanvasRenderingContext2D): void {
  if (!boxSel) return;
  ctx.save();
  ctx.strokeStyle = THEME.accent;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(boxSel.x + 0.5, boxSel.y + 0.5, boxSel.w, boxSel.h);
  ctx.restore();
}

function sliceAspect(set: VolumeSet): number {
  const c = cropWindow(set);
  return c.w / c.h;
}

function fmtR(r: number): string {
  return Number.isFinite(r) ? fmt(r, 2).replace(/^(−?)0\./, '$1.') : '–';
}

async function drawMontage(light = false): Promise<void> {
  const a = await getAnalysis(state.model, state.contrast, state.stat);
  const order = orderOf(a);
  const { ctx, W, H } = prepCanvas();
  hits = [];
  const n = order.length + 1;
  const pad = 20;
  const gapX = 10;
  const gapY = 12;
  const LH = 18;
  const asp = sliceAspect(a.set);
  // Fit using the image aspect plus the label strip.
  let best = { cols: 1, cw: 0, ch: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let cw = (W - 2 * pad - gapX * (cols - 1)) / cols;
    let ih = cw / asp;
    if ((ih + LH) * rows + gapY * (rows - 1) > H - 2 * pad) {
      ih = (H - 2 * pad - gapY * (rows - 1)) / rows - LH;
      cw = ih * asp;
    }
    if (cw > best.cw) best = { cols, cw, ch: ih + LH };
  }
  const rows = Math.ceil(n / best.cols);
  const ox = (W - (best.cols * best.cw + (best.cols - 1) * gapX)) / 2;
  const oy = (H - (rows * best.ch + (rows - 1) * gapY)) / 2;
  const cell = (p: number): Rect => ({
    x: ox + (p % best.cols) * (best.cw + gapX),
    y: oy + Math.floor(p / best.cols) * (best.ch + gapY),
    w: best.cw,
    h: best.ch,
  });
  drawCell(ctx, a, 'mean', cell(0), { left: `Mean ${STAT_LABEL[state.stat]} · n = ${a.set.size}` }, true);
  order.forEach((m, p) => {
    const meta = a.set.members[m].meta;
    drawCell(ctx, a, m, cell(p + 1), { left: String(meta.subject), right: `r ${fmtR(a.loo[m])}`, flag: a.looZ[m] < ATYPICAL_Z }, false);
  });
  drawOverlay();
  if (!light) drawSide(a, order);
  drawRail(a, order);
}

let facetHeads: { x: number; y: number; w: number; h: number; subject: string }[] = [];
let focusLo = -1;
let focusN = 0;
let focusVisible: Set<string> | null = null;

function toggleFocus(subject?: string): void {
  if (state.mode !== 'facet') return;
  if (subject) {
    state.focus = !(state.focus && state.subject === subject);
    state.subject = subject;
  } else state.focus = !state.focus;
  scheduleDraw();
}

async function drawFacet(light = false): Promise<void> {
  facetHeads = [];
  const rowsC = state.facets.includes(state.contrast) ? state.facets : [state.contrast, ...state.facets];
  const list = await Promise.all(rowsC.map((c) => getAnalysis(state.model, c, state.stat)));
  const base = list[rowsC.indexOf(state.contrast)];
  const order = orderOf(base);
  let subjects = order.map((m) => String(base.set.members[m].meta.subject));
  const { ctx, W, H } = prepCanvas();
  hits = [];
  const labelW = 96;
  const headH = 18;
  const pad = 16;
  const gap = 6;
  const bandGap = 18;
  const asp = sliceAspect(base.set);
  const R = list.length;
  focusVisible = null;
  if (state.focus) {
    // Focus: as many subjects as fit at full height, around the selected one. The window only
    // moves when the selection leaves it, so clicking a neighbour never shifts cells under the pointer.
    const chMax = (H - 2 * pad - headH - (R - 1) * gap) / R;
    const fitCols = Math.floor((W - 2 * pad - labelW + gap) / (chMax * asp + gap));
    const nShow = Math.max(1, Math.min(subjects.length, fitCols - 1));
    const sel = state.subject && subjects.includes(state.subject) ? state.subject : subjects[0];
    state.subject = sel;
    const p = subjects.indexOf(sel);
    if (focusLo < 0 || p < focusLo || p >= focusLo + nShow || focusN !== nShow) focusLo = p - Math.floor((nShow - 1) / 2);
    focusLo = Math.max(0, Math.min(focusLo, subjects.length - nShow));
    focusN = nShow;
    subjects = subjects.slice(focusLo, focusLo + nShow);
    focusVisible = new Set(subjects);
  } else {
    focusLo = -1;
  }
  // Choose the number of bands (subject wraps) that maximises cell size.
  let best = { bands: 1, cw: 0, ch: 0, per: subjects.length };
  for (let bands = 1; bands <= 4; bands++) {
    const per = Math.ceil(subjects.length / bands);
    const cols = per + 1;
    let cw = (W - 2 * pad - labelW - gap * (cols - 1)) / cols;
    let ch = cw / asp;
    const totalH = bands * (headH + R * ch + (R - 1) * gap) + (bands - 1) * bandGap;
    if (totalH > H - 2 * pad) {
      ch = (H - 2 * pad - bands * headH - bands * (R - 1) * gap - (bands - 1) * bandGap) / (bands * R);
      cw = ch * asp;
    }
    if (cw > best.cw + 0.5) best = { bands, cw, ch, per };
  }
  const { cw, ch, per, bands } = best;
  // Test hook: rendered facet cell width (read by the gate's focus probe).
  (window as unknown as { __vsFacetCellWidth: number }).__vsFacetCellWidth = Math.round(cw);
  (window as unknown as { __vsFacetHeads: unknown }).__vsFacetHeads = facetHeads;
  const bandH = headH + R * ch + (R - 1) * gap;
  const gridW = labelW + (per + 1) * cw + per * gap;
  const ox = (W - gridW) / 2 + labelW;
  const oy = (H - (bands * bandH + (bands - 1) * bandGap)) / 2;
  for (let b = 0; b < bands; b++) {
    const subs = subjects.slice(b * per, (b + 1) * per);
    const by = oy + b * (bandH + bandGap);
    ctx.font = `600 11px ${FONT.sans}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.fillStyle = THEME.brand;
    ctx.fillText('Mean', ox + cw / 2, by + 12);
    if (b === 0 && cw < 110) {
      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.muted;
      ctx.font = `10px ${FONT.mono}`;
      ctx.fillText(state.orient === 'sagittal' ? 'A ← → P' : 'L ← → R', ox - 12, by + 12);
      ctx.textAlign = 'center';
    }
    subs.forEach((s, c) => {
      facetHeads.push({ x: ox + (c + 1) * (cw + gap), y: by, w: cw, h: headH, subject: s });
      ctx.fillStyle = s === state.subject ? THEME.brand : s === railHover ? THEME.text : THEME.muted;
      ctx.font = `${s === state.subject ? '600 ' : ''}11px ${FONT.mono}`;
      ctx.fillText(s, ox + (c + 1) * (cw + gap) + cw / 2, by + 12);
    });
    list.forEach((a, r) => {
      const y = by + headH + r * (ch + gap);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = a === base ? THEME.text : THEME.muted;
      ctx.font = `${a === base ? '600 ' : ''}12px ${FONT.sans}`;
      ctx.fillText(rowsC[r], ox - 12, y + ch / 2);
      drawCell(ctx, a, 'mean', { x: ox, y, w: cw, h: ch }, null, r === 0 && b === 0 && cw >= 110);
      subs.forEach((s, c) => {
        const m = a.set.where({ subject: s })[0];
        if (m === undefined) return;
        drawCell(ctx, a, m, { x: ox + (c + 1) * (cw + gap), y, w: cw, h: ch }, null, false);
      });
    });
  }
  drawOverlay();
  if (!light) drawSide(base, order);
  drawRail(base, order, focusVisible);
}

function updateReadout(): void {
  const text = $('#readout-text');
  syncZoom();
  if (state.mode === 'ortho') {
    text.innerHTML = '';
    return;
  }
  if (!hover) {
    text.innerHTML = `<span class="muted">Click: cursor · Wheel: slice · ⌘/Ctrl+wheel: zoom · Drag: pan · Shift+drag: zoom box · 0: fit · Double-click: open subject</span>`;
    return;
  }
  const { a, member, ijk } = hover;
  const raw = a.set.valueAt(member === 'mean' ? a.mean : a.set.members[member].values, ijk);
  const w = a.set.space.gridToCoord(ijk) as number[];
  const name = member === 'mean' ? 'Mean' : `sub-${a.set.members[member].meta.subject}`;
  const st = STAT_LABEL[state.stat];
  const pre = a.set.valueAt(smoothedValues(a, member), ijk);
  const hidden = state.minc > 1 && Math.abs(pre) >= state.thr && displayValueAt(a, member, ijk) === 0;
  const hiddenNote = hidden ? ` <span class="muted">(hidden: cluster &lt; ${state.minc} vox)</span>` : '';
  const shown =
    state.smooth === 'off'
      ? `${st} = <b>${fmt(raw)}</b>${hiddenNote}`
      : `shown ${st} <b>${fmt(pre)}</b> <span class="muted">(smoothed)</span>${hiddenNote} · raw <b>${fmt(raw)}</b>`;
  const parcel = atlas ? ` · <span class="muted" title="${atlas.name}: network · region · parcel. Atlas names, not functional labels.">${atlasLabel(ijk)}</span>` : '';
  text.innerHTML = `<b>${name}</b> <span class="muted">${a.contrast}</span> · <span class="mono">${w.map((x) => fmt(x, 1)).join(', ')} mm</span> · <span class="mono">${shown}</span>${parcel}`;
}

function syncZoom(): void {
  const fb = $('#focus') as HTMLButtonElement;
  fb.hidden = state.mode !== 'facet';
  fb.setAttribute('aria-pressed', String(state.focus));
  fb.textContent = state.focus ? 'Focus · F' : 'Focus';
  const zr = $('#zoom-reset') as HTMLButtonElement;
  zr.hidden = state.mode === 'ortho';
  zr.textContent = state.zoom ? `${state.zoom.s.toFixed(1)}× · Fit (0)` : 'Fit';
  zr.disabled = !state.zoom;
}

// ---------------------------------------------------------------------------
// Ortho + subject scrub

let ortho: { viewer: SimpleOrthogonalViewer; key: string; smooth: Smooth; vols: Map<number, FloatNeuroVol> } | null = null;
/** Live context for the viewer's coordinate callback (never captured stale). */
let orthoCtx: { a: Analysis; cur: number } | null = null;

async function renderOrtho(): Promise<void> {
  const a = await getAnalysis(state.model, state.contrast, state.stat);
  const order = orderOf(a);
  let cur = selectedMember(a);
  if (cur === undefined) cur = order[0];
  // Smooth only the subject on screen; neighbours in the order are prefetched in the background.
  await ensureSmoothed([a], [cur]);
  const p0 = order.indexOf(cur);
  void ensureSmoothed([a], [order[p0 - 1], order[p0 + 1]].filter((m) => m !== undefined), true).then(async () => {
    // Then the rest of the set, so the side panel can report the smoothing's measured effect.
    await ensureSmoothed([a], a.set.members.map((_, m) => m), true);
    if (state.mode === 'ortho' && orthoCtx?.a === a) drawSide(a, orderOf(a));
  });
  state.subject = String(a.set.members[cur].meta.subject);
  orthoCtx = { a, cur };
  const key = a.key;
  const volFor = (m: number): FloatNeuroVol => {
    let v = ortho!.vols.get(m);
    if (!v) {
      v = toVolume(a.set, displayValues(a, m));
      ortho!.vols.set(m, v);
    }
    return v;
  };
  const layerOpts = { range: [-state.range, state.range] as [number, number], threshold: [-state.thr, state.thr] as [number, number], colormap: cmap };
  if (!ortho || !view.querySelector('.ortho-host')) {
    canvas = null;
    hits = [];
    view.innerHTML = '<div class="ortho-head"></div><div class="ortho-host"></div>';
    const host = view.querySelector('.ortho-host') as HTMLDivElement;
    const t1Layer = new VolLayer('template', template.t1, ColorMapFactory.createGrayscale({ range: template.range }), template.range);
    const stack = new VolStack(t1Layer);
    ortho = { viewer: null as unknown as SimpleOrthogonalViewer, key, smooth: state.smooth, vols: new Map() };
    stack.addLayer(new VolLayer('subject', volFor(cur), cmap, layerOpts.range, layerOpts.threshold, 1));
    const viewer = await SimpleOrthogonalViewer.create(host, stack, {
      layout: 'left-tall',
      showCrosshair: true,
      showOrientationLabels: true,
      backgroundColor: 0x000000,
      focusOutline: '1px solid rgba(155,134,255,0.45)',
      crosshairOptions: { crossColor: 0x22d3ee, crossAlpha: 0.75, crosshairGap: 8 },
      orientationLabelOptions: { fontFamily: FONT.sans, fontSize: 12, color: 0xc9cad8, strokeWidth: 0 },
    });
    ortho.viewer = viewer;
    viewer.onCoordChange((world) => {
      const ctx = orthoCtx;
      if (!ctx) return;
      const g = ctx.a.set.space.coordToGrid(world).map(Math.round) as [number, number, number];
      if (state.cursor && g.every((v, i) => v === state.cursor![i])) return;
      state.cursor = g;
      if (state.sort === 'cursor') void render();
      else {
        const ord = orderOf(ctx.a);
        drawRail(ctx.a, ord);
        updateOrthoHead(ctx.a, ord, ctx.cur);
        writeState();
      }
    });
    if (state.cursor) viewer.setWorldCoord(a.set.space.gridToCoord(state.cursor));
  } else {
    if (ortho.key !== key || ortho.smooth !== state.smooth) {
      ortho.key = key;
      ortho.smooth = state.smooth;
      ortho.vols.clear();
    }
    ortho.viewer.updateLayerVolume('subject', volFor(cur), layerOpts);
  }
  updateOrthoHead(a, order, cur);
  drawSide(a, order);
  drawRail(a, order);
}

function updateOrthoHead(a: Analysis, order: number[], cur: number): void {
  const head = view.querySelector('.ortho-head');
  if (!head) return;
  const pos = order.indexOf(cur) + 1;
  const v = valueAtCursor(a, cur);
  const flagged = a.looZ[cur] < ATYPICAL_Z;
  head.innerHTML = `
    <button class="back" title="Back (Esc)">← ${state.prevMode === 'facet' ? 'Facet' : 'Montage'}</button>
    <span class="subj">sub-${a.set.members[cur].meta.subject}</span>
    <span class="kv">${a.contrast}</span>
    <span class="kv">${pos} / ${order.length} · ${SORT_LABEL[state.sort].toLowerCase()}</span>
    <span class="kv">r <b>${fmtR(a.loo[cur])}</b></span>
    <span class="kv">${STAT_LABEL[state.stat]} at cursor <b>${fmt(v)}</b>${state.smooth !== 'off' && state.cursor ? ` raw · shown ${fmt(a.set.valueAt(smoothedValues(a, cur), state.cursor))}` : ''}</span>
    ${flagged ? '<span class="flag">atypical</span>' : ''}
    ${atlas && state.cursor ? `<span class="kv parcel">${atlasLabel(state.cursor)}</span>` : ''}
    <span class="hint">← → subjects · Esc back</span>`;
  (head.querySelector('.back') as HTMLButtonElement).onclick = () => goBack();
}

function goBack(): void {
  if (state.mode !== 'ortho') return;
  state.mode = state.prevMode === 'ortho' ? 'montage' : state.prevMode;
  void render();
}

function stepSubject(delta: number): void {
  void getAnalysis(state.model, state.contrast, state.stat).then((a) => {
    const order = orderOf(a);
    const cur = selectedMember(a);
    const p = cur === undefined ? 0 : Math.max(0, Math.min(order.length - 1, order.indexOf(cur) + delta));
    state.subject = String(a.set.members[order[p]].meta.subject);
    if (state.mode === 'ortho') void render();
    else scheduleDraw();
  });
}

// ---------------------------------------------------------------------------
// Side panel: legend, similarity matrix, summary

let simHover: [number, number] | null = null;

function clusterSummary(a: Analysis): string {
  const sg = a.sug;
  if (sg.k >= 2) return `${sg.k} suggested (${sg.sizes.join(' · ')})${sg.unassigned.length ? `, ${sg.unassigned.length} unassigned` : ''}`;
  const bc = sg.bestCut;
  if (!bc) return 'none suggested';
  const singles = bc.sizes.filter((x) => x === 1).length;
  const core = Math.max(...bc.sizes);
  const names = bc.singletons.map((m) => a.set.members[m].meta.subject).join(', ');
  if (bc.gap < 0.02) return `none suggested (largest gap ${bc.gap.toFixed(3)} is below the 0.02 rule)`;
  return singles && core + singles === a.set.size
    ? `none suggested — the largest gap only separates ${singles === 1 ? 'one subject' : `${singles} single subjects`} (${names}) from a core of ${core}`
    : `none suggested (best split ${bc.sizes.join('/')}, gap ${bc.gap.toFixed(3)}, below the 0.02 gap rule)`;
}

function effectBlock(a: Analysis): string {
  const e = smoothEffectOf(a);
  if (!e) return state.mode === 'ortho' ? '<p class="note">Effect figures appear once every subject is smoothed (running in the background).</p>' : '';
  const pct = (x: number): string => (x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);
  const who = (m: number): string => (m >= 0 ? `<span class="nb">sub-${a.set.members[m].meta.subject}</span>` : '–');
  const facetNote = state.mode === 'facet' ? ' (selected row)' : '';
  return `<dl class="fx" title="Medians over subjects. Peak: each subject's top-1% |raw| voxels, smoothed/raw (sign-aware). Coloured voxels: count at or above the threshold after vs before smoothing. Disagree: coloured voxels whose raw value is below threshold or of opposite sign.">
      <dt>Peak signal kept</dt><dd><b>${pct(e.peakKept)}</b> median; lowest ${who(e.peakKeptWorst)} <span class="nb">${pct(e.peakKeptMin)}</span></dd>
      <dt>Coloured voxels hidden</dt><dd><b>${pct(1 - e.extentKept)}</b> median; most ${who(e.extentKeptWorst)} <span class="nb">${pct(1 - e.extentKeptRange[0])}</span></dd>
      <dt>Shown but not suprathreshold in raw</dt><dd><b>${pct(e.disagree)}</b> of coloured voxels</dd>
    </dl>
    <p class="note">${a.set.size} ${a.contrast} maps${facetNote}, |${STAT_LABEL[state.stat]}| ≥ ${state.thr}. Hover for definitions.</p>`;
}

function drawSide(a: Analysis, order: number[]): void {
  const k = order.length;
  const flagged = order.filter((m) => a.looZ[m] < ATYPICAL_Z).map((m) => a.set.members[m].meta.subject);
  const loo = Array.from(a.loo);
  const st = STAT_LABEL[state.stat];
  const unit = state.stat === 'beta' ? ' (model units)' : '';
  const smoothNote =
    state.smooth === 'off'
      ? ''
      : `<p class="note smooth-note"><b>Smoothed display</b>: colours use smoothed values; every number on screen is raw. ${SMOOTH_NOTE[state.smooth]}.${lastSmoothMs ? ` Smoothed in ${Math.round(lastSmoothMs)} ms.` : ''}</p>${effectBlock(a)}`;
  side.innerHTML = `
    <section>
      <h3>Colour <span class="sub">${state.smooth === 'off' ? st : `${st}, smoothed`}${unit}</span></h3>
      <div class="cbwrap"><canvas id="colorbar"></canvas></div>
      <p class="note">|${st}| &lt; ${state.thr} hidden${state.minc > 1 ? `; clusters smaller than ${state.minc} voxels hidden (26-connected, same sign; display only)` : ''}; one scale for every cell. Mean cell: average of the subject ${st}-maps (not a group statistic).</p>
      ${smoothNote}
    </section>
    <section>
      <h3>Similarity <span class="sub" id="simread">${state.contrast}</span></h3>
      <canvas id="simmat"></canvas>
      <div class="cbwrap"><canvas id="simbar"></canvas></div>
      <p class="note">Spatial correlation between subjects' raw ${st}-maps (${a.set.maskIndex.length.toLocaleString()} voxels), in display order.${a.k >= 2 ? (state.sort === 'similarity' ? ' Boxes: suggested subgroups (largest gap in the average-linkage tree; a heuristic, not a test).' : ' Choose “Similarity (seriated)” order to see subgroup blocks.') : ''} Click a cell or label to select a subject.</p>
    </section>
    <section>
      <h3>Summary</h3>
      <dl>
        <dt>Subjects</dt><dd>${k}</dd>
        <dt>Median r</dt><dd>${fmtR(median(loo))} <span class="muted">(${fmtR(Math.min(...loo))} to ${fmtR(Math.max(...loo))})</span></dd>
        <dt>Atypical</dt><dd>${flagged.length ? flagged.join(', ') : 'none'}</dd>
        <dt>Subgroups</dt><dd class="wrap">${clusterSummary(a)}</dd>
      </dl>
      <p class="note">r: correlation of a subject's map with the mean of the other ${k - 1} (leave-one-out). Atypical: robust z(r) &lt; ${fmt(ATYPICAL_Z, 1)}. Subgroups: largest-gap heuristic on the average-linkage tree, not a statistical test.</p>
    </section>
    <section>
      <h3>Orientation</h3>
      <p class="note">Neurological: subject's left on screen left. Sagittal: anterior on the left. MNI152NLin2009cAsym, 2 mm.</p>
    </section>`;
  drawColorbar(side.querySelector('#colorbar') as HTMLCanvasElement, cmap, state.range, state.thr, digits());
  drawSimMatrix(a, order);
}

function drawSimMatrix(a: Analysis, order: number[]): void {
  const c = side.querySelector('#simmat') as HTMLCanvasElement;
  const bar = side.querySelector('#simbar') as HTMLCanvasElement;
  const k = order.length;
  const L = 36;
  const S = side.clientWidth;
  const M = S - L;
  const ctx = hidpi(c, S, S);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++)
      if (i !== j) {
        const r = a.sim[i * k + j];
        if (r < lo) lo = r;
        if (r > hi) hi = r;
      }
  const s = M / k;
  ctx.fillStyle = THEME.panelAlt;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      ctx.fillStyle = i === j ? THEME.panel : simRamp((a.sim[order[i] * k + order[j]] - lo) / (hi - lo || 1)).hex();
      ctx.fillRect(L + j * s, L + i * s, Math.ceil(s), Math.ceil(s));
    }
  }
  // Suggested clusters: contiguous blocks only exist in the seriated order.
  if (a.k >= 2 && state.sort === 'similarity') {
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 1.5;
    let start = 0;
    for (let i = 1; i <= k; i++) {
      if (i === k || a.clusters[order[i]] !== a.clusters[order[start]]) {
        if (a.clusters[order[start]] >= 0) ctx.strokeRect(L + start * s + 0.75, L + start * s + 0.75, (i - start) * s - 1.5, (i - start) * s - 1.5);
        start = i;
      }
    }
    ctx.lineWidth = 1;
  }
  ctx.font = `10px ${FONT.mono}`;
  ctx.textBaseline = 'middle';
  order.forEach((m, i) => {
    const subj = String(a.set.members[m].meta.subject);
    ctx.fillStyle = subj === state.subject ? THEME.brand : simHover && (simHover[0] === i || simHover[1] === i) ? THEME.text : THEME.muted;
    ctx.textAlign = 'right';
    ctx.fillText(subj, L - 4, L + (i + 0.5) * s);
    ctx.save();
    ctx.translate(L + (i + 0.5) * s, L - 4);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.fillText(subj, 0, 0);
    ctx.restore();
  });
  if (simHover) {
    const [i, j] = simHover;
    ctx.strokeStyle = THEME.text;
    ctx.strokeRect(L + j * s + 0.5, L + i * s + 0.5, s - 1, s - 1);
  }
  const cellAt = (e: MouseEvent): [number, number] | null => {
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left - L;
    const y = e.clientY - r.top - L;
    let j = Math.floor(x / s);
    let i = Math.floor(y / s);
    // Row labels (left strip) select that row; column labels (top strip) select that column.
    if (x < 0 && i >= 0 && i < k) j = i;
    else if (y < 0 && j >= 0 && j < k) i = j;
    return i < 0 || j < 0 || i >= k || j >= k ? null : [i, j];
  };
  c.style.cursor = 'pointer';
  c.onmousemove = (e) => {
    const hit = cellAt(e);
    const read = side.querySelector('#simread')!;
    simHover = hit;
    if (!hit) read.textContent = state.contrast;
    else {
      const [i, j] = hit;
      const si = a.set.members[order[i]].meta.subject;
      const sj = a.set.members[order[j]].meta.subject;
      read.textContent = i === j ? `${si}` : `${si} × ${sj}  r = ${fmtR(a.sim[order[i] * k + order[j]])}`;
    }
    drawSimMatrix(a, order);
  };
  c.onmouseleave = () => {
    simHover = null;
    side.querySelector('#simread')!.textContent = state.contrast;
    drawSimMatrix(a, order);
  };
  c.onclick = (e) => {
    const hit = cellAt(e);
    if (!hit) return;
    state.subject = String(a.set.members[order[hit[0]]].meta.subject);
    if (state.mode === 'ortho') void render();
    else scheduleDraw();
  };
  const W = bar.parentElement!.clientWidth;
  const bctx = hidpi(bar, W, 28);
  for (let x = 0; x < W; x++) {
    bctx.fillStyle = simRamp(x / (W - 1)).hex();
    bctx.fillRect(x, 0, 1, 8);
  }
  bctx.font = `11px ${FONT.mono}`;
  bctx.fillStyle = THEME.muted;
  bctx.textBaseline = 'top';
  bctx.textAlign = 'left';
  bctx.fillText(`r ${fmtR(lo)}`, 0, 12);
  bctx.textAlign = 'right';
  bctx.fillText(fmtR(hi), W, 12);
}

function median(v: number[]): number {
  const s = v.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

// ---------------------------------------------------------------------------
// Subject rail: value at cursor per subject, in display order, own scale

function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= x) return m * mag;
  return 10 * mag;
}

let railGeom: { left: number; step: number; order: number[]; a: Analysis } | null = null;

function atlasLabel(ijk: readonly number[]): string {
  if (!atlas) return '';
  const [nx, ny] = template.t1.space.dim as number[];
  const id = Math.round(atlas.labels[ijk[0] + ijk[1] * nx + ijk[2] * nx * ny] ?? 0);
  return id > 0 ? prettyParcel(atlas.names.get(id) ?? `parcel ${id}`) : 'outside Schaefer cortex';
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function drawRail(a: Analysis, order: number[], visible: Set<string> | null = null): void {
  lastRail = { a, order };
  const W = railCanvas.parentElement!.clientWidth;
  const H = railCanvas.parentElement!.clientHeight;
  const ctx = hidpi(railCanvas, W, H);
  ctx.fillStyle = THEME.panelAlt;
  ctx.fillRect(0, 0, W, H);
  const left = 196;
  const right = 24;
  const top = 22;
  const bottom = 26;
  const ph = H - top - bottom;
  const vals = order.map((m) => valueAtCursor(a, m));
  const meanV = valueAtCursor(a, 'mean');
  // Domain always includes 0 and ±threshold; extends only toward the side the data occupy.
  const finite = [...vals, meanV].filter(Number.isFinite);
  // 12% headroom above the largest value keeps its label clear of its dot; the negative side always shows a tick.
  const hiV = niceCeil(Math.max(state.thr * 1.5, ...finite.map((v) => Math.max(0, v) * 1.12)));
  const loV = -niceCeil(Math.max(state.thr * 2, ...finite.map((v) => Math.max(0, -v) * 1.12)));
  const y = (v: number): number => top + ((hiV - v) / (hiV - loV)) * ph;
  const st = STAT_LABEL[state.stat];
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = THEME.text;
  ctx.font = `600 12px ${FONT.sans}`;
  ctx.fillText(`${st} at cursor${state.smooth !== 'off' ? ' (raw)' : ''}`, 16, top + 8);
  ctx.font = `11px ${FONT.mono}`;
  ctx.fillStyle = THEME.muted;
  if (state.cursor) {
    const w = a.set.space.gridToCoord(state.cursor) as number[];
    ctx.fillText(`${w.map((v) => fmt(v, 1)).join(', ')} mm`, 16, top + 26);
    ctx.fillText(`voxel ${state.cursor.join(', ')}`, 16, top + 42);
    ctx.fillStyle = THEME.brand;
    ctx.fillText(`mean ${fmt(meanV)}`, 16, top + 58);
    const parcel = atlasLabel(state.cursor);
    ctx.font = `11px ${FONT.sans}`;
    ctx.fillStyle = THEME.text;
    ctx.fillText(truncate(ctx, parcel, left - 28), 16, top + 76);
  } else {
    ctx.fillText('click a brain to set the cursor', 16, top + 26);
  }
  // Axis ticks
  ctx.strokeStyle = THEME.line;
  ctx.fillStyle = THEME.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const span = hiV - loV;
  for (const t of [loV, loV / 2, 0, hiV / 2, hiV]) {
    if (t !== 0 && t !== loV && t !== hiV && Math.abs(y(t) - y(0)) < 14) continue;
    if (t === loV && Math.abs(y(t) - y(0)) < 8) continue;
    const crowded = t === loV && Math.abs(y(t) - y(0)) < 13;
    ctx.globalAlpha = t === 0 ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(y(t)) + 0.5);
    ctx.lineTo(W - right, Math.round(y(t)) + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (!crowded) ctx.fillText(fmt(t, span >= 20 ? 0 : 1), left - 8, y(t));
  }
  // Threshold band
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fillRect(left, y(state.thr), W - left - right, y(-state.thr) - y(state.thr));
  const step = (W - left - right) / order.length;
  railGeom = { left, step, order, a };
  // Suggested clusters: alternate faint bands behind contiguous runs (seriated order only).
  if (a.k >= 2 && state.sort === 'similarity') {
    let start = 0;
    let band = 0;
    for (let p = 1; p <= order.length; p++) {
      if (p === order.length || a.clusters[order[p]] !== a.clusters[order[start]]) {
        if (band % 2 === 0) {
          ctx.fillStyle = 'rgba(34,211,238,0.045)';
          ctx.fillRect(left + start * step, top - 10, (p - start) * step, ph + 20);
        }
        if (p < order.length) {
          ctx.strokeStyle = 'rgba(34,211,238,0.35)';
          ctx.beginPath();
          ctx.moveTo(Math.round(left + p * step) + 0.5, top - 10);
          ctx.lineTo(Math.round(left + p * step) + 0.5, H - 4);
          ctx.stroke();
        }
        band++;
        start = p;
      }
    }
  }
  if (!state.cursor) return;
  if (Number.isFinite(meanV)) {
    ctx.strokeStyle = THEME.brand;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(left, y(meanV));
    ctx.lineTo(W - right, y(meanV));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  order.forEach((m, p) => {
    const v = vals[p];
    const subj = String(a.set.members[m].meta.subject);
    const x = left + step * (p + 0.5);
    const isSel = subj === state.subject;
    const isHov = subj === railHover || (hover && hover.a === a && hover.member === m);
    if (isSel || isHov) {
      ctx.fillStyle = isSel ? 'rgba(155,134,255,0.12)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x - step / 2, top - 8, step, ph + 16);
    }
    if (Number.isFinite(v)) {
      const supra = Math.abs(v) >= state.thr;
      const c = cmap.getColor(Math.max(-state.range, Math.min(state.range, v)));
      const col = supra ? `rgb(${c[0] * 255},${c[1] * 255},${c[2] * 255})` : THEME.faint;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x, y(0));
      ctx.lineTo(x, y(v));
      ctx.stroke();
      ctx.font = `${isSel || isHov ? '600 ' : ''}10px ${FONT.mono}`;
      ctx.fillStyle = isSel || isHov ? THEME.text : THEME.muted;
      ctx.textAlign = 'center';
      const label = fmt(v, Math.abs(v) >= 10 ? 1 : 2);
      const tw = ctx.measureText(label).width;
      let lx = x;
      let ly: number;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (v >= 0) {
        ly = Math.max(top + 2, y(v) - 12);
      } else {
        ly = y(v) + 12;
        // No room below the dot (above the subject IDs): put the label beside the dot instead.
        if (ly > H - bottom - 8) {
          ly = y(v);
          lx = x + 7 + tw / 2;
        }
      }
      // Opaque box so grid lines and the dashed mean line never strike through a value.
      ctx.fillStyle = isSel ? 'rgba(30,27,52,0.95)' : 'rgba(16,17,25,0.92)';
      ctx.fillRect(lx - tw / 2 - 2, ly - 6.5, tw + 4, 13);
      ctx.fillStyle = isSel || isHov ? THEME.text : THEME.muted;
      ctx.fillText(label, lx, ly + 0.5);
      // Dot last, so no label box can hide a value's marker.
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y(v), isSel ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (visible?.has(subj)) {
      // Facet Focus: mark the subjects currently on screen.
      ctx.fillStyle = THEME.accent;
      ctx.fillRect(x - step / 2 + 3, H - 4, step - 6, 2);
    }
    ctx.fillStyle = isSel ? THEME.brand : a.looZ[m] < ATYPICAL_Z ? THEME.warn : isHov ? THEME.text : THEME.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${isSel ? '600 ' : ''}11px ${FONT.mono}`;
    ctx.fillText(subj, x, H - 9);
  });
  ctx.lineWidth = 1;
}

async function copyRail(): Promise<void> {
  if (!railGeom || !state.cursor) return;
  const { a, order } = railGeom;
  const w = a.set.space.gridToCoord(state.cursor) as number[];
  // Plain TSV (no comment lines) so read.delim / pandas read it with defaults; context goes in columns.
  const ctxCols = [state.model, a.contrast, state.stat, ...w.map((v) => v.toFixed(1))].join('\t');
  const lines = ['subject\tvalue\tr_loo\tmodel\tcontrast\tstat\tx_mm\ty_mm\tz_mm'];
  for (const m of order) lines.push(`${a.set.members[m].meta.subject}\t${valueAtCursor(a, m).toFixed(4)}\t${a.loo[m].toFixed(4)}\t${ctxCols}`);
  lines.push(`mean\t${valueAtCursor(a, 'mean').toFixed(4)}\tNA\t${ctxCols}`);
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    setStatus('Copied values', 1500);
  } catch {
    setStatus('Copy failed (clipboard blocked)', 2500);
  }
  ($('#copy-rail') as HTMLButtonElement).blur();
}

function railSubjectAt(e: MouseEvent): string | null {
  if (!railGeom) return null;
  const r = railCanvas.getBoundingClientRect();
  const p = Math.floor((e.clientX - r.left - railGeom.left) / railGeom.step);
  if (p < 0 || p >= railGeom.order.length) return null;
  return String(railGeom.a.set.members[railGeom.order[p]].meta.subject);
}

railCanvas.addEventListener('mousemove', (e) => {
  const s = railSubjectAt(e);
  if (s === railHover) return;
  railHover = s;
  railCanvas.style.cursor = s ? 'pointer' : 'default';
  if (state.mode === 'ortho') {
    if (orthoCtx) drawRail(orthoCtx.a, orderOf(orthoCtx.a));
  } else scheduleDraw(true);
});
railCanvas.addEventListener('mouseleave', () => {
  railHover = null;
  if (state.mode === 'ortho') {
    if (orthoCtx) drawRail(orthoCtx.a, orderOf(orthoCtx.a));
  } else scheduleDraw(true);
});
railCanvas.addEventListener('click', (e) => {
  const s = railSubjectAt(e);
  if (!s) return;
  state.subject = s;
  if (state.mode === 'ortho') void render();
  else scheduleDraw();
});

// ---------------------------------------------------------------------------

let rendering = Promise.resolve();
function render(): Promise<void> {
  rendering = rendering
    .then(async () => {
      buildColormap();
      imgCache.clear();
      hover = null;
      railHover = null;
      syncControls();
      if (state.mode !== 'ortho' && ortho) {
        ortho.viewer.dispose();
        ortho = null;
        orthoCtx = null;
      }
      if (state.mode === 'ortho') {
        await renderOrtho();
      } else {
        const contrasts = state.mode === 'facet' ? [...new Set([state.contrast, ...state.facets])] : [state.contrast];
        const list = await Promise.all(contrasts.map((c) => getAnalysis(state.model, c, state.stat)));
        await ensureSmoothed(list);
        if (state.slice === null) state.slice = state.cursor ? state.cursor[AXIS[state.orient]] : Math.floor(list[0].set.sliceCount(state.orient) / 2);
        if (state.mode === 'montage') await drawMontage();
        else await drawFacet();
      }
      updateReadout();
      writeState();
      setStatus('');
    })
    .catch((err) => {
      console.error(err);
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });
  return rendering;
}

async function main(): Promise<void> {
  setStatus('Loading template…');
  [manifest, template, atlas] = await Promise.all([fetchManifest(), loadTemplate(), loadAtlas()]);
  setupControls();
  if (state.stat !== 't' && !new URLSearchParams(location.search).has('range')) await autoRange();
  if (wantPeak) {
    const a = await getAnalysis(state.model, state.contrast, state.stat);
    let best = -Infinity;
    let bi = 0;
    for (let m = 0; m < a.mean.length; m++)
      if (a.mean[m] > best) {
        best = a.mean[m];
        bi = m;
      }
    const g = a.set.maskIndex[bi];
    const [nx, ny] = a.set.dim;
    state.cursor = [g % nx, Math.floor(g / nx) % ny, Math.floor(g / (nx * ny))];
  }
  // Canvas text needs the web fonts loaded before the first draw.
  await Promise.all([
    document.fonts?.load(`600 12px ${FONT.sans}`),
    document.fonts?.load(`11px ${FONT.mono}`),
  ]).catch(() => undefined);
  await render();
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (e.key === 'ArrowRight') stepSubject(1);
    else if (e.key === 'ArrowLeft') stepSubject(-1);
    else if (e.key === 'Escape') {
      if (state.mode === 'facet' && state.focus) toggleFocus();
      else goBack();
    } else if (e.key === 'f' || e.key === 'F') toggleFocus();
    else if ((e.key === 'PageDown' || e.key === 'PageUp') && state.mode === 'facet' && state.focus) {
      e.preventDefault();
      // Page the whole window: shift its start by its width and keep the selection's offset within it.
      const dir = e.key === 'PageDown' ? 1 : -1;
      focusLo = Math.max(0, focusLo + dir * Math.max(1, focusN));
      stepSubject(dir * Math.max(1, focusN));
    }
    else if (e.key === '0' && state.mode !== 'ortho') {
      state.zoom = null;
      void render();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && state.mode !== 'ortho') {
      e.preventDefault();
      void getAnalysis(state.model, state.contrast, state.stat).then((a) => {
        const max = a.set.sliceCount(state.orient) - 1;
        state.slice = Math.max(0, Math.min(max, sliceIndex() + (e.key === 'ArrowUp' ? 1 : -1)));
        if (state.cursor) state.cursor[AXIS[state.orient]] = state.slice;
        scheduleDraw();
      });
    }
  });
  let t: number | undefined;
  new ResizeObserver(() => {
    const drawn = canvas && canvas.parentElement === view ? `${canvas.style.width}x${canvas.style.height}` : '';
    if (drawn === `${view.clientWidth}px x${view.clientHeight}px`.replace(' ', '')) return;
    clearTimeout(t);
    t = window.setTimeout(() => void render(), 80);
  }).observe(view);
  await document.fonts?.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  (window as unknown as { __vsReady: boolean }).__vsReady = true;
}

main().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
});
