/**
 * What the plot shows, drawn back on the brain: the voxels a probe averaged,
 * and the map of the subject being hovered in the plot. Both are ordinary
 * VolLayers in any viewer that takes them (SimpleOrthogonalViewer does).
 */
import type { NeuroSpace } from '../geometry/NeuroSpace';
import type { NeuroVol } from '../volume/NeuroVol';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { VolLayer } from '../display/VolLayer';
import { ColorMapFactory } from '../display/ColorMapFactory';
import type { ColorMap } from '../display/ColorMap';

/** The layer calls BackedView uses; SimpleOrthogonalViewer has them all. */
export interface LayerHost {
  addLayer(layer: VolLayer): void;
  removeLayer(id: string): void;
  updateLayerVolume(id: string, volume: NeuroVol, opts?: { range?: [number, number] | null; threshold?: [number, number]; alpha?: number; colormap?: ColorMap | string }): void;
  updateLayer(id: string, params: { visible?: boolean; alpha?: number; range?: [number, number]; threshold?: [number, number] }): void;
  /** Optional: z-order (0 = back). Used to keep the probe marker on top. */
  moveLayer?(id: string, toIndex: number): void;
  listLayers?(): { id: string }[];
}

/** What a shared VolStack offers; enough to draw on every view built over it. */
export interface StackLike {
  addLayer(layer: VolLayer): void;
  removeLayer(layer: VolLayer): void;
  getLayerById(id: string): VolLayer | undefined;
  getLayerIds(): string[];
  moveLayerById(id: string, toIndex: number): void;
}

export function isStackLike(x: unknown): x is StackLike {
  const s = x as Partial<StackLike> | null;
  return !!s && typeof s.getLayerById === 'function' && typeof s.addLayer === 'function' &&
    typeof s.moveLayerById === 'function' && typeof s.getLayerIds === 'function';
}

/**
 * Draw through a VolStack directly: for viewers composed of SingleSliceViewers
 * sharing one stack (the views redraw from the layers' own changes).
 */
export function stackLayers(stack: StackLike): LayerHost {
  return {
    addLayer: (l) => stack.addLayer(l),
    removeLayer: (id) => { const l = stack.getLayerById(id); if (l) stack.removeLayer(l); },
    updateLayerVolume: (id, vol, opts) => {
      stack.getLayerById(id)?.replaceVolume(vol, { range: opts?.range ?? null, threshold: opts?.threshold, opacity: opts?.alpha });
    },
    updateLayer: (id, p) => {
      const l = stack.getLayerById(id);
      if (!l) return;
      if (p.visible !== undefined) l.setVisible(p.visible);
      if (p.alpha !== undefined) l.setOpacity(p.alpha);
      if (p.range) l.setRange(p.range);
      if (p.threshold) l.setThreshold(p.threshold);
    },
    moveLayer: (id, i) => stack.moveLayerById(id, i),
    listLayers: () => stack.getLayerIds().map((id) => ({ id })),
  };
}

export function isLayerHost(x: unknown): x is LayerHost {
  const h = x as Partial<LayerHost> | null;
  return !!h && typeof h.addLayer === 'function' && typeof h.removeLayer === 'function' &&
    typeof h.updateLayerVolume === 'function' && typeof h.updateLayer === 'function';
}

/** One layer this module owns: added on first use, then refilled in place. */
class OwnedLayer {
  private added = false;
  private shown = false;
  constructor(private host: LayerHost, readonly id: string, private make: (vol: NeuroVol, range?: [number, number]) => VolLayer) {}

  show(vol: NeuroVol, opts?: { range?: [number, number]; threshold?: [number, number] }): void {
    if (!this.added) {
      this.host.addLayer(this.make(vol, opts?.range));
      this.added = true;
    } else {
      this.host.updateLayerVolume(this.id, vol, { range: opts?.range ?? null, threshold: opts?.threshold });
    }
    if (!this.shown) { this.host.updateLayer(this.id, { visible: true }); this.shown = true; }
  }

  hide(): void {
    if (this.added && this.shown) { this.host.updateLayer(this.id, { visible: false }); this.shown = false; }
  }

  remove(): void {
    if (this.added) this.host.removeLayer(this.id);
    this.added = this.shown = false;
  }
}

export interface ProbeMarkerOptions {
  /** CSS hex color of the marker. Default cyan, which stands apart from hot and diverging maps. */
  color?: string;
  /** Opacity. Default 0.55. */
  opacity?: number;
}

/** The voxels the plot averaged, marked on every view. */
export class ProbeMarker {
  private layer: OwnedLayer;
  private vol: FloatNeuroVol;

  constructor(host: LayerHost, private space: NeuroSpace, o: ProbeMarkerOptions = {}) {
    const color = o.color ?? '#33d6e8';
    this.vol = new FloatNeuroVol(space, new Float32Array(gridSize(space)));
    this.layer = new OwnedLayer(host, 'backed-probe', (vol) => {
      const l = new VolLayer('backed-probe', vol, ColorMapFactory.createGradient(color, color, 2, { name: 'Probe', range: [0, 1] }),
        [0, 1], [-0.5, 0.5], o.opacity ?? 0.55);
      l.internal = true;
      return l;
    });
  }

  show(indices: number[]): void {
    if (!indices.length) { this.layer.hide(); return; }
    const data = new Float32Array(gridSize(this.space));
    for (const i of indices) data[i] = 1;
    this.vol = new FloatNeuroVol(this.space, data);
    this.layer.show(this.vol);
  }

  hide(): void { this.layer.hide(); }
  remove(): void { this.layer.remove(); }
}

export interface SubjectMapOptions {
  /** Colormap for subject maps. Default a blue–white–red diverging map. */
  colormap?: ColorMap;
  /** Fixed display range; default symmetric at the 98th percentile of |value|. */
  range?: [number, number];
  /**
   * Values inside this band are transparent. Default: the middle 40% of the
   * display range, so the strongest parts of one subject's map show and the
   * anatomy stays readable.
   */
  threshold?: [number, number];
  opacity?: number;
}

/** A hovered subject's own map, replacing nothing: it sits on top while hovered. */
export class SubjectMap {
  private layer: OwnedLayer;
  private cache = new Map<string, FloatNeuroVol>();

  constructor(private host: LayerHost, private space: NeuroSpace, private o: SubjectMapOptions = {}) {
    this.layer = new OwnedLayer(host, 'backed-subject', (vol, range) => {
      const r = range ?? o.range ?? [-1, 1];
      const l = new VolLayer('backed-subject', vol, o.colormap ?? ColorMapFactory.createDiverging('#2a78d6', '#f4f4f2', '#d6452a', 256, { name: 'Subject' }),
        r, o.threshold ?? quiet(r), o.opacity ?? 0.85);
      l.internal = true;
      return l;
    });
  }

  /** Show a map, caching it under `key` (the subject and the levels kept). */
  show(key: string, map: () => Float32Array): void {
    let vol = this.cache.get(key);
    if (!vol) {
      vol = new FloatNeuroVol(this.space, map());
      this.cache.set(key, vol);
      if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value as string);
    }
    const range = this.o.range ?? symmetricRange(vol.getData() as Float32Array);
    this.layer.show(vol, { range, threshold: this.o.threshold ?? quiet(range) });
    // Keep the probe marker above the subject's map.
    const ids = this.host.listLayers?.().map((l) => l.id) ?? [];
    if (this.host.moveLayer && ids.includes('backed-probe')) this.host.moveLayer('backed-probe', ids.length - 1);
  }

  hide(): void { this.layer.hide(); }
  remove(): void { this.layer.remove(); this.cache.clear(); }
}

const quiet = (r: [number, number]): [number, number] => [r[0] * 0.4, r[1] * 0.4];

const gridSize = (s: NeuroSpace) => (s.dim as number[]).slice(0, 3).reduce((a, b) => a * b, 1);

export function symmetricRange(v: ArrayLike<number>): [number, number] {
  const a: number[] = [];
  const step = Math.max(1, Math.floor(v.length / 200000));
  for (let i = 0; i < v.length; i += step) if (Number.isFinite(v[i])) a.push(Math.abs(v[i]));
  if (!a.length) return [-1, 1];
  a.sort((x, y) => x - y);
  const top = a[Math.floor(0.98 * (a.length - 1))] || a[a.length - 1] || 1;
  return [-top, top];
}
