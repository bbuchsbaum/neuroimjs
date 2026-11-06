/**
 * A plot of the data behind a map at one probe, with the controls to slice
 * (keep levels) and collapse (average a factor away). Framework-free.
 *
 * The color factor's level chips are the legend: a swatch, the level, its n,
 * and a click to drop or restore it.
 */
import type { Backing, Extract } from './types';
import { type PlotSpec, buildScene, factors, covariates, inferSpec, axisName, type Scene } from './spec';
import { type HitPoint, renderScene } from './render';

const STYLE_ID = 'nij-plot-style';
const LIGHT = '--nij-surface:#fcfcfb;--nij-ink:#0b0b0b;--nij-ink-2:#52514e;--nij-ink-3:#8a8984;--nij-rule:#e6e5e1;' +
  '--nij-s1:#2a78d6;--nij-s2:#eb6834;--nij-s3:#1baf7a;--nij-s4:#eda100;--nij-s5:#e87ba4;--nij-s6:#008300;--nij-s7:#6250d6;--nij-s8:#e34948;';
const DARK = '--nij-surface:#1a1a19;--nij-ink:#f0efec;--nij-ink-2:#c3c2b7;--nij-ink-3:#8f8e86;--nij-rule:#2e2e2c;' +
  '--nij-s1:#3987e5;--nij-s2:#d95926;--nij-s3:#199e70;--nij-s4:#c98500;--nij-s5:#d55181;--nij-s6:#008300;--nij-s7:#9085e9;--nij-s8:#e66767;';
const CSS = `
.nij-plot{${LIGHT}position:relative;font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--nij-ink);background:var(--nij-surface)}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .nij-plot{${DARK}--nij-faint:.75;--nij-band:.15}}
:root[data-theme="dark"] .nij-plot{${DARK}--nij-faint:.75;--nij-band:.15}
.nij-plot-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;margin-bottom:2px}
.nij-plot-title{font-weight:600}
.nij-plot-meta{color:var(--nij-ink-2)}
.nij-plot-svg{display:block;overflow:visible}
.nij-axis text{fill:var(--nij-ink-3);font-size:11px;font-variant-numeric:tabular-nums}
.nij-frame{stroke:var(--nij-ink-3);stroke-width:1}
.nij-zero{stroke:var(--nij-rule);stroke-width:1}
.nij-grid{stroke:var(--nij-rule);stroke-width:1;opacity:.5}
.nij-flag{fill:none;stroke:var(--nij-ink-2);stroke-width:1}
.nij-facet{fill:var(--nij-ink-2);font-weight:600}
.nij-label{fill:var(--nij-ink-2);font-size:11px}
.nij-note{fill:var(--nij-ink-2);font-size:11px;font-variant-numeric:tabular-nums}
.nij-estimate{fill:var(--nij-ink);font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.nij-direct{fill:var(--nij-ink-2);font-size:11px}
.nij-leader{stroke:var(--c);stroke-width:1;opacity:.6;fill:none}
.nij-subject-dot{fill:var(--c);opacity:var(--nij-faint,.4)}
.nij-subject-line{fill:none;stroke:var(--c);stroke-width:1;opacity:.22}
.has-hot .nij-subject-dot,.has-hot .nij-subject-line{opacity:.08}
.nij-plot .is-hot{opacity:1!important}
.nij-subject-line.is-hot{stroke:var(--nij-ink);stroke-width:1.5}
.nij-subject-dot.is-hot{fill:var(--nij-ink);stroke:var(--nij-surface);stroke-width:1.5}
.nij-hot-label{fill:var(--nij-ink);font-size:11px;font-weight:600;pointer-events:none}
.nij-mean{fill:var(--c);stroke:var(--nij-surface);stroke-width:1}
.nij-err{stroke:var(--c);stroke-width:1.5;stroke-linecap:round}
.nij-mean-line{fill:none;stroke:var(--c);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.nij-ribbon{fill:var(--c);opacity:var(--nij-band,.2)}
.nij-fit{stroke:var(--c);stroke-width:2}
.nij-cursor{stroke:var(--nij-ink-3);stroke-width:1;fill:none;pointer-events:none}
.nij-tip{position:absolute;pointer-events:none;background:var(--nij-surface);color:var(--nij-ink);border:1px solid var(--nij-rule);
 border-radius:6px;padding:4px 8px;box-shadow:0 2px 8px rgba(0,0,0,.12);white-space:nowrap;font-variant-numeric:tabular-nums;z-index:2}
.nij-tip b{font-weight:600}
.nij-tip i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);margin-right:5px}
.nij-plot-svg:focus-visible{outline:2px solid var(--nij-s1);outline-offset:2px}
.nij-plot-foot{color:var(--nij-ink-3);margin:2px 0 4px;max-width:62ch}
.nij-plot-warn{display:block;color:var(--nij-ink);border-left:3px solid var(--nij-s4);padding:1px 0 1px 7px;margin:2px 0 4px}
.nij-plot-controls{display:grid;grid-template-columns:max-content max-content 1fr;gap:3px 8px;align-items:center;color:var(--nij-ink-2);font-size:11px}
.nij-seg{display:inline-flex;gap:1px}
.nij-seg button,.nij-chip,.nij-more{font:inherit;border:0;background:none;color:var(--nij-ink-3);padding:1px 5px;cursor:pointer;border-radius:4px}
.nij-seg button[aria-pressed=true]{color:var(--nij-ink);background:var(--nij-rule)}
.nij-seg button:disabled{opacity:.35;cursor:default}
.nij-chips{display:flex;flex-wrap:wrap;gap:2px 8px}
.nij-chip{color:var(--nij-ink-2);padding:1px 2px}
.nij-chip i:empty{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c,var(--nij-ink-3));margin-right:4px;vertical-align:0}
.nij-chip small{color:var(--nij-ink-3);margin-left:3px}
.nij-chip[aria-pressed=false]{color:var(--nij-ink-3);text-decoration:line-through}
.nij-chip[aria-pressed=false] i:empty{background:transparent;box-shadow:inset 0 0 0 1px var(--nij-ink-3)}
.nij-more{grid-column:1/-1;justify-self:start;padding-left:0}
`;

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const SLOTS = 8;
/** One ordinal color scale for marks and legend alike; never cycles. */
export function colorScale(levels: string[]): (level: string | null) => string {
  return (l) => {
    const i = l == null ? 0 : levels.indexOf(l);
    return i >= 0 && i < SLOTS ? `var(--nij-s${i + 1})` : 'var(--nij-ink-3)';
  };
}

export interface PlotPanelOptions {
  /** Fixed width; follows the container when omitted. */
  width?: number;
  height?: number;
  spec?: PlotSpec;
  /** Show the slice/collapse controls. Default true. */
  controls?: boolean;
  /**
   * The probe was chosen on a map made from these same data. A string names
   * the selection, e.g. "faces − houses, t > 3.1".
   */
  circular?: boolean | string;
  onSubject?: (id: string | null) => void;
  onSpec?: (spec: PlotSpec) => void;
}

type Role = 'x' | 'color' | 'facet' | 'avg';
const ROLE_LABEL: Record<Role, string> = { x: 'x-axis', color: 'color', facet: 'facet', avg: 'average' };

export class PlotPanel {
  readonly element: HTMLDivElement;
  private spec: PlotSpec;
  private ext: Extract | null = null;
  private highlight: string | null = null;
  private svg: SVGSVGElement | null = null;
  private showAveraged = false;
  private resize?: ResizeObserver;
  private lastWidth = 0;
  private listening?: AbortController;

  constructor(private backing: Backing, private o: PlotPanelOptions = {}) {
    ensureStyle();
    this.element = document.createElement('div');
    this.element.className = 'nij-plot';
    this.spec = o.spec ?? inferSpec(backing);
    if (o.width == null && typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => {
        const w = this.element.clientWidth;
        if (Math.abs(w - this.lastWidth) > 2) this.draw();
      });
      this.resize.observe(this.element);
    }
  }

  getSpec(): PlotSpec { return this.spec; }

  setSpec(spec: PlotSpec): void {
    const before = this.positions();
    this.spec = spec;
    this.o.onSpec?.(spec);
    this.draw();
    this.glide(before);
  }

  /** Screen centres of keyed marks, for object constancy across a spec change. */
  private positions(): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    this.svg?.querySelectorAll<SVGCircleElement>('[data-key]').forEach((e) => {
      const r = e.getBoundingClientRect();
      out.set(e.dataset.key as string, [r.left + r.width / 2, r.top + r.height / 2]);
    });
    return out;
  }

  /** FLIP: marks that persist slide from where they were; new ones fade in. */
  private glide(before: Map<string, [number, number]>): void {
    const svg = this.svg;
    if (!svg || !before.size || typeof svg.animate !== 'function') return;
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const k = svg.getBoundingClientRect().width / (svg.viewBox.baseVal.width || 1) || 1;
    const opts = { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' };
    svg.querySelectorAll<SVGCircleElement>('[data-key]').forEach((e) => {
      const was = before.get(e.dataset.key as string);
      if (!was) { e.animate([{ opacity: 0 }, { opacity: getComputedStyle(e).opacity }], opts); return; }
      const r = e.getBoundingClientRect();
      const dx = (was[0] - (r.left + r.width / 2)) / k, dy = (was[1] - (r.top + r.height / 2)) / k;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], opts);
    });
    svg.querySelectorAll('path, line, text').forEach((e) => (e as SVGElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 }));
  }

  /** Show values at a probe (an extract from the backing). */
  show(ext: Extract, opts: { circular?: boolean | string } = {}): void {
    this.ext = ext;
    if (opts.circular !== undefined) this.o.circular = opts.circular;
    this.draw();
  }

  /** Emphasise one subject's marks, e.g. from the viewer. Cheap: no redraw. */
  setHighlight(id: string | null): void {
    this.highlight = id;
    const svg = this.svg;
    if (!svg) return;
    svg.querySelectorAll('.is-hot').forEach((e) => e.classList.remove('is-hot'));
    svg.classList.toggle('has-hot', !!id);
    svg.querySelector('.nij-hot-label')?.remove();
    if (!id) return;
    const marks = svg.querySelectorAll(`[data-subject="${cssEscape(id)}"]`);
    marks.forEach((e) => e.classList.add('is-hot'));
    // Name the subject at the end of its line (or beside its last dot).
    let at: [number, number] | null = null;
    marks.forEach((e) => {
      if (e.tagName === 'path') {
        const pts = (e.getAttribute('d') ?? '').slice(1).split('L').map((p) => p.split(',').map(Number));
        const last = pts[pts.length - 1];
        if (!at || last[0] > at[0]) at = [last[0], last[1]];
      } else if (!at) at = [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))];
    });
    if (at) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('class', 'nij-hot-label');
      t.setAttribute('x', String(at[0] + 6));
      t.setAttribute('y', String(at[1] - 6));
      t.textContent = id;
      svg.appendChild(t);
    }
  }

  scene(): Scene | null {
    return this.ext ? buildScene(this.backing, this.ext, this.spec, !!this.o.circular) : null;
  }

  dispose(): void { this.resize?.disconnect(); this.listening?.abort(); }

  private draw(): void {
    const root = this.element;
    root.replaceChildren();
    this.svg = null;
    this.listening?.abort();
    this.listening = new AbortController();
    const scene = this.scene();
    if (!scene) return;
    const width = this.o.width ?? (root.clientWidth || 460);
    this.lastWidth = width;
    const space = scene.provenance?.space ? ` (${scene.provenance.space})` : '';

    const head = div(root, 'nij-plot-head');
    span(head, 'nij-plot-title', scene.probe + space);
    span(head, 'nij-plot-meta', `${scene.voxels} voxel${scene.voxels === 1 ? '' : 's'} averaged · ${scene.nSubjects} subjects`);
    if (this.o.circular) {
      const what = typeof this.o.circular === 'string' ? ` (${this.o.circular})` : '';
      div(root, 'nij-plot-warn', `Circular: this region was picked on a map of these data${what}. Effects here are inflated; judge them on independent data.`);
    }
    if (scene.voxels === 0) {
      div(root, 'nij-plot-foot', 'No backing data at this point.');
      return;
    }
    const color = colorScale(scene.color.levels);
    const { svg, hits } = renderScene(scene, { width, height: this.o.height, color });
    root.appendChild(svg);
    this.svg = svg;
    this.hover(svg, hits);
    if (this.highlight) this.setHighlight(this.highlight);

    const foot: string[] = [];
    const ax = axisName(this.backing);
    if (scene.error === 'within') {
      foot.push(`Mean ± 95% within-subject CI (Cousineau–Morey${scene.x.name === ax && ax ? ', at each time point' : ''}): ` +
        `for comparing ${scene.color.name && scene.mixed ? 'conditions within a group' : 'conditions'}, not for comparing with 0${scene.mixed ? ' or across groups' : ''}.`);
    } else if (scene.error === 'between') foot.push('Mean ± 95% CI across subjects.');
    if (scene.covariate) {
      const fits = scene.panels.flatMap((p) => p.series.filter((x) => x.fit).map((x) => {
        const f = x.fit!;
        const pv = f.p < 0.001 ? '< .001' : '= ' + f.p.toFixed(3).replace(/^0/, '');
        const head = (x.level != null ? `${x.level}: ` : '') + `r = ${f.r.toFixed(2)}${scene.circular ? '' : `, p ${pv}`}, n = ${f.n}`;
        return head + (x.robust ? ` (${x.robust.fit.r.toFixed(2)} without ${x.robust.subjects.join(', ')}, ringed)` : '');
      }));
      foot.push(`${fits.join('; ')}. One point per subject; line with 95% CI of the fit.`);
    }
    if (scene.incomplete.length) foot.push(`Left out of the intervals for a missing cell: ${scene.incomplete.join(', ')}.`);
    if (scene.collapsed.length) foot.push(`Averaged within subject over ${scene.collapsed.join(', ')}.`);
    if (foot.length) div(root, 'nij-plot-foot', foot.join(' '));
    if (this.o.controls !== false) this.controls(root, scene, color);
  }

  /**
   * Nearest-point reading by mouse, touch (a tap pins, a tap elsewhere
   * clears) and keyboard (arrows step through the marks).
   */
  private hover(svg: SVGSVGElement, hits: HitPoint[]): void {
    const SVGNS = 'http://www.w3.org/2000/svg';
    const tip = document.createElement('div');
    tip.className = 'nij-tip';
    tip.hidden = true;
    tip.setAttribute('role', 'status');
    this.element.appendChild(tip);
    const ring = document.createElementNS(SVGNS, 'circle');
    ring.setAttribute('class', 'nij-cursor');
    ring.setAttribute('r', '6');
    ring.style.display = 'none';
    svg.appendChild(ring);
    const rule = document.createElementNS(SVGNS, 'line');
    rule.setAttribute('class', 'nij-cursor');
    rule.style.display = 'none';
    svg.insertBefore(rule, svg.firstChild);
    svg.setAttribute('tabindex', '0');
    const summaries = hits.filter((h) => h.xv !== undefined);
    const top = Math.min(...hits.map((h) => h.y), 20), bottom = svg.viewBox.baseVal.height - 30;
    let hot: string | null = null;
    let pinned = false;

    type Reading = { at: HitPoint; rows: { color?: string; text: string }[]; snapped: boolean };
    const nearest = (x: number, y: number): Reading | null => {
      let best: HitPoint | null = null, bd = 24 * 24;
      for (const h of hits) {
        if (h.xv !== undefined) continue;
        const d = (h.x - x) ** 2 + (h.y - y) ** 2;
        if (d < bd) { bd = d; best = h; }
      }
      // Subjects win when the pointer is right on them; otherwise a linear x snaps.
      if ((!best || bd > 36) && summaries.length) {
        let near: HitPoint | null = null, dx = 28;
        for (const h of summaries) if (Math.abs(h.x - x) < dx) { dx = Math.abs(h.x - x); near = h; }
        if (near) return snap(near);
      }
      return best ? { at: best, rows: rowsOf(best), snapped: false } : null;
    };
    const rowsOf = (h: HitPoint) => h.lines.map((text, i) => ({ text, color: i === h.lines.length - 1 ? h.color : undefined }));
    const snap = (near: HitPoint): Reading => {
      const col = summaries.filter((h) => h.panel === near.panel && h.xv === near.xv).sort((a, b) => a.y - b.y);
      return {
        at: { ...near, y: Math.min(...col.map((h) => h.y)) },
        rows: [{ text: near.lines[0] }, ...col.map((h) => ({ text: h.lines[1], color: h.color }))],
        snapped: true,
      };
    };
    const show = (r: Reading | null) => {
      if (!r) { clear(); return; }
      const best = r.at;
      rule.style.display = r.snapped ? '' : 'none';
      if (r.snapped) {
        rule.setAttribute('x1', String(best.x)); rule.setAttribute('x2', String(best.x));
        rule.setAttribute('y1', String(top)); rule.setAttribute('y2', String(bottom));
      }
      ring.setAttribute('cx', String(best.x));
      ring.setAttribute('cy', String(best.y));
      ring.style.display = r.snapped ? 'none' : '';
      tip.hidden = false;
      tip.replaceChildren();
      r.rows.forEach((row, i) => {
        const line = document.createElement('div');
        if (row.color) {
          const sw = document.createElement('i');
          sw.style.setProperty('--c', row.color);
          line.appendChild(sw);
        }
        const t = document.createElement(i === 0 && r.rows.length > 1 ? 'b' : 'span');
        t.textContent = row.text;
        line.appendChild(t);
        tip.appendChild(line);
      });
      const sr = svg.getBoundingClientRect(), er = this.element.getBoundingClientRect();
      const k = sr.width / (svg.viewBox.baseVal.width || sr.width || 1);
      const px = sr.left - er.left + best.x * k, py = sr.top - er.top + best.y * k;
      tip.style.left = `${Math.max(0, Math.min(px + 12, er.width - tip.offsetWidth))}px`;
      tip.style.top = `${py - tip.offsetHeight - 10}px`;
      const id = r.snapped ? null : best.subject ?? null;
      if (id !== hot) { hot = id; this.setHighlight(id); this.o.onSubject?.(id); }
    };
    const clear = () => {
      tip.hidden = true;
      rule.style.display = 'none';
      ring.style.display = 'none';
      if (hot !== null) { hot = null; this.setHighlight(null); this.o.onSubject?.(null); }
    };
    const local = (ev: PointerEvent): [number, number] => {
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      return [((ev.clientX - r.left) / (r.width || 1)) * (vb.width || r.width), ((ev.clientY - r.top) / (r.height || 1)) * (vb.height || r.height)];
    };
    svg.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'touch' && !pinned) show(nearest(...local(ev))); });
    svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch' && !pinned) clear(); });
    svg.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch') return;
      const r = nearest(...local(ev));
      pinned = !!r;
      show(r);
    });
    document.addEventListener('pointerdown', (ev) => {
      if (pinned && !svg.contains(ev.target as Node)) { pinned = false; clear(); }
    }, { signal: this.listening?.signal });
    // Keyboard: step through marks left to right.
    const order = [...hits.filter((h) => h.xv === undefined), ...summaries].sort((a, b) => a.x - b.x || a.y - b.y);
    let cursor = -1;
    svg.addEventListener('keydown', (ev) => {
      if (!order.length) return;
      if (ev.key === 'Escape') { cursor = -1; clear(); return; }
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      ev.preventDefault();
      cursor = Math.max(0, Math.min(order.length - 1, cursor + (ev.key === 'ArrowRight' ? 1 : -1)));
      const h = order[cursor];
      show(h.xv !== undefined ? snap(h) : { at: h, rows: rowsOf(h), snapped: false });
    });
    svg.addEventListener('blur', () => { cursor = -1; if (!pinned) clear(); });
  }

  private controls(root: HTMLElement, scene: Scene, color: (l: string | null) => string): void {
    const box = div(root, 'nij-plot-controls');
    const ax = axisName(this.backing);
    const fs = factors(this.backing).map((f) => f.name);
    const roleOf = (n: string): Role => (this.spec.x === n ? 'x' : this.spec.color === n ? 'color' : this.spec.facet === n ? 'facet' : 'avg');
    const assign = (n: string, r: Role) => {
      const s: PlotSpec = { ...this.spec };
      for (const k of ['x', 'color', 'facet'] as const) if (s[k] === n) s[k] = undefined;
      if (r !== 'avg') s[r] = n;
      this.setSpec(s);
    };
    const names = [...(ax ? [ax] : []), ...fs, ...covariates(this.backing).map((c) => c.name)];
    const mapped = names.filter((n) => roleOf(n) !== 'avg');
    const averaged = names.filter((n) => roleOf(n) === 'avg');
    const row = (n: string) => {
      span(box, '', n);
      const isFactor = fs.includes(n);
      const roles: Role[] = isFactor ? ['x', 'color', 'facet', 'avg'] : ['x', 'avg'];
      const seg = div(box, 'nij-seg');
      for (const r of roles) button(seg, ROLE_LABEL[r], roleOf(n) === r).onclick = () => assign(n, r);
      const chips = div(box, 'nij-chips');
      if (!isFactor) return;
      const levels = this.backing.columns.find((c) => c.name === n)?.levels ?? [];
      const keep = this.spec.keep?.[n];
      const isColor = this.spec.color === n;
      for (const l of levels) {
        const on = !keep || keep.includes(l);
        const c = button(chips, '', on, 'nij-chip');
        if (isColor) {
          const sw = document.createElement('i');
          if (on) sw.style.setProperty('--c', color(l));
          c.append(sw);
        }
        c.append(l);
        if (isColor && on && scene.nByLevel[l] != null) {
          const small = document.createElement('small');
          small.textContent = `n ${scene.nByLevel[l]}`;
          c.append(small);
        }
        c.title = on ? `Drop ${l}` : `Restore ${l}`;
        c.onclick = () => {
          const cur = keep ?? levels;
          const next = on ? cur.filter((x) => x !== l) : [...cur, l];
          const k = { ...(this.spec.keep ?? {}) };
          if (next.length === levels.length) delete k[n]; else if (next.length) k[n] = next;
          this.setSpec({ ...this.spec, keep: k });
        };
      }
    };
    mapped.forEach(row);
    if (this.showAveraged) averaged.forEach(row);
    if (averaged.length) {
      const more = button(box, this.showAveraged ? `▾ averaged over ${averaged.join(', ')}` : `▸ averaged over ${averaged.join(', ')}`, false, 'nij-more');
      more.onclick = () => { this.showAveraged = !this.showAveraged; this.draw(); };
    }
    span(box, '', 'subjects');
    const seg = div(box, 'nij-seg');
    const linesOk = scene.paired || (scene.x.kind === 'linear' && !scene.covariate);
    for (const s of ['points', 'lines', 'hidden'] as const) {
      const b = button(seg, s, (this.spec.subjects ?? 'points') === s);
      if (s === 'lines' && !linesOk) { b.disabled = true; b.title = 'Lines join a subject across a within-subject x'; }
      b.onclick = () => this.setSpec({ ...this.spec, subjects: s });
    }
    div(box, '');
  }
}

const cssEscape = (s: string): string => {
  const esc = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
  return esc ? esc(s) : s.replace(/["\\]/g, '\\$&');
};

function div(p: HTMLElement, cls: string, txt?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (txt) d.textContent = txt;
  p.appendChild(d);
  return d;
}
function span(p: HTMLElement, cls: string, txt: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = txt;
  p.appendChild(s);
  return s;
}
function button(p: HTMLElement, label: string, pressed: boolean, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.setAttribute('aria-pressed', String(pressed));
  p.appendChild(b);
  return b;
}
