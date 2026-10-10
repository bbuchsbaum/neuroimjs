/**
 * Peek: a small floating slice viewer for one subject's map, opened by clicking a picture in Space.
 * It has its own plane and slice (slider, wheel), follows the shared display settings (threshold,
 * range, smoothing, minimum cluster, contrast, statistic), and is dismissed with ×, Escape, a click
 * on empty Space, or leaving Space. A click inside places the shared cursor; a double-click opens Ortho.
 */
import { slicePixelToGrid, gridToSlicePixel, type SetOrientation } from '../../src/volumeset/VolumeSet';
import * as M from './main';
import { placeCrop, drawCellImage, drawCrosshair, drawOrientationLetters, hidpi, fmt, type CellView } from './render';

interface PeekState {
  subject: string;
  /** A contrast pinned by opening from another contrast's panel; null follows the shared contrast. */
  contrast: string | null;
  orient: SetOrientation;
  slice: number;
}

let peek: PeekState | null = null;
let el: HTMLDivElement | null = null;
let view: CellView | null = null;
let hoverIjk: [number, number, number] | null = null;
let drawToken = 0;

const ORIENT_KEYS: [SetOrientation, string][] = [
  ['axial', 'A'],
  ['coronal', 'C'],
  ['sagittal', 'S'],
];

/** Largest picture side in CSS px; the scale is a whole number of pixels per voxel so voxels stay crisp. */
const MAX_SIDE = 300;

export function isPeekOpen(): boolean {
  return peek !== null;
}

/** Open (or retarget) the peek on a subject at a voxel, near a client-space anchor point. */
export function openPeek(subject: string, contrast: string, ijk: readonly number[], anchor: { x: number; y: number }): void {
  const wasOpen = peek !== null;
  const orient = peek?.orient ?? M.state.orient;
  peek = { subject, contrast: contrast === M.state.contrast ? null : contrast, orient, slice: ijk[M.AXIS[orient]] };
  hoverIjk = null;
  const box = ensureEl();
  void draw().then(() => place(box, anchor, wasOpen));
}

export function closePeek(): void {
  peek = null;
  view = null;
  hoverIjk = null;
  el?.remove();
  el = null;
}

/** Client-space centre of a subject's picture in the current Space drawing (null if it is not drawn). */
function pictureCentre(subject: string): { x: number; y: number } | null {
  const cv = document.querySelector('#view canvas')?.getBoundingClientRect();
  if (!cv) return null;
  const h = M.hits.find((q) => q.member !== 'mean' && q.analysis.contrast === M.state.contrast && String(q.analysis.set.members[q.member].meta.subject) === subject);
  return h ? { x: cv.left + h.view.dest.x + h.view.dest.w / 2, y: cv.top + h.view.dest.y + h.view.dest.h / 2 } : null;
}

/** P key: open the peek on a subject (at the shared cursor's plane), or close it if it already shows that subject. */
export function togglePeekFor(subject: string): void {
  if (peek?.subject === subject) {
    closePeek();
    return;
  }
  const c = M.state.cursor;
  const anchor = pictureCentre(subject) ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  openPeek(subject, M.state.contrast, c ?? [-1, -1, -1], anchor);
}

/**
 * Redraw after a shared-state change (display settings, contrast, mode); closes when no longer applicable.
 * Follows the focused map: selecting another subject (arrow keys, ID labels, the Maps list) retargets it.
 */
export function syncPeek(): void {
  if (!peek) return;
  if (M.state.mode !== 'space') {
    closePeek();
    return;
  }
  const s = M.state.subject;
  if (s && s !== peek.subject) {
    peek.subject = s;
    peek.contrast = null;
    hoverIjk = null;
    const box = el;
    const anchor = pictureCentre(s);
    void draw().then(() => {
      if (box && anchor) place(box, anchor, true);
    });
    return;
  }
  void draw();
}

function ensureEl(): HTMLDivElement {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'peek';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Subject slice viewer');
  el.innerHTML = `
    <div class="peek-head">
      <span class="peek-id"></span><span class="peek-meta"></span>
      <span class="peek-orient seg" role="group" aria-label="Peek plane">${ORIENT_KEYS.map(([o, k]) => `<button data-peek-orient="${o}" title="${M.ORIENT_NAME[o]}">${k}</button>`).join('')}</span>
      <button class="ghost peek-ortho" title="Open this map in Ortho at the cursor">Ortho</button>
      <button class="ghost peek-close" aria-label="Close (Esc)" title="Close (Esc)">×</button>
    </div>
    <canvas class="peek-img"></canvas>
    <label class="peek-slice"><input type="range" min="0" step="1" /><span class="peek-slice-label mono"></span></label>
    <div class="peek-read mono"></div>`;
  document.body.appendChild(el);
  const cv = el.querySelector<HTMLCanvasElement>('.peek-img')!;
  const input = el.querySelector<HTMLInputElement>('.peek-slice input')!;
  el.querySelector('.peek-close')!.addEventListener('click', closePeek);
  el.querySelector('.peek-ortho')!.addEventListener('click', () => {
    if (!peek) return;
    M.openOrthoAt(peek.subject, cursorOnPeekPlane());
  });
  el.querySelectorAll<HTMLButtonElement>('[data-peek-orient]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!peek) return;
      const o = b.dataset.peekOrient as SetOrientation;
      if (o === peek.orient) return;
      const c = M.state.cursor;
      peek.orient = o;
      peek.slice = c ? c[M.AXIS[o]] : -1;
      void draw();
    })
  );
  input.addEventListener('input', () => setSlice(Number(input.value)));
  // Keys typed in the slider stay local (the page ignores keys in inputs); Escape still closes.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePeek();
    }
  });
  cv.addEventListener(
    'wheel',
    (e) => {
      if (!peek) return;
      e.preventDefault();
      if (Math.abs(e.deltaY) < 1) return;
      setSlice(peek.slice + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false }
  );
  cv.addEventListener('pointermove', (e) => {
    hoverIjk = ijkAt(cv, e);
    void draw();
  });
  cv.addEventListener('pointerleave', () => {
    hoverIjk = null;
    void draw();
  });
  cv.addEventListener('click', (e) => {
    const ijk = ijkAt(cv, e);
    if (ijk) M.placeCursor(ijk);
  });
  cv.addEventListener('dblclick', (e) => {
    const ijk = ijkAt(cv, e);
    if (ijk && peek) M.openOrthoAt(peek.subject, ijk);
  });
  dragByHead(el);
  return el;
}

function setSlice(i: number): void {
  if (!peek) return;
  peek.slice = i;
  // The pointer has not moved, but the voxel under it is now on the new plane.
  if (hoverIjk) hoverIjk[M.AXIS[peek.orient]] = Math.max(0, Math.min((M.lastRail?.a.set.sliceCount(peek.orient) ?? 1) - 1, Math.round(i)));
  void draw();
}

/** The shared cursor moved onto the peek's plane (or the plane's centre when there is no cursor). */
function cursorOnPeekPlane(): [number, number, number] {
  const p = peek!;
  const c = M.state.cursor;
  const g: [number, number, number] = c ? [c[0], c[1], c[2]] : [0, 0, 0];
  if (!c) {
    const dim = M.lastRail?.a.set.dim ?? [1, 1, 1];
    g[0] = Math.floor(dim[0] / 2);
    g[1] = Math.floor(dim[1] / 2);
    g[2] = Math.floor(dim[2] / 2);
  }
  g[M.AXIS[p.orient]] = p.slice;
  return g;
}

function ijkAt(cv: HTMLCanvasElement, e: MouseEvent): [number, number, number] | null {
  if (!peek || !view || !M.lastRail) return null;
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  if (!view.contains(x, y)) return null;
  const [col, row] = view.toSlice(x, y);
  const dim = M.lastRail.a.set.dim;
  const ijk = slicePixelToGrid(dim, peek.orient, peek.slice, col, row);
  return ijk.every((v, d) => v >= 0 && v < dim[d]) ? ijk : null;
}

async function draw(): Promise<void> {
  if (!peek || !el) return;
  const token = ++drawToken;
  const a = await M.getAnalysis(M.state.model, peek.contrast ?? M.state.contrast, M.state.stat);
  if (token !== drawToken || !peek || !el) return;
  const member = a.set.where({ subject: peek.subject })[0];
  if (member === undefined) {
    closePeek();
    return;
  }
  const p = peek;
  const set = a.set;
  const n = set.sliceCount(p.orient);
  if (!(p.slice >= 0)) p.slice = Math.floor(n / 2);
  p.slice = Math.max(0, Math.min(n - 1, Math.round(p.slice)));

  const meta = set.members[member].meta;
  el.querySelector('.peek-id')!.textContent = p.subject;
  el.querySelector('.peek-meta')!.textContent = `${M.state.model} · ${meta.contrast} · ${M.STAT_LABEL[M.state.stat] ?? M.state.stat}`;
  el.querySelectorAll<HTMLButtonElement>('[data-peek-orient]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.peekOrient === p.orient)));

  // Picture: the whole brain box at a whole number of screen pixels per voxel, physical aspect kept.
  // One scale and one canvas box for all three planes, so switching plane never resizes or moves the panel.
  const planes = ORIENT_KEYS.map(([o]) => {
    const ps = M.planePixelSize(set, o);
    const m = Math.min(ps[0], ps[1]);
    const rel: [number, number] = m > 0 ? [ps[0] / m, ps[1] / m] : [1, 1];
    const crop = M.brainBox(set, o);
    return { o, crop, rel, w: crop.w * rel[0], h: crop.h * rel[1] };
  });
  const s = Math.max(1, Math.floor(Math.min(...planes.map((q) => Math.min(MAX_SIDE / q.w, MAX_SIDE / q.h)))));
  const W = Math.round(Math.max(...planes.map((q) => q.w)) * s);
  const H = Math.round(Math.max(...planes.map((q) => q.h)) * s);
  const pl = planes.find((q) => q.o === p.orient)!;
  const crop = pl.crop;
  const pw = Math.round(pl.w * s);
  const ph = Math.round(pl.h * s);
  const cv = el.querySelector<HTMLCanvasElement>('.peek-img')!;
  // Fixed panel width: long readouts truncate rather than resize the panel.
  el.style.width = `${W + 18}px`; // 8 px padding + 1 px border each side (border-box)
  const ctx = hidpi(cv, W, H);
  ctx.clearRect(0, 0, W, H);
  const v = placeCrop(crop, { x: Math.floor((W - pw) / 2), y: Math.floor((H - ph) / 2), w: pw, h: ph }, pl.rel);
  view = v;
  ctx.fillStyle = '#000';
  ctx.fillRect(v.dest.x, v.dest.y, v.dest.w, v.dest.h);
  drawCellImage(ctx, M.underImage(a, p.orient, p.slice), M.overImage(a, member, p.orient, p.slice), v);
  const c = M.state.cursor;
  if (c) {
    const [col, row] = gridToSlicePixel(set.dim, p.orient, c);
    // Full strength on the cursor's own plane; faint (a projection) elsewhere.
    drawCrosshair(ctx, v, col, row, c[M.AXIS[p.orient]] === p.slice ? 0.75 : 0.3);
  }
  drawOrientationLetters(ctx, v.dest, p.orient, 10);

  const input = el.querySelector<HTMLInputElement>('.peek-slice input')!;
  input.max = String(n - 1);
  if (input.value !== String(p.slice)) input.value = String(p.slice);
  const label = M.planeLabel(set, p.orient, p.slice);
  el.querySelector('.peek-slice-label')!.textContent = label;
  input.setAttribute('aria-label', `${p.subject} ${M.ORIENT_NAME[p.orient]} slice`);
  input.setAttribute('aria-valuetext', label);

  // Readout: raw value (as everywhere else) under the pointer, else at the cursor when it is on this plane.
  const at = hoverIjk ?? (c && c[M.AXIS[p.orient]] === p.slice ? c : null);
  const read = el.querySelector('.peek-read')!;
  if (at) {
    const val = set.valueAt(set.members[member].values, at);
    const mm = (set.space.gridToCoord([...at]) as number[]).map((w) => fmt(w, 1)).join(', ');
    read.textContent = `${M.STAT_LABEL[M.state.stat] ?? M.state.stat} ${Number.isFinite(val) ? fmt(val, 2) : '–'} at ${mm} mm${hoverIjk ? '' : ' (cursor)'}`;
  } else read.textContent = 'Click: cursor · Double-click: Ortho · Wheel: slice · Esc';
  (window as unknown as { __vsPeek?: unknown }).__vsPeek = { subject: p.subject, orient: p.orient, slice: p.slice, n, view: { ...v.dest } };
}

/**
 * Where the panel covers the fewest pictures: never the one it shows (weighted heavily), then other maps,
 * with a mild pull towards the source and, when retargeting, towards where it already is. Always inside the
 * Space stage, so it never covers the side panel.
 */
function place(box: HTMLDivElement, anchor: { x: number; y: number }, retarget: boolean): void {
  const r = box.getBoundingClientRect();
  const st = document.querySelector('#view')?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  const cv = document.querySelector('#view canvas')?.getBoundingClientRect() ?? st;
  const obstacles = M.hits.map((h) => {
    const d = h.view.dest;
    const rect = { x: cv.left + d.x, y: cv.top + d.y, w: d.w, h: d.h };
    const isSource = anchor.x >= rect.x && anchor.x < rect.x + rect.w && anchor.y >= rect.y && anchor.y < rect.y + rect.h;
    return { ...rect, weight: isSource ? 6 : h.member === 'mean' ? 0.5 : 1 };
  });
  const cost = (x: number, y: number): number => {
    let c = 0;
    for (const o of obstacles) {
      const ox = Math.max(0, Math.min(x + r.width, o.x + o.w) - Math.max(x, o.x));
      const oy = Math.max(0, Math.min(y + r.height, o.y + o.h) - Math.max(y, o.y));
      c += ox * oy * o.weight;
    }
    const dx = Math.max(0, x - anchor.x, anchor.x - (x + r.width));
    const dy = Math.max(0, y - anchor.y, anchor.y - (y + r.height));
    return c + 12 * Math.hypot(dx, dy);
  };
  const x0 = st.left + 8;
  const y0 = st.top + 8;
  const x1 = Math.max(x0, st.right - r.width - 8);
  const y1 = Math.max(y0, st.bottom - r.height - 8);
  const clamp = (x: number, y: number): [number, number] => [Math.max(x0, Math.min(x1, x)), Math.max(y0, Math.min(y1, y))];
  let best = clamp(anchor.x + 28, anchor.y - r.height / 2);
  let bestCost = cost(...best);
  const consider = (x: number, y: number, bias = 0): void => {
    const [cx, cy] = clamp(x, y);
    const c = cost(cx, cy) + bias;
    if (c < bestCost) {
      best = [cx, cy];
      bestCost = c;
    }
  };
  // Staying put wins unless moving clearly uncovers pictures (≈ half a thumbnail), so browsing does not make it jump.
  if (retarget) consider(r.left, r.top, -4000);
  consider(anchor.x - 28 - r.width, anchor.y - r.height / 2);
  const step = 16;
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) consider(x, y);
  box.style.left = `${best[0]}px`;
  box.style.top = `${best[1]}px`;
  clampToViewport(box);
}

function clampToViewport(box: HTMLDivElement): void {
  const r = box.getBoundingClientRect();
  const x = Math.max(8, Math.min(window.innerWidth - r.width - 8, r.left));
  const y = Math.max(8, Math.min(window.innerHeight - r.height - 8, r.top));
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
}

/** The header is a drag handle (buttons keep their clicks). */
function dragByHead(box: HTMLDivElement): void {
  const head = box.querySelector<HTMLDivElement>('.peek-head')!;
  let start: { x: number; y: number; l: number; t: number } | null = null;
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = box.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!start) return;
    box.style.left = `${start.l + e.clientX - start.x}px`;
    box.style.top = `${start.t + e.clientY - start.y}px`;
  });
  head.addEventListener('pointerup', () => {
    if (start) clampToViewport(box);
    start = null;
  });
}
