import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import { SliceView } from '../../src/display/SliceView';
import { SliceModel } from '../../src/display/SliceModel';
import { SliceController } from '../../src/display/SliceController';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';

describe('SliceController', () => {
  let container: HTMLElement;
  let neuroSpace: NeuroSpace;
  let sliceView: SliceView;
  let sliceModel: SliceModel;
  let controller: SliceController;
  let viewAxes: AxisSet3D;
  let canvas: HTMLCanvasElement;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(async () => {
    container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '400px';
    Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(container);

    neuroSpace = new NeuroSpace(
      [64, 64, 64],
      [2, 2, 2],
      [0, 0, 0],
      new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
    );

    const data = new Float32Array(64 * 64 * 64).fill(1);
    const vol = new FloatNeuroVol(neuroSpace, data);
    const colorMap = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    const volLayer = new VolLayer('test', vol, colorMap);
    const volStack = new VolStack(volLayer);
    const imageLayer = new ImageLayer(volStack);

    viewAxes = AxisSet3D.AXIAL_LPI;
    const centerCoord = neuroSpace.gridToCoord([32, 32, 32]);
    sliceModel = new SliceModel(64, centerCoord, neuroSpace, viewAxes);

    sliceView = await SliceView.create(container, imageLayer, neuroSpace, viewAxes, sliceModel);
    controller = new SliceController(sliceModel, sliceView, neuroSpace, viewAxes);
    canvas = sliceView.getCanvas();
  });

  afterEach(() => {
    controller.dispose();
    sliceView.dispose();
    if (container.parentElement) container.parentElement.removeChild(container);
  });

  test('constructor creates controller without error', () => {
    expect(controller).toBeDefined();
    expect(controller.isEnabled()).toBe(true);
  });

  test('setEnabled toggles controller', () => {
    controller.setEnabled(false);
    expect(controller.isEnabled()).toBe(false);
    controller.setEnabled(true);
    expect(controller.isEnabled()).toBe(true);
  });

  test('wheel event triggers slice scroll', () => {
    const initialIndex = sliceModel.currentSliceIndex;

    // Scroll down => nextSlice
    const wheelDown = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
    canvas.dispatchEvent(wheelDown);
    expect(sliceModel.currentSliceIndex).toBe(initialIndex + 1);
  });

  test('wheel event scrolls backward', () => {
    // Move away from edge first
    sliceModel.setCurrentSliceIndex(32);
    const idx = sliceModel.currentSliceIndex;

    // Scroll up => previousSlice
    const wheelUp = new WheelEvent('wheel', { deltaY: -100, bubbles: true });
    canvas.dispatchEvent(wheelUp);
    expect(sliceModel.currentSliceIndex).toBe(idx - 1);
  });

  test('ctrl+wheel triggers zoom', () => {
    const initialZoom = sliceView.getZoom();

    const wheelZoom = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
    });
    canvas.dispatchEvent(wheelZoom);

    expect(sliceView.getZoom()).toBeGreaterThan(initialZoom);
  });

  test('meta+wheel triggers zoom', () => {
    const initialZoom = sliceView.getZoom();

    const wheelZoom = new WheelEvent('wheel', {
      deltaY: -100,
      metaKey: true,
      bubbles: true,
    });
    canvas.dispatchEvent(wheelZoom);

    expect(sliceView.getZoom()).toBeGreaterThan(initialZoom);
  });

  test('dblclick resets view', () => {
    sliceView.setZoom(2.5);
    sliceView.setPan({ x: 50, y: 50 });

    const dblclick = new MouseEvent('dblclick', { bubbles: true });
    canvas.dispatchEvent(dblclick);

    expect(sliceView.getZoom()).toBe(1.0);
    expect(sliceView.getPan()).toEqual({ x: 0, y: 0 });
  });

  test('wheel does nothing when disabled', () => {
    controller.setEnabled(false);
    const initialIndex = sliceModel.currentSliceIndex;

    const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
    canvas.dispatchEvent(wheel);

    expect(sliceModel.currentSliceIndex).toBe(initialIndex);
  });

  test('dispose removes event listeners', () => {
    const removeEventSpy = vi.spyOn(canvas, 'removeEventListener');
    controller.dispose();

    // Should have removed wheel, dblclick, pointerdown, pointermove, pointerup
    expect(removeEventSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
    expect(removeEventSpy).toHaveBeenCalledWith('dblclick', expect.any(Function));
  });
});
