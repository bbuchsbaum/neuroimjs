/**
 * A scene drawn as SVG: small multiples on one y scale, subject marks quiet
 * behind the summaries, direct labels where they fit. No dependencies.
 */
import type { Scene, Series } from './spec';

const NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | undefined>;
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}
function text(parent: Element, s: string, attrs: Attrs): SVGTextElement {
  const t = el('text', attrs, parent);
  t.textContent = s;
  return t;
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) { const d = Math.abs(lo) || 1; lo -= d; hi += d; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) as number;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

export const fmtNum = (v: number) => {
  const a = Math.abs(v);
  const s = a === 0 ? '0' : a >= 100 ? a.toFixed(0) : a >= 10 ? +a.toFixed(1) + '' : +a.toPrecision(2) + '';
  return (v < 0 ? '−' : '') + s;
};

/** Deterministic offsets so subject dots in one band don't overlap (a 1D swarm). */
function swarm(ys: number[], r: number): number[] {
  const order = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0]);
  const placed: { y: number; x: number }[] = [];
  const out = new Array(ys.length).fill(0);
  for (const [y, i] of order) {
    let x = 0;
    for (let k = 0; k < 40; k++) {
      const cand = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * r * 1.05;
      if (placed.every((p) => (p.x - cand) ** 2 + (p.y - y) ** 2 >= (2 * r) ** 2 * 0.95)) { x = cand; break; }
    }
    placed.push({ x, y });
    out[i] = x;
  }
  return out;
}

export interface RenderOptions {
  width: number;
  height?: number;
  /** CSS colors for color levels, in level order. */
  palette?: string[];
  highlight?: string | null;
  onSubject?: (id: string | null, ev?: MouseEvent) => void;
}

export const DEFAULT_PALETTE = ['var(--nij-series-1)', 'var(--nij-series-2)', 'var(--nij-series-3)', 'var(--nij-series-4)'];

export function renderScene(scene: Scene, o: RenderOptions): SVGSVGElement {
  const W = o.width;
  const H = o.height ?? 240;
  const palette = o.palette ?? DEFAULT_PALETTE;
  const colorOf = (s: Series) => (s.level == null ? palette[0] : palette[scene.color.levels.indexOf(s.level) % palette.length]);
  const linear = scene.x.kind === 'linear';
  const endLabels = linear && !scene.covariate && scene.color.levels.length > 1;
  const m = { top: scene.facet.name ? 22 : 8, right: endLabels ? 64 : 12, bottom: 34, left: 40 };
  const nP = scene.panels.length;
  const gap = 18;
  const pw = (W - m.left - m.right - gap * (nP - 1)) / nP;
  const ph = H - m.top - m.bottom;

  // Shared y domain: summaries always; subject marks when drawn.
  const ys: number[] = [0];
  const xs: number[] = [];
  for (const p of scene.panels) for (const s of p.series) {
    for (const c of s.cells) { ys.push(c.mean); if (Number.isFinite(c.lo)) ys.push(c.lo, c.hi); if (linear) xs.push(c.x as number); }
    if (scene.subjects !== 'hidden' || scene.covariate) for (const sub of s.subjects) for (const pt of sub.points) {
      ys.push(pt.y); if (linear) xs.push(pt.x as number);
    }
  }
  const yt = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = Math.min(yt[0], Math.min(...ys)), y1 = Math.max(yt[yt.length - 1], Math.max(...ys));
  const Y = (v: number) => m.top + ph - ((v - y0) / (y1 - y0)) * ph;
  const xt = linear ? niceTicks(Math.min(...xs), Math.max(...xs), 5) : [];
  const xlo = linear ? Math.min(...xs) : 0, xhi = linear ? Math.max(...xs) : 1;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'nij-plot-svg', role: 'img' });
  svg.setAttribute('aria-label', `${scene.y.label} at ${scene.probe}`);

  // Y axis: ticks as text, hairline grid.
  const axis = el('g', { class: 'nij-axis' }, svg);
  for (const t of yt) {
    text(axis, fmtNum(t), { x: m.left - 6, y: Y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    el('line', { x1: m.left, x2: W - m.right, y1: Y(t), y2: Y(t), class: t === 0 ? 'nij-zero' : 'nij-grid' }, axis);
  }

  scene.panels.forEach((panel, pi) => {
    const px = m.left + pi * (pw + gap);
    const g = el('g', { class: 'nij-panel' }, svg);
    if (panel.facet != null) text(g, panel.facet, { x: px, y: 12, class: 'nij-facet' });
    const nS = panel.series.length;
    const band = scene.x.levels.length || 1;
    const bw = pw / band;
    const dodge = (si: number) => (nS > 1 && !linear ? (si - (nS - 1) / 2) * Math.min(18, bw / (nS + 1)) : 0);
    const X = (x: string | number, si = 0) =>
      linear ? px + ((Number(x) - xlo) / (xhi - xlo || 1)) * pw
        : px + (Math.max(0, scene.x.levels.indexOf(String(x))) + 0.5) * bw + dodge(si);

    // X axis.
    const xa = el('g', { class: 'nij-axis' }, g);
    if (linear) for (const t of xt) {
      if (t < xlo - 1e-9 || t > xhi + 1e-9) continue;
      text(xa, fmtNum(t), { x: X(t), y: m.top + ph + 16, 'text-anchor': 'middle' });
    } else scene.x.levels.forEach((l) => text(xa, l, { x: X(l), y: m.top + ph + 16, 'text-anchor': 'middle' }));

    panel.series.forEach((s, si) => {
      const col = colorOf(s);
      const sg = el('g', { class: 'nij-series', style: `--c:${col}` }, g);
      // Subjects first, quiet.
      if (scene.covariate || scene.subjects !== 'hidden') {
        const subs = el('g', { class: 'nij-subjects' }, sg);
        if (scene.subjects === 'lines' && (scene.paired || linear) && !scene.covariate) {
          for (const sub of s.subjects) {
            if (sub.points.length < 2) continue;
            const d = sub.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x, si).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
            const path = el('path', { d, class: 'nij-subject-line', 'data-subject': sub.id }, subs);
            bindSubject(path, sub.id, o);
          }
        }
        if (scene.subjects === 'points' || scene.covariate || !(scene.paired || linear)) {
          const groups = new Map<string, { id: string; x: string | number; y: number }[]>();
          for (const sub of s.subjects) for (const p of sub.points) {
            const k = String(p.x);
            const arr = groups.get(k) ?? [];
            arr.push({ id: sub.id, ...p });
            groups.set(k, arr);
          }
          for (const pts of groups.values()) {
            const off = linear ? pts.map(() => 0) : swarm(pts.map((p) => Y(p.y)), 2.6);
            pts.forEach((p, i) => {
              const c = el('circle', { cx: X(p.x, si) + off[i] + (linear ? 0 : -dodgeShift(nS)), cy: Y(p.y), r: scene.covariate ? 3.5 : 2.6, class: 'nij-subject-dot', 'data-subject': p.id }, subs);
              bindSubject(c, p.id, o);
            });
          }
        }
      }
      // Summary.
      if (linear && s.cells.length) {
        const pts = s.cells;
        if (pts.every((c) => Number.isFinite(c.lo))) {
          const d = pts.map((c, i) => `${i ? 'L' : 'M'}${X(c.x)},${Y(c.hi)}`).join('') +
            pts.slice().reverse().map((c) => `L${X(c.x)},${Y(c.lo)}`).join('') + 'Z';
          el('path', { d, class: 'nij-ribbon' }, sg);
        }
        el('path', { d: pts.map((c, i) => `${i ? 'L' : 'M'}${X(c.x)},${Y(c.mean)}`).join(''), class: 'nij-mean-line' }, sg);
        if (endLabels && s.level != null) {
          const last = pts[pts.length - 1];
          text(sg, s.level, { x: px + pw + 6, y: Y(last.mean), class: 'nij-direct', 'dominant-baseline': 'middle' });
        }
      } else if (!linear) {
        if (s.cells.length > 1 && scene.paired) {
          el('path', { d: s.cells.map((c, i) => `${i ? 'L' : 'M'}${X(c.x, si)},${Y(c.mean)}`).join(''), class: 'nij-mean-line' }, sg);
        }
        for (const c of s.cells) {
          const x = X(c.x, si);
          if (Number.isFinite(c.lo)) el('line', { x1: x, x2: x, y1: Y(c.lo), y2: Y(c.hi), class: 'nij-err' }, sg);
          const dot = el('circle', { cx: x, cy: Y(c.mean), r: 4.5, class: 'nij-mean' }, sg);
          const t = el('title', {}, dot);
          t.textContent = `${fmtNum(c.mean)} [${fmtNum(c.lo)}, ${fmtNum(c.hi)}], n = ${c.n}`;
        }
      }
      if (s.fit) {
        const f = s.fit;
        el('line', { x1: X(xlo), x2: X(xhi), y1: Y(f.intercept + f.slope * xlo), y2: Y(f.intercept + f.slope * xhi), class: 'nij-fit' }, sg);
        text(sg, `r = ${f.r.toFixed(2)}, p = ${f.p < 0.001 ? '<.001' : f.p.toFixed(3).replace(/^0/, '')}`, {
          x: px + pw, y: m.top + 4 + si * 14, 'text-anchor': 'end', class: 'nij-note' });
      }
    });
  });

  if (scene.x.name) {
    text(svg, scene.x.name + (scene.x.unit ? ` (${scene.x.unit})` : ''), { x: m.left + (W - m.left - m.right) / 2, y: H - 4, 'text-anchor': 'middle', class: 'nij-label' });
  }
  if (o.highlight) svg.querySelectorAll(`[data-subject="${CSS.escape(o.highlight)}"]`).forEach((e) => e.classList.add('is-hot'));
  return svg;
}

const dodgeShift = (_n: number) => 0;

function bindSubject(e: Element, id: string, o: RenderOptions) {
  e.addEventListener('mouseenter', (ev) => {
    const root = e.closest('svg');
    root?.querySelectorAll(`[data-subject="${CSS.escape(id)}"]`).forEach((x) => x.classList.add('is-hot'));
    root?.classList.add('has-hot');
    o.onSubject?.(id, ev as MouseEvent);
  });
  e.addEventListener('mouseleave', () => {
    const root = e.closest('svg');
    root?.querySelectorAll('.is-hot').forEach((x) => x.classList.remove('is-hot'));
    root?.classList.remove('has-hot');
    o.onSubject?.(null);
  });
}
