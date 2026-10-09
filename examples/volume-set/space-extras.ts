/**
 * Space v2 layers: colour channels, fit halos, density contours, stability clouds,
 * region-conditioned layouts, aligned transitions, the fisheye lens, lasso subsets,
 * pair agreement maps and contrast trajectories. Contracts:
 * docs/plans/volume-set-space-v2.md.
 *
 * Everything here is display or explicit analysis on request. At default options every
 * function is a no-op: no URL keys, no extra drawing, no change to the rail.
 */
import chroma from 'chroma-js';
import { ColorMap } from '../../src/display/ColorMap';
import { gridToSlicePixel } from '../../src/volumeset/VolumeSet';
import { similarityBasis, type SimilarityBasis } from '../../src/volumeset/basis';
import { pairContributions, type PairContributions } from '../../src/volumeset/contrib';
import { alignById } from '../../src/volumeset/procrustes';
import { kde2d, densityLevels, isoContours, gridToLayout } from '../../src/volumeset/contours';
import { fisheye } from '../../src/volumeset/lens';
import { stressShares } from '../../src/volumeset/fitShares';
import type { Ellipse } from '../../src/volumeset/stability';
import type { NmdsOptions } from '../../src/volumeset/nmds';
import { THEME, FONT, fmt, hidpi, placeCrop, drawCellImage, drawCrosshair, thresholdedDiverging } from './render';
import { fetchCovariates, type Covariates } from './data';
import type { EmbedOutput } from './embed-runner';
import { spaceTransform, type SpaceTransform, type PlotRect } from './space';
import * as M from './main';
import * as SV from './space-view';

// ---------------------------------------------------------------------------
// Options (URL-backed; defaults write nothing)

interface Region {
  /** Grid voxel at the sphere centre (the cursor when the region was applied). */
  ijk: [number, number, number];
  radiusMm: number;
}

export const opts = {
  /** '' | 'cursor' | 'cov:<field>' */
  colour: '',
  halos: false,
  stability: false,
  /** Density contours: 'auto' (on for dense layouts), 'on' or 'off'. */
  density: 'auto' as 'auto' | 'on' | 'off',
  region: null as Region | null,
  trajectories: false,
  subset: new Set<string>(),
  /** Partner of the focused map in the agreement view. */
  compare: null as string | null,
  /** Transient (not in the URL). */
  lens: false,
};

const REGION_RADII = [10, 15, 25];

export function readParams(q: URLSearchParams): void {
  const c = q.get('sc');
  opts.colour = c === 'cursor' || (c !== null && /^cov:[\w.-]{1,40}$/.test(c)) ? c : '';
  opts.halos = q.get('sh') === '1';
  opts.stability = q.get('sb') === '1';
  const d = q.get('sd');
  opts.density = d === 'on' || d === 'off' ? d : 'auto';
  const r = q.get('sr')?.split(',').map(Number);
  opts.region = r && r.length === 4 && r.every(Number.isFinite) && r.slice(0, 3).every((v) => Number.isInteger(v) && v >= 0) && REGION_RADII.includes(r[3])
    ? { ijk: [r[0], r[1], r[2]], radiusMm: r[3] }
    : null;
  opts.trajectories = q.get('st') === '1';
  opts.subset = new Set((q.get('ss') ?? '').split(',').filter((x) => /^[\w.-]{1,40}$/.test(x)));
  const cp = q.get('cp');
  opts.compare = cp && /^[\w.-]{1,40}$/.test(cp) ? cp : null;
}

export function writeParams(q: URLSearchParams): void {
  if (opts.colour) q.set('sc', opts.colour);
  if (opts.halos) q.set('sh', '1');
  if (opts.stability) q.set('sb', '1');
  if (opts.density !== 'auto') q.set('sd', opts.density);
  if (opts.region) q.set('sr', [...opts.region.ijk, opts.region.radiusMm].join(','));
  if (opts.trajectories) q.set('st', '1');
  if (opts.subset.size) q.set('ss', [...opts.subset].sort().join(','));
  if (opts.compare) q.set('cp', opts.compare);
}

const SUBSET = '#7ee0a6';
const CONTRAST_COLOURS = ['#f4a261', '#8ab4f8', '#d39cf5', '#e9c46a', '#ff8fab'];
const CATEGORY_COLOURS = ['#f4a261', '#8ab4f8', '#d39cf5', '#7ee0a6', '#ff8fab', '#e9c46a'];
const SEQUENTIAL = chroma.scale(['#3b2f7a', '#3b6fb6', '#2ba59a', '#9ccc5a', '#f3e05b']).mode('lch');
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------
// Toolbar (lives in the view; hidden outside Space)

let toolbar: HTMLDivElement | null = null;
let covariates: Covariates | null = null;
let covariatesRequested = false;

function ensureStyle(): void {
  if (document.getElementById('space-extras-style')) return;
  const st = document.createElement('style');
  st.id = 'space-extras-style';
  st.textContent = `
    .space-tools[hidden] { display: none; }
    .space-tools { position: absolute; top: 10px; right: 12px; z-index: 3; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: calc(100% - 260px); pointer-events: auto; }
    .space-tools .chip { background: rgba(21,22,31,0.92); color: var(--muted); border: 1px solid var(--line); border-radius: 14px; padding: 3px 10px; font: 11.5px var(--sans); cursor: pointer; white-space: nowrap; }
    .space-tools .chip:hover { color: var(--text); }
    .space-tools .chip[aria-pressed='true'] { color: var(--text); border-color: var(--brand); background: rgba(155,134,255,0.18); }
    .space-tools .chip.subset[aria-pressed='true'] { border-color: ${SUBSET}; background: rgba(126,224,166,0.14); }
    .space-tools select.chip { padding: 2px 8px; appearance: auto; width: 190px; }
    .space-tools .chip:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
    #side .agree-stats { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 11.5px; margin: 4px 0; }
    #side .agree-stats dt { color: var(--muted); }
    #side .agree-stats dd { margin: 0; font-family: var(--mono); }
    #side .nb-table button.cmp { font-size: 10.5px; color: var(--muted); text-decoration: none; border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }
    #side .nb-table button.cmp[aria-pressed='true'] { color: var(--text); border-color: var(--brand); }
  `;
  document.head.appendChild(st);
}

function chip(id: string, label: string, pressed: boolean, title: string, extra = ''): string {
  return `<button class="chip ${extra}" id="${id}" aria-pressed="${pressed}" title="${title}">${label}</button>`;
}

/** Create or update the Space toolbar; hidden in other modes. Called on every Space draw and overlay pass. */
export function syncToolbar(): void {
  const view = document.querySelector('#view') as HTMLDivElement | null;
  if (!view) return;
  if (M.state.mode !== 'space') {
    if (toolbar) toolbar.hidden = true;
    return;
  }
  ensureStyle();
  if (!covariatesRequested) {
    covariatesRequested = true;
    void fetchCovariates().then((c) => {
      covariates = c;
      if (M.state.mode === 'space') syncToolbar();
    });
  }
  if (!toolbar || toolbar.parentElement !== view) {
    toolbar = document.createElement('div');
    toolbar.className = 'space-tools';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Space layers');
    view.appendChild(toolbar);
  }
  toolbar.hidden = false;
  // Rebuild only when the set of controls changes; otherwise update in place, so a click is never
  // lost to a rebuild between pointer-down and pointer-up.
  const covOpts = (covariates?.fields ?? []).map((f) => `<option value="cov:${f.name}">${f.name}${f.kind === 'numeric' ? '' : ' (category)'}</option>`).join('');
  // Covariate options are filled in place (fixed-width select), so their arrival never shifts the chips.
  const structure = `${opts.subset.size > 0}`;
  if (toolbar.dataset.structure !== structure) {
    toolbar.innerHTML = `
    <select class="chip" id="sx-colour" title="Colour each map's frame by a value; positions do not change" aria-label="Colour maps by">
    </select>
    ${chip('sx-halos', 'Fit halos', false, "Halo size = each map's share of the layout misfit (H)")}
    ${chip('sx-stab', 'Stability', false, 'Where each map would sit if brain regions were resampled (block bootstrap)')}
    ${chip('sx-dens', 'Density', false, 'Contours of where maps concentrate in the layout')}
    ${chip('sx-lens', 'Lens · L', false, 'Magnify the layout under the pointer (display only)')}
    ${chip('sx-region', 'Region: whole brain', false, 'Lay out by similarity within a sphere around the cursor (applied at the current cursor; click to cycle 10 / 15 / 25 mm / whole brain)')}
    ${chip('sx-traj', 'Contrasts: this', false, "One shared layout of every subject × contrast map, with each subject's contrasts joined")}
    ${opts.subset.size ? chip('sx-subset', '', true, 'Clear the selected group (Esc). Shift-drag to add, Shift+Alt-drag to remove', 'subset') : ''}`;
    toolbar.dataset.structure = structure;
    wireToolbar();
  }
  const set = (id: string, pressed: boolean, label?: string): void => {
    const el = toolbar!.querySelector(`#${id}`) as HTMLElement | null;
    if (!el) return;
    el.setAttribute('aria-pressed', String(pressed));
    if (label !== undefined && el.textContent !== label) el.textContent = label;
  };
  set('sx-halos', opts.halos);
  set('sx-stab', opts.stability);
  set('sx-dens', densityOn());
  set('sx-lens', opts.lens);
  set('sx-region', opts.region !== null, opts.region ? `Region: ${opts.region.radiusMm} mm` : 'Region: whole brain');
  set('sx-traj', opts.trajectories, opts.trajectories ? 'Contrasts: all' : 'Contrasts: this');
  set('sx-subset', true, `Group of ${opts.subset.size} ✕`);
  const sel = toolbar.querySelector('#sx-colour') as HTMLSelectElement;
  const optionsHtml = `<option value="">Colour: none</option><option value="cursor">Colour: value at cursor</option>${covOpts}`;
  if (sel && sel.dataset.options !== optionsHtml) {
    sel.innerHTML = optionsHtml;
    sel.dataset.options = optionsHtml;
  }
  if (sel && sel.value !== opts.colour) sel.value = opts.colour;
}

function wireToolbar(): void {
  if (!toolbar) return;
  const on = (id: string, fn: () => void): void => {
    const el = toolbar!.querySelector(`#${id}`) as HTMLElement | null;
    if (el) el.onclick = fn;
  };
  (toolbar.querySelector('#sx-colour') as HTMLSelectElement).onchange = (e) => {
    opts.colour = (e.target as HTMLSelectElement).value;
    (e.target as HTMLSelectElement).blur();
    redraw(true);
  };
  on('sx-halos', () => toggle('halos'));
  on('sx-stab', () => toggle('stability'));
  on('sx-dens', () => {
    opts.density = densityOn() ? 'off' : 'on';
    redraw(true);
  });
  on('sx-lens', () => {
    opts.lens = !opts.lens;
    if (!opts.lens) lensAt = null;
    redraw(true);
  });
  on('sx-region', () => cycleRegion());
  on('sx-traj', () => {
    opts.trajectories = !opts.trajectories;
    redraw(false);
  });
  on('sx-subset', () => {
    opts.subset.clear();
    redraw(false);
  });
}

function toggle(k: 'halos' | 'stability'): void {
  opts[k] = !opts[k];
  redraw(true);
}

function redraw(keepSide: boolean): void {
  syncToolbar();
  M.scheduleDraw(false, keepSide);
}

function cycleRegion(): void {
  const cur = opts.region?.radiusMm;
  const i = cur === undefined ? -1 : REGION_RADII.indexOf(cur);
  const next = i + 1 < REGION_RADII.length ? REGION_RADII[i + 1] : null;
  // Applied explicitly at the current cursor; moving the cursor later never refits.
  opts.region = next !== null && M.state.cursor ? { ijk: [...M.state.cursor] as [number, number, number], radiusMm: next } : null;
  redraw(false);
}

function densityOn(): boolean {
  return opts.density === 'on' || (opts.density === 'auto' && SV.spaceGeom?.lod === 'marks');
}

// ---------------------------------------------------------------------------
// Region-conditioned basis (V2-05)

const regionCache = new Map<string, SimilarityBasis>();

/** Mask positions within radiusMm (true mm, anisotropic voxels) of a grid point. */
function spherePositions(a: M.Analysis, ijk: readonly number[], radiusMm: number): Int32Array {
  const [nx, ny] = a.set.dim;
  const sp = a.set.space.spacing as number[];
  const r2 = radiusMm * radiusMm;
  const out: number[] = [];
  for (let m = 0; m < a.set.maskIndex.length; m++) {
    const g = a.set.maskIndex[m];
    const di = ((g % nx) - ijk[0]) * sp[0];
    const dj = ((Math.floor(g / nx) % ny) - ijk[1]) * sp[1];
    const dk = (Math.floor(g / (nx * ny)) - ijk[2]) * sp[2];
    if (di * di + dj * dj + dk * dk <= r2) out.push(m);
  }
  return Int32Array.from(out);
}

export function regionBasis(a: M.Analysis): SimilarityBasis | null {
  const r = opts.region;
  if (!r) return null;
  const key = `${a.key}|${r.ijk.join(',')}|${r.radiusMm}`;
  let b = regionCache.get(key);
  if (!b) {
    const w = a.set.space.gridToCoord(r.ijk) as number[];
    const [model, , stat] = a.key.split('|');
    b = similarityBasis(
      a.set.members.map((m) => m.values),
      a.ids,
      {
        voxels: spherePositions(a, r.ijk, r.radiusMm),
        region: `sphere ${r.radiusMm} mm at (${w.map((v) => fmt(v, 1)).join(', ')}) mm`,
        labels: { model, contrast: a.contrast, stat },
        maskRule: 'template brain mask ∩ voxels where at least one map is finite and non-zero',
        minSupport: 30,
      }
    );
    if (regionCache.size > 12) regionCache.clear();
    regionCache.set(key, b);
  }
  return b;
}

/** Basis to retry when the visible layout failed (the pooled basis in trajectory mode). */
export function retryBasis(): SimilarityBasis | null {
  return opts.trajectories ? (pooled?.basis ?? null) : null;
}

// ---------------------------------------------------------------------------
// Aligned transitions (V2-06)

interface Displayed {
  key: string;
  ids: string[];
  coords: Float64Array;
  /** Presentation transform from the fit's canonical coordinates to the displayed ones. */
  rot: [number, number, number, number];
  scale: number;
  trans: [number, number];
}

const displayed = new Map<string, Displayed>();
let lastShown: Displayed | null = null;
let anim: { from: Map<string, [number, number]>; start: number; key: string } | null = null;
let lastScreen = new Map<string, [number, number]>();
const ANIM_MS = 520;

/**
 * Coordinates to display for a fitted layout: the canonical pose for the first layout
 * shown, otherwise the fit Procrustes-aligned (rotation/reflection, uniform scale,
 * translation) to the layout on screen, so a change of contrast, statistic or region
 * moves points only as much as their relative positions changed. Presentation only.
 */
export function displayCoords(key: string, ids: string[], coords: Float64Array): Displayed {
  let d = displayed.get(key);
  if (!d) {
    if (lastShown && lastShown.key !== key) {
      const al = alignById(ids, coords, lastShown.ids, lastShown.coords);
      d = al.shared >= 3
        ? { key, ids, coords: Float64Array.from(al.aligned), rot: al.rotation, scale: al.scale, trans: al.translation }
        : { key, ids, coords, rot: [1, 0, 0, 1], scale: 1, trans: [0, 0] };
    } else d = { key, ids, coords, rot: [1, 0, 0, 1], scale: 1, trans: [0, 0] };
    if (displayed.size > 24) displayed.clear();
    displayed.set(key, d);
  }
  if (lastShown && lastShown.key !== key && !reducedMotion?.matches && lastScreen.size) {
    anim = { from: new Map(lastScreen), start: performance.now(), key };
  }
  lastShown = d;
  return d;
}

/** Map a point in the fit's canonical coordinates to displayed coordinates. */
export function toDisplayed(d: Displayed, x: number, y: number): [number, number] {
  const [a, b, c, e] = d.rot;
  return [d.scale * (a * x + b * y) + d.trans[0], d.scale * (c * x + e * y) + d.trans[1]];
}

/**
 * During a transition, interpolate screen positions from where each map was drawn
 * (by ID) to where it now belongs; new maps fade in. Returns progress in [0, 1]
 * (1 = settled) and keeps redrawing until settled.
 */
export function animate(points: { id: string; sx: number; sy: number }[]): number {
  const now = new Map(points.map((p) => [p.id, [p.sx, p.sy] as [number, number]]));
  if (!anim) {
    lastScreen = now;
    return 1;
  }
  const t = Math.min(1, (performance.now() - anim.start) / ANIM_MS);
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  for (const p of points) {
    const f = anim.from.get(p.id);
    if (!f) continue;
    p.sx = f[0] + (p.sx - f[0]) * e;
    p.sy = f[1] + (p.sy - f[1]) * e;
  }
  if (t >= 1) {
    anim = null;
    lastScreen = now;
  } else requestAnimationFrame(() => M.scheduleDraw(false, true));
  return t;
}

export function animating(): boolean {
  return anim !== null;
}

// ---------------------------------------------------------------------------
// Lens (V2-09)

let lensAt: [number, number] | null = null;
const LENS_R = 150;
const LENS_D = 2.4;

/** Lens mapping for a screen point (identity when the lens is off or the point is outside it). */
export function lens(x: number, y: number): { x: number; y: number; scale: number } {
  if (!opts.lens || !lensAt) return { x, y, scale: 1 };
  return fisheye(x, y, lensAt[0], lensAt[1], LENS_R, LENS_D);
}

// ---------------------------------------------------------------------------
// Colour channel (V2-02)

let valueCmap: { key: string; cmap: ColorMap } | null = null;

function cursorValue(a: M.Analysis, member: number): number {
  return M.state.cursor ? a.set.valueAt(a.set.members[member].values, M.state.cursor) : NaN;
}

function numericRange(field: string, ids: string[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of ids) {
    const v = covariates?.values.get(id)?.[field];
    if (typeof v === 'number') {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return [lo, hi];
}

function categories(field: string, ids: string[]): string[] {
  const s = new Set<string>();
  for (const id of ids) {
    const v = covariates?.values.get(id)?.[field];
    if (typeof v === 'string') s.add(v);
  }
  return [...s].sort();
}

/** Frame/dot colour of a member under the active channel; 'missing' for no value; null when no channel. */
export function memberColour(a: M.Analysis, member: number): string | 'missing' | null {
  if (!opts.colour) return null;
  if (opts.colour === 'cursor') {
    const v = cursorValue(a, member);
    if (!Number.isFinite(v)) return 'missing';
    if (Math.abs(v) < M.state.thr) return THEME.faint;
    const k = `${M.state.range}|${M.state.thr}`;
    if (!valueCmap || valueCmap.key !== k) valueCmap = { key: k, cmap: thresholdedDiverging(M.state.range, M.state.thr) };
    const c = valueCmap.cmap.getColor(Math.max(-M.state.range, Math.min(M.state.range, v)));
    return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
  }
  const field = opts.colour.slice(4);
  const f = covariates?.fields.find((x) => x.name === field);
  if (!f) return 'missing';
  const v = covariates?.values.get(a.ids[member])?.[field];
  if (v === null || v === undefined) return 'missing';
  if (f.kind === 'numeric' && typeof v === 'number') {
    const [lo, hi] = numericRange(field, a.ids);
    return SEQUENTIAL(hi > lo ? (v - lo) / (hi - lo) : 0.5).hex();
  }
  const cats = categories(field, a.ids);
  return CATEGORY_COLOURS[cats.indexOf(String(v)) % CATEGORY_COLOURS.length];
}

/** Draw a colour-channel frame around a picture rect (thumbnails) or a ring around a dot (marks). */
export function drawMemberColour(ctx: CanvasRenderingContext2D, colour: string, rect: { x: number; y: number; w: number; h: number } | null, dot: [number, number] | null): void {
  ctx.save();
  if (colour === 'missing') {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = THEME.muted;
  } else ctx.strokeStyle = colour;
  ctx.lineWidth = 2.5;
  if (rect) ctx.strokeRect(rect.x - 2.5, rect.y - 2.5, rect.w + 5, rect.h + 5);
  if (dot) {
    ctx.beginPath();
    ctx.arc(dot[0], dot[1], 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawChannelLegend(ctx: CanvasRenderingContext2D, a: M.Analysis, plot: PlotRect): void {
  if (!opts.colour) return;
  const x = plot.x + 4;
  let y = plot.y + plot.h - 26;
  ctx.save();
  ctx.font = `11px ${FONT.sans}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const st = M.STAT_LABEL[M.state.stat];
  const swatch = (c: string, label: string, xx: number): number => {
    if (c === 'missing') {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = THEME.muted;
      ctx.strokeRect(xx + 0.5, y - 5.5, 11, 11);
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = c;
      ctx.fillRect(xx, y - 5, 11, 11);
    }
    ctx.fillStyle = THEME.muted;
    ctx.fillText(label, xx + 16, y);
    return xx + 16 + ctx.measureText(label).width + 12;
  };
  ctx.fillStyle = THEME.text;
  if (opts.colour === 'cursor') {
    const w = M.state.cursor ? (a.set.space.gridToCoord(M.state.cursor) as number[]) : null;
    ctx.fillText(`Frame colour: raw ${st} at the cursor${w ? ` (${w.map((v) => fmt(v, 0)).join(', ')} mm)` : ''}; positions unchanged`, x, y - 18);
    let xx = x;
    const k = `${M.state.range}|${M.state.thr}`;
    if (!valueCmap || valueCmap.key !== k) valueCmap = { key: k, cmap: thresholdedDiverging(M.state.range, M.state.thr) };
    for (const v of [-M.state.range, -M.state.thr - 1e-6, M.state.thr + 1e-6, M.state.range]) {
      const c = valueCmap.cmap.getColor(v);
      xx = swatch(`rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`, fmt(v, 1), xx);
    }
    xx = swatch(THEME.faint, `|${st}| < ${M.state.thr}`, xx);
    swatch('missing', 'no data', xx);
  } else {
    const field = opts.colour.slice(4);
    const f = covariates?.fields.find((q) => q.name === field);
    ctx.fillText(`Frame colour: ${field} (participants.tsv); positions unchanged`, x, y - 18);
    let xx = x;
    if (f?.kind === 'numeric') {
      const [lo, hi] = numericRange(field, a.ids);
      for (let i = 0; i <= 4; i++) xx = swatch(SEQUENTIAL(i / 4).hex(), i === 0 ? fmt(lo, 1) : i === 4 ? fmt(hi, 1) : '', xx) - (i > 0 && i < 4 ? 8 : 0);
    } else if (f) {
      categories(field, a.ids).forEach((c, i) => (xx = swatch(CATEGORY_COLOURS[i % CATEGORY_COLOURS.length], c, xx)));
    }
    swatch('missing', f ? 'missing' : 'no participants.tsv field', xx);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Stability (V2-04)

interface StabilityState {
  key: string;
  points: Float64Array[];
  done: number;
  total: number;
  ellipses: (Ellipse | null)[] | null;
  spread: number[] | null;
  error: string | null;
  definition: string;
  blockMm: number[];
}

let stab: StabilityState | null = null;
let stabWorker: Worker | null = null;
let stabWorkerKey: string | null = null;
let stabRun = 0;
const STAB_MAX_MAPS = 100;
const STAB_REPLICATES = 24;

/** Progress of the visible stability run, for the test probe. */
export function stabilityProgress(): { done: number; total: number; error: string | null; finished: boolean } | null {
  return stab ? { done: stab.done, total: stab.total, error: stab.error, finished: stab.ellipses !== null } : null;
}

function stopStability(): void {
  stabWorker?.terminate();
  stabWorker = null;
  stabWorkerKey = null;
}

/** Start (or reuse) the block bootstrap for the visible layout. */
function ensureStability(a: M.Analysis, b: SimilarityBasis, out: EmbedOutput, key: string): void {
  if (stab?.key === key) return;
  stopStability();
  const m = b.eligible.length;
  stab = { key, points: Array.from({ length: m }, () => new Float64Array(0)), done: 0, total: STAB_REPLICATES, ellipses: null, spread: null, error: null, definition: '', blockMm: [] };
  if (m > STAB_MAX_MAPS) {
    stab.error = `Stability is limited to ${STAB_MAX_MAPS} maps in this browser view (${m} placed).`;
    return;
  }
  if (m < 4) {
    stab.error = 'Stability needs at least 4 placed maps.';
    return;
  }
  const worker = new Worker(new URL('./stability.worker.ts', import.meta.url), { type: 'module' });
  stabWorker = worker;
  const id = ++stabRun;
  const support = b.support;
  worker.postMessage({
    type: 'init',
    key,
    data: b.eligible.map((i) => a.set.members[i].values.slice()),
    support,
    dim: [...a.set.dim],
    spacingMm: a.set.space.spacing as number[],
    maskIndex: a.set.maskIndex,
  });
  stabWorkerKey = key;
  worker.postMessage({
    type: 'run',
    id,
    key,
    ids: out.result.ids,
    reference: Float64Array.from(out.result.coords),
    method: out.result.method === 'metric-smacof' ? 'metric-smacof' : 'nmds',
    replicates: STAB_REPLICATES,
    seed: 1,
    blockMm: 12,
  });
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as { id: number; type: string; coords?: Float64Array | null; done?: number; total?: number; result?: { ellipses: (Ellipse | null)[]; spread: number[]; definition: string; blockMmActual: number[] }; error?: string };
    if (msg.id !== id || !stab || stab.key !== key) return;
    if (msg.type === 'replicate') {
      if (msg.coords) {
        for (let i = 0; i < m; i++) {
          const prev = stab.points[i];
          const next = new Float64Array(prev.length + 2);
          next.set(prev);
          next[prev.length] = msg.coords[2 * i];
          next[prev.length + 1] = msg.coords[2 * i + 1];
          stab.points[i] = next;
        }
      }
      stab.done = msg.done ?? stab.done;
      M.setStatus(`Stability ${stab.done}/${stab.total}`);
      M.scheduleDraw(false, stab.done < stab.total);
    } else if (msg.type === 'done' && msg.result) {
      stab.ellipses = msg.result.ellipses;
      stab.spread = msg.result.spread;
      stab.definition = msg.result.definition;
      stab.blockMm = msg.result.blockMmActual;
      M.setStatus('');
      stopStability();
      M.scheduleDraw();
    } else if (msg.type === 'error') {
      stab.error = msg.error ?? 'stability failed';
      stopStability();
      M.scheduleDraw();
    }
  };
  worker.onerror = (ev) => {
    ev.preventDefault();
    if (stab?.key === key) stab.error = `stability worker failed: ${ev.message || 'unknown'}`;
    stopStability();
    M.scheduleDraw();
  };
}

// ---------------------------------------------------------------------------
// Drawing layers for the normal (single-contrast) layout

export interface LayerInfo {
  a: M.Analysis;
  b: SimilarityBasis;
  out: EmbedOutput;
  key: string;
  d: Displayed;
  t: SpaceTransform;
  points: SV.SpacePoint[];
  plot: PlotRect;
  thumbW: number;
  thumbH: number;
  lod: 'thumbs' | 'marks';
}

/** Behind the pictures: density contours, stability clouds and fit halos. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, info: LayerInfo): void {
  const { a, b, out, key, d, t, points } = info;
  const scr = (x: number, y: number): [number, number] => {
    const [dx, dy] = toDisplayed(d, x, y);
    const [sx, sy] = t.toScreen(dx, dy);
    const l = lens(sx, sy);
    return [l.x, l.y];
  };
  if (densityOn() && points.length >= 5) {
    // Local-scale bandwidth (median distance to the k-th nearest neighbour): Scott's rule oversmooths
    // multimodal layouts into one blob.
    const k = kde2d(out.result.coords, { gridSize: 72, bandwidth: localBandwidth(out.result.coords) });
    const levels = densityLevels(k.grid, [0.5, 0.8, 0.95]);
    ctx.save();
    levels.forEach((level, li) => {
      if (!Number.isFinite(level)) return;
      ctx.strokeStyle = `rgba(155,134,255,${0.42 - li * 0.11})`;
      ctx.fillStyle = `rgba(155,134,255,${0.07 - li * 0.018})`;
      ctx.lineWidth = 1;
      for (const line of isoContours(k.grid, k.nx, k.ny, level)) {
        const lay = gridToLayout(line, k);
        ctx.beginPath();
        for (let i = 0; i < lay.length; i += 2) {
          const [x, y] = scr(lay[i], lay[i + 1]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.fill();
        ctx.stroke();
      }
    });
    ctx.restore();
  }
  if (opts.stability) {
    ensureStability(a, b, out, key);
    if (stab && stab.key === key && !stab.error) {
      ctx.save();
      const idx = new Map(out.result.ids.map((id, i) => [id, i]));
      for (const p of points) {
        const i = idx.get(a.ids[p.member]);
        if (i === undefined) continue;
        const cloud = stab.points[i];
        ctx.fillStyle = 'rgba(233,196,106,0.55)';
        for (let k = 0; k < cloud.length; k += 2) {
          const [x, y] = scr(cloud[k], cloud[k + 1]);
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
        const e = stab.ellipses?.[i];
        if (e) {
          // Ellipse in layout units -> screen: transform its axis endpoints.
          const N = 40;
          ctx.beginPath();
          for (let s = 0; s <= N; s++) {
            const th = (s / N) * Math.PI * 2;
            const ux = e.rx * Math.cos(th);
            const uy = e.ry * Math.sin(th);
            const lx = e.cx + ux * Math.cos(e.angle) - uy * Math.sin(e.angle);
            const ly = e.cy + ux * Math.sin(e.angle) + uy * Math.cos(e.angle);
            const [x, y] = scr(lx, ly);
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.fillStyle = 'rgba(233,196,106,0.10)';
          ctx.strokeStyle = 'rgba(233,196,106,0.75)';
          ctx.lineWidth = 1.25;
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
  if (opts.halos && out.result.pairs.distance.length) {
    const shares = stressShares(out.result.pairs.distance, out.result.pairs.disparity, out.result.ids.length);
    const n = out.result.ids.length;
    const idx = new Map(out.result.ids.map((id, i) => [id, i]));
    ctx.save();
    for (const p of points) {
      const i = idx.get(a.ids[p.member]);
      if (i === undefined) continue;
      // Relative to the mean share 1/n: 1 = typical; halo radius grows with the excess.
      const rel = shares[i] * n;
      const base = info.lod === 'thumbs' ? Math.max(info.thumbW, info.thumbH) * 0.42 : 9;
      const r = base * (0.6 + 0.55 * Math.min(4, rel));
      const [x, y] = [p.sx, p.sy];
      const g = ctx.createRadialGradient(x, y, r * 0.25, x, y, r);
      const alpha = Math.min(0.55, 0.12 + 0.12 * rel);
      g.addColorStop(0, `rgba(255,143,171,${alpha})`);
      g.addColorStop(1, 'rgba(255,143,171,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function localBandwidth(coords: ArrayLike<number>): number {
  const n = coords.length / 2;
  const k = Math.max(2, Math.round(Math.sqrt(n) / 2));
  const kth: number[] = [];
  for (let i = 0; i < n; i++) {
    const d: number[] = [];
    for (let j = 0; j < n; j++) if (j !== i) d.push(Math.hypot(coords[2 * i] - coords[2 * j], coords[2 * i + 1] - coords[2 * j + 1]));
    d.sort((x, y) => x - y);
    kth.push(d[Math.min(k, d.length) - 1] ?? 0);
  }
  kth.sort((x, y) => x - y);
  return Math.max(0.02, kth[Math.floor(kth.length / 2)] ?? 0.1);
}

/** Above the pictures: subset outlines, the lasso in progress, the lens rim and legends. */
export function drawForeground(ctx: CanvasRenderingContext2D, info: LayerInfo): void {
  const { a, points, plot } = info;
  if (opts.subset.size) {
    ctx.save();
    ctx.strokeStyle = SUBSET;
    ctx.lineWidth = 2;
    for (const p of points) {
      if (!opts.subset.has(a.ids[p.member])) continue;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, info.lod === 'thumbs' ? 6 : 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  drawLassoPath(ctx);
  if (opts.lens && lensAt) {
    ctx.save();
    ctx.strokeStyle = 'rgba(230,230,239,0.35)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(lensAt[0], lensAt[1], LENS_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  drawChannelLegend(ctx, a, plot);
  const notes: string[] = [];
  if (opts.halos) notes.push('Halo: share of the layout misfit (larger = placed less faithfully; typical = 1/n)');
  if (opts.stability && stab) {
    notes.push(stab.error ?? (stab.done < stab.total ? `Stability: resampling 12 mm brain blocks… ${stab.done}/${stab.total}` : `Stability: dots = ${stab.total} block-bootstrap refits; ellipse holds ~68% (not a confidence interval)`));
  }
  if (densityOn()) notes.push('Density contours hold 50 / 80 / 95% of the layout (Gaussian KDE)');
  if (opts.region) {
    const b = regionBasis(a);
    notes.push(b ? `Region layout: ${b.params.region}; ${b.support.length} voxels. Moving the cursor does not refit; click Region to cycle or clear.` : '');
  }
  if (animating()) notes.push('Aligned to the previous layout for display (rotation, reflection, scale only)');
  if (notes.length) {
    ctx.save();
    ctx.font = `11px ${FONT.sans}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    notes.filter(Boolean).forEach((n, i) => {
      const w = ctx.measureText(n).width;
      const yy = plot.y + plot.h - 22 - (notes.filter(Boolean).length - i) * 16;
      ctx.fillStyle = 'rgba(13,14,20,0.8)';
      ctx.fillRect(plot.x + plot.w - w - 8, yy, w + 8, 15);
      ctx.fillStyle = THEME.muted;
      ctx.fillText(n, plot.x + plot.w - 4, yy + 1);
    });
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Lasso subsets (V2-07)

let lasso: { pts: [number, number][]; remove: boolean } | null = null;

function drawLassoPath(ctx: CanvasRenderingContext2D): void {
  if (!lasso || lasso.pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = SUBSET;
  ctx.fillStyle = 'rgba(126,224,166,0.08)';
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  lasso.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function inside(poly: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function railAccent(subject: string): string | null {
  return opts.subset.has(subject) ? SUBSET : null;
}

// ---------------------------------------------------------------------------
// Gestures and keys (called from main.ts through space-view hooks)

function canvasXY(e: MouseEvent): [number, number] {
  const c = document.querySelector('canvas.montage') as HTMLCanvasElement;
  const r = c.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

export function onPointer(type: string, e: MouseEvent): boolean {
  if (type === 'pointerdown' && profileClick(...canvasXY(e))) return true;
  if (type === 'pointerdown' && e.shiftKey && !opts.trajectories) {
    lasso = { pts: [canvasXY(e)], remove: e.altKey };
    (e.target as HTMLElement).setPointerCapture?.((e as PointerEvent).pointerId);
    return true;
  }
  if (lasso && type === 'pointermove') {
    lasso.pts.push(canvasXY(e));
    M.scheduleDraw(true);
    return true;
  }
  if (lasso && (type === 'pointerup' || type === 'pointerleave')) {
    const g = SV.spaceGeom;
    if (g && lasso.pts.length >= 3) {
      for (const p of g.points) {
        if (!inside(lasso.pts, p.sx, p.sy)) continue;
        const ids = p.group ? p.group.map((q) => g.a.ids[q]) : [g.a.ids[p.member]];
        for (const id of ids) lasso.remove ? opts.subset.delete(id) : opts.subset.add(id);
      }
    }
    lasso = null;
    redraw(false);
    return true;
  }
  if (type === 'pointermove' && opts.lens) {
    lensAt = canvasXY(e);
    M.scheduleDraw(false, true);
    return false; // hover handling continues
  }
  if (type === 'pointerleave' && opts.lens) {
    lensAt = null;
    M.scheduleDraw(false, true);
    return false;
  }
  return false;
}

export function onKey(e: KeyboardEvent): boolean {
  if (e.altKey || e.metaKey || e.ctrlKey) return false;
  if (e.key === 'l' || e.key === 'L') {
    opts.lens = !opts.lens;
    if (!opts.lens) lensAt = null;
    redraw(true);
    return true;
  }
  if (e.key === 'h' || e.key === 'H') {
    toggle('halos');
    return true;
  }
  if (e.key === 'c' || e.key === 'C') {
    // Compare the focused map with the hovered (or keyboard-previewed) one.
    const partner = SV.spaceEnlarged;
    if (partner && M.state.subject && partner !== M.state.subject) {
      opts.compare = opts.compare === partner ? null : partner;
      redraw(false);
      return true;
    }
    return false;
  }
  if (e.key === 'Escape') {
    if (opts.compare) {
      opts.compare = null;
      redraw(false);
      return true;
    }
    if (opts.subset.size) {
      opts.subset.clear();
      redraw(false);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pair agreement (V2-01)

const contribCache = new Map<string, { pc: PairContributions; profile: Float64Array; orient: string; range: number }>();
let agreeCmap: ColorMap | null = null;

/** Agreement colours: green where both maps deviate the same way, magenta where they disagree. Not the t colours. */
function agreementColormap(): ColorMap {
  if (agreeCmap) return agreeCmap;
  const pos = chroma.scale(['#1f6f54', '#3fbf8a', '#b9f5d3']).mode('lch');
  const neg = chroma.scale(['#7a2a6b', '#c94fae', '#f5b9e8']).mode('lch');
  const colors: [number, number, number, number][] = [];
  const steps = 256;
  for (let s = 0; s < steps; s++) {
    const v = -1 + (2 * s) / (steps - 1);
    const f = Math.min(1, Math.abs(v));
    const c = (v >= 0 ? pos : neg)(f).rgb();
    colors.push([c[0] / 255, c[1] / 255, c[2] / 255, Math.min(1, 0.15 + f * 1.4)]);
  }
  agreeCmap = new ColorMap(colors, { range: [-1, 1], threshold: [-0.06, 0.06] });
  return agreeCmap;
}

function pairData(a: M.Analysis, b: SimilarityBasis, i: number, j: number): { pc: PairContributions; profile: Float64Array; range: number } {
  const key = `${b.key}|${a.ids[i]}|${a.ids[j]}|${M.state.orient}`;
  let c = contribCache.get(key);
  if (!c) {
    const pc = pairContributions(a.set.members[i].values, a.set.members[j].values, b.support);
    // Per-slice share of r along the current orientation.
    const [nx, ny] = a.set.dim;
    const n = a.set.sliceCount(M.state.orient);
    const profile = new Float64Array(n);
    for (let m = 0; m < a.set.maskIndex.length; m++) {
      const v = pc.contrib[m];
      if (!Number.isFinite(v)) continue;
      const g = a.set.maskIndex[m];
      const k = M.state.orient === 'axial' ? Math.floor(g / (nx * ny)) : M.state.orient === 'coronal' ? Math.floor(g / nx) % ny : g % nx;
      profile[k] += v;
    }
    const abs: number[] = [];
    for (let m = 0; m < pc.contrib.length; m += 3) if (Number.isFinite(pc.contrib[m])) abs.push(Math.abs(pc.contrib[m]));
    abs.sort((x, y) => x - y);
    const range = abs[Math.floor(abs.length * 0.995)] || 1e-9;
    c = { pc, profile, orient: M.state.orient, range };
    if (contribCache.size > 16) contribCache.clear();
    contribCache.set(key, c);
  }
  return c;
}

let profileHit: { x: number; y: number; w: number; h: number; n: number } | null = null;

/** The agreement card in the dock. Returns true when it drew (the dock is then not used for previews). */
export function drawDock(ctx: CanvasRenderingContext2D, g: SV.SpaceGeom): boolean {
  profileHit = null;
  if (!opts.compare || !g.dock || opts.trajectories) return false;
  const a = g.a;
  const b = SV.basisOf(a);
  const i = M.selectedMember(a);
  const j = a.ids.indexOf(opts.compare);
  if (i === undefined || j < 0 || i === j) return false;
  if (!b.eligible.includes(i) || !b.eligible.includes(j) || b.status !== 'ok') {
    ctx.save();
    ctx.fillStyle = THEME.warn;
    ctx.font = `11px ${FONT.sans}`;
    ctx.textBaseline = 'top';
    ctx.fillText(`${a.ids[i]} × ${opts.compare}: not comparable`, g.dock.x, g.dock.y);
    ctx.fillText('(one map is not placed)', g.dock.x, g.dock.y + 15);
    ctx.restore();
    return true;
  }
  const { pc, profile, range } = pairData(a, b, i, j);
  const asp = M.sliceAspect(a.set);
  const w = g.dock.w;
  const h = Math.round(w / asp);
  const x0 = g.dock.x;
  let y = g.dock.y;
  ctx.save();
  ctx.font = `600 11px ${FONT.mono}`;
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`${a.ids[i]} × ${a.ids[j]}`, x0, y);
  ctx.font = `10.5px ${FONT.sans}`;
  ctx.fillStyle = THEME.muted;
  ctx.fillText('where r comes from', x0, y + 14);
  y += 30;
  const v = placeCrop(M.cropWindow(a.set), { x: x0, y, w, h });
  ctx.fillStyle = '#000';
  ctx.fillRect(v.dest.x, v.dest.y, v.dest.w, v.dest.h);
  // Agreement slice, scaled to its own symmetric range (99.5th percentile of |contribution|).
  const slice = a.set.slice(pc.contrib, M.state.orient, M.sliceIndex());
  const scaled = new Float32Array(slice.data.length);
  for (let p = 0; p < scaled.length; p++) scaled[p] = Number.isFinite(slice.data[p]) ? Math.max(-1, Math.min(1, slice.data[p] / range)) : NaN;
  const img = agreementColormap().fillImageData(new ImageData(slice.width, slice.height), scaled);
  const c = document.createElement('canvas');
  c.width = slice.width;
  c.height = slice.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  drawCellImage(ctx, M.underSilhouette(a), c, v);
  if (M.state.cursor) {
    const [col, row] = gridToSlicePixel(a.set.dim, M.state.orient, M.state.cursor);
    drawCrosshair(ctx, v, col, row);
  }
  y = v.dest.y + v.dest.h + 6;
  // Legend.
  ctx.fillStyle = '#3fbf8a';
  ctx.fillRect(x0, y, 10, 10);
  ctx.fillStyle = '#c94fae';
  ctx.fillRect(x0 + w / 2, y, 10, 10);
  ctx.fillStyle = THEME.muted;
  ctx.textBaseline = 'middle';
  ctx.fillText('agree', x0 + 14, y + 5);
  ctx.fillText('disagree', x0 + w / 2 + 14, y + 5);
  y += 16;
  // Per-slice profile: share of r from each slice; click to go there.
  const ph = 26;
  const n = profile.length;
  let pmax = 1e-12;
  for (const p of profile) pmax = Math.max(pmax, Math.abs(p));
  ctx.strokeStyle = THEME.line;
  ctx.beginPath();
  ctx.moveTo(x0, y + ph / 2 + 0.5);
  ctx.lineTo(x0 + w, y + ph / 2 + 0.5);
  ctx.stroke();
  for (let k = 0; k < n; k++) {
    const bw = w / n;
    const val = profile[k] / pmax;
    ctx.fillStyle = val >= 0 ? '#3fbf8a' : '#c94fae';
    const bh = (Math.abs(val) * ph) / 2;
    ctx.fillRect(x0 + k * bw, val >= 0 ? y + ph / 2 - bh : y + ph / 2, Math.max(1, bw - 0.5), bh);
  }
  const cur = M.sliceIndex();
  ctx.fillStyle = THEME.accent;
  ctx.fillRect(x0 + (cur + 0.5) * (w / n) - 0.5, y - 2, 1, ph + 4);
  profileHit = { x: x0, y, w, h: ph, n };
  y += ph + 4;
  ctx.fillStyle = THEME.muted;
  ctx.textBaseline = 'top';
  ctx.fillText(`${M.state.orient} slices (click to go)`, x0, y);
  ctx.restore();
  return true;
}

/** Click on the agreement profile jumps to that slice (true when consumed). */
export function profileClick(x: number, y: number): boolean {
  const p = profileHit;
  if (!p || x < p.x || x > p.x + p.w || y < p.y - 2 || y > p.y + p.h + 2) return false;
  const k = Math.floor(((x - p.x) / p.w) * p.n);
  M.state.slice = Math.max(0, Math.min(p.n - 1, k));
  if (M.state.cursor) M.state.cursor[M.state.orient === 'axial' ? 2 : M.state.orient === 'coronal' ? 1 : 0] = M.state.slice;
  M.scheduleDraw(false, true);
  return true;
}

// ---------------------------------------------------------------------------
// Side-panel sections

function subsetSection(a: M.Analysis): string {
  if (!opts.subset.size) return '';
  const b = SV.basisOf(a);
  const ids = [...opts.subset].filter((id) => a.ids.includes(id));
  const inBasis = ids.map((id) => a.ids.indexOf(id)).filter((i) => b.eligible.includes(i));
  // Medoid: the member with the smallest summed dissimilarity to the rest of the group (ties: lower ID).
  let medoid = '';
  if (inBasis.length >= 2 && b.status === 'ok') {
    const m = b.eligible.length;
    let best = Infinity;
    for (const i of inBasis) {
      const p = b.eligible.indexOf(i);
      let s = 0;
      for (const j of inBasis) s += b.dist[p * m + b.eligible.indexOf(j)];
      if (s < best - 1e-12 || (Math.abs(s - best) <= 1e-12 && a.ids[i] < medoid)) {
        best = s;
        medoid = a.ids[i];
      }
    }
  }
  const st = M.STAT_LABEL[M.state.stat];
  return `<section>
    <h3>Group <span class="sub">${ids.length} of ${a.set.size}</span></h3>
    <p class="note">${ids.map((x) => `<span class="nb">${x}</span>`).join(', ')}${medoid ? `. Most typical member (medoid by 1 − r): <b>${medoid}</b>.` : '.'}</p>
    <canvas id="subset-cmp" aria-label="Group mean, mean of the other maps, and their difference on this slice"></canvas>
    <p class="note">Mean raw ${st}-map of the group, of the other ${a.set.size - ids.length} maps, and group − others on this slice. A descriptive difference of means chosen by eye, not a test. Shift-drag adds, Shift+Alt-drag removes, Esc clears.</p>
  </section>`;
}

function agreementSection(a: M.Analysis): string {
  if (!opts.compare) return '';
  const b = SV.basisOf(a);
  const i = M.selectedMember(a);
  const j = a.ids.indexOf(opts.compare);
  if (i === undefined || j < 0 || i === j || !b.eligible.includes(i) || !b.eligible.includes(j) || b.status !== 'ok') return '';
  const { pc, profile } = pairData(a, b, i, j);
  const k = M.sliceIndex();
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  return `<section>
    <h3>Agreement <span class="sub">${a.ids[i]} × ${a.ids[j]}</span></h3>
    <dl class="agree-stats">
      <dt>r</dt><dd>${M.fmtR(pc.r)}</dd>
      <dt>from agreeing voxels</dt><dd>+${M.fmtR(pc.positive)}</dd>
      <dt>from disagreeing voxels</dt><dd>−${M.fmtR(-pc.negative)}</dd>
      <dt>from this slice</dt><dd>${profile[k] >= 0 ? '+' : '−'}${M.fmtR(Math.abs(profile[k]))} · ${pct(Math.abs(profile[k]) / (Math.abs(pc.positive) + Math.abs(pc.negative) || 1))}</dd>
    </dl>
    <p class="note">Each voxel's contribution is z<sub>a</sub>·z<sub>b</sub>/n on the ${b.support.length.toLocaleString()} common-support voxels, so the map sums exactly to r. Green: both maps deviate from their own means in the same direction there; magenta: opposite directions. Descriptive, not a significance map. Esc or C closes.</p>
  </section>`;
}

function stabilitySection(): string {
  if (!opts.stability || !stab) return '';
  if (stab.error) return `<section><h3>Stability</h3><p class="note warnline">${stab.error}</p></section>`;
  return `<section><h3>Stability <span class="sub">${stab.done}/${stab.total}</span></h3>
    <p class="note">${stab.definition || 'Resampling 12 mm cubes of the common support with replacement and refitting from the current layout; each refit is aligned to it.'} Ellipses hold ~68% of each map's refits. Tight: the position is carried by much of the brain. Loose: it depends on a few regions. This is not a confidence interval for any biological quantity.</p>
  </section>`;
}

export function panelHtml(a: M.Analysis): string {
  return agreementSection(a) + subsetSection(a) + stabilitySection();
}

export function wirePanel(a: M.Analysis): void {
  M.side.querySelectorAll<HTMLButtonElement>('[data-compare]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.compare === opts.compare));
    btn.onclick = () => {
      opts.compare = opts.compare === btn.dataset.compare ? null : btn.dataset.compare!;
      redraw(false);
    };
  });
  const c = M.side.querySelector('#subset-cmp') as HTMLCanvasElement | null;
  if (c) drawSubsetComparison(c, a);
}

function drawSubsetComparison(c: HTMLCanvasElement, a: M.Analysis): void {
  const ids = new Set([...opts.subset].filter((id) => a.ids.includes(id)));
  const W = M.side.clientWidth;
  const gap = 6;
  const cw = (W - 2 * gap) / 3;
  const asp = M.sliceAspect(a.set);
  const ch = cw / asp;
  const ctx = hidpi(c, W, ch + 16);
  const mean = (inGroup: boolean): Float32Array => {
    const V = a.set.maskIndex.length;
    const s = new Float64Array(V);
    const n = new Uint16Array(V);
    a.set.members.forEach((mm, i) => {
      if (ids.has(a.ids[i]) !== inGroup) return;
      for (let v = 0; v < V; v++) {
        const x = mm.values[v];
        if (Number.isFinite(x)) {
          s[v] += x;
          n[v]++;
        }
      }
    });
    return Float32Array.from(s, (x, v) => (n[v] ? x / n[v] : NaN));
  };
  const g = mean(true);
  const r = mean(false);
  const diff = Float32Array.from(g, (x, v) => x - r[v]);
  const cmap = thresholdedDiverging(M.state.range, M.state.thr);
  const panels: [Float32Array, string][] = [
    [g, 'group'],
    [r, 'others'],
    [diff, 'difference'],
  ];
  panels.forEach(([vals, label], k) => {
    const sl = a.set.slice(vals, M.state.orient, M.sliceIndex());
    const img = cmap.fillImageData(new ImageData(sl.width, sl.height), sl.data);
    const oc = document.createElement('canvas');
    oc.width = sl.width;
    oc.height = sl.height;
    oc.getContext('2d')!.putImageData(img, 0, 0);
    const v = placeCrop(M.cropWindow(a.set), { x: k * (cw + gap), y: 0, w: cw, h: ch });
    ctx.fillStyle = '#000';
    ctx.fillRect(v.dest.x, v.dest.y, v.dest.w, v.dest.h);
    drawCellImage(ctx, M.underSilhouette(a), oc, v);
    ctx.fillStyle = THEME.muted;
    ctx.font = `10.5px ${FONT.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, v.dest.x + v.dest.w / 2, ch + 3);
  });
}

// ---------------------------------------------------------------------------
// Contrast trajectories (V2-08): one pooled fit over subject x contrast maps

interface Pooled {
  key: string;
  basis: SimilarityBasis;
  subjects: string[];
  contrasts: string[];
  /** Eligible pooled index -> [subject, contrast]. */
  of: { subject: string; contrast: string }[];
}

let pooled: Pooled | null = null;

/** Layout options for the pooled fit: as for one contrast, with at most 16 random starts. */
export function pooledOpts(n: number): NmdsOptions {
  const o = M.layoutOpts(n);
  return { ...o, restarts: Math.min(16, o.restarts ?? 8) };
}

/** Layout key of the visible pooled fit (trajectory mode), for the test probe. */
export function pooledLayoutKey(): string | null {
  return opts.trajectories && pooled ? SV.layoutKeyFor(pooled.basis, pooledOpts(pooled.basis.eligible.length)) : null;
}

export function trajectoryMode(): boolean {
  return opts.trajectories;
}

/** Build (or reuse) the pooled basis: one map per subject x contrast on the voxels every set shares. */
async function pooledBasis(): Promise<Pooled> {
  const contrasts = [...new Set([M.state.contrast, ...M.state.facets])].slice(0, 5);
  const list = await Promise.all(contrasts.map((c) => M.getAnalysis(M.state.model, c, M.state.stat)));
  const key = list.map((x) => x.basis.fingerprint).join('|') + `|${contrasts.join(',')}`;
  if (pooled?.key === key) return pooled;
  // Common voxels: grid indices present in every set's mask.
  const count = new Map<number, number>();
  for (const a of list) for (const g of a.set.maskIndex) count.set(g, (count.get(g) ?? 0) + 1);
  const common = [...count].filter(([, c]) => c === list.length).map(([g]) => g).sort((x, y) => x - y);
  const subjects = [...new Set(list.flatMap((a) => a.ids))].sort();
  const data: Float32Array[] = [];
  const ids: string[] = [];
  const of: { subject: string; contrast: string }[] = [];
  list.forEach((a, ci) => {
    for (const s of subjects) {
      const m = a.ids.indexOf(s);
      if (m < 0) continue;
      const vals = a.set.members[m].values;
      data.push(Float32Array.from(common, (g) => vals[a.set.gridToMask[g]]));
      ids.push(`${s}·${contrasts[ci]}`);
      of.push({ subject: s, contrast: contrasts[ci] });
    }
  });
  const basis = similarityBasis(data, ids, {
    labels: { model: M.state.model, stat: M.state.stat, pooled: contrasts.join('+') },
    region: `pooled over ${contrasts.join(', ')}`,
    maskRule: `voxels in every contrast's analysis mask (${common.length} voxels)`,
  });
  pooled = { key, basis, subjects, contrasts, of };
  return pooled;
}

/** Draw trajectory mode inside the plot. Fills geom.marks (dots select the subject). */
export async function drawTrajectories(ctx: CanvasRenderingContext2D, g: SV.SpaceGeom, plot: PlotRect): Promise<void> {
  const P = await pooledBasis();
  const b = P.basis;
  const ids = b.eligible.map((i) => b.ids[i]);
  // The pooled set is larger than one contrast; fewer random starts keep the fit interactive (recorded in the key).
  const layout = SV.layoutForBasis(b, ids, pooledOpts(ids.length));
  g.layout = layout;
  const message = (text: string, color: string = THEME.muted): void => {
    ctx.fillStyle = color;
    ctx.font = `13px ${FONT.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, plot.x + plot.w / 2, plot.y + plot.h / 2);
  };
  if (layout.kind === 'pending') return message(`Fitting one shared layout for ${ids.length} subject × contrast maps…`);
  if (layout.kind === 'none') return message(layout.message, THEME.warn);
  if (layout.kind === 'error') return message(`Layout failed: ${layout.message}. Press R to retry.`, THEME.warn);
  const res = layout.out.result;
  const key = SV.layoutKeyFor(b, pooledOpts(ids.length));
  const d = displayCoords(key, ids, Float64Array.from(res.coords));
  const inner = { x: plot.x + 40, y: plot.y + 60, w: plot.w - 80, h: plot.h - 120 };
  const t = spaceTransform(d.coords, inner, M.state.space);
  g.t = t;
  const pts = ids.map((id, i) => {
    const [sx, sy] = t.toScreen(d.coords[2 * i], d.coords[2 * i + 1]);
    return { id, sx, sy, ...P.of[b.eligible[i]] };
  });
  animate(pts);
  for (const p of pts) {
    const l = lens(p.sx, p.sy);
    p.sx = l.x;
    p.sy = l.y;
  }
  const sel = M.state.subject;
  const a = g.a;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x - 4, plot.y - 4, plot.w + 8, plot.h + 8);
  ctx.clip();
  // Paths: each subject's contrasts in list order, within this one fit.
  for (const s of P.subjects) {
    const path = P.contrasts.map((c) => pts.find((p) => p.subject === s && p.contrast === c)).filter((p): p is (typeof pts)[number] => !!p);
    if (path.length < 2) continue;
    const isSel = s === sel;
    ctx.strokeStyle = isSel ? THEME.brand : opts.subset.has(s) ? SUBSET : 'rgba(200,202,220,0.28)';
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
    ctx.stroke();
  }
  for (const p of pts) {
    const ci = P.contrasts.indexOf(p.contrast);
    const isSel = p.subject === sel;
    const chan = p.contrast === a.contrast ? memberColour(a, a.ids.indexOf(p.subject)) : null;
    ctx.fillStyle = CONTRAST_COLOURS[ci % CONTRAST_COLOURS.length];
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, isSel ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (isSel) {
      ctx.strokeStyle = THEME.brand;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (chan) drawMemberColour(ctx, chan, null, [p.sx, p.sy]);
    const m = a.ids.indexOf(p.subject);
    if (m >= 0) g.marks.push({ member: m, box: { x: p.sx - 8, y: p.sy - 8, w: 16, h: 16 }, kind: 'dot' });
  }
  // Labels for the focused subject's points.
  ctx.font = `600 10.5px ${FONT.mono}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const p of pts) {
    if (p.subject !== sel) continue;
    ctx.fillStyle = 'rgba(13,14,20,0.85)';
    const text = `${p.subject} ${p.contrast}`;
    ctx.fillRect(p.sx + 8, p.sy - 7, ctx.measureText(text).width + 6, 14);
    ctx.fillStyle = THEME.text;
    ctx.fillText(text, p.sx + 11, p.sy);
  }
  ctx.restore();
  // Legend + contract.
  ctx.save();
  ctx.font = `11px ${FONT.sans}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let x = plot.x + 4;
  const y = plot.y + 12;
  P.contrasts.forEach((c, i) => {
    ctx.fillStyle = CONTRAST_COLOURS[i % CONTRAST_COLOURS.length];
    ctx.beginPath();
    ctx.arc(x + 5, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = THEME.muted;
    ctx.fillText(c, x + 14, y);
    x += 24 + ctx.measureText(c).width;
  });
  ctx.fillStyle = THEME.faint;
  ctx.fillText(
    `One fit over ${ids.length} subject × contrast maps (${res.method === 'nmds' ? 'nonmetric MDS' : res.method === 'metric-smacof' ? 'metric MDS fallback' : 'exact'} of 1 − r on ${b.support.length.toLocaleString()} shared voxels). Lines join a subject's contrasts; their lengths approximate 1 − r within this fit.`,
    plot.x + 4,
    plot.y + 30
  );
  ctx.restore();
}
