/**
 * Space v2 layers: colour channels, fit halos, density contours, stability clouds,
 * region-conditioned layouts, aligned transitions, the magnifier, lasso subsets,
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
import { stressShares } from '../../src/volumeset/fitShares';
import type { Ellipse } from '../../src/volumeset/stability';
import type { NmdsOptions } from '../../src/volumeset/nmds';
import { THEME, FONT, fmt, hidpi, placeCrop, drawCellImage, drawCrosshair, thresholdedDiverging } from './render';
import { fetchCovariates, type Covariates } from './data';
import type { EmbedOutput } from './embed-runner';
import { spaceTransform, thumbSize, declutter, type SpaceTransform, type PlotRect } from './space';
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

/** Corrections to Space URL options, announced once the view is up (like the main viewer's). */
const urlNotes: string[] = [];

function announce(note: string): void {
  urlNotes.push(note);
}

export function readParams(q: URLSearchParams): void {
  const c = q.get('sc');
  opts.colour = c === 'cursor' || (c !== null && /^cov:[\w.-]{1,40}$/.test(c)) ? c : '';
  if (c !== null && !opts.colour) announce(`colour "${c}" not recognised → none`);
  opts.halos = q.get('sh') === '1';
  opts.stability = q.get('sb') === '1';
  const d = q.get('sd');
  opts.density = d === 'on' || d === 'off' ? d : 'auto';
  const r = q.get('sr')?.split(',').map(Number);
  opts.region = r && r.length === 4 && r.every(Number.isFinite) && r.slice(0, 3).every((v) => Number.isInteger(v) && v >= 0) && REGION_RADII.includes(r[3])
    ? { ijk: [r[0], r[1], r[2]], radiusMm: r[3] }
    : null;
  if (q.has('sr') && !opts.region) announce(`region "${q.get('sr')}" is not i,j,k with a radius of ${REGION_RADII.join(', ')} mm → whole brain`);
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
/** Halos and stability use one neutral hue: not a t colour, not the brand, not the cursor cyan. */
const NEUTRAL = '205,208,228';
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
    .space-tools { position: absolute; top: 9px; z-index: 3; display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 6px; pointer-events: auto; }
    .space-tools .chip { background: var(--panel); color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 3px 9px; font: 12px var(--sans); cursor: pointer; white-space: nowrap; }
    .space-tools .chip:hover { color: var(--text); }
    .space-tools .chip[aria-pressed='true'] { color: var(--text); background: var(--brand-soft); }
    .space-tools .chip.subset[aria-pressed='true'] { border-color: ${SUBSET}; background: rgba(126,224,166,0.14); }
    .space-tools select.chip { padding: 2px 6px; width: 168px; }
    #side .chan-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--muted); margin: 4px 0; }
    #side .chan-legend i { display: inline-block; width: 11px; height: 11px; vertical-align: -1px; margin-right: 4px; border-radius: 2px; }
    #side .chan-legend i.miss { border: 1px dashed var(--muted); }
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
      if (opts.colour.startsWith('cov:') && !c?.fields.some((f) => `cov:${f.name}` === opts.colour)) {
        M.setStatus(`Adjusted from the URL: ${c ? `no "${opts.colour.slice(4)}" column in participants.tsv` : 'no participants.tsv'} → marks off`, 6000);
        opts.colour = '';
        M.scheduleDraw();
      }
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
  // Left-aligned at the layout's left edge, so a chip appearing at the end never shifts the others.
  const g = SV.spaceGeom;
  if (g) toolbar.style.left = `${Math.round(g.plot.x)}px`;
  if (urlNotes.length) M.setStatus(`Adjusted from the URL: ${urlNotes.splice(0).join('; ')}`, 6000);
  // Rebuild only when the set of controls changes; otherwise update in place, so a click is never
  // lost to a rebuild between pointer-down and pointer-up.
  const covOpts = (covariates?.fields ?? []).map((f) => `<option value="cov:${f.name}">Mark: ${f.name}${f.kind === 'numeric' ? '' : ' (category)'}</option>`).join('');
  // Covariate options are filled in place (fixed-width select), so their arrival never shifts the chips.
  const structure = `${opts.subset.size > 0}`;
  if (toolbar.dataset.structure !== structure) {
    toolbar.innerHTML = `
    <select class="chip" id="sx-colour" title="Mark each map with a value (a bar under its picture); positions do not change" aria-label="Mark maps by">
    </select>
    ${chip('sx-halos', 'Fit halos (H)', false, "Halo size = each map's share of the layout misfit")}
    ${chip('sx-stab', 'Stability', false, 'Where each map would sit if blocks of the compared voxels were resampled (block bootstrap)')}
    ${chip('sx-dens', 'Density', false, 'Contours of where maps concentrate in the layout')}
    ${chip('sx-lens', 'Magnifier (L)', false, 'A loupe that magnifies the view under the pointer; nothing moves')}
    ${chip('sx-region', 'Similarity: whole brain', false, 'Lay out by similarity within a sphere: first click applies 10 mm at the cursor, further clicks widen it (15, 25 mm) and then return to the whole brain')}
    ${chip('sx-traj', 'Contrasts side by side', false, 'Show every contrast at the same positions (this layout), one panel per contrast')}
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
  set('sx-region', opts.region !== null, opts.region ? `Similarity: ${opts.region.radiusMm} mm sphere` : 'Similarity: whole brain');
  set('sx-traj', opts.trajectories);
  set('sx-subset', true, `Group of ${opts.subset.size} ✕`);
  const sel = toolbar.querySelector('#sx-colour') as HTMLSelectElement;
  const optionsHtml = `<option value="">Mark: none</option><option value="cursor">Mark: value at cursor</option>${covOpts}`;
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
    redraw(false);
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
    syncToolbar();
    M.scheduleDraw(true);
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
  redraw(false);
}

function redraw(keepSide: boolean): void {
  syncToolbar();
  M.scheduleDraw(false, keepSide);
}

function cycleRegion(): void {
  const cur = opts.region?.radiusMm;
  const i = cur === undefined ? -1 : REGION_RADII.indexOf(cur);
  const next = i + 1 < REGION_RADII.length ? REGION_RADII[i + 1] : null;
  // Applied explicitly: the first click centres on the cursor; widening keeps that centre (moving the
  // cursor never refits). Re-centring is a separate, explicit action in the panel.
  const centre = opts.region?.ijk ?? (M.state.cursor ? ([...M.state.cursor] as [number, number, number]) : null);
  opts.region = next !== null && centre ? { ijk: centre, radiusMm: next } : null;
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
  return null; // side-by-side panels use the current contrast's own layout
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
// Magnifier (V2-09). A loupe drawn over the view: it magnifies what is already drawn, so it can never
// disturb positions or reintroduce overlaps (a fisheye that moved pictures undid the declutter).

let lensAt: [number, number] | null = null;
const LOUPE_R = 110;
const LOUPE_ZOOM = 2.2;

/** Kept for the layout code: positions are never transformed by the magnifier. */
export function lens(x: number, y: number): { x: number; y: number; scale: number } {
  return { x, y, scale: 1 };
}

/** Draw the loupe on the overlay canvas (called last, so it sits above everything). */
export function drawLoupe(ctx: CanvasRenderingContext2D): void {
  if (!opts.lens || !lensAt || M.state.mode !== 'space') return;
  const src = document.querySelector('canvas.montage') as HTMLCanvasElement | null;
  if (!src) return;
  const dpr = src.width / src.clientWidth;
  const [x, y] = lensAt;
  const r = LOUPE_R;
  const sr = r / LOUPE_ZOOM;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, (x - sr) * dpr, (y - sr) * dpr, 2 * sr * dpr, 2 * sr * dpr, x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(230,230,239,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `10.5px ${FONT.sans}`;
  ctx.fillStyle = THEME.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${LOUPE_ZOOM}× magnifier · L to close`, x, y + r + 4);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Marks (V2-02): a bar under each picture (a ring around each dot) in the colour of a value

let valueCmap: { key: string; cmap: ColorMap; range: number } | null = null;

function cursorValue(a: M.Analysis, member: number): number {
  return M.state.cursor ? a.set.valueAt(a.set.members[member].values, M.state.cursor) : NaN;
}

function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= x) return m * mag;
  return 10 * mag;
}

/** The channel's own symmetric scale: up to the largest |value| at the cursor (the map scale clips at its max). */
function cursorScale(a: M.Analysis): { cmap: ColorMap; range: number } {
  let mx = 0;
  for (let m = 0; m < a.set.size; m++) {
    const v = cursorValue(a, m);
    if (Number.isFinite(v)) mx = Math.max(mx, Math.abs(v));
  }
  const range = Math.max(niceCeil(mx), M.state.thr * 1.5, 1e-6);
  const k = `${range}|${M.state.thr}`;
  if (!valueCmap || valueCmap.key !== k) valueCmap = { key: k, cmap: thresholdedDiverging(range, Math.min(M.state.thr, range * 0.9)), range };
  return valueCmap;
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

const rgb = (c: number[]): string => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/** Mark colour of a member under the active channel; 'missing' for no value; null when no channel. */
export function memberColour(a: M.Analysis, member: number): string | 'missing' | null {
  if (!opts.colour) return null;
  if (opts.colour === 'cursor') {
    const v = cursorValue(a, member);
    if (!Number.isFinite(v)) return 'missing';
    if (Math.abs(v) < M.state.thr) return THEME.faint;
    const { cmap, range } = cursorScale(a);
    return rgb(cmap.getColor(Math.max(-range, Math.min(range, v))));
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

/** Draw a mark: a bar along the bottom of a picture rect (thumbnails) or a ring around a dot (marks). */
export function drawMemberColour(ctx: CanvasRenderingContext2D, colour: string, rect: { x: number; y: number; w: number; h: number } | null, dot: [number, number] | null): void {
  ctx.save();
  if (rect) {
    const y = rect.y + rect.h + 2;
    if (colour === 'missing') {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = THEME.muted;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, y + 0.5, rect.w - 1, 4);
    } else {
      ctx.fillStyle = colour;
      ctx.fillRect(rect.x, y, rect.w, 5);
    }
  }
  if (dot) {
    if (colour === 'missing') {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = THEME.muted;
    } else ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(dot[0], dot[1], 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Legend for the side panel (HTML), so it never covers a map. */
function channelLegendHtml(a: M.Analysis): string {
  if (!opts.colour) return '';
  const st = M.STAT_LABEL[M.state.stat];
  const sw = (c: string, label: string): string => (c === 'missing' ? `<span><i class="miss"></i>${label}</span>` : `<span><i style="background:${c}"></i>${label}</span>`);
  let title: string;
  let items: string[];
  if (opts.colour === 'cursor') {
    const w = M.state.cursor ? (a.set.space.gridToCoord(M.state.cursor) as number[]) : null;
    const { cmap, range } = cursorScale(a);
    title = `Raw ${st} at the cursor${w ? ` (${w.map((v) => fmt(v, 0)).join(', ')} mm)` : ''}, on its own scale up to ±${fmt(range, range >= 10 ? 0 : 1)}`;
    items = [-range, -M.state.thr - 1e-6, M.state.thr + 1e-6, range].map((v) => sw(rgb(cmap.getColor(v)), fmt(v, range >= 10 ? 0 : 1)));
    items.push(sw(THEME.faint, `|${st}| < ${M.state.thr}`), sw('missing', 'no data'));
  } else {
    const field = opts.colour.slice(4);
    const f = covariates?.fields.find((q) => q.name === field);
    title = `${field} from participants.tsv`;
    if (f?.kind === 'numeric') {
      const [lo, hi] = numericRange(field, a.ids);
      items = [0, 0.25, 0.5, 0.75, 1].map((t, i) => sw(SEQUENTIAL(t).hex(), i === 0 ? fmt(lo, 1) : i === 4 ? fmt(hi, 1) : ''));
    } else items = categories(field, a.ids).map((c, i) => sw(CATEGORY_COLOURS[i % CATEGORY_COLOURS.length], c));
    items.push(sw('missing', 'missing'));
  }
  return `<section><h3>Marks</h3><p class="note">${title}. Positions do not change.</p><div class="chan-legend">${items.join('')}</div></section>`;
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
      const focus = new Set([M.state.subject, SV.spaceEnlarged].filter((x): x is string => !!x));
      for (const p of points) {
        const i = idx.get(a.ids[p.member]);
        if (i === undefined) continue;
        const cloud = stab.points[i];
        // Every map faintly; the focused and hovered maps clearly (a tangle of equal ellipses is unreadable).
        const strong = focus.has(a.ids[p.member]);
        ctx.fillStyle = `rgba(${NEUTRAL},${strong ? 0.75 : 0.22})`;
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
          ctx.fillStyle = `rgba(${NEUTRAL},${strong ? 0.12 : 0.03})`;
          ctx.strokeStyle = `rgba(${NEUTRAL},${strong ? 0.9 : 0.3})`;
          ctx.lineWidth = strong ? 1.5 : 1;
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
      const alpha = Math.min(0.5, 0.1 + 0.1 * rel);
      g.addColorStop(0, `rgba(${NEUTRAL},${alpha})`);
      g.addColorStop(1, `rgba(${NEUTRAL},0)`);
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
  const { a, points } = info;
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
  drawRegionOnMean(ctx, a);
}

/** Outline the applied sphere on the Mean reference picture where it cuts the current slice. */
function drawRegionOnMean(ctx: CanvasRenderingContext2D, a: M.Analysis): void {
  const r = opts.region;
  if (!r) return;
  const mean = M.hits.find((h) => h.member === 'mean');
  if (!mean) return;
  const sp = a.set.space.spacing as number[];
  const ax = M.state.orient === 'axial' ? 2 : M.state.orient === 'coronal' ? 1 : 0;
  const dmm = (M.sliceIndex() - r.ijk[ax]) * sp[ax];
  const rr = r.radiusMm * r.radiusMm - dmm * dmm;
  if (rr <= 0) return;
  const rad = Math.sqrt(rr);
  const [col, row] = gridToSlicePixel(a.set.dim, M.state.orient, r.ijk);
  const [cx, cy] = mean.view.toScreen(col, row);
  // Pixel spacing of the two in-plane axes, then screen pixels per mm along each.
  const inPlane = [0, 1, 2].filter((d) => d !== ax);
  const pxPerVoxX = mean.view.dest.w / mean.view.crop.w;
  const pxPerVoxY = mean.view.dest.h / mean.view.crop.h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(mean.view.dest.x, mean.view.dest.y, mean.view.dest.w, mean.view.dest.h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(230,230,239,0.85)';
  ctx.setLineDash([3, 2]);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  // Display x runs along the first in-plane grid axis, y along the second (see sliceGrid).
  ctx.ellipse(cx, cy, (rad / sp[inPlane[0]]) * pxPerVoxX, (rad / sp[inPlane[1]]) * pxPerVoxY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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
        // Select what the user circled: the picture where one is drawn, else the dot.
        if (p.group && p.tx === undefined) continue; // hidden members of an r = 1 group go with their picture
        if (!inside(lasso.pts, p.tx ?? p.sx, p.ty ?? p.sy)) continue;
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
    M.scheduleDraw(true); // the loupe lives on the overlay
    return false; // hover handling continues
  }
  if (type === 'pointerleave' && opts.lens) {
    lensAt = null;
    M.scheduleDraw(true);
    return false;
  }
  return false;
}

export function onKey(e: KeyboardEvent): boolean {
  if (e.altKey || e.metaKey || e.ctrlKey) return false;
  if (e.key === 'l' || e.key === 'L') {
    opts.lens = !opts.lens;
    if (!opts.lens) lensAt = null;
    syncToolbar();
    M.scheduleDraw(true);
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

/** The visible layout's result, when ready (for per-map numbers). */
function visibleOut(a: M.Analysis): EmbedOutput | null {
  const g = SV.spaceGeom;
  return g && g.a === a && g.layout.kind === 'ready' && !opts.trajectories ? g.layout.out : null;
}

/** Layers in use, what they mean, and the focused map's own numbers. */
function layersSection(a: M.Analysis): string {
  const lines: string[] = [];
  const out = visibleOut(a);
  const i = out ? out.result.ids.indexOf(M.state.subject ?? '') : -1;
  const n = out ? out.result.ids.length : 0;
  if (opts.halos) {
    let own = '';
    if (out && i >= 0 && out.result.pairs.distance.length) {
      const shares = stressShares(out.result.pairs.distance, out.result.pairs.disparity, n);
      const rel = shares[i] * n;
      const rank = 1 + Array.from(shares).filter((x) => x > shares[i]).length;
      own = ` <b>${M.state.subject}</b>: ${rel.toFixed(1)}× a typical map's share (rank ${rank} of ${n}).`;
    }
    lines.push(`<b>Fit halos</b>: each map's share of the layout misfit; a larger halo means the 2D picture represents that map less faithfully (a typical map holds 1/n).${own}`);
  }
  if (opts.stability && stab) {
    if (stab.error) lines.push(`<b>Stability</b>: <span class="warnline">${stab.error}</span>`);
    else {
      const blocks = stab.definition.match(/(\d+) blocks/)?.[1];
      let own = '';
      if (stab.spread && i >= 0 && Number.isFinite(stab.spread[i])) {
        const sp = stab.spread;
        const rank = 1 + sp.filter((x) => x > sp[i]).length;
        own = ` <b>${M.state.subject}</b>: spread ${sp[i].toFixed(2)} layout units, rank ${rank} of ${sp.length} (1 = least stable).`;
      }
      lines.push(
        `<b>Stability</b> ${stab.done}/${stab.total}: refits after resampling ${blocks ? `${blocks} ` : ''}12 mm blocks of the compared voxels with replacement, warm-started from this layout and aligned to it. Dots are refits; the ellipse holds about 68%. Tight means the position is carried by much of the compared voxels; loose means it depends on a few blocks. Not a confidence interval for any biological quantity.${own}`
      );
    }
  }
  if (densityOn()) lines.push('<b>Density</b>: contours holding 50 / 80 / 95% of the layout (Gaussian kernel, local bandwidth).');
  if (opts.region) {
    const b = regionBasis(a);
    const here = M.state.cursor && M.state.cursor.join(',') !== opts.region.ijk.join(',');
    lines.push(
      b
        ? `<b>Region</b>: similarity within ${b.params.region}, ${b.support.length.toLocaleString()} voxels (outlined on the Mean picture). Neighbours, agreement and stability use this region; the similarity matrix stays whole-brain. Moving the cursor never refits.${here ? ' <button class="ghost" id="sx-recentre">Re-centre at the cursor</button>' : ''}`
        : '<b>Region</b>: not available.'
    );
  }
  if (animating()) lines.push('Aligned to the previous layout for display (rotation, reflection and scale only).');
  if (opts.lens) lines.push('<b>Magnifier</b>: a 2.2× loupe under the pointer; nothing moves (L closes).');
  return lines.length ? `<section><h3>Layers</h3>${lines.map((l) => `<p class="note">${l}</p>`).join('')}</section>` : '';
}

export function panelHtml(a: M.Analysis): string {
  return channelLegendHtml(a) + agreementSection(a) + subsetSection(a) + acrossContrastsSection(a) + layersSection(a);
}

export function wirePanel(a: M.Analysis): void {
  const rc = M.side.querySelector('#sx-recentre') as HTMLButtonElement | null;
  if (rc)
    rc.onclick = () => {
      if (opts.region && M.state.cursor) opts.region = { ...opts.region, ijk: [...M.state.cursor] as [number, number, number] };
      redraw(false);
    };
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
// Contrasts side by side (V2-08). Every contrast is drawn at the SAME positions: the current contrast's
// layout. A pooled 2D fit over subject x contrast maps was tried and rejected: on real data every map's
// nearest map is the same subject's other contrast, yet two dimensions could not place them nearest
// (it banded maps by contrast), so its lines showed the opposite of the data. The pooled correlations are
// still used, directly, for the "Across contrasts" numbers.

interface Pooled {
  key: string;
  basis: SimilarityBasis;
  subjects: string[];
  contrasts: string[];
  of: { subject: string; contrast: string }[];
}

let pooled: Pooled | null = null;
let pooledPending: Promise<Pooled> | null = null;

/** Kept for callers: the side-by-side view uses the current contrast's own layout options. */
export function pooledOpts(n: number): NmdsOptions {
  return M.layoutOpts(n);
}

/** Side-by-side shows the current contrast's layout, so the probe key is that layout's. */
export function pooledLayoutKey(): string | null {
  return null;
}

export function trajectoryMode(): boolean {
  return opts.trajectories;
}

function sideContrasts(): string[] {
  return [...new Set([M.state.contrast, ...M.state.facets])].slice(0, 4);
}

/** One basis over every subject x contrast map on the voxels all sets share (for the r table only). */
async function pooledBasis(): Promise<Pooled> {
  const contrasts = sideContrasts();
  const list = await Promise.all(contrasts.map((c) => M.getAnalysis(M.state.model, c, M.state.stat)));
  const key = list.map((x) => x.basis.fingerprint).join('|') + `|${contrasts.join(',')}`;
  if (pooled?.key === key) return pooled;
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

/** Draw every contrast at the current layout's positions, one panel each. Fills geom.marks. */
export async function drawTrajectories(ctx: CanvasRenderingContext2D, g: SV.SpaceGeom, plot: PlotRect): Promise<void> {
  const a = g.a;
  const contrasts = sideContrasts();
  const list = await Promise.all(contrasts.map((c) => M.getAnalysis(M.state.model, c, M.state.stat)));
  if (!pooled && !pooledPending) pooledPending = pooledBasis().then((p) => ((pooledPending = null), M.scheduleDraw(), p));
  const b = SV.basisOf(a);
  const ids = b.eligible.map((i) => b.ids[i]);
  const layout = SV.layoutForBasis(b, ids);
  g.layout = layout;
  const message = (text: string, color: string = THEME.muted): void => {
    ctx.fillStyle = color;
    ctx.font = `13px ${FONT.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, plot.x + plot.w / 2, plot.y + plot.h / 2);
  };
  if (layout.kind === 'pending') return message(`Fitting the ${a.contrast} layout…`);
  if (layout.kind === 'none') return message(layout.message, THEME.warn);
  if (layout.kind === 'error') return message(`Layout failed: ${layout.message}. Press R to retry.`, THEME.warn);
  const res = layout.out.result;
  const d = displayCoords(SV.layoutKeyFor(b), ids, Float64Array.from(res.coords));
  const K = list.length;
  const cols = K <= 3 ? K : 2;
  const rows = Math.ceil(K / cols);
  const gap = 14;
  const titleH = 20;
  const pw = (plot.w - gap * (cols - 1)) / cols;
  const ph = (plot.h - gap * (rows - 1)) / rows;
  const asp = M.sliceAspect(a.set);
  const { size, lod } = thumbSize(ids.length, { x: 0, y: 0, w: pw, h: ph - titleH }, M.state.space?.s ?? 1);
  const tw = Math.round(size * Math.sqrt(asp));
  const th = Math.round(size / Math.sqrt(asp));
  const sel = M.state.subject;
  // Positions within a panel: identical in every panel (same transform, same nudges).
  const inner0 = lod === 'thumbs' ? { x: tw / 2, y: titleH + th / 2, w: Math.max(1, pw - tw), h: Math.max(1, ph - titleH - th) } : { x: 12, y: titleH + 10, w: pw - 24, h: ph - titleH - 20 };
  const t0 = spaceTransform(d.coords, inner0, M.state.space);
  const local = ids.map((_, i) => t0.toScreen(d.coords[2 * i], d.coords[2 * i + 1]));
  const placed = lod === 'thumbs' ? declutter(local.map(([x, y]) => ({ x, y })), tw + 4, th + 4, { x: 0, y: titleH, w: pw, h: ph - titleH }, 300, 4) : local.map(([x, y]) => ({ x, y }));
  g.t = null;
  list.forEach((ak, k) => {
    const ox = plot.x + (k % cols) * (pw + gap);
    const oy = plot.y + Math.floor(k / cols) * (ph + gap);
    ctx.save();
    ctx.strokeStyle = THEME.line;
    ctx.strokeRect(ox + 0.5, oy + 0.5, pw - 1, ph - 1);
    ctx.font = `600 11.5px ${FONT.sans}`;
    ctx.fillStyle = ak === a ? THEME.text : THEME.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(ak === a ? `${ak.contrast} · positions from this layout` : ak.contrast, ox + 6, oy + 4);
    ctx.beginPath();
    ctx.rect(ox, oy, pw, ph);
    ctx.clip();
    ids.forEach((id, i) => {
      const [sx, sy] = [ox + local[i][0], oy + local[i][1]];
      const [px, py] = [ox + placed[i].x, oy + placed[i].y];
      const m = ak.ids.indexOf(id);
      const isSel = id === sel;
      if (lod === 'thumbs') {
        if (m < 0) {
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = THEME.muted;
          ctx.strokeRect(px - tw / 2, py - th / 2, tw, th);
          ctx.setLineDash([]);
        } else M.drawCell(ctx, ak, m, { x: px - tw / 2, y: py - th / 2, w: tw, h: th }, null, false, { silhouette: true, crosshair: false });
        if (Math.hypot(px - sx, py - sy) > Math.max(4, tw * 0.2)) {
          ctx.strokeStyle = 'rgba(200,202,220,0.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(Math.max(px - tw / 2, Math.min(px + tw / 2, sx)), Math.max(py - th / 2, Math.min(py + th / 2, sy)));
          ctx.stroke();
          ctx.fillStyle = isSel ? THEME.brand : THEME.text;
          ctx.beginPath();
          ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (isSel || k === 0) {
          ctx.font = `${isSel ? '600 ' : ''}10px ${FONT.mono}`;
          ctx.fillStyle = isSel ? THEME.brand : THEME.muted;
          ctx.textAlign = 'center';
          ctx.fillText(id, px, py + th / 2 + 1);
        }
      } else {
        ctx.fillStyle = isSel ? THEME.brand : THEME.text;
        ctx.beginPath();
        ctx.arc(sx, sy, isSel ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
      const mm = a.ids.indexOf(id);
      if (mm >= 0) g.marks.push({ member: mm, box: lod === 'thumbs' ? { x: px - tw / 2, y: py - th / 2, w: tw, h: th + 12 } : { x: sx - 8, y: sy - 8, w: 16, h: 16 }, kind: lod === 'thumbs' ? 'thumb' : 'dot' });
    });
    ctx.restore();
  });
}

/** For the focused subject: r between its own contrast maps, beside the typical r between subjects. */
function acrossContrastsSection(a: M.Analysis): string {
  if (!opts.trajectories) return '';
  const P = pooled;
  if (!P) return '<section><h3>Across contrasts</h3><p class="note">Computing…</p></section>';
  const b = P.basis;
  const k = b.ids.length;
  const r = (x: string, y: string): number => {
    const i = b.ids.indexOf(x);
    const j = b.ids.indexOf(y);
    return i < 0 || j < 0 ? NaN : b.r[i * k + j];
  };
  // How often is a map's nearest map (by r, among all subject x contrast maps) the same subject's other contrast?
  let same = 0;
  let total = 0;
  for (let i = 0; i < k; i++) {
    if (!b.eligible.includes(i)) continue;
    let best = -Infinity;
    let bj = -1;
    for (let j = 0; j < k; j++) if (j !== i && b.eligible.includes(j) && b.r[i * k + j] > best) [best, bj] = [b.r[i * k + j], j];
    if (bj < 0) continue;
    total++;
    if (P.of[bj].subject === P.of[i].subject) same++;
  }
  const s = M.state.subject;
  const rows: string[] = [];
  const med = (v: number[]): number => {
    const x = v.filter(Number.isFinite).sort((p, q) => p - q);
    return x.length ? (x.length % 2 ? x[x.length >> 1] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2) : NaN;
  };
  for (let p = 0; p < P.contrasts.length; p++)
    for (let q = p + 1; q < P.contrasts.length; q++) {
      const [c1, c2] = [P.contrasts[p], P.contrasts[q]];
      const own = s ? r(`${s}·${c1}`, `${s}·${c2}`) : NaN;
      const others = med(P.subjects.filter((o) => o !== s).map((o) => r(`${s}·${c1}`, `${o}·${c2}`)));
      rows.push(`<tr><td>${c1} × ${c2}</td><td class="num">${M.fmtR(own)}</td><td class="num">${M.fmtR(others)}</td></tr>`);
    }
  return `<section><h3>Across contrasts <span class="sub">${s ?? ''}</span></h3>
    <table class="nb-table"><tr><th>pair</th><th>same subject r</th><th>vs other subjects (median)</th></tr>${rows.join('')}</table>
    <p class="note">Each panel draws one contrast at the ${a.contrast} layout's positions, so a map that changes between contrasts shows a different picture in the same place. Across all ${total} subject × contrast maps, the most similar other map is the same subject's other contrast for <b>${same}</b>. (r on the ${b.support.length.toLocaleString()} voxels every contrast shares.)</p>
  </section>`;
}
