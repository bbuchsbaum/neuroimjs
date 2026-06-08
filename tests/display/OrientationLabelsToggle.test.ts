import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

// Use the richer PIXI mock (matches the other display tests).
import { vi } from 'vitest';
vi.mock('pixi.js', () => createPixiMock());

import { SliceViewer } from '../../src/display/SliceViewer';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';

describe('Orientation labels toggle (SliceViewer → SliceView)', () => {
  let container: HTMLElement;
  let imageLayer: ImageLayer;
  let viewer: SliceViewer;

  beforeAll(() => setupConsoleMocks());

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '400px';
    document.body.appendChild(container);

    const neuroSpace = new NeuroSpace(
      [32, 32, 32],
      [2, 2, 2],
      [0, 0, 0],
      new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
    );
    const data = new Float32Array(32 * 32 * 32);
    for (let i = 0; i < data.length; i++) data[i] = i % 97;
    const vol = new FloatNeuroVol(neuroSpace, data);
    const colorMap = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    const volLayer = new VolLayer('test-layer', vol, colorMap, [0, 96]);
    imageLayer = new ImageLayer(new VolStack(volLayer));
  });

  afterEach(() => {
    if (viewer) viewer.dispose();
    document.body.removeChild(container);
  });

  const screenSpaceLayers = (v: SliceViewer) =>
    (v.view as any).layers.filter((l: any) => l.screenSpace === true);

  test('setOrientationLabelsVisible(true) adds a screen-space layer routed to the overlay container', async () => {
    viewer = await SliceViewer.create(container, imageLayer, AxisSet3D.AXIAL_LPI);

    expect(screenSpaceLayers(viewer).length).toBe(0);
    expect((viewer.view as any).overlayContainer.children.length).toBe(0);

    viewer.setOrientationLabelsVisible(true);

    // Exactly one screen-space layer is registered...
    expect(screenSpaceLayers(viewer).length).toBe(1);
    // ...and its content was routed to the unscaled overlay container, not the
    // scaled image container.
    expect((viewer.view as any).overlayContainer.children.length).toBeGreaterThan(0);
  });

  test('setOrientationLabelsVisible(false) removes the layer and clears the overlay', async () => {
    viewer = await SliceViewer.create(container, imageLayer, AxisSet3D.AXIAL_LPI);
    viewer.setOrientationLabelsVisible(true);
    expect(screenSpaceLayers(viewer).length).toBe(1);

    viewer.setOrientationLabelsVisible(false);

    expect(screenSpaceLayers(viewer).length).toBe(0);
    expect((viewer.view as any).overlayContainer.children.length).toBe(0);
  });

  test('toggling on twice does not stack duplicate layers', async () => {
    viewer = await SliceViewer.create(container, imageLayer, AxisSet3D.AXIAL_LPI);
    viewer.setOrientationLabelsVisible(true);
    viewer.setOrientationLabelsVisible(true);
    expect(screenSpaceLayers(viewer).length).toBe(1);
  });
});
