import { describe, test, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

// Use a fresh PIXI mock for this suite
vi.mock('pixi.js', () => createPixiMock());

import { SingleSliceViewer } from '../../src/display/SingleSliceViewer';
import { VolStack } from '../../src/display/VolStack';
import { ImageLayer } from '../../src/display/ImageLayer';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';
import { SliceView } from '../../src/display/SliceView';

describe('SingleSliceViewer', () => {
  let container: HTMLElement;
  let volStack: VolStack;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    // Minimal DOM container
    container = document.createElement('div');
    container.style.width = '300px';
    container.style.height = '300px';
    document.body.appendChild(container);

    // Simple 8×8×8 gradient volume
    const space = new NeuroSpace(
      [8, 8, 8],
      [1, 1, 1],
      [0, 0, 0],
      new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      )
    );
    const data = new Float32Array(8 * 8 * 8).map((_, idx) => idx);
    const vol = new FloatNeuroVol(space, data);
    const colorMap = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    const layer = new VolLayer('base', vol, colorMap);
    volStack = new VolStack(layer);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  test('forwards coordChanged when setCoord is called', async () => {
    const viewer = await SingleSliceViewer.createAxial(container, volStack);
    const handler = vi.fn();

    viewer.onCoordChange(handler);
    viewer.setCoord([2, 2, 2]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([2, 2, 2]);

    viewer.dispose();
  });

  test('forwards sliceChanged from underlying model', async () => {
    const viewer = await SingleSliceViewer.createAxial(container, volStack);
    const handler = vi.fn();
    viewer.onSliceChange(handler);

    // Drive the underlying model directly to ensure event wiring works
    // Initial index is 3 for an 8-deep volume; switch to a new one
    viewer.getViewer().model.setCurrentSliceIndex(4);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(4);

    viewer.dispose();
  });

  test('forwards pointer move/down events from SliceView listeners', async () => {
    let capturedMove: ((e: any) => void) | undefined;
    let capturedDown: ((e: any) => void) | undefined;

    const moveSpy = vi
      .spyOn(SliceView.prototype, 'addPointerMoveListener')
      .mockImplementation(function (this: any, handler: any) {
        capturedMove = handler;
      });
    const downSpy = vi
      .spyOn(SliceView.prototype, 'addPointerDownListener')
      .mockImplementation(function (this: any, handler: any) {
        capturedDown = handler;
      });

    const viewer = await SingleSliceViewer.createAxial(container, volStack);
    const moveHandler = vi.fn();
    const downHandler = vi.fn();

    viewer.onPointerMove(moveHandler);
    viewer.onPointerDown(downHandler);

    capturedMove?.({ dummy: true });
    capturedDown?.({ dummy: true });

    expect(moveHandler).toHaveBeenCalledTimes(1);
    expect(downHandler).toHaveBeenCalledTimes(1);

    moveSpy.mockRestore();
    downSpy.mockRestore();
    viewer.dispose();
  });
});
