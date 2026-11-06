import { describe, test, expect, beforeAll, vi } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import { SimpleOrthogonalViewer } from '../../src/display/SimpleOrthogonalViewer';
import { SliceView } from '../../src/display/SliceView';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';

/**
 * A threshold slider calls updateLayer on every input event. The main and
 * per-view ImageLayers share one VolLayer, so the update used to be applied
 * four times, each re-colouring every view, and each view rendered from two
 * autoruns: 12 slice re-colourings and 27 renders per tick instead of 3 and 6.
 */
describe('threshold update cost in SimpleOrthogonalViewer', () => {
  beforeAll(() => setupConsoleMocks());

  test('re-colours each view once and re-renders each view at most twice', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const space = new NeuroSpace([6, 6, 6], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
    const base = new VolLayer('base', new FloatNeuroVol(space, new Float32Array(216).fill(0.5)),
      ColorMapFactory.createGrayscale({ range: [0, 1] }));
    const overlayVol = new FloatNeuroVol(space, new Float32Array(216).map((_, i) => (i % 11) - 5));
    const overlay = new VolLayer('ov', overlayVol, ColorMapFactory.createHot({ range: [-5, 5] }), [-5, 5], [-2, 2]);
    const viewer = await SimpleOrthogonalViewer.create(container, new VolStack(base),
      { showCrosshair: false, showSlider: false });
    viewer.addLayer(overlay);

    const renderSpy = vi.spyOn(SliceView.prototype, 'renderSlice');
    const sliceSpy = vi.spyOn(overlayVol, 'getSlice');
    try {
      viewer.updateLayer('ov', { threshold: [-3, 3] });
      expect(overlay.getThreshold()).toEqual([-3, 3]);
      expect(sliceSpy).toHaveBeenCalledTimes(3);
      expect(renderSpy.mock.calls.length).toBeLessThanOrEqual(6);
    } finally {
      renderSpy.mockRestore();
      sliceSpy.mockRestore();
      viewer.dispose();
      container.remove();
    }
  });

  test('setting the current threshold or range again does not invalidate the layer', () => {
    const space = new NeuroSpace([2, 2, 2], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
    const layer = new VolLayer('l', new FloatNeuroVol(space, new Float32Array(8)),
      ColorMapFactory.createHot({ range: [0, 1] }), [0, 1], [-1, 1]);
    const version = layer.version;
    layer.setThreshold([-1, 1]);
    layer.setRange([0, 1]);
    layer.setOpacity(layer.opacity);
    expect(layer.version).toBe(version);
    layer.setThreshold([-2, 2]);
    expect(layer.version).toBe(version + 1);
  });
});
