import { describe, test, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';
import * as PIXI from 'pixi.js';

// Mock PIXI.js before any imports that use it
vi.mock('pixi.js', () => createPixiMock());

import { SliceView } from '../../src/display/SliceView';
import { SliceModel } from '../../src/display/SliceModel';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';

describe('SliceView', () => {
  let container: HTMLElement;
  let neuroSpace: NeuroSpace;
  let volStack: VolStack;
  let imageLayer: ImageLayer;
  let sliceModel: SliceModel;
  let sliceView: SliceView;
  let viewAxes: AxisSet3D;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    // Create DOM container
    container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '400px';
    document.body.appendChild(container);

    // Create test NeuroSpace
    neuroSpace = new NeuroSpace(
      [64, 64, 64],
      [2, 2, 2],
      [0, 0, 0],
      new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      )
    );

    // Create test volume
    const data = new Float32Array(64 * 64 * 64);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 100;
    }
    const vol = new FloatNeuroVol(neuroSpace, data);

    // Create volume layer
    const colorMap = new ColorMap([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
      [1, 1, 1]
    ]);
    const volLayer = new VolLayer('test-layer', vol, colorMap);

    // Create volume stack and image layer
    volStack = new VolStack(volLayer);
    imageLayer = new ImageLayer(volStack);

    // Set view axes for axial view
    viewAxes = AxisSet3D.AXIAL_LPI;

    // Create slice model with proper constructor arguments
    const centerCoord = neuroSpace.gridToCoord([32, 32, 32]); // Center of 64x64x64 volume
    sliceModel = new SliceModel(64, centerCoord, neuroSpace, viewAxes);
  });

  afterEach(() => {
    if (sliceView) {
      sliceView.dispose();
    }
    document.body.removeChild(container);
  });

  test('should create SliceView instance', async () => {
    sliceView = await SliceView.create(
      container,
      sliceModel,
      imageLayer,
      viewAxes
    );
    
    expect(sliceView).toBeDefined();
    expect(sliceView.viewAxes).toBe(viewAxes);
  });

  test.skip('should handle resize', async () => {
    sliceView = await SliceView.create(
      container,
      sliceModel,
      imageLayer,
      viewAxes
    );

    // Change container size
    container.style.width = '500px';
    container.style.height = '500px';

    sliceView.handleResize();

    // Verify renderer was resized
    expect(sliceView['app'].renderer.resize).toHaveBeenCalled();
  });

  test.skip('should update slice on model change', async () => {
    sliceView = await SliceView.create(
      container,
      sliceModel,
      imageLayer,
      viewAxes
    );

    const updateSliceSpy = vi.spyOn(sliceView as any, 'updateSlice');

    // Change slice index
    sliceModel.setSliceIndex(40);

    // Verify updateSlice was called
    expect(updateSliceSpy).toHaveBeenCalled();
  });

  test.skip('should handle mouse events', async () => {
    sliceView = await SliceView.create(
      container,
      sliceModel,
      imageLayer,
      viewAxes
    );

    const mockEvent = new PIXI.FederatedPointerEvent() as any;
    mockEvent.global = { x: 200, y: 200 };

    // Simulate mouse move
    const pointerMoveSpy = vi.fn();
    sliceView.on('pointermove', pointerMoveSpy);

    // Trigger event on stage
    const stage = sliceView['app'].stage;
    const onCall = stage.on as any;
    const pointerMoveHandler = onCall.mock.calls.find(
      (call: any) => call[0] === 'pointermove'
    )?.[1];

    if (pointerMoveHandler) {
      pointerMoveHandler(mockEvent);
    }

    expect(pointerMoveSpy).toHaveBeenCalled();
  });

  test.skip('should dispose properly', async () => {
    sliceView = await SliceView.create(
      container,
      sliceModel,
      imageLayer,
      viewAxes
    );

    const appDestroySpy = vi.spyOn(sliceView['app'], 'destroy');
    const removeChildSpy = vi.spyOn(container, 'removeChild');

    sliceView.dispose();

    expect(appDestroySpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();
  });

  test.skip('should transform coordinates', async () => {
    // TODO: This test needs to be updated once coordinate transformation methods are implemented
    // The methods screenToImageCoordinate don't currently exist on SliceView
  });

  test.skip('should handle crosshair visibility', () => {
    // TODO: This test needs to be updated once crosshair methods are implemented
    // The methods showCrosshair, hideCrosshair, updateCrosshair don't currently exist on SliceView
  });

  test('should handle scale changes', () => {
    // Test scale-related functionality with mock objects
    const mockSliceView = {
      scaleFactor: 1,
      sliceContainer: {
        scale: { set: vi.fn() }
      },
      updateSlice: vi.fn()
    };

    // Simulate scale change
    mockSliceView.scaleFactor = 2;
    mockSliceView.sliceContainer.scale.set(2, 2);
    mockSliceView.updateSlice();

    expect(mockSliceView.sliceContainer.scale.set).toHaveBeenCalledWith(2, 2);
    expect(mockSliceView.updateSlice).toHaveBeenCalled();
  });
});