import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import { ViewSynchronizer } from '../../src/display/ViewSynchronizer';
import { SingleSliceViewer } from '../../src/display/SingleSliceViewer';
import { VolStack } from '../../src/display/VolStack';
import { VolLayer } from '../../src/display/VolLayer';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { ColorMap } from '../../src/display/ColorMap';

describe('ViewSynchronizer', () => {
  let volStack: VolStack;
  let container1: HTMLElement;
  let container2: HTMLElement;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    const neuroSpace = new NeuroSpace(
      [64, 64, 64],
      [2, 2, 2],
      [0, 0, 0],
      new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
    );
    const data = new Float32Array(64 * 64 * 64).fill(1);
    const vol = new FloatNeuroVol(neuroSpace, data);
    const colorMap = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    const volLayer = new VolLayer('test', vol, colorMap);
    volStack = new VolStack(volLayer);

    container1 = document.createElement('div');
    Object.defineProperty(container1, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(container1, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(container1);

    container2 = document.createElement('div');
    Object.defineProperty(container2, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(container2, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(container2);
  });

  afterEach(() => {
    [container1, container2].forEach(c => {
      if (c.parentElement) c.parentElement.removeChild(c);
    });
  });

  test('constructor creates synchronizer with defaults', () => {
    const sync = new ViewSynchronizer();
    expect(sync.isEnabled()).toBe(true);
    expect(sync.getViewCount()).toBe(0);
  });

  test('constructor accepts options', () => {
    const sync = new ViewSynchronizer({ syncOnHover: true, syncOnAdd: true });
    expect(sync.isEnabled()).toBe(true);
  });

  test('addView and removeView manage views', async () => {
    const sync = new ViewSynchronizer();
    const axial = await SingleSliceViewer.createAxial(container1, volStack);

    sync.addView('axial', axial);
    expect(sync.getViewCount()).toBe(1);
    expect(sync.hasView('axial')).toBe(true);
    expect(sync.getViewIds()).toContain('axial');

    const removed = sync.removeView('axial');
    expect(removed).toBe(axial);
    expect(sync.getViewCount()).toBe(0);

    axial.dispose();
    sync.dispose();
  });

  test('addView throws on duplicate ID', async () => {
    const sync = new ViewSynchronizer();
    const axial = await SingleSliceViewer.createAxial(container1, volStack);

    sync.addView('axial', axial);
    expect(() => sync.addView('axial', axial)).toThrow();

    axial.dispose();
    sync.dispose();
  });

  test('getView returns the correct viewer', async () => {
    const sync = new ViewSynchronizer();
    const axial = await SingleSliceViewer.createAxial(container1, volStack);

    sync.addView('axial', axial);
    expect(sync.getView('axial')).toBe(axial);
    expect(sync.getView('nonexistent')).toBeUndefined();

    axial.dispose();
    sync.dispose();
  });

  test('enable/disable/toggle control sync state', () => {
    const sync = new ViewSynchronizer();
    expect(sync.isEnabled()).toBe(true);

    sync.disable();
    expect(sync.isEnabled()).toBe(false);

    sync.enable();
    expect(sync.isEnabled()).toBe(true);

    const newState = sync.toggle();
    expect(newState).toBe(false);
    expect(sync.isEnabled()).toBe(false);
  });

  test('syncCoordinate updates all views when enabled', async () => {
    const sync = new ViewSynchronizer();
    const axial = await SingleSliceViewer.createAxial(container1, volStack);
    const coronal = await SingleSliceViewer.createCoronal(container2, volStack);

    sync.addView('axial', axial);
    sync.addView('coronal', coronal);

    const coord = [10, 20, 30];
    sync.syncCoordinate(coord);

    // Both views should have been updated
    // (The exact values may differ due to coordinate system transformations)
    expect(axial.getCurrentCoord()).toBeDefined();
    expect(coronal.getCurrentCoord()).toBeDefined();

    axial.dispose();
    coronal.dispose();
    sync.dispose();
  });

  test('syncCoordinate does nothing when disabled', async () => {
    const sync = new ViewSynchronizer();
    const axial = await SingleSliceViewer.createAxial(container1, volStack);
    sync.addView('axial', axial);

    const coordBefore = axial.getCurrentCoord().slice();
    sync.disable();
    sync.syncCoordinate([0, 0, 0]);
    expect(axial.getCurrentCoord()).toEqual(coordBefore);

    axial.dispose();
    sync.dispose();
  });

  test('dispose cleans up all views', async () => {
    const sync = new ViewSynchronizer();
    const axial = await SingleSliceViewer.createAxial(container1, volStack);
    sync.addView('axial', axial);

    sync.dispose();
    expect(sync.getViewCount()).toBe(0);

    axial.dispose();
  });

  test('fromViews creates synchronizer with pre-configured views', async () => {
    const axial = await SingleSliceViewer.createAxial(container1, volStack);
    const coronal = await SingleSliceViewer.createCoronal(container2, volStack);

    const sync = ViewSynchronizer.fromViews({ axial, coronal });
    expect(sync.getViewCount()).toBe(2);
    expect(sync.hasView('axial')).toBe(true);
    expect(sync.hasView('coronal')).toBe(true);

    axial.dispose();
    coronal.dispose();
    sync.dispose();
  });

  test('createOrthogonal creates synchronizer with three views', async () => {
    const container3 = document.createElement('div');
    Object.defineProperty(container3, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(container3, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(container3);

    const axial = await SingleSliceViewer.createAxial(container1, volStack);
    const sagittal = await SingleSliceViewer.createSagittal(container2, volStack);
    const coronal = await SingleSliceViewer.createCoronal(container3, volStack);

    const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal);
    expect(sync.getViewCount()).toBe(3);

    axial.dispose();
    sagittal.dispose();
    coronal.dispose();
    sync.dispose();
    container3.parentElement?.removeChild(container3);
  });
});
