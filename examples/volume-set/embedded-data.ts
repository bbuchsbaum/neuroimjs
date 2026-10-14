import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol, Int32NeuroVol } from '../../src/volume/DenseNeuroVol';
import type { SpaceDataset, SpaceStatePatch } from '../../src/space/types';
import type { Atlas, Covariates, Template, VsMember } from './data';

let dataset: SpaceDataset | null = null;
let initialState: SpaceStatePatch = {};

export function installEmbeddedDataset(next: SpaceDataset, initial: SpaceStatePatch = {}): void {
  dataset = next;
  initialState = initial;
}

export function embeddedInitialState(): SpaceStatePatch { return initialState; }

export function embeddedDataset(): SpaceDataset | null {
  return dataset;
}

export function isEmbedded(): boolean {
  return new URLSearchParams(location.search).get('embedded') === '1';
}

function requireDataset(): SpaceDataset {
  if (!dataset) throw new Error('Embedded Space data have not been initialized.');
  return dataset;
}

function spaceFor(data: SpaceDataset): NeuroSpace {
  const affine = data.grid.affine.map((row) => [...row]);
  return new NeuroSpace([...data.grid.dimensions], [affine[0][0], affine[1][1], affine[2][2]], [affine[0][3], affine[1][3], affine[2][3]], undefined, affine);
}

function robustRange(values: Float32Array, mask: Uint8Array): [number, number] {
  const inside: number[] = [];
  for (let i = 0; i < values.length; i++) if (mask[i] && Number.isFinite(values[i])) inside.push(values[i]);
  inside.sort((a, b) => a - b);
  if (!inside.length) return [0, 1];
  const at = (q: number): number => inside[Math.round(q * (inside.length - 1))];
  return [at(0.02), at(0.995)];
}

export function embeddedManifest(): VsMember[] {
  return requireDataset().members.map((m) => ({ ...m, url: '' }));
}

export function embeddedTemplate(): Template {
  const data = requireDataset();
  const space = spaceFor(data);
  const t1 = new FloatNeuroVol(space, data.template);
  const mask = new FloatNeuroVol(space, Float32Array.from(data.mask));
  return { t1, t1Data: data.template, mask, range: robustRange(data.template, data.mask) };
}

export function embeddedAtlas(): Atlas | null {
  const data = requireDataset().atlas;
  if (!data) return null;
  return { name: data.name, labels: data.labels, names: new Map(data.regions.map((r) => [r.id, r.label])) };
}

export function embeddedSpaceAtlas(): { volume: Int32NeuroVol; name: string; regions: { id: number; label: string }[] } | null {
  const all = requireDataset();
  if (!all.atlas) return null;
  return { volume: new Int32NeuroVol(spaceFor(all), all.atlas.labels), name: all.atlas.name, regions: all.atlas.regions.map((r) => ({ ...r })) };
}

export function embeddedCovariates(): Covariates | null {
  const rows = requireDataset().covariates;
  if (!rows?.length) return null;
  const names = [...new Set(rows.flatMap((row) => Object.keys(row.values)))];
  const fields = names.map((name) => {
    const present = rows.map((r) => r.values[name]).filter((v): v is string | number => v !== null && v !== undefined);
    return { name, kind: present.length && present.every((v) => typeof v === 'number') ? ('numeric' as const) : ('categorical' as const) };
  });
  // Embedded member and covariate IDs are supplied as one package contract; do not
  // rewrite a `sub-` prefix here or marks would silently detach from their maps.
  return { fields, values: new Map(rows.map((r) => [r.subject, { ...r.values }])) };
}
