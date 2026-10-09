import { describe, it, expect } from 'vitest';
import { pairContributions, sumOver } from '../src/volumeset/contrib';
import { procrustesAlign, alignById } from '../src/volumeset/procrustes';
import { kde2d, isoContours, densityLevels, gridToLayout, scottBandwidth } from '../src/volumeset/contours';
import { fisheye, inverseFisheye } from '../src/volumeset/lens';
import { stressShares } from '../src/volumeset/fitShares';

// ---------------------------------------------------------------------------
// Independent helpers
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gauss(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** Textbook Pearson r: Σ(x−x̄)(y−ȳ) / √(Σ(x−x̄)² Σ(y−ȳ)²). */
function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function randomPair(seed: number, len = 500) {
  const rnd = lcg(seed);
  const a = new Float32Array(len);
  const b = new Float32Array(len);
  const support: number[] = [];
  for (let v = 0; v < len; v++) {
    if (rnd() < 0.3) {
      a[v] = NaN;
      b[v] = rnd() < 0.5 ? NaN : 3;
    } else {
      const s = gauss(rnd);
      a[v] = s + 0.8 * gauss(rnd);
      b[v] = 0.6 * s + gauss(rnd);
      support.push(v);
    }
  }
  return { a, b, support };
}

// ---------------------------------------------------------------------------
// V2-01 contributions
// ---------------------------------------------------------------------------

describe('pairContributions', () => {
  it('sums to the textbook Pearson r on the support', () => {
    for (const seed of [1, 2, 3]) {
      const { a, b, support } = randomPair(seed);
      const res = pairContributions(a, b, support);
      const ref = pearson(
        support.map((v) => a[v]),
        support.map((v) => b[v]),
      );
      let s = 0;
      for (const v of support) s += res.contrib[v];
      expect(res.r).toBeCloseTo(ref, 10);
      expect(s).toBeCloseTo(ref, 5); // Float32 storage of the terms
      expect(res.n).toBe(support.length);
      expect(res.positive + res.negative).toBeCloseTo(ref, 10);
      expect(res.positive).toBeGreaterThan(0);
      expect(res.negative).toBeLessThanOrEqual(0);
      // NaN everywhere off the support
      const on = new Set(support);
      for (let v = 0; v < a.length; v++) if (!on.has(v)) expect(Number.isNaN(res.contrib[v])).toBe(true);
    }
  });

  it('is symmetric, flips sign with a negated map, and is invariant to affine rescaling', () => {
    const { a, b, support } = randomPair(7);
    const ab = pairContributions(a, b, support);
    const ba = pairContributions(b, a, support);
    const negB = pairContributions(a, b.map((x) => -x), support);
    const affine = pairContributions(
      a.map((x) => 3.5 * x + 100),
      b.map((x) => 0.25 * x - 7),
      support,
    );
    for (const v of support) {
      expect(ba.contrib[v]).toBeCloseTo(ab.contrib[v], 6);
      expect(negB.contrib[v]).toBeCloseTo(-ab.contrib[v], 6);
      expect(affine.contrib[v]).toBeCloseTo(ab.contrib[v], 5);
    }
    expect(negB.r).toBeCloseTo(-ab.r, 10);
    expect(negB.positive).toBeCloseTo(-ab.negative, 10);
    expect(affine.r).toBeCloseTo(ab.r, 5);
  });

  it('throws on a map that is constant on the support', () => {
    const a = new Float32Array([1, 2, 3, 4, 5]);
    const b = new Float32Array([2, 2, 2, 2, 9]);
    expect(() => pairContributions(a, b, [0, 1, 2, 3])).toThrow(/constant/);
    expect(() => pairContributions(b, a, [0, 1, 2, 3])).toThrow(/constant/);
    expect(() => pairContributions(a, b, [])).toThrow();
  });

  it('sumOver gives the share of r from a subset and partitions r', () => {
    const { a, b, support } = randomPair(11);
    const res = pairContributions(a, b, support);
    const first = support.slice(0, 100);
    const rest = support.slice(100);
    let manual = 0;
    for (const v of first) manual += res.contrib[v];
    expect(sumOver(res.contrib, first)).toBeCloseTo(manual, 12);
    expect(sumOver(res.contrib, first) + sumOver(res.contrib, rest)).toBeCloseTo(res.r, 5);
    // Positions off the support (NaN) and out of range are ignored.
    expect(sumOver(res.contrib, [...first, -1, 1e9])).toBeCloseTo(manual, 12);
    const all = Array.from({ length: a.length }, (_, i) => i);
    expect(sumOver(res.contrib, all)).toBeCloseTo(res.r, 5);
  });
});

// ---------------------------------------------------------------------------
// V2-06 Procrustes
// ---------------------------------------------------------------------------

function randomPoints(seed: number, n: number): Float64Array {
  const rnd = lcg(seed);
  const p = new Float64Array(2 * n);
  for (let k = 0; k < 2 * n; k++) p[k] = gauss(rnd);
  return p;
}

/** x' = s·M·p + t with M row-major. */
function transform(p: Float64Array, M: number[], s: number, t: [number, number]): Float64Array {
  const out = new Float64Array(p.length);
  for (let k = 0; k < p.length / 2; k++) {
    const x = p[2 * k];
    const y = p[2 * k + 1];
    out[2 * k] = s * (M[0] * x + M[1] * y) + t[0];
    out[2 * k + 1] = s * (M[2] * x + M[3] * y) + t[1];
  }
  return out;
}

function rms(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) ** 2;
  return Math.sqrt(s / (a.length / 2));
}

describe('procrustesAlign', () => {
  const th = 0.9;
  const rot = [Math.cos(th), -Math.sin(th), Math.sin(th), Math.cos(th)];
  // rotation then reflection across the x-axis: diag(1,−1)·Rot
  const refl = [rot[0], rot[1], -rot[2], -rot[3]];

  it('recovers a known rotation, scale and translation', () => {
    const src = randomPoints(3, 20);
    const tgt = transform(src, rot, 2.5, [4, -1]);
    const res = procrustesAlign(src, tgt);
    expect(res.rmsd).toBeLessThan(1e-10);
    expect(res.scale).toBeCloseTo(2.5, 10);
    res.rotation.forEach((v, i) => expect(v).toBeCloseTo(rot[i], 10));
    expect(res.translation[0]).toBeCloseTo(4, 10);
    expect(res.translation[1]).toBeCloseTo(-1, 10);
  });

  it('recovers a reflection when allowed, and cannot when not', () => {
    const src = randomPoints(4, 15);
    const tgt = transform(src, refl, 0.7, [-2, 3]);
    const res = procrustesAlign(src, tgt);
    expect(res.rmsd).toBeLessThan(1e-10);
    expect(res.scale).toBeCloseTo(0.7, 10);
    res.rotation.forEach((v, i) => expect(v).toBeCloseTo(refl[i], 10));
    const [r00, r01, r10, r11] = res.rotation;
    expect(r00 * r11 - r01 * r10).toBeCloseTo(-1, 12);

    const proper = procrustesAlign(src, tgt, { reflection: false });
    const [p00, p01, p10, p11] = proper.rotation;
    expect(p00 * p11 - p01 * p10).toBeCloseTo(1, 12);
    expect(proper.rmsd).toBeGreaterThan(0.1);
  });

  it('keeps scale 1 when scale is disabled', () => {
    const src = randomPoints(5, 10);
    const tgt = transform(src, rot, 3, [0, 0]);
    const res = procrustesAlign(src, tgt, { scale: false });
    expect(res.scale).toBe(1);
    res.rotation.forEach((v, i) => expect(v).toBeCloseTo(rot[i], 10));
  });

  it('reduces rmsd on noisy data and beats unaligned and perturbed transforms', () => {
    const src = randomPoints(6, 30);
    const rnd = lcg(99);
    const tgt = transform(src, refl, 1.3, [1, 2]).map((v) => v + 0.05 * gauss(rnd));
    const res = procrustesAlign(src, tgt);
    expect(res.rmsd).toBeLessThanOrEqual(rms(src, tgt));
    expect(res.rmsd).toBeCloseTo(rms(res.aligned, tgt), 12);
    // Local optimality: small perturbations of the fitted pose do not reduce rmsd.
    for (const d of [-0.01, 0.01]) {
      const c = Math.cos(d);
      const s = Math.sin(d);
      const [a, b, e, f] = res.rotation;
      const R2 = [c * a - s * e, c * b - s * f, s * a + c * e, s * b + c * f];
      expect(rms(transform(src, R2, res.scale, res.translation), tgt)).toBeGreaterThan(res.rmsd);
      expect(rms(transform(src, res.rotation, res.scale * (1 + d), res.translation), tgt)).toBeGreaterThan(res.rmsd);
    }
  });

  it('handles degenerate inputs with finite output', () => {
    const empty = procrustesAlign([], []);
    expect(empty.aligned.length).toBe(0);
    expect(empty.rmsd).toBe(0);
    const one = procrustesAlign([1, 2], [5, 7]);
    expect(Array.from(one.aligned)).toEqual([5, 7]);
    expect(one.scale).toBe(1);
    const coincident = procrustesAlign([1, 1, 1, 1, 1, 1], [0, 0, 1, 0, 0, 1]);
    for (const v of coincident.aligned) expect(Number.isFinite(v)).toBe(true);
    expect(coincident.aligned[0]).toBeCloseTo(1 / 3, 12);
    const collapsedTarget = procrustesAlign([0, 0, 1, 0, 0, 1], [2, 2, 2, 2, 2, 2]);
    for (const v of [...collapsedTarget.aligned, collapsedTarget.scale, ...collapsedTarget.rotation]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(collapsedTarget.rmsd).toBeCloseTo(0, 12);
    expect(() => procrustesAlign([1, 2, 3], [1, 2, 3])).toThrow();
  });
});

describe('alignById', () => {
  it('fits on shared ids only (reordered, partial overlap) and transforms all source points', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const base = randomPoints(8, 6);
    const th = -1.2;
    const M = [Math.cos(th), -Math.sin(th), Math.sin(th), Math.cos(th)];
    const moved = transform(base, M, 1.8, [3, 3]);
    // Target lists only a, c, d, f, in a different order, plus an id absent from the source.
    const tIds = ['f', 'zz', 'c', 'a', 'd'];
    const pick = (i: number) => [moved[2 * i], moved[2 * i + 1]];
    const tCoords = [...pick(5), 100, 100, ...pick(2), ...pick(0), ...pick(3)];
    const res = alignById(ids, base, tIds, tCoords);
    expect(res.shared).toBe(4);
    expect(res.note).toBeUndefined();
    expect(res.rmsd).toBeLessThan(1e-10);
    // Non-shared source ids b and e land where the exact transform puts them.
    for (let k = 0; k < 12; k++) expect(res.aligned[k]).toBeCloseTo(moved[k], 9);
  });

  it('reduces to translation-only or identity with fewer than two shared ids', () => {
    const one = alignById(['a', 'b'], [0, 0, 1, 0], ['b', 'x'], [5, 5, 9, 9]);
    expect(one.shared).toBe(1);
    expect(one.note).toMatch(/translation/);
    expect(Array.from(one.aligned)).toEqual([4, 5, 5, 5]);
    const none = alignById(['a', 'b'], [0, 0, 1, 0], ['x'], [5, 5]);
    expect(none.shared).toBe(0);
    expect(none.note).toMatch(/identity/);
    expect(Array.from(none.aligned)).toEqual([0, 0, 1, 0]);
    expect(none.rmsd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// V2-10 density contours
// ---------------------------------------------------------------------------

describe('kde2d', () => {
  it('integrates to ~1 and peaks near the mean of an isotropic Gaussian cloud', () => {
    const rnd = lcg(21);
    const n = 400;
    const coords = new Float64Array(2 * n);
    for (let k = 0; k < n; k++) {
      coords[2 * k] = 2 + gauss(rnd);
      coords[2 * k + 1] = -1 + gauss(rnd);
    }
    const kde = kde2d(coords);
    expect(kde.nx).toBe(64);
    let mass = 0;
    let best = 0;
    let bi = 0;
    for (let k = 0; k < kde.grid.length; k++) {
      mass += kde.grid[k];
      if (kde.grid[k] > kde.grid[best]) best = k;
      bi = best;
    }
    expect(mass * kde.dx * kde.dy).toBeCloseTo(1, 2);
    const px = kde.x0 + (bi % kde.nx) * kde.dx;
    const py = kde.y0 + Math.floor(bi / kde.nx) * kde.dy;
    expect(Math.hypot(px - 2, py + 1)).toBeLessThan(0.5);
    // Scott's rule with σ ≈ 1: h ≈ n^(−1/6)
    expect(kde.bandwidth).toBeCloseTo(scottBandwidth(coords), 12);
    expect(kde.bandwidth).toBeGreaterThan(0.85 * Math.pow(n, -1 / 6));
    expect(kde.bandwidth).toBeLessThan(1.15 * Math.pow(n, -1 / 6));
  });

  it('matches a single analytic Gaussian kernel and handles degenerate input', () => {
    const kde = kde2d([0, 0], { bandwidth: 0.5, gridSize: 41, pad: 2 });
    // Node (20, 20) is at the origin.
    expect(kde.x0 + 20 * kde.dx).toBeCloseTo(0, 12);
    expect(kde.grid[20 * 41 + 20]).toBeCloseTo(1 / (2 * Math.PI * 0.25), 10);
    const x = kde.x0 + 30 * kde.dx;
    expect(kde.grid[20 * 41 + 30]).toBeCloseTo(Math.exp(-(x * x) / 0.5) / (2 * Math.PI * 0.25), 10);
    const one = kde2d([3, 3]);
    expect(one.bandwidth).toBeGreaterThan(0);
    for (const v of one.grid) expect(Number.isFinite(v)).toBe(true);
    const empty = kde2d([]);
    expect(empty.grid.every((v) => v === 0)).toBe(true);
  });
});

describe('isoContours', () => {
  it('gives one closed, approximately circular ring at the analytic iso-radius', () => {
    const nx = 81;
    const ny = 61;
    const ci = 40.3;
    const cj = 29.6;
    const sigma = 9;
    const grid = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) grid[j * nx + i] = Math.exp(-((i - ci) ** 2 + (j - cj) ** 2) / (2 * sigma ** 2));
    for (const level of [0.2, 0.5, 0.8]) {
      const lines = isoContours(grid, nx, ny, level);
      expect(lines.length).toBe(1);
      const ring = lines[0];
      expect(ring[0]).toBe(ring[ring.length - 2]);
      expect(ring[1]).toBe(ring[ring.length - 1]);
      const rIso = sigma * Math.sqrt(-2 * Math.log(level));
      for (let k = 0; k < ring.length; k += 2) {
        expect(Math.abs(Math.hypot(ring[k] - ci, ring[k + 1] - cj) - rIso)).toBeLessThan(0.1);
      }
      expect(ring.length / 2).toBeGreaterThan(2 * Math.PI * rIso); // no gaps
    }
  });

  it('returns open polylines ending on the boundary when the region is cut by the grid edge', () => {
    const nx = 20;
    const ny = 20;
    const grid = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) grid[j * nx + i] = i + 0.3 * j;
    const lines = isoContours(grid, nx, ny, 10.05);
    expect(lines.length).toBe(1);
    const l = lines[0];
    const onBoundary = (x: number, y: number) => x <= 0 || y <= 0 || x >= nx - 1 || y >= ny - 1;
    expect(onBoundary(l[0], l[1])).toBe(true);
    expect(onBoundary(l[l.length - 2], l[l.length - 1])).toBe(true);
    for (let k = 0; k < l.length; k += 2) expect(l[k] + 0.3 * l[k + 1]).toBeCloseTo(10.05, 10);
  });

  it('resolves a saddle cell by the average of its corners', () => {
    // 2×2 grid, inside corners on one diagonal.
    const g = [1, 0, 0, 1]; // (0,0)=1 (1,0)=0 (0,1)=0 (1,1)=1; centre average 0.5
    // level 0.4: centre inside → inside corners joined, the two outside corners cut off.
    const joined = isoContours(g, 2, 2, 0.4);
    // level 0.6 ≥ centre: inside corners cut off.
    const cut = isoContours(g, 2, 2, 0.6);
    expect(joined.length).toBe(2);
    expect(cut.length).toBe(2);
    const nearCorner = (lines: number[][], cx: number, cy: number) =>
      lines.some((l) => l.every((v, k) => (k % 2 === 0 ? Math.abs(v - cx) : Math.abs(v - cy)) <= 0.4 + 1e-12));
    // Joined: segments isolate outside corners (1,0) and (0,1).
    expect(nearCorner(joined, 1, 0) && nearCorner(joined, 0, 1)).toBe(true);
    // Cut: segments isolate inside corners (0,0) and (1,1).
    expect(nearCorner(cut, 0, 0) && nearCorner(cut, 1, 1)).toBe(true);
  });

  it('maps grid coordinates to layout coordinates', () => {
    expect(gridToLayout([0, 0, 2, 1.5], { x0: -1, y0: 10, dx: 0.5, dy: 2 })).toEqual([-1, 10, 0, 13]);
  });
});

describe('densityLevels', () => {
  it('is monotone and the levels enclose the requested KDE mass', () => {
    const rnd = lcg(33);
    const coords: number[] = [];
    for (let k = 0; k < 150; k++) coords.push(gauss(rnd), 0.5 * gauss(rnd));
    for (let k = 0; k < 50; k++) coords.push(4 + 0.5 * gauss(rnd), 2 + 0.5 * gauss(rnd));
    const kde = kde2d(coords);
    const levels = densityLevels(kde.grid, [0.95, 0.5, 0.8]);
    expect(levels.length).toBe(3);
    expect(levels[0]).toBeGreaterThan(levels[1]);
    expect(levels[1]).toBeGreaterThan(levels[2]);
    let total = 0;
    for (const v of kde.grid) total += v;
    [0.5, 0.8, 0.95].forEach((f, idx) => {
      let above = 0;
      for (const v of kde.grid) if (v >= levels[idx]) above += v;
      expect(above / total).toBeGreaterThanOrEqual(f);
      expect(above / total).toBeLessThan(f + 0.01);
    });
    expect(densityLevels(new Float64Array(9), [0.5]).every(Number.isNaN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V2-09 lens
// ---------------------------------------------------------------------------

describe('fisheye', () => {
  const cx = 100;
  const cy = 50;
  const R = 80;
  const D = 3;

  it('is the identity at and beyond the radius', () => {
    for (const [x, y] of [
      [100 + 80, 50],
      [300, 300],
      [100, 50 - 81],
    ]) {
      const p = fisheye(x, y, cx, cy, R, D);
      expect(p.x).toBe(x);
      expect(p.y).toBe(y);
      expect(p.scale).toBe(1);
    }
    const off = fisheye(120, 60, cx, cy, R, 0);
    expect([off.x, off.y, off.scale]).toEqual([120, 60, 1]);
  });

  it('is continuous at the boundary, radially monotone, and pushes points outward', () => {
    const ang = 0.7;
    const at = (d: number) => fisheye(cx + d * Math.cos(ang), cy + d * Math.sin(ang), cx, cy, R, D);
    const inner = at(R - 1e-7);
    expect(inner.x).toBeCloseTo(cx + R * Math.cos(ang), 5);
    expect(inner.y).toBeCloseTo(cy + R * Math.sin(ang), 5);
    let prev = -1;
    for (let d = 0; d <= 1.2 * R; d += 0.5) {
      const p = at(d);
      const r = Math.hypot(p.x - cx, p.y - cy);
      expect(r).toBeGreaterThan(prev);
      expect(r).toBeGreaterThanOrEqual(Math.min(d, R) - 1e-9);
      // direction preserved
      if (d > 0) expect(Math.atan2(p.y - cy, p.x - cx)).toBeCloseTo(ang, 10);
      prev = r;
    }
  });

  it('reports the local magnification as the radial derivative', () => {
    expect(fisheye(cx, cy, cx, cy, R, D).scale).toBeCloseTo(D + 1, 12);
    for (const d of [5, 30, 60]) {
      const h = 1e-5;
      const r = (dd: number) => fisheye(cx + dd, cy, cx, cy, R, D).x - cx;
      const numeric = (r(d + h) - r(d - h)) / (2 * h);
      expect(fisheye(cx + d, cy, cx, cy, R, D).scale).toBeCloseTo(numeric, 6);
    }
  });

  it('inverts to 1e-9', () => {
    const rnd = lcg(5);
    for (let k = 0; k < 200; k++) {
      const x = cx + (rnd() - 0.5) * 3 * R;
      const y = cy + (rnd() - 0.5) * 3 * R;
      for (const d of [0.5, 3, 10]) {
        const f = fisheye(x, y, cx, cy, R, d);
        const back = inverseFisheye(f.x, f.y, cx, cy, R, d);
        expect(Math.abs(back.x - x)).toBeLessThan(1e-9);
        expect(Math.abs(back.y - y)).toBeLessThan(1e-9);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// V2-03 fit shares
// ---------------------------------------------------------------------------

function pairDistances(coords: ArrayLike<number>, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      out.push(Math.hypot(coords[2 * i] - coords[2 * j], coords[2 * i + 1] - coords[2 * j + 1]));
  return out;
}

describe('stressShares', () => {
  it('sums to 1 and matches a hand computation', () => {
    // n = 3: pairs (0,1), (0,2), (1,2) with residuals 1, 2, 0.
    const s = stressShares([2, 3, 5], [1, 1, 5], 3);
    // numerator 1 + 4 = 5; member 0: (1 + 4)/2, member 1: 1/2, member 2: 4/2
    expect(Array.from(s)).toEqual([2.5 / 5, 0.5 / 5, 2 / 5].map((v) => expect.closeTo(v, 12)));
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('gives the largest share to a badly misplaced map', () => {
    const n = 12;
    const truth = randomPoints(41, n);
    const shown = Float64Array.from(truth);
    shown[2 * 7] += 3;
    shown[2 * 7 + 1] -= 2;
    const rnd = lcg(42);
    for (let k = 0; k < 2 * n; k++) shown[k] += 0.02 * gauss(rnd);
    const s = stressShares(pairDistances(shown, n), pairDistances(truth, n), n);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    let arg = 0;
    for (let i = 1; i < n; i++) if (s[i] > s[arg]) arg = i;
    expect(arg).toBe(7);
    expect(s[7]).toBeGreaterThan(0.3);
  });

  it('is all zero for a perfect fit and validates lengths', () => {
    const d = pairDistances(randomPoints(2, 5), 5);
    expect(Array.from(stressShares(d, d, 5))).toEqual([0, 0, 0, 0, 0]);
    expect(stressShares([], [], 1).length).toBe(1);
    expect(() => stressShares([1, 2], [1, 2], 3)).toThrow();
  });
});
