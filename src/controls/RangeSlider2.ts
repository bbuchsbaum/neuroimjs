import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Label for a decorative scale tick: U+2212 minus, integers when |v| >= 10,
 * otherwise one decimal; zero (including -0 and values rounding to it) is "0".
 */
export function formatScaleLabel(v: number): string {
  if (!Number.isFinite(v)) return '';
  const text = Math.abs(v) >= 10 ? String(Math.round(v)) : v.toFixed(1);
  if (/^-?0(\.0)?$/.test(text)) return '0';
  return text.replace('-', '\u2212');
}

function formatTooltip(v: number): string {
  const text = v.toFixed(2);
  return /^-0\.00$/.test(text) ? '0.00' : text.replace('-', '\u2212');
}

/** Which part of a dual slider is highlighted with the accent colour. */
export type RangeSliderFill = 'inside' | 'outside';

@customElement('range-slider')
export class RangeSlider extends LitElement {
  /**
   * Styling reads the layer-panel tokens (`--lcp-*`), which in turn default to
   * the neuromosaic report tokens (`--nm-*`), so the slider matches its host
   * without configuration. Parts: `track`, `fill`, `hatch`, `zero`, `tooltip`.
   *
   * Geometry: each thumb is a transparent square hit box (`--rs-hit`, 24px on
   * fine pointers, 44px on coarse) whose visible disc (`--rs-r` radius) is
   * painted with a radial gradient. The track is inset by the visible radius
   * on each side, so a thumb at min/max is flush with the column edge rather
   * than clipped. The native inputs are widened by (hit - 2r) and shifted so
   * their thumb centres travel exactly from `--rs-r` to `100% - --rs-r`; fills,
   * hatch, zero tick and scale labels all use that same x-scale.
   */
  static styles = css`
    :host {
      --rs-track: var(--lcp-rule-strong, var(--nm-rule-strong, #c9cfd2));
      --rs-fill: var(--lcp-accent, var(--nm-accent, #2f6f73));
      --rs-ring: var(--lcp-accent-soft, var(--nm-accent-soft, #e4efef));
      --rs-thumb: var(--lcp-thumb, var(--nm-surface, #ffffff));
      --rs-shadow-color: var(--lcp-shadow-color, rgba(28, 34, 38, 0.2));
      --rs-hatch: var(--lcp-hatch, #a9b1b6);
      --rs-track-edge: var(--lcp-track-edge, rgba(28, 34, 38, 0.18));
      /* Tick must read against the --rs-track fill, so it uses the hatch tone */
      --rs-zero: var(--lcp-hatch, #a9b1b6);
      --rs-scale: var(--lcp-muted, var(--nm-muted, #66717b));
      --rs-hatch-base: var(--rs-track);
      --rs-tip-bg: var(--lcp-ink, var(--nm-ink, #1c2226));
      --rs-tip-fg: var(--lcp-surface, var(--nm-surface, #ffffff));
      --rs-r: 8px;
      --rs-hit: 24px;
      --rs-half: calc(var(--rs-hit) / 2);
      --rs-lo: 0;
      --rs-hi: 1;

      display: block;
      width: 100%;
    }

    @media (pointer: coarse) {
      :host {
        --rs-r: 10px;
        --rs-hit: 44px;
      }
    }

    .rs {
      /* Thumb-centre positions (100% = width of the positioned element) */
      --rs-lo-pos: calc(var(--rs-r) + (100% - 2 * var(--rs-r)) * var(--rs-lo));
      --rs-hi-pos: calc(var(--rs-r) + (100% - 2 * var(--rs-r)) * var(--rs-hi));
      --rs-zero-pos: calc(var(--rs-r) + (100% - 2 * var(--rs-r)) * var(--rs-zf));
      --rs-span: calc((100% - 2 * var(--rs-r)) * (var(--rs-hi) - var(--rs-lo)));
    }

    .range-slider {
      position: relative;
      width: 100%;
      height: var(--rs-hit);
    }

    /* Decorative scale under the track: domain ends and, if shown, zero */
    .scale {
      position: relative;
      height: 13px;
      margin-top: -4px;
      font-size: 10px;
      line-height: 13px;
      font-variant-numeric: tabular-nums;
      color: var(--rs-scale);
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    }

    .scale span {
      position: absolute;
      top: 0;
    }

    /* End labels are anchored to the column edges (the thumb disc's outer
       edge at min/max); the zero label is centred under the tick. */
    .scale .min {
      left: 0;
    }

    .scale .max {
      right: 0;
    }

    .scale .zero {
      left: var(--rs-zero-pos);
      transform: translateX(-50%);
    }

    .range-track,
    .seg {
      position: absolute;
      top: 50%;
      height: 4px;
      border-radius: 2px;
      transform: translateY(-50%);
    }

    .range-track {
      left: var(--rs-r);
      right: var(--rs-r);
      background: var(--rs-track);
      box-shadow: inset 0 0 0 1px var(--rs-track-edge);
    }

    /* 1px zero reference tick (above track and fills, below thumbs) */
    .zero-tick {
      position: absolute;
      top: 50%;
      left: var(--rs-zero-pos);
      width: 1px;
      height: 8px;
      background: var(--rs-zero);
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 1;
    }

    .seg.fill {
      background: var(--rs-fill);
    }

    .seg.inner {
      left: var(--rs-lo-pos);
      width: var(--rs-span);
    }

    .seg.outer-lo {
      left: var(--rs-r);
      width: calc(var(--rs-lo-pos) - var(--rs-r));
    }

    .seg.outer-hi {
      left: var(--rs-hi-pos);
      right: var(--rs-r);
    }

    .seg.hatch {
      border-radius: 0;
      background:
        repeating-linear-gradient(135deg, var(--rs-hatch) 0 2px, transparent 2px 4px),
        var(--rs-hatch-base);
      box-shadow: inset 0 0 0 1px var(--rs-track-edge);
    }

    /* Two stacked native inputs; only their thumbs receive pointer events. */
    input[type='range'] {
      position: absolute;
      top: 50%;
      /* Widen/shift so thumb centres run from r to 100% - r */
      left: calc(var(--rs-r) - var(--rs-half));
      width: calc(100% - 2 * var(--rs-r) + var(--rs-hit));
      height: 0;
      margin: 0;
      padding: 0;
      background: none;
      pointer-events: none;
      -webkit-appearance: none;
      appearance: none;
      z-index: 2;
      transform: translateY(-50%);
      /* Visible disc: fill, 1.5px accent border, soft shadow edge */
      --rs-thumb-img: radial-gradient(
        circle,
        var(--rs-thumb) 0 calc(var(--rs-r) - 1.75px),
        var(--rs-fill) calc(var(--rs-r) - 1.25px) calc(var(--rs-r) - 0.25px),
        var(--rs-shadow-color) calc(var(--rs-r) + 0.25px),
        transparent calc(var(--rs-r) + 1.75px)
      );
      --rs-thumb-img-hover: radial-gradient(
        circle,
        var(--rs-thumb) 0 calc(var(--rs-r) - 1.75px),
        var(--rs-fill) calc(var(--rs-r) - 1.25px) calc(var(--rs-r) - 0.25px),
        var(--rs-ring) calc(var(--rs-r) + 0.25px) calc(var(--rs-r) + 4px),
        transparent calc(var(--rs-r) + 4.5px)
      );
      /* Focus: 2px accent ring offset 2px from the disc */
      --rs-thumb-img-focus: radial-gradient(
        circle,
        var(--rs-thumb) 0 calc(var(--rs-r) - 1.75px),
        var(--rs-fill) calc(var(--rs-r) - 1.25px) calc(var(--rs-r) - 0.25px),
        transparent calc(var(--rs-r) + 0.25px) calc(var(--rs-r) + 1.75px),
        var(--rs-fill) calc(var(--rs-r) + 2.25px) calc(var(--rs-r) + 3.75px),
        transparent calc(var(--rs-r) + 4.25px)
      );
    }

    input[type='range']:focus {
      outline: none;
    }

    input[type='range']::-webkit-slider-runnable-track {
      -webkit-appearance: none;
      height: 0;
      background: none;
    }

    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      pointer-events: all;
      position: relative;
      z-index: 3;
      width: var(--rs-hit);
      height: var(--rs-hit);
      margin-top: calc(var(--rs-hit) / -2);
      border: none;
      border-radius: 50%;
      background: var(--rs-thumb-img);
      cursor: pointer;
    }

    input[type='range']:hover::-webkit-slider-thumb,
    input[type='range']:active::-webkit-slider-thumb {
      background: var(--rs-thumb-img-hover);
    }

    input[type='range']:focus-visible::-webkit-slider-thumb {
      background: var(--rs-thumb-img-focus);
    }

    input[type='range']::-moz-range-track {
      height: 0;
      background: none;
    }

    input[type='range']::-moz-range-thumb {
      pointer-events: all;
      width: var(--rs-hit);
      height: var(--rs-hit);
      border: none;
      border-radius: 50%;
      background: var(--rs-thumb-img);
      cursor: pointer;
    }

    input[type='range']:hover::-moz-range-thumb,
    input[type='range']:active::-moz-range-thumb {
      background: var(--rs-thumb-img-hover);
    }

    input[type='range']:focus-visible::-moz-range-thumb {
      background: var(--rs-thumb-img-focus);
    }

    .tooltip {
      position: absolute;
      bottom: calc(50% + var(--rs-r) + 6px);
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--rs-tip-bg);
      color: var(--rs-tip-fg);
      font-size: 11px;
      line-height: 1.4;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      pointer-events: none;
      transform: translateX(-50%);
      opacity: 0;
      transition: opacity 120ms ease;
      z-index: 4;
    }

    .tooltip.lo {
      left: var(--rs-lo-pos);
    }

    .tooltip.hi {
      left: var(--rs-hi-pos);
    }

    input[type='range']:active + .tooltip,
    input[type='range']:focus-visible + .tooltip {
      opacity: 1;
    }
  `;

  /**
   * `inside` (default) highlights the band between the thumbs (a window);
   * `outside` highlights the two outer bands and hatches the inner band
   * (e.g. a threshold whose inner band is hidden).
   */
  @property({ type: String, reflect: true }) fill: RangeSliderFill = 'inside';

  /** Show a decorative scale (domain ends, and 0 with the zero tick) under the track. */
  @property({ type: Boolean, reflect: true }) scale = false;

  /** Draw a 1px tick at value 0 when 0 lies strictly inside [min, max]. */
  @property({ type: Boolean, reflect: true, attribute: 'zero-tick' }) zeroTick = false;

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

  /** Fraction of [min, max] at which a value sits, clamped to [0, 1]. */
  private frac(v: number): number {
    const span = this.max - this.min;
    if (!(span > 0) || !Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, (v - this.min) / span));
  }

  updated(changedProperties: Map<string, any>) {
    // Re-apply pending start if min/max changed (handles property order issues)
    if (changedProperties.has('min') || changedProperties.has('max')) {
      this.applyPendingStart();
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
    const outside = this.fill === 'outside';
    const showZero = this.zeroTick && this.min < 0 && this.max > 0;

    return html`
      <div class="rs" style="--rs-lo: ${this.frac(this.lowValue)}; --rs-hi: ${this.frac(this.highValue)}; --rs-zf: ${this.frac(0)}">
      <div class="range-slider">
        <div class="range-track" part="track"></div>
        ${outside
          ? html`
              <div class="seg fill outer-lo" part="fill"></div>
              <div class="seg hatch inner" part="hatch"></div>
              <div class="seg fill outer-hi" part="fill"></div>
            `
          : html`<div class="seg fill inner range-slider-progress" part="fill"></div>`}
        ${showZero ? html`<div class="zero-tick" part="zero"></div>` : nothing}
        <input
          type="range"
          .min="${this.min}"
          .max="${this.max}"
          .step="${effectiveStep}"
          .value="${this.lowValue}"
          @input="${this.handleLowChange}"
        />
        <div class="tooltip lo" part="tooltip" aria-hidden="true">${formatTooltip(this.lowValue)}</div>
        <input
          type="range"
          .min="${this.min}"
          .max="${this.max}"
          .step="${effectiveStep}"
          .value="${this.highValue}"
          @input="${this.handleHighChange}"
        />
        <div class="tooltip hi" part="tooltip" aria-hidden="true">${formatTooltip(this.highValue)}</div>
      </div>
      ${this.scale
        ? html`
            <div class="scale" part="scale" aria-hidden="true">
              <span class="min">${formatScaleLabel(this.min)}</span>
              ${showZero ? html`<span class="zero">${formatScaleLabel(0)}</span>` : nothing}
              <span class="max">${formatScaleLabel(this.max)}</span>
            </div>
          `
        : nothing}
      </div>
    `;
  }
}
