/**
 * The colour key of a map layer, with a histogram of the map's values on the
 * key's own x-scale: what a reader needs to see what the colours and the
 * threshold mean. Made to fill the empty fourth cell of the ortho layout
 * (`viewer.getLegendElement()`), or any element.
 *
 * Ported from neuromosaic's volume adapter (buildLegend / drawHistogram):
 * - a log-count histogram of the map's non-zero values over the display
 *   range, bins inside the hidden (threshold) band dimmed;
 * - the colour bar, the hidden band hatched with dashed edges, end caps when
 *   the data runs past the display range;
 * - ticks at the range ends and threshold edges, crowded ones dropped;
 * - the cursor's value as a marker on the bar and a caret on the histogram.
 *
 * Framework-free; follows the layer's changes through its MobX `version`.
 */
import { reaction } from 'mobx';
import type { NeuroVol } from '../volume/NeuroVol';

/** What MapLegend reads from a layer; VolLayer fits. */
export interface LegendLayer {
  id: string;
  volume: NeuroVol;
  getRange(): readonly [number, number] | [number, number];
  getThreshold(): readonly [number, number] | [number, number];
  getVolumeRange?(): [number, number];
  colorMap: { getColors(values: number[]): ArrayLike<number>[] };
  version?: number;
  visibilityVersion?: number;
  visible?: boolean;
}

export interface MapLegendOptions {
  /** Heading, e.g. "faces − houses (t)". Default the layer id. */
  title?: string;
  /** The value's symbol in the readout, e.g. "t". */
  stat?: string;
  /** Histogram bins. Default 72, as neuromosaic. */
  bins?: number;
  /** Match the stage the legend sits on rather than the page theme (the ortho cell is on the viewer's ground). */
  ground?: 'light' | 'dark';
}

/** Counts of non-zero values in [lo, hi], in `bins` equal bins (values outside go to the end caps). */
export function histogramCounts(data: ArrayLike<number>, lo: number, hi: number, bins = 72): Float64Array {
  const counts = new Float64Array(bins);
  const span = hi - lo || 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === 0 || !(v >= lo && v <= hi)) continue;
    const b = Math.floor(((v - lo) / span) * bins);
    counts[b >= bins ? bins - 1 : b] += 1;
  }
  return counts;
}

/** neuromosaic's report number: integers whole, others to 3 significant digits, a true minus. */
export function reportNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value === 0) return '0';
  const text = String(Math.abs(value) >= 1000 || Number.isInteger(value) ? Math.round(value) : Number(value.toPrecision(3)));
  return text.replace(/^-/, '−');
}

/** The layer's value at a world coordinate (nearest voxel), or null outside it. */
export function valueAt(layer: { volume: NeuroVol }, world: number[]): number | null {
  const s = layer.volume.space;
  const [nx, ny, nz] = s.dim as number[];
  const g = s.coordToGrid(world.slice(0, 3)).map(Math.round);
  if (g.some((v, i) => v < 0 || v >= [nx, ny, nz][i])) return null;
  const v = (layer.volume.getData() as ArrayLike<number>)[g[0] + g[1] * nx + g[2] * nx * ny];
  return Number.isFinite(v) ? v : null;
}

const STYLE_ID = 'nij-legend-style';
const LIGHT = '--nij-lg-ink:#16191b;--nij-lg-ink-2:#52514e;--nij-lg-ink-3:#8a8984;--nij-lg-hair:rgba(28,34,38,.18);--nij-lg-ground:#e3e3df;' +
  '--nij-lg-stage:#fafaf7;--nij-lg-wash:rgba(28,34,38,.18);--nij-lg-cut:rgba(28,34,38,.6);' +
  '--nij-lg-hist-hidden:rgba(28,34,38,.10);--nij-lg-hist-base:rgba(28,34,38,.2);--nij-lg-guide:rgba(28,34,38,.5);--nij-lg-caret:rgba(28,34,38,.9);';
const DARK = '--nij-lg-ink:#e6eaec;--nij-lg-ink-2:#c3c2b7;--nij-lg-ink-3:#8f8e86;--nij-lg-hair:rgba(255,255,255,.18);--nij-lg-ground:#2b3034;' +
  '--nij-lg-stage:#111619;--nij-lg-wash:rgba(255,255,255,.18);--nij-lg-cut:rgba(255,255,255,.6);' +
  '--nij-lg-hist-hidden:rgba(255,255,255,.10);--nij-lg-hist-base:rgba(255,255,255,.18);--nij-lg-guide:rgba(255,255,255,.55);--nij-lg-caret:rgba(255,255,255,.95);';
const CSS = `
.nij-legend{${LIGHT}box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:6px;padding:12px 14px 10px;
 font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--nij-lg-ink);container-type:size}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .nij-legend{${DARK}}}
:root[data-theme="dark"] .nij-legend,.nij-legend[data-ground="dark"]{${DARK}}
.nij-legend[data-ground="light"]{${LIGHT}}
.nij-legend-title{font-weight:600;overflow-wrap:anywhere}
.nij-legend-readout{color:var(--nij-lg-ink-2);font-variant-numeric:tabular-nums}
.nij-legend-readout b{color:var(--nij-lg-ink);font-weight:600}
.nij-legend-scale{display:grid;gap:6px;margin-top:auto;padding-inline:8px}
.nij-legend-hist{display:block;width:100%;height:clamp(24px,18cqh,56px);margin-bottom:-2px}
.nij-legend-bar{position:relative;height:10px;border-radius:3px;background-color:var(--nij-lg-ground);
 background-image:var(--nij-lg-gradient,linear-gradient(#555,#555));box-shadow:inset 0 0 0 1px var(--nij-lg-hair)}
.nij-legend-bar[data-cap-low="true"]{border-top-left-radius:0;border-bottom-left-radius:0}
.nij-legend-bar[data-cap-high="true"]{border-top-right-radius:0;border-bottom-right-radius:0}
.nij-legend-bar[data-thresholded="true"]::after{content:"";position:absolute;top:-1px;bottom:-1px;left:var(--nij-lg-cut-lo,50%);right:calc(100% - var(--nij-lg-cut-hi,50%));
 background:repeating-linear-gradient(135deg,var(--nij-lg-wash) 0 1px,transparent 1px 4px),var(--nij-lg-stage);box-shadow:inset 0 0 0 1px var(--nij-lg-hair)}
.nij-legend-cap{position:absolute;top:0;width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent}
.nij-legend-cap--low{right:100%;border-right:7px solid var(--nij-lg-cap-low,#555)}
.nij-legend-cap--high{left:100%;border-left:7px solid var(--nij-lg-cap-high,#555)}
.nij-legend-bar[data-cap-low="false"] .nij-legend-cap--low,.nij-legend-bar[data-cap-high="false"] .nij-legend-cap--high{display:none}
.nij-legend-bar[data-clipped="high"] .nij-legend-cap--high,.nij-legend-bar[data-clipped="low"] .nij-legend-cap--low{filter:drop-shadow(0 0 .5px var(--nij-lg-ink)) drop-shadow(0 0 .5px var(--nij-lg-ink))}
.nij-legend-cut{position:absolute;z-index:1;top:-5px;bottom:-5px;width:0;margin-left:-.5px;border-left:1px dashed var(--nij-lg-cut)}
.nij-legend-marker{position:absolute;z-index:1;top:-4px;bottom:-4px;width:2px;margin-left:-1px;border-radius:1px;background:var(--nij-lg-ink);box-shadow:0 0 0 1px var(--nij-lg-stage)}
.nij-legend-marker::before{content:"";position:absolute;top:-6px;left:50%;margin-left:-4px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--nij-lg-ink)}
.nij-legend-marker[data-hidden="true"]{background:#9aa4ac}
.nij-legend-marker[data-hidden="true"]::before{border-top-color:#9aa4ac}
.nij-legend-ticks{position:relative;height:14px;color:var(--nij-lg-ink-3);font-size:10.5px;font-variant-numeric:tabular-nums}
.nij-legend-tick{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
.nij-legend-tick[data-edge="start"]{transform:none}
.nij-legend-tick[data-edge="end"]{transform:translateX(-100%)}
.nij-legend-note{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
`;

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const rgb = (c: ArrayLike<number>) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

/** A viewer MapLegend can attach to; SimpleOrthogonalViewer fits. */
export interface LegendHostViewer {
  getLegendElement?(): HTMLElement | null;
  onCoordChange?(handler: (coord: number[]) => void): () => void;
  getWorldCoord?(): number[];
}

export class MapLegend {
  readonly element: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly readout: HTMLDivElement;
  private readonly hist: HTMLCanvasElement;
  private readonly bar: HTMLDivElement;
  private readonly marker: HTMLSpanElement;
  private readonly ticks: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly bins: number;
  private counts: { volume: unknown; key: string; counts: Float64Array } | null = null;
  private state: { lo: number; hi: number; threshold: [number, number]; thresholded: boolean; colors: ArrayLike<number>[] } | null = null;
  private value: number | null = null;
  private at: number[] | null = null;
  private disposers: (() => void)[] = [];
  private resize?: ResizeObserver;

  constructor(host: HTMLElement, private layer: LegendLayer, private o: MapLegendOptions = {}) {
    ensureStyle();
    this.bins = o.bins ?? 72;
    this.element = el('div', 'nij-legend');
    if (o.ground) this.element.dataset.ground = o.ground;
    this.title = el('div', 'nij-legend-title', o.title ?? layer.id);
    this.readout = el('div', 'nij-legend-readout');
    const scale = el('div', 'nij-legend-scale');
    scale.setAttribute('aria-hidden', 'true');
    this.hist = el('canvas', 'nij-legend-hist');
    this.bar = el('div', 'nij-legend-bar');
    this.marker = el('span', 'nij-legend-marker');
    this.marker.hidden = true;
    this.bar.append(this.marker, el('span', 'nij-legend-cap nij-legend-cap--low'), el('span', 'nij-legend-cap nij-legend-cap--high'));
    this.ticks = el('div', 'nij-legend-ticks');
    this.note = el('div', 'nij-legend-note');
    this.note.setAttribute('role', 'status');
    scale.append(this.hist, this.bar, this.ticks);
    this.element.append(this.title, this.readout, scale, this.note);
    host.appendChild(this.element);
    // Follow the layer: range, threshold and colormap changes bump `version`.
    this.disposers.push(reaction(() => [layer.version, layer.visibilityVersion], () => this.update()));
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => { this.hideCrowdedTicks(); this.drawHistogram(); });
      this.resize.observe(this.element);
    }
    this.update();
  }

  /**
   * Fill a viewer's legend cell (the fourth cell of the ortho layout) with the
   * key for `layer`, following the cursor. Returns null when the viewer has
   * no legend cell.
   */
  static attach(viewer: LegendHostViewer, layer: LegendLayer, o: MapLegendOptions = {}): MapLegend | null {
    const cell = viewer.getLegendElement?.();
    if (!cell) return null;
    cell.replaceChildren();
    const legend = new MapLegend(cell, layer, o);
    if (viewer.onCoordChange) legend.disposers.push(viewer.onCoordChange((c) => legend.setCursor(c)));
    const now = viewer.getWorldCoord?.();
    if (now) legend.setCursor(now);
    return legend;
  }

  /** Point the readout and marker at the map's value at a world coordinate. */
  setCursor(world: number[]): void {
    this.at = world.slice(0, 3);
    this.setValue(valueAt(this.layer, world));
  }

  /** Show a value on the key (null hides the marker). */
  setValue(value: number | null): void {
    this.value = value;
    const s = this.state;
    const sym = this.o.stat ?? 'value';
    const where = this.at ? ` at ${this.at.map((v) => reportNumber(Math.round(v))).join(' ')}` : '';
    this.readout.replaceChildren();
    if (value == null) {
      this.readout.textContent = this.at ? `outside the map${where}` : '';
      this.marker.hidden = true;
      this.bar.dataset.clipped = 'none';
      this.note.textContent = '';
      this.drawHistogram();
      return;
    }
    const b = document.createElement('b');
    b.textContent = `${sym} = ${reportNumber(value)}`;
    this.readout.append(b, where);
    if (!s) return;
    const { lo, hi } = s;
    const clipped = value > hi || value < lo;
    this.marker.hidden = clipped;
    this.marker.style.left = `${Math.max(0, Math.min(100, ((value - lo) / (hi - lo || 1)) * 100))}%`;
    const hidden = s.thresholded && value > s.threshold[0] && value < s.threshold[1];
    this.marker.dataset.hidden = String(hidden);
    this.bar.dataset.clipped = value > hi ? 'high' : value < lo ? 'low' : 'none';
    if (hidden) this.readout.append(' (hidden by the threshold)');
    this.note.textContent = clipped
      ? `The cursor value ${reportNumber(value)} is ${value > hi ? 'above' : 'below'} the display range; the key's end colour is used.`
      : '';
    this.drawHistogram();
  }

  /** Redraw from the layer (called on its changes; call it after swapping the layer's volume yourself). */
  update(): void {
    const layer = this.layer;
    const [lo, hi] = layer.getRange().map(Number) as [number, number];
    const threshold = layer.getThreshold().map(Number) as [number, number];
    const span = hi - lo || 1;
    const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
    const n = 24;
    const values = Array.from({ length: n + 1 }, (_, i) => lo + (span * i) / n);
    const colors = layer.colorMap.getColors(values);
    const stops = colors.map((c, i) => `${rgb(c)} ${((i / n) * 100).toFixed(2)}%`);
    const bar = this.bar;
    bar.style.setProperty('--nij-lg-gradient', `linear-gradient(to right, ${stops.join(', ')})`);
    const extent = layer.getVolumeRange?.().map(Number) ?? [lo, hi];
    bar.dataset.capLow = String(extent[0] < lo);
    bar.dataset.capHigh = String(extent[1] > hi);
    bar.style.setProperty('--nij-lg-cap-low', rgb(colors[0]));
    bar.style.setProperty('--nij-lg-cap-high', rgb(colors[colors.length - 1]));
    const thresholded = threshold[0] < threshold[1];
    bar.dataset.thresholded = String(thresholded);
    bar.style.setProperty('--nij-lg-cut-lo', `${pct(threshold[0])}%`);
    bar.style.setProperty('--nij-lg-cut-hi', `${pct(threshold[1])}%`);
    bar.querySelectorAll('.nij-legend-cut').forEach((c) => c.remove());
    const ticks = [lo, hi];
    if (thresholded) {
      for (const t of threshold) {
        const p = pct(t);
        if (p > 0 && p < 100) {
          const cut = el('span', 'nij-legend-cut');
          cut.style.left = `${p}%`;
          bar.appendChild(cut);
          ticks.push(t);
        }
      }
    }
    ticks.sort((a, b) => a - b);
    this.ticks.replaceChildren(...ticks.map((t) => {
      const tick = el('span', 'nij-legend-tick', reportNumber(t));
      const p = pct(t);
      tick.style.left = `${p}%`;
      tick.dataset.edge = p <= 0 ? 'start' : p >= 100 ? 'end' : 'mid';
      return tick;
    }));
    this.hideCrowdedTicks();
    bar.setAttribute('aria-label', thresholded ? `Values between ${reportNumber(threshold[0])} and ${reportNumber(threshold[1])} are not drawn.` : '');
    this.element.dataset.visible = String(layer.visible !== false);
    this.state = { lo, hi, threshold, thresholded, colors };
    this.setValue(this.value);
  }

  /** The histogram's counts (cached per volume and display range). */
  histogram(): Float64Array {
    const s = this.state as NonNullable<MapLegend['state']>;
    const key = `${s.lo}:${s.hi}`;
    if (!this.counts || this.counts.volume !== this.layer.volume || this.counts.key !== key) {
      this.counts = { volume: this.layer.volume, key, counts: histogramCounts(this.layer.volume.getData() as ArrayLike<number>, s.lo, s.hi, this.bins) };
    }
    return this.counts.counts;
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.resize?.disconnect();
    this.element.remove();
  }

  private hideCrowdedTicks(): void {
    const ticks = Array.from(this.ticks.children) as HTMLElement[];
    ticks.forEach((t) => (t.hidden = false));
    const width = this.ticks.clientWidth;
    if (!width) return;
    const kept: [number, number][] = [];
    // Range ends first, then threshold edges.
    for (const t of [...ticks].sort((a, b) => Number(a.dataset.edge === 'mid') - Number(b.dataset.edge === 'mid'))) {
      const w = t.offsetWidth, x = (parseFloat(t.style.left) / 100) * width;
      const left = t.dataset.edge === 'start' ? x : t.dataset.edge === 'end' ? x - w : x - w / 2;
      const box: [number, number] = [left - 4, left + w + 4];
      if (kept.some((k) => box[0] < k[1] && k[0] < box[1])) t.hidden = true; else kept.push(box);
    }
  }

  private drawHistogram(): void {
    const s = this.state, canvas = this.hist;
    if (!s) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const css = getComputedStyle(this.element);
    const ink = (name: string) => css.getPropertyValue(name).trim() || 'rgba(128,128,128,.5)';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const counts = this.histogram();
    let peak = 0;
    for (let i = 0; i < counts.length; i++) peak = Math.max(peak, Math.log1p(counts[i]));
    if (!peak) return;
    const bw = w / this.bins;
    for (let b = 0; b < this.bins; b++) {
      if (!counts[b]) continue;
      const centre = s.lo + ((b + 0.5) / this.bins) * (s.hi - s.lo);
      const hidden = s.thresholded && centre > s.threshold[0] && centre < s.threshold[1];
      const c = s.colors[Math.round(((b + 0.5) / this.bins) * (s.colors.length - 1))];
      ctx.fillStyle = hidden ? ink('--nij-lg-hist-hidden') : `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},0.85)`;
      const bh = Math.max(1, (Math.log1p(counts[b]) / peak) * (h - 1));
      ctx.fillRect(b * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
    }
    ctx.fillStyle = ink('--nij-lg-hist-base');
    ctx.fillRect(0, h - 1, w, 1);
    // The cursor's value: a guide line and a caret pointing down at the key.
    const v = this.value;
    if (v != null && v >= s.lo && v <= s.hi) {
      const x = Math.round(((v - s.lo) / (s.hi - s.lo || 1)) * (w - 1)) + 0.5;
      ctx.fillStyle = ink('--nij-lg-guide');
      ctx.fillRect(x - 0.5, 0, 1, h - 6);
      ctx.fillStyle = ink('--nij-lg-caret');
      ctx.beginPath();
      ctx.moveTo(x - 4.5, h - 6);
      ctx.lineTo(x + 4.5, h - 6);
      ctx.lineTo(x, h);
      ctx.closePath();
      ctx.fill();
    }
  }
}
