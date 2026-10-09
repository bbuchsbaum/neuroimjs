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
