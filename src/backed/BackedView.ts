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
import { type Probe, voxel, sphere } from './probe';
import type { PlotPanel } from './PlotPanel';

type Unsubscribe = () => void;
type Point = { worldCoord?: number[] | null; world?: number[] | null };

/** What BackedView needs from a viewer; SingleSliceViewer and SimpleOrthogonalViewer both fit. */
export interface ViewerLike {
  on?: (event: string, handler: (...args: any[]) => void) => Unsubscribe | void;
  onCoordChange?: (handler: (coord: number[]) => void) => Unsubscribe;
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
}

export class BackedView {
  private subs: Unsubscribe[] = [];
  private pinned: number[] | null = null;
  private frame = 0;
  private pending: number[] | null = null;
  private live = true;
  private seq = 0;

  private constructor(private backing: Backing, private panel: PlotPanel, private o: BackedViewOptions) {}

  static attach(viewer: ViewerLike, backing: Backing | null | undefined, panel: PlotPanel, o: BackedViewOptions = {}): BackedView | null {
    if (!backing) return null;
    const v = new BackedView(backing, panel, o);
    const sub = (u: Unsubscribe | void) => { if (typeof u === 'function') v.subs.push(u); };
    if (viewer.onCoordChange) sub(viewer.onCoordChange((c) => v.commit(c)));
    else if (viewer.on) sub(viewer.on('coordChanged', (c: number[]) => v.commit(c)));
    if (viewer.on) {
      sub(viewer.on('pointerDown', (e: Point) => { const w = e?.worldCoord ?? e?.world; if (w) v.commit(w); }));
      const hover = o.hover ?? v.isSync();
      if (hover) sub(viewer.on('pointerMove', (e: Point) => v.preview(e?.worldCoord ?? e?.world ?? null)));
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
    this.pinned = at.slice(0, 3);
    void this.probeAt(this.pinned);
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
