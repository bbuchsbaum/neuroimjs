/**
 * Space v3: what drives the layout, and how much of it is noise. Contracts and exact definitions:
 * docs/plans/volume-set-space-v3.md. Parcels come from neuroatlasjs (dogfooded).
 *
 * Everything is off by default and descriptive. Numerics live in src/volumeset/explain.ts; this module
 * loads data, builds the atlas, caches results per basis, and supplies pictures, marks and panel HTML
 * to space-extras.ts / space-view.ts.
 */
import { VolumeAtlas, type Region } from 'neuroatlasjs';
import { readNiftiArrayBuffer } from '../../src/io/browserNifti';
import { FloatNeuroVol, Int32NeuroVol } from '../../src/volume/DenseNeuroVol';
import type { NeuroVol } from '../../src/volume/NeuroVol';
import type { SimilarityBasis } from '../../src/volumeset/basis';
import {
  standardize,
  dispersionTerms,
  focusedTerms,
  focusedShareTable,
  focusedExcess,
  groupTerms,
  reliability,
  noiseFloorTerms,
  correctedR,
  noiseDissimilarity,
  concentration,
  parcelSums,
  randomSplitReference,
  parcelInfluence,
  heterogeneity,
  envfitVector,
  envfitFactor,
} from '../../src/volumeset/explain';
import { fetchManifest, prettyParcel } from './data';
import * as M from './main';

// ---------------------------------------------------------------------------
// Atlas (neuroatlasjs) from the template dseg volume and its tsv

export interface SpaceAtlas {
  atlas: VolumeAtlas;
  name: string;
  /** Parcel id -> readable name. */
  label(id: number): string;
  /** Parcel id -> one-line abbreviation for narrow tables ("L SomMotB Aud2"); `label` holds the full name. */
  short(id: number): string;
}

/** "17Networks_LH_SomMotB_Aud_2" -> "L SomMotB Aud2". */
export function shortParcel(name: string): string {
  const parts = name.replace(/^\d+Networks_/, '').split('_');
  const hemi = parts[0] === 'LH' ? 'L' : parts[0] === 'RH' ? 'R' : parts[0];
  const rest = parts.slice(1);
  const num = rest.length >= 2 && /^\d+$/.test(rest[rest.length - 1]) ? rest.pop()! : '';
  if (num) rest[rest.length - 1] += num;
  return [hemi, ...rest].join(' ');
}

let atlasPromise: Promise<SpaceAtlas | null> | null = null;

function regionsFromTsv(tsv: string): Region[] {
  const out: Region[] = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const [idx, name] = line.split('\t');
    const id = Number(idx);
    if (!idx || !name || !Number.isInteger(id) || id <= 0) continue;
    const parts = name.replace(/^\d+Networks_/, '').split('_');
    out.push({
      id,
      label: name,
      fullLabel: name,
      hemisphere: parts[0] === 'LH' ? 'left' : parts[0] === 'RH' ? 'right' : undefined,
      network: parts[1],
    });
  }
  return out;
}

/** The parcellation served beside the template, or null when there is none (Space v3 then works without parcels). */
export function loadSpaceAtlas(): Promise<SpaceAtlas | null> {
  atlasPromise ??= (async () => {
    try {
      const [vres, tres] = await Promise.all([fetch('/vs/template/atlas.nii.gz'), fetch('/vs/template/atlas.tsv')]);
      if (!vres.ok || !tres.ok) return null;
      const vol = readNiftiArrayBuffer(await vres.arrayBuffer());
      const labels = Int32Array.from(vol.getData() as ArrayLike<number>, (x) => Math.round(x));
      const regions = regionsFromTsv(await tres.text());
      // The atlas and the maps come from different files on one template grid; float32 headers can differ by ~1e-6.
      const atlas = new VolumeAtlas({ name: 'parcellation', volume: new Int32NeuroVol(vol.space, labels), regions, affineTolerance: 1e-3 });
      return {
        atlas,
        name: regions.length > 100 ? 'Schaefer 2018 (400 parcels, 17 networks)' : `parcellation (${regions.length} parcels)`,
        label: (id: number) => prettyParcel(atlas.regions.get(id)?.fullLabel ?? `parcel ${id}`),
        short: (id: number) => (atlas.regions.get(id) ? shortParcel(atlas.regions.get(id)!.fullLabel ?? `parcel ${id}`) : `parcel ${id}`),
      };
    } catch {
      return null;
    }
  })();
  return atlasPromise;
}

// ---------------------------------------------------------------------------
// β and SE frames, loaded lazily per analysis and aligned with its masked vectors

interface BetaSe {
  beta: Float32Array[];
  se: Float32Array[];
}

const betaSeCache = new Map<string, Promise<BetaSe>>();

export function loadBetaSe(a: M.Analysis): Promise<BetaSe> {
  let p = betaSeCache.get(a.key);
  if (!p) {
    p = (async () => {
      const [model] = a.key.split('|');
      const manifest = (await fetchManifest()).filter((m) => m.model === model && m.contrast === a.contrast);
      const byId = new Map(manifest.map((m) => [m.subject, m]));
      const beta: Float32Array[] = new Array(a.ids.length);
      const se: Float32Array[] = new Array(a.ids.length);
      const take = (vol: NeuroVol): Float32Array => {
        const d = vol.getData() as ArrayLike<number>;
        return Float32Array.from(a.set.maskIndex, (g) => (Number.isFinite(d[g]) ? d[g] : NaN));
      };
      let next = 0;
      let done = 0;
      const worker = async (): Promise<void> => {
        while (next < a.ids.length) {
          const i = next++;
          const m = byId.get(a.ids[i]);
          if (!m) throw new Error(`no file for ${a.ids[i]}`);
          const buf = await (await fetch(m.url)).arrayBuffer();
          beta[i] = take(readNiftiArrayBuffer(buf.slice(0), { index: 0 }));
          se[i] = take(readNiftiArrayBuffer(buf, { index: 3 }));
          M.setStatus(`Loading β and SE ${++done}/${a.ids.length}`);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      M.setStatus('');
      return { beta, se };
    })();
    if (betaSeCache.size > 4) betaSeCache.clear();
    betaSeCache.set(a.key, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Reliability (V3-01). For t-maps the noise variance is ~1 per voxel, so no extra data is needed;
// for β-maps it is SE², loaded on demand.

export interface Reliability {
  key: string;
  /** Per basis-eligible member (eligible order). */
  rho: number[];
  /** Per eligible member: SD of the laid-out values over the support. */
  sd: number[];
  noise: 'unit (t-maps)' | 'SE² (β-maps)';
  /** Per eligible member: noise SD per masked voxel (t: 1; β: SE). */
  noiseSd: Float32Array[] | null;
}

const relCache = new Map<string, Reliability | Promise<Reliability>>();

/** Reliability of the maps in a basis; synchronous for t-maps, a promise for β-maps the first time. */
export function reliabilityOf(a: M.Analysis, b: SimilarityBasis): Reliability | null {
  const key = `${b.key}|rel`;
  const c = relCache.get(key);
  if (c && !(c instanceof Promise)) return c;
  if (c) return null;
  const isT = M.state.stat === 't';
  const build = (se: Float32Array[] | null): Reliability => {
    const rho: number[] = [];
    const sd: number[] = [];
    const noiseSd: Float32Array[] = [];
    for (const i of b.eligible) {
      const x = a.set.members[i].values;
      const s = se ? se[i] : new Float32Array(x.length).fill(1);
      const r = reliability(x, s, b.support);
      rho.push(r.rho);
      sd.push(r.betaSd);
      noiseSd.push(s);
    }
    return { key, rho, sd, noise: isT ? 'unit (t-maps)' : 'SE² (β-maps)', noiseSd };
  };
  if (isT) {
    const r = build(null);
    relCache.set(key, r);
    return r;
  }
  const p = loadBetaSe(a).then(({ se }) => {
    const r = build(se);
    relCache.set(key, r);
    M.scheduleDraw();
    return r;
  });
  relCache.set(key, p);
  return null;
}

/** Noise-corrected (Spearman) basis: r / √(ρ_i ρ_j), clamped; maps with ρ < 0.1 are excluded as unreliable. */
export function correctedBasis(a: M.Analysis, b: SimilarityBasis): SimilarityBasis | null {
  const rel = reliabilityOf(a, b);
  if (!rel || b.status !== 'ok') return null;
  const k = b.ids.length;
  const keep = b.eligible.filter((_, p) => rel.rho[p] >= 0.1);
  const r = new Float64Array(k * k).fill(NaN);
  const m = keep.length;
  const dist = new Float64Array(m * m);
  for (let p = 0; p < m; p++) {
    const i = keep[p];
    r[i * k + i] = 1;
    for (let q = p + 1; q < m; q++) {
      const j = keep[q];
      const v = correctedR(b.r[i * k + j], rel.rho[b.eligible.indexOf(i)], rel.rho[b.eligible.indexOf(j)]);
      r[i * k + j] = r[j * k + i] = v;
      dist[p * m + q] = dist[q * m + p] = 1 - v;
    }
  }
  const excluded = [
    ...b.excluded,
    ...b.eligible
      .filter((i) => !keep.includes(i))
      .map((i) => ({ index: i, id: b.ids[i], reason: 'insufficient-support' as const, detail: `too unreliable to correct (ρ ${rel.rho[b.eligible.indexOf(i)].toFixed(2)} < 0.10)` })),
  ].sort((x, y) => x.index - y.index);
  return { ...b, key: `${b.key}|spearman-corrected`, eligible: keep, excluded, r, dist, status: m ? 'ok' : 'no-eligible-members' };
}

/** Expected 1 − r between two noisy copies of one map, at the median pair: the yardstick for gaps. */
export function noiseYardstick(rel: Reliability): number {
  const v: number[] = [];
  for (let i = 0; i < rel.rho.length; i++) for (let j = i + 1; j < rel.rho.length; j++) v.push(noiseDissimilarity(rel.rho[i], rel.rho[j]));
  v.sort((x, y) => x - y);
  return v.length ? v[v.length >> 1] : NaN;
}

// ---------------------------------------------------------------------------
// Explain (V3-02 / 03 / 06 / 07)

export type ExplainScope = { kind: 'all' } | { kind: 'focused'; member: number } | { kind: 'group'; a: number[]; b: number[] };

export interface ExplainResult {
  key: string;
  scope: ExplainScope;
  title: string;
  /** Per masked voxel (NaN off the support): the picture. */
  picture: Float32Array;
  signed: boolean;
  /** Per support voxel term that sums to `total`. */
  total: number;
  totalLabel: string;
  /** Expected contribution of independent noise (dispersion scope only), and the share beyond it. */
  noiseShare: number | null;
  parcels: { id: number; name: string; short: string; share: number; sizeShare: number; beyondNoise: number | null; i2: number | null }[] | null;
  outsideShare: number | null;
  concentration: { topK: number; topShare: number; sizeShare: number; randomSplit: number | null } | null;
  influence: { id: number; name: string; short: string; mantel: number }[] | null;
  /**
   * Focused scope only: parcels ranked by excess over the typical map (`focusedExcess`), i.e. this map's
   * share of its own focused total in the parcel ÷ the median of every placed map's own share there.
   * Parcels below `minN` support voxels have excess NaN and come last.
   */
  focus: {
    rows: { id: number; name: string; short: string; n: number; share: number; typical: number; excess: number; rank: number }[];
    /** Maps compared (the rank is out of this many). */
    of: number;
    minN: number;
  } | null;
  heterogeneityNote: string | null;
}

const explainCache = new Map<string, ExplainResult>();
const focusTableCache = new Map<string, ReturnType<typeof focusedShareTable>>();

/** Smallest parcel (support voxels) given an excess over the typical map; smaller parcels show "–". */
export const FOCUS_MIN_VOXELS = 20;

function scopeKey(s: ExplainScope): string {
  return s.kind === 'all' ? 'all' : s.kind === 'focused' ? `f${s.member}` : `g${s.a.join('.')}|${s.b.join('.')}`;
}

/** Labels of the support voxels (0 = outside every parcel), via the atlas on the template grid. */
function supportLabels(a: M.Analysis, b: SimilarityBasis, sa: SpaceAtlas): Int32Array {
  const [nx, ny] = a.set.dim;
  const out = new Int32Array(b.support.length);
  for (let s = 0; s < b.support.length; s++) {
    const g = a.set.maskIndex[b.support[s]];
    out[s] = sa.atlas.regionAtVoxel([g % nx, Math.floor(g / nx) % ny, Math.floor(g / (nx * ny))])?.id ?? 0;
  }
  return out;
}

const labelCache = new Map<string, Int32Array>();

/** Expand per-support-voxel terms to a full-grid volume and sum per parcel with neuroatlasjs. */
function parcelTable(a: M.Analysis, b: SimilarityBasis, sa: SpaceAtlas, terms: Float64Array): { sums: Map<number, number>; sizes: Map<number, number>; outside: number; total: number } {
  const n = a.set.dim[0] * a.set.dim[1] * a.set.dim[2];
  const grid = new Float32Array(n).fill(NaN);
  const ones = new Float32Array(n).fill(NaN);
  for (let s = 0; s < b.support.length; s++) {
    const g = a.set.maskIndex[b.support[s]];
    grid[g] = terms[s];
    ones[g] = 1;
  }
  const sums = sa.atlas.reduce(new FloatNeuroVol(a.set.space, grid), { statistic: 'sum', nonFinite: 'omit' });
  const sizes = sa.atlas.reduce(new FloatNeuroVol(a.set.space, ones), { statistic: 'sum', nonFinite: 'omit' });
  let total = 0;
  for (let s = 0; s < terms.length; s++) total += terms[s];
  const sm = new Map<number, number>();
  const sz = new Map<number, number>();
  let inside = 0;
  for (const id of sa.atlas.regions.ids) {
    const v = sums.get(id);
    sm.set(id, v);
    sz.set(id, sizes.get(id));
    inside += v;
  }
  return { sums: sm, sizes: sz, outside: total - inside, total };
}

/**
 * Explanation for the current scope. Synchronous; heavy parts are cached per basis + scope. Parcel
 * heterogeneity fills in later (it needs β and SE).
 */
/** Explain keeps every map's z (float64) in memory: ~32 MB for 17 maps at 2 mm, ~380 MB for 200. */
export const EXPLAIN_MAX_MAPS = 100;

export function explain(a: M.Analysis, b: SimilarityBasis, scope: ExplainScope, sa: SpaceAtlas | null): ExplainResult | null {
  if (b.status !== 'ok' || b.eligible.length < 2 || b.eligible.length > EXPLAIN_MAX_MAPS) return null;
  const key = `${b.key}|${scopeKey(scope)}|${sa ? 'atlas' : 'none'}`;
  const hit = explainCache.get(key);
  if (hit) return hit;
  const z = standardize(
    a.set.members.map((m) => m.values),
    b.eligible,
    b.support
  );
  const N = b.support.length;
  let terms: Float64Array;
  let signedTerms: Float64Array | null = null;
  let title: string;
  let totalLabel: string;
  let noiseShare: number | null = null;
  let beyond: Float64Array | null = null;
  if (scope.kind === 'all') {
    terms = dispersionTerms(z);
    title = 'What separates these maps';
    totalLabel = 'total pairwise 1 − r';
    const rel = reliabilityOf(a, b);
    if (rel?.noiseSd) {
      const floor = noiseFloorTerms(
        rel.noiseSd.map((s) => s),
        rel.sd,
        b.support
      );
      let ft = 0;
      let tt = 0;
      beyond = new Float64Array(N);
      for (let v = 0; v < N; v++) {
        ft += floor[v];
        tt += terms[v];
        beyond[v] = terms[v] - floor[v];
      }
      noiseShare = tt > 0 ? ft / tt : null;
    }
  } else if (scope.kind === 'focused') {
    const p = b.eligible.indexOf(scope.member);
    const f = focusedTerms(z, p);
    terms = new Float64Array(N);
    for (let v = 0; v < N; v++) terms[v] = f.own[v] + f.baseline[v];
    signedTerms = f.signed;
    title = `${a.ids[scope.member]} minus the mean of the other maps`;
    totalLabel = `mean 1 − r of ${a.ids[scope.member]} to the others`;
  } else {
    const A = scope.a.map((m) => b.eligible.indexOf(m)).filter((p) => p >= 0);
    const B = scope.b.map((m) => b.eligible.indexOf(m)).filter((p) => p >= 0);
    const g = groupTerms(z, A, B);
    terms = g.between;
    signedTerms = g.signed;
    title = 'Group mean minus the mean of the rest';
    totalLabel = 'mean 1 − r between group and others';
  }
  // Picture: the signed map where there is one, else the per-voxel share (beyond noise when known).
  const pic = signedTerms ?? beyond ?? terms;
  const picture = new Float32Array(a.set.maskIndex.length).fill(NaN);
  for (let s = 0; s < N; s++) picture[b.support[s]] = pic[s];
  let total = 0;
  for (let v = 0; v < N; v++) total += terms[v];

  let parcels: ExplainResult['parcels'] = null;
  let outsideShare: number | null = null;
  let conc: ExplainResult['concentration'] = null;
  let influence: ExplainResult['influence'] = null;
  let focus: ExplainResult['focus'] = null;
  if (sa) {
    const t = parcelTable(a, b, sa, terms);
    const bt = beyond ? parcelTable(a, b, sa, beyond) : null;
    const totalVox = [...t.sizes.values()].reduce((x, y) => x + y, 0) + 0;
    parcels = [...t.sums.entries()]
      .filter(([id]) => (t.sizes.get(id) ?? 0) > 0)
      .map(([id, v]) => ({ id, name: sa.label(id), short: sa.short(id), share: v / t.total, sizeShare: (t.sizes.get(id) ?? 0) / N, beyondNoise: bt ? (bt.sums.get(id) ?? 0) / bt.total : null, i2: null }))
      .sort((x, y) => y.share - x.share);
    outsideShare = t.outside / t.total;
    const topK = 5;
    const lk = `${b.key}|labels`;
    let labels = labelCache.get(lk);
    if (!labels) {
      labels = supportLabels(a, b, sa);
      labelCache.set(lk, labels);
    }
    // Concentration from the same terms summed by support labels (explain.ts), cross-checked against neuroatlasjs' sums.
    const c = concentration(parcelSums(terms, labels), topK);
    let randomSplit: number | null = null;
    if (scope.kind === 'group') randomSplit = randomSplitReference(z, scope.a.length, scope.b.length, labels, 50, 1, topK).median;
    conc = { topK, topShare: c.topShare, sizeShare: c.sizeShare, randomSplit };
    void totalVox;
    if (scope.kind === 'all' && b.eligible.length <= 100) {
      influence = parcelInfluence(
        a.set.members.map((m) => m.values),
        b.eligible,
        b.support,
        labels
      )
        .slice(0, 8)
        .map((x) => ({ id: x.id, name: sa.label(x.id), short: sa.short(x.id), mantel: x.mantel }));
    }
    if (scope.kind === 'focused') {
      // Every map's focused shares come from the same z, so compute them together once per basis.
      const fk = `${b.key}|focus-table`;
      let table = focusTableCache.get(fk);
      if (!table) {
        table = focusedShareTable(z, labels);
        if (focusTableCache.size > 4) focusTableCache.clear();
        focusTableCache.set(fk, table);
      }
      const rows = focusedExcess(table, b.eligible.indexOf(scope.member), FOCUS_MIN_VOXELS).map((r) => ({ ...r, name: sa.label(r.id), short: sa.short(r.id) }));
      focus = { rows, of: b.eligible.length, minN: FOCUS_MIN_VOXELS };
    }
  }
  const res: ExplainResult = { key, scope, title, picture, signed: signedTerms !== null, total, totalLabel, noiseShare, parcels, outsideShare, concentration: conc, influence, focus, heterogeneityNote: null };
  if (explainCache.size > 12) explainCache.clear();
  explainCache.set(key, res);
  // Per-parcel heterogeneity needs β and SE; fill the column in when they arrive (the focused table has no I²).
  if (sa && parcels && scope.kind !== 'focused') {
    void loadBetaSe(a).then(({ beta, se }) => {
      const nVox = a.set.dim[0] * a.set.dim[1] * a.set.dim[2];
      const means = (vals: Float32Array): Map<number, number> => {
        const grid = new Float32Array(nVox).fill(NaN);
        for (let s = 0; s < b.support.length; s++) grid[a.set.maskIndex[b.support[s]]] = vals[b.support[s]];
        const r = sa.atlas.reduce(new FloatNeuroVol(a.set.space, grid), { statistic: 'mean', nonFinite: 'omit' });
        return new Map(sa.atlas.regions.ids.map((id) => [id, r.get(id)]));
      };
      const bm = b.eligible.map((i) => means(beta[i]));
      const sm = b.eligible.map((i) => means(se[i]));
      for (const row of res.parcels!) {
        const h = heterogeneity(
          bm.map((m) => m.get(row.id) ?? NaN),
          sm.map((m) => m.get(row.id) ?? NaN)
        );
        row.i2 = Number.isFinite(h.I2) ? h.I2 : null;
      }
      res.heterogeneityNote = `I²: share of between-subject variance in the parcel-mean β beyond what the parcel-mean SE predicts (DerSimonian–Laird; treating within-parcel noise as fully correlated, so conservative). With ${b.eligible.length} maps and no real heterogeneity, I² still averages about .1, so small values are not evidence of anything.`;
      if (M.state.mode === 'space') M.scheduleDraw();
    });
  }
  return res;
}

/** Each placed map's mean z within one parcel (for brushing a parcel into the Marks). */
export function parcelMeanZ(a: M.Analysis, b: SimilarityBasis, sa: SpaceAtlas, id: number): Map<number, number> {
  const lk = `${b.key}|labels`;
  let labels = labelCache.get(lk);
  if (!labels) {
    labels = supportLabels(a, b, sa);
    labelCache.set(lk, labels);
  }
  const z = standardize(
    a.set.members.map((m) => m.values),
    b.eligible,
    b.support
  );
  const out = new Map<number, number>();
  b.eligible.forEach((i, p) => {
    let s = 0;
    let n = 0;
    for (let v = 0; v < labels!.length; v++)
      if (labels![v] === id) {
        s += z[p][v];
        n++;
      }
    out.set(i, n ? s / n : NaN);
  });
  return out;
}

/** Grid voxel at the centre of a parcel (for jumping the slice there). */
export function parcelCentre(sa: SpaceAtlas, id: number): [number, number, number] | null {
  const roi = sa.atlas.roi(id);
  if (!roi.indices.length) return null;
  const [nx, ny] = sa.atlas.space.dim as number[];
  let si = 0;
  let sj = 0;
  let sk = 0;
  for (const g of roi.indices) {
    si += g % nx;
    sj += Math.floor(g / nx) % ny;
    sk += Math.floor(g / (nx * ny));
  }
  const n = roi.indices.length;
  return [Math.round(si / n), Math.round(sj / n), Math.round(sk / n)];
}

// ---------------------------------------------------------------------------
// Covariate fits on the layout (V3-08)

export interface CovariateFit {
  field: string;
  kind: 'numeric' | 'categorical';
  r2: number;
  p: number;
  n: number;
  direction?: [number, number];
  centroids?: { level: string; x: number; y: number; n: number }[];
}

const fitCache = new Map<string, CovariateFit>();

export function covariateFit(key: string, coords: Float64Array, field: string, kind: 'numeric' | 'categorical', values: (number | string | null)[]): CovariateFit {
  const k = `${key}|${field}`;
  let f = fitCache.get(k);
  if (!f) {
    if (kind === 'numeric') {
      const r = envfitVector(
        coords,
        values.map((v) => (typeof v === 'number' ? v : null)),
        999,
        1
      );
      f = { field, kind, r2: r.r2, p: r.p, n: r.n, direction: r.direction };
    } else {
      const r = envfitFactor(
        coords,
        values.map((v) => (v === null ? null : String(v))),
        999,
        1
      );
      f = { field, kind, r2: r.r2, p: r.p, n: r.centroids.reduce((s, c) => s + c.n, 0), centroids: r.centroids };
    }
    if (fitCache.size > 32) fitCache.clear();
    fitCache.set(k, f);
  }
  return f;
}
