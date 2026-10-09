import { describe, it, expect } from 'vitest';
import {
  declutter,
  coveredAnchors,
  maxOverlap,
  spaceTransform,
  zoomAbout,
  panBy,
  coincidentGroups,
  thumbSize,
  directionalNeighbor,
  placeLabels,
  screenRanks,
} from '../examples/volume-set/space';

const rect = { x: 100, y: 50, w: 400, h: 200 };

describe('Space screen transform', () => {
  const coords = Float64Array.from([-2, -1, 2, 1, 0, 0.5]);

  it('uses one scale for both axes and fits the layout inside the plot', () => {
    const t = spaceTransform(coords, rect, null);
    // x span 4 -> 400 px would allow 100 px/unit, y span 2 -> 200 px also 100: equal here, so pick a wider rect.
    const t2 = spaceTransform(coords, { x: 0, y: 0, w: 800, h: 200 }, null);
    expect(t.scale).toBe(100);
    expect(t2.scale).toBe(100); // limited by height, not stretched to width
    const [ax, ay] = t2.toScreen(-2, -1);
    const [bx, by] = t2.toScreen(2, 1);
    // Equal aspect: a unit step in x and in y cover the same number of pixels.
    expect((bx - ax) / 4).toBeCloseTo((by - ay) / 2, 12);
    for (let i = 0; i < 3; i++) {
      const [sx, sy] = t.toScreen(coords[2 * i], coords[2 * i + 1]);
      expect(sx).toBeGreaterThanOrEqual(rect.x - 1e-9);
      expect(sx).toBeLessThanOrEqual(rect.x + rect.w + 1e-9);
      expect(sy).toBeGreaterThanOrEqual(rect.y - 1e-9);
      expect(sy).toBeLessThanOrEqual(rect.y + rect.h + 1e-9);
      const [ex, ey] = t.toEmbed(sx, sy);
      expect(ex).toBeCloseTo(coords[2 * i], 12);
      expect(ey).toBeCloseTo(coords[2 * i + 1], 12);
    }
  });

  it('zooms about the pointer and pans without touching data coordinates', () => {
    const before = Array.from(coords);
    const t = spaceTransform(coords, rect, null);
    const [px, py] = t.toScreen(2, 1);
    const vp = zoomAbout(t, rect, px, py, 3);
    const t3 = spaceTransform(coords, rect, vp);
    expect(t3.scale).toBeCloseTo(300, 9);
    const [qx, qy] = t3.toScreen(2, 1);
    expect(qx).toBeCloseTo(px, 9);
    expect(qy).toBeCloseTo(py, 9);
    const t4 = spaceTransform(coords, rect, panBy(t3, 30, -12));
    const [rx, ry] = t4.toScreen(2, 1);
    expect(rx - qx).toBeCloseTo(30, 9);
    expect(ry - qy).toBeCloseTo(-12, 9);
    expect(Array.from(coords)).toEqual(before);
    // Zoom is clamped to [1, 40].
    expect(zoomAbout(t, rect, px, py, 0.1).s).toBe(1);
    expect(zoomAbout(t, rect, px, py, 1000).s).toBe(40);
  });

  it('handles a single point and coincident points with a finite scale', () => {
    const t = spaceTransform(Float64Array.from([3, 3, 3, 3]), rect, null);
    expect(Number.isFinite(t.scale)).toBe(true);
    expect(t.toScreen(3, 3)).toEqual([rect.x + rect.w / 2, rect.y + rect.h / 2]);
  });
});

describe('Space helpers', () => {
  it('groups exact-zero dissimilarities transitively and ignores near-zero', () => {
    const d = [0, 0, 1e-9, 1, 0, 0, 1e-9, 1, 1e-9, 1e-9, 0, 1, 1, 1, 1, 0];
    expect(coincidentGroups(d, 4)).toEqual([[0, 1]]);
    const chain = [0, 0, 1, 0, 0, 0, 1, 0, 0];
    expect(coincidentGroups(chain, 3)).toEqual([[0, 1, 2]]);
    expect(coincidentGroups([0], 1)).toEqual([]);
  });

  it('shrinks thumbnails with density and switches to marks when unreadable', () => {
    const r = { x: 0, y: 0, w: 1000, h: 700 };
    const few = thumbSize(17, r, 1);
    const many = thumbSize(200, r, 1);
    expect(few.lod).toBe('thumbs');
    expect(many.size).toBeLessThan(few.size);
    expect(many.lod).toBe('marks');
    expect(thumbSize(200, r, 16).lod).toBe('thumbs');
    expect(thumbSize(1, r, 1).size).toBeLessThanOrEqual(150);
  });

  it('navigates by direction deterministically, including ties and coincident points', () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 0.0],
      [0, 10],
      [-10, -1],
      [0, 0],
    ];
    const noDup = pts.slice(0, 5);
    // Right: points 1 and 2 tie exactly -> lower index.
    expect(directionalNeighbor(noDup, 0, 'right')).toBe(1);
    expect(directionalNeighbor(noDup, 0, 'down')).toBe(3); // screen y grows downward
    expect(directionalNeighbor(noDup, 0, 'left')).toBe(4);
    expect(directionalNeighbor(noDup, 3, 'down')).toBe(-1);
    // Coincident points 0 and 5 are stepped through first (forward keys go to the later index,
    // backward keys to the earlier), then traversal continues past them.
    expect(directionalNeighbor(pts, 0, 'right')).toBe(5);
    expect(directionalNeighbor(pts, 5, 'right')).toBe(1);
    expect(directionalNeighbor(pts, 5, 'left')).toBe(0);
    expect(directionalNeighbor(pts, 0, 'left')).toBe(4);
    expect(directionalNeighbor([[0, 0], [0, 0]], 0, 'right')).toBe(1);
    expect(directionalNeighbor([[0, 0], [0, 0]], 1, 'left')).toBe(0);
  });

  it('places labels greedily by priority without overlap', () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 5, y: 5, w: 10, h: 10 },
      { x: 20, y: 0, w: 10, h: 10 },
    ];
    expect([...placeLabels(boxes, [1, 0, 2])].sort()).toEqual([1, 2]);
    expect([...placeLabels(boxes, [0, 1, 2], [{ x: 18, y: 0, w: 5, h: 5 }])]).toEqual([0]);
  });

  it('ranks screen distances with shared ranks for ties', () => {
    expect(screenRanks([[0, 0], [1, 0], [0, 1], [3, 0]], 0)).toEqual([0, 1, 1, 3]);
  });
});

describe('declutter', () => {
  const rect = { x: 0, y: 0, w: 1000, h: 700 };

  it('removes all overlap for a dense core with room around it', () => {
    // 13 pictures piled near one point (like the real cue core) plus 4 isolates.
    const pts = [
      ...Array.from({ length: 13 }, (_, i) => ({ x: 500 + 8 * Math.cos(i), y: 350 + 8 * Math.sin(i * 1.7) })),
      { x: 60, y: 60 },
      { x: 940, y: 80 },
      { x: 900, y: 640 },
      { x: 90, y: 620 },
    ];
    expect(maxOverlap(pts, 90, 110)).toBeGreaterThan(0);
    const out = declutter(pts, 90, 110, rect);
    expect(maxOverlap(out, 90, 110)).toBe(0);
    // Stays inside the plot.
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(45);
      expect(p.x).toBeLessThanOrEqual(955);
      expect(p.y).toBeGreaterThanOrEqual(55);
      expect(p.y).toBeLessThanOrEqual(645);
    }
    // Isolates barely move.
    for (let i = 13; i < 17; i++) expect(Math.hypot(out[i].x - pts[i].x, out[i].y - pts[i].y)).toBeLessThan(5);
  });

  it('is deterministic, leaves non-overlapping boxes alone and does not mutate its input', () => {
    const pts = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 100, y: 101 },
    ];
    const copy = pts.map((p) => ({ ...p }));
    const a = declutter(pts, 50, 50, rect);
    const b = declutter(pts, 50, 50, rect);
    expect(a).toEqual(b);
    expect(pts).toEqual(copy);
    expect(Math.hypot(a[1].x - 300, a[1].y - 100)).toBeLessThan(1e-9);
    expect(maxOverlap(a, 50, 50)).toBe(0);
  });

  it('with anchor clearance, no picture covers another map\'s exact position (when there is room)', () => {
    const pts = [
      ...Array.from({ length: 13 }, (_, i) => ({ x: 500 + 8 * Math.cos(i), y: 350 + 8 * Math.sin(i * 1.7) })),
      { x: 60, y: 60 },
      { x: 940, y: 80 },
      { x: 900, y: 640 },
      { x: 90, y: 620 },
    ];
    const plain = declutter(pts, 90, 110, rect);
    expect(coveredAnchors(pts, plain, 90, 110, 4)).toBeGreaterThan(0);
    const out = declutter(pts, 90, 110, rect, 300, 4);
    expect(coveredAnchors(pts, out, 90, 110, 4)).toBe(0);
    expect(maxOverlap(out, 90, 110)).toBe(0);
    expect(declutter(pts, 90, 110, rect, 300, 4)).toEqual(out);
  });

  it('separates identical positions', () => {
    const pts = [
      { x: 500, y: 300 },
      { x: 500, y: 300 },
    ];
    expect(maxOverlap(declutter(pts, 40, 40, rect), 40, 40)).toBe(0);
  });
});
