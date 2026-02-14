import { describe, test, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

// Mock PIXI.js before any imports that rely on it
vi.mock('pixi.js', () => createPixiMock());

import { OrthogonalImageViewer } from '../../src/display/OrthogonalImageViewer';
import { SimpleOrthogonalViewer } from '../../src/display/SimpleOrthogonalViewer';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';

/**
 * Regression harness for the downstream bug where per-view ImageLayers
 * keep rendering only the reference layer even after a second VolLayer
 * is pushed into the shared VolStack.
 */
describe('Layer propagation to per-view ImageLayers', () => {
  let container: HTMLElement;
  let neuroSpace: NeuroSpace;
  let volStack: VolStack;
  let imageLayer: ImageLayer;
  let viewer: OrthogonalImageViewer;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    document.body.appendChild(container);

    neuroSpace = new NeuroSpace(
      [8, 8, 8],
      [1, 1, 1],
      [0, 0, 0],
      new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      )
    );

    const baseVol = new FloatNeuroVol(neuroSpace, new Float32Array(8 * 8 * 8));
    const baseLayer = new VolLayer(
      'base',
      baseVol,
      ColorMapFactory.createGrayscale({ range: [0, 1] })
    );

    volStack = new VolStack(baseLayer);
    imageLayer = new ImageLayer(volStack);
  });

  afterEach(() => {
    viewer?.dispose();
    document.body.removeChild(container);
  });

  test('OrthogonalImageViewer: new VolLayer becomes visible in every view after add', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer,
      options: { showCrosshair: false, showSlider: false }
    });

    const overlayVol = new FloatNeuroVol(neuroSpace, new Float32Array(8 * 8 * 8).fill(1));
    const overlayLayer = new VolLayer(
      'overlay',
      overlayVol,
      ColorMapFactory.createHot({ range: [0, 1] }),
      [0, 1],
      [0, 0],
      0.7
    );

    // Add new layer after viewer init (mirrors downstream usage)
    viewer.getImageLayer().addVolLayer(overlayLayer);
    expect(viewer.getImageLayer().getVolStack().length).toBe(2);

    // Force re-render and verify both layers are drawn in each view
    (['axial', 'coronal', 'sagittal'] as const).forEach(viewName => {
      const sv = viewer.getSliceViewer(viewName);
      sv.view.renderSlice();
      const imageContainer = sv.view.mainContainer.children[0];
      expect(imageContainer.children.length).toBe(2);
    });
  });

  test('SimpleOrthogonalViewer: addLayer propagates to per-view image layers', async () => {
    const simpleViewer = await SimpleOrthogonalViewer.create(container, volStack, {
      layout: 'left-tall',
      showCrosshair: false,
      showSlider: false,
    });

    const overlayVol = new FloatNeuroVol(neuroSpace, new Float32Array(8 * 8 * 8).fill(2));
    const overlayLayer = new VolLayer(
      'overlay-2',
      overlayVol,
      ColorMapFactory.createHot({ range: [0, 2] }),
      [0, 2],
      [0, 0],
      0.5
    );

    simpleViewer.addLayer(overlayLayer);
    expect(simpleViewer.listLayers().length).toBe(2);

    // Reach into the underlying viewer to verify rendered sprites
    const internalViewer = (simpleViewer as any).viewer as OrthogonalImageViewer;
    (['axial', 'coronal', 'sagittal'] as const).forEach(viewName => {
      const sv = internalViewer.getSliceViewer(viewName);
      sv.view.renderSlice();
      const imageContainer = sv.view.mainContainer.children[0];
      expect(imageContainer.children.length).toBe(2);
    });

    simpleViewer.dispose();
  });
});
