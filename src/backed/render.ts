/**
 * A scene drawn as SVG: small multiples on one y scale, range-frame axes,
 * subject marks quiet behind the summaries, direct labels where lines end.
 * Returns the hit points so the host can do nearest-point hover.
 */
import type { Scene, Series } from './spec';
import { mean, sd, tPValue } from './stats';

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
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const s = a === 0 ? '0' : a >= 100 ? a.toFixed(0) : a >= 10 ? +a.toFixed(1) + '' : +a.toPrecision(2) + '';
  return (v < 0 ? '−' : '') + s;
};
const fmtP = (p: number) => (p < 0.001 ? '< .001' : '= ' + p.toFixed(3).replace(/^0/, ''));

/** Horizontal offsets so dots sharing a band don't overlap: a 1D beeswarm. */
export function swarm(ys: number[], r: number): number[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const placed: { x: number; y: number }[] = [];
  const out = new Array<number>(ys.length).fill(0);
  const d2 = (2 * r) ** 2;
  for (const [y, i] of order) {
    let x = 0;
    for (let k = 0; k < 200; k++) {
      const cand = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * r * 0.9;
      if (placed.every((p) => p.y < y - 2 * r || (p.x - cand) ** 2 + (p.y - y) ** 2 >= d2)) { x = cand; break; }
    }
    placed.push({ x, y });
    out[i] = x;
  }
  return out;
}

/** Spread labels at least `gap` apart, keeping order; returns new positions. */
export function relax(ys: number[], gap: number): number[] {
  const idx = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const pos = idx.map(([y]) => y);
  for (let it = 0; it < 50; it++) {
    let moved = false;
    for (let k = 1; k < pos.length; k++) {
      const over = gap - (pos[k] - pos[k - 1]);
      if (over > 0) { pos[k - 1] -= over / 2; pos[k] += over / 2; moved = true; }
    }
    if (!moved) break;
  }
  const out = new Array<number>(ys.length);
  idx.forEach(([, i], k) => (out[i] = pos[k]));
  return out;
}

export interface HitPoint {
  x: number;
  y: number;
  subject?: string;
  /** For summaries on a linear x: the panel and x value, so hover can snap to x. */
  panel?: number;
  xv?: number;
  /** Tooltip lines. */
  lines: string[];
  color: string;
}

export interface RenderOptions {
  width: number;
  height?: number;
  /** CSS color for a color level (null: the single series). */
  color: (level: string | null) => string;
}

export interface Rendered { svg: SVGSVGElement; hits: HitPoint[] }

export function renderScene(scene: Scene, o: RenderOptions): Rendered {
  const H = o.height ?? 230;
  const linear = scene.x.kind === 'linear';
  const strip = !scene.x.name; // one value per subject: a strip and a sentence
  const W = strip ? Math.min(o.width, 360) : o.width;
  const nS = scene.panels[0]?.series.length ?? 1;
  const endLabels = nS > 1 && (linear ? !scene.covariate : scene.paired);
  const m = { top: scene.facet.name ? 44 : 26, right: endLabels ? 70 : 14, bottom: !linear && scene.x.name ? 40 : 30, left: 38 };
  const nP = scene.panels.length;
  const gap = 20;
  const plotW = strip ? 96 : W - m.left - m.right;
  const pw = (plotW - gap * (nP - 1)) / nP;
  const ph = H - m.top - m.bottom;
  const hits: HitPoint[] = [];
  const colorOf = (s: Series) => o.color(s.level);

  // Domains from what is drawn.
  const ys: number[] = [0];
  const xs: number[] = [];
  const showSubjects = scene.covariate || scene.subjects !== 'hidden';
  for (const p of scene.panels) for (const s of p.series) {
    for (const c of s.cells) { ys.push(c.mean); if (Number.isFinite(c.lo)) ys.push(c.lo, c.hi); if (linear) xs.push(c.x as number); }
    if (showSubjects) for (const sub of s.subjects) for (const pt of sub.points) { ys.push(pt.y); if (linear) xs.push(pt.x as number); }
    if (s.fit) for (const x of xs) ys.push(s.fit.intercept + s.fit.slope * x + s.fit.band(x), s.fit.intercept + s.fit.slope * x - s.fit.band(x));
  }
  const dlo = Math.min(...ys), dhi = Math.max(...ys);
  const pad = (dhi - dlo) * 0.04 || 1;
  const y0 = dlo - pad, y1 = dhi + pad;
  const yt = niceTicks(dlo, dhi, Math.max(3, Math.round(ph / 40))).filter((t) => t >= y0 && t <= y1);
  const Y = (v: number) => m.top + ph - ((v - y0) / (y1 - y0)) * ph;
  const xlo = linear ? Math.min(...xs) : 0, xhi = linear ? Math.max(...xs) : 1;
  const xpad = scene.covariate ? (xhi - xlo) * 0.03 : 0;
  const xt = linear ? niceTicks(xlo, xhi, 5).filter((t) => t >= xlo - 1e-9 && t <= xhi + 1e-9) : [];

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'nij-plot-svg', role: 'img' });
  svg.setAttribute('aria-label', `${scene.y.label} at ${scene.probe}`);

  // Y: a range frame over the data, the quantity named at its top.
  const axis = el('g', { class: 'nij-axis' }, svg);
  el('line', { x1: m.left - 8, x2: m.left - 8, y1: Y(dlo), y2: Y(dhi), class: 'nij-frame' }, axis);
  for (const t of yt) {
    el('line', { x1: m.left - 11, x2: m.left - 8, y1: Y(t), y2: Y(t), class: 'nij-frame' }, axis);
    text(axis, fmtNum(t), { x: m.left - 14, y: Y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' });
  }
  text(svg, scene.y.label, { x: m.left - 8, y: 10, class: 'nij-label' });

  scene.panels.forEach((panel, pi) => {
    const px = m.left + pi * (pw + gap);
    const g = el('g', { class: 'nij-panel' }, svg);
    if (panel.facet != null) text(g, panel.facet, { x: px + pw / 2, y: 30, class: 'nij-facet', 'text-anchor': 'middle' });
    const band = scene.x.levels.length || 1;
    const bw = pw / band;
    const dodge = (si: number) => (nS > 1 && !linear ? (si - (nS - 1) / 2) * Math.min(14, bw / (nS + 2)) : 0);
    const X = (x: string | number, si = 0) =>
      linear ? px + ((Number(x) - xlo + xpad) / (xhi - xlo + 2 * xpad || 1)) * pw
        : px + (Math.max(0, scene.x.levels.indexOf(String(x))) + 0.5) * bw + dodge(si);

    if (pw > 300) for (const t of yt) if (t !== 0) el('line', { x1: px, x2: px + pw, y1: Y(t), y2: Y(t), class: 'nij-grid' }, g);
    if (dlo < 0 && dhi > 0 || dlo === 0 || dhi === 0) el('line', { x1: px, x2: px + pw, y1: Y(0), y2: Y(0), class: 'nij-zero' }, g);

    // X: range frame on linear axes, level names on bands; the name and unit at the end.
    const xa = el('g', { class: 'nij-axis' }, g);
    const by = m.top + ph + 6;
    if (linear) {
      el('line', { x1: X(xlo), x2: X(xhi), y1: by, y2: by, class: 'nij-frame' }, xa);
      const lab = pi === nP - 1 && scene.x.name ? (scene.x.unit ? `${scene.x.name}, ${scene.x.unit}` : scene.x.name) : '';
      const room = px + pw - lab.length * 6.2 - 14; // ticks stop short of the axis name
      xt.forEach((t) => {
        el('line', { x1: X(t), x2: X(t), y1: by, y2: by + 3, class: 'nij-frame' }, xa);
        if (!lab || X(t) < room) text(xa, fmtNum(t), { x: X(t), y: by + 14, 'text-anchor': 'middle' });
      });
      if (lab) text(xa, lab, { x: px + pw, y: by + 14, 'text-anchor': 'end', class: 'nij-label' });
    } else {
      scene.x.levels.forEach((l) => text(xa, l, { x: X(l), y: by + 12, 'text-anchor': 'middle' }));
      if (scene.x.name && pi === Math.floor((nP - 1) / 2)) text(xa, scene.x.name, { x: nP % 2 ? px + pw / 2 : px + pw + gap / 2, y: by + 25, 'text-anchor': 'middle', class: 'nij-label' });
    }

    const ends: { y: number; label: string; x: number; color: string }[] = [];
    panel.series.forEach((s, si) => {
      const col = colorOf(s);
      const sg = el('g', { class: 'nij-series', style: `--c:${col}` }, g);
      const tag = s.level != null ? `${s.level} · ` : '';
      if (showSubjects) {
        const subs = el('g', { class: 'nij-subjects' }, sg);
        const lines = scene.subjects === 'lines' && (scene.paired || linear) && !scene.covariate;
        if (lines) for (const sub of s.subjects) {
          if (sub.points.length < 2) continue;
          const d = sub.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x, si).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
          el('path', { d, class: 'nij-subject-line', 'data-subject': sub.id }, subs);
          for (const p of sub.points) hits.push({ x: X(p.x, si), y: Y(p.y), subject: sub.id, color: col, lines: [sub.id, `${tag}${p.x}: ${fmtNum(p.y)}`] });
        }
        else {
          const groups = new Map<string, { id: string; x: string | number; y: number }[]>();
          for (const sub of s.subjects) for (const p of sub.points) {
            const arr = groups.get(String(p.x)) ?? [];
            arr.push({ id: sub.id, ...p });
            groups.set(String(p.x), arr);
          }
          const r = scene.covariate ? 3.2 : 2.4;
          for (const pts of groups.values()) {
            const off = linear ? pts.map(() => 0) : swarm(pts.map((p) => Y(p.y)), r);
            pts.forEach((p, i) => {
              const cx = X(p.x, si) + off[i] + (linear ? 0 : nS > 1 ? 0 : -14);
              el('circle', { cx, cy: Y(p.y), r, class: 'nij-subject-dot', 'data-subject': p.id, 'data-key': `s|${p.id}|${p.x}` }, subs);
              hits.push({ x: cx, y: Y(p.y), subject: p.id, color: col,
                lines: [p.id, scene.covariate ? `${tag}${scene.x.name} ${fmtNum(p.x as number)}: ${fmtNum(p.y)}` : `${tag}${p.x === '' ? '' : p.x + ': '}${fmtNum(p.y)}`] });
            });
          }
        }
      }
      const ci = (c: { mean: number; lo: number; hi: number; n: number }) =>
        `${fmtNum(c.mean)}${Number.isFinite(c.lo) ? ` [${fmtNum(c.lo)}, ${fmtNum(c.hi)}]` : ''}, n = ${c.n}`;
      if (linear && s.cells.length) {
        const pts = s.cells;
        if (pts.every((c) => Number.isFinite(c.lo))) {
          const d = pts.map((c, i) => `${i ? 'L' : 'M'}${X(c.x)},${Y(c.hi)}`).join('') +
            pts.slice().reverse().map((c) => `L${X(c.x)},${Y(c.lo)}`).join('') + 'Z';
          el('path', { d, class: 'nij-ribbon' }, sg);
        }
        el('path', { d: pts.map((c, i) => `${i ? 'L' : 'M'}${X(c.x)},${Y(c.mean)}`).join(''), class: 'nij-mean-line' }, sg);
        const sparse = pts.length <= 24; // measured bins (FIR) get dots; a smooth curve doesn't
        for (const c of pts) {
          if (sparse) el('circle', { cx: X(c.x), cy: Y(c.mean), r: 2.6, class: 'nij-mean', 'data-key': `m|${s.level}|${c.x}` }, sg);
          hits.push({ x: X(c.x), y: Y(c.mean), color: col, panel: pi, xv: c.x as number,
            lines: [`${scene.x.name} ${fmtNum(c.x as number)}${scene.x.unit ? ' ' + scene.x.unit : ''}`, `${s.level != null ? s.level + ': ' : ''}${ci(c)}`] });
        }
        const last = pts[pts.length - 1];
        if (endLabels && s.level != null) ends.push({ y: Y(last.mean), label: s.level, x: X(last.x), color: col });
      } else if (!linear) {
        if (s.cells.length > 1 && scene.paired) {
          el('path', { d: s.cells.map((c, i) => `${i ? 'L' : 'M'}${X(c.x, si)},${Y(c.mean)}`).join(''), class: 'nij-mean-line' }, sg);
          const last = s.cells[s.cells.length - 1];
          if (endLabels && s.level != null) ends.push({ y: Y(last.mean), label: s.level, x: X(last.x, si), color: col });
        }
        for (const c of s.cells) {
          const x = X(c.x, si) + (strip ? 14 : 0);
          if (Number.isFinite(c.lo)) el('line', { x1: x, x2: x, y1: Y(c.lo), y2: Y(c.hi), class: 'nij-err' }, sg);
          el('circle', { cx: x, cy: Y(c.mean), r: 3.5, class: 'nij-mean', 'data-key': `m|${s.level}|${c.x}` }, sg);
          hits.push({ x, y: Y(c.mean), color: col, lines: [`${tag}${c.x === '' ? 'mean' : c.x}`, ci(c)] });
        }
      }
      if (s.fit) {
        const f = s.fit;
        const n = 24;
        const at = Array.from({ length: n + 1 }, (_, i) => xlo + ((xhi - xlo) * i) / n);
        const d = at.map((x, i) => `${i ? 'L' : 'M'}${X(x)},${Y(f.intercept + f.slope * x + f.band(x))}`).join('') +
          at.slice().reverse().map((x) => `L${X(x)},${Y(f.intercept + f.slope * x - f.band(x))}`).join('') + 'Z';
        el('path', { d, class: 'nij-ribbon' }, sg);
        el('line', { x1: X(xlo), x2: X(xhi), y1: Y(f.intercept + f.slope * xlo), y2: Y(f.intercept + f.slope * xhi), class: 'nij-fit' }, sg);
        if (s.robust) {
          const flagged = new Set(s.robust.subjects);
          sg.querySelectorAll<SVGCircleElement>('.nij-subject-dot').forEach((d) => {
            if (flagged.has(d.dataset.subject as string)) el('circle', { cx: d.getAttribute('cx') ?? 0, cy: d.getAttribute('cy') ?? 0, r: 6, class: 'nij-flag' }, sg);
          });
        }
      }
    });

    // Direct labels at line ends, spread apart, with a leader when moved.
    const placed = relax(ends.map((e) => e.y), 13);
    ends.forEach((e, i) => {
      const lx = Math.max(...ends.map((q) => q.x)) + 10;
      const lead = el('path', { d: `M${e.x + 5},${e.y}L${lx - 3},${placed[i]}`, class: 'nij-leader' }, g);
      lead.style.setProperty('--c', e.color);
      text(g, e.label, { x: lx, y: placed[i], class: 'nij-direct', 'dominant-baseline': 'middle' });
    });

    // One value per subject: say the estimate in words beside the strip.
    if (strip) {
      const c = panel.series[0]?.cells[0];
      const vals = panel.series[0]?.subjects.flatMap((s) => s.points.map((p) => p.y)) ?? [];
      if (c && vals.length > 1) {
        const dz = mean(vals) / sd(vals);
        const t = mean(vals) / (sd(vals) / Math.sqrt(vals.length));
        const tx = px + pw + 20;
        text(g, `${fmtNum(c.mean)} [${fmtNum(c.lo)}, ${fmtNum(c.hi)}]`, { x: tx, y: Y(c.mean), class: 'nij-estimate', 'dominant-baseline': 'middle' });
        text(g, `mean, 95% CI · n = ${c.n}`, { x: tx, y: Y(c.mean) + 16, class: 'nij-note', 'dominant-baseline': 'middle' });
        text(g, scene.circular ? 'no test: region chosen on these data'
          : `t(${vals.length - 1}) = ${t.toFixed(1)}, p ${fmtP(tPValue(t, vals.length - 1))}, dz = ${dz.toFixed(2)}`,
          { x: tx, y: Y(c.mean) + 30, class: 'nij-note', 'dominant-baseline': 'middle' });
      }
    }
  });

  return { svg, hits };
}
