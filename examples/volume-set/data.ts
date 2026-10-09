import { readNiftiArrayBuffer } from '../../src/io/browserNifti';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import type { NeuroVol } from '../../src/volume/NeuroVol';
import { VolumeSet } from '../../src/volumeset/VolumeSet';

export interface VsMember {
  model: string;
  subject: string;
  contrast: string;
  url: string;
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

/** Optional cortical parcellation for cursor labels (Schaefer 2018, 400 parcels, 17 networks). */
export async function loadAtlas(): Promise<Atlas | null> {
  try {
    const [vol, tsv] = await Promise.all([fetchVolume('/vs/template/atlas.nii.gz'), fetch('/vs/template/atlas.tsv').then((r) => (r.ok ? r.text() : Promise.reject(new Error('no atlas labels'))))]);
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
  const res = await fetch('/vs/manifest.json');
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
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
  const [t1, mask] = await Promise.all([fetchVolume('/vs/template/T1w.nii.gz'), fetchVolume('/vs/template/mask.nii.gz')]);
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
