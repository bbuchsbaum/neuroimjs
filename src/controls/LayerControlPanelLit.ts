import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
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

@customElement('layer-control-panel')
export class LayerControlPanel extends LitElement {
  /**
   * Albers-inspired visual styling:
   * - Warm paper-like background with subtle gradient
   * - Ochre and deep teal as primary accents
   * - Small, uppercase labels with generous letter-spacing
   * - Minimal borders, flat planes
   * - System UI font stack for clarity
   */
  static styles = css`
    :host {
      --panel-bg-start: #faf8f5;
      --panel-bg-end: #f5f2ec;
      --label-color: #5a5248;
      --accent-ochre: #c9a227;
      --accent-teal: #1a5f5a;
      --border-subtle: rgba(90, 82, 72, 0.12);
      --input-bg: #ffffff;
      --input-border: rgba(90, 82, 72, 0.2);
      --input-focus: var(--accent-teal);

      display: block;
      width: 100%;
      padding: 20px;
      box-sizing: border-box;
      background: linear-gradient(180deg, var(--panel-bg-start) 0%, var(--panel-bg-end) 100%);
      color: var(--label-color);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
    }

    /* Dark theme overrides */
    :host([theme="dark"]) {
      --panel-bg-start: #1e1e1e;
      --panel-bg-end: #1a1a1a;
      --label-color: #b0a89e;
      --accent-teal: #4dada7;
      --border-subtle: rgba(180, 170, 160, 0.15);
      --input-bg: #2a2a2a;
      --input-border: rgba(180, 170, 160, 0.2);
      --input-focus: #4dada7;
    }

    :host([theme="dark"]) .threshold-caption {
      color: rgba(180, 170, 160, 0.6);
    }

    /* Native form controls (self-contained; no Shoelace dependency) */
    select.native-select {
      display: block;
      width: 100%;
      margin-bottom: 16px;
      padding: 7px 10px;
      font-family: inherit;
      font-size: 13px;
      color: var(--label-color);
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      cursor: pointer;
    }

    select.native-select:focus-visible {
      outline: none;
      border-color: var(--input-focus);
      box-shadow: 0 0 0 2px rgba(26, 95, 90, 0.15);
    }

    input.native-range {
      display: block;
      width: 100%;
      margin: 8px 0 16px;
      height: 6px;
      border-radius: 3px;
      background: var(--input-border);
      cursor: pointer;
      -webkit-appearance: none;
      appearance: none;
    }

    input.native-range:focus {
      outline: none;
    }

    input.native-range:focus-visible {
      box-shadow: 0 0 0 3px rgba(26, 95, 90, 0.25);
    }

    input.native-range::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--accent-teal);
      border: 2px solid #ffffff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      cursor: pointer;
    }

    input.native-range::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border: 2px solid #ffffff;
      border-radius: 50%;
      background: var(--accent-teal);
      cursor: pointer;
    }

    input.native-range::-moz-range-track {
      height: 6px;
      border-radius: 3px;
      background: var(--input-border);
    }

    /* Numeric entry boxes paired with sliders */
    input.native-number {
      width: 88px;
      padding: 6px 8px;
      font-family: inherit;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: var(--label-color);
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      box-sizing: border-box;
    }

    input.native-number:focus-visible {
      outline: none;
      border-color: var(--input-focus);
      box-shadow: 0 0 0 2px rgba(44, 111, 223, 0.18);
    }

    .value-inputs {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
      margin-bottom: 16px;
    }

    .alpha-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .alpha-row input.native-range {
      flex: 1 1 auto;
      margin: 0;
    }

    .alpha-row input.native-number {
      flex: 0 0 auto;
    }

    .reset-btn {
      width: 100%;
      margin-top: 4px;
      padding: 9px 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      color: var(--label-color);
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 6px;
      cursor: pointer;
    }

    .reset-btn:hover {
      border-color: var(--input-focus);
      color: var(--input-focus);
    }

    .reset-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px rgba(44, 111, 223, 0.18);
    }

    .visibility-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .visibility-toggle input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: var(--accent-teal);
      cursor: pointer;
    }

    .visibility-toggle label {
      font-size: 12px;
      color: var(--label-color);
      cursor: pointer;
    }

    .label {
      display: block;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: normal;
      color: var(--label-color);
    }

    .colorbar {
      height: 20px;
      width: 100%;
      margin-bottom: 16px;
      border-radius: 3px;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
    }

    .range-slider {
      display: flex;
      align-items: center;
      margin-bottom: 16px;
    }

    .range-slider span {
      min-width: 50px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    #range-slider {
      margin: 20px 0;
    }

    .range-values {
      display: flex;
      justify-content: space-between;
      margin-top: 10px;
      font-variant-numeric: tabular-nums;
    }

    range-slider {
      margin: 16px 0;
      width: 100%;
    }

    .range-slider-container {
      width: 100%;
      margin-bottom: 16px;
      position: relative;
      z-index: 1;
    }

    .threshold-caption {
      font-size: 11px;
      color: rgba(90, 82, 72, 0.7);
      margin-top: 0;
      margin-bottom: 16px;
      line-height: 1.4;
    }

    /* Section dividers */
    .section {
      padding-bottom: 16px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border-subtle);
    }

    .section:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
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
    return current;
  }

  render() {
    return html`
      ${this.shows('layer') ? html`
        <div class="label">Select layer</div>
        <select class="native-select" aria-label="Select layer" @change=${this.onLayerChange}>
          ${this.availableLayers.map(layer => html`
            <option value=${layer} ?selected=${layer === this.selectedLayerId}>${layer}</option>
          `)}
        </select>
      ` : null}

      ${this.shows('visibility') ? html`
        <div class="visibility-toggle">
          <input type="checkbox" id="visibility-check" ?checked=${this.visible} @change=${this.onVisibilityChange} />
          <label for="visibility-check">Visible</label>
        </div>
      ` : null}

      ${this.shows('colormap') ? html`
        <div class="label">Colormap</div>
        <select class="native-select" aria-label="Colormap" @change=${this.onColormapChange}>
          ${this.colormaps.map(colormap => html`
            <option value=${colormap} ?selected=${colormap === this.selectedColormap}>${colormap}</option>
          `)}
        </select>
        <div class="colorbar" style=${`background: linear-gradient(to right, ${this.getColormapGradient(this.selectedColormap)})`}></div>
      ` : null}

      ${this.shows('range') ? html`
        <div class="label">Range</div>
        <div class="range-slider-container">
          ${this.volumeRange ? html`
            <range-slider
              .min=${this.volumeRange[0]}
              .max=${this.volumeRange[1]}
              .start=${[this.range[0], this.range[1]]}
              @range-update=${this.onRangeUpdate}
            ></range-slider>
          ` : html`<div>Loading range data...</div>`}
        </div>
        <div class="value-inputs">
          <input type="number" class="native-number" aria-label="Range low"
                 .value=${this.fmt(this.range[0])} @change=${this.onRangeLowInput} />
          <input type="number" class="native-number" aria-label="Range high"
                 .value=${this.fmt(this.range[1])} @change=${this.onRangeHighInput} />
        </div>
      ` : null}

      ${this.shows('threshold') ? html`
        <div class="label">Threshold</div>
        <div class="range-slider-container">
          ${this.volumeRange ? html`
            <range-slider
              .min=${this.volumeRange[0]}
              .max=${this.volumeRange[1]}
              .start=${[this.threshold[0], this.threshold[1]]}
              @range-update=${this.onThresholdUpdate}
            ></range-slider>
          ` : html`<div>Loading threshold data...</div>`}
        </div>
        <div class="value-inputs">
          <input type="number" class="native-number" aria-label="Threshold low"
                 .value=${this.fmt(this.threshold[0])} @change=${this.onThresholdLowInput} />
          <input type="number" class="native-number" aria-label="Threshold high"
                 .value=${this.fmt(this.threshold[1])} @change=${this.onThresholdHighInput} />
        </div>
        <div class="threshold-caption">Values outside [low, high] are visible; values between are transparent.</div>
      ` : null}

      ${this.shows('opacity') ? html`
        <div class="label">Opacity</div>
        <div class="alpha-row">
          <input class="native-range" type="range" min="0" max="1" step="0.01"
                 aria-label="Opacity" .value=${String(this.alpha)} @input=${this.onAlphaChange} />
          <input type="number" class="native-number" min="0" max="1" step="0.01"
                 aria-label="Opacity value" .value=${this.alpha.toFixed(2)} @change=${this.onAlphaInput} />
        </div>
      ` : null}

      ${this.visibleControls === null || this.visibleControls.length > 0 ? html`
        <button class="reset-btn" type="button" @click=${this.onReset}>
          <span aria-hidden="true">↺</span> Reset to defaults
        </button>
      ` : null}
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

    this.threshold = [low, high];
    if (this.volLayer) {
      this.volLayer.setThreshold(this.threshold);
      // Update all ImageLayers and force re-render
      this.updateAllImageLayers({ threshold: this.threshold });
      this.emitControlChange();
    }
    this.requestUpdate();
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

  /** Format a numeric value for display in a number input. */
  private fmt(v: number): string {
    return Number.isFinite(v) ? v.toFixed(2) : '';
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
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    this.range = [v, this.range[1]];
    this.applyRange();
  }

  private onRangeHighInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    this.range = [this.range[0], v];
    this.applyRange();
  }

  private onThresholdLowInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    this.threshold = [v, this.threshold[1]];
    this.applyThreshold();
  }

  private onThresholdHighInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    this.threshold = [this.threshold[0], v];
    this.applyThreshold();
  }

  private onAlphaInput(e: Event) {
    let v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
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
