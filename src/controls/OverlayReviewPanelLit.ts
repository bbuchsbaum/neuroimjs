import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { NeuroVec } from '../vec/NeuroVec';
import { NeuroVol } from '../volume/NeuroVol';
import { Range, Threshold, ValueError } from '../types';
import { OverlayReviewSession } from '../review/OverlayReviewDataset';
import {
  consistencyVolume,
  effectVolume,
  meanVolume,
  oneSampleTVolume,
  OverlaySummaryService,
  SufficientStats,
} from '../review/OverlaySummaryService';
import {
  OverlayReviewLayerOrder,
  SubjectOverlayViewer,
  SubjectOverlayViewerState,
  SummaryLayerOptions,
} from '../review/SubjectOverlayViewer';

/** Primary "what am I looking at" axis. */
export type OverlayReviewView = 'subject' | 'group';
/** Derived viewing mode kept for backwards compatibility. */
export type OverlayReviewMode = 'browse' | 'summary' | 'holdout';
export type OverlayReviewReducerKind = 'signed' | 'consistency';
export type OverlayReviewBuiltInReducerId = 'mean' | 'tstat' | 'effect' | 'consistency';

export interface OverlayReviewReducerContext {
  service: OverlaySummaryService;
  vec: NeuroVec;
  subjectIndices: number[];
  stats: SufficientStats;
  cutoff: number;
  displayRange: Range;
}

export interface OverlayReviewReducer {
  id: string;
  label: string;
  kind: OverlayReviewReducerKind;
  defaultRange: Range | ((context: OverlayReviewReducerContext) => Range);
  defaultThreshold?: Threshold | ((context: OverlayReviewReducerContext) => Threshold);
  compute(context: OverlayReviewReducerContext): NeuroVol;
}

export interface OverlayReviewPanelViewer {
  getSession(): OverlayReviewSession;
  getState(): SubjectOverlayViewerState;
  setSubjectIndex(index: number): void;
  setContrast(id: string, subjectIndex?: number): void;
  setSymmetricThreshold(cutoff: number): void;
  setSummaryThreshold(threshold: Threshold): void;
  setSummaryVolume(volume: NeuroVol, options?: SummaryLayerOptions): void;
  clearSummaryVolume(): void;
  setOverlayOrder(order: OverlayReviewLayerOrder): void;
  /** Optional: subscribe to crosshair coordinate changes (world mm). Returns an unsubscribe fn. */
  onCoordChange?(handler: (coord: number[]) => void): () => void;
}

/** Active summary held by the panel, used for cursor sampling and the legend. */
interface ActiveSummary {
  volume: NeuroVol;
  stats: SufficientStats;
  isConsistency: boolean;
  range: Range;
  reducerKind: OverlayReviewReducerKind;
  label: string;
}

export interface OverlayReviewReadout {
  voxel: [number, number, number];
  subject: number;
  summary: number | null;
  consistentCount: number | null;
  validCount: number | null;
}

export interface OverlayLegendSpec {
  kind: OverlayReviewReducerKind;
  range: Range;
  label: string;
}

function cloneRange(range: Range): Range {
  return [range[0], range[1]];
}

function allSubjectIndices(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

function symmetricThreshold(cutoff: number): Threshold {
  return [-cutoff, cutoff];
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function resolveRange(
  range: OverlayReviewReducer['defaultRange'],
  context: OverlayReviewReducerContext
): Range {
  const resolved = typeof range === 'function' ? range(context) : range;
  return cloneRange(resolved);
}

function resolveThreshold(
  reducer: OverlayReviewReducer,
  context: OverlayReviewReducerContext
): Threshold {
  if (reducer.defaultThreshold) {
    const resolved = typeof reducer.defaultThreshold === 'function'
      ? reducer.defaultThreshold(context)
      : reducer.defaultThreshold;
    return [resolved[0], resolved[1]];
  }

  return reducer.kind === 'consistency' ? [0, 0] : symmetricThreshold(context.cutoff);
}

/** Human-readable description of what the cutoff currently does. */
export function overlayCutoffHint(
  view: OverlayReviewView,
  reducerKind: OverlayReviewReducerKind,
  cutoff: number
): string {
  const c = formatNumber(cutoff);
  if (view === 'subject') return `Hide subject |value| < ${c}`;
  if (reducerKind === 'consistency') return `Count subjects with |value| ≥ ${c}`;
  return `Hide summary |value| < ${c}`;
}

/** Sample subject (and optional summary) values at a world coordinate. Returns null when outside the volume. */
export function sampleOverlayReadout(
  world: number[],
  subjectVolume: NeuroVol,
  summary: { volume: NeuroVol; stats: SufficientStats; isConsistency: boolean } | null
): OverlayReviewReadout | null {
  const grid = subjectVolume.space.coordToGrid(world);
  const i = Math.round(grid[0]);
  const j = Math.round(grid[1]);
  const k = Math.round(grid[2]);
  const [dx, dy, dz] = subjectVolume.dim;
  if (i < 0 || i >= dx || j < 0 || j >= dy || k < 0 || k >= dz) {
    return null;
  }

  const subject = subjectVolume.getAt(i, j, k);
  let summaryValue: number | null = null;
  let consistentCount: number | null = null;
  let validCount: number | null = null;

  if (summary) {
    summaryValue = summary.volume.getAt(i, j, k);
    if (summary.isConsistency) {
      const idx = i + j * dx + k * dx * dy;
      validCount = summary.stats.count[idx];
      consistentCount = Number.isFinite(summaryValue)
        ? Math.round(summaryValue * validCount)
        : null;
    }
  }

  return { voxel: [i, j, k], subject, summary: summaryValue, consistentCount, validCount };
}

export const DEFAULT_OVERLAY_REVIEW_REDUCERS: OverlayReviewReducer[] = [
  {
    id: 'mean',
    label: 'Mean',
    kind: 'signed',
    defaultRange: (context) => context.displayRange,
    compute: (context) => meanVolume(context.stats),
  },
  {
    id: 'tstat',
    label: 'T-stat',
    kind: 'signed',
    defaultRange: [-6, 6],
    compute: (context) => oneSampleTVolume(context.stats),
  },
  {
    id: 'effect',
    label: 'Effect',
    kind: 'signed',
    defaultRange: [-2, 2],
    compute: (context) => effectVolume(context.stats),
  },
  {
    id: 'consistency',
    label: 'Consistency',
    kind: 'consistency',
    defaultRange: [0, 1],
    defaultThreshold: [0, 0],
    compute: (context) => consistencyVolume(
      context.vec,
      { cutoff: context.cutoff, output: 'proportion' },
      context.subjectIndices,
      context.stats
    ),
  },
];

const DIVERGING_GRADIENT = 'linear-gradient(90deg, #2166ac 0%, #f7f7f7 50%, #b2182b 100%)';
const CONSISTENCY_GRADIENT =
  'linear-gradient(90deg, #440154 0%, #414487 25%, #2a788e 50%, #22a884 75%, #fde725 100%)';

@customElement('overlay-review-panel')
export class OverlayReviewPanel extends LitElement {
  @property({ attribute: false }) viewer?: OverlayReviewPanelViewer | SubjectOverlayViewer;
  @property({ attribute: false }) reducers: OverlayReviewReducer[] = DEFAULT_OVERLAY_REVIEW_REDUCERS;
  @property({ type: Number }) summaryDebounceMs = 100;
  @property({ type: Number }) cineFps = 3;
  @property({ type: Number }) cutoffMax = 10;

  @state() private view: OverlayReviewView = 'subject';
  @state() private holdout = false;
  @state() private reducerId = 'mean';
  @state() private subjectIndex = 0;
  @state() private contrastId = '';
  @state() private cutoff = 3;
  @state() private cinePlaying = false;
  @state() private readout: OverlayReviewReadout | null = null;

  private readonly services = new Map<string, OverlaySummaryService>();
  private debounceHandle?: ReturnType<typeof setTimeout>;
  private cineHandle?: ReturnType<typeof setInterval>;
  private attachedViewer?: OverlayReviewPanelViewer;
  private coordUnsubscribe?: () => void;
  private lastWorldCoord?: number[];
  private activeSummary: ActiveSummary | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      min-width: 260px;
      max-width: 360px;
      padding: 14px;
      box-sizing: border-box;
      color: #202124;
      background: #f7f8fa;
      border: 1px solid #d8dde5;
      border-radius: 6px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
    }

    .section {
      padding-bottom: 10px;
      margin-bottom: 10px;
      border-bottom: 1px solid #e2e6ec;
    }

    .section:last-child {
      padding-bottom: 0;
      margin-bottom: 0;
      border-bottom: none;
    }

    .label {
      display: block;
      margin-bottom: 6px;
      font-weight: 600;
      color: #3b424c;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .row:last-child {
      margin-bottom: 0;
    }

    .row > * {
      min-width: 0;
    }

    select,
    input[type="number"] {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      color: #202124;
      background: #ffffff;
      border: 1px solid #c7ced8;
      border-radius: 4px;
      font: inherit;
    }

    input[type="range"] {
      width: 100%;
      margin: 0;
      accent-color: #12615b;
    }

    button {
      min-height: 30px;
      padding: 5px 9px;
      color: #202124;
      background: #ffffff;
      border: 1px solid #c7ced8;
      border-radius: 4px;
      font: inherit;
      cursor: pointer;
    }

    button[aria-pressed="true"],
    button.active {
      color: #ffffff;
      background: #12615b;
      border-color: #12615b;
    }

    button:disabled {
      cursor: not-allowed;
      color: #8b949e;
      background: #eef1f5;
    }

    .segmented {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px;
    }

    .transport {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }

    .icon-btn {
      flex: 0 0 auto;
      width: 34px;
      padding: 5px 0;
      text-align: center;
    }

    .subject-meta {
      display: flex;
      align-items: baseline;
      gap: 8px;
      color: #3b424c;
      font-variant-numeric: tabular-nums;
    }

    .subject-meta .name {
      font-weight: 600;
      color: #202124;
    }

    .subject-meta .group {
      color: #6b7480;
    }

    .hint {
      margin-top: 4px;
      color: #6b7480;
      font-size: 12px;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #3b424c;
    }

    input[type="number"].compact {
      flex: 0 0 auto;
      width: 72px;
    }

    .readout {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 2px 10px;
      font-variant-numeric: tabular-nums;
    }

    .readout dt {
      color: #6b7480;
    }

    .readout dd {
      margin: 0;
      color: #202124;
      text-align: right;
    }

    .legend-bar {
      width: 100%;
      height: 12px;
      border: 1px solid #c4ccd4;
      border-radius: 2px;
    }

    .legend-ticks {
      display: flex;
      justify-content: space-between;
      margin-top: 3px;
      color: #6b7480;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    .muted {
      color: #8b949e;
    }
  `;

  updated(changed: Map<string, unknown>): void {
    if (changed.has('viewer')) {
      this.attachViewer(this.viewer);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.detachViewer();
  }

  setReviewViewer(viewer: OverlayReviewPanelViewer | SubjectOverlayViewer): void {
    this.viewer = viewer;
    this.attachViewer(viewer);
  }

  getPanelState(): {
    view: OverlayReviewView;
    holdout: boolean;
    mode: OverlayReviewMode;
    reducerId: string;
    subjectIndex: number;
    contrastId: string;
    cutoff: number;
    cinePlaying: boolean;
  } {
    return {
      view: this.view,
      holdout: this.holdout,
      mode: this.effectiveMode(),
      reducerId: this.reducerId,
      subjectIndex: this.subjectIndex,
      contrastId: this.contrastId,
      cutoff: this.cutoff,
      cinePlaying: this.cinePlaying,
    };
  }

  getReadout(): OverlayReviewReadout | null {
    return this.readout;
  }

  /** Derived three-way mode used by the internal summary logic. */
  effectiveMode(): OverlayReviewMode {
    if (this.view === 'subject') return 'browse';
    return this.holdout ? 'holdout' : 'summary';
  }

  setView(view: OverlayReviewView): void {
    if (view === this.view) return;
    this.view = view;
    if (view === 'subject') this.holdout = false;
    this.afterModeChange();
  }

  setHoldout(holdout: boolean): void {
    const next = !!holdout;
    if (next === this.holdout && (!next || this.view === 'group')) return;
    this.holdout = next;
    if (next) this.view = 'group';
    this.afterModeChange();
  }

  /** Backwards-compatible mode setter (browse | summary | holdout). */
  setMode(mode: OverlayReviewMode): void {
    const view: OverlayReviewView = mode === 'browse' ? 'subject' : 'group';
    const holdout = mode === 'holdout';
    if (view === this.view && holdout === this.holdout) return;
    this.view = view;
    this.holdout = holdout;
    this.afterModeChange();
  }

  setReducer(reducerId: string): void {
    this.getReducer(reducerId);
    if (this.reducerId === reducerId) return;
    this.reducerId = reducerId;
    if (this.isCineBlocked()) this.stopCine();
    this.applyModePolicy();
  }

  setSubjectIndex(index: number): void {
    const viewer = this.requireViewer();
    const session = viewer.getSession();
    const nextIndex = Math.max(0, Math.min(index, session.subjectCount - 1));

    viewer.setSubjectIndex(nextIndex);
    this.subjectIndex = nextIndex;

    if (this.effectiveMode() === 'holdout') {
      // Reducer-aware: cheap stats-based reducers refresh immediately; the
      // O(V*N) consistency recompute is debounced to keep scrubbing smooth.
      if (this.getCurrentReducer().kind === 'consistency') {
        this.scheduleSummaryRefresh();
      } else {
        this.refreshSummary();
      }
    } else {
      this.refreshReadout();
    }

    this.requestUpdate();
  }

  setContrastId(id: string): void {
    const viewer = this.requireViewer();
    viewer.setContrast(id, this.subjectIndex);
    this.contrastId = id;

    if (this.effectiveMode() === 'browse') {
      viewer.clearSummaryVolume();
      this.activeSummary = null;
      this.refreshReadout();
    } else {
      this.refreshSummary();
    }

    this.requestUpdate();
  }

  setCutoff(cutoff: number): void {
    if (!Number.isFinite(cutoff)) {
      throw new ValueError('Overlay review cutoff must be a finite number');
    }

    const clamped = Math.max(0, Math.min(cutoff, this.cutoffMax));
    this.cutoff = clamped;
    this.requireViewer().setSymmetricThreshold(clamped);

    if (this.effectiveMode() !== 'browse') {
      const reducer = this.getCurrentReducer();
      if (reducer.kind === 'consistency') {
        this.scheduleSummaryRefresh();
      } else {
        this.requireViewer().setSummaryThreshold(symmetricThreshold(clamped));
      }
    }

    this.requestUpdate();
  }

  refreshSummary(): void {
    this.clearDebounce();
    if (this.effectiveMode() === 'browse') {
      this.requireViewer().clearSummaryVolume();
      this.activeSummary = null;
      this.refreshReadout();
      return;
    }

    const context = this.createReducerContext();
    if (context.subjectIndices.length === 0) {
      this.requireViewer().clearSummaryVolume();
      this.activeSummary = null;
      this.refreshReadout();
      return;
    }

    const reducer = this.getCurrentReducer();
    const volume = reducer.compute(context);
    const range = resolveRange(reducer.defaultRange, context);
    const threshold = resolveThreshold(reducer, context);

    this.requireViewer().setSummaryVolume(volume, { range, threshold });
    this.requireViewer().setOverlayOrder(
      this.effectiveMode() === 'holdout' ? 'subject-over-summary' : 'summary-over-subject'
    );

    this.activeSummary = {
      volume,
      stats: context.stats,
      isConsistency: reducer.kind === 'consistency',
      range,
      reducerKind: reducer.kind,
      label: reducer.label,
    };
    this.refreshReadout();
  }

  startCine(): void {
    if (this.isCineBlocked() || this.cinePlaying) return;

    const intervalMs = Math.max(100, Math.round(1000 / Math.max(1, this.cineFps)));
    this.cinePlaying = true;
    this.cineHandle = setInterval(() => this.stepSubject(1), intervalMs);
  }

  stopCine(): void {
    if (this.cineHandle) {
      clearInterval(this.cineHandle);
      this.cineHandle = undefined;
    }
    this.cinePlaying = false;
  }

  toggleCine(): void {
    if (this.cinePlaying) {
      this.stopCine();
    } else {
      this.startCine();
    }
  }

  stepSubject(delta: number): void {
    const count = this.requireViewer().getSession().subjectCount;
    if (count === 0) return;
    const next = (this.subjectIndex + delta + count) % count;
    this.setSubjectIndex(next);
  }

  legendSpec(): OverlayLegendSpec | null {
    if (!this.viewer) return null;
    if (this.view === 'subject') {
      return { kind: 'signed', range: this.viewer.getSession().getDisplayRange(), label: 'Subject' };
    }
    if (this.activeSummary) {
      return {
        kind: this.activeSummary.reducerKind,
        range: cloneRange(this.activeSummary.range),
        label: this.activeSummary.label,
      };
    }
    const reducer = this.getCurrentReducer();
    return {
      kind: reducer.kind,
      range: reducer.kind === 'consistency' ? [0, 1] : [-6, 6],
      label: reducer.label,
    };
  }

  render() {
    if (!this.viewer) {
      return html`<div class="section">No review session</div>`;
    }

    const session = this.viewer.getSession();
    const subjects = session.subjects;
    const currentSubject = subjects[this.subjectIndex];
    const cineBlocked = this.isCineBlocked();
    const reducer = this.getCurrentReducer();

    return html`
      <div class="section">
        <label class="label" for="contrast-select">Contrast</label>
        <select id="contrast-select" @change=${this.onContrastChange}>
          ${session.contrasts.map((contrast) => html`
            <option value=${contrast.id} ?selected=${contrast.id === this.contrastId}>
              ${contrast.label ?? contrast.id}
            </option>
          `)}
        </select>
      </div>

      <div class="section">
        <span class="label">View</span>
        <div class="segmented">
          ${(['subject', 'group'] as OverlayReviewView[]).map((view) => html`
            <button
              type="button"
              class=${this.view === view ? 'active' : ''}
              aria-pressed=${this.view === view ? 'true' : 'false'}
              @click=${() => this.setView(view)}
            >${view === 'subject' ? 'Subject' : 'Group summary'}</button>
          `)}
        </div>
      </div>

      <div class="section">
        <span class="label">Subject</span>
        <div class="transport">
          <button class="icon-btn" type="button" title="Previous subject" @click=${() => this.stepSubject(-1)}>◀</button>
          <input
            type="range"
            min="0"
            max=${Math.max(0, session.subjectCount - 1)}
            step="1"
            .value=${String(this.subjectIndex)}
            @input=${this.onSubjectInput}
          />
          <button class="icon-btn" type="button" title="Next subject" @click=${() => this.stepSubject(1)}>▶</button>
          <button
            class="icon-btn"
            type="button"
            title=${this.cinePlaying ? 'Stop' : 'Play through subjects'}
            ?disabled=${cineBlocked}
            aria-pressed=${this.cinePlaying ? 'true' : 'false'}
            @click=${this.onCineClick}
          >${this.cinePlaying ? '◼' : '▶▶'}</button>
        </div>
        <div class="subject-meta">
          <span>${this.subjectIndex + 1} / ${session.subjectCount}</span>
          <span class="name">${currentSubject?.label ?? currentSubject?.id ?? ''}</span>
          ${currentSubject?.group ? html`<span class="group">group ${currentSubject.group}</span>` : ''}
        </div>
        ${cineBlocked ? html`<div class="hint">Cine is paused for holdout consistency (recompute is heavy).</div>` : ''}
      </div>

      <div class="section">
        <label class="label" for="cutoff-input">Cutoff</label>
        <div class="row">
          <input
            type="range"
            min="0"
            max=${this.cutoffMax}
            step="0.1"
            .value=${String(this.cutoff)}
            @input=${this.onCutoffInput}
          />
          <input
            id="cutoff-input"
            class="compact"
            type="number"
            min="0"
            max=${this.cutoffMax}
            step="0.1"
            .value=${this.cutoff.toFixed(1)}
            @change=${this.onCutoffNumber}
          />
        </div>
        <div class="hint">${overlayCutoffHint(this.view, reducer.kind, this.cutoff)}</div>
      </div>

      ${this.view === 'group' ? html`
        <div class="section">
          <label class="label" for="summary-select">Statistic</label>
          <select id="summary-select" @change=${this.onReducerChange}>
            ${this.reducers.map((candidate) => html`
              <option value=${candidate.id} ?selected=${candidate.id === this.reducerId}>
                ${candidate.label}
              </option>
            `)}
          </select>
          <div class="checkbox-row" style="margin-top: 8px;">
            <input
              id="holdout-check"
              type="checkbox"
              ?checked=${this.holdout}
              @change=${this.onHoldoutToggle}
            />
            <label for="holdout-check">Leave current subject out</label>
          </div>
          ${this.holdout ? html`
            <div class="hint">${currentSubject?.label ?? `Subject ${this.subjectIndex + 1}`} vs the other ${Math.max(0, session.subjectCount - 1)}</div>
          ` : ''}
        </div>
      ` : ''}

      ${this.renderReadout()}
      ${this.renderLegend()}
    `;
  }

  private renderReadout() {
    const readout = this.readout;
    const summary = this.activeSummary;
    return html`
      <div class="section">
        <span class="label">At cursor</span>
        ${readout
          ? html`
            <dl class="readout">
              <dt>Voxel</dt>
              <dd>[${readout.voxel.join(', ')}]</dd>
              <dt>Subject</dt>
              <dd>${formatValue(readout.subject)}</dd>
              ${summary
                ? html`
                  <dt>${summary.label}</dt>
                  <dd>${summary.isConsistency
                    ? html`${formatValue(readout.summary)}${readout.validCount != null
                        ? html` <span class="muted">(${readout.consistentCount ?? 0}/${readout.validCount})</span>`
                        : ''}`
                    : formatValue(readout.summary)}</dd>
                `
                : ''}
            </dl>
          `
          : html`<div class="muted">Hover the image to read values.</div>`}
      </div>
    `;
  }

  private renderLegend() {
    const spec = this.legendSpec();
    if (!spec) return '';

    const isConsistency = spec.kind === 'consistency';
    const [min, max] = spec.range;
    const mid = isConsistency
      ? (min + max) / 2
      : (min < 0 && max > 0 ? 0 : (min + max) / 2);

    return html`
      <div class="section">
        <span class="label">${spec.label}</span>
        <div
          class="legend-bar"
          style=${`background: ${isConsistency ? CONSISTENCY_GRADIENT : DIVERGING_GRADIENT};`}
        ></div>
        <div class="legend-ticks">
          <span>${formatNumber(min)}</span>
          <span>${formatNumber(mid)}</span>
          <span>${formatNumber(max)}</span>
        </div>
      </div>
    `;
  }

  private afterModeChange(): void {
    if (this.isCineBlocked()) this.stopCine();
    this.applyModePolicy();
  }

  private attachViewer(viewer?: OverlayReviewPanelViewer | SubjectOverlayViewer): void {
    if (!viewer) {
      this.detachViewer();
      return;
    }
    if (this.attachedViewer === viewer) return;

    this.detachViewer();
    this.attachedViewer = viewer;
    this.coordUnsubscribe = viewer.onCoordChange?.((coord) => this.onViewerCoord(coord));
    this.syncFromViewer();
    this.applyModePolicy();
  }

  private detachViewer(): void {
    this.coordUnsubscribe?.();
    this.coordUnsubscribe = undefined;
    this.attachedViewer = undefined;
    this.services.clear();
    this.clearDebounce();
    this.stopCine();
    this.activeSummary = null;
    this.lastWorldCoord = undefined;
    this.readout = null;
  }

  private onViewerCoord(coord: number[]): void {
    this.lastWorldCoord = coord.slice();
    this.refreshReadout();
  }

  private refreshReadout(): void {
    if (!this.lastWorldCoord || !this.attachedViewer) {
      return;
    }
    const subjectVolume = this.attachedViewer.getSession().getSubjectVolume();
    this.readout = sampleOverlayReadout(this.lastWorldCoord, subjectVolume, this.activeSummary);
    this.requestUpdate();
  }

  private syncFromViewer(): void {
    const viewer = this.requireViewer();
    const state = viewer.getState();
    this.subjectIndex = state.subjectIndex;
    this.contrastId = state.contrastId;
  }

  private applyModePolicy(): void {
    const viewer = this.requireViewer();
    viewer.setSymmetricThreshold(this.cutoff);

    if (this.effectiveMode() === 'browse') {
      viewer.clearSummaryVolume();
      this.activeSummary = null;
      this.refreshReadout();
      return;
    }

    this.refreshSummary();
  }

  private scheduleSummaryRefresh(): void {
    this.clearDebounce();
    if (this.summaryDebounceMs <= 0) {
      this.refreshSummary();
      return;
    }

    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = undefined;
      this.refreshSummary();
    }, this.summaryDebounceMs);
  }

  private clearDebounce(): void {
    if (!this.debounceHandle) return;
    clearTimeout(this.debounceHandle);
    this.debounceHandle = undefined;
  }

  private createReducerContext(): OverlayReviewReducerContext {
    const viewer = this.requireViewer();
    const session = viewer.getSession();
    const contrast = session.getContrast(this.contrastId || session.currentContrastId);
    const vec = contrast.vec;
    const service = this.getService(contrast.id, vec);
    const fullSet = allSubjectIndices(session.subjectCount);
    const subjectIndices = this.effectiveMode() === 'holdout'
      ? fullSet.filter((index) => index !== this.subjectIndex)
      : fullSet;
    const stats = this.effectiveMode() === 'holdout'
      ? service.leaveOneOutStats(this.subjectIndex)
      : service.getStats();

    return {
      service,
      vec,
      subjectIndices,
      stats,
      cutoff: this.cutoff,
      displayRange: session.getDisplayRange(contrast.id),
    };
  }

  private getService(contrastId: string, vec: NeuroVec): OverlaySummaryService {
    const existing = this.services.get(contrastId);
    if (existing) return existing;

    const service = new OverlaySummaryService(vec);
    this.services.set(contrastId, service);
    return service;
  }

  private getCurrentReducer(): OverlayReviewReducer {
    return this.getReducer(this.reducerId);
  }

  private getReducer(id: string): OverlayReviewReducer {
    const reducer = this.reducers.find((candidate) => candidate.id === id);
    if (!reducer) {
      throw new ValueError(`Unknown overlay review reducer: ${id}`);
    }
    return reducer;
  }

  private requireViewer(): OverlayReviewPanelViewer {
    if (!this.viewer) {
      throw new ValueError('OverlayReviewPanel requires a viewer');
    }
    return this.viewer;
  }

  private isCineBlocked(): boolean {
    return this.effectiveMode() === 'holdout' && this.getCurrentReducer().kind === 'consistency';
  }

  private onContrastChange(event: Event): void {
    this.setContrastId((event.target as HTMLSelectElement).value);
  }

  private onReducerChange(event: Event): void {
    this.setReducer((event.target as HTMLSelectElement).value);
  }

  private onSubjectInput(event: Event): void {
    this.setSubjectIndex(Number((event.target as HTMLInputElement).value));
  }

  private onCutoffInput(event: Event): void {
    this.setCutoff(Number((event.target as HTMLInputElement).value));
  }

  private onCutoffNumber(event: Event): void {
    this.setCutoff(Number((event.target as HTMLInputElement).value));
  }

  private onHoldoutToggle(event: Event): void {
    this.setHoldout((event.target as HTMLInputElement).checked);
  }

  private onCineClick(): void {
    this.toggleCine();
  }
}
