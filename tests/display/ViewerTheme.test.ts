import { describe, test, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import * as PIXI from 'pixi.js';
import { CrossHair } from '../../src/display/CrossHair';
import { OrientationLabelLayer } from '../../src/display/OrientationLabelLayer';
import { CoordinateTransformer } from '../../src/display/CoordinateTransformer';
import { OrthogonalImageViewer } from '../../src/display/OrthogonalImageViewer';
import { SimpleOrthogonalViewer } from '../../src/display/SimpleOrthogonalViewer';
import { SliceView } from '../../src/display/SliceView';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';
import type { ViewerTheme } from '../../src/display/ViewerTheme';
import type { ScreenLayoutContext } from '../../src/display/SliceLayer';

const VIEWS = ['axial', 'coronal', 'sagittal'] as const;

const LIGHT: ViewerTheme = {
  backgroundColor: 0xfafaf7,
  crosshair: { crossColor: 0x1c2226, crossAlpha: 0.55, haloColor: 0xffffff, haloAlpha: 0.6 },
  orientationLabels: { color: 0x3e4952, alpha: 0.9, shadowAlpha: 0 },
};

function makeSpace(): NeuroSpace {
  return new NeuroSpace(
    [12, 12, 12],
    [1, 1, 1],
    [0, 0, 0],
    new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
  );
}

function makeStack(): VolStack {
  const space = makeSpace();
  const vol = new FloatNeuroVol(space, new Float32Array(12 * 12 * 12).fill(1));
  return new VolStack(new VolLayer('anat', vol, new ColorMap([[0, 0, 0], [1, 1, 1]]), [0, 1]));
}

const layoutCtx: ScreenLayoutContext = {
  width: 100,
  height: 100,
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  project: (x: number, y: number) => ({ x: x * 8, y: 100 - y * 8 }),
};

interface StrokeSpy {
  stroke: { mock: { calls: Array<[{ color: number; alpha: number; width: number }]> } };
}

describe('CrossHair.setStyle', () => {
  test('restyles in place and redraws with the new colours', () => {
    const space = makeSpace();
    const axes = AxisSet3D.AXIAL_LPI;
    const cross = new CrossHair(space, axes, new CoordinateTransformer(space, axes), {
      crossColor: 0xffffff,
      crossAlpha: 0.5,
      haloAlpha: 0.3,
    });
    cross.setPosition(space.gridToCoord([6, 6, 6]));
    cross.renderSlice(6, [], axes, new PIXI.Container());
    cross.layoutScreen(layoutCtx);

    const g = (cross as unknown as { graphics: StrokeSpy }).graphics;
    g.stroke.mock.calls.length = 0;

    cross.setStyle({ crossColor: 0x1c2226, haloColor: 0xffffff, haloAlpha: 0.6 });

    const strokes = g.stroke.mock.calls.map(c => c[0]);
    expect(strokes).toContainEqual(expect.objectContaining({ color: 0x1c2226, alpha: 0.5 }));
    expect(strokes).toContainEqual(expect.objectContaining({ color: 0xffffff, alpha: 0.6 }));
    expect(cross.getStyle()).toMatchObject({
      crossColor: 0x1c2226,
      crossAlpha: 0.5, // untouched fields keep their value
      haloColor: 0xffffff,
      haloAlpha: 0.6,
    });
  });
});

describe('OrientationLabelLayer.setStyle', () => {
  test('restyles the existing Text objects instead of rebuilding them', () => {
    const space = makeSpace();
    const layer = new OrientationLabelLayer(space, { color: 0xffffff, strokeWidth: 3, shadowAlpha: 0.9 });
    const container = layer.renderSlice(0, [0, 0, 0], AxisSet3D.AXIAL_LPI, new PIXI.Container())!;
    const before = [...container.children];
    expect(before).toHaveLength(4);

    layer.setStyle({ color: 0x3e4952, alpha: 0.9, strokeWidth: 0, shadowAlpha: 0 });

    expect(container.children).toEqual(before);
    for (const label of container.children as unknown as Array<{ style: Record<string, unknown>; alpha: number }>) {
      expect(label.style.fill).toBe(0x3e4952);
      expect(label.style.stroke).toBeUndefined();
      expect(label.style.dropShadow).toBeUndefined();
      expect(label.alpha).toBe(0.9);
    }
    expect(layer.getStyle()).toMatchObject({ color: 0x3e4952, fontSize: 16, strokeWidth: 0 });
  });

  test('labels built after setStyle use the new styling', () => {
    const layer = new OrientationLabelLayer(makeSpace());
    layer.setStyle({ color: 0x123456 });
    const container = layer.renderSlice(0, [0, 0, 0], AxisSet3D.AXIAL_LPI, new PIXI.Container())!;
    for (const label of container.children as unknown as Array<{ style: Record<string, unknown> }>) {
      expect(label.style.fill).toBe(0x123456);
    }
  });
});

describe('SliceView.setBackground', () => {
  test('uses the renderer background system when present (PIXI v8)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const space = makeSpace();
    const imageLayer = new ImageLayer(makeStack());
    imageLayer.initialize();
    const axes = AxisSet3D.AXIAL_LPI;
    const { SliceModel } = await import('../../src/display/SliceModel');
    const view = await SliceView.create(
      container, imageLayer, space, axes,
      new SliceModel(12, space.gridToCoord([6, 6, 6]), space, axes),
      { backgroundColor: 0x111619 }
    );
    const renderer = view.app.renderer as unknown as {
      background: { color: unknown; alpha: number };
      render: { mock: { calls: unknown[] } };
    };
    renderer.background = { color: 0x111619, alpha: 1 };
    const renders = renderer.render.mock.calls.length;

    view.setBackground(0xfafaf7, 0.5);

    expect(renderer.background.color).toBe(0xfafaf7);
    expect(renderer.background.alpha).toBe(0.5);
    expect(renderer.render.mock.calls.length).toBeGreaterThan(renders);
    expect(view.getBackground()).toEqual({ color: 0xfafaf7, alpha: 0.5 });

    view.dispose();
    expect(() => view.setBackground(0)).not.toThrow();
    container.remove();
  });
});

describe('OrthogonalImageViewer.setTheme', () => {
  let container: HTMLElement;
  let viewer: OrthogonalImageViewer;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer: new ImageLayer(makeStack()),
      options: {
        showCrosshair: true,
        showOrientationLabels: true,
        backgroundColor: 0x111619,
        crosshairOptions: { crossColor: 0xffffff, crossAlpha: 0.58, crossThickness: 1, crosshairGap: 22 },
        orientationLabelOptions: { color: 0xe6eaec, alpha: 0.6, fontSize: 11 },
      },
    });
  });

  afterEach(() => {
    viewer.dispose();
    container.remove();
  });

  const parts = () => VIEWS.map(v => {
    const sliceViewer = viewer.getSliceViewer(v);
    const view = sliceViewer.view as SliceView;
    return {
      sliceViewer,
      view,
      canvas: view.getCanvas(),
      cross: view.getLayer('crosshair') as CrossHair,
      labels: view.getLayer('orientation-labels') as OrientationLabelLayer,
      renderer: view.app.renderer as unknown as { backgroundColor: number },
    };
  });

  test('switches ground without rebuilding views, canvases or overlays', () => {
    const before = parts();
    before.forEach(p => {
      expect(p.cross).toBeInstanceOf(CrossHair);
      expect(p.labels).toBeInstanceOf(OrientationLabelLayer);
    });

    viewer.setTheme(LIGHT);

    const after = parts();
    after.forEach((p, i) => {
      expect(p.sliceViewer).toBe(before[i].sliceViewer);
      expect(p.canvas).toBe(before[i].canvas);
      expect(p.cross).toBe(before[i].cross);
      expect(p.labels).toBe(before[i].labels);
      expect(container.contains(p.canvas)).toBe(true);

      expect(p.renderer.backgroundColor).toBe(0xfafaf7);
      expect(p.view.getBackground().color).toBe(0xfafaf7);
      expect(p.cross.getStyle()).toMatchObject({
        crossColor: 0x1c2226, crossAlpha: 0.55, haloColor: 0xffffff, haloAlpha: 0.6,
        crossThickness: 1, crosshairGap: 22, // kept from construction
      });
      expect(p.labels.getStyle()).toMatchObject({ color: 0x3e4952, alpha: 0.9, shadowAlpha: 0, fontSize: 11 });
    });
  });

  test('a partial theme leaves the other settings alone', () => {
    viewer.setTheme({ crosshair: { crossColor: 0xff0000 } });
    parts().forEach(p => {
      expect(p.cross.getStyle()).toMatchObject({ crossColor: 0xff0000, crossAlpha: 0.58 });
      expect(p.labels.getStyle().color).toBe(0xe6eaec);
      expect(p.view.getBackground().color).toBe(0x111619);
    });
  });

  test('overlays re-shown after a theme change keep the theme', () => {
    viewer.setTheme(LIGHT);
    viewer.setCrosshairVisible(false);
    viewer.setCrosshairVisible(true);
    viewer.setOrientationLabelsVisible(false);
    viewer.setOrientationLabelsVisible(true);
    parts().forEach(p => {
      expect(p.cross).not.toBeUndefined();
      expect(p.cross.getStyle().crossColor).toBe(0x1c2226);
      expect(p.labels.getStyle()).toMatchObject({ color: 0x3e4952, fontSize: 11 });
    });
  });

  test('granular setters update every view', () => {
    viewer.setBackground(0x000000);
    viewer.setCrosshairStyle({ crossAlpha: 0.2 });
    viewer.setOrientationLabelStyle({ color: 0x00ff00 });
    parts().forEach(p => {
      expect(p.view.getBackground().color).toBe(0x000000);
      expect(p.cross.getStyle().crossAlpha).toBe(0.2);
      expect(p.labels.getStyle().color).toBe(0x00ff00);
    });
  });
});

describe('SimpleOrthogonalViewer.setTheme', () => {
  test('applies the theme through the facade and keeps the canvases', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const viewer = await SimpleOrthogonalViewer.create(container, makeStack(), {
      layout: 'ortho',
      showOrientationLabels: true,
      backgroundColor: 0x111619,
    });
    const canvases = VIEWS.map(v => viewer.getCanvas(v));

    viewer.setTheme(LIGHT);

    VIEWS.forEach((v, i) => {
      const canvas = viewer.getCanvas(v);
      expect(canvas).toBe(canvases[i]);
      expect(canvas.style.background).toMatch(/fafaf7|250, 250, 247/);
    });
    viewer.dispose();
    container.remove();
  });
});
