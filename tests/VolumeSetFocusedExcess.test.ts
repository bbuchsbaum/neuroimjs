import { describe, it, expect } from 'vitest';
import { standardize, focusedTerms, focusedShareTable, focusedExcess, concentration, parcelSums } from '../src/volumeset/explain';

/** LCG uniform + Box–Muller normal (independent of explain.ts). */
function gen(seed: number): () => number {
  let s = seed >>> 0;
  const u = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** Textbook 1 − r between two vectors. */
function refD(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let t = 0; t < n; t++) {
    ma += a[t];
    mb += b[t];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let t = 0; t < n; t++) {
    sab += (a[t] - ma) * (b[t] - mb);
    saa += (a[t] - ma) ** 2;
    sbb += (b[t] - mb) ** 2;
  }
  return 1 - sab / Math.sqrt(saa * sbb);
}

const row = (t: ReturnType<typeof focusedShareTable>, i: number, id: number): number => t.share[i * t.ids.length + t.ids.indexOf(id)];

/**
 * k maps on 6 parcels of `per` voxels (labels 1..6) plus 10 outside voxels: a shared pattern plus
 * unit noise; in parcel 1 every map gets heavy extra noise (a parcel where all maps diverge), and map
 * 0 alone departs in parcel 4.
 */
function planted(k: number, per: number, seed: number): { data: Float32Array[]; labels: Int32Array; support: Int32Array } {
  const g = gen(seed);
  const N = 6 * per + 10;
  const labels = new Int32Array(N);
  for (let v = 0; v < 6 * per; v++) labels[v] = 1 + Math.floor(v / per);
  const shared = Float64Array.from({ length: N }, () => 3 * g());
  const data = Array.from({ length: k }, (_, i) =>
    Float32Array.from({ length: N }, (_, v) => {
      let x = shared[v] + g();
      if (labels[v] === 1) x += 4 * g();
      if (i === 0 && labels[v] === 4) x += 3 * g();
      return x;
    })
  );
  return { data, labels, support: Int32Array.from({ length: N }, (_, v) => v) };
}

describe('focused shares of every map at once', () => {
  it('matches the hand-worked case (three orthogonal ±1 maps)', () => {
    // r = 0 for every pair, so each map's total is mean d = 1. Per voxel (1/2N)·mean_{j≠i}(zᵢ − zⱼ)²:
    // v0 (1, 1, 1) → 0; v1 (1, −1, −1) → .5, .25, .25; v2 (−1, 1, −1) → .25, .5, .25; v3 (−1, −1, 1) → .25, .25, .5.
    const z = [Float64Array.of(1, 1, -1, -1), Float64Array.of(1, -1, 1, -1), Float64Array.of(1, -1, -1, 1)];
    const t = focusedShareTable(z, Int32Array.of(1, 1, 2, 2));
    expect(t.ids).toEqual([1, 2]);
    expect(Array.from(t.n)).toEqual([2, 2]);
    for (let i = 0; i < 3; i++) expect(t.totals[i]).toBeCloseTo(1, 14);
    expect(Array.from(t.share).map((x) => +x.toFixed(12))).toEqual([0.5, 0.5, 0.25, 0.75, 0.25, 0.75]);
    const e0 = focusedExcess(t, 0);
    // Parcel 1: shares .5/.25/.25 → typical .25, excess 2, rank 1. Parcel 2: .5/.75/.75 → typical .75, excess 2/3, rank 3.
    expect(e0.map((r) => r.id)).toEqual([1, 2]);
    expect(e0[0]).toMatchObject({ id: 1, n: 2, rank: 1 });
    expect(e0[0].share).toBeCloseTo(0.5, 14);
    expect(e0[0].typical).toBeCloseTo(0.25, 14);
    expect(e0[0].excess).toBeCloseTo(2, 14);
    expect(e0[1].excess).toBeCloseTo(2 / 3, 14);
    expect(e0[1].rank).toBe(3);
    // Map 1 is the typical map in parcel 1 (excess 1); it ties map 2 for the larger share in parcel 2.
    const e1 = focusedExcess(t, 1);
    expect(e1.find((r) => r.id === 1)!.excess).toBeCloseTo(1, 14);
    expect(e1.find((r) => r.id === 1)!.rank).toBe(2);
    expect(e1.find((r) => r.id === 2)!.rank).toBe(1);
  });

  it('per-map terms equal focusedTerms own + baseline, and each sums exactly to the mean 1 − r to the others', () => {
    const { data, labels, support } = planted(7, 40, 11);
    const z = standardize(data, [...data.keys()], support);
    const t = focusedShareTable(z, labels);
    for (let i = 0; i < z.length; i++) {
      const f = focusedTerms(z, i);
      const terms = Float64Array.from(f.own, (x, v) => x + f.baseline[v]);
      const ps = parcelSums(terms, labels);
      expect(t.totals[i]).toBeCloseTo(ps.total.sum, 12);
      let md = 0;
      for (let j = 0; j < z.length; j++) if (j !== i) md += refD(data[i], data[j]);
      expect(t.totals[i]).toBeCloseTo(md / (z.length - 1), 9);
      let inside = 0;
      for (const id of t.ids) {
        expect(row(t, i, id)).toBeCloseTo(ps.parcels.get(id)!.sum / ps.total.sum, 12);
        inside += row(t, i, id);
      }
      // Shares plus the outside share account for the whole total.
      expect(inside + ps.outside.sum / ps.total.sum).toBeCloseTo(1, 12);
    }
  });

  it('ranks the parcel where only this map departs above the parcel where every map diverges', () => {
    const { data, labels, support } = planted(9, 60, 5);
    const z = standardize(data, [...data.keys()], support);
    const t = focusedShareTable(z, labels);
    // By raw share, parcel 1 (everyone diverges) tops map 0 and every other map: the bias being removed.
    for (let i = 0; i < z.length; i++) {
      const f = focusedTerms(z, i);
      expect(concentration(parcelSums(Float64Array.from(f.own, (x, v) => x + f.baseline[v]), labels), 1).top).toEqual([1]);
    }
    const e0 = focusedExcess(t, 0);
    expect(e0[0].id).toBe(4);
    expect(e0[0].rank).toBe(1);
    expect(e0[0].excess).toBeGreaterThan(2);
    // In the shared parcel map 0 is not special.
    expect(e0.find((r) => r.id === 1)!.excess).toBeLessThan(1);
    // No other map has parcel 4 on top.
    for (let i = 1; i < z.length; i++) expect(focusedExcess(t, i)[0].id).not.toBe(4);
  });

  it('exchangeable maps sit near the typical map everywhere', () => {
    const g = gen(3);
    const k = 11;
    const per = 400;
    const N = 5 * per;
    const labels = Int32Array.from({ length: N }, (_, v) => 1 + Math.floor(v / per));
    const shared = Float64Array.from({ length: N }, () => 2 * g());
    const data = Array.from({ length: k }, () => Float32Array.from(shared, (s) => s + g()));
    const z = standardize(data, [...data.keys()], Int32Array.from({ length: N }, (_, v) => v));
    const t = focusedShareTable(z, labels);
    for (let i = 0; i < k; i++) for (const r of focusedExcess(t, i)) expect(Math.abs(Math.log(r.excess))).toBeLessThan(0.25);
  });

  it('is invariant to the order of the maps and to positive affine rescaling of any map', () => {
    const { data, labels, support } = planted(6, 30, 9);
    const members = [...data.keys()];
    const base = focusedExcess(focusedShareTable(standardize(data, members, support), labels), 0);
    const perm = [3, 0, 5, 1, 4, 2]; // map 0 is now at position 1
    const scaled = data.map((d, i) => Float32Array.from(d, (x) => (i === 2 ? 7.5 * x - 3 : x)));
    const permuted = focusedExcess(focusedShareTable(standardize(scaled, perm, support), labels), 1);
    expect(permuted.map((r) => r.id)).toEqual(base.map((r) => r.id));
    permuted.forEach((r, p) => {
      expect(r.excess).toBeCloseTo(base[p].excess, 5);
      expect(r.rank).toBe(base[p].rank);
    });
  });

  it('reports no excess for small parcels or a zero typical share, and sorts those last', () => {
    // Parcel 9 has one voxel; parcel 8 is where all three maps agree exactly (every term 0).
    const z = [Float64Array.of(1, 1, -1, -1, 0), Float64Array.of(1, -1, 1, -1, 0), Float64Array.of(1, -1, -1, 1, 0)];
    const t = focusedShareTable(z, Int32Array.of(8, 2, 2, 2, 9));
    const e = focusedExcess(t, 0, 2);
    expect(e.map((r) => r.id)).toEqual([2, 8, 9]);
    expect(e[1].typical).toBe(0);
    expect(Number.isNaN(e[1].excess)).toBe(true);
    expect(Number.isNaN(e[2].excess)).toBe(true);
    expect(e[2].n).toBe(1);
    expect(() => focusedExcess(t, 3)).toThrow();
    expect(() => focusedShareTable(z, Int32Array.of(1, 2))).toThrow();
  });
});
