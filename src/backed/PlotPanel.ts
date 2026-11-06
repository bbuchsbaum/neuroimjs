/**
 * A plot of the data behind a map at one probe, with the controls to slice
 * (keep levels) and collapse (average a factor away). Framework-free.
 */
import type { Backing, Extract } from './types';
import { type PlotSpec, buildScene, factors, covariates, inferSpec, axisName, type Scene } from './spec';
import { renderScene } from './render';

const STYLE_ID = 'nij-plot-style';
const CSS = `
.nij-plot{--nij-surface:#fcfcfb;--nij-ink:#0b0b0b;--nij-ink-2:#52514e;--nij-ink-3:#8a8984;--nij-rule:#e6e5e1;
--nij-series-1:#2a78d6;--nij-series-2:#eb6834;--nij-series-3:#1baf7a;--nij-series-4:#eda100;
font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--nij-ink);background:var(--nij-surface);}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .nij-plot{--nij-surface:#1a1a19;--nij-ink:#f0efec;--nij-ink-2:#c3c2b7;--nij-ink-3:#8f8e86;--nij-rule:#2e2e2c;
--nij-series-1:#3987e5;--nij-series-2:#d95926;--nij-series-3:#199e70;--nij-series-4:#c98500;}}
:root[data-theme="dark"] .nij-plot{--nij-surface:#1a1a19;--nij-ink:#f0efec;--nij-ink-2:#c3c2b7;--nij-ink-3:#8f8e86;--nij-rule:#2e2e2c;
--nij-series-1:#3987e5;--nij-series-2:#d95926;--nij-series-3:#199e70;--nij-series-4:#c98500;}
.nij-plot-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-bottom:4px}
.nij-plot-title{font-weight:600}
.nij-plot-meta{color:var(--nij-ink-2)}
.nij-plot-legend{display:flex;gap:10px;color:var(--nij-ink-2);margin-left:auto}
.nij-plot-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);margin-right:4px}
.nij-plot-svg{display:block;overflow:visible}
.nij-axis text{fill:var(--nij-ink-3);font-size:11px;font-variant-numeric:tabular-nums}
.nij-grid{stroke:var(--nij-rule);stroke-width:1}
.nij-zero{stroke:var(--nij-ink-3);stroke-width:1}
.nij-facet{fill:var(--nij-ink-2);font-weight:600}
.nij-label{fill:var(--nij-ink-2)}
.nij-direct,.nij-note{fill:var(--nij-ink-2);font-size:11px}
.nij-subject-dot{fill:var(--c);opacity:.35}
.nij-subject-line{fill:none;stroke:var(--c);stroke-width:1;opacity:.22}
.has-hot .nij-subject-dot,.has-hot .nij-subject-line{opacity:.1}
.nij-subject-dot.is-hot,.nij-subject-line.is-hot{opacity:1}
.nij-subject-line.is-hot{stroke-width:2}
.nij-mean{fill:var(--c);stroke:var(--nij-surface);stroke-width:2}
.nij-err{stroke:var(--c);stroke-width:2;stroke-linecap:round}
.nij-mean-line{fill:none;stroke:var(--c);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.nij-ribbon{fill:var(--c);opacity:.12}
.nij-fit{stroke:var(--c);stroke-width:2}
.nij-plot-controls{display:grid;grid-template-columns:auto auto 1fr;gap:4px 10px;align-items:center;margin-top:6px;color:var(--nij-ink-2)}
.nij-seg{display:inline-flex;border:1px solid var(--nij-rule);border-radius:6px;overflow:hidden}
.nij-seg button,.nij-chip{font:inherit;border:0;background:none;color:var(--nij-ink-2);padding:1px 7px;cursor:pointer}
.nij-seg button[aria-pressed=true]{background:var(--nij-rule);color:var(--nij-ink)}
.nij-chips{display:flex;flex-wrap:wrap;gap:4px}
.nij-chip{border:1px solid var(--nij-rule);border-radius:10px}
.nij-chip[aria-pressed=false]{color:var(--nij-ink-3);text-decoration:line-through}
.nij-plot-foot{color:var(--nij-ink-3);margin-top:4px}
.nij-plot-warn{color:var(--nij-ink);background:color-mix(in srgb,var(--nij-series-4) 18%,transparent);border-radius:4px;padding:1px 6px}
`;

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export interface PlotPanelOptions {
  width?: number;
  height?: number;
  spec?: PlotSpec;
  /** Show the slice/collapse controls. Default true. */
  controls?: boolean;
  /** The probe was chosen by looking at a map made from these same data. */
  circular?: boolean;
  onSubject?: (id: string | null) => void;
  onSpec?: (spec: PlotSpec) => void;
}

type Role = 'x' | 'color' | 'facet' | 'avg';

export class PlotPanel {
  readonly element: HTMLDivElement;
  private spec: PlotSpec;
  private ext: Extract | null = null;
  private highlight: string | null = null;

  constructor(private backing: Backing, private o: PlotPanelOptions = {}) {
    ensureStyle();
    this.element = document.createElement('div');
    this.element.className = 'nij-plot';
    this.spec = o.spec ?? inferSpec(backing);
  }

  getSpec(): PlotSpec { return this.spec; }

  setSpec(spec: PlotSpec): void {
    this.spec = spec;
    this.o.onSpec?.(spec);
    this.draw();
  }

  /** Show values at a probe (an extract from the backing). */
  show(ext: Extract, opts: { circular?: boolean } = {}): void {
    this.ext = ext;
    if (opts.circular !== undefined) this.o.circular = opts.circular;
    this.draw();
  }

  /** Emphasise one subject's marks (e.g. from the viewer). */
  setHighlight(id: string | null): void {
    this.highlight = id;
    this.draw();
  }

  scene(): Scene | null {
    return this.ext ? buildScene(this.backing, this.ext, this.spec) : null;
  }

  private draw(): void {
    const root = this.element;
    root.replaceChildren();
    const scene = this.scene();
    if (!scene) return;
    const width = this.o.width ?? (root.clientWidth || 460);

    const head = div(root, 'nij-plot-head');
    span(head, 'nij-plot-title', scene.probe);
    span(head, 'nij-plot-meta', `${scene.voxels} voxel${scene.voxels === 1 ? '' : 's'} · ${scene.nSubjects} subjects`);
    if (scene.color.levels.length > 1) {
      const lg = div(head, 'nij-plot-legend');
      scene.color.levels.forEach((l, i) => {
        const it = span(lg, '', '');
        const sw = document.createElement('i');
        sw.style.setProperty('--c', `var(--nij-series-${(i % 4) + 1})`);
        it.append(sw, l);
      });
    }
    if (scene.voxels === 0) {
      div(root, 'nij-plot-foot', 'No backing data at this point.');
      return;
    }
    root.appendChild(renderScene(scene, {
      width, height: this.o.height, highlight: this.highlight,
      onSubject: (id) => this.o.onSubject?.(id),
    }));

    const foot: string[] = [];
    if (scene.error !== 'none') foot.push(`Mean ± 95% CI${scene.error === 'within' ? ', within-subject (Cousineau–Morey)' : ' across subjects'}.`);
    if (scene.collapsed.length) foot.push(`Averaged over ${scene.collapsed.join(', ')}.`);
    const f = div(root, 'nij-plot-foot', foot.join(' '));
    if (this.o.circular) {
      const w = span(f, 'nij-plot-warn', 'Circular: this region was picked on a map of these data, so effects here are inflated.');
      f.prepend(w, ' ');
    }
    if (this.o.controls !== false) this.controls(root, scene);
  }

  private controls(root: HTMLElement, scene: Scene): void {
    const box = div(root, 'nij-plot-controls');
    const ax = axisName(this.backing);
    const roleOf = (n: string): Role => (this.spec.x === n ? 'x' : this.spec.color === n ? 'color' : this.spec.facet === n ? 'facet' : 'avg');
    const assign = (n: string, r: Role) => {
      const s: PlotSpec = { ...this.spec };
      for (const k of ['x', 'color', 'facet'] as const) if (s[k] === n) s[k] = undefined;
      if (r !== 'avg') s[r] = n;
      this.setSpec(s);
    };
    const names = [...(ax ? [ax] : []), ...factors(this.backing).map((f) => f.name), ...covariates(this.backing).map((c) => c.name)];
    for (const n of names) {
      span(box, '', n);
      const isFactor = factors(this.backing).some((f) => f.name === n);
      const roles: Role[] = isFactor ? ['x', 'color', 'facet', 'avg'] : ['x', 'avg'];
      const seg = div(box, 'nij-seg');
      for (const r of roles) {
        const b = button(seg, r === 'avg' ? 'average' : r, roleOf(n) === r);
        b.onclick = () => assign(n, r);
      }
      const chips = div(box, 'nij-chips');
      if (isFactor) {
        const levels = this.backing.columns.find((c) => c.name === n)?.levels ?? [];
        const keep = this.spec.keep?.[n];
        for (const l of levels) {
          const on = !keep || keep.includes(l);
          const c = button(chips, l, on, 'nij-chip');
          c.onclick = () => {
            const cur = keep ?? levels;
            const next = on ? cur.filter((x) => x !== l) : [...cur, l];
            const k = { ...(this.spec.keep ?? {}) };
            if (next.length === levels.length) delete k[n]; else if (next.length) k[n] = next;
            this.setSpec({ ...this.spec, keep: k });
          };
        }
      }
    }
    span(box, '', 'subjects');
    const seg = div(box, 'nij-seg');
    for (const s of ['points', 'lines', 'hidden'] as const) {
      const b = button(seg, s, (this.spec.subjects ?? 'points') === s);
      b.onclick = () => this.setSpec({ ...this.spec, subjects: s });
    }
    div(box, '');
    void scene;
  }
}

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
