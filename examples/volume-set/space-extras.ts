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
import { spaceTransform, thumbSize, declutter, maxOverlap, zoomAbout, captionCandidates, freeSpot, shortContrastNames, type SpaceTransform, type PlotRect, type Lod, type LabelBox } from './space';
import * as M from './main';
import * as SV from './space-view';
import * as V3 from './space-v3';

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
  /** Explain (Space v3): '' off, else the scope of the explanation. URL `sx`. */
  explain: '' as '' | 'all' | 'focused' | 'group',
  /** Noise-corrected (Spearman) similarity. URL `sn`. */
  noiseCorrected: false,
};

const REGION_RADII = [10, 15, 25];

/** Corrections to Space URL options, announced once the view is up (like the main viewer's). */
const urlNotes: string[] = [];

/** Before the app is up notes are collected (main.ts announces them with its own); afterwards they show at once. */
function announce(note: string): void {
  if ((window as unknown as { __vsReady?: boolean }).__vsReady) M.announceUrl(note);
  else urlNotes.push(note);
}

export function takeUrlNotes(): string[] {
  return urlNotes.splice(0);
}

export function readParams(q: URLSearchParams): void {
  const c = q.get('sc');
  opts.colour = c === 'cursor' || c === 'rel' || (c !== null && /^(cov:[\w.-]{1,40}|parcel:\d{1,6})$/.test(c)) ? c : '';
  if (c !== null && !opts.colour) announce(`colour "${c}" not recognised → none`);
  opts.halos = q.get('sh') === '1';
  opts.stability = q.get('sb') === '1';
  const d = q.get('sd');
  opts.density = d === 'on' || d === 'off' ? d : 'auto';
  const r = q.get('sr')?.split(',').map(Number);
  const okCentre = !!r && r.length === 4 && r.every(Number.isFinite) && r.slice(0, 3).every((v) => Number.isInteger(v) && v >= 0) && r[3] > 0;
  // An unsupported radius snaps to the nearest offered one (said so); a malformed centre falls back to whole brain.
  const radius = okCentre ? REGION_RADII.reduce((best, x) => (Math.abs(x - r![3]) < Math.abs(best - r![3]) ? x : best)) : 0;
  opts.region = okCentre ? { ijk: [r![0], r![1], r![2]], radiusMm: radius } : null;
  if (q.has('sr') && !opts.region) announce(`region "${q.get('sr')}" is not i,j,k,radius → whole brain`);
  else if (opts.region && radius !== r![3]) announce(`region radius ${r![3]} mm → ${radius} mm (offered: ${REGION_RADII.join(', ')} mm)`);
  opts.trajectories = q.get('st') === '1';
  opts.subset = new Set((q.get('ss') ?? '').split(',').filter((x) => /^[\w.-]{1,40}$/.test(x)));
  const cp = q.get('cp');
  opts.compare = cp && /^[\w.-]{1,40}$/.test(cp) ? cp : null;
  const sx = q.get('sx');
  opts.explain = sx === 'all' || sx === 'focused' || sx === 'group' ? sx : '';
  if (sx !== null && !opts.explain) announce(`explain "${sx}" not recognised → off`);
  opts.noiseCorrected = q.get('sn') === '1';
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
  if (opts.explain) q.set('sx', opts.explain);
  if (opts.noiseCorrected) q.set('sn', '1');
}

const SUBSET = '#7ee0a6';
/** Halos and stability use one neutral hue: not a t colour, not the brand, not the cursor cyan. */
const NEUTRAL = '205,208,228';
// Mark colours stay clear of the statistic's ramps (red–orange–yellow positive, blue negative), so a bar
// never reads as a t or β value, and of the pure interaction colours (violet #9b86ff = focus, cyan #22d3ee =
// neighbours and crosshair): analysis layers use desaturated violet and cyan end-points only.
const CATEGORY_COLOURS = ['#7fc8d6', '#e879f9', '#a3e635', '#d4d6e6', '#a99be6', '#94a3b8'];
/** Analysis violet (above / more) and cyan (below), from a dark tone that still shows on the ground to a pale end. */
const ANALYSIS_VIOLET = ['#3a3560', '#6f63b8', '#d9d2ff'];
const ANALYSIS_CYAN = ['#2a4750', '#3a8fa0', '#bfeef7'];
const POS_RAMP = chroma.scale(ANALYSIS_VIOLET).mode('lch');
const NEG_RAMP = chroma.scale(ANALYSIS_CYAN).mode('lch');
/** Sequential analysis ramp (reliability, numeric covariates): 0..1, dark violet to pale violet. */
const SEQUENTIAL = (t: number): chroma.Color => POS_RAMP(Math.max(0, Math.min(1, t)));
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
    .space-tools select.chip { padding: 2px 6px; }
    .space-tools .sm { display: none; }
    .space-tools.compact .lg { display: none; }
    .space-tools.compact .sm { display: inline; }
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
        announce(`${c ? `no "${opts.colour.slice(4)}" column in participants.tsv` : `marks "${opts.colour}" need a participants.tsv, and there is none`} → marks off`);
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
  // Rebuild only when the set of controls changes; otherwise update in place, so a click is never
  // lost to a rebuild between pointer-down and pointer-up.
  const covOpts = (covariates?.fields ?? []).map((f) => `<option value="cov:${f.name}">Mark: ${f.name}${f.kind === 'numeric' ? '' : ' (category)'}</option>`).join('');
  // Covariate options are filled in place (fixed-width select), so their arrival never shifts the chips.
  const structure = `${opts.subset.size > 0}`;
  if (toolbar.dataset.structure !== structure) {
    toolbar.innerHTML = `
    <select class="chip" id="sx-colour" title="Mark each map with a value (a bar under its picture); positions do not change" aria-label="Mark maps by">
    </select>
    ${chip('sx-halos', both('Fit halos', 'Halos', ' (H)'), false, "Halo size = each map's share of the layout misfit")}
    ${chip('sx-stab', 'Stability', false, 'Where each map would sit if blocks of the compared voxels were resampled (block bootstrap)')}
    ${chip('sx-dens', 'Density', false, 'Contours of where maps concentrate in the layout')}
    ${chip('sx-lens', 'Magnifier (L)', false, 'A loupe that magnifies the view under the pointer; nothing moves')}
    ${chip('sx-region', regionLabel(), false, 'Lay out by similarity within a sphere: first click applies 10 mm at the cursor, further clicks widen it (15, 25 mm) and then return to the whole brain')}
    ${chip('sx-traj', both('Contrasts side by side', 'Side by side'), false, 'Show every contrast at the same positions (this layout), one panel per contrast')}
    ${chip('sx-explain', 'Explain', false, 'What drives the layout: the dissimilarity split by voxel and parcel, with the part noise alone would produce')}
    ${chip('sx-noise', 'Correct for noise', false, 'Lay out by noise-corrected similarity (Spearman: r / √(ρᵢρⱼ)); unreliable maps are set aside')}
    ${opts.subset.size ? chip('sx-subset', '', true, 'Clear the selected group (Esc). Shift-drag to add, Shift+Alt-drag to remove', 'subset') : ''}`;
    toolbar.dataset.structure = structure;
    wireToolbar();
  }
  const set = (id: string, pressed: boolean, label?: string): void => {
    const el = toolbar!.querySelector(`#${id}`) as HTMLElement | null;
    if (!el) return;
    el.setAttribute('aria-pressed', String(pressed));
    if (label !== undefined && el.innerHTML !== label) el.innerHTML = label;
  };
  set('sx-halos', opts.halos);
  set('sx-stab', opts.stability);
  set('sx-dens', densityOn());
  set('sx-lens', opts.lens);
  set('sx-region', opts.region !== null, regionLabel());
  set('sx-traj', opts.trajectories);
  set('sx-explain', opts.explain !== '');
  set('sx-noise', opts.noiseCorrected);
  set('sx-subset', true, `Group of ${opts.subset.size} ✕`);
  const sel = toolbar.querySelector('#sx-colour') as HTMLSelectElement;
  const brushed = opts.colour.startsWith('parcel:') ? `<option value="${opts.colour}">Mark: parcel ${opts.colour.slice(7)}</option>` : '';
  const optionsHtml = `<option value="">Mark: none</option><option value="cursor">Mark: value at cursor</option><option value="rel">Mark: reliability</option>${covOpts}${brushed}`;
  if (sel && sel.dataset.options !== optionsHtml) {
    sel.innerHTML = optionsHtml;
    sel.dataset.options = optionsHtml;
  }
  if (sel && sel.value !== opts.colour) sel.value = opts.colour;
  // The select is as wide as the chosen mark (never truncated, never wider than it needs at rest).
  if (sel) {
    const label = sel.selectedOptions[0]?.textContent ?? '';
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = `12px ${FONT.sans}`;
      const w = `${Math.ceil(measureCtx.measureText(label).width) + 34}px`;
      if (sel.style.width !== w) sel.style.width = w;
    }
  }
  // Short chip labels only when the full ones would wrap to a second row (narrow windows).
  const fitKey = `${view.clientWidth}|${toolbar.style.left}|${toolbar.innerHTML.length}|${sel?.style.width}`;
  if (toolbar.dataset.fit !== fitKey) {
    toolbar.dataset.fit = fitKey;
    toolbar.classList.remove('compact');
    const first = toolbar.firstElementChild as HTMLElement | null;
    if (first && toolbar.offsetHeight > first.offsetHeight * 1.5) toolbar.classList.add('compact');
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Full and short forms of a chip label (the short one is shown only in a compact toolbar). */
function both(long: string, short: string, tail = ''): string {
  return `<span class="lg">${long}</span><span class="sm">${short}</span>${tail}`;
}

function regionLabel(): string {
  return opts.region ? both(`Similarity: ${opts.region.radiusMm} mm sphere`, `${opts.region.radiusMm} mm sphere`) : both('Similarity: whole brain', 'Whole brain');
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
  on('sx-explain', () => {
    opts.explain = opts.explain ? '' : 'all';
    redraw(false);
  });
  on('sx-noise', () => {
    opts.noiseCorrected = !opts.noiseCorrected;
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
    const voxels = spherePositions(a, r.ijk, r.radiusMm);
    if (voxels.length === 0) {
      // Off the grid or entirely outside the brain mask: say so rather than "no map can be compared".
      const dim = a.set.dim;
      const off = r.ijk.some((v, d) => v >= dim[d]);
      announce(`region at voxel ${r.ijk.join(',')} ${off ? `is outside the ${dim.join('×')} grid` : `holds no brain voxels within ${r.radiusMm} mm`} → whole brain`);
      opts.region = null;
      M.scheduleDraw();
      return null;
    }
    b = similarityBasis(
      a.set.members.map((m) => m.values),
      a.ids,
      {
        voxels,
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
  if (opts.colour === 'rel') {
    const b = SV.basisOf(a);
    const rel = V3.reliabilityOf(a, opts.noiseCorrected ? (regionBasis(a) ?? a.basis) : b);
    const p = (opts.noiseCorrected ? (regionBasis(a) ?? a.basis) : b).eligible.indexOf(member);
    if (!rel || p < 0) return 'missing';
    return SEQUENTIAL(Math.max(0, Math.min(1, rel.rho[p]))).hex();
  }
  if (opts.colour.startsWith('parcel:')) {
    const pz = brushedValues(a);
    const v = pz?.values.get(member);
    if (v === undefined || !Number.isFinite(v)) return 'missing';
    return brushColour(v, pz!);
  }
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

/**
 * Magnitude of a member's mark as a fraction of the largest (0..1), shown as bar length; null when the channel
 * has no magnitude (only the parcel brush has one: |mean z| from 0 to the largest observed).
 */
export function memberFraction(a: M.Analysis, member: number): number | null {
  if (!opts.colour.startsWith('parcel:')) return null;
  const pz = brushedValues(a);
  const v = pz?.values.get(member);
  return pz && v !== undefined && Number.isFinite(v) ? Math.min(1, Math.abs(v) / pz.range) : null;
}

/**
 * Draw a mark: a bar along the bottom of a picture rect (thumbnails) or a ring around a dot (marks). With
 * `fraction`, the bar is that share of a faint full-width track, so magnitude reads as length.
 */
export function drawMemberColour(
  ctx: CanvasRenderingContext2D,
  colour: string,
  rect: { x: number; y: number; w: number; h: number } | null,
  dot: [number, number] | null,
  fraction: number | null = null
): void {
  ctx.save();
  if (rect) {
    const y = rect.y + rect.h + 2;
    if (colour === 'missing') {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = THEME.muted;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, y + 0.5, rect.w - 1, 4);
    } else if (fraction !== null) {
      ctx.fillStyle = `rgba(${NEUTRAL},0.14)`;
      ctx.fillRect(rect.x, y, rect.w, 5);
      ctx.fillStyle = colour;
      ctx.fillRect(rect.x, y, Math.max(1, rect.w * fraction), 5);
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

interface Brushed {
  values: Map<number, number>;
  /** Largest |value| observed (bar length 1). */
  range: number;
  /** Smallest |value| observed. */
  lo: number;
  /** 'pos' or 'neg' when every value has that sign, else 'mixed'. */
  sign: 'pos' | 'neg' | 'mixed';
}

let brushCache: (Brushed & { key: string }) | null = null;

/** Each placed map's mean z in the brushed parcel (atlas permitting). */
function brushedValues(a: M.Analysis): Brushed | null {
  if (opts.colour.startsWith('parcel:')) ensureAtlas(); // a brushed link may arrive without Explain
  const sa = atlasNow;
  if (!sa || !opts.colour.startsWith('parcel:')) return null;
  const id = Number(opts.colour.slice(7));
  const b = SV.basisOf(a);
  const key = `${b.key}|${id}`;
  if (!brushCache || brushCache.key !== key) {
    const values = V3.parcelMeanZ(a, b, sa, id);
    let mx = 0;
    let mn = Infinity;
    let pos = 0;
    let neg = 0;
    for (const v of values.values()) {
      if (!Number.isFinite(v)) continue;
      mx = Math.max(mx, Math.abs(v));
      mn = Math.min(mn, Math.abs(v));
      if (v > 0) pos++;
      else if (v < 0) neg++;
    }
    // The observed range, not a rounded-up one, so the most extreme maps reach the ends of the ramp.
    brushCache = { key, values, range: mx || 1, lo: Number.isFinite(mn) ? mn : 0, sign: neg === 0 && pos > 0 ? 'pos' : pos === 0 && neg > 0 ? 'neg' : 'mixed' };
  }
  return brushCache;
}

/**
 * Brushed-parcel mark colour: violet above 0, cyan below, lighter with |value|. With both signs present the
 * lightness runs from 0 to the largest |value| on each side (sign-symmetric); when every value has one sign, it
 * spans that side's full lightness range from the smallest to the largest |value| observed.
 */
function brushColour(v: number, pz: Pick<Brushed, 'range' | 'lo' | 'sign'>): string {
  const m = Math.min(pz.range, Math.abs(v));
  const t = pz.sign === 'mixed' ? m / pz.range : pz.range > pz.lo ? (m - pz.lo) / (pz.range - pz.lo) : 1;
  return (v < 0 ? NEG_RAMP : POS_RAMP)(Math.max(0, Math.min(1, t))).hex();
}

/** The parcellation, once loaded (null until then or when the data has none). */
let atlasNow: V3.SpaceAtlas | null = null;
let atlasRequested = false;
function ensureAtlas(): void {
  if (atlasRequested) return;
  atlasRequested = true;
  void V3.loadSpaceAtlas().then((sa) => {
    atlasNow = sa;
    // A brushed parcel from a link must exist in this parcellation.
    if (opts.colour.startsWith('parcel:')) {
      const id = Number(opts.colour.slice(7));
      if (!sa || !sa.atlas.regions.get(id)) {
        announce(sa ? `no parcel ${id} in ${sa.name} → marks off` : `parcel marks need a parcellation, and none is served → marks off`);
        opts.colour = '';
        if (M.state.mode === 'space') syncToolbar();
      }
    }
    M.scheduleDraw();
  });
}

/** Legend for the side panel (HTML), so it never covers a map. */
function channelLegendHtml(a: M.Analysis): string {
  if (!opts.colour) return '';
  if (opts.colour === 'rel' || opts.colour.startsWith('parcel:')) {
    const sw = (c: string, label: string): string => `<span><i style="background:${c}"></i>${label}</span>`;
    if (opts.colour === 'rel')
      return `<section><h3>Marks</h3><p class="note">Reliability ρ: the share of each map's spatial variance that is not noise (${M.state.stat === 't' ? 't-maps: noise variance ≈ 1 per voxel' : 'β-maps: noise variance = SE²'}). Maps with low ρ correlate weakly with everyone and drift to the edge of a layout for that reason alone.</p><div class="chan-legend">${[0, 0.25, 0.5, 0.75, 1].map((t) => sw(SEQUENTIAL(t).hex(), M.fmtR(t))).join('')}</div></section>`;
    const pz = brushedValues(a);
    const id = Number(opts.colour.slice(7));
    if (!pz) return '';
    const { range, lo, sign } = pz;
    const digits = range >= 10 ? 0 : range >= 1 ? 1 : 2;
    const what = `Each map's mean z in <b>${atlasNow?.label(id) ?? `parcel ${id}`}</b> (z: the map standardised over the compared voxels).`;
    const length = `Bar length: |mean z| from 0 (no bar) to the largest, ${fmt(range, digits)}.`;
    if (sign !== 'mixed') {
      // One sign: the colour spans that side's whole ramp, from the smallest to the largest |mean z| observed.
      const s0 = sign === 'pos' ? 1 : -1;
      const stops = [lo, (lo + range) / 2, range].map((m) => s0 * m);
      return `<section><h3>Marks</h3><p class="note">${what} <b>All ${sign === 'pos' ? 'positive' : 'negative'}</b>: colour runs from the smallest |mean z| observed (${fmt(lo, digits)}) to the largest (${fmt(range, digits)}). ${length} Positions do not change.</p><div class="chan-legend">${stops.map((v) => sw(brushColour(v, pz), fmt(v, digits))).join('')}</div></section>`;
    }
    return `<section><h3>Marks</h3><p class="note">${what} Violet above 0, cyan below; colour lightens with |mean z| up to the largest observed, the same on both sides. ${length} Positions do not change.</p><div class="chan-legend">${[-range, -range / 2, range / 2, range].map((v) => sw(brushColour(v, pz), fmt(v, digits))).join('')}</div></section>`;
  }
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
  drawNoiseYardstick(ctx, info);
  drawCovariateArrows(ctx, info);
}

/** Screen pixels per unit of the fit's canonical coordinates. */
function pxPerUnit(info: LayerInfo): number {
  return info.t.scale * info.d.scale;
}

/**
 * The noise yardstick: how far apart two noisy copies of the same map would sit (median pair), read off the
 * fit's own monotone (or metric) relation between 1 − r and layout distance. When that 1 − r is below every
 * observed pair (typical: real maps differ by far more than noise), the length is extrapolated and labelled so.
 */
function drawNoiseYardstick(ctx: CanvasRenderingContext2D, info: LayerInfo): void {
  if (!(opts.explain || opts.colour === 'rel' || opts.noiseCorrected)) return;
  // On a noise-corrected layout two noisy copies of one map have corrected r = 1, i.e. distance 0: no yardstick.
  if (SV.isCorrected(info.a)) return;
  const rel = V3.reliabilityOf(info.a, regionBasis(info.a) ?? info.a.basis);
  if (!rel) return;
  const d0 = V3.noiseYardstick(rel);
  const { dissimilarity: ds, disparity: dp } = info.out.result.pairs;
  if (!Number.isFinite(d0) || !ds.length) return;
  // Disparity at dissimilarity d0 by linear interpolation over the sorted pairs.
  const idx = [...ds.keys()].sort((x, y) => ds[x] - ds[y]);
  let units = NaN;
  if (d0 <= ds[idx[0]]) units = (dp[idx[0]] * d0) / Math.max(1e-12, ds[idx[0]]);
  else if (d0 >= ds[idx[idx.length - 1]]) units = dp[idx[idx.length - 1]];
  else
    for (let q = 1; q < idx.length; q++) {
      const [x0, x1] = [ds[idx[q - 1]], ds[idx[q]]];
      if (d0 <= x1) {
        const f = x1 > x0 ? (d0 - x0) / (x1 - x0) : 0;
        units = dp[idx[q - 1]] + f * (dp[idx[q]] - dp[idx[q - 1]]);
        break;
      }
    }
  const len = units * pxPerUnit(info);
  if (!(len > 1)) return;
  ctx.save();
  ctx.font = `11px ${FONT.sans}`;
  // Below the smallest observed pair the length is a straight-line extrapolation to zero, not a reading of the fit: say so.
  const lo = ds[idx[0]];
  const label =
    d0 < lo
      ? `noise alone: 1 − r ≈ ${M.fmtR(d0)}, below every pair (min ${M.fmtR(lo)}); length extrapolated`
      : `noise alone: two copies of one map, 1 − r ≈ ${M.fmtR(d0)}, would sit about this far apart`;
  // Label above the bar, as one block placed where it covers no picture, mark or ID.
  const box = placeCaption(info.plot, Math.max(len, ctx.measureText(label).width) + 8, 26);
  const x = box.x + 4;
  const y = box.y + 20;
  ctx.fillStyle = 'rgba(13,14,20,0.82)';
  ctx.fillRect(box.x, box.y, box.w, 15);
  ctx.strokeStyle = `rgba(${NEUTRAL},0.9)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + len, y - 4);
  ctx.lineTo(x + len, y + 4);
  ctx.stroke();
  ctx.fillStyle = THEME.muted;
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, x, box.y + 14);
  ctx.restore();
}

/**
 * A free spot for a w × h caption inside the plot (see captionCandidates for the order of preference): it
 * avoids every picture, exact-position mark, ID label and earlier caption, and is recorded so later captions
 * and the floating preview avoid it too.
 */
function placeCaption(plot: PlotRect, w: number, h: number, near: LabelBox[] | null = null): LabelBox {
  const g = SV.spaceGeom;
  const obstacles: LabelBox[] = [...(g?.marks.map((mk) => mk.box) ?? []), ...(g?.captions ?? [])];
  const candidates = near ?? captionCandidates(plot, w, h);
  const box = candidates[Math.max(0, freeSpot(candidates, obstacles))];
  g?.captions?.push(box);
  return box;
}

/** Label beside a point (right, left, above, below), kept inside the plot. */
function besidePoint(plot: PlotRect, px: number, py: number, w: number, h: number): LabelBox[] {
  const fit = (x: number, y: number): LabelBox => ({
    x: Math.max(plot.x, Math.min(plot.x + plot.w - w, x)),
    y: Math.max(plot.y, Math.min(plot.y + plot.h - h, y)),
    w,
    h,
  });
  return [fit(px + 8, py - h / 2), fit(px - 8 - w, py - h / 2), fit(px - w / 2, py - 10 - h), fit(px - w / 2, py + 10)];
}

/** envfit-style arrows (numeric covariates) or centroids (categories) for the Marked covariate. */
function drawCovariateArrows(ctx: CanvasRenderingContext2D, info: LayerInfo): void {
  if (!opts.colour.startsWith('cov:') || !covariates) return;
  const field = opts.colour.slice(4);
  const f = covariates.fields.find((x) => x.name === field);
  if (!f) return;
  const ids = info.out.result.ids;
  const values = ids.map((id) => covariates!.values.get(id)?.[field] ?? null);
  const fit = V3.covariateFit(info.key, Float64Array.from(info.out.result.coords), field, f.kind, values);
  lastFit = fit;
  const toScreen = (x: number, y: number): [number, number] => {
    const [dx, dy] = toDisplayed(info.d, x, y);
    return info.t.toScreen(dx, dy);
  };
  ctx.save();
  ctx.font = `600 11px ${FONT.sans}`;
  ctx.textBaseline = 'middle';
  if (fit.kind === 'numeric' && fit.direction) {
    // Centre on the layout's centroid; rotate the canonical direction into the displayed frame.
    let cx = 0;
    let cy = 0;
    const c = info.out.result.coords;
    for (let i = 0; i < c.length; i += 2) {
      cx += c[i];
      cy += c[i + 1];
    }
    cx /= c.length / 2;
    cy /= c.length / 2;
    const [sx, sy] = toScreen(cx, cy);
    const [ex, ey] = toScreen(cx + fit.direction[0], cy + fit.direction[1]);
    const ux = ex - sx;
    const uy = ey - sy;
    const nrm = Math.hypot(ux, uy) || 1;
    const L = 0.35 * Math.min(info.plot.w, info.plot.h) * Math.sqrt(Math.max(0, fit.r2));
    const [tx, ty] = [sx + (ux / nrm) * L, sy + (uy / nrm) * L];
    ctx.strokeStyle = THEME.text;
    ctx.fillStyle = THEME.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    const ang = Math.atan2(ty - sy, tx - sx);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - 9 * Math.cos(ang - 0.4), ty - 9 * Math.sin(ang - 0.4));
    ctx.lineTo(tx - 9 * Math.cos(ang + 0.4), ty - 9 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    const label = `${field} ↑  R² ${M.fmtR(fit.r2)}, p ${fit.p < 0.001 ? '< .001' : M.fmtR(fit.p)}`;
    const lb = placeCaption(info.plot, 0, 0, besidePoint(info.plot, tx, ty, ctx.measureText(label).width + 8, 16));
    ctx.fillStyle = 'rgba(13,14,20,0.85)';
    ctx.fillRect(lb.x, lb.y, lb.w, lb.h);
    ctx.fillStyle = THEME.text;
    ctx.fillText(label, lb.x + 4, lb.y + 8);
  } else if (fit.centroids) {
    for (const cen of fit.centroids) {
      const [x, y] = toScreen(cen.x, cen.y);
      ctx.strokeStyle = THEME.text;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + 6, y);
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x, y + 6);
      ctx.stroke();
      const label = `${cen.level} (${cen.n})`;
      const lb = placeCaption(info.plot, 0, 0, besidePoint(info.plot, x, y, ctx.measureText(label).width + 8, 16));
      ctx.fillStyle = 'rgba(13,14,20,0.85)';
      ctx.fillRect(lb.x, lb.y, lb.w, lb.h);
      ctx.fillStyle = THEME.text;
      ctx.fillText(label, lb.x + 4, lb.y + 8);
    }
  }
  ctx.restore();
}

let lastFit: V3.CovariateFit | null = null;

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
  if (type === 'wheel' && opts.trajectories && (e.ctrlKey || e.metaKey)) return trajectoryZoom(e as WheelEvent);
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
/** The scope Explain uses now (falling back to all maps when the requested scope is unavailable). */
function explainScope(a: M.Analysis, b: SimilarityBasis): V3.ExplainScope {
  if (opts.explain === 'focused') {
    const m = M.selectedMember(a);
    if (m !== undefined && b.eligible.includes(m)) return { kind: 'focused', member: m };
  }
  if (opts.explain === 'group') {
    const A = b.eligible.filter((i) => opts.subset.has(a.ids[i]));
    const B = b.eligible.filter((i) => !opts.subset.has(a.ids[i]));
    if (A.length && B.length) return { kind: 'group', a: A, b: B };
  }
  return { kind: 'all' };
}

function currentExplain(a: M.Analysis): V3.ExplainResult | null {
  if (!opts.explain || opts.trajectories) return null;
  ensureAtlas();
  const b = SV.basisOf(a);
  return V3.explain(a, b, explainScope(a, b), atlasNow);
}

/** Explain colours: never red/blue, which mean the t/β statistic. Violet ramp from the page ground for amounts. */
const EXPLAIN_SEQ = chroma.scale([THEME.bg, ANALYSIS_VIOLET[1], ANALYSIS_VIOLET[2]]).mode('lab');
/** Signed departures: cyan (below) ↔ neutral dark ↔ violet (above), symmetric. */
const EXPLAIN_DIV = chroma.scale([ANALYSIS_CYAN[2], ANALYSIS_CYAN[1], '#1c1d27', ANALYSIS_VIOLET[1], ANALYSIS_VIOLET[2]]).domain([-1, -0.5, 0, 0.5, 1]).mode('lab');
/** Signed pictures hide |value| below this fraction of the scale. */
const EXPLAIN_DIV_HIDE = 0.08;

/** Per Explain picture: the colour scale end (99.5th percentile of |value| over the support) and the mean value. */
const pictureScale = new Map<string, { range: number; mean: number }>();

function explainPictureScale(ex: V3.ExplainResult): { range: number; mean: number } {
  let s = pictureScale.get(ex.key);
  if (!s) {
    const abs: number[] = [];
    let sum = 0;
    for (let m = 0; m < ex.picture.length; m++) {
      const v = ex.picture[m];
      if (!Number.isFinite(v)) continue;
      abs.push(Math.abs(v));
      sum += v;
    }
    abs.sort((x, y) => x - y);
    s = { range: abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.995))] || 1e-9, mean: abs.length ? sum / abs.length : NaN };
    if (pictureScale.size > 24) pictureScale.clear();
    pictureScale.set(ex.key, s);
  }
  return s;
}

/** The Explain picture in the dock: the signed difference map, or the per-voxel term (beyond noise when known). */
function drawExplainDock(ctx: CanvasRenderingContext2D, g: SV.SpaceGeom): boolean {
  const a = g.a;
  const ex = currentExplain(a);
  if (!ex || !g.dock) return false;
  const { range, mean } = explainPictureScale(ex);
  const asp = M.sliceAspect(a.set);
  const w = g.dock.w;
  const h = Math.round(w / asp);
  const x0 = g.dock.x;
  let y = g.dock.y;
  ctx.save();
  ctx.font = `600 11px ${FONT.sans}`;
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (const line of wrapLines(ctx, ex.title, w)) {
    ctx.fillText(line, x0, y);
    y += 14;
  }
  y += 4;
  const v = placeCrop(M.cropWindow(a.set), { x: x0, y, w, h });
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(v.dest.x, v.dest.y, v.dest.w, v.dest.h);
  const slice = a.set.slice(ex.picture, M.state.orient, M.sliceIndex());
  const img = new ImageData(slice.width, slice.height);
  for (let q = 0; q < slice.data.length; q++) {
    const val = slice.data[q];
    if (!Number.isFinite(val)) continue;
    let c: number[];
    let alpha: number;
    if (ex.signed) {
      const t = Math.max(-1, Math.min(1, val / range));
      if (Math.abs(t) < EXPLAIN_DIV_HIDE) continue;
      c = EXPLAIN_DIV(t).rgb();
      alpha = 1;
    } else {
      const t = Math.max(0, Math.min(1, val / range));
      if (t < 0.04) continue;
      c = EXPLAIN_SEQ(t).rgb();
      alpha = 0.35 + 0.65 * t;
    }
    img.data.set([c[0], c[1], c[2], alpha * 255], q * 4);
  }
  const oc = document.createElement('canvas');
  oc.width = slice.width;
  oc.height = slice.height;
  oc.getContext('2d')!.putImageData(img, 0, 0);
  drawCellImage(ctx, M.underSilhouette(a), oc, v);
  y = v.dest.y + v.dest.h + 6;
  // Legend bar drawn from the same ramp as the picture, with its end values.
  const bar = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  for (let s = 0; s <= 8; s++) bar.addColorStop(s / 8, (ex.signed ? EXPLAIN_DIV(-1 + s / 4) : EXPLAIN_SEQ(s / 8)).hex());
  ctx.fillStyle = bar;
  ctx.fillRect(x0, y, w, 7);
  // The band the picture leaves undrawn (|value| under the hide fraction) is left empty in the legend too.
  if (ex.signed) ctx.clearRect(x0 + (w / 2) * (1 - EXPLAIN_DIV_HIDE), y, w * EXPLAIN_DIV_HIDE, 7);
  y += 9;
  ctx.font = `10px ${FONT.mono}`;
  ctx.fillStyle = THEME.muted;
  if (ex.signed) {
    ctx.fillText(`−${fmt(range)}`, x0, y);
    ctx.textAlign = 'center';
    ctx.fillText('0', x0 + w / 2, y);
    ctx.textAlign = 'right';
    ctx.fillText(`+${fmt(range)}`, x0 + w, y);
  } else {
    ctx.fillText('0', x0, y);
    ctx.textAlign = 'right';
    ctx.fillText(Number.isFinite(mean) && mean > 0 ? `${(range / mean).toFixed(1)}× average voxel` : fmt(range, 3), x0 + w, y);
  }
  ctx.textAlign = 'left';
  y += 14;
  ctx.font = `10.5px ${FONT.sans}`;
  const legend = ex.signed
    ? ex.scope.kind === 'focused'
      ? `z difference, not t. Violet: ${a.ids[ex.scope.member]} above the others' mean; cyan: below.`
      : "z difference, not t. Violet: group mean above the rest's; cyan: below."
    : ex.noiseShare !== null
      ? 'Brighter: more of the total pairwise 1 − r beyond noise.'
      : 'Brighter: more of the total pairwise 1 − r.';
  // The dock's caption room is small; drop lines that would fall off the canvas (the panel repeats them).
  const bottom = ctx.canvas.clientHeight - 2;
  for (const line of wrapLines(ctx, legend, w)) {
    if (y + 12 > bottom) break;
    ctx.fillText(line, x0, y);
    y += 13;
  }
  ctx.restore();
  return true;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export function drawDock(ctx: CanvasRenderingContext2D, g: SV.SpaceGeom): boolean {
  profileHit = null;
  if (!opts.compare && opts.explain && !opts.trajectories) return drawExplainDock(ctx, g);
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

/** Percent with two significant figures (1.9%, 0.95%, 0.090%; whole numbers from 10%). */
const pct = (x: number | null): string => {
  if (x === null || !Number.isFinite(x)) return '–';
  const v = x * 100;
  return `${Math.abs(v) >= 10 || v === 0 ? v.toFixed(0) : v.toPrecision(2)}%`;
};
/** Ratios to a reference (×size, ×typical): two decimals below 10. */
const times = (x: number): string => (Number.isFinite(x) ? `${x < 10 ? x.toFixed(2) : x.toFixed(1)}×` : '–');

/** Open/closed state of the panel's "What this shows" disclosures, kept across panel rebuilds. */
const foldOpen = new Set<string>();
let foldWired = false;

function fold(key: string, body: string): string {
  if (!foldWired) {
    foldWired = true;
    // `toggle` does not bubble; listen in the capture phase on the panel that is rebuilt underneath.
    M.side.addEventListener(
      'toggle',
      (e) => {
        const d = e.target;
        if (d instanceof HTMLDetailsElement && d.dataset.fold) (d.open ? foldOpen.add(d.dataset.fold) : foldOpen.delete(d.dataset.fold));
      },
      true
    );
  }
  return `<details class="fit-details" data-fold="${key}"${foldOpen.has(key) ? ' open' : ''}><summary>What this shows</summary>${body}</details>`;
}

/** Parcel cell: one-line abbreviation, cut with an ellipsis when the column is narrow; full name in the tooltip. */
const parcelCell = (p: { id: number; name: string; short: string }, extra = ''): string =>
  `<td style="overflow:hidden"><button data-parcel="${p.id}" title="${p.name}${extra}. Click to mark maps by this parcel and go to it." style="display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left">${p.short}</button></td>`;

/**
 * A table that always fits the side column: fixed layout at 100% width, the numeric columns at fixed
 * widths (em), the first column takes what is left (its cells ellipsise; see parcelCell).
 */
function fitTable(heads: string[], widthsEm: number[], rows: string): string {
  return `<table class="nb-table" style="table-layout:fixed;width:100%;white-space:nowrap"><colgroup><col>${widthsEm.map((w) => `<col style="width:${w}em">`).join('')}</colgroup><tr>${heads.join('')}</tr>${rows}</table>`;
}

/** ρ below this: most of a map's spatial variance is measurement noise (ρ = signal ÷ total variance). */
const LOW_RHO = 0.5;

/** Visible warning above the Focused table when the focused map is unreliable, or its reliability unknown. */
function reliabilityWarning(a: M.Analysis, b: SimilarityBasis, member: number, noiseTop: number): string {
  const id = a.ids[member];
  const rel = member >= 0 ? V3.reliabilityOf(a, b) : null;
  if (!rel) return `<p class="note warnline">Reliability of ${id} is not known yet (β-maps: waiting for SE), so this list cannot yet be judged against noise.</p>`;
  const rho = rel.rho[b.eligible.indexOf(member)];
  if (!Number.isFinite(rho)) return `<p class="note warnline">Reliability of ${id} could not be estimated, so this list cannot be judged against noise.</p>`;
  if (rho >= LOW_RHO) return '';
  return `<p class="note warnline">ρ ${M.fmtR(rho)}: most of ${id}'s spatial variance (${pct(1 - Math.max(0, rho))}) is measurement noise, so this list may largely reflect noise; compare reliable maps. A pure-noise map already reaches ${times(noiseTop)}.</p>`;
}

function explainSection(a: M.Analysis): string {
  if (!opts.explain || opts.trajectories) return '';
  const ex = currentExplain(a);
  const b = SV.basisOf(a);
  const scopeBtn = (v: 'all' | 'focused' | 'group', label: string, disabled: boolean): string =>
    `<button class="ghost" data-scope="${v}" aria-pressed="${opts.explain === v}"${disabled ? ' disabled title="Select a map (focused) or Shift-drag a group first"' : ''}>${label}</button>`;
  const hasFocus = M.selectedMember(a) !== undefined && b.eligible.includes(M.selectedMember(a)!);
  const scopes = `<div id="space-actions">${scopeBtn('all', 'All maps', false)}${scopeBtn('focused', 'Focused', !hasFocus)}${scopeBtn('group', 'Group', opts.subset.size === 0)}</div>`;
  if (!ex)
    return `<section><h3>Explain</h3>${scopes}<p class="note">${b.eligible.length > V3.EXPLAIN_MAX_MAPS ? `Explain runs on up to ${V3.EXPLAIN_MAX_MAPS} maps in this browser view (${b.eligible.length} placed).` : 'Needs at least two comparable maps.'}</p></section>`;
  const k = b.eligible.length;
  const focusId = ex.scope.kind === 'focused' ? a.ids[ex.scope.member] : '';
  // Under noise correction the layout uses r ÷ √(ρᵢρⱼ); Explain decomposes plain r over the same maps.
  const corrected = SV.isCorrected(a);
  const rawNote = corrected
    ? `<p class="note">Computed on raw r over the ${k} maps in the noise-corrected layout; the corrected r ÷ √(ρᵢρⱼ) that places them is not decomposed.</p>`
    : '';
  const formula =
    ex.scope.kind === 'all'
      ? '(k/2N)·Σᵢ(zᵢ − z̄)², the spread of the maps at the voxel,'
      : ex.scope.kind === 'focused'
        ? `(1/2N)·mean over the other maps j of (z<sub>${focusId}</sub> − zⱼ)²`
        : '(1/2N)·mean over group map a and other map b of (z<sub>a</sub> − z<sub>b</sub>)²';
  const prose: string[] = [
    `The per-voxel term ${formula} sums exactly to the ${ex.totalLabel} (${ex.total.toFixed(3)}) over the ${b.support.length.toLocaleString()} compared voxels (N); a parcel's share is its part of that sum. Maps are z-scored over those voxels, so this explains differences in spatial pattern, not overall amplitude. Descriptive: voxels are spatially correlated, and the layout was built from these same voxels.`,
  ];
  if (ex.noiseShare !== null)
    prose.push(
      `About <b>${pct(ex.noiseShare)}</b> of the total is what independent measurement noise alone would produce (${M.state.stat === 't' ? 'unit noise per voxel in a t-map' : 'from each map’s SE'}); the picture and the &gt;noise column show the part beyond it (hover a parcel for its share of the voxels and ×size, share ÷ that). Maps that differ in reliability add a little more on top of that, so treat the remainder as an upper bound on true pattern differences.`
    );
  const sc = explainPictureScale(ex);
  prose.push(
    ex.signed
      ? `Picture: ${ex.scope.kind === 'focused' ? `z<sub>${focusId}</sub> − the mean z of the other maps` : 'the group’s mean z − the rest’s'} on this slice, in z units (each map z-scored over the compared voxels), not a t statistic. Violet above, cyan below; the scale ends at ±${fmt(sc.range)}, the 99.5th percentile of |value|, and |value| under ${fmt(sc.range * EXPLAIN_DIV_HIDE)} is not drawn.${ex.scope.kind === 'focused' ? ' It includes divergence that every map shows; the ×typical column corrects for that, the picture does not.' : ''}`
      : `Picture: the per-voxel term${ex.noiseShare !== null ? ' minus the noise floor' : ''} on this slice; the scale ends at the 99.5th percentile, ${Number.isFinite(sc.mean) && sc.mean > 0 ? `${(sc.range / sc.mean).toFixed(1)}× the average voxel` : fmt(sc.range, 3)}.`
  );
  let tables = '';
  let key = '';
  if (!atlasNow) tables = '<p class="note">No parcellation is available for this template, so only the voxel picture is shown.</p>';
  else if (ex.focus) {
    const f = ex.focus;
    const rows = f.rows
      .slice(0, 8)
      .map((r) => `<tr>${parcelCell(r)}<td class="num">${pct(r.share)}</td><td class="num">${times(r.excess)}</td><td class="num">${r.rank}</td></tr>`)
      .join('');
    const warning = reliabilityWarning(a, b, ex.scope.kind === 'focused' ? ex.scope.member : -1, f.noiseTop);
    tables =
      warning +
      fitTable(
        [
          '<th>parcel</th>',
          `<th title="${focusId}'s share of its own mean 1 − r to the others">share</th>`,
          `<th title="share ÷ the median share of all ${f.of} maps in this parcel">×typical</th>`,
          `<th title="${focusId}'s share among the ${f.of} maps (1 = largest)">rank/${f.of}</th>`,
        ],
        [4, 4.2, 3.6],
        rows
      );
    key = `<p class="note">Ranked by ×typical: ${focusId}'s share ÷ the median of all ${f.of} maps' own shares in that parcel. rank: 1 = the largest share of the ${f.of}.${warning ? '' : ` A map of pure independent noise reaches ${times(f.noiseTop)}.`}</p>`;
    prose.push(
      `Every map's share is largest where all maps diverge from one another, so raw shares rank nearly the same parcels for every map. ×typical corrects for that common part: each of the ${f.of} maps' focused terms is summed in the parcel and divided by that map's own total; ×typical is ${focusId}'s value ÷ the median of the ${f.of} values (1× = like the typical map, 2× = twice its share). Parcels with fewer than ${f.minN} compared voxels show –.`,
      `<b>Caution.</b> ×typical has no noise model: it compares shares, whatever produced them. A large ratio on a tiny share (well under 1% of the total) or in a low-signal parcel (e.g. temporal pole or orbitofrontal cortex, where signal drops out) deserves caution, and for a map with low reliability ρ the whole list can be mostly noise. Noise reference: a map of independent N(0, 1) noise at every compared voxel, added to these ${f.of} maps as one more, reaches ${times(f.noiseTop)} at its top parcel (median of ${f.noiseDraws} seeded draws). Real measurement noise is spatially smooth and reaches higher ratios, so treat that value as a floor for what noise can produce, not as a significance threshold.`
    );
  } else if (ex.parcels) {
    // Four columns fit the panel: with a noise floor, the beyond-noise share replaces ×size (kept in the tooltip).
    const withNoise = ex.noiseShare !== null;
    const size = (p: { share: number; sizeShare: number }): string => (p.sizeShare > 0 ? times(p.share / p.sizeShare) : '–');
    const rows = ex.parcels
      .slice(0, 8)
      .map(
        (p) =>
          `<tr>${parcelCell(p, `: ${pct(p.sizeShare)} of the compared voxels, share ÷ that = ${size(p)}`)}<td class="num">${pct(p.share)}</td><td class="num">${withNoise ? pct(p.beyondNoise) : size(p)}</td><td class="num">${p.i2 === null ? '…' : M.fmtR(p.i2)}</td></tr>`
      )
      .join('');
    tables = fitTable(
      [
        '<th>parcel</th>',
        `<th title="share of the ${ex.totalLabel}">share</th>`,
        withNoise ? '<th title="share of the part beyond the noise floor">&gt;noise</th>' : `<th title="share ÷ the parcel's share of the compared voxels (1× = proportional to size)">×size</th>`,
        '<th title="heterogeneity of the parcel-mean β across maps">I²</th>',
      ],
      [4, 4, 2.4],
      rows
    );
    key = `<p class="note">${withNoise ? '&gt;noise: share of the part beyond the noise floor.' : '×size: share ÷ share of voxels (1× = proportional to size).'} I²: β heterogeneity.</p>`;
    prose.push(ex.heterogeneityNote ?? 'I² loads with β and SE…');
  }
  if (atlasNow && (ex.focus || ex.parcels)) {
    const c = ex.concentration;
    prose.push(
      `${c && ex.focus ? `Ranked by raw share instead (not the order of the table above), the ${c.topK} parcels with the largest share of ${focusId}'s total carry <b>${pct(c.topShare)}</b> of it while holding ${pct(c.sizeShare)} of the voxels. ` : ''}${c && !ex.focus ? `The ${c.topK} parcels with the largest share carry <b>${pct(c.topShare)}</b> of the total while holding ${pct(c.sizeShare)} of the voxels${c.randomSplit !== null ? `; random splits of the same sizes give ${pct(c.randomSplit)}, so compare against that, not against zero` : ''}. ` : ''}${pct(ex.outsideShare)} falls outside the parcellation${(atlasNow?.name ?? '').startsWith('Schaefer') ? ' (Schaefer covers cortex only)' : ''}.`
    );
  }
  if (atlasNow && ex.influence?.length) {
    tables += `${key}<h3 style="margin-top:10px">${corrected ? 'Raw 1 − r depends most on' : 'Layout depends most on'}</h3>${fitTable(
      ['<th>parcel</th>', '<th title="(1 − Mantel r) × 1000">change ‰</th>'],
      [5],
      ex.influence
        .slice(0, 5)
        .map((x) => `<tr>${parcelCell(x)}<td class="num">${fmtPermille(1 - x.mantel)}</td></tr>`)
        .join('')
    )}`;
    key = `<p class="note">change: 1 − r between all pairwise ${corrected ? 'raw ' : ''}1 − r with and without the parcel, in thousandths.${corrected ? ' Raw r, not the corrected r of the layout.' : ''}</p>`;
    prose.push(
      'Layout dependence: every pairwise 1 − r is recomputed exactly without the parcel (no refit) and correlated with the full set; the table shows 1 − that correlation in thousandths. Larger means the layout leans on the parcel more. Share and dependence differ: a parcel can carry variance without changing who resembles whom.'
    );
  }
  return `<section><h3>Explain <span class="sub">${ex.totalLabel}</span></h3>${scopes}${rawNote}
    ${tables}${key}${fold('explain', prose.map((p) => `<p class="note">${p}</p>`).join(''))}</section>`;
}

/** A small positive fraction in thousandths, with enough digits to tell neighbours apart. */
function fmtPermille(x: number): string {
  if (!Number.isFinite(x)) return '–';
  const v = x * 1000;
  return Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
}

function reliabilitySection(a: M.Analysis): string {
  if (!(opts.colour === 'rel' || opts.noiseCorrected || opts.explain)) return '';
  const base = regionBasis(a) ?? a.basis;
  const rel = V3.reliabilityOf(a, base);
  if (!rel) return '<section><h3>Reliability</h3><p class="note">Loading β and SE…</p></section>';
  const order = base.eligible.map((i, p) => ({ id: a.ids[i], rho: rel.rho[p] })).sort((x, y) => x.rho - y.rho);
  const low = order.filter((x) => x.rho < 0.1).map((x) => x.id);
  const rows = order
    .slice(0, 6)
    .map((x) => `<tr><td class="id">${x.id}</td><td class="num">${M.fmtR(x.rho)}</td></tr>`)
    .join('');
  return `<section><h3>Reliability <span class="sub">ρ</span></h3>
    ${fitTable(['<th>Least reliable first</th>', '<th>ρ</th>'], [3.5], rows)}
    <p class="note">Median ρ ${M.fmtR(order[order.length >> 1]?.rho ?? NaN)} over ${order.length} maps.${opts.noiseCorrected && low.length ? ` Set aside from the noise-corrected layout as too unreliable (ρ &lt; .10): ${low.join(', ')}.` : ''}</p>
    ${fold(
      'reliability',
      `<p class="note">ρ = 1 − noise variance ÷ spatial variance (${rel.noise}); this assumes the first-level noise estimates are calibrated. Two maps with one true pattern correlate at most √(ρᵢρⱼ).${opts.noiseCorrected ? ' Noise-corrected layout: r ÷ √(ρᵢρⱼ), clamped to ±1. The transition shows which maps moved once noise was accounted for.' : ''}</p>`
    )}</section>`;
}

function covariateSection(): string {
  if (!opts.colour.startsWith('cov:') || !lastFit) return '';
  const f = lastFit;
  return `<section><h3>Fit to layout <span class="sub">${f.field}</span></h3><p class="note">${
    f.kind === 'numeric' ? `Linear gradient of ${f.field} across the layout: R² ${M.fmtR(f.r2)}` : `${f.field} groups' centroids: R² ${M.fmtR(f.r2)} (between-centroid share of layout variance)`
  }, permutation p ${f.p < 0.001 ? '< .001' : M.fmtR(f.p)} (999 shuffles, n = ${f.n}). Valid as a test because ${f.field} did not build the layout; it says the layout lines up with ${f.field}, not why.</p></section>`;
}

export function panelHtml(a: M.Analysis): string {
  return channelLegendHtml(a) + explainSection(a) + agreementSection(a) + subsetSection(a) + acrossContrastsSection(a) + reliabilitySection(a) + covariateSection() + layersSection(a);
}

export function wirePanel(a: M.Analysis): void {
  M.side.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((btn) => {
    btn.onclick = () => {
      opts.explain = btn.dataset.scope as 'all' | 'focused' | 'group';
      redraw(false);
    };
  });
  M.side.querySelectorAll<HTMLButtonElement>('[data-parcel]').forEach((btn) => {
    btn.onclick = () => {
      // Brush: Mark every map by this parcel and go to the parcel's centre slice.
      const id = Number(btn.dataset.parcel);
      opts.colour = `parcel:${id}`;
      const c = atlasNow ? V3.parcelCentre(atlasNow, id) : null;
      if (c) {
        const ax = M.state.orient === 'axial' ? 2 : M.state.orient === 'coronal' ? 1 : 0;
        M.state.slice = c[ax];
        if (M.state.cursor) M.state.cursor[ax] = c[ax];
      }
      redraw(false);
    };
  });
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
/** Smallest picture (px, before the aspect split) side by side draws before falling back to dots. */
const TRAJ_MIN_PICTURE = 26;
/** Panel grid of the last side-by-side draw (canvas px), for zooming about the pointer in any panel. */
let trajPanels: { x: number; y: number; pw: number; ph: number; gap: number; cols: number; n: number } | null = null;
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
  // Pictures keep this clearance from a panel's edges (and from its header).
  const inset = 8;
  // A line under the panels holds the stress footer.
  const footH = 16;
  const pw = (plot.w - gap * (cols - 1)) / cols;
  let ph = (plot.h - footH - gap * (rows - 1)) / rows;
  const asp = M.sliceAspect(a.set);
  // Every panel shares the same positions, so dots alone show nothing side by side: keep pictures down to
  // TRAJ_MIN_PICTURE px rather than thumbSize's single-view threshold.
  let { size } = thumbSize(ids.length, { x: 0, y: 0, w: pw - 2 * inset, h: ph - titleH - 2 * inset }, M.state.space?.s ?? 1);
  let lod: Lod = size >= TRAJ_MIN_PICTURE ? 'thumbs' : 'marks';
  let tw = Math.round(size * Math.sqrt(asp));
  let th = Math.round(size / Math.sqrt(asp));
  const sel = M.state.subject;
  // Positions within a panel: identical in every panel (same transform, same nudges). The transform is
  // built in canvas coordinates for the first panel, so it doubles as the Space transform that drag-pan,
  // +/- and Ctrl/Cmd+wheel zoom act on (other panels are the same transform shifted by their offset).
  const LBL = 12;
  const top = titleH + inset;
  const inner0 =
    lod === 'thumbs'
      ? { x: inset + tw / 2, y: top + (th + LBL) / 2, w: Math.max(1, pw - 2 * inset - tw), h: Math.max(1, ph - top - inset - th - LBL) }
      : { x: inset + 12, y: top + 10, w: pw - 2 * inset - 24, h: ph - top - inset - 20 };
  let innerAbs = { x: plot.x + inner0.x, y: plot.y + inner0.y, w: inner0.w, h: inner0.h };
  let t0 = spaceTransform(d.coords, innerAbs, M.state.space);
  let local = ids.map((_, i) => {
    const [x, y] = t0.toScreen(d.coords[2 * i], d.coords[2 * i + 1]);
    return [x - plot.x, y - plot.y] as [number, number];
  });
  // A map is drawn only when its exact position is in view (zoomed panels never show detached pictures),
  // and only maps in view take part in decluttering.
  const inView = local.map(([x, y]) => x >= 0 && x <= pw && y >= titleH && y <= ph);
  const view = ids.map((_, i) => i).filter((i) => inView[i]);
  // Narrow panels: shrink the pictures until no picture (with its ID label below it, LBL px) overlaps
  // another, and fall back to dots only when they would be smaller than TRAJ_MIN_PICTURE px.
  const area = { x: inset, y: top, w: pw - 2 * inset, h: ph - top - inset };
  let placed = local.map(([x, y]) => ({ x, y }));
  for (let attempt = 0; lod === 'thumbs' && attempt < 12; attempt++) {
    // Pad the boxes while separating so pictures keep a small gap; accept once the drawn boxes are clear.
    const sub = declutter(view.map((i) => ({ x: local[i][0], y: local[i][1] })), tw + 4, th + LBL + 4, area, 300, 4);
    placed = local.map(([x, y]) => ({ x, y }));
    view.forEach((i, k) => (placed[i] = sub[k]));
    if (maxOverlap(sub, tw + 1, th + LBL + 1) === 0) break;
    if (size * 0.88 < TRAJ_MIN_PICTURE) {
      lod = 'marks';
      placed = local.map(([x, y]) => ({ x, y }));
      break;
    }
    size *= 0.88;
    tw = Math.round(size * Math.sqrt(asp));
    th = Math.round(size / Math.sqrt(asp));
  }
  g.lod = lod;
  // At fit (no zoom), panels end where their content ends: the unused height a uniform-scale fit leaves above
  // and below a wide layout is dropped, so panels sit together under their headers.
  if (!M.state.space) {
    const half = lod === 'thumbs' ? (th + LBL) / 2 : 6;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const i of view) {
      y0 = Math.min(y0, placed[i].y - half, local[i][1] - 4);
      y1 = Math.max(y1, placed[i].y + half, local[i][1] + 4);
    }
    if (Number.isFinite(y0) && y0 > top) {
      const dy = top - y0;
      local = local.map(([x, y]) => [x, y + dy] as [number, number]);
      placed = placed.map((q) => ({ x: q.x, y: q.y + dy }));
      innerAbs = { ...innerAbs, y: innerAbs.y + dy };
      t0 = spaceTransform(d.coords, innerAbs, M.state.space);
      ph = Math.min(ph, y1 + dy + inset);
    }
  }
  g.t = t0;
  g.inner = innerAbs;
  trajPanels = { x: plot.x, y: plot.y, pw, ph, gap, cols, n: K };
  // Exact-position dots follow the single view's rules: none for a position still inside its own picture.
  const ownPicture = (i: number): boolean =>
    lod === 'thumbs' && Math.abs(local[i][0] - placed[i].x) < tw / 2 + 2 && Math.abs(local[i][1] - placed[i].y) < (th + LBL) / 2 + 2;
  let dotsN = 0;
  let ownN = 0;
  for (const i of view)
    if (lod === 'thumbs' && Math.hypot(placed[i].x - local[i][0], placed[i].y - local[i][1]) > Math.max(4, tw * 0.2)) {
      if (ownPicture(i)) ownN++;
      else dotsN++;
    }
  list.forEach((ak, k) => {
    const ox = plot.x + (k % cols) * (pw + gap);
    const oy = plot.y + Math.floor(k / cols) * (ph + gap);
    ctx.save();
    // No frames: a hairline between panels and a mono header.
    ctx.strokeStyle = THEME.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (k % cols > 0) {
      ctx.moveTo(Math.round(ox - gap / 2) + 0.5, oy);
      ctx.lineTo(Math.round(ox - gap / 2) + 0.5, oy + ph);
    }
    if (k >= cols) {
      ctx.moveTo(ox, Math.round(oy - gap / 2) + 0.5);
      ctx.lineTo(ox + pw, Math.round(oy - gap / 2) + 0.5);
    }
    ctx.stroke();
    ctx.font = `${ak === a ? '600 ' : ''}11px ${FONT.mono}`;
    ctx.fillStyle = ak === a ? THEME.text : THEME.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(M.truncate(ctx, ak === a ? `${ak.contrast} · positions from this layout` : ak.contrast, pw - 4), ox + 2, oy + 4);
    ctx.beginPath();
    ctx.rect(ox, oy, pw, ph);
    ctx.clip();
    ids.forEach((id, i) => {
      if (!inView[i]) return;
      const [sx, sy] = [ox + local[i][0], oy + local[i][1]];
      const [px, py] = [ox + placed[i].x, oy + placed[i].y];
      const m = ak.ids.indexOf(id);
      const isSel = id === sel;
      if (lod === 'thumbs') {
        if (m < 0) {
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = THEME.muted;
          ctx.strokeRect(px - tw / 2, py - (th + LBL) / 2, tw, th);
          ctx.setLineDash([]);
        } else M.drawCell(ctx, ak, m, { x: px - tw / 2, y: py - (th + LBL) / 2, w: tw, h: th }, null, false, { silhouette: true, crosshair: false });
        if (Math.hypot(px - sx, py - sy) > Math.max(4, tw * 0.2) && !ownPicture(i)) {
          ctx.strokeStyle = 'rgba(200,202,220,0.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(Math.max(px - tw / 2, Math.min(px + tw / 2, sx)), Math.max(py - (th + LBL) / 2, Math.min(py + (th - LBL) / 2, sy)));
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
          ctx.fillText(id, px, py + (th - LBL) / 2 + 1);
        }
      } else {
        ctx.fillStyle = isSel ? THEME.brand : THEME.text;
        ctx.beginPath();
        ctx.arc(sx, sy, isSel ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
      const mm = a.ids.indexOf(id);
      if (mm >= 0) g.marks.push({ member: mm, box: lod === 'thumbs' ? { x: px - tw / 2, y: py - (th + LBL) / 2, w: tw, h: th + LBL } : { x: sx - 8, y: sy - 8, w: 16, h: 16 }, kind: lod === 'thumbs' ? 'thumb' : 'dot' });
    });
    ctx.restore();
  });
  // Footer: the fit every panel's positions come from, as in the single view.
  const stress = Number.isFinite(res.stress1) ? `${res.method === 'metric-smacof' ? 'metric ' : ''}Stress-1 ${res.stress1.toFixed(3).replace(/^0\./, '.')} · ` : '';
  const moved = dotsN + ownN;
  const nudge = moved ? ` · ${moved} ${moved === 1 ? 'picture' : 'pictures'} nudged apart${dotsN ? ': dots mark exact positions' : ''}${ownN ? `; unmarked: ${ownN} still over ${ownN === 1 ? 'its' : 'their'} own picture` : ''}` : '';
  ctx.font = `11px ${FONT.sans}`;
  ctx.fillStyle = THEME.faint;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  const fy = plot.y + rows * ph + (rows - 1) * gap + 4;
  ctx.fillText(M.truncate(ctx, `Positions from the ${a.contrast} layout: ${stress}${ids.length} placed${nudge}`, plot.w), plot.x + plot.w, fy);
  g.sideFooter = { text: `Positions from the ${a.contrast} layout: ${stress}${ids.length} placed${nudge}`, y: fy };
}

/**
 * Ctrl/Cmd+wheel side by side: zoom every panel about the layout point under the pointer. The shared
 * transform is the first panel's, so the pointer is shifted back by its own panel's offset first.
 */
function trajectoryZoom(e: WheelEvent): boolean {
  const g = SV.spaceGeom;
  const P = trajPanels;
  if (!g?.t || !P) return true;
  let [x, y] = canvasXY(e);
  const col = Math.floor((x - P.x) / (P.pw + P.gap));
  const row = Math.floor((y - P.y) / (P.ph + P.gap));
  if (col >= 0 && col < P.cols && row >= 0 && row * P.cols + col < P.n) {
    x -= col * (P.pw + P.gap);
    y -= row * (P.ph + P.gap);
  } else [x, y] = [g.inner.x + g.inner.w / 2, g.inner.y + g.inner.h / 2];
  M.state.space = zoomAbout(g.t, g.inner, x, y, Math.exp(-e.deltaY * 0.0025));
  if (M.state.space.s <= 1.0001) M.state.space = null;
  M.scheduleDraw();
  return true;
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
  const s = M.state.subject && P.subjects.includes(M.state.subject) ? M.state.subject : null;
  const rows: string[] = [];
  const med = (v: number[]): number => {
    const x = v.filter(Number.isFinite).sort((p, q) => p - q);
    return x.length ? (x.length % 2 ? x[x.length >> 1] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2) : NaN;
  };
  for (let p = 0; p < P.contrasts.length; p++)
    for (let q = p + 1; q < P.contrasts.length; q++) {
      const [c1, c2] = [P.contrasts[p], P.contrasts[q]];
      // With a focused subject: its own value; otherwise the median over subjects.
      const subs = s ? [s] : P.subjects;
      const own = med(subs.map((x) => r(`${x}·${c1}`, `${x}·${c2}`)));
      const others = med(subs.flatMap((x) => P.subjects.filter((o) => o !== x).map((o) => r(`${x}·${c1}`, `${o}·${c2}`))));
      const short = shortContrastNames(P.contrasts);
      rows.push(`<tr><td title="${c1} × ${c2}">${short[p]}–${short[q]}</td><td class="num">${M.fmtR(own)}</td><td class="num">${M.fmtR(others)}</td></tr>`);
    }
  const sameTip = s ? `r between ${s}'s maps of the two contrasts` : "median over subjects of r between a subject's maps of the two contrasts";
  const otherTip = `median r between ${s ? `${s}'s` : "a subject's"} map of the first contrast and other subjects' maps of the second`;
  return `<section><h3>Across contrasts <span class="sub">${s ?? 'medians'}</span></h3>
    <table class="nb-table" style="white-space:nowrap"><tr><th>pair</th><th title="${sameTip}">same subj.</th><th title="${otherTip}">other subj.</th></tr>${rows.join('')}</table>
    <p class="note">Same subj.: r between ${s ? `${s}'s` : "one subject's"} maps of the two contrasts; other subj.: r with other subjects' maps of the second contrast${s ? ' (median)' : ' (medians over subjects)'}.</p>
    <p class="note">Each panel draws one contrast at the ${a.contrast} layout's positions, so a map that changes between contrasts shows a different picture in the same place. Across all ${total} subject × contrast maps, the most similar other map is the same subject's other contrast for <b>${same}</b>. (r on the ${b.support.length.toLocaleString()} voxels every contrast shares.)</p>
  </section>`;
}
