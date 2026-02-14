import { LitElement, html, css } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import noUiSlider from 'nouislider';
import 'nouislider/dist/nouislider.css';

@customElement('range-slider')
export class RangeSlider extends LitElement {
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Array }) start = [20, 80];

  @query('#slider') sliderElement!: HTMLElement;

  static styles = css`
    :host {
      display: block;
      margin: 20px 0;
    }
    #slider {
      margin: 0 auto;
      width: 100%;
      height: 15px;
    }
  `;

  firstUpdated() {
    console.log('RangeSlider firstUpdated called');
    this.initializeSlider();
  }

  updated(changedProperties: Map<string, any>) {
    // If min or max changes after initial render, update the slider
    if (changedProperties.has('min') || changedProperties.has('max')) {
      console.log(`Range slider updated: min=${this.min}, max=${this.max}`);
      
      // Only update if slider already exists
      if (this.sliderElement && (this.sliderElement as any).noUiSlider) {
        console.log('Updating existing slider range');
        (this.sliderElement as any).noUiSlider.updateOptions({
          range: {
            'min': this.min,
            'max': this.max
          }
        }, true); // true = don't reset slider position
      } else {
        // Initialize if not yet created
        this.initializeSlider();
      }
    }
  }

  private initializeSlider() {
    // Avoid initializing multiple times
    if (this.sliderElement && !(this.sliderElement as any).noUiSlider) {
      console.log(`Initializing slider with min=${this.min}, max=${this.max}`);
      
      setTimeout(() => {
        noUiSlider.create(this.sliderElement, {
          start: this.start,
          connect: true,
          range: {
            'min': this.min,
            'max': this.max
          }
        });

        (this.sliderElement as any).noUiSlider.on('update', (values: string[]) => {
          this.dispatchEvent(new CustomEvent('range-update', {
            detail: { values: values.map(Number) },
            bubbles: true,
            composed: true
          }));
        });
      }, 0);
    }
  }

  render() {
    return html`<div id="slider"></div>`;
  }
}
