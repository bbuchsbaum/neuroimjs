/**
 * Space view of the volume-set browser: maps placed by whole-volume similarity.
 * Owns the layout jobs, Space drawing, the Space overlay, keyboard stepping and the
 * Space side-panel section. main.ts owns shared state, the canvas and dispatch.
 */
import { gridToSlicePixel } from '../../src/volumeset/VolumeSet';
import { type SimilarityBasis } from '../../src/volumeset/basis';
import { EmbeddingJobs } from '../../src/volumeset/embeddingJobs';
import { NMDS_SOLVER, neighborPreservation, sourceNeighbors, type NmdsOptions } from '../../src/volumeset/nmds';
import { EmbedWorkerRunner, type EmbedInput, type EmbedOutput } from './embed-runner';
import {
  bounds,
  spaceTransform,
  coincidentGroups,
  thumbSize,
  directionalNeighbor,
  placeLabels,
  screenRanks,
  type SpaceTransform,
  type PlotRect,
  type LabelBox,
  type Lod,
  declutter,
} from './space';
import { THEME, FONT, placeCrop, drawCellImage, drawCrosshair, hidpi } from './render';
import * as M from './main';
import * as SX from './space-extras';
import * as V3 from './space-v3';

// ---------------------------------------------------------------------------
// Space: maps placed by whole-volume similarity (nonmetric MDS of the basis)

let jobs: EmbeddingJobs<EmbedInput, EmbedOutput> | null = null;
let embedRunner: EmbedWorkerRunner | null = null;

/** The basis Space shows for an analysis: a region-restricted basis when one is applied, else the whole-mask basis. */
export function basisOf(a: M.Analysis): SimilarityBasis {
  const b = SX.regionBasis(a) ?? a.basis;
  // Noise-corrected similarity applies on top of the whole-brain or regional basis (β-maps: once SE has loaded).
  return SX.opts.noiseCorrected ? (V3.correctedBasis(a, b) ?? b) : b;
}

export function layoutKeyFor(b: SimilarityBasis, opts: NmdsOptions = M.layoutOpts(b.eligible.length)): string {
  return `${b.key}|${M.LAYOUT.id}|${JSON.stringify(opts)}|${NMDS_SOLVER.name}@${NMDS_SOLVER.version}`;
}

function layoutKey(a: M.Analysis): string {
  return layoutKeyFor(basisOf(a));
}

export type LayoutState = { kind: 'ready'; out: EmbedOutput } | { kind: 'pending' } | { kind: 'error'; message: string } | { kind: 'none'; message: string };

const BASIS_STATUS: Record<string, string> = {
  'insufficient-support': 'Too few voxels are valid in every map to compare them; nothing is placed.',
  'no-eligible-members': 'No map can be compared (all missing, constant or low coverage); nothing is placed.',
};

/**
 * The layout for an analysis: cached, pending (requested once; the result is
 * installed only if this layout is still the one on screen) or failed (retried
 * only on request). Display-only redraws reach the cache and never refit.
 */
function layoutFor(a: M.Analysis): LayoutState {
  const b = basisOf(a);
  return layoutForBasis(b, b.eligible.map((i) => b.ids[i]));
}

/** Layout for any basis (ids = the eligible members' IDs, in eligible order). */
export function layoutForBasis(basis: SimilarityBasis, ids: string[], opts: NmdsOptions = M.layoutOpts(basis.eligible.length)): LayoutState {
  if (basis.status !== 'ok') return { kind: 'none', message: BASIS_STATUS[basis.status] ?? basis.status };
  if (!jobs) {
    embedRunner = new EmbedWorkerRunner();
    jobs = new EmbeddingJobs(embedRunner, 6);
  }
  const key = layoutKeyFor(basis, opts);
  const failed = jobs.failure(key);
  if (failed) return { kind: 'error', message: failed.message };
  const cached = jobs.peek(key);
  const p = jobs.request(key, () => ({ dist: basis.dist, ids, opts }));
  if (cached) return { kind: 'ready', out: cached };
  M.setStatus(`Fitting layout (${basis.eligible.length} maps)…`);
  p.then(
    (o) => {
      if (o.current && M.state.mode === 'space') {
        M.setStatus('');
        M.scheduleDraw();
      }
    },
    (err: Error) => {
      if (err.name === 'AbortError') return;
      if (jobs?.isCurrent(key) && M.state.mode === 'space') {
        M.setStatus('Layout failed', 2500);
        M.scheduleDraw();
      }
    }
  );
  return { kind: 'pending' };
}

export function retryLayout(): void {
  if (!jobs || !M.lastRail) return;
  const b = SX.retryBasis() ?? basisOf(M.lastRail.a);
  // request() clears the recorded failure and runs again.
  const opts = SX.trajectoryMode() ? SX.pooledOpts(b.eligible.length) : M.layoutOpts(b.eligible.length);
  jobs.request(layoutKeyFor(b, opts), () => ({ dist: b.dist, ids: b.eligible.map((i) => b.ids[i]), opts })).then(
    () => M.scheduleDraw(),
    () => M.scheduleDraw()
  );
  M.scheduleDraw();
}

export interface SpacePoint {
  /** Set index. */
  member: number;
  /** Position in the basis-eligible list. */
  pos: number;
  sx: number;
  sy: number;
  /** Members sharing this exact pattern (r = 1), including this one; null when unique. */
  group: number[] | null;
  /** Where the picture is drawn when nudged off its exact position (thumbnail mode only). */
  tx?: number;
  ty?: number;
}

export interface SpaceGeom {
  a: M.Analysis;
  key: string;
  t: SpaceTransform | null;
  inner: PlotRect;
  plot: PlotRect;
  lod: Lod;
  thumbW: number;
  thumbH: number;
  points: SpacePoint[];
  /** Click targets that select without a voxel (anchor marks, ID labels, counted glyphs). */
  marks: { member: number; box: LabelBox; kind: 'thumb' | 'dot' | 'label' }[];
  layout: LayoutState;
  /** Members drawn in the "not placed" strip, left to right. */
  strip: number[];
  /** The enlarged preview's box (keeps the enlargement while the pointer is over it). */
  zoomBox: { member: number; box: LabelBox } | null;
  /** Fixed place for the enlarged preview in the reference column, so it never covers a map; null if no room. */
  dock: PlotRect | null;
  /** Number of pictures drawn away from their exact positions. */
  nudged?: number;
}

/** Nudged picture centres, computed once per layout and screen geometry in a stable order (not per selection). */
let declutterCache: { key: string; placed: Map<number, { x: number; y: number }> } | null = null;

export let spaceGeom: SpaceGeom | null = null;
let viewportKey: string | null = null;
/** Hovered and enlarged maps, by member ID (never by index: sets differ across sources). */
let spaceHover: string | null = null;
export let spaceEnlarged: string | null = null;
let spaceHoverTimer: number | undefined;
export let spaceZoomHit: M.Hit | null = null;
/** True source neighbours of the focused member (IDs), shared with the rail and matrix. */
export let spaceNeighborIds = new Set<string>();
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

/**
 * Member under a point. `selectOnly`: only ID labels and anchor dots, which select
 * without placing the cursor and take precedence over any picture (including the
 * enlarged preview), so clicking an ID never moves the anatomical cursor.
 */
export function markAt(x: number, y: number, selectOnly = false): number | null {
  if (!spaceGeom) return null;
  const inside = (b: LabelBox): boolean => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  for (let i = spaceGeom.marks.length - 1; i >= 0; i--) {
    const { member, box, kind } = spaceGeom.marks[i];
    if (kind !== 'thumb' && inside(box)) return member;
  }
  if (selectOnly) return null;
  const z = spaceGeom.zoomBox;
  if (z && inside(z.box)) return z.member;
  for (let i = spaceGeom.marks.length - 1; i >= 0; i--) {
    const { member, box, kind } = spaceGeom.marks[i];
    if (kind === 'thumb' && inside(box)) return member;
  }
  return null;
}

/** Hover intent: enlarge after a short pause; leaving clears at once. */
export function setSpaceHover(member: number | null): void {
  const m = member === null || !spaceGeom ? null : spaceGeom.a.ids[member];
  if (m === spaceHover) return;
  spaceHover = m;
  clearTimeout(spaceHoverTimer);
  if (m === null) {
    if (spaceEnlarged !== null) {
      spaceEnlarged = null;
      M.scheduleDraw(true);
    }
    return;
  }
  spaceHoverTimer = window.setTimeout(
    () => {
      spaceEnlarged = spaceHover;
      M.scheduleDraw(true);
    },
    reducedMotion?.matches ? 0 : 160
  );
  M.scheduleDraw(true);
}

export function reasonShort(e: SimilarityBasis['excluded'][number], a: M.Analysis): string {
  switch (e.reason) {
    case 'low-coverage':
      return `coverage ${Math.round(basisOf(a).coverage[e.index] * 100)}%`;
    case 'all-missing':
      return 'no data';
    case 'constant':
    case 'constant-on-support':
      return 'constant';
    default:
      return 'no support';
  }
}

export async function drawSpace(light = false): Promise<void> {
  const a = await M.getAnalysis(M.state.model, M.state.contrast, M.state.stat);
  const order = M.orderOf(a);
  const { ctx, W, H } = M.prepCanvas();
  M.hits.length = 0;
  spaceZoomHit = null;
  SX.syncToolbar();
  const b = basisOf(a);
  const st = M.STAT_LABEL[M.state.stat];
  const asp = M.sliceAspect(a.set);
  const pad = 16;

  const layout = layoutFor(a);
  // Reference column (outside the layout's coordinates): the mean map and a legend.
  const colW = Math.round(Math.max(110, Math.min(180, Math.min(W, H) * 0.2)));
  const meanRect = { x: pad, y: pad, w: colW, h: colW / asp + 18 };
  M.drawCell(ctx, a, 'mean', meanRect, { left: `Mean ${st}`, right: `all ${a.set.size}` }, true);
  ctx.font = `11px ${FONT.sans}`;
  ctx.fillStyle = THEME.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const legend = [
    'Reference only: average of all',
    `${a.set.size} ${st}-maps; not placed.`,
    '',
    ...(SX.trajectoryMode()
      ? [`Position: the ${a.contrast} layout,`, 'shared by every contrast panel.']
      : [`Position: ${scopeShort(a)}`, `(1 − r, ${layout.kind === 'ready' ? methodShort(layout.out.result.method) : 'nonmetric MDS'}).`]),
    `Pictures: ${M.state.orient} slice ${M.sliceIndex() + 1}.`,
    'Axes and gaps are not results.',
  ];
  legend.forEach((line, i) => ctx.fillText(line, pad, meanRect.y + meanRect.h + 10 + i * 15));
  const dockY = meanRect.y + meanRect.h + 10 + legend.length * 15 + 14;

  // Members the basis excludes: a strip below the layout, outside its coordinates.
  const strip = [...b.excluded].sort((x, y) => a.ids[x.index].localeCompare(a.ids[y.index]));
  const stripH = strip.length ? Math.round(Math.max(78, Math.min(120, H * 0.17))) : 0;
  // A strip at the top is reserved for the Space toolbar, so it never covers a map.
  const toolbarH = 34;
  const plot: PlotRect = { x: colW + 2 * pad, y: pad + toolbarH, w: W - colW - 3 * pad, h: H - 2 * pad - toolbarH - (stripH ? stripH + 8 : 0) };
  if (strip.length) {
    const y0 = plot.y + plot.h + 8;
    ctx.strokeStyle = THEME.line;
    ctx.beginPath();
    ctx.moveTo(plot.x, y0 + 0.5);
    ctx.lineTo(plot.x + plot.w, y0 + 0.5);
    ctx.stroke();
    ctx.fillStyle = THEME.warn;
    ctx.font = `600 11px ${FONT.sans}`;
    ctx.textBaseline = 'top';
    ctx.fillText(`Not placed (${strip.length})`, plot.x, y0 + 6);
    const ch = stripH - 22;
    ctx.font = `10.5px ${FONT.sans}`;
    let x = plot.x + 110;
    let shown = 0;
    strip.forEach((e) => {
      // Picture with the ID above it and the reason beside it, so long reasons never collide.
      const reason = reasonShort(e, a);
      const iw = Math.round((ch - 18) * asp);
      const outer = { x, y: y0 + 4, w: iw, h: ch };
      const cellW = iw + 8 + Math.max(70, ctx.measureText(reason).width);
      if (x + cellW > W - pad - 80) return;
      shown++;
      M.drawCell(ctx, a, e.index, outer, { left: a.ids[e.index] }, false);
      ctx.font = `10.5px ${FONT.sans}`;
      ctx.fillStyle = THEME.warn;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(reason, x + iw + 8, y0 + 26);
      x += cellW + 12;
    });
    if (shown < strip.length) {
      ctx.fillStyle = THEME.warn;
      ctx.font = `600 11px ${FONT.sans}`;
      ctx.textBaseline = 'top';
      ctx.fillText(`+${strip.length - shown} more (see Maps list)`, x, y0 + 26);
    }
  }

  // Layout area.
  if (viewportKey !== null && viewportKey !== b.key) M.state.space = null;
  viewportKey = b.key;
  const m = b.eligible.length;
  const { size, lod } = thumbSize(m, plot, M.state.space?.s ?? 1);
  const thumbW = Math.round(size * Math.sqrt(asp));
  const thumbH = Math.round(size / Math.sqrt(asp)) + 16;
  const inner: PlotRect =
    lod === 'thumbs'
      ? { x: plot.x + thumbW / 2, y: plot.y + thumbH / 2, w: Math.max(1, plot.w - thumbW), h: Math.max(1, plot.h - thumbH) }
      : { x: plot.x + 40, y: plot.y + 16, w: Math.max(1, plot.w - 80), h: Math.max(1, plot.h - 32) };
  const geom: SpaceGeom = { a, key: b.key, t: null, inner, plot, lod, thumbW, thumbH, points: [], marks: [], layout, strip: strip.map((e) => e.index), zoomBox: null, dock: null };
  {
    // The preview docks under the legend when the column has room for a picture plus its caption.
    const room = plot.y + plot.h + (stripH ? stripH : 0) - dockY - 62; // caption: ID + up to three caveat lines
    const dw = Math.floor(Math.min(colW, room * asp));
    if (dw >= 110) geom.dock = { x: pad + Math.round((colW - dw) / 2), y: dockY, w: dw, h: Math.round(dw / asp) + 62 };
  }
  spaceGeom = geom;
  const sel = M.selectedMember(a);
  spaceNeighborIds = new Set();
  if (SX.trajectoryMode()) {
    await SX.drawTrajectories(ctx, geom, plot);
    M.drawOverlay();
    if (!light) M.drawSide(a, order);
    M.drawRail(a, order);
    exposeSpaceProbe();
    return;
  }

  const message = (text: string, color: string = THEME.muted): void => {
    ctx.fillStyle = color;
    ctx.font = `13px ${FONT.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, plot.x + plot.w / 2, plot.y + plot.h / 2);
  };
  if (layout.kind === 'pending') message(`Fitting the layout for ${m} maps…`);
  else if (layout.kind === 'none') message(layout.message, THEME.warn);
  else if (layout.kind === 'error') message(`Layout failed: ${layout.message}. Press R or use Retry in the panel.`, THEME.warn);
  else {
    const res = layout.out.result;
    // Presentation alignment to the previously shown layout (canonical pose on first show).
    const disp = SX.displayCoords(layoutKey(a), res.ids, Float64Array.from(res.coords));
    if (M.state.space) {
      // A viewport centred far outside the layout (e.g. a hand-edited sv) falls back to fit.
      const bx = bounds(disp.coords);
      const span = Math.max(bx.x1 - bx.x0, bx.y1 - bx.y0, 1e-9);
      const { cx, cy } = M.state.space;
      if (cx < bx.x0 - span || cx > bx.x1 + span || cy < bx.y0 - span || cy > bx.y1 + span) M.state.space = null;
    }
    const t = spaceTransform(disp.coords, inner, M.state.space);
    geom.t = t;
    // Exact-pattern groups (r = 1) share one anchor: one picture with a count, every ID kept.
    const groups = coincidentGroups(b.dist, m);
    const groupOf = new Map<number, number[]>();
    for (const g of groups) for (const p of g) groupOf.set(p, g.map((q) => b.eligible[q]));
    const all: SpacePoint[] = [];
    for (let p = 0; p < m; p++) {
      const [sx, sy] = t.toScreen(disp.coords[2 * p], disp.coords[2 * p + 1]);
      all.push({ member: b.eligible[p], pos: p, sx, sy, group: groupOf.get(p) ?? null });
    }
    // Transition: interpolate from where each map was drawn (by ID); positions settle on the new fit.
    const animPts = all.map((pt) => ({ id: a.ids[pt.member], sx: pt.sx, sy: pt.sy }));
    const settling = SX.animate(animPts) < 1;
    all.forEach((pt, i) => {
      pt.sx = animPts[i].sx;
      pt.sy = animPts[i].sy;
    });
    geom.points = all;
    // One representative per exact group: the focused member if it is in the group, else the first.
    const shown = all.filter((pt) => !pt.group || pt.member === (pt.group.includes(sel ?? -1) ? sel : pt.group[0]));
    // Draw the focused member last so it is never covered.
    shown.sort((x, y) => (x.member === sel ? 1 : 0) - (y.member === sel ? 1 : 0) || x.pos - y.pos);
    if (sel !== undefined && b.eligible.includes(sel)) {
      const pi = b.eligible.indexOf(sel);
      for (const nb of sourceNeighbors(b.dist, m, pi, 3)) spaceNeighborIds.add(a.ids[b.eligible[nb.index]]);
    }
    // A map is drawn only when its exact position is in view (zoomed layouts never show detached pictures).
    const visible = (pt: SpacePoint): boolean => pt.sx >= plot.x && pt.sx <= plot.x + plot.w && pt.sy >= plot.y && pt.sy <= plot.y + plot.h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x - 4, plot.y - 4, plot.w + 8, plot.h + 8);
    ctx.clip();
    if (lod === 'thumbs' && !settling) {
      // Pictures are nudged apart so none hides another or another map's exact position; each moved
      // picture keeps a dot at its exact position and a leader. Positions (dots, links, keyboard steps)
      // remain the fitted configuration. Computed in eligible order and cached, so selecting or hovering
      // a map never reshuffles the pictures.
      const vp = M.state.space;
      const dkey = `${layoutKey(a)}|${vp ? `${vp.s},${vp.cx},${vp.cy}` : 'fit'}|${thumbW}x${thumbH}|${plot.x},${plot.y},${plot.w},${plot.h}`;
      if (!declutterCache || declutterCache.key !== dkey) {
        // Only maps in view take part, so off-view maps never push visible pictures.
        const reps = all.filter((pt) => (!pt.group || pt.member === pt.group[0]) && visible(pt)).sort((x, y) => x.pos - y.pos);
        const placed = declutter(
          reps.map((pt) => ({ x: pt.sx, y: pt.sy })),
          thumbW + 6,
          thumbH + 4,
          plot,
          300,
          5
        );
        // Keyed by exact position (r = 1 group members share it), so a group's representative can change.
        declutterCache = { key: dkey, placed: new Map(reps.map((pt, i) => [pt.pos, placed[i]])) };
        for (const pt of all) if (pt.group) declutterCache.placed.set(pt.pos, placed[reps.findIndex((r) => r.group === pt.group || r.member === pt.group![0])]);
      }
      for (const pt of shown) {
        const q = declutterCache.placed.get(pt.pos);
        if (q) {
          pt.tx = q.x;
          pt.ty = q.y;
        }
      }
    }
    // Fisheye lens (display only): exact positions and pictures inside the lens are magnified.
    const lensScale = new Map<number, number>();
    for (const pt of all) {
      const l = SX.lens(pt.sx, pt.sy);
      if (pt.tx !== undefined) {
        const lt = SX.lens(pt.tx, pt.ty!);
        pt.tx = lt.x;
        pt.ty = lt.y;
        lensScale.set(pt.member, Math.max(1, Math.min(2.2, lt.scale)));
      } else lensScale.set(pt.member, Math.max(1, Math.min(2.2, l.scale)));
      pt.sx = l.x;
      pt.sy = l.y;
    }
    SX.drawBackdrop(ctx, { a, b, out: layout.out, key: layoutKey(a), d: disp, t, points: shown, plot, thumbW, thumbH, lod });
    const labelBoxes: LabelBox[] = [];
    const labelText: string[] = [];
    ctx.font = `10.5px ${FONT.mono}`;
    for (const pt of shown) {
      const id = a.ids[pt.member];
      const text = pt.group ? `${id} +${pt.group.length - 1}` : id;
      labelText.push(text);
      const tw = ctx.measureText(text).width + 6;
      labelBoxes.push(
        lod === 'thumbs'
          ? { x: (pt.tx ?? pt.sx) - tw / 2, y: (pt.ty ?? pt.sy) + thumbH / 2 - 15, w: tw, h: 14 }
          : { x: pt.sx + 7, y: pt.sy - 7, w: tw, h: 14 }
      );
    }
    if (lod === 'thumbs') {
      for (const pt of shown) {
        if (!visible(pt)) continue;
        const tx = pt.tx ?? pt.sx;
        const ty = pt.ty ?? pt.sy;
        const ls = lensScale.get(pt.member) ?? 1;
        const tw = thumbW * ls;
        const th = thumbH * ls;
        const cell = { x: tx - tw / 2, y: ty - th / 2, w: tw, h: th - 16 * ls };
        M.drawCell(ctx, a, pt.member, cell, null, false, {
          silhouette: true,
          crosshair: tw >= 120,
        });
        const mc = SX.memberColour(a, pt.member);
        if (mc) SX.drawMemberColour(ctx, mc, M.hits[M.hits.length - 1]?.view.dest ?? cell, null);
        geom.marks.push({ member: pt.member, box: { x: tx - tw / 2, y: ty - th / 2, w: tw, h: th }, kind: 'thumb' });
      }
      // Leaders and exact-position dots on top of every picture (with a dark halo), and only for pictures
      // that were moved: an unmoved picture is centred on its position, and a dot there would read as a cursor.
      // A picture counts as moved only when the nudge is noticeable; a dot that would land inside another
      // picture is not drawn (it would read as a mark on that map), and neither is its leader.
      const boxes = shown.filter(visible).map((pt) => ({ m: pt.member, x: pt.tx ?? pt.sx, y: pt.ty ?? pt.sy }));
      const inOther = (pt: SpacePoint): boolean => boxes.some((bx) => bx.m !== pt.member && Math.abs(pt.sx - bx.x) < thumbW / 2 + 2 && Math.abs(pt.sy - bx.y) < thumbH / 2 + 2);
      const movedPts = shown.filter((pt) => visible(pt) && Math.hypot((pt.tx ?? pt.sx) - pt.sx, (pt.ty ?? pt.sy) - pt.sy) > Math.max(4, thumbW * 0.2) && !inOther(pt));
      for (const [width, color] of [
        [3, 'rgba(13,14,20,0.85)'],
        [1, 'rgba(200,202,220,0.8)'],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (const pt of movedPts) {
          // From the dot to the nearest edge of its picture.
          const cx = Math.max(pt.tx! - thumbW / 2, Math.min(pt.tx! + thumbW / 2, pt.sx));
          const cy = Math.max(pt.ty! - thumbH / 2, Math.min(pt.ty! + thumbH / 2 - 16, pt.sy));
          ctx.moveTo(pt.sx, pt.sy);
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
      for (const pt of movedPts) {
        const isSel = pt.member === sel;
        ctx.fillStyle = isSel ? THEME.brand : spaceNeighborIds.has(a.ids[pt.member]) ? THEME.accent : THEME.text;
        ctx.strokeStyle = THEME.bg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, isSel ? 4 : 2.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // A visible dot is its own target and wins over any picture beneath it.
        geom.marks.push({ member: pt.member, box: { x: pt.sx - 6, y: pt.sy - 6, w: 12, h: 12 }, kind: 'dot' });
      }
      geom.nudged = movedPts.length;
    } else {
      for (const pt of shown) {
        if (!visible(pt)) continue;
        const isSel = pt.member === sel;
        ctx.fillStyle = isSel ? THEME.brand : spaceNeighborIds.has(a.ids[pt.member]) ? THEME.accent : THEME.text;
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, (isSel ? 6 : 4) * (lensScale.get(pt.member) ?? 1), 0, Math.PI * 2);
        ctx.fill();
        const mc = SX.memberColour(a, pt.member);
        if (mc) SX.drawMemberColour(ctx, mc, null, [pt.sx, pt.sy]);
        if (pt.group) {
          ctx.strokeStyle = THEME.warn;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(pt.sx, pt.sy, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
        geom.marks.push({ member: pt.member, box: { x: pt.sx - 11, y: pt.sy - 11, w: 22, h: 22 }, kind: 'dot' });
      }
    }
    // Labels: focused, hovered and neighbours first; the rest only where they fit.
    const prio = shown.map((_, i) => i);
    const rank = (i: number): number => {
      const mm = shown[i].member;
      return mm === sel ? 0 : a.ids[mm] === spaceHover ? 1 : spaceNeighborIds.has(a.ids[mm]) ? 2 : 3;
    };
    prio.sort((x, y) => rank(x) - rank(y) || x - y);
    const keep = placeLabels(labelBoxes, prio);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const i of keep) {
      const pt = shown[i];
      if (!visible(pt)) continue;
      const bx = labelBoxes[i];
      const isSel = pt.member === sel;
      ctx.fillStyle = isSel ? 'rgba(30,27,52,0.95)' : 'rgba(13,14,20,0.82)';
      ctx.fillRect(bx.x, bx.y, bx.w, bx.h);
      ctx.fillStyle = isSel ? THEME.brand : pt.group ? THEME.warn : spaceNeighborIds.has(a.ids[pt.member]) ? THEME.accent : THEME.text;
      ctx.font = `${isSel ? '600 ' : ''}10.5px ${FONT.mono}`;
      ctx.fillText(labelText[i], bx.x + bx.w / 2, bx.y + bx.h / 2 + 0.5);
      geom.marks.push({ member: pt.member, box: bx, kind: 'label' });
    }
    ctx.restore();
    SX.drawForeground(ctx, { a, b, out: layout.out, key: layoutKey(a), d: disp, t, points: shown, plot, thumbW, thumbH, lod });
    // Caption: what the picture is and is not.
    ctx.font = `11px ${FONT.sans}`;
    ctx.fillStyle = THEME.faint;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const zoomNote = M.state.space ? ` · layout zoom ${M.state.space.s.toFixed(1)}×` : '';
    const cropNote = M.state.zoom ? ` · anatomy crop ${M.state.zoom.s.toFixed(1)}× (set in Montage)` : '';
    const stressNote = Number.isFinite(res.stress1) ? `${res.method === 'metric-smacof' ? 'metric ' : ''}Stress-1 ${fmtStress(res.stress1)} · ` : '';
    const nudgeNote = geom.nudged ? ` · ${geom.nudged} pictures nudged apart (dots = exact positions)` : '';
    ctx.fillText(`${stressNote}${m} placed${nudgeNote}${zoomNote}${cropNote}`, plot.x + plot.w, plot.y + plot.h + (stripH ? 4 : pad - 2));
  }
  M.drawOverlay();
  if (!light) M.drawSide(a, order);
  M.drawRail(a, order);
  if (!light && M.state.subject !== lastScrolledSubject) {
    // A new focus from the canvas or keyboard brings its Neighbours table into view (list picks do their own).
    lastScrolledSubject = M.state.subject;
    if (!M.side.contains(document.activeElement)) M.side.querySelector('.nb-table')?.closest('section')?.scrollIntoView({ block: 'nearest' });
  }
  exposeSpaceProbe();
}

let lastScrolledSubject: string | null = null;

/** Space extras on the overlay canvas: true-neighbour links and the hover/keyboard enlargement. */
export function drawSpaceOverlay(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  spaceOverlayBody(ctx, W, H);
  // The magnifier copies what is drawn, so it goes last.
  SX.drawLoupe(ctx);
}

function spaceOverlayBody(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const g = spaceGeom;
  spaceZoomHit = null;
  SX.syncToolbar();
  if (!g || M.state.mode !== 'space') return;
  g.zoomBox = null;
  // The agreement card takes the dock while a pair is compared; previews then float.
  const dockBusy = SX.drawDock(ctx, g);
  const dock = dockBusy ? null : g.dock;
  const a = g.a;
  const sel = M.selectedMember(a);
  const byMember = new Map(g.points.map((p) => [p.member, p]));
  const sp = sel !== undefined ? byMember.get(sel) : undefined;
  if (sp) {
    ctx.save();
    ctx.strokeStyle = THEME.accent;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 3]);
    for (const id of spaceNeighborIds) {
      const q = byMember.get(a.ids.indexOf(id));
      if (!q) continue;
      ctx.beginPath();
      ctx.moveTo(sp.sx, sp.sy);
      ctx.lineTo(q.sx, q.sy);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Rail hover in mark mode: ring the anchor.
  if (M.railHover && g.lod === 'marks') {
    const q = byMember.get(a.ids.indexOf(M.railHover));
    if (q) {
      ctx.strokeStyle = THEME.text;
      ctx.beginPath();
      ctx.arc(q.sx, q.sy, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // The docked preview shows the hovered (or keyboard-focused) map, else the focused map.
  const shownId = spaceEnlarged ?? (dock ? M.state.subject : null);
  const m = shownId === null ? -1 : a.ids.indexOf(shownId);
  if (m < 0) return;
  const anchor = byMember.get(m);
  const inStrip = g.strip.includes(m);
  if (!anchor && !inStrip) return;
  const asp = M.sliceAspect(a.set);
  const w = dock ? dock.w : Math.round(Math.max(200, Math.min(280, g.thumbW * 2.1)));
  // The caveat wraps to the preview width so it is never cut; the caption grows to fit it.
  ctx.font = `10.5px ${FONT.sans}`;
  const caveat = wrapText(ctx, `${M.state.orient} slice ${M.sliceIndex() + 1}; placed by ${basisOf(a).scope === 'subset' ? 'the region' : 'whole volume'}`, w - 12);
  const capH = 20 + 14 * caveat.length;
  const h = Math.round(w / asp);
  const ax = anchor ? anchor.sx : W / 2;
  const ay = anchor ? anchor.sy : g.plot.y + g.plot.h - h / 2;
  // Put the enlargement beside its dot, on the side that covers the fewest other pictures, so the map's
  // own neighbours (and their links) stay visible.
  const fit = (cx: number, cy: number): { x: number; y: number } => ({
    x: Math.round(Math.max(4, Math.min(W - w - 4, cx))),
    y: Math.round(Math.max(4, Math.min(H - h - capH - 4, cy))),
  });
  const gap = 14;
  const candidates = anchor
    ? [fit(ax + gap, ay - (h + capH) / 2), fit(ax - w - gap, ay - (h + capH) / 2), fit(ax - w / 2, ay - h - capH - gap), fit(ax - w / 2, ay + gap)]
    : [fit(ax - w / 2, ay - h / 2)];
  const covered = (c: { x: number; y: number }): number => {
    let area = 0;
    for (const mk of g.marks) {
      if (mk.member === m || mk.kind !== 'thumb') continue;
      const ox = Math.min(c.x + w, mk.box.x + mk.box.w) - Math.max(c.x, mk.box.x);
      const oy = Math.min(c.y + h + capH, mk.box.y + mk.box.h) - Math.max(c.y, mk.box.y);
      if (ox > 0 && oy > 0) area += ox * oy * (spaceNeighborIds.has(a.ids[mk.member]) ? 3 : 1);
    }
    return area;
  };
  const best = dock ? { x: dock.x, y: dock.y } : candidates.reduce((p, c) => (covered(c) < covered(p) ? c : p));
  const x = best.x;
  const y = best.y;
  const v = placeCrop(M.cropWindow(a.set), { x, y, w, h });
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(v.dest.x, v.dest.y, v.dest.w, v.dest.h + capH);
  ctx.restore();
  drawCellImage(ctx, M.underSilhouette(a), M.overImage(a, m), v);
  M.drawMissing(ctx, a, m, v);
  if (M.state.cursor) {
    const [col, row] = gridToSlicePixel(a.set.dim, M.state.orient, M.state.cursor);
    drawCrosshair(ctx, v, col, row, 0.45);
  }
  ctx.strokeStyle = m === sel ? THEME.brand : THEME.lineStrong;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(v.dest.x - 0.75, v.dest.y - 0.75, v.dest.w + 1.5, v.dest.h + capH + 1.5);
  ctx.fillStyle = THEME.text;
  ctx.font = `600 11px ${FONT.mono}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(spaceEnlarged === null ? `${a.ids[m]} · focused` : a.ids[m], v.dest.x + 6, v.dest.y + v.dest.h + 10);
  ctx.font = `10.5px ${FONT.sans}`;
  ctx.fillStyle = THEME.muted;
  ctx.textAlign = 'right';
  if (anchor?.group && anchor.group.length > 1) {
    ctx.fillText(M.truncate(ctx, `same pattern (r = 1): ${anchor.group.map((q) => a.ids[q]).join(', ')}`, v.dest.w - 60), v.dest.x + v.dest.w - 6, v.dest.y + v.dest.h + 10);
  }
  // The caveat has its own line so it is never truncated.
  ctx.textAlign = 'left';
  ctx.font = `10.5px ${FONT.sans}`;
  caveat.forEach((line, i) => ctx.fillText(line, v.dest.x + 6, v.dest.y + v.dest.h + 25 + 14 * i));
  // Leader to the true anchor.
  if (anchor && spaceEnlarged !== null && !(ax >= v.dest.x && ax <= v.dest.x + v.dest.w && ay >= v.dest.y && ay <= v.dest.y + v.dest.h)) {
    // Leader only while previewing a hovered map; the focused map is already marked in the layout.
    const cx = Math.max(v.dest.x, Math.min(v.dest.x + v.dest.w, ax));
    const cy = Math.max(v.dest.y, Math.min(v.dest.y + v.dest.h + capH, ay));
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(200,202,220,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.restore();
  }
  if (anchor) {
    // The focused map's position is marked in the focus colour; a hovered map's in white.
    ctx.strokeStyle = m === sel ? THEME.brand : THEME.text;
    ctx.fillStyle = m === sel ? THEME.brand : THEME.bg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ax, ay, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  spaceZoomHit = { view: v, outer: { x, y, w, h }, member: m, analysis: a };
  g.zoomBox = { member: m, box: { x: v.dest.x, y: v.dest.y, w: v.dest.w, h: v.dest.h + capH } };
}

/** Keyboard: arrows move focus to the nearest placed map in that direction (not-placed maps step along their strip). */
export function spaceStep(dir: 'left' | 'right' | 'up' | 'down'): void {
  const g = spaceGeom;
  if (!g) return;
  const a = g.a;
  const sel = M.selectedMember(a);
  let next: number | undefined;
  const pts = g.points;
  const i = pts.findIndex((p) => p.member === sel);
  if (i >= 0) {
    const j = directionalNeighbor(
      pts.map((p) => [p.sx, p.sy] as [number, number]),
      i,
      dir
    );
    if (j >= 0) next = pts[j].member;
    else if (dir === 'down' && g.strip.length) next = g.strip[0];
  } else if (sel !== undefined && g.strip.includes(sel)) {
    const s = g.strip.indexOf(sel);
    if (dir === 'left' || dir === 'right') next = g.strip[Math.max(0, Math.min(g.strip.length - 1, s + (dir === 'right' ? 1 : -1)))];
    else if (dir === 'up' && pts.length) next = pts.reduce((best, p) => (p.sy > best.sy ? p : best)).member;
  } else {
    next = pts[0]?.member ?? g.strip[0];
  }
  if (next === undefined || next === sel) return;
  M.state.subject = a.ids[next];
  spaceHover = a.ids[next];
  spaceEnlarged = a.ids[next];
  M.scheduleDraw();
}

export function openOrtho(a: M.Analysis, member: number): void {
  M.state.subject = a.ids[member];
  M.state.prevMode = M.state.mode === 'ortho' ? M.state.prevMode : M.state.mode;
  M.state.mode = 'ortho';
  void M.render();
}

/** Test/diagnostic hook (read by the browser gate): live layout identity, solver call counts and geometry. */
export function exposeSpaceProbe(): void {
  const w = window as unknown as { __vsSpace?: unknown };
  if (w.__vsSpace) return;
  const ready = (): EmbedOutput | null => (spaceGeom?.layout.kind === 'ready' ? spaceGeom.layout.out : null);
  w.__vsSpace = {
    get runs() {
      return jobs?.runs ?? 0;
    },
    get cached() {
      return jobs?.size ?? 0;
    },
    get pending() {
      return jobs?.pendingCount ?? 0;
    },
    get workers() {
      return embedRunner?.workerCount ?? 0;
    },
    get layout() {
      return spaceGeom?.layout.kind ?? 'none';
    },
    get key() {
      return spaceGeom ? (SX.pooledLayoutKey() ?? layoutKey(spaceGeom.a)) : null;
    },
    get method() {
      return ready()?.result.method ?? null;
    },
    get status() {
      return ready()?.result.status ?? null;
    },
    get fitMs() {
      return ready()?.ms ?? null;
    },
    get stress1() {
      return ready()?.result.stress1 ?? null;
    },
    get lod() {
      return spaceGeom?.lod ?? null;
    },
    get coords() {
      const o = ready();
      return o ? Array.from(o.result.coords) : [];
    },
    get ids() {
      return ready()?.result.ids ?? [];
    },
    get placed() {
      const g = spaceGeom;
      return g ? g.points.map((p) => ({ id: g.a.ids[p.member], x: p.sx, y: p.sy, group: p.group?.map((q) => g.a.ids[q]) ?? null })) : [];
    },
    get notPlaced() {
      const g = spaceGeom;
      return g ? g.strip.map((m) => g.a.ids[m]) : [];
    },
    /** Drawn cells in any set layout (Montage/Facet/Space), with their crop -> screen mapping. */
    get thumbs() {
      return M.state.mode === 'ortho' ? [] : M.hits.map((h) => ({ id: h.member === 'mean' ? 'mean' : h.analysis.ids[h.member], contrast: h.analysis.contrast, dest: h.view.dest, crop: h.view.crop }));
    },
    get enlarged() {
      return spaceEnlarged;
    },
    get v2() {
      return { ...SX.opts, subset: [...SX.opts.subset], stability: SX.stabilityProgress() };
    },
    get neighbors() {
      return [...spaceNeighborIds];
    },
  };
}

function methodShort(method: string): string {
  return method === 'nmds' ? 'nonmetric MDS' : method === 'metric-smacof' ? 'metric MDS fallback' : 'exact placement, not MDS';
}

function methodName(method: string): string {
  return method === 'nmds' ? 'Nonmetric MDS, 2D' : method === 'metric-smacof' ? 'Metric MDS of 1 − r, 2D (fallback: the nonmetric fit was degenerate)' : 'Exact placement (n ≤ 3 or all ties; not NMDS)';
}

/** Side-panel section for Space: neighbours, fit diagnostics, provenance and the member list. */
/** One line a reader can trust at a glance: fit, how well local neighbourhoods survive, and solver robustness. */
function trustLine(a: M.Analysis): string {
  const g = spaceGeom;
  if (!g || g.a !== a || g.layout.kind !== 'ready') return 'Fitting…';
  const res = g.layout.out.result;
  const n = basisOf(a).eligible.length;
  if (res.method === 'exact' || res.method === 'none') return 'Placed exactly (too few maps for a fit).';
  const pres = neighborPreservation(basisOf(a).dist, res.coords, n);
  const pct = (x: number): string => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : 'n/a');
  // The same measure for the pictures as drawn (nudged centres), which is what the eye reads.
  let picPres = NaN;
  if (g.nudged && g.points.length === n) {
    const pic = new Float64Array(2 * n);
    const byPos = new Map(g.points.map((p) => [p.pos, p]));
    const repOf = (p: SpacePoint): SpacePoint => (p.group ? (g.points.find((q) => q.member === p.group![0]) ?? p) : p);
    for (let i = 0; i < n; i++) {
      const p = repOf(byPos.get(i)!);
      pic[2 * i] = p.tx ?? p.sx;
      pic[2 * i + 1] = p.ty ?? p.sy;
    }
    picPres = neighborPreservation(basisOf(a).dist, pic, n).mean;
  }
  // Near-tied alternatives: another start whose stress is within 0.5% of the best but not counted as reaching it.
  const best = res.stress1;
  const tol = Math.max(1e-6, 1e-4 * best);
  const runnerUp = res.starts.map((st) => st.stress1).filter((x) => x > best + tol).sort((x, y) => x - y)[0];
  const nearTie = runnerUp !== undefined && (runnerUp - best) / best < 0.005;
  const parts = [
    `${res.method === 'metric-smacof' ? 'metric ' : ''}Stress-1 <b>${fmtStress(res.stress1)}</b>`,
    `3 nearest kept: dots <b>${pct(pres.mean)}</b>${Number.isFinite(picPres) ? `, pictures as drawn <b>${pct(picPres)}</b>` : ''}`,
    `r ${M.fmtR(Math.min(...rRange(a)))} to ${M.fmtR(Math.max(...rRange(a)))}`,
    `best of ${res.starts.length} starts (${res.bestHits} reached it)${nearTie ? `; another start came within ${((100 * (runnerUp - best)) / best).toFixed(2)}%, so a somewhat different layout fits almost as well` : ''}`,
  ];
  return parts.join(' · ');
}

function rRange(a: M.Analysis): number[] {
  const n = basisOf(a).eligible.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push(1 - basisOf(a).dist[i * n + j]);
  return out.length ? out : [NaN];
}

export function spaceSection(a: M.Analysis): string {
  const b = basisOf(a);
  const g = spaceGeom;
  const sel = M.selectedMember(a);
  const placedN = b.eligible.length;
  const layout = g?.a === a ? g.layout : null;
  const support = `${b.support.length.toLocaleString()} of ${b.maskVoxels.toLocaleString()} mask voxels`;
  let fit = '';
  let nb = '';
  if (layout?.kind === 'ready') {
    const { result: res, ms } = layout.out;
    const status =
      res.status === 'converged'
        ? `converged after ${res.iterations} iterations`
        : res.status === 'max-iterations'
          ? `<span class="warnline">stopped at the iteration cap (${res.iterations}) before converging</span>`
          : res.status === 'degenerate-fallback'
            ? res.converged
              ? `converged after ${res.iterations} iterations`
              : `<span class="warnline">stopped at the iteration cap (${res.iterations}) before converging</span>`
            : `<span class="warnline">${res.message}</span>`;
    const metric = res.method === 'metric-smacof';
    fit = `<dl class="fx">
        <dt>Fit</dt><dd>${methodName(res.method)}; ${status}.</dd>
        <dt>Stress-1 (Kruskal)</dt><dd><b>${fmtStress(res.stress1)}</b> — √(Σ(d − d̂)² / Σd²), d̂ ${metric ? 'the best-fitting multiple b·(1 − r) (metric)' : 'the monotone fit'}. No universal good/bad cutoff.${metric && res.nmdsStress1 !== null ? ` Nonmetric fit: ${res.nmdsStress1.toExponential(1)} (collapsed).` : ''}</dd>
        ${res.method !== 'exact' && res.method !== 'none' ? `<dt>Starts</dt><dd>best of ${res.starts.length} (classical + ${res.starts.length - 1} seeded random); ${res.bestHits} reached it</dd>` : ''}
        <dt>Solver</dt><dd>${res.solver.name} ${res.solver.version}, seed ${res.params.seed}, ${Math.round(ms)} ms</dd>
      </dl>
      <canvas id="shepard" aria-label="Shepard plot: layout distance against 1 − r"></canvas>
      <p class="note">Shepard plot: each dot is a pair (1 − r → distance in the layout); the line is the ${metric ? 'linear (metric)' : 'monotone'} fit the stress measures against.</p>`;
    if (sel !== undefined && b.eligible.includes(sel)) {
      const p = b.eligible.indexOf(sel);
      const near = sourceNeighbors(b.dist, placedN, p, 3);
      const ranks = screenRanks(
        Array.from({ length: placedN }, (_, q) => [res.coords[2 * q], res.coords[2 * q + 1]] as [number, number]),
        p
      );
      const pres = neighborPreservation(b.dist, res.coords, placedN);
      const pv = pres.perPoint[p];
      const screenFirst = ranks.map((r, q) => (q !== p && r === 1 ? q : -1)).filter((q) => q >= 0);
      const notSource = screenFirst.filter((q) => !near.some((n) => n.index === q));
      const rows = near
        .map((n) => {
          const id = a.ids[b.eligible[n.index]];
          return `<tr><td class="num">${n.rank}</td><td class="id"><button data-pick="${id}">${id}</button></td><td class="num">${M.fmtR(1 - n.dissimilarity)}</td><td class="num">${ranks[n.index]}</td><td><button class="cmp" data-compare="${id}" title="Show where ${a.ids[sel]} and ${id} agree and disagree">compare</button></td></tr>`;
        })
        .join('');
      const mismatch = notSource.length
        ? `<p class="note">Nearest on screen: ${notSource.map((q) => `<b>${a.ids[b.eligible[q]]}</b> (source rank ${1 + Array.from({ length: placedN }, (_, z) => z).filter((z) => z !== p && b.dist[p * placedN + z] < b.dist[p * placedN + q]).length})`).join(', ')} — screen distance is a 2D approximation; the table is the truth.</p>`
        : '';
      nb = `<section>
        <h3>Neighbours <span class="sub">${a.ids[sel]}</span></h3>
        <table class="nb-table"><tr><th>rank</th><th>map</th><th>r</th><th>screen rank</th></tr>${rows}</table>
        ${mismatch}
        <p class="note">Nearest by 1 − r over ${basisOf(a).scope === 'subset' ? `the ${basisOf(a).support.length.toLocaleString()} voxels of the region (${basisOf(a).params.region})` : 'the whole common support'} (ties share a rank). Local preservation: <b>${Number.isFinite(pv) ? `${Math.round(pv * 100)}%` : 'n/a'}</b> — ${pres.definition}</p>
      </section>`;
    } else if (sel !== undefined) {
      const ex = b.excluded.find((e) => e.index === sel);
      nb = `<section><h3>Neighbours <span class="sub">${a.ids[sel]}</span></h3><p class="note warnline">Not placed: ${ex?.detail ?? 'excluded from the basis'}. Its map is still shown in every view.</p></section>`;
    }
  } else if (layout?.kind === 'error') {
    fit = `<p class="note warnline">Layout failed: ${layout.message}</p><div id="space-actions"><button class="ghost" id="space-retry">Retry (R)</button></div>`;
  } else if (layout?.kind === 'pending') {
    fit = '<p class="note">Fitting… other views stay usable.</p>';
  } else if (layout?.kind === 'none') {
    fit = `<p class="note warnline">${layout.message}</p>`;
  }
  const notPlaced = b.excluded.length
    ? `<dt>Not placed</dt><dd class="wrap">${b.excluded.map((e) => `<span class="nb">${e.id}</span>: ${e.detail}`).join('<br>')}</dd>`
    : '';
  const list = [...a.ids.keys()]
    .sort((x, y) => a.ids[x].localeCompare(a.ids[y]))
    .map((i) => {
      const out = !b.eligible.includes(i);
      return `<li><button data-pick="${a.ids[i]}" aria-current="${i === sel}" class="${out ? 'out' : ''}" title="${out ? 'not placed' : 'placed'}${spaceNeighborIds.has(a.ids[i]) ? ' · true neighbour of the focused map' : ''}">${a.ids[i]}</button></li>`;
    })
    .join('');
  return `${SX.panelHtml(a)}${nb}
    <section>
      <h3>Maps</h3>
      <ul class="space-members" aria-label="All maps; select to focus">${list}</ul>
      ${sel !== undefined ? `<div id="space-actions"><button class="ghost" id="space-open">Open ${a.ids[sel]} in Ortho</button><span class="note">or press Enter on the focused map</span></div>` : '<p class="note">Select a map to open it in Ortho (Enter).</p>'}
    </section>
    <section>
      <h3>Layout <span class="sub">${placedN} of ${a.set.size} placed</span></h3>
      ${layout?.kind === 'ready' ? `<p class="trust">${trustLine(a)}</p>` : fit}
      <p class="note">Positions summarise ${scopeLong(a)} and stay fixed while you change slice, threshold, smoothing or cluster filter. Pictures are nudged apart to avoid overlap; dots mark exact positions. Neither axis has a meaning; for who resembles whom, use the Neighbours table.</p>
      <details class="fit-details"${layout?.kind === 'ready' ? '' : ' open'}><summary>How the layout was fitted</summary>
        <dl class="fx">
          <dt>Similarity</dt><dd>signed Pearson r of raw ${M.STAT_LABEL[M.state.stat]}-maps on the common support (${support}); dissimilarity 1 − r</dd>
          ${notPlaced}
        </dl>
        ${layout?.kind === 'ready' ? fit : ''}
      </details>
    </section>`;
}

/** Wire the Space panel controls and draw its Shepard plot. */
export function wireSpaceSection(a: M.Analysis): void {
  SX.wirePanel(a);
  M.side.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((btn) => {
    btn.onclick = () => {
      M.state.subject = btn.dataset.pick!;
      spaceEnlarged = M.state.subject;
      M.scheduleDraw();
      // After the rebuild: bring the new Neighbours table into view and keep keyboard focus on the item.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          (M.side.querySelector('.nb-table') as HTMLElement | null)?.closest('section')?.scrollIntoView({ block: 'nearest' });
          (M.side.querySelector(`.space-members [data-pick="${CSS.escape(M.state.subject!)}"]`) as HTMLButtonElement | null)?.focus({ preventScroll: true });
        })
      );
    };
    btn.onkeydown = (e) => {
      // Enter on the already-focused map opens it (the first Enter/click selects it).
      if (e.key === 'Enter' && btn.dataset.pick === M.state.subject) {
        e.preventDefault();
        const m = M.selectedMember(a);
        if (m !== undefined) openOrtho(a, m);
      }
    };
    btn.onmouseenter = () => {
      M.setRailHover(btn.dataset.pick!);
      M.scheduleDraw(true);
    };
    btn.onmouseleave = () => {
      M.setRailHover(null);
      M.scheduleDraw(true);
    };
  });
  const open = M.side.querySelector('#space-open') as HTMLButtonElement | null;
  if (open) open.onclick = () => {
    const m = M.selectedMember(a);
    if (m !== undefined) openOrtho(a, m);
  };
  const retry = M.side.querySelector('#space-retry') as HTMLButtonElement | null;
  if (retry) retry.onclick = () => retryLayout();
  const c = M.side.querySelector('#shepard') as HTMLCanvasElement | null;
  const g = spaceGeom;
  if (!c || !g || g.layout.kind !== 'ready') return;
  const { pairs } = g.layout.out.result;
  const W = M.side.clientWidth;
  const H = 120;
  const ctx = hidpi(c, W, H);
  ctx.fillStyle = THEME.panelAlt;
  ctx.fillRect(0, 0, W, H);
  const n = pairs.dissimilarity.length;
  if (!n) return;
  let dmax = 0;
  let xmax = 0;
  let xmin = Infinity;
  for (let i = 0; i < n; i++) {
    dmax = Math.max(dmax, pairs.distance[i], pairs.disparity[i]);
    xmax = Math.max(xmax, pairs.dissimilarity[i]);
    xmin = Math.min(xmin, pairs.dissimilarity[i]);
  }
  const L = 44;
  const B = 18;
  const X = (v: number): number => L + ((v - xmin) / (xmax - xmin || 1)) * (W - L - 6);
  const Y = (v: number): number => H - B - (v / (dmax || 1)) * (H - B - 6);
  // Frame and y ticks (layout distance is in normalised layout units).
  ctx.strokeStyle = THEME.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(L + 0.5, 6.5, W - L - 6, H - B - 6);
  ctx.fillStyle = THEME.muted;
  ctx.font = `10px ${FONT.mono}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, dmax / 2, dmax]) {
    ctx.fillRect(L - 3, Math.round(Y(v)), 3, 1);
    ctx.fillText(v.toFixed(1), L - 5, Y(v));
  }
  ctx.fillStyle = 'rgba(230,230,239,0.45)';
  for (let i = 0; i < n; i++) ctx.fillRect(X(pairs.dissimilarity[i]) - 1, Y(pairs.distance[i]) - 1, 2, 2);
  const idx = [...Array(n).keys()].sort((p, q) => pairs.dissimilarity[p] - pairs.dissimilarity[q] || pairs.disparity[p] - pairs.disparity[q]);
  ctx.strokeStyle = THEME.brand;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  idx.forEach((i, k) => (k ? ctx.lineTo(X(pairs.dissimilarity[i]), Y(pairs.disparity[i])) : ctx.moveTo(X(pairs.dissimilarity[i]), Y(pairs.disparity[i]))));
  ctx.stroke();
  ctx.fillStyle = THEME.muted;
  ctx.font = `10px ${FONT.mono}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`1 − r ${M.fmtR(xmin)}`, L, H - 2);
  ctx.textAlign = 'right';
  ctx.fillText(M.fmtR(xmax), W - 4, H - 2);
  const s1 = g.layout.out.result.stress1;
  if (Number.isFinite(s1)) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = THEME.muted;
    ctx.fillText(`Stress-1 ${fmtStress(s1)}`, L + 4, 4);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(14, H - B);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('layout distance', 0, -6);
  ctx.restore();
}


/** Greedy word wrap to a pixel width (a word longer than the width gets its own line). */
function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** What the positions are computed from, in a few words (whole volume or the applied region). */
function scopeShort(a: M.Analysis): string {
  const b = basisOf(a);
  return b.scope === 'subset' ? `similarity in a ${SX.opts.region?.radiusMm ?? ''} mm sphere` : 'whole-volume similarity';
}

function scopeLong(a: M.Analysis): string {
  const b = basisOf(a);
  return b.scope === 'subset' ? `similarity within ${b.params.region} (${b.support.length.toLocaleString()} voxels)` : 'whole-volume similarity';
}

/**
 * Note for views outside Space that show the whole-brain basis while Space shows a regional one (the
 * similarity matrix); null when they agree.
 */
export function spaceBasisNote(a: M.Analysis): string | null {
  return M.state.mode === 'space' && basisOf(a).scope === 'subset' ? `Space currently uses similarity within ${basisOf(a).params.region}; this matrix is whole-brain.` : null;
}

/** Stress written like r elsewhere in the app (no leading zero), to three decimals. */
function fmtStress(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3).replace(/^0\./, '.') : '–';
}

export function setSpaceEnlarged(id: string | null): void {
  spaceEnlarged = id;
}

/** Release the embedding worker and settle pending fits (page teardown). */
export function disposeSpaceJobs(): void {
  jobs?.dispose();
  jobs = null;
  embedRunner = null;
}

// ---------------------------------------------------------------------------
// Space v2 hooks called from main.ts. Each is a strict no-op unless a v2 option or gesture is active.


export function readSpaceParams(q: URLSearchParams): void {
  SX.readParams(q);
}

export function writeSpaceParams(q: URLSearchParams): void {
  SX.writeParams(q);
}

/** Returns true when a Space v2 gesture consumed the event. */
export function onPointer(type: 'wheel' | 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerleave' | 'dblclick', e: MouseEvent): boolean {
  return SX.onPointer(type, e);
}

/** Returns true when a Space v2 key binding consumed the event. */
export function onKey(e: KeyboardEvent): boolean {
  return SX.onKey(e);
}

/** Rail accent for a subject (lasso subsets); null at defaults so the rail is unchanged. */
export function railAccent(subject: string): string | null {
  return SX.railAccent(subject);
}
