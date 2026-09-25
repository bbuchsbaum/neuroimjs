import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { ImageLayer } from '../display/ImageLayer';
import { ColorMap } from '../display/ColorMap';
import { VolLayer } from '../display/VolLayer';
import { VolStack } from '../display/VolStack';
import { Range, Threshold } from '../types';  // Import the types

// Import our custom RangeSlider (native inputs; no noUiSlider CSS required)
import './RangeSlider2';

/** Serializable display state for one controlled volume layer. */
export interface LayerControlState {
  layerId: string;
  range: Range;
  threshold: Threshold;
  colormap: string;
  opacity: number;
  visible: boolean;
}

export type LayerControlName =
  | 'layer'
  | 'visibility'
  | 'colormap'
  | 'range'
  | 'threshold'
  | 'opacity';

const COLORMAP_DISPLAY_NAMES: Record<string, string> = {
  BlueRed: 'Blue–white–red',
  RdBu: 'Red–white–blue',
  Inferno: 'Inferno',
  Viridis: 'Viridis',
  Grayscale: 'Grayscale',
  Greys: 'Grayscale',
  Hot: 'Hot',
  Jet: 'Jet',
};

/**
 * Human-readable label for a colormap preset. Option values stay the preset
 * names; only the visible text changes. Unknown names get spaces inserted at
 * camelCase boundaries (e.g. "CoolWarm" -> "Cool Warm").
 */
export function colormapDisplayName(name: string): string {
  if (Object.prototype.hasOwnProperty.call(COLORMAP_DISPLAY_NAMES, name)) {
    return COLORMAP_DISPLAY_NAMES[name];
  }
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/** U+2212 MINUS SIGN, used for displayed negative values. */
const MINUS = '−';

/**
 * Format a number for a numeric field: two decimals, true minus sign for
 * negatives, and no "negative zero". Non-finite values format as ''.
 */
export function formatControlNumber(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '';
  const text = v.toFixed(digits);
  if (/^-0\.?0*$/.test(text)) return text.slice(1);
  return text.replace('-', MINUS);
}

/**
 * Strictly parse a numeric field. Accepts "-" (hyphen-minus), U+2212 minus and
 * U+2013 en dash as the sign, optional leading "+", decimals and exponents.
 * Returns NaN for anything else (so "3abc" is rejected, unlike parseFloat).
 */
export function parseControlNumber(text: string): number {
  const normalized = text.trim().replace(/^[−–]/, '-').replace(/[eE][−–]/, m => `${m[0]}-`);
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(normalized)) return NaN;
  return Number(normalized);
}

/**
 * Slider domain for a data extent: symmetric (±max|extent|) when the extent
 * straddles zero, so equal magnitudes sit symmetrically about the centre;
 * otherwise the extent itself.
 */
export function sliderDomain(extent: Range): { min: number; max: number; symmetric: boolean } {
  const [lo, hi] = extent;
  if (Number.isFinite(lo) && Number.isFinite(hi) && lo < 0 && hi > 0) {
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    return { min: -m, max: m, symmetric: true };
  }
  return { min: lo, max: hi, symmetric: false };
}

@customElement('layer-control-panel')
export class LayerControlPanel extends LitElement {
  /**
   * Instrument-style visual language aligned with the neuromosaic report
   * design system. Every colour is a component token (`--lcp-*`) that defaults
   * to the matching report token (`--nm-*`) with a literal fallback, so the
   * panel adopts the host page's palette through shadow-DOM custom-property
   * inheritance. Hosts can restyle individual elements via `::part()`
   * (panel, section, header, label, input, select, swatch, slider, caption,
   * toggle, footer, reset).
   */
  static styles = css`
    :host {
      /* Component tokens. Legacy names (--accent-teal, --input-bg, ...) are
         honoured first so older host overrides keep working. */
      --lcp-ink: var(--nm-ink, #1c2226);
      --lcp-ink-2: var(--label-color, var(--nm-ink-2, #3e4952));
      --lcp-muted: var(--nm-muted, #66717b);
      --lcp-rule: var(--border-subtle, var(--nm-rule, #e2e5e6));
      --lcp-rule-strong: var(--input-border, var(--nm-rule-strong, #c9cfd2));
      --lcp-accent: var(--accent-teal, var(--nm-accent, #2f6f73));
      --lcp-accent-soft: var(--nm-accent-soft, #e4efef);
      --lcp-surface: var(--input-bg, var(--nm-surface, #ffffff));
      --lcp-thumb: var(--lcp-surface);
      --lcp-bg: var(--panel-bg-start, transparent);
      --lcp-pad: 0;
      --lcp-shadow-color: rgba(28, 34, 38, 0.2);
      --lcp-edge: rgba(0, 0, 0, 0.08);
      /* Inactive track: --lcp-rule-strong fill + 1px inset outline (WCAG 1.4.11) */
      --lcp-track-edge: rgba(28, 34, 38, 0.18);
      --lcp-hatch: #a9b1b6;
      /* Control geometry: slider thumb hit box / visible radius, input height */
      --lcp-hit: 24px;
      --lcp-r: 8px;
      --lcp-input-h: 30px;

      display: block;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      padding: var(--lcp-pad);
      background: var(--lcp-bg);
      color: var(--lcp-ink);
      font-family: inherit;
      font-size: 13px;
      line-height: 1.4;
      font-variant-numeric: tabular-nums;
    }

    :host([theme='dark']) {
      --lcp-ink: #e6eaec;
      --lcp-ink-2: #c4ccd1;
      --lcp-muted: #9aa5ae;
      --lcp-rule: #2e363b;
      --lcp-rule-strong: #4a555d;
      --lcp-accent: #5fb3b3;
      --lcp-accent-soft: rgba(95, 179, 179, 0.22);
      --lcp-surface: #1b2125;
      --lcp-thumb: #f4f6f7;
      --lcp-shadow-color: rgba(0, 0, 0, 0.5);
      --lcp-edge: rgba(255, 255, 255, 0.1);
      --lcp-track-edge: rgba(255, 255, 255, 0.22);
      --lcp-hatch: #6b7780;
    }

    @media (pointer: coarse) {
      :host {
        --lcp-hit: 44px;
        --lcp-r: 10px;
        --lcp-input-h: 40px;
      }
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-height: 100%;
      box-sizing: border-box;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 28px;
    }

    .label {
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--lcp-muted);
    }

    /* Paired low/high inputs: identical grid in every row so the fields
       line up; the separator or link toggle is centred in the 24px slot. */
    .pair {
      display: grid;
      grid-template-columns: 64px 24px 64px;
      align-items: center;
      justify-items: center;
      flex: 0 0 auto;
      margin-left: auto;
    }

    /* Symmetric-threshold link toggle (sits between the Threshold inputs) */
    .link-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      margin: 0;
      padding: 0;
      color: var(--lcp-muted);
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }

    .link-btn svg {
      display: block;
    }

    /* Invisible hit-area extension */
    .link-btn::before {
      content: '';
      position: absolute;
      inset: -2px;
    }

    .link-btn:hover {
      color: var(--lcp-ink-2);
    }

    .link-btn[aria-pressed='true'] {
      color: var(--lcp-accent);
      background: var(--lcp-accent-soft);
    }

    .link-btn[aria-pressed='true']:hover {
      color: var(--lcp-accent);
    }

    .link-btn:focus {
      outline: none;
    }

    .link-btn:focus-visible {
      outline: 2px solid var(--lcp-accent);
      outline-offset: 2px;
    }

    @media (pointer: coarse) {
      .link-btn::before {
        inset: -12px;
      }
    }

    .dash {
      color: var(--lcp-ink-2);
      font-size: 13px;
    }

    /* Compact numeric inputs */
    input.native-number {
      width: 64px;
      height: var(--lcp-input-h);
      margin: 0;
      padding: 0 6px;
      font: inherit;
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
      text-align: right;
      color: var(--lcp-ink);
      background: var(--lcp-surface);
      border: 1px solid var(--lcp-rule-strong);
      border-radius: 6px;
    }

    input.native-number.narrow {
      width: 56px;
    }

    input.native-number:hover {
      border-color: var(--lcp-muted);
    }

    input.native-number:focus,
    select.native-select:focus {
      outline: none;
    }

    input.native-number:focus-visible,
    select.native-select:focus-visible {
      border-color: var(--lcp-accent);
      outline: 2px solid var(--lcp-accent);
      outline-offset: 2px;
    }

    /* Select */
    select.native-select {
      display: block;
      width: 100%;
      height: 30px;
      margin: 0;
      padding: 0 28px 0 9px;
      font: inherit;
      font-size: 13px;
      color: var(--lcp-ink);
      background-color: var(--lcp-surface);
      /* Token-coloured chevron drawn with two gradients (themes with the panel) */
      background-image:
        linear-gradient(45deg, transparent 50%, var(--lcp-muted) 50%),
        linear-gradient(135deg, var(--lcp-muted) 50%, transparent 50%);
      background-position:
        calc(100% - 15px) 50%,
        calc(100% - 10px) 50%;
      background-size: 5px 5px;
      background-repeat: no-repeat;
      border: 1px solid var(--lcp-rule-strong);
      border-radius: 6px;
      cursor: pointer;
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
    }

    select.native-select:hover {
      border-color: var(--lcp-muted);
    }

    /* Colormap preview swatch drawn inside the select field */
    .select-wrap {
      position: relative;
    }

    .select-wrap select.native-select {
      padding-left: 49px;
    }

    .swatch {
      position: absolute;
      left: 9px;
      top: 50%;
      width: 32px;
      height: 8px;
      border-radius: 2px;
      box-shadow: inset 0 0 0 1px var(--lcp-edge);
      transform: translateY(-50%);
      pointer-events: none;
    }

    /* Dual slider (range-slider reads the --lcp-* tokens) */
    range-slider {
      display: block;
      width: 100%;
    }

    /* Native range (Opacity). The thumb is a transparent --lcp-hit square
       hit box; the visible --lcp-r disc is painted with a radial gradient. */
    input.native-range {
      --frac: 1;
      --half: calc(var(--lcp-hit) / 2);
      /* The input is widened by (hit - 2r) and shifted left by (hit/2 - r), so
         thumb centres run from r to 100% - r of the column: the visible track
         (drawn from half to 100% - half of the input) is inset by the thumb
         radius and a thumb at 0 or 1 sits flush with the column edge. */
      --fill: calc(var(--half) + (100% - var(--lcp-hit)) * var(--frac));
      --lcp-thumb-img: radial-gradient(
        circle,
        var(--lcp-thumb) 0 calc(var(--lcp-r) - 1.75px),
        var(--lcp-accent) calc(var(--lcp-r) - 1.25px) calc(var(--lcp-r) - 0.25px),
        var(--lcp-shadow-color) calc(var(--lcp-r) + 0.25px),
        transparent calc(var(--lcp-r) + 1.75px)
      );
      --lcp-thumb-img-hover: radial-gradient(
        circle,
        var(--lcp-thumb) 0 calc(var(--lcp-r) - 1.75px),
        var(--lcp-accent) calc(var(--lcp-r) - 1.25px) calc(var(--lcp-r) - 0.25px),
        var(--lcp-accent-soft) calc(var(--lcp-r) + 0.25px) calc(var(--lcp-r) + 4px),
        transparent calc(var(--lcp-r) + 4.5px)
      );
      --lcp-thumb-img-focus: radial-gradient(
        circle,
        var(--lcp-thumb) 0 calc(var(--lcp-r) - 1.75px),
        var(--lcp-accent) calc(var(--lcp-r) - 1.25px) calc(var(--lcp-r) - 0.25px),
        transparent calc(var(--lcp-r) + 0.25px) calc(var(--lcp-r) + 1.75px),
        var(--lcp-accent) calc(var(--lcp-r) + 2.25px) calc(var(--lcp-r) + 3.75px),
        transparent calc(var(--lcp-r) + 4.25px)
      );
      display: block;
      width: calc(100% - 2 * var(--lcp-r) + var(--lcp-hit));
      height: var(--lcp-hit);
      margin: 0 0 0 calc(var(--lcp-r) - var(--half));
      padding: 0;
      background: transparent;
      accent-color: var(--lcp-accent);
      cursor: pointer;
      -webkit-appearance: none;
      appearance: none;
    }

    input.native-range:focus {
      outline: none;
    }

    input.native-range::-webkit-slider-runnable-track {
      height: 4px;
      border-radius: 2px;
      /* Edge outline layers are sized to the visible span (half .. 100% - half) */
      background:
        linear-gradient(to bottom, var(--lcp-track-edge) 0 1px, transparent 1px 3px, var(--lcp-track-edge) 3px)
          var(--half) 0 / calc(100% - var(--lcp-hit)) 100% no-repeat,
        linear-gradient(to right, var(--lcp-track-edge) 0 1px, transparent 1px calc(100% - 1px), var(--lcp-track-edge) calc(100% - 1px))
          var(--half) 0 / calc(100% - var(--lcp-hit)) 100% no-repeat,
        linear-gradient(
          to right,
          transparent 0 var(--half),
          var(--lcp-accent) var(--half) var(--fill),
          var(--lcp-rule-strong) var(--fill) calc(100% - var(--half)),
          transparent calc(100% - var(--half))
        );
    }

    input.native-range::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: var(--lcp-hit);
      height: var(--lcp-hit);
      margin-top: calc((4px - var(--lcp-hit)) / 2);
      border: none;
      border-radius: 50%;
      background: var(--lcp-thumb-img);
      cursor: pointer;
    }

    input.native-range:hover::-webkit-slider-thumb,
    input.native-range:active::-webkit-slider-thumb {
      background: var(--lcp-thumb-img-hover);
    }

    input.native-range:focus-visible::-webkit-slider-thumb {
      background: var(--lcp-thumb-img-focus);
    }

    input.native-range::-moz-range-track {
      height: 4px;
      background:
        linear-gradient(to bottom, var(--lcp-track-edge) 0 1px, transparent 1px 3px, var(--lcp-track-edge) 3px)
          var(--half) 0 / calc(100% - var(--lcp-hit)) 100% no-repeat,
        linear-gradient(to right, var(--lcp-track-edge) 0 1px, transparent 1px calc(100% - 1px), var(--lcp-track-edge) calc(100% - 1px))
          var(--half) 0 / calc(100% - var(--lcp-hit)) 100% no-repeat,
        linear-gradient(
          to right,
          transparent 0 var(--half),
          var(--lcp-rule-strong) var(--half) calc(100% - var(--half)),
          transparent calc(100% - var(--half))
        );
    }

    input.native-range::-moz-range-progress {
      height: 4px;
      background: linear-gradient(to right, transparent 0 var(--half), var(--lcp-accent) var(--half));
    }

    input.native-range::-moz-range-thumb {
      width: var(--lcp-hit);
      height: var(--lcp-hit);
      border: none;
      border-radius: 50%;
      background: var(--lcp-thumb-img);
      cursor: pointer;
    }

    input.native-range:hover::-moz-range-thumb,
    input.native-range:active::-moz-range-thumb {
      background: var(--lcp-thumb-img-hover);
    }

    input.native-range:focus-visible::-moz-range-thumb {
      background: var(--lcp-thumb-img-focus);
    }

    .caption {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
      color: var(--lcp-muted);
    }

    /* Visibility toggle */
    .visibility-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 24px;
    }

    .visibility-toggle input[type='checkbox'] {
      width: 14px;
      height: 14px;
      margin: 0;
      accent-color: var(--lcp-accent);
      cursor: pointer;
    }

    .visibility-toggle input[type='checkbox']:focus-visible {
      outline: 2px solid var(--lcp-accent);
      outline-offset: 2px;
    }

    .visibility-toggle label {
      font-size: 12.5px;
      color: var(--lcp-ink-2);
      cursor: pointer;
    }

    /* Footer */
    .footer {
      margin-top: auto;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-top: 12px;
      border-top: 1px solid var(--lcp-rule);
    }

    .reset-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin: 0;
      padding: 2px 4px;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      color: var(--lcp-accent);
      background: none;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .reset-btn:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .reset-btn:focus {
      outline: none;
    }

    .reset-btn:focus-visible {
      outline: 2px solid var(--lcp-accent);
      outline-offset: 2px;
    }
  `;

  private _imageLayer?: ImageLayer;
  private _viewer?: any;  // OrthogonalImageViewer or similar
  private _volStack?: VolStack;

  /**
   * Alternative entry point: set a VolStack directly (without needing an ImageLayer or viewer).
   * In composable mode, VolLayer setters trigger MobX autorun → renderSlice() in all views.
   */
  @property({ attribute: false })
  get volStack() {
    return this._volStack;
  }
  set volStack(value: VolStack | undefined) {
    const oldValue = this._volStack;
    this._volStack = value;
    this.requestUpdate('volStack', oldValue);
  }

  @property({ type: ImageLayer })
  get imageLayer() {
    return this._imageLayer;
  }
  set imageLayer(value: ImageLayer | undefined) {
    const oldValue = this._imageLayer;
    this._imageLayer = value;
    this.requestUpdate('imageLayer', oldValue);
  }

  /**
   * Optional visible-control subset for embedded report UIs. `null` preserves
   * the full standalone panel. Programmatic get/apply/reset state always
   * remains complete regardless of which controls are visible.
   */
  @property({ attribute: false })
  visibleControls: LayerControlName[] | null = null;

  private shows(control: LayerControlName): boolean {
    return this.visibleControls === null || this.visibleControls.includes(control);
  }

  /**
   * Optional viewer reference for triggering re-renders across all per-view ImageLayers.
   * When set, layer updates will use viewer.applyToImageLayers() to update all views.
   */
  @property({ attribute: false })
  get viewer() {
    return this._viewer;
  }
  set viewer(value: any) {
    this._viewer = value;
  }

  @state() private selectedLayerId: string = '';
  @state() private availableLayers: string[] = [];
  @state() private colormaps: string[] = [];
  @state() private selectedColormap: string = 'Viridis';
  @state() private range: Range = [0, 10000];
  @state() private threshold: Threshold = [0, 0];
  @state() private alpha: number = 1;
  @state() private volumeRange: Range = [0, 10000];
  @state() private visible: boolean = true;
  /** Symmetric threshold link (low = -high). Defaults per layer; see syncThresholdLink(). */
  @state() private thresholdLinked: boolean = false;
  private thresholdLinkLayerId: string | undefined;
  private volLayer!: VolLayer;

  // Per-layer defaults captured on load, used by "Reset to defaults".
  private defaultRange: Range = [0, 10000];
  private defaultThreshold: Threshold = [0, 0];
  private defaultAlpha: number = 1;
  private defaultColormap: string = 'Viridis';
  private defaultVisible: boolean = true;
  private defaultsByLayer = new Map<string, LayerControlState>();

  private resolveStack(): VolStack | undefined {
    return this._volStack ?? this.imageLayer?.getVolStack();
  }

  private captureDefaults(overwrite = false) {
    if (!this.selectedLayerId || (!overwrite && this.defaultsByLayer.has(this.selectedLayerId))) return;
    this.defaultRange = [this.range[0], this.range[1]];
    this.defaultThreshold = [this.threshold[0], this.threshold[1]];
    this.defaultAlpha = this.alpha;
    this.defaultColormap = this.selectedColormap;
    this.defaultVisible = this.visible;
    this.defaultsByLayer.set(this.selectedLayerId, {
      layerId: this.selectedLayerId,
      range: [...this.defaultRange] as Range,
      threshold: [...this.defaultThreshold] as Threshold,
      colormap: this.defaultColormap,
      opacity: this.defaultAlpha,
      visible: this.defaultVisible,
    });
  }

  private captureAllDefaults(stack: VolStack) {
    stack.getLayerIds().forEach(layerId => {
      if (this.defaultsByLayer.has(layerId)) return;
      const layer = stack.getLayerById(layerId);
      if (!layer) return;
      this.defaultsByLayer.set(layerId, {
        layerId,
        range: [...layer.getRange()] as Range,
        threshold: [...layer.getThreshold()] as Threshold,
        colormap: layer.colorMap.name,
        opacity: layer.opacity,
        visible: layer.visible,
      });
    });
  }

  private colormapNamesIncluding(name: string): string[] {
    const presets = ColorMap.getAvailableMaps();
    return presets.includes(name) ? presets : [name, ...presets];
  }

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('imageLayer') && this.imageLayer) {
      this.initializeFromImageLayer();
    }
    if (changedProperties.has('volStack') && this._volStack) {
      this.initializeFromVolStack();
    }
  }


  private initializeFromImageLayer() {
    if (!this.imageLayer) return;

    this.volLayer = this.imageLayer.getLayer(0);
    this.availableLayers = this.imageLayer.getLayerIds();
    this.selectedLayerId = this.availableLayers[0];
    this.range = this.volLayer.getRange();
    this.selectedColormap = this.volLayer.colorMap.name;
    this.colormaps = this.colormapNamesIncluding(this.selectedColormap);
    this.alpha = this.volLayer.opacity;
    this.threshold = this.volLayer.getThreshold();
    this.visible = this.volLayer.visible;

    // Get the volume's actual data range for display
    this.volumeRange = this.volLayer.getVolumeRange();

    this.captureAllDefaults(this.imageLayer.getVolStack());
    this.captureDefaults();
    this.syncThresholdLink(true);
    this.requestUpdate();
  }

  private initializeFromVolStack() {
    if (!this._volStack) return;

    this.volLayer = this._volStack.getLayer(0);
    this.availableLayers = this._volStack.getLayerIds();
    this.selectedLayerId = this.availableLayers[0];
    this.range = this.volLayer.getRange();
    this.selectedColormap = this.volLayer.colorMap.name;
    this.colormaps = this.colormapNamesIncluding(this.selectedColormap);
    this.alpha = this.volLayer.opacity;
    this.threshold = this.volLayer.getThreshold();
    this.visible = this.volLayer.visible;
    this.volumeRange = this.volLayer.getVolumeRange();

    this.captureAllDefaults(this._volStack);
    this.captureDefaults();
    this.syncThresholdLink(true);
    this.requestUpdate();
  }

  /** Return a detached snapshot of one layer's current display controls. */
  getState(layerId: string = this.selectedLayerId): LayerControlState {
    const layer = this.resolveStack()?.getLayerById(layerId);
    if (!layer) throw new Error(`Unknown layer id: ${layerId || '(none)'}`);
    return {
      layerId,
      range: [...layer.getRange()] as Range,
      threshold: [...layer.getThreshold()] as Threshold,
      colormap: layer.colorMap.name,
      opacity: layer.opacity,
      visible: layer.visible,
    };
  }

  /** Select a layer for both visible controls and subsequent programmatic updates. */
  selectLayer(layerId: string): void {
    const selectedLayer = this.resolveStack()?.getLayerById(layerId);
    if (!selectedLayer) throw new Error(`Unknown layer id: ${layerId}`);
    this.selectedLayerId = layerId;
    this.volLayer = selectedLayer;
    this.range = [...selectedLayer.getRange()] as Range;
    this.threshold = [...selectedLayer.getThreshold()] as Threshold;
    this.selectedColormap = selectedLayer.colorMap.name;
    this.colormaps = this.colormapNamesIncluding(this.selectedColormap);
    this.alpha = selectedLayer.opacity;
    this.visible = selectedLayer.visible;
    this.volumeRange = selectedLayer.getVolumeRange();
    this.captureDefaults();
    const defaults = this.defaultsByLayer.get(layerId);
    if (defaults) {
      this.defaultRange = [...defaults.range] as Range;
      this.defaultThreshold = [...defaults.threshold] as Threshold;
      this.defaultColormap = defaults.colormap;
      this.defaultAlpha = defaults.opacity;
      this.defaultVisible = defaults.visible;
    }
    this.syncThresholdLink(false);
    this.requestUpdate();
  }

  /** Apply display controls through the same update path used by the widgets. */
  applyState(state: Partial<LayerControlState> & { layerId?: string }): LayerControlState {
    const layerId = state.layerId ?? this.selectedLayerId;
    this.selectLayer(layerId);
    const current = this.getState(layerId);
    const range = (state.range ? [...state.range] : current.range) as Range;
    const threshold = (state.threshold ? [...state.threshold] : current.threshold) as Threshold;
    const opacity = state.opacity ?? current.opacity;
    const colormap = state.colormap ?? current.colormap;
    const visible = state.visible ?? current.visible;

    if (range.length !== 2 || range.some(value => !Number.isFinite(value)) || range[0] >= range[1]) {
      throw new Error('range must contain two finite, increasing numbers.');
    }
    if (threshold.length !== 2 || threshold.some(value => !Number.isFinite(value))) {
      throw new Error('threshold must contain two finite numbers.');
    }
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new Error('opacity must be between 0 and 1.');
    }
    if (typeof visible !== 'boolean') throw new Error('visible must be boolean.');

    // Keep a non-preset (custom) colormap when the requested name is unchanged.
    const colorMap = colormap === this.volLayer.colorMap.name && !ColorMap.presetMaps.hasOwnProperty(colormap)
      ? this.volLayer.colorMap
      : ColorMap.fromPreset(colormap, { existingColorMap: this.volLayer.colorMap });

    this.range = range;
    this.threshold = threshold;
    this.alpha = opacity;
    this.selectedColormap = colormap;
    this.colormaps = this.colormapNamesIncluding(colormap);
    this.visible = visible;
    this.volLayer.setRange(range);
    this.volLayer.setThreshold(threshold);
    this.volLayer.setOpacity(opacity);
    this.volLayer.setColormap(colorMap);
    this.volLayer.setVisible(visible);
    this.updateAllImageLayers({ range, threshold, alpha: opacity, colormap: colorMap, visible });
    this.requestUpdate();
    const next = this.getState(layerId);
    this.emitControlChange(next);
    return next;
  }

  private emitControlChange(state: LayerControlState = this.getState()): void {
    this.dispatchEvent(new CustomEvent<LayerControlState>('layer-control-change', {
      detail: state,
      bubbles: true,
      composed: true,
    }));
  }

  /** Restore the layer state captured when the panel was attached. */
  resetToDefaults(layerId: string = this.selectedLayerId): LayerControlState {
    const defaults = this.defaultsByLayer.get(layerId);
    if (!defaults) throw new Error(`No defaults recorded for layer id: ${layerId}`);
    return this.applyState({
      ...defaults,
      range: [...defaults.range] as Range,
      threshold: [...defaults.threshold] as Threshold,
    });
  }

  /**
   * Replace one layer's reset baseline with its current state. This is useful
   * when an embedding reuses a stable layer id while swapping among report
   * maps whose authored display defaults differ.
   */
  setDefaultsFromCurrent(layerId: string = this.selectedLayerId): LayerControlState {
    this.selectLayer(layerId);
    const current = this.getState(layerId);
    this.defaultsByLayer.set(layerId, {
      ...current,
      range: [...current.range] as Range,
      threshold: [...current.threshold] as Threshold,
    });
    this.defaultRange = [...current.range] as Range;
    this.defaultThreshold = [...current.threshold] as Threshold;
    this.defaultColormap = current.colormap;
    this.defaultAlpha = current.opacity;
    this.defaultVisible = current.visible;
    // A new baseline (e.g. a different report map under the same layer id)
    // re-derives the symmetric-threshold link default.
    this.syncThresholdLink(true);
    return current;
  }

  /**
   * Set the threshold link default: on when the data span zero and the
   * current threshold is symmetric (low === -high within 1e-9), else off.
   * Only re-derived when the controlled layer changes (or `force`), so a
   * user's explicit toggle survives ordinary value edits.
   */
  private syncThresholdLink(force: boolean): void {
    if (!force && this.thresholdLinkLayerId === this.selectedLayerId) return;
    this.thresholdLinkLayerId = this.selectedLayerId;
    const [lo, hi] = this.threshold;
    const [dlo, dhi] = this.volumeRange ?? [0, 0];
    this.thresholdLinked =
      dlo < 0 && dhi > 0 && Number.isFinite(lo) && Number.isFinite(hi) && Math.abs(lo + hi) <= 1e-9;
  }

  /** Clamp a value to the threshold slider's domain. */
  private clampToThresholdDomain(v: number): number {
    const { min, max } = sliderDomain(this.volumeRange ?? [0, 1]);
    return Math.max(min, Math.min(max, v));
  }

  private onThresholdLinkToggle() {
    this.thresholdLinked = !this.thresholdLinked;
  }

  render() {
    // The layer selector is only useful with more than one layer.
    const showLayerSelect = this.shows('layer') && this.availableLayers.length > 1;
    const showVisibility = this.shows('visibility');
    const showReset = this.visibleControls === null || this.visibleControls.length > 0;
    const domain = sliderDomain(this.volumeRange ?? [0, 1]);
    const alphaFrac = Number.isFinite(this.alpha) ? Math.max(0, Math.min(1, this.alpha)) : 1;
    return html`
      <div class="panel" part="panel">
        ${showLayerSelect || showVisibility ? html`
          <div class="section" part="section layer">
            <div class="header" part="header">
              ${showLayerSelect ? html`<span class="label" part="label">Layer</span>` : nothing}
              ${showVisibility ? html`
                <span class="visibility-toggle" part="toggle">
                  <input type="checkbox" id="visibility-check" ?checked=${this.visible} @change=${this.onVisibilityChange} />
                  <label for="visibility-check">Visible</label>
                </span>
              ` : nothing}
            </div>
            ${showLayerSelect ? html`
              <select class="native-select" part="select" aria-label="Select layer" @change=${this.onLayerChange}>
                ${this.availableLayers.map(layer => html`
                  <option value=${layer} ?selected=${layer === this.selectedLayerId}>${layer}</option>
                `)}
              </select>
            ` : nothing}
          </div>
        ` : nothing}

        ${this.shows('colormap') ? html`
          <div class="section" part="section colormap">
            <span class="label" part="label">Colormap</span>
            <div class="select-wrap">
              <select class="native-select" part="select" aria-label="Colormap" @change=${this.onColormapChange}>
                ${this.colormaps.map(colormap => html`
                  <option value=${colormap} ?selected=${colormap === this.selectedColormap}>${colormapDisplayName(colormap)}</option>
                `)}
              </select>
              <span class="swatch" part="swatch" aria-hidden="true"
                    style=${`background: linear-gradient(to right, ${this.getColormapGradient(this.selectedColormap)})`}></span>
            </div>
          </div>
        ` : nothing}

        ${this.shows('range') ? html`
          <div class="section" part="section range">
            <div class="header" part="header">
              <span class="label" part="label">Range</span>
              <span class="pair">
                <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
                       class="native-number" part="input" aria-label="Range low"
                       .value=${live(this.fmt(this.range[0]))} @change=${this.onRangeLowInput} />
                <span class="dash" aria-hidden="true">–</span>
                <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
                       class="native-number" part="input" aria-label="Range high"
                       .value=${live(this.fmt(this.range[1]))} @change=${this.onRangeHighInput} />
              </span>
            </div>
            ${this.volumeRange ? html`
              <range-slider
                part="slider"
                scale
                ?zero-tick=${domain.symmetric}
                .min=${domain.min}
                .max=${domain.max}
                .start=${[this.range[0], this.range[1]]}
                @range-update=${this.onRangeUpdate}
              ></range-slider>
            ` : html`<p class="caption" part="caption">Loading range data…</p>`}
          </div>
        ` : nothing}

        ${this.shows('threshold') ? html`
          <div class="section" part="section threshold">
            <div class="header" part="header">
              <span class="label" part="label">Threshold</span>
              <span class="pair">
                <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
                       class="native-number" part="input" aria-label="Threshold low"
                       .value=${live(this.fmt(this.threshold[0]))} @change=${this.onThresholdLowInput} />
                <button type="button" class="link-btn" part="link"
                        aria-label="Link symmetric" title="Link ± thresholds"
                        aria-pressed=${this.thresholdLinked ? 'true' : 'false'}
                        @click=${this.onThresholdLinkToggle}>
                  ${this.thresholdLinked
                    ? html`<svg class="chain linked" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"
                               fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 17H7A5 5 0 0 1 7 7h2"></path>
                        <path d="M15 7h2a5 5 0 0 1 0 10h-2"></path>
                        <path d="M8 12h8"></path>
                      </svg>`
                    : html`<svg class="chain broken" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"
                               fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 17H6.5A5 5 0 0 1 6.5 7H8"></path>
                        <path d="M16 7h1.5a5 5 0 0 1 0 10H16"></path>
                        <path d="M12 3.5v2M12 18.5v2"></path>
                      </svg>`}
                </button>
                <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
                       class="native-number" part="input" aria-label="Threshold high"
                       .value=${live(this.fmt(this.threshold[1]))} @change=${this.onThresholdHighInput} />
              </span>
            </div>
            ${this.volumeRange ? html`
              <range-slider
                part="slider"
                fill="outside"
                ?scale=${!this.shows('range')}
                ?zero-tick=${domain.symmetric}
                .min=${domain.min}
                .max=${domain.max}
                .start=${[this.threshold[0], this.threshold[1]]}
                @range-update=${this.onThresholdUpdate}
              ></range-slider>
            ` : html`<p class="caption" part="caption">Loading threshold data…</p>`}
            <p class="caption" part="caption">Values between low and high are hidden.</p>
          </div>
        ` : nothing}

        ${this.shows('opacity') ? html`
          <div class="section" part="section opacity">
            <div class="header" part="header">
              <span class="label" part="label">Opacity</span>
              <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
                     class="native-number narrow" part="input"
                     aria-label="Opacity value" .value=${live(this.fmt(this.alpha))} @change=${this.onAlphaInput} />
            </div>
            <input class="native-range" part="slider" type="range" min="0" max="1" step="0.01"
                   style=${`--frac: ${alphaFrac}`}
                   aria-label="Opacity" .value=${String(this.alpha)} @input=${this.onAlphaChange} />
          </div>
        ` : nothing}

        ${showReset ? html`
          <div class="footer" part="footer">
            <button class="reset-btn" part="reset" type="button" @click=${this.onReset}>
              <span aria-hidden="true">↺</span> Reset to defaults
            </button>
          </div>
        ` : nothing}
      </div>
    `;
  }

  private onLayerChange(e: Event) {
    this.selectLayer((e.target as HTMLSelectElement).value);
  }

  private onColormapChange(e: Event) {
    this.selectedColormap = (e.target as any).value;
    this.onColormapChanged();
    this.requestUpdate();
  }

  private onRangeUpdate(e: CustomEvent) {
    let low: number, high: number;

    if (e.detail.values && Array.isArray(e.detail.values)) {
      [low, high] = e.detail.values;
    } else if (e.detail.low !== undefined && e.detail.high !== undefined) {
      low = e.detail.low;
      high = e.detail.high;
    } else {
      return;
    }

    this.range = [low, high];
    if (this.volLayer) {
      this.volLayer.setRange(this.range);
      // Update all ImageLayers and force re-render
      this.updateAllImageLayers({ range: this.range });
      this.emitControlChange();
    }
    this.requestUpdate();
  }

  private onThresholdUpdate(e: CustomEvent) {
    let low: number, high: number;

    if (e.detail.values && Array.isArray(e.detail.values)) {
      [low, high] = e.detail.values;
    } else if (e.detail.low !== undefined && e.detail.high !== undefined) {
      low = e.detail.low;
      high = e.detail.high;
    } else {
      return;
    }

    if (this.thresholdLinked) {
      // Mirror the thumb that moved. Keep the pair ordered (low <= 0 <= high)
      // so the dual slider's own low <= high constraint is never violated.
      if (low !== this.threshold[0]) {
        low = Math.min(low, 0);
        high = this.clampToThresholdDomain(-low);
      } else if (high !== this.threshold[1]) {
        high = Math.max(high, 0);
        low = this.clampToThresholdDomain(-high);
      }
    }
    this.threshold = [low, high];
    this.applyThreshold();
  }

  private onAlphaChange(e: Event) {
    this.alpha = parseFloat((e.target as any).value);
    if (this.volLayer) {
      this.volLayer.setOpacity(this.alpha);
      // Update all ImageLayers and force re-render
      this.updateAllImageLayers({ alpha: this.alpha });
      this.emitControlChange();
    }
  }

  /** Format a numeric value for display in a numeric text field (U+2212 minus). */
  private fmt(v: number): string {
    return formatControlNumber(v);
  }

  /**
   * Parse a committed numeric field. Invalid text is rejected by re-rendering,
   * which (via the live() binding) restores the previous formatted value.
   */
  private readField(e: Event): number | undefined {
    const v = parseControlNumber((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) return v;
    this.requestUpdate();
    return undefined;
  }

  private applyRange() {
    if (this.volLayer) {
      this.volLayer.setRange(this.range);
      this.updateAllImageLayers({ range: this.range });
      this.emitControlChange();
    }
    this.requestUpdate();
  }

  private applyThreshold() {
    if (this.volLayer) {
      this.volLayer.setThreshold(this.threshold);
      this.updateAllImageLayers({ threshold: this.threshold });
      this.emitControlChange();
    }
    this.requestUpdate();
  }

  private onRangeLowInput(e: Event) {
    const v = this.readField(e);
    if (v === undefined) return;
    this.range = [v, this.range[1]];
    this.applyRange();
  }

  private onRangeHighInput(e: Event) {
    const v = this.readField(e);
    if (v === undefined) return;
    this.range = [this.range[0], v];
    this.applyRange();
  }

  private onThresholdLowInput(e: Event) {
    const v = this.readField(e);
    if (v === undefined) return;
    // Linked: the pair is ±|v|, so a positive entry in the low field can't
    // invert the threshold (low > high would hide nothing).
    const a = Math.abs(v);
    this.threshold = this.thresholdLinked ? [-a, this.clampToThresholdDomain(a)] : [v, this.threshold[1]];
    this.applyThreshold();
  }

  private onThresholdHighInput(e: Event) {
    const v = this.readField(e);
    if (v === undefined) return;
    const a = Math.abs(v);
    this.threshold = this.thresholdLinked ? [this.clampToThresholdDomain(-a), a] : [this.threshold[0], v];
    this.applyThreshold();
  }

  private onAlphaInput(e: Event) {
    let v = this.readField(e);
    if (v === undefined) return;
    v = Math.max(0, Math.min(1, v));
    this.alpha = v;
    if (this.volLayer) {
      this.volLayer.setOpacity(this.alpha);
      this.updateAllImageLayers({ alpha: this.alpha });
      this.emitControlChange();
    }
    this.requestUpdate();
  }

  private onReset() {
    this.resetToDefaults();
  }

  private onVisibilityChange(e: Event) {
    this.visible = (e.target as HTMLInputElement).checked;
    if (this.volLayer) {
      this.volLayer.setVisible(this.visible);
      // Update all ImageLayers and force re-render
      this.updateAllImageLayers({ visible: this.visible });
      this.emitControlChange();
    }
  }

  private getColormapGradient(colormapName: string): string {
    const colormap = this.volLayer?.colorMap.name === colormapName
      ? this.volLayer.colorMap
      : ColorMap.fromPreset(colormapName);
    const colors = colormap.getColorMap();
    const numStops = 10;

    const gradientColors = [];
    for (let i = 0; i < numStops; i++) {
      const color = colors[Math.floor((i / (numStops - 1)) * (colors.length - 1))];
      const [r, g, b] = color.slice(0, 3).map((v) => Math.round(v * 255));
      gradientColors.push(`rgb(${r},${g},${b})`);
    }

    return gradientColors.join(', ');
  }

  private onColormapChanged() {
    const cmap = ColorMap.fromPreset(this.selectedColormap);
    this.volLayer.setColormap(cmap);
    // Update all ImageLayers and force re-render
    this.updateAllImageLayers({ colormap: cmap });
    this.emitControlChange();
  }

  /**
   * Updates all ImageLayers (main + per-view) and forces re-render.
   * If viewer is set, uses viewer.applyToImageLayers() for comprehensive update.
   * Falls back to updating just the main imageLayer if no viewer is available.
   */
  private updateAllImageLayers(params: { range?: Range; threshold?: Threshold; alpha?: number; colormap?: ColorMap; visible?: boolean }) {
    const layerId = this.selectedLayerId;

    if (this._viewer && typeof this._viewer.updateLayer === 'function') {
      // SimpleOrthogonalViewer owns the public redraw/cache-invalidation path.
      this._viewer.updateLayer(layerId, params);
    } else if (this._viewer && typeof this._viewer.applyToImageLayers === 'function') {
      // Update all ImageLayers via the viewer
      this._viewer.applyToImageLayers((imgLayer: ImageLayer) => {
        imgLayer.updateLayer(layerId, params);
      });
      // Force re-render of all SliceViewers
      this.forceViewerRerender();
    } else if (this.imageLayer) {
      // Fallback: update just the main imageLayer
      this.imageLayer.updateLayer(layerId, params);
    }
  }

  /**
   * Forces all SliceViewers in the viewer to re-render their current slice.
   */
  private forceViewerRerender() {
    if (!this._viewer) return;

    const viewNames = ['axial', 'coronal', 'sagittal'];
    viewNames.forEach(viewName => {
      const sliceViewer = this._viewer.getSliceViewer?.(viewName);
      if (sliceViewer?.view?.renderSlice) {
        sliceViewer.view.renderSlice();
      }
    });
  }
}
