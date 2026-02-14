import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ImageLayer } from '../display/ImageLayer';
import { ColorMap } from '../display/ColorMap';
import { VolLayer } from '../display/VolLayer';
import { VolStack } from '../display/VolStack';
import { Range, Threshold } from '../types';  // Import the types

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/range/range.js';
import 'nouislider/dist/nouislider.css';
// Import our custom RangeSlider
import './RangeSlider2';

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

    :host([theme="dark"]) sl-select::part(listbox) {
      background: #2a2a2a;
    }

    :host([theme="dark"]) sl-option::part(base) {
      background: #2a2a2a;
      color: #b0a89e;
    }

    :host([theme="dark"]) sl-option::part(base):hover {
      background: #3a3a3a;
    }

    :host([theme="dark"]) sl-select::part(combobox),
    :host([theme="dark"]) sl-input::part(base) {
      color: #d0c8be;
    }

    :host([theme="dark"]) .threshold-caption {
      color: rgba(180, 170, 160, 0.6);
    }

    /* Scoped Shoelace design tokens */
    :host {
      --sl-color-primary-600: var(--accent-teal);
      --sl-color-primary-500: var(--accent-teal);
      --sl-input-border-color: var(--input-border);
      --sl-input-border-color-focus: var(--input-focus);
      --sl-input-background-color: var(--input-bg);
      --sl-focus-ring-color: rgba(26, 95, 90, 0.3);
      --sl-z-index-dropdown: 10000;
      --sl-panel-background-color: #ffffff;
      --sl-panel-border-color: var(--input-border);
    }

    sl-select, sl-input, sl-range {
      margin-bottom: 16px;
    }

    /* Alpha slider track styling */
    sl-range {
      --track-color-active: var(--accent-teal);
      --track-color-inactive: var(--input-border);
      --track-height: 6px;
      --thumb-size: 18px;
    }

    sl-range::part(base) {
      padding: 8px 0;
    }

    sl-range::part(input) {
      height: var(--track-height);
      background: var(--track-color-inactive);
      border-radius: 3px;
    }

    sl-range::part(input)::-webkit-slider-runnable-track {
      height: var(--track-height);
      background: var(--track-color-inactive);
      border-radius: 3px;
    }

    sl-range::part(input)::-moz-range-track {
      height: var(--track-height);
      background: var(--track-color-inactive);
      border-radius: 3px;
    }

    sl-range::part(input)::-webkit-slider-thumb {
      margin-top: calc((var(--track-height) - var(--thumb-size)) / 2);
    }

    sl-select {
      position: relative;
      z-index: 100;
    }

    sl-select[open] {
      z-index: 10000;
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

    sl-select::part(combobox),
    sl-input::part(base) {
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
    }

    sl-select::part(combobox):focus-within,
    sl-input::part(base):focus-within {
      border-color: var(--input-focus);
      box-shadow: 0 0 0 2px rgba(26, 95, 90, 0.15);
    }

    /* Dropdown menu styling - ensure opaque background */
    sl-select::part(listbox) {
      background: #ffffff;
      border: 1px solid var(--input-border);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
    }

    sl-select::part(popup) {
      z-index: 10000;
    }

    sl-option::part(base) {
      background: #ffffff;
      color: var(--label-color);
    }

    sl-option::part(base):hover {
      background: #f5f2ec;
    }

    sl-option[aria-selected="true"]::part(base) {
      background: var(--accent-teal);
      color: #ffffff;
    }

    .label {
      display: block;
      margin-bottom: 8px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
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

    .range-slider sl-range {
      flex-grow: 1;
      margin-right: 16px;
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
      margin-top: -8px;
      margin-bottom: 12px;
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
    this.colormaps = ColorMap.getAvailableMaps();
    this.range = this.volLayer.getRange();
    this.selectedColormap = this.volLayer.colorMap.name;
    this.alpha = this.volLayer.opacity;
    this.threshold = this.volLayer.getThreshold();
    this.visible = this.volLayer.visible;

    // Get the volume's actual data range for display
    this.volumeRange = this.volLayer.getVolumeRange();

    this.requestUpdate();
  }

  private initializeFromVolStack() {
    if (!this._volStack) return;

    this.volLayer = this._volStack.getLayer(0);
    this.availableLayers = this._volStack.getLayerIds();
    this.selectedLayerId = this.availableLayers[0];
    this.colormaps = ColorMap.getAvailableMaps();
    this.range = this.volLayer.getRange();
    this.selectedColormap = this.volLayer.colorMap.name;
    this.alpha = this.volLayer.opacity;
    this.threshold = this.volLayer.getThreshold();
    this.visible = this.volLayer.visible;
    this.volumeRange = this.volLayer.getVolumeRange();

    this.requestUpdate();
  }

  render() {
    return html`
      <div class="label">Select Layer:</div>
      <sl-select @sl-change=${this.onLayerChange} value=${this.selectedLayerId}>
        ${this.availableLayers.map(layer => html`
          <sl-option value=${layer}>${layer}</sl-option>
        `)}
      </sl-select>

      <div class="visibility-toggle">
        <input type="checkbox" id="visibility-check" ?checked=${this.visible} @change=${this.onVisibilityChange} />
        <label for="visibility-check">Visible</label>
      </div>

      <div class="label">Colormap:</div>
      <sl-select @sl-change=${this.onColormapChange} value=${this.selectedColormap}>
        ${this.colormaps.map(colormap => html`
          <sl-option value=${colormap}>${colormap}</sl-option>
        `)}
      </sl-select>

      <div class="colorbar" style=${`background: linear-gradient(to right, ${this.getColormapGradient(this.selectedColormap)})`}></div>

      <div class="label">Range:</div>
      <div class="range-slider-container">
        ${this.volumeRange ? html`
          <range-slider
            .min=${this.volumeRange[0]}
            .max=${this.volumeRange[1]} 
            .start=${[this.range[0], this.range[1]]}
            @range-update=${this.onRangeUpdate}
          ></range-slider>
        ` : html`
          <div>Loading range data...</div>
        `}
      </div>

      <div class="label">Threshold:</div>
      <div class="threshold-caption">Values outside [low, high] are visible; values between are transparent.</div>
      <div class="range-slider-container">
        ${this.volumeRange ? html`
          <range-slider
            .min=${this.volumeRange[0]}
            .max=${this.volumeRange[1]}
            .start=${[this.threshold[0], this.threshold[1]]}
            @range-update=${this.onThresholdUpdate}
          ></range-slider>
        ` : html`
          <div>Loading threshold data...</div>
        `}
      </div>

      <div class="label">Alpha:</div>
      <sl-range min="0" max="1" step="0.01" .value=${this.alpha} @sl-input=${this.onAlphaChange}></sl-range>
    `;
  }

 
  private onLayerChange(e: CustomEvent) {
    this.selectedLayerId = (e.target as any).value;
    // Resolve the VolStack from either the direct volStack property or the imageLayer
    const stack = this._volStack ?? this.imageLayer?.getVolStack();
    if (stack) {
      const selectedLayer = stack.getLayerById(this.selectedLayerId);
      if (selectedLayer) {
        this.volLayer = selectedLayer;
        this.range = selectedLayer.getRange();
        this.selectedColormap = selectedLayer.colorMap.name;
        this.alpha = selectedLayer.opacity;
        this.threshold = selectedLayer.getThreshold();
        this.volumeRange = selectedLayer.getVolumeRange();
        this.visible = selectedLayer.visible;
        this.requestUpdate();
      }
    }
  }

  private onColormapChange(e: CustomEvent) {
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
    }
    this.requestUpdate();
  }

  private onAlphaChange(e: CustomEvent) {
    this.alpha = parseFloat((e.target as any).value);
    if (this.volLayer) {
      this.volLayer.setOpacity(this.alpha);
      // Update all ImageLayers and force re-render
      this.updateAllImageLayers({ alpha: this.alpha });
    }
  }

  private onVisibilityChange(e: Event) {
    this.visible = (e.target as HTMLInputElement).checked;
    if (this.volLayer) {
      this.volLayer.setVisible(this.visible);
      // Update all ImageLayers and force re-render
      this.updateAllImageLayers({ visible: this.visible });
    }
  }

  private getColormapGradient(colormapName: string): string {
    const colormap = ColorMap.fromPreset(colormapName);
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
  }

  /**
   * Updates all ImageLayers (main + per-view) and forces re-render.
   * If viewer is set, uses viewer.applyToImageLayers() for comprehensive update.
   * Falls back to updating just the main imageLayer if no viewer is available.
   */
  private updateAllImageLayers(params: { range?: Range; threshold?: Threshold; alpha?: number; colormap?: ColorMap; visible?: boolean }) {
    const layerId = this.selectedLayerId;

    if (this._viewer && typeof this._viewer.applyToImageLayers === 'function') {
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
