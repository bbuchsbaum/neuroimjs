/**
 * Ties a viewer to a plot of the data behind the map it shows: a click (or
 * a coordinate change) commits a probe there; hovering previews one, when the
 * backing answers instantly. With no backing, attach() does nothing.
 *
 * Clicking where a map lights up is choosing a region on that map, so the
 * plot is marked circular unless the caller says the map is independent of
 * the backing data (another contrast, other runs, an a priori ROI).
 */
import { reaction } from 'mobx';
import type { NeuroVol } from '../volume/NeuroVol';
import type { Backing } from './types';
import { type Probe, voxel, sphere, mask, probeIndices, probeLabel, clusterAt, regrid, describeThreshold } from './probe';
import type { PlotPanel } from './PlotPanel';
import {
  type LayerHost, type ProbeMarkerOptions, type SubjectMapOptions, type StackLike,
  ProbeMarker, SubjectMap, isLayerHost, isStackLike, stackLayers,
} from './Overlays';

type Unsubscribe = () => void;
type Point = { worldCoord?: number[] | null; world?: number[] | null };

/**
 * What BackedView needs from a viewer; SingleSliceViewer and
 * SimpleOrthogonalViewer both fit. Layer methods (addLayer, removeLayer,
 * updateLayer, updateLayerVolume), when present, let it draw on the brain.
 */
export interface ViewerLike {
  on?: (event: string, handler: (...args: any[]) => void) => Unsubscribe | void;
  onCoordChange?: (handler: (coord: number[]) => void) => Unsubscribe;
  onPointerDown?: (handler: (e: Point) => void) => Unsubscribe;
  onPointerMove?: (handler: (e: Point) => void) => Unsubscribe;
  /** Lets a hover preview return to the clicked point when the pointer leaves. */
  getRootElement?: () => HTMLElement | null;
}

/** A probe that needs no map: one voxel, or a sphere of this radius in mm. */
export type PointProbe = 'voxel' | { sphere: number };

/**
 * What a click reads.
 * - `'voxel'`: the voxel under the pointer.
 * - `{ sphere: r }`: every voxel within r mm.
 * - `{ cluster }`: the connected blob under the pointer on the `map` layer at
 *   its current threshold (same sign as the clicked voxel), so the threshold
 *   control decides the region. A click outside every blob reads `fallback`
 *   (default a 6 mm sphere; `null` reads nothing).
 */
export type ProbeSpec =
  | PointProbe
  | { cluster: true | { connectivity?: 6 | 18 | 26 }; fallback?: PointProbe | null };

/** The on-screen layer a backing stands behind; VolLayer fits. */
export interface MapLayer {
  id: string;
  volume: NeuroVol;
  getThreshold(): readonly [number, number] | [number, number];
  /** MobX-observable change counter (VolLayer has one); lets the plot follow threshold changes. */
  version?: number;
}

export interface BackedViewOptions {
  /** What a click reads. Default a 6 mm sphere. Change it later with setProbe(). */
  probe?: ProbeSpec;
  /**
   * The layer on screen that shows the map these data back. Needed for a
   * cluster probe; also lets the circular warning name the live threshold.
   */
  map?: MapLayer;
  /** The map's statistic, for threshold wording ("|t| > 3.1"). Default "value". */
  stat?: string;
  /** Preview on pointer move. Default: on when the backing answers synchronously. */
  hover?: boolean;
  /**
   * The map was not made from these data. A string says why (e.g. "ROI from
   * the localizer runs"). Default false: probes are marked circular.
   */
  independent?: boolean | string;
  /**
   * Names the selecting map in the circular warning, e.g. "faces − houses".
   * With `map`, the live threshold is added ("faces − houses, |t| > 3.1").
   */
  selection?: string;
  /**
   * Mark the voxels the plot averaged, on the viewer. Default on when the
   * viewer takes layers and the backing has a space; false turns it off.
   */
  marker?: boolean | ProbeMarkerOptions;
  /**
   * While a subject is pointed at in the plot, show that subject's map on
   * the viewer (averaged over the levels the plot keeps). Default on when the
   * viewer takes layers and the backing can make maps.
   */
  subjectMaps?: boolean | SubjectMapOptions;
  /**
   * Where to draw, when the viewer itself takes no layers: a LayerHost, or
   * the VolStack that a set of SingleSliceViewers share.
   */
  layers?: LayerHost | StackLike;
}

export class BackedView {
  private subs: Unsubscribe[] = [];
  private pinned: number[] | null = null;
  private frame = 0;
  private pending: number[] | null = null;
  private live = true;
  private seq = 0;
  private marker: ProbeMarker | null = null;
  private subjectMap: SubjectMap | null = null;
  private subjectSeq = 0;

  private constructor(private backing: Backing, private panel: PlotPanel, private o: BackedViewOptions, host: LayerHost | null) {
    if (isCluster(o.probe) && !o.map) throw new Error('a cluster probe needs the map layer it reads clusters from (options.map)');
    const space = backing.space;
    if (o.map) {
      // The threshold decides clusters and the warning's wording: follow it.
      // VolLayer bumps its observable `version` on any display change, so
      // compare the threshold itself before reading again.
      const key = () => [...o.map!.getThreshold()].join(',');
      let last = key();
      this.subs.push(reaction(() => o.map!.version, () => {
        const now = key();
        if (now !== last) { last = now; this.refresh(); }
      }));
    }
    if (host && space) {
      if (o.marker !== false) this.marker = new ProbeMarker(host, space, typeof o.marker === 'object' ? o.marker : {});
      if (o.subjectMaps !== false && backing.mapOf) {
        this.subjectMap = new SubjectMap(host, space, typeof o.subjectMaps === 'object' ? o.subjectMaps : {});
        this.subs.push(panel.onSubjectFocus((id) => void this.showSubject(id)));
      }
    }
  }

  /**
   * Link one viewer, or several views of one scene (e.g. axial, sagittal and
   * coronal SingleSliceViewers kept in step by a ViewSynchronizer).
   */
  static attach(viewers: ViewerLike | ViewerLike[], backing: Backing | null | undefined, panel: PlotPanel, o: BackedViewOptions = {}): BackedView | null {
    if (!backing) return null;
    const list = Array.isArray(viewers) ? viewers : [viewers];
    const given = o.layers;
    const host = given ? (isStackLike(given) ? stackLayers(given) : given) : (list.find(isLayerHost) as LayerHost | undefined) ?? null;
    const v = new BackedView(backing, panel, o, host);
    for (const viewer of list) v.listen(viewer);
    return v;
  }

  /** What a click reads now. */
  getProbe(): ProbeSpec {
    return this.o.probe ?? { sphere: 6 };
  }

  /** Change what a click reads; the current point is read again at once. */
  setProbe(probe: ProbeSpec): void {
    if (isCluster(probe) && !this.o.map) throw new Error('a cluster probe needs the map layer it reads clusters from (options.map)');
    this.o.probe = probe;
    this.refresh();
  }

  private listen(viewer: ViewerLike): void {
    const v = this;
    const o = this.o;
    const sub = (u: Unsubscribe | void) => { if (typeof u === 'function') v.subs.push(u); };
    const at = (e: Point) => e?.worldCoord ?? e?.world ?? null;
    if (viewer.onCoordChange) sub(viewer.onCoordChange((c) => v.commit(c)));
    else if (viewer.on) sub(viewer.on('coordChanged', (c: number[]) => v.commit(c)));
    const down = (e: Point) => { const w = at(e); if (w) v.commit(w); };
    if (viewer.onPointerDown) sub(viewer.onPointerDown(down));
    else if (viewer.on) sub(viewer.on('pointerDown', down));
    if (o.hover ?? v.isSync()) {
      const move = (e: Point) => v.preview(at(e));
      if (viewer.onPointerMove) sub(viewer.onPointerMove(move));
      else if (viewer.on) sub(viewer.on('pointerMove', move));
      const root = viewer.getRootElement?.();
      if (root) {
        const leave = () => v.preview(null);
        root.addEventListener('pointerleave', leave);
        sub(() => root.removeEventListener('pointerleave', leave));
      }
    }
  }

  /** Read the backing at a world coordinate and show it. */
  async probeAt(world: number[]): Promise<void> {
    const id = ++this.seq; // a slow answer to an older probe must not win
    const r = this.resolve(world);
    const ext = r
      ? await this.backing.extract(r.probe)
      : { label: `no cluster at ${fmtAt(world)} at ${this.thresholdText()}`, voxels: 0, width: 1, values: new Float32Array(0) };
    if (!this.live || id !== this.seq) return;
    const why = typeof this.o.independent === 'string' ? this.o.independent : undefined;
    this.panel.show(ext, { circular: this.circular(), independent: why });
  }

  detach(): void {
    this.live = false;
    this.subs.forEach((u) => u());
    this.subs = [];
    this.marker?.remove();
    this.subjectMap?.remove();
    if (this.frame) cancelAnimationFrame(this.frame);
  }

  /** The probe at a point, and its voxels on the backing's grid; null when it reads nothing. */
  private resolve(at: number[]): { probe: Probe; indices: number[] } | null {
    const spec = this.getProbe();
    const point = (p: PointProbe, note = ''): { probe: Probe; indices: number[] } => {
      const base = p === 'voxel' ? voxel(at) : sphere(at, p.sphere);
      const probe = note ? mask(this.indicesOf(base), probeLabel(base) + note) : base;
      return { probe, indices: this.indicesOf(base) };
    };
    if (!isCluster(spec)) return point(spec);
    const map = this.o.map as MapLayer;
    const th = map.getThreshold() as [number, number];
    const conn = spec.cluster === true ? 26 : spec.cluster.connectivity ?? 26;
    const found = clusterAt({ space: map.volume.space, values: map.volume.getData() as ArrayLike<number>, threshold: th }, at, conn);
    if (!found.indices.length) {
      const fb = spec.fallback === undefined ? { sphere: 6 } : spec.fallback;
      return fb ? point(fb, `, outside every cluster at ${this.thresholdText()}`) : null;
    }
    const indices = this.backing.space ? regrid(found.indices, map.volume.space, this.backing.space) : found.indices;
    return { probe: mask(indices, `cluster at ${fmtAt(at)}, ${this.thresholdText()}`), indices };
  }

  private indicesOf(p: Probe): number[] {
    return this.backing.space ? probeIndices(p, this.backing.space) : [];
  }

  private thresholdText(): string {
    return this.o.map ? describeThreshold(this.o.map.getThreshold() as [number, number], this.o.stat ?? 'value') : '';
  }

  private circular(): boolean | string {
    if (this.o.independent) return false;
    if (this.o.map) return `${this.o.selection ?? this.o.map.id}, ${this.thresholdText()}`;
    return this.o.selection ?? true;
  }

  /** Read the current point again (the probe or the threshold changed). */
  private refresh(): void {
    if (!this.pinned) return;
    const p = this.pinned;
    this.pinned = null;
    this.commit(p);
  }

  private commit(at: number[]): void {
    const p = at.slice(0, 3);
    // Views each report one coordinate change; read the backing once.
    if (this.pinned && p.every((v, i) => Math.abs(v - (this.pinned as number[])[i]) < 1e-6)) return;
    this.pinned = p;
    if (this.marker) this.marker.show(this.resolve(p)?.indices ?? []);
    void this.probeAt(p);
  }

  /** The hovered subject's map on the brain; null puts the brain back. */
  private async showSubject(id: string | null): Promise<void> {
    const sm = this.subjectMap, mapOf = this.backing.mapOf?.bind(this.backing);
    if (!sm || !mapOf) return;
    const mine = ++this.subjectSeq;
    if (id == null) { sm.hide(); return; }
    const rows = this.panel.rowsOf(id);
    const key = `${id}|${rows.join(',')}`;
    const map = await mapOf(rows);
    if (!this.live || mine !== this.subjectSeq) return;
    sm.show(key, () => map);
  }

  /** rAF-throttled; leaving the map returns to the committed probe. */
  private preview(at: number[] | null): void {
    this.pending = at ? at.slice(0, 3) : this.pinned;
    if (this.frame || !this.pending) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.pending) void this.probeAt(this.pending);
    });
  }

  private isSync(): boolean {
    try {
      const r = this.backing.extract({ kind: 'mask', indices: [], label: '' });
      return !(r && typeof (r as Promise<unknown>).then === 'function');
    } catch {
      return false;
    }
  }
}

const isCluster = (p: ProbeSpec | undefined): p is Extract<ProbeSpec, { cluster: unknown }> =>
  typeof p === 'object' && p !== null && 'cluster' in p;
const fmtAt = (p: number[]) => p.map((v) => (v < 0 ? '−' : '') + Math.abs(Math.round(v))).join(' ');
