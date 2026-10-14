import { readNiftiArrayBuffer } from '../../src/io/browserNifti';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { embeddedAtlas, embeddedCovariates, embeddedManifest, embeddedTemplate, isEmbedded } from './embedded-data';
import type { NeuroVol } from '../../src/volume/NeuroVol';
import { VolumeSet } from '../../src/volumeset/VolumeSet';

export interface VsMember {
  id?: string;
  model: string;
  subject: string;
  contrast: string;
  url: string;
  t?: Float32Array;
  beta?: Float32Array;
  se?: Float32Array;
}

/** Frame order inside each 4D contrast file (zero-based). */
export const STAT_FRAME = { beta: 0, t: 1, p: 2, se: 3 } as const;
export type StatName = keyof typeof STAT_FRAME;

export interface Template {
  t1: NeuroVol;
  t1Data: ArrayLike<number>;
  mask: NeuroVol;
  /** Robust display range of the T1 inside the brain mask. */
  range: [number, number];
}

export interface Atlas {
  name: string;
  labels: Int32Array | Uint8Array | Uint16Array | Int16Array | Float32Array | Float64Array;
  names: Map<number, string>;
}

/**
 * Resolve a volume-set data endpoint beside the demo page. This keeps the
 * Vite dev route at `/vs/...` while static builds work below `/neuroimjs/space/`.
 */
export function vsDataUrl(path: string): string {
  return new URL(`vs/${path.replace(/^\/+/, '')}`, document.baseURI).toString();
}

/** Optional cortical parcellation for cursor labels (Schaefer 2018, 400 parcels, 17 networks). */
export async function loadAtlas(): Promise<Atlas | null> {
  if (isEmbedded()) return embeddedAtlas();
  try {
    const [vol, tsv] = await Promise.all([fetchVolume(vsDataUrl('template/atlas.nii.gz')), fetch(vsDataUrl('template/atlas.tsv')).then((r) => (r.ok ? r.text() : Promise.reject(new Error('no atlas labels'))))]);
    const names = new Map<number, string>();
    for (const line of tsv.split(/\r?\n/).slice(1)) {
      const [idx, name] = line.split('\t');
      if (idx && name) names.set(Number(idx), name);
    }
    return { name: 'Schaefer 2018 (400 parcels, 17 networks)', labels: vol.getData() as Atlas['labels'], names };
  } catch {
    return null;
  }
}

/** "17Networks_LH_SomMotB_Aud_1" -> "Left · SomMotB · Aud 1". */
export function prettyParcel(name: string): string {
  const parts = name.replace(/^\d+Networks_/, '').split('_');
  const hemi = parts[0] === 'LH' ? 'Left' : parts[0] === 'RH' ? 'Right' : parts[0];
  const rest = parts.slice(1);
  const num = rest.length >= 2 && /^\d+$/.test(rest[rest.length - 1]) ? ` ${rest.pop()}` : '';
  return `${hemi} · ${rest.join(' · ')}${num}`;
}

export async function fetchManifest(): Promise<VsMember[]> {
  if (isEmbedded()) return embeddedManifest();
  const res = await fetch(vsDataUrl('manifest.json'));
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `manifest: HTTP ${res.status}`);
  }
  return (await res.json()).members as VsMember[];
}

async function fetchVolume(url: string, index = 0): Promise<NeuroVol> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return readNiftiArrayBuffer(await res.arrayBuffer(), { index });
}

function percentile(sorted: Float32Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

export async function loadTemplate(): Promise<Template> {
  if (isEmbedded()) return embeddedTemplate();
  const [t1, mask] = await Promise.all([fetchVolume(vsDataUrl('template/T1w.nii.gz')), fetchVolume(vsDataUrl('template/mask.nii.gz'))]);
  const t1Data = t1.getData() as ArrayLike<number>;
  const m = mask.getData() as ArrayLike<number>;
  const vals: number[] = [];
  for (let i = 0; i < t1Data.length; i++) if (m[i] > 0.5) vals.push(t1Data[i]);
  const sorted = Float32Array.from(vals).sort();
  return { t1, t1Data, mask, range: [percentile(sorted, 0.02), percentile(sorted, 0.995)] };
}

/** Load one statistic frame for each member and build a VolumeSet (limited concurrency). */
export async function loadSet(
  members: VsMember[],
  stat: StatName,
  mask: NeuroVol,
  onProgress?: (done: number, total: number) => void
): Promise<VolumeSet> {
  if (isEmbedded()) {
    const space = mask.space;
    const vols = members.map((m) => {
      const data = m[stat];
      if (!data) throw new Error(`${stat} data are unavailable for ${m.id ?? m.subject}.`);
      return new FloatNeuroVol(space, data);
    });
    onProgress?.(members.length, members.length);
    return VolumeSet.fromVolumes(vols, members.map((m) => ({ subject: m.subject, contrast: m.contrast, model: m.model })), mask);
  }
  const vols: NeuroVol[] = new Array(members.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < members.length) {
      const i = next++;
      vols[i] = await fetchVolume(members[i].url, STAT_FRAME[stat]);
      onProgress?.(++done, members.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return VolumeSet.fromVolumes(
    vols,
    members.map((m) => ({ subject: m.subject, contrast: m.contrast, model: m.model })),
    mask
  );
}

/** Expand a masked vector to a full-grid FloatNeuroVol (NaN outside the mask). */
export function toVolume(set: VolumeSet, values: Float32Array): FloatNeuroVol {
  const [nx, ny, nz] = set.dim;
  const grid = new Float32Array(nx * ny * nz).fill(NaN);
  for (let m = 0; m < set.maskIndex.length; m++) grid[set.maskIndex[m]] = values[m];
  return new FloatNeuroVol(set.space, grid);
}

/** Per-subject covariates from an optional BIDS participants.tsv. Values are numbers, strings or null (missing). */
export interface Covariates {
  fields: { name: string; kind: 'numeric' | 'categorical' }[];
  /** Subject ID (without "sub-") -> field -> value. */
  values: Map<string, Record<string, number | string | null>>;
}

/**
 * Load covariates if the data server has a participants.tsv; null when there is none (HTTP 204) or it
 * has no usable columns. A column is numeric when every non-missing value parses as a finite number.
 */
export async function fetchCovariates(): Promise<Covariates | null> {
  if (isEmbedded()) return embeddedCovariates();
  try {
    const res = await fetch(vsDataUrl('participants.tsv'));
    if (!res.ok || res.status === 204) return null;
    const lines = (await res.text()).split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return null;
    const head = lines[0].split('\t').map((h) => h.trim());
    const idCol = head.indexOf('participant_id');
    if (idCol < 0) return null;
    const missing = (v: string): boolean => v === '' || v === 'n/a' || v === 'NA' || v === 'NaN';
    const rows = lines.slice(1).map((l) => l.split('\t').map((v) => v.trim()));
    const fields = head
      .map((name, c) => ({ name, c }))
      .filter(({ c }) => c !== idCol)
      .map(({ name, c }) => {
        const present = rows.map((r) => r[c] ?? '').filter((v) => !missing(v));
        const numeric = present.length > 0 && present.every((v) => Number.isFinite(Number(v)));
        return { name, c, kind: numeric ? ('numeric' as const) : ('categorical' as const) };
      })
      .filter((f) => rows.some((r) => !missing(r[f.c] ?? '')));
    if (!fields.length) return null;
    const values = new Map<string, Record<string, number | string | null>>();
    for (const r of rows) {
      const id = (r[idCol] ?? '').replace(/^sub-/, '');
      if (!id) continue;
      const rec: Record<string, number | string | null> = {};
      for (const f of fields) {
        const v = r[f.c] ?? '';
        rec[f.name] = missing(v) ? null : f.kind === 'numeric' ? Number(v) : v;
      }
      values.set(id, rec);
    }
    return { fields: fields.map(({ name, kind }) => ({ name, kind })), values };
  } catch {
    return null;
  }
}
