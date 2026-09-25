/* eslint-disable @typescript-eslint/no-explicit-any -- the tests drive Lit internals and a duck-typed fake VolStack */
import { describe, it, expect, afterEach } from 'vitest';
import {
  colormapDisplayName,
  formatControlNumber,
  parseControlNumber,
  sliderDomain,
} from '../LayerControlPanelLit';
import { formatScaleLabel } from '../RangeSlider2';

function fakeStack(
  ids: string[],
  extent: [number, number] = [-6.52, 6.52],
  threshold: [number, number] = [-1, 1],
) {
  const mk = (id: string) => {
    let thr: [number, number] = [threshold[0], threshold[1]];
    return {
    id,
    getRange: () => [extent[0], extent[1]],
    getThreshold: () => [thr[0], thr[1]],
    opacity: 0.7,
    visible: true,
    colorMap: { name: 'Viridis', getColorMap: () => [[0, 0, 0, 1], [1, 1, 1, 1]] },
    getVolumeRange: () => [extent[0], extent[1]],
    setOpacity() { /* the fake layer only records thresholds */ },
    setRange() { /* the fake layer only records thresholds */ },
    setThreshold(t: [number, number]) {
      thr = [t[0], t[1]];
    },
    setColormap() { /* the fake layer only records thresholds */ },
    setVisible() { /* the fake layer only records thresholds */ },
    };
  };
  const layers = ids.map(mk);
  return {
    getLayer: (i: number) => layers[i],
    getLayerIds: () => ids,
    getLayerById: (id: string) => layers.find((l) => l.id === id),
  };
}

async function mountEl(
  ids: string[],
  extent?: [number, number],
  threshold?: [number, number],
): Promise<any> {
  const el: any = document.createElement('layer-control-panel');
  document.body.appendChild(el);
  el.volStack = fakeStack(ids, extent, threshold);
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

async function mount(ids: string[], extent?: [number, number]): Promise<ShadowRoot> {
  const el: any = document.createElement('layer-control-panel');
  document.body.appendChild(el);
  el.volStack = fakeStack(ids, extent);
  await el.updateComplete;
  await el.updateComplete;
  return el.shadowRoot as ShadowRoot;
}

describe('layer-control-panel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hides the layer selector when there is only one layer', async () => {
    const root = await mount(['a']);
    expect(root.querySelector('select[aria-label="Select layer"]')).toBeNull();
    expect(root.querySelector('#visibility-check')).not.toBeNull();
  });

  it('shows the layer selector when there are several layers', async () => {
    const root = await mount(['a', 'b']);
    expect(root.querySelectorAll('select[aria-label="Select layer"] option')).toHaveLength(2);
  });

  it('exposes the Opacity control under its renamed accessible names', async () => {
    const root = await mount(['a']);
    const slider = root.querySelector('input[aria-label="Opacity"]') as HTMLInputElement;
    const box = root.querySelector('input[aria-label="Opacity value"]') as HTMLInputElement;
    expect(slider.value).toBe('0.7');
    expect(box.value).toBe('0.70');
    expect(root.querySelector('[aria-label="Alpha"]')).toBeNull();
    expect(root.querySelector('[aria-label="Alpha value"]')).toBeNull();
  });

  it('keeps the existing accessible names and section order', async () => {
    const root = await mount(['a']);
    expect(root.querySelector('select[aria-label="Colormap"]')).not.toBeNull();
    for (const name of ['Range low', 'Range high', 'Threshold low', 'Threshold high']) {
      expect(root.querySelector(`input[aria-label="${name}"]`)).not.toBeNull();
    }
    expect((root.querySelector('input[aria-label="Range low"]') as HTMLInputElement).value).toBe('\u22126.52');
    expect((root.querySelector('input[aria-label="Threshold high"]') as HTMLInputElement).value).toBe('1.00');
    const labels = [...root.querySelectorAll('.label')].map((e) => e.textContent!.trim());
    expect(labels).toEqual(['Colormap', 'Range', 'Threshold', 'Opacity']);
    const reset = root.querySelector('button[part="reset"]') as HTMLButtonElement;
    expect(reset.textContent).toContain('Reset to defaults');
  });

  it('omits the layer row and Visible toggle for report-style visibleControls', async () => {
    const el: any = document.createElement('layer-control-panel');
    el.visibleControls = ['range', 'threshold', 'colormap', 'opacity'];
    document.body.appendChild(el);
    el.volStack = fakeStack(['a', 'b']);
    await el.updateComplete;
    await el.updateComplete;
    const root = el.shadowRoot as ShadowRoot;
    expect(root.querySelector('[part~="layer"]')).toBeNull();
    expect(root.querySelector('select[aria-label="Select layer"]')).toBeNull();
    expect(root.querySelector('#visibility-check')).toBeNull();
    expect(root.querySelector('input[aria-label="Opacity"]')).not.toBeNull();
    expect(root.querySelector('button[part="reset"]')).not.toBeNull();
  });

  it('places the numeric inputs in the header row and exposes parts', async () => {
    const root = await mount(['a']);
    const rangeLow = root.querySelector('input[aria-label="Range low"]')!;
    expect(rangeLow.closest('.header')).not.toBeNull();
    expect(root.querySelectorAll('range-slider[part="slider"]')).toHaveLength(2);
    for (const part of ['panel', 'swatch', 'footer', 'reset']) {
      expect(root.querySelector(`[part~="${part}"]`)).not.toBeNull();
    }
    expect(root.querySelectorAll('[part~="section"]').length).toBeGreaterThanOrEqual(5);
    expect(root.querySelectorAll('[part~="label"]').length).toBe(4);
  });

  it('highlights the outer bands of the Threshold slider and the inner band of Range', async () => {
    const root = await mount(['a']);
    const [range, threshold] = [...root.querySelectorAll('range-slider')] as any[];
    await range.updateComplete;
    await threshold.updateComplete;
    expect(range.getAttribute('fill') ?? 'inside').toBe('inside');
    expect(threshold.getAttribute('fill')).toBe('outside');
    const rr = range.shadowRoot as ShadowRoot;
    expect(rr.querySelectorAll('[part="fill"]')).toHaveLength(1);
    expect(rr.querySelector('.seg.fill.inner')).not.toBeNull();
    expect(rr.querySelector('[part="hatch"]')).toBeNull();
    const tr = threshold.shadowRoot as ShadowRoot;
    expect(tr.querySelectorAll('[part="fill"]')).toHaveLength(2);
    expect(tr.querySelector('.seg.fill.outer-lo')).not.toBeNull();
    expect(tr.querySelector('.seg.fill.outer-hi')).not.toBeNull();
    expect(tr.querySelector('.seg.hatch.inner[part="hatch"]')).not.toBeNull();
    // Thumb fractions drive the segment geometry: [-1, 1] on [-6.52, 6.52]
    const style = (tr.querySelector('.rs') as HTMLElement).getAttribute('style')!;
    const lo = Number(/--rs-lo:\s*([\d.]+)/.exec(style)![1]);
    const hi = Number(/--rs-hi:\s*([\d.]+)/.exec(style)![1]);
    expect(lo).toBeCloseTo((-1 + 6.52) / 13.04, 6);
    expect(hi).toBeCloseTo((1 + 6.52) / 13.04, 6);
  });

  it('uses a short threshold caption', async () => {
    const root = await mount(['a']);
    const captions = [...root.querySelectorAll('.caption')].map((e) => e.textContent!.trim());
    expect(captions).toContain('Values between low and high are hidden.');
  });

  it('shows friendly colormap text while keeping preset names as option values', async () => {
    const root = await mount(['a']);
    const options = [...root.querySelectorAll('select[aria-label="Colormap"] option')] as HTMLOptionElement[];
    const blueRed = options.find((o) => o.value === 'BlueRed');
    expect(blueRed).toBeDefined();
    expect(blueRed!.textContent!.trim()).toBe('Blue–white–red');
    const viridis = options.find((o) => o.value === 'Viridis')!;
    expect(viridis.textContent!.trim()).toBe('Viridis');
    expect(viridis.selected).toBe(true);
  });

  it('maps known presets and splits camelCase for others', () => {
    expect(colormapDisplayName('BlueRed')).toBe('Blue–white–red');
    expect(colormapDisplayName('RdBu')).toBe('Red–white–blue');
    expect(colormapDisplayName('Greys')).toBe('Grayscale');
    expect(colormapDisplayName('Grayscale')).toBe('Grayscale');
    expect(colormapDisplayName('Hot')).toBe('Hot');
    expect(colormapDisplayName('CoolWarm')).toBe('Cool Warm');
    expect(colormapDisplayName('YlOrRd')).toBe('Yl Or Rd');
    expect(colormapDisplayName('plasma')).toBe('plasma');
  });

  it('formats negatives with U+2212 and parses either minus sign', () => {
    expect(formatControlNumber(-3.1)).toBe('−3.10');
    expect(formatControlNumber(3.1)).toBe('3.10');
    expect(formatControlNumber(-0.001)).toBe('0.00');
    expect(formatControlNumber(Number.NaN)).toBe('');
    expect(parseControlNumber('-3.1')).toBe(-3.1);
    expect(parseControlNumber('−3.1')).toBe(-3.1);
    expect(parseControlNumber(' +2.5 ')).toBe(2.5);
    expect(parseControlNumber('1e−2')).toBe(0.01);
    expect(parseControlNumber('3abc')).toBeNaN();
    expect(parseControlNumber('')).toBeNaN();
    expect(parseControlNumber('-')).toBeNaN();
  });

  it('uses text inputs with decimal keypads for every numeric field', async () => {
    const root = await mount(['a']);
    for (const name of ['Range low', 'Range high', 'Threshold low', 'Threshold high', 'Opacity value']) {
      const input = root.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement;
      expect(input.type).toBe('text');
      expect(input.getAttribute('inputmode')).toBe('decimal');
    }
    expect((root.querySelector('input[aria-label="Threshold low"]') as HTMLInputElement).value).toBe('−1.00');
    expect((root.querySelector('input[aria-label="Opacity value"]') as HTMLInputElement).value).toBe('0.70');
  });

  it('commits hyphen or minus-sign input and rejects non-numeric text', async () => {
    const el: any = document.createElement('layer-control-panel');
    document.body.appendChild(el);
    el.volStack = fakeStack(['a']);
    await el.updateComplete;
    await el.updateComplete;
    const root = el.shadowRoot as ShadowRoot;
    const low = root.querySelector('input[aria-label="Threshold low"]') as HTMLInputElement;

    low.value = '-3.1';
    low.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(low.value).toBe('−3.10');

    low.value = '−2.5';
    low.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(low.value).toBe('−2.50');

    low.value = 'abc';
    low.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(low.value).toBe('−2.50');
  });

  it('makes the slider domain symmetric when the data extent spans zero', async () => {
    expect(sliderDomain([-2, 5])).toEqual({ min: -5, max: 5, symmetric: true });
    expect(sliderDomain([-6.52, 3])).toEqual({ min: -6.52, max: 6.52, symmetric: true });
    expect(sliderDomain([0, 5])).toEqual({ min: 0, max: 5, symmetric: false });
    expect(sliderDomain([1, 5])).toEqual({ min: 1, max: 5, symmetric: false });

    const root = await mount(['a'], [-2, 5]);
    for (const slider of [...root.querySelectorAll('range-slider')] as any[]) {
      await slider.updateComplete;
      expect(slider.min).toBe(-5);
      expect(slider.max).toBe(5);
      expect(slider.hasAttribute('zero-tick')).toBe(true);
      const sr = slider.shadowRoot as ShadowRoot;
      expect(sr.querySelector('.zero-tick[part="zero"]')).not.toBeNull();
      const style = (sr.querySelector('.rs') as HTMLElement).getAttribute('style')!;
      expect(Number(/--rs-zf:\s*([\d.]+)/.exec(style)![1])).toBeCloseTo(0.5, 9);
    }
  });

  it('omits the zero tick for one-signed data', async () => {
    const root = await mount(['a'], [0, 5]);
    for (const slider of [...root.querySelectorAll('range-slider')] as any[]) {
      await slider.updateComplete;
      expect(slider.min).toBe(0);
      expect(slider.max).toBe(5);
      expect(slider.hasAttribute('zero-tick')).toBe(false);
      expect((slider.shadowRoot as ShadowRoot).querySelector('.zero-tick')).toBeNull();
    }
  });

  it('previews the colormap as a swatch inside the select, not a strip', async () => {
    const root = await mount(['a']);
    expect(root.querySelector('.colorbar')).toBeNull();
    expect(root.querySelector('[part~="colorbar"]')).toBeNull();
    const swatch = root.querySelector('.select-wrap > .swatch[part="swatch"]') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.getAttribute('aria-hidden')).toBe('true');
    expect(swatch.getAttribute('style')).toContain('linear-gradient');
    expect(root.querySelector('.select-wrap > select[aria-label="Colormap"]')).not.toBeNull();
  });

  it('formats scale labels with U+2212, integers at |v| >= 10, one decimal below', () => {
    expect(formatScaleLabel(-8.4)).toBe('−8.4');
    expect(formatScaleLabel(8.4)).toBe('8.4');
    expect(formatScaleLabel(0)).toBe('0');
    expect(formatScaleLabel(-0)).toBe('0');
    expect(formatScaleLabel(-0.02)).toBe('0');
    expect(formatScaleLabel(12.6)).toBe('13');
    expect(formatScaleLabel(-10)).toBe('−10');
    expect(formatScaleLabel(6.52)).toBe('6.5');
    expect(formatScaleLabel(Number.NaN)).toBe('');
  });

  it('labels the domain ends and zero once, under the Range slider', async () => {
    const root = await mount(['a'], [-2, 8.4]);
    const [range, threshold] = [...root.querySelectorAll('range-slider')] as any[];
    await range.updateComplete;
    await threshold.updateComplete;
    // Both sliders share one domain, so the scale is printed once.
    expect(range.hasAttribute('scale')).toBe(true);
    expect(threshold.hasAttribute('scale')).toBe(false);
    const scale = (range.shadowRoot as ShadowRoot).querySelector('.scale[part="scale"]') as HTMLElement;
    expect(scale).not.toBeNull();
    expect(scale.getAttribute('aria-hidden')).toBe('true');
    const text = (sel: string) => scale.querySelector(sel)?.textContent?.trim();
    expect(text('.min')).toBe('−8.4');
    expect(text('.zero')).toBe('0');
    expect(text('.max')).toBe('8.4');
    expect((threshold.shadowRoot as ShadowRoot).querySelector('.scale')).toBeNull();
  });

  it('moves the scale to the Threshold slider when Range is not shown', async () => {
    const el: any = document.createElement('layer-control-panel');
    document.body.appendChild(el);
    el.visibleControls = ['threshold', 'colormap', 'opacity'];
    el.volStack = fakeStack(['a'], [-2, 8.4]);
    await el.updateComplete;
    await el.updateComplete;
    const sliders = [...(el.shadowRoot as ShadowRoot).querySelectorAll('range-slider')] as any[];
    expect(sliders).toHaveLength(1);
    await sliders[0].updateComplete;
    expect(sliders[0].hasAttribute('scale')).toBe(true);
    expect((sliders[0].shadowRoot as ShadowRoot).querySelector('.scale .max')!.textContent!.trim()).toBe('8.4');
  });

  it('omits the zero scale label for one-signed data', async () => {
    const root = await mount(['a'], [0, 25]);
    const range = root.querySelector('range-slider') as any;
    await range.updateComplete;
    const scale = (range.shadowRoot as ShadowRoot).querySelector('.scale')!;
    expect(scale.querySelector('.zero')).toBeNull();
    expect(scale.querySelector('.min')!.textContent!.trim()).toBe('0');
    expect(scale.querySelector('.max')!.textContent!.trim()).toBe('25');
  });

  it('renders no scale on a bare range-slider unless requested', async () => {
    const el: any = document.createElement('range-slider');
    el.min = -5;
    el.max = 5;
    document.body.appendChild(el);
    await el.updateComplete;
    expect((el.shadowRoot as ShadowRoot).querySelector('.scale')).toBeNull();
  });

  describe('symmetric threshold link', () => {
    const q = (el: any, sel: string) => (el.shadowRoot as ShadowRoot).querySelector(sel) as HTMLElement;
    const link = (el: any) => q(el, 'button[aria-label="Link symmetric"]') as HTMLButtonElement;

    it('is an accessible toggle that replaces the Threshold separator only', async () => {
      const el = await mountEl(['a']);
      const btn = link(el);
      expect(btn).not.toBeNull();
      expect(btn.getAttribute('title')).toBe('Link \u00b1 thresholds');
      expect(btn.getAttribute('part')).toBe('link');
      expect(btn.querySelector('svg')).not.toBeNull();
      expect(btn.closest('[part~="threshold"]')).not.toBeNull();
      expect(q(el, '[part~="threshold"] .dash')).toBeNull();
      expect(q(el, '[part~="range"] .dash')).not.toBeNull();
    });

    it('shows a linked chain when pressed and a broken chain when not', async () => {
      const el = await mountEl(['a']);
      expect(link(el).getAttribute('aria-pressed')).toBe('true');
      expect(link(el).querySelector('svg.chain.linked')).not.toBeNull();
      expect(link(el).querySelector('svg.chain.broken')).toBeNull();
      link(el).click();
      await el.updateComplete;
      expect(link(el).getAttribute('aria-pressed')).toBe('false');
      expect(link(el).querySelector('svg.chain.broken')).not.toBeNull();
      expect(link(el).querySelector('svg.chain.linked')).toBeNull();
    });

    it('uses the same three-slot pair structure in the Range and Threshold rows', async () => {
      const el = await mountEl(['a']);
      for (const [section, middle] of [['range', 'dash'], ['threshold', 'link-btn']]) {
        const pair = q(el, `[part~="${section}"] .header .pair`);
        const kids = [...pair.children];
        expect(kids).toHaveLength(3);
        expect(kids[0].matches('input.native-number')).toBe(true);
        expect(kids[1].classList.contains(middle)).toBe(true);
        expect(kids[2].matches('input.native-number')).toBe(true);
      }
    });

    it('defaults on for a symmetric threshold on signed data', async () => {
      const el = await mountEl(['a'], [-6.52, 6.52], [-1, 1]);
      expect(link(el).getAttribute('aria-pressed')).toBe('true');
    });

    it('defaults off for an asymmetric threshold', async () => {
      const el = await mountEl(['a'], [-6.52, 6.52], [-1, 2]);
      expect(link(el).getAttribute('aria-pressed')).toBe('false');
    });

    it('defaults off when the data do not span zero', async () => {
      const el = await mountEl(['a'], [0, 10], [0, 0]);
      expect(link(el).getAttribute('aria-pressed')).toBe('false');
    });

    it('mirrors a typed low value and emits a single change event', async () => {
      const el = await mountEl(['a']);
      const events: any[] = [];
      el.addEventListener('layer-control-change', (e: CustomEvent) => events.push(e.detail));
      const low = q(el, 'input[aria-label="Threshold low"]') as HTMLInputElement;
      low.value = '-4.25';
      low.dispatchEvent(new Event('change'));
      await el.updateComplete;
      expect(events).toHaveLength(1);
      expect(events[0].threshold).toEqual([-4.25, 4.25]);
      expect(el.getState().threshold).toEqual([-4.25, 4.25]);
      expect((q(el, 'input[aria-label="Threshold high"]') as HTMLInputElement).value).toBe('4.25');
    });

    it('never inverts a linked threshold when a positive value is typed as low', async () => {
      const el = await mountEl(['a']);
      const low = q(el, 'input[aria-label="Threshold low"]') as HTMLInputElement;
      low.value = '3';
      low.dispatchEvent(new Event('change'));
      await el.updateComplete;
      expect(el.getState().threshold).toEqual([-3, 3]);
      const high = q(el, 'input[aria-label="Threshold high"]') as HTMLInputElement;
      high.value = '-2';
      high.dispatchEvent(new Event('change'));
      await el.updateComplete;
      expect(el.getState().threshold).toEqual([-2, 2]);
    });

    it('keeps the e2e sequence low=-4.25 then high=4.25 at [-4.25, 4.25]', async () => {
      for (const initial of [[-1, 1], [-1, 2]] as [number, number][]) {
        const el = await mountEl(['a'], [-6.52, 6.52], initial);
        const low = q(el, 'input[aria-label="Threshold low"]') as HTMLInputElement;
        const high = q(el, 'input[aria-label="Threshold high"]') as HTMLInputElement;
        low.value = '-4.25';
        low.dispatchEvent(new Event('change'));
        await el.updateComplete;
        high.value = '4.25';
        high.dispatchEvent(new Event('change'));
        await el.updateComplete;
        expect(el.getState().threshold).toEqual([-4.25, 4.25]);
      }
    });

    it('clamps the mirrored end to the slider domain', async () => {
      const el = await mountEl(['a'], [-2, 5], [-1, 1]);
      const high = q(el, 'input[aria-label="Threshold high"]') as HTMLInputElement;
      high.value = '9';
      high.dispatchEvent(new Event('change'));
      await el.updateComplete;
      // Domain is symmetric +-5, so the mirrored low clamps to -5.
      expect(el.getState().threshold).toEqual([-5, 9]);
    });

    it('mirrors a dragged thumb through the slider event', async () => {
      const el = await mountEl(['a']);
      const events: any[] = [];
      el.addEventListener('layer-control-change', (e: CustomEvent) => events.push(e.detail));
      const slider = q(el, 'range-slider[fill="outside"]');
      slider.dispatchEvent(new CustomEvent('range-update', { detail: { values: [-1, 3] } }));
      await el.updateComplete;
      expect(events).toHaveLength(1);
      expect(el.getState().threshold).toEqual([-3, 3]);
    });

    it('toggling changes no values and emits nothing; off leaves the other end alone', async () => {
      const el = await mountEl(['a']);
      const events: any[] = [];
      el.addEventListener('layer-control-change', (e: CustomEvent) => events.push(e.detail));
      link(el).click();
      await el.updateComplete;
      expect(link(el).getAttribute('aria-pressed')).toBe('false');
      expect(events).toHaveLength(0);
      expect(el.getState().threshold).toEqual([-1, 1]);

      const low = q(el, 'input[aria-label="Threshold low"]') as HTMLInputElement;
      low.value = '-4.25';
      low.dispatchEvent(new Event('change'));
      await el.updateComplete;
      expect(events).toHaveLength(1);
      expect(el.getState().threshold).toEqual([-4.25, 1]);
    });

    it('is unaffected by hiding the Range control', async () => {
      const el: any = document.createElement('layer-control-panel');
      el.visibleControls = ['threshold', 'colormap', 'opacity'];
      document.body.appendChild(el);
      el.volStack = fakeStack(['a']);
      await el.updateComplete;
      await el.updateComplete;
      expect(q(el, '[part~="range"]')).toBeNull();
      expect(link(el).getAttribute('aria-pressed')).toBe('true');
    });
  });
});
