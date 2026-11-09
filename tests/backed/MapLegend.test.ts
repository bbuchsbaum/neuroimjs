import { describe, it, expect } from 'vitest';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';
import { MapLegend, histogramCounts, reportNumber, valueAt } from '../../src/controls/MapLegend';

const space = new NeuroSpace([4, 1, 1], [2, 2, 2], [0, 0, 0]);
const layer = () => new VolLayer('tmap', new FloatNeuroVol(space, Float32Array.of(0, 1.5, 4, 12)), ColorMapFactory.createHot({ range: [0, 9] }), [0, 9], [-20, 3.1]);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('MapLegend', () => {
  it('bins non-zero values over the display range; out-of-range values go to the end caps', () => {
    expect(Array.from(histogramCounts([0, 0.5, 1.5, 2.5, 9, 12, -1], 0, 3, 3))).toEqual([1, 1, 1]);
    expect(histogramCounts([9], 0, 9, 3)[2]).toBe(1);
  });

  it('writes numbers as neuromosaic reports do', () => {
    expect(reportNumber(-3.14159)).toBe('−3.14');
    expect(reportNumber(12)).toBe('12');
    expect(reportNumber(1234.5)).toBe('1235');
  });

  it('draws the key: threshold band, cut marks, ticks, and a cap where the data runs past the range', () => {
    const host = document.createElement('div');
    const l = layer();
    const legend = new MapLegend(host, l, { title: 'faces − houses (t)', stat: 't' });
    const bar = host.querySelector('.nij-legend-bar') as HTMLElement;
    expect(bar.dataset.thresholded).toBe('true');
    expect(bar.dataset.capHigh).toBe('true'); // 12 > 9
    expect(bar.dataset.capLow).toBe('false');
    expect(host.querySelectorAll('.nij-legend-cut')).toHaveLength(1); // only 3.1 is inside [0, 9]
    expect([...host.querySelectorAll('.nij-legend-tick')].map((t) => t.textContent)).toEqual(['0', '3.1', '9']);
    expect(bar.getAttribute('aria-label')).toBe('Values between −20 and 3.1 are not drawn.');
    expect(Array.from(legend.histogram()).reduce((a, b) => a + b, 0)).toBe(2); // 1.5 and 4; 12 is past the range
    legend.dispose();
  });

  it('follows the cursor and the layer', async () => {
    const host = document.createElement('div');
    const l = layer();
    const legend = new MapLegend(host, l, { stat: 't' });
    legend.setCursor([4, 0, 0]); // voxel 2: t = 4
    expect(host.querySelector('.nij-legend-readout')?.textContent).toBe('t = 4 at 4 0 0');
    expect((host.querySelector('.nij-legend-marker') as HTMLElement).style.left).toBe(`${(4 / 9) * 100}%`);
    legend.setCursor([2, 0, 0]); // t = 1.5, inside the hidden band
    expect(host.querySelector('.nij-legend-readout')?.textContent).toBe('t = 1.5 at 2 0 0 (hidden by the threshold)');
    legend.setCursor([6, 0, 0]); // t = 12, above the range
    expect((host.querySelector('.nij-legend-bar') as HTMLElement).dataset.clipped).toBe('high');
    expect(host.querySelector('.nij-legend-note')?.textContent).toMatch(/above the display range/);
    l.setThreshold([-20, 5]); // the sidebar moves the threshold
    await tick();
    expect([...host.querySelectorAll('.nij-legend-tick')].map((t) => t.textContent)).toEqual(['0', '5', '9']);
    expect(valueAt(l, [99, 0, 0])).toBeNull();
    legend.dispose();
  });

  it('fills a viewer’s legend cell and follows its cursor', () => {
    const cell = document.createElement('div');
    let listener: ((c: number[]) => void) | null = null;
    const viewer = { getLegendElement: () => cell, onCoordChange: (h: (c: number[]) => void) => { listener = h; return () => {}; }, getWorldCoord: () => [0, 0, 0] };
    const legend = MapLegend.attach(viewer, layer(), { stat: 't' })!;
    expect(cell.querySelector('.nij-legend')).not.toBeNull();
    listener!([4, 0, 0]);
    expect(cell.querySelector('.nij-legend-readout')?.textContent).toBe('t = 4 at 4 0 0');
    expect(MapLegend.attach({}, layer())).toBeNull();
    legend.dispose();
  });
});
