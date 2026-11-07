/**
 * Ties a viewer to a plot of the data behind the map it shows: a click (or
 * a coordinate change) commits a probe there; hovering previews one, when the
 * backing answers instantly. With no backing, attach() does nothing.
 *
 * Clicking where a map lights up is choosing a region on that map, so the
 * plot is marked circular unless the caller says the map is independent of
 * the backing data (another contrast, other runs, an a priori ROI).
 */
import type { Backing } from './types';
import { type Probe, voxel, sphere, probeIndices } from './probe';
import type { PlotPanel } from './PlotPanel';
import { type LayerHost, type ProbeMarkerOptions, type SubjectMapOptions, ProbeMarker, SubjectMap, isLayerHost } from './Overlays';

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
  getRootElement?: () => HTMLElement;
}

export interface BackedViewOptions {
  /** What a click reads: one voxel, or a sphere of this radius in mm. Default a 6 mm sphere. */
  probe?: 'voxel' | { sphere: number };
  /** Preview on pointer move. Default: on when the backing answers synchronously. */
  hover?: boolean;
  /**
   * The map was not made from these data. A string says why (e.g. "ROI from
   * the localizer runs"). Default false: probes are marked circular.
   */
  independent?: boolean | string;
  /** Names the selecting map in the circular warning, e.g. "faces − houses, t > 3.1". */
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
  /** Where to draw, when the viewer itself takes no layers. */
  layers?: LayerHost;
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
    const space = backing.space;
    if (host && space) {
      if (o.marker !== false) this.marker = new ProbeMarker(host, space, typeof o.marker === 'object' ? o.marker : {});
      if (o.subjectMaps !== false && backing.mapOf) {
        this.subjectMap = new SubjectMap(host, space, typeof o.subjectMaps === 'object' ? o.subjectMaps : {});
        this.subs.push(panel.onSubjectFocus((id) => void this.showSubject(id)));
      }
    }
  }

  static attach(viewer: ViewerLike, backing: Backing | null | undefined, panel: PlotPanel, o: BackedViewOptions = {}): BackedView | null {
    if (!backing) return null;
    const host = o.layers ?? (isLayerHost(viewer) ? viewer : null);
    const v = new BackedView(backing, panel, o, host);
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
    return v;
  }

  /** Read the backing at a world coordinate and show it. */
  async probeAt(world: number[]): Promise<void> {
    const id = ++this.seq; // a slow answer to an older probe must not win
    const ext = await this.backing.extract(this.probe(world));
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

  private probe(at: number[]): Probe {
    const p = this.o.probe ?? { sphere: 6 };
    return p === 'voxel' ? voxel(at) : sphere(at, p.sphere);
  }

  private circular(): boolean | string {
    if (this.o.independent) return false;
    return this.o.selection ?? true;
  }

  private commit(at: number[]): void {
    const p = at.slice(0, 3);
    // Views each report one coordinate change; read the backing once.
    if (this.pinned && p.every((v, i) => Math.abs(v - (this.pinned as number[])[i]) < 1e-6)) return;
    this.pinned = p;
    if (this.marker && this.backing.space) this.marker.show(probeIndices(this.probe(p), this.backing.space));
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
