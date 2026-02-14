import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('range-slider')
export class RangeSlider extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }
    .range-slider {
      position: relative;
      width: 100%;
      height: 40px;
    }

    /* Track */
    .range-track {
      position: absolute;
      top: 50%;
      left: 0;
      width: 100%;
      height: 4px;
      background: #ddd;
      transform: translateY(-50%);
    }

    /* Progress */
    .range-slider-progress {
      position: absolute;
      top: 50%;
      height: 4px;
      background: #007bff;
      transform: translateY(-50%);
    }

    /* Range Inputs */
    input[type='range'] {
      position: absolute;
      top: 50%;
      left: 0;
      width: 100%;
      height: 0;
      margin: 0;
      background: none;
      pointer-events: none;
      -webkit-appearance: none;
      z-index: 2;
      transform: translateY(-50%);
    }

    /* Remove default appearance */
    input[type='range']::-webkit-slider-runnable-track {
      -webkit-appearance: none;
      height: 0;
    }

    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      pointer-events: all;
      position: relative;
      z-index: 3;
      width: 20px;
      height: 20px;
      background: #007bff;
      border-radius: 50%;
      cursor: pointer;
      margin-top: -8px; /* Half of the thumb height to center it */
    }

    input[type='range']::-moz-range-track {
      height: 0;
    }

    input[type='range']::-moz-range-thumb {
      pointer-events: all;
      width: 20px;
      height: 20px;
      background: #007bff;
      border-radius: 50%;
      cursor: pointer;
    }

    /* Hide focus outline */
    input[type='range']:focus {
      outline: none;
    }

    .tooltip {
      position: absolute;
      background-color: #333;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      top: -30px;
      transform: translateX(-50%);
      opacity: 0;
      transition: opacity 0.2s;
    }
    .tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      margin-left: -5px;
      border-width: 5px;
      border-style: solid;
      border-color: #333 transparent transparent transparent;
    }
    input[type='range']:hover + .tooltip,
    input[type='range']:active + .tooltip {
      opacity: 1;
    }
  `;

  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Number }) lowValue = 20;
  @property({ type: Number }) highValue = 80;
  @property({ type: Number }) step = 0.01;  // Fine-grained stepping for neuroimaging data

  private _pendingStart: [number, number] | undefined;

  /**
   * Alternative way to set initial values as an array [low, high].
   * If provided, overrides lowValue and highValue.
   */
  @property({ type: Array })
  set start(value: [number, number] | undefined) {
    this._pendingStart = value;
    this.applyPendingStart();
  }
  get start(): [number, number] {
    return [this.lowValue, this.highValue];
  }

  private applyPendingStart(): void {
    if (this._pendingStart && Array.isArray(this._pendingStart) && this._pendingStart.length === 2) {
      // Ensure values are within min/max bounds
      const [low, high] = this._pendingStart;
      this.lowValue = Math.max(this.min, Math.min(low, this.max));
      this.highValue = Math.max(this.min, Math.min(high, this.max));
      // Ensure low <= high
      if (this.lowValue > this.highValue) {
        [this.lowValue, this.highValue] = [this.highValue, this.lowValue];
      }
    }
  }

  @state() private lowTooltipPosition = '0%';
  @state() private highTooltipPosition = '100%';

  private updateProgress() {
    const progress = this.shadowRoot?.querySelector('.range-slider-progress') as HTMLElement;
    if (progress) {
      const lowPercent = ((this.lowValue - this.min) / (this.max - this.min)) * 100;
      const highPercent = ((this.highValue - this.min) / (this.max - this.min)) * 100;
      progress.style.left = `${lowPercent}%`;
      progress.style.width = `${highPercent - lowPercent}%`;
    }
  }

  private updateTooltipPositions() {
    const lowPercent = ((this.lowValue - this.min) / (this.max - this.min)) * 100;
    const highPercent = ((this.highValue - this.min) / (this.max - this.min)) * 100;
    this.lowTooltipPosition = `${lowPercent}%`;
    this.highTooltipPosition = `${highPercent}%`;
  }

  firstUpdated() {
    this.updateProgress();
    this.updateTooltipPositions();
  }

  updated(changedProperties: Map<string, any>) {
    // Re-apply pending start if min/max changed (handles property order issues)
    if (changedProperties.has('min') || changedProperties.has('max')) {
      this.applyPendingStart();
    }
    // Update visuals when any relevant property changes
    if (changedProperties.has('lowValue') ||
        changedProperties.has('highValue') ||
        changedProperties.has('min') ||
        changedProperties.has('max')) {
      this.updateProgress();
      this.updateTooltipPositions();
    }
  }

  private handleLowChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    // Constrain: low cannot exceed high - clamp and reset input if needed
    if (value > this.highValue) {
      this.lowValue = this.highValue;
      input.value = String(this.highValue);
    } else {
      this.lowValue = value;
    }
    this.dispatchEvent(
      new CustomEvent('range-update', {
        detail: { values: [this.lowValue, this.highValue] },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleHighChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    // Constrain: high cannot go below low - clamp and reset input if needed
    if (value < this.lowValue) {
      this.highValue = this.lowValue;
      input.value = String(this.lowValue);
    } else {
      this.highValue = value;
    }
    this.dispatchEvent(
      new CustomEvent('range-update', {
        detail: { values: [this.lowValue, this.highValue] },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    // Calculate appropriate step based on range magnitude
    const rangeSpan = this.max - this.min;
    const autoStep = rangeSpan > 0 ? rangeSpan / 1000 : this.step;
    const effectiveStep = this.step || autoStep;

    return html`
      <div class="range-slider">
        <div class="range-track"></div>
        <div class="range-slider-progress"></div>
        <input
          type="range"
          .min="${this.min}"
          .max="${this.max}"
          .step="${effectiveStep}"
          .value="${this.lowValue}"
          @input="${this.handleLowChange}"
        />
        <div class="tooltip" style="left: ${this.lowTooltipPosition}">${this.lowValue.toFixed(2)}</div>
        <input
          type="range"
          .min="${this.min}"
          .max="${this.max}"
          .step="${effectiveStep}"
          .value="${this.highValue}"
          @input="${this.handleHighChange}"
        />
        <div class="tooltip" style="left: ${this.highTooltipPosition}">${this.highValue.toFixed(2)}</div>
      </div>
    `;
  }
}
