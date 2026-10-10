/**
 * Geometry helpers for the Space layout: embedding -> screen transform,
 * coincident-pattern groups, level of detail, directional keyboard navigation
 * and greedy label placement. No DOM access, so they are unit-tested directly.
 *
 * Embedding coordinates are never altered here: crowding is handled by level of
 * detail and overlays, not by moving points.
 */

export interface Viewport {
  /** Zoom factor relative to fit (1 = whole layout visible). */
  s: number;
  /** Embedding coordinate at the centre of the plot area. */
  cx: number;
  cy: number;
}

export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpaceTransform {
  /** Screen pixels per embedding unit (identical for both axes). */
  scale: number;
  toScreen(x: number, y: number): [number, number];
  toEmbed(sx: number, sy: number): [number, number];
  /** Viewport that this transform realises (centre and zoom). */
  viewport: Viewport;
}

/** Bounding box of interleaved 2D coordinates. */
export function bounds(coords: ArrayLike<number>): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < coords.length; i += 2) {
    const x = coords[i];
    const y = coords[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) return { x0: 0, x1: 0, y0: 0, y1: 0 };
  return { x0, x1, y0, y1 };
}

/**
 * Uniform-scale transform that fits the layout into `rect`, then applies the
 * viewport zoom/pan. Screen y grows downward; embedding axes carry no meaning,
 * so no flip is implied or needed.
 */
export function spaceTransform(coords: ArrayLike<number>, rect: PlotRect, viewport: Viewport | null): SpaceTransform {
  const b = bounds(coords);
  const spanX = b.x1 - b.x0;
  const spanY = b.y1 - b.y0;
  // A single point (or all coincident) gets an arbitrary but finite unit scale.
  const fit = Math.min(spanX > 0 ? rect.w / spanX : Infinity, spanY > 0 ? rect.h / spanY : Infinity);
  const base = Number.isFinite(fit) ? fit : Math.min(rect.w, rect.h) / 2;
  const vp: Viewport = viewport ?? { s: 1, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
  const scale = base * vp.s;
  const mx = rect.x + rect.w / 2;
  const my = rect.y + rect.h / 2;
  return {
    scale,
    viewport: vp,
    toScreen: (x, y) => [mx + (x - vp.cx) * scale, my + (y - vp.cy) * scale],
    toEmbed: (sx, sy) => [vp.cx + (sx - mx) / scale, vp.cy + (sy - my) / scale],
  };
}

/** Zoom about a screen point: the embedding point under it stays fixed. */
export function zoomAbout(t: SpaceTransform, rect: PlotRect, sx: number, sy: number, factor: number, min = 1, max = 40): Viewport {
  const s1 = Math.max(min, Math.min(max, t.viewport.s * factor));
  const f = t.viewport.s / s1;
  const [ex, ey] = t.toEmbed(sx, sy);
  return { s: s1, cx: ex + (t.viewport.cx - ex) * f, cy: ey + (t.viewport.cy - ey) * f };
}

/** Pan by a screen delta. */
export function panBy(t: SpaceTransform, dx: number, dy: number): Viewport {
  return { s: t.viewport.s, cx: t.viewport.cx - dx / t.scale, cy: t.viewport.cy - dy / t.scale };
}

/**
 * Groups of members whose dissimilarity is exactly 0 (identical spatial pattern
 * up to positive scale and offset; NOT necessarily identical files). Returns
 * groups of member positions (into the eligible list), each sorted, singletons
 * omitted. Union-find, so chains of exact zeros form one group.
 */
export function coincidentGroups(dist: ArrayLike<number>, m: number): number[][] {
  const parent = Array.from({ length: m }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) if (dist[i * m + j] === 0) parent[find(j)] = find(i);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < m; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export type Lod = 'thumbs' | 'marks';

/**
 * Thumbnail edge (px) and level of detail for n placed points in a plot area.
 * Thumbnails shrink with density and grow (gently) with zoom; below a readable
 * size the layout switches to anchor marks with labels, and maps appear on hover.
 */
export function thumbSize(n: number, rect: PlotRect, zoom: number): { size: number; lod: Lod } {
  const area = Math.max(1, rect.w * rect.h);
  const per = Math.sqrt(area / Math.max(1, n));
  const size = Math.min(150, Math.max(18, per * 0.45 * Math.sqrt(Math.max(1, zoom))));
  return { size: Math.round(size), lod: size >= 44 ? 'thumbs' : 'marks' };
}

/**
 * Nearest point in an arrow-key direction (screen space). Candidates must lie
 * within 67.5 degrees of the direction; score = distance along the direction +
 * 2 x perpendicular offset. Exact ties go to the lower index, so traversal is
 * deterministic. Returns -1 when nothing lies in that direction.
 */
export function directionalNeighbor(points: readonly [number, number][], from: number, dir: 'left' | 'right' | 'up' | 'down'): number {
  const [dx, dy] = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1];
  const [x0, y0] = points[from];
  const cosMin = Math.cos((67.5 * Math.PI) / 180);
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < points.length; i++) {
    if (i === from) continue;
    const vx = points[i][0] - x0;
    const vy = points[i][1] - y0;
    const d = Math.hypot(vx, vy);
    let along: number;
    let perp: number;
    if (d === 0) {
      // Coincident points: step through them in index order (right/down forward, left/up back).
      const forward = dx + dy > 0;
      if (forward ? i < from : i > from) continue;
      along = 0;
      perp = 0;
    } else {
      along = vx * dx + vy * dy;
      if (along / d < cosMin) continue;
      perp = Math.abs(vx * dy - vy * dx);
    }
    const score = along + 2 * perp + (d === 0 ? Math.abs(i - from) * 1e-9 : 0);
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && i < best)) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Greedy label placement: labels are tried in priority order (callers put the
 * focused/hovered members first) and kept only if they overlap no kept label
 * and no reserved rectangle. Returns indices of labels to draw.
 */
export function placeLabels(boxes: readonly LabelBox[], priority: readonly number[], reserved: readonly LabelBox[] = []): Set<number> {
  const kept: LabelBox[] = [...reserved];
  const out = new Set<number>();
  const overlaps = (a: LabelBox, b: LabelBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const i of priority) {
    const b = boxes[i];
    if (kept.some((k) => overlaps(b, k))) continue;
    kept.push(b);
    out.add(i);
  }
  return out;
}

/** Rank of each point by screen distance from point i (competition ranks, ties share). */
export function screenRanks(points: readonly [number, number][], i: number): number[] {
  const d = points.map(([x, y]) => Math.hypot(x - points[i][0], y - points[i][1]));
  return d.map((v, j) => (j === i ? 0 : 1 + d.filter((w, k) => k !== i && k !== j && w < v - 1e-9).length));
}

/**
 * Nudge equally sized boxes (centres `pts`, size w × h) apart until none overlap, staying close to their
 * anchors and inside `rect` (centres kept at least half a box from its edges). Deterministic: a fixed
 * number of separation passes, each pushing overlapping pairs apart along their axis of least overlap,
 * then a weak pull back toward the anchor. Returns new centres; anchors are not modified.
 */
export function declutter(
  pts: readonly { x: number; y: number }[],
  w: number,
  h: number,
  rect: PlotRect,
  iterations = 300,
  anchorClearance = 0
): { x: number; y: number }[] {
  const n = pts.length;
  const out = pts.map((p) => ({ x: p.x, y: p.y }));
  const clamp = (p: { x: number; y: number }): void => {
    p.x = Math.max(rect.x + w / 2, Math.min(rect.x + rect.w - w / 2, p.x));
    p.y = Math.max(rect.y + h / 2, Math.min(rect.y + rect.h - h / 2, p.y));
  };
  out.forEach(clamp);
  const separate = (): boolean => {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = out[i];
        const b = out[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const ox = w - Math.abs(dx);
        const oy = h - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        // Identical centres: separate deterministically by index.
        if (dx === 0 && dy === 0) {
          dx = j - i;
          dy = 0;
        }
        if (ox / w < oy / h) {
          const s = (ox / 2 + 0.01) * Math.sign(dx || 1);
          a.x -= s;
          b.x += s;
        } else {
          const s = (oy / 2 + 0.01) * Math.sign(dy || 1);
          a.y -= s;
          b.y += s;
        }
      }
    }
    for (let i = 0; i < n; i++) clamp(out[i]);
    return moved;
  };
  for (let it = 0; it < iterations; it++) {
    const moved = separate();
    // Gentle pull toward the anchor keeps pictures near their exact positions.
    for (let i = 0; i < n; i++) {
      out[i].x += (pts[i].x - out[i].x) * 0.02;
      out[i].y += (pts[i].y - out[i].y) * 0.02;
      clamp(out[i]);
    }
    if (!moved && it > 10) break;
  }
  // Finish with separation only, so the result has no overlaps whenever the rect has room.
  for (let it = 0; it < 200 && separate(); it++);
  if (anchorClearance > 0) {
    // Keep every exact position visible: no picture may cover another map's anchor (within the
    // clearance). Push the covering picture off the anchor along the shorter way out, then re-separate.
    const hw = w / 2 + anchorClearance;
    const hh = h / 2 + anchorClearance;
    const unclear = (): boolean => {
      let moved = false;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if (i === j) continue;
          const dx = pts[i].x - out[j].x;
          const dy = pts[i].y - out[j].y;
          const px = hw - Math.abs(dx);
          const py = hh - Math.abs(dy);
          if (px <= 0 || py <= 0) continue;
          moved = true;
          if (px / w < py / h) out[j].x -= (px + 0.01) * Math.sign(dx || (i < j ? -1 : 1));
          else out[j].y -= (py + 0.01) * Math.sign(dy || (i < j ? -1 : 1));
          clamp(out[j]);
        }
      }
      return moved;
    };
    for (let round = 0; round < 60; round++) {
      const a = unclear();
      let b = false;
      for (let it = 0; it < 20 && separate(); it++) b = true;
      if (!a && !b) break;
    }
  }
  return out;
}

/** Number of anchors lying inside (or within `clearance` of) a picture other than their own. */
export function coveredAnchors(anchors: readonly { x: number; y: number }[], boxes: readonly { x: number; y: number }[], w: number, h: number, clearance = 0): number {
  let k = 0;
  for (let i = 0; i < anchors.length; i++)
    for (let j = 0; j < boxes.length; j++)
      if (i !== j && Math.abs(anchors[i].x - boxes[j].x) < w / 2 + clearance && Math.abs(anchors[i].y - boxes[j].y) < h / 2 + clearance) {
        k++;
        break;
      }
  return k;
}

/** Largest pairwise overlap area between equal boxes centred at `pts` (0 means no overlap). */
export function maxOverlap(pts: readonly { x: number; y: number }[], w: number, h: number): number {
  let worst = 0;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const ox = w - Math.abs(pts[j].x - pts[i].x);
      const oy = h - Math.abs(pts[j].y - pts[i].y);
      if (ox > 0 && oy > 0) worst = Math.max(worst, ox * oy);
    }
  return worst;
}

export interface PositionMarker {
  /** Index into the anchors/centres passed in. */
  index: number;
  /**
   * 'dot' on open ground; 'ring' when the exact position lies inside another map's picture; 'own' when it still
   * lies inside the map's own picture (not drawn, since a dot there reads as a mark on the brain; counted instead).
   */
  kind: 'dot' | 'ring' | 'own';
  /** Distance (px) from the exact position to the picture centre. */
  nudge: number;
}

/**
 * Exact-position markers for nudged pictures (boxes w × h centred at `centres`). Every picture moved more
 * than `minNudge` from its anchor gets one, so no exact position is unaccounted for: a dot on open ground, a
 * ring when the anchor lies inside another map's picture (a plain dot there would read as a mark on that map),
 * or 'own' when the anchor still lies inside the map's own picture (left undrawn and counted).
 */
export function positionMarkers(anchors: readonly { x: number; y: number }[], centres: readonly { x: number; y: number }[], w: number, h: number, minNudge: number): PositionMarker[] {
  const out: PositionMarker[] = [];
  const inBox = (p: { x: number; y: number }, c: { x: number; y: number }): boolean => Math.abs(p.x - c.x) < w / 2 && Math.abs(p.y - c.y) < h / 2;
  for (let i = 0; i < anchors.length; i++) {
    const nudge = Math.hypot(centres[i].x - anchors[i].x, centres[i].y - anchors[i].y);
    if (!(nudge > minNudge)) continue;
    const foreign = centres.some((c, j) => j !== i && inBox(anchors[i], c));
    out.push({ index: i, kind: foreign ? 'ring' : inBox(anchors[i], centres[i]) ? 'own' : 'dot', nudge });
  }
  return out;
}

/** Overlap area of two rectangles (0 when disjoint). */
export function overlapArea(a: LabelBox, b: LabelBox): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

/**
 * Where to put a w × h caption inside `rect`, in order of preference: the four corners (bottom-left first),
 * then slid along the bottom and top edges, then along rows working up from the bottom. Candidates that do
 * not fit are left out; when nothing fits, the bottom-left corner (clipped) is the only candidate.
 */
export function captionCandidates(rect: PlotRect, w: number, h: number, inset = 8, step = 24): LabelBox[] {
  const x0 = rect.x + inset;
  const x1 = rect.x + rect.w - inset - w;
  const yb = rect.y + rect.h - inset - h;
  const yt = rect.y + inset;
  if (x1 < x0 || yb < yt) return [{ x: x0, y: Math.max(yt, yb), w, h }];
  const out: LabelBox[] = [];
  const row = (y: number): void => {
    for (let x = x0; x <= x1; x += step) out.push({ x, y, w, h });
    out.push({ x: x1, y, w, h });
  };
  out.push({ x: x0, y: yb, w, h }, { x: x1, y: yb, w, h }, { x: x0, y: yt, w, h }, { x: x1, y: yt, w, h });
  row(yb);
  row(yt);
  for (let y = yb - step; y > yt; y -= step) row(y);
  return out;
}

/**
 * Index of the first candidate overlapping none of `obstacles`; when every candidate overlaps something,
 * the one with the least overlapped area (earlier wins ties). -1 for no candidates.
 */
export function freeSpot(candidates: readonly LabelBox[], obstacles: readonly LabelBox[]): number {
  let best = -1;
  let bestArea = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    let area = 0;
    for (const o of obstacles) area += overlapArea(candidates[i], o);
    if (area === 0) return i;
    if (area < bestArea) {
      best = i;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Short contrast names for one-line table rows: a prefix shared with another contrast is dropped
 * (delayearly, delaylate -> early, late), unless that would leave two names equal or one empty.
 */
export function shortContrastNames(names: readonly string[]): string[] {
  const out = names.map((c) => {
    let cut = 0;
    for (const o of names) {
      if (o === c) continue;
      let k = 0;
      while (k < c.length && k < o.length && c[k] === o[k]) k++;
      cut = Math.max(cut, k);
    }
    return cut >= 3 && cut < c.length ? c.slice(cut) : c;
  });
  return new Set(out).size === out.length && !out.some((x, i) => x !== names[i] && names.includes(x)) ? out : [...names];
}

/**
 * Caption for nudged pictures: how many moved, which are marked (dots, rings) and which are only counted
 * (position still inside the map's own picture, or moved too little to mark). Empty when nothing moved.
 */
export function nudgeCaption(n: { dots: number; rings: number; own: number; slight: number; slightPx: number }): string {
  const moved = n.dots + n.rings + n.own + n.slight;
  if (!moved) return '';
  const marked = [n.dots ? 'dots mark exact positions' : '', n.rings ? 'rings those inside another picture' : ''].filter(Boolean).join(', ');
  const unmarked = [n.own ? `${n.own} still over ${n.own === 1 ? 'its' : 'their'} own picture` : '', n.slight ? `${n.slight} moved ≤ ${n.slightPx} px` : ''].filter(Boolean).join(', ');
  return ` · ${moved} ${moved === 1 ? 'picture' : 'pictures'} nudged apart${marked ? `: ${marked}` : ''}${unmarked ? `; unmarked: ${unmarked}` : ''}`;
}
