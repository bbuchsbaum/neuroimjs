import { mountSpace, type SpaceDataset, type SpaceHandle, type SpaceStatePatch } from 'neuroimjs/space';

function dataset(id: string, statistic: 'both' | 't' | 'beta' = 'both'): SpaceDataset {
  const dimensions = [16, 18, 14] as const;
  const size = dimensions.reduce((a, b) => a * b, 1);
  const template = new Float32Array(size);
  const mask = new Uint8Array(size);
  const maps = Array.from({ length: 5 }, () => new Float32Array(size));
  let g = 0;
  for (let k = 0; k < dimensions[2]; k++) for (let j = 0; j < dimensions[1]; j++) for (let i = 0; i < dimensions[0]; i++, g++) {
    const radius = ((i - 7.5) / 7) ** 2 + ((j - 8.5) / 8) ** 2 + ((k - 6.5) / 6) ** 2;
    template[g] = Math.max(0, 100 * (1 - radius / 2));
    mask[g] = radius <= 1 ? 1 : 0;
    maps.forEach((map, m) => { map[g] = mask[g] ? 4 * Math.sin(i / 3 + m) + Math.cos(j / 2) + k / 7 : 0; });
  }
  return {
    id,
    grid: { dimensions, affine: [[2, 0, 0, -16], [0, 2, 0, -18], [0, 0, 2, -14], [0, 0, 0, 1]] },
    template,
    mask,
    members: maps.map((map, i) => ({
      id: `${id}-s0${i + 1}`, subject: `s0${i + 1}`, model: 'model', contrast: 'cue',
      ...(statistic !== 'beta' && { t: map }),
      ...(statistic !== 't' && { beta: Float32Array.from(map, v => v / 4), se: new Float32Array(size).fill(0.1) }),
    })),
  };
}

const handles = new Map<string, SpaceHandle>();
const events: { host: string; type: string; revision: number; source?: string }[] = [];
const inputs = new Map<string, SpaceDataset>();
const api = {
  dataset, handles, events, inputs,
  mount(host: 'first' | 'second', data: SpaceDataset, initialState?: SpaceStatePatch, assetBaseUrl = '/space-assets/') {
    inputs.set(host, data);
    const handle = mountSpace(document.getElementById(host)!, { assetBaseUrl, data, initialState, timeoutMs: 20_000 });
    handles.set(host, handle);
    handle.on('statechange', event => events.push({ host, type: 'statechange', revision: event.revision, source: event.source }));
    handle.on('statuschange', event => events.push({ host, type: event.status, revision: event.revision }));
    handle.on('error', event => events.push({ host, type: event.error.name, revision: event.revision }));
    return handle;
  },
};

declare global { interface Window { spaceContract: typeof api } }
window.spaceContract = api;
