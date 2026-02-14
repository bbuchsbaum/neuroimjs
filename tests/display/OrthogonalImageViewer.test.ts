import { describe, test, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

// Mock PIXI.js before any imports that use it
vi.mock('pixi.js', () => createPixiMock());

import { OrthogonalImageViewer } from '../../src/display/OrthogonalImageViewer';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';

describe('OrthogonalImageViewer', () => {
  let container: HTMLElement;
  let neuroSpace: NeuroSpace;
  let volStack: VolStack;
  let imageLayer: ImageLayer;
  let viewer: OrthogonalImageViewer;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    // Create DOM container
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Create test NeuroSpace
    neuroSpace = new NeuroSpace(
      [100, 100, 100],
      [1, 1, 1],
      [0, 0, 0],
      new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      )
    );

    // Create test volume
    const data = new Float32Array(100 * 100 * 100);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 100;
    }
    const vol = new FloatNeuroVol(neuroSpace, data);

    // Create volume layer
    const colorMap = new ColorMap([
      [0, 0, 0],
      [1, 1, 1]
    ]);
    const volLayer = new VolLayer('test-layer', vol, colorMap, [0, 100]);

    // Create volume stack and image layer
    volStack = new VolStack(volLayer);
    imageLayer = new ImageLayer(volStack);
  });

  afterEach(() => {
    if (viewer) {
      viewer.dispose();
    }
    document.body.removeChild(container);
  });

  test('should create OrthogonalImageViewer instance', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer,
      options: {
        showCrosshair: true,
        showSlider: true
      }
    });

    expect(viewer).toBeDefined();
    expect(viewer.currentCoord).toHaveLength(3);
  });

  test('should initialize with center coordinate', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    // The center calculation uses (dim-1)/2, so for 100x100x100 it's 49.5
    const expectedCenter = [49.5, 49.5, 49.5]; // Center of 100x100x100 volume
    expect(viewer.currentCoord).toEqual(expectedCenter);
  });

  test('should synchronize coordinates between views', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    const newCoord = [30, 40, 50];
    const axialViewer = viewer.getSliceViewer('axial');
    
    // Simulate coordinate change in axial viewer
    axialViewer.setPosition(newCoord);

    // Wait a tick for MobX reactions to propagate
    await new Promise(resolve => setTimeout(resolve, 0));

    // Check that the shared coordinate is updated
    expect(viewer.currentCoord).toEqual(newCoord);
  });

  test('should track mouse state', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    // Initial mouse state should be null
    expect(viewer.mouseState.viewName).toBeNull();
    expect(viewer.mouseState.imageCoordinate).toBeNull();
    expect(viewer.mouseState.volumeCoordinate).toBeNull();
    expect(viewer.mouseState.worldCoordinate).toBeNull();
  });

  test('should provide slice indices', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    const sliceIndices = viewer.sliceIndices;
    expect(sliceIndices).toHaveProperty('axial');
    expect(sliceIndices).toHaveProperty('coronal');
    expect(sliceIndices).toHaveProperty('sagittal');
    
    // Each should be a number
    expect(typeof sliceIndices.axial).toBe('number');
    expect(typeof sliceIndices.coronal).toBe('number');
    expect(typeof sliceIndices.sagittal).toBe('number');
  });

  test('should provide total slices', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    const totalSlices = viewer.totalSlices;
    expect(totalSlices).toHaveProperty('axial');
    expect(totalSlices).toHaveProperty('coronal');
    expect(totalSlices).toHaveProperty('sagittal');
    
    // Should match volume dimensions
    expect(totalSlices.axial).toBe(100);    // k dimension
    expect(totalSlices.coronal).toBe(100);  // j dimension
    expect(totalSlices.sagittal).toBe(100); // i dimension
  });

  test('should provide view orientation', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    const viewOrientation = viewer.viewOrientation;
    expect(viewOrientation).toHaveProperty('axial');
    expect(viewOrientation).toHaveProperty('coronal');
    expect(viewOrientation).toHaveProperty('sagittal');
  });

  test('should provide scale information', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    const scale = viewer.scale;
    expect(scale).toHaveProperty('axial');
    expect(scale).toHaveProperty('coronal');
    expect(scale).toHaveProperty('sagittal');
    
    // Each should be a number
    expect(typeof scale.axial).toBe('number');
    expect(typeof scale.coronal).toBe('number');
    expect(typeof scale.sagittal).toBe('number');
  });

  test('should identify as orthogonal viewer', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    expect(viewer.viewerType).toBe('orthogonal');
  });

  test('should provide visible layers information', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    const visibleLayers = viewer.visibleLayers;
    expect(Array.isArray(visibleLayers)).toBe(true);
    expect(visibleLayers).toHaveLength(1);
    expect(visibleLayers[0]).toHaveProperty('id', 'test-layer');
    expect(visibleLayers[0]).toHaveProperty('visible', true);
    expect(visibleLayers[0]).toHaveProperty('opacity', 1);
  });

  test('should get individual slice viewers', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    const axialViewer = viewer.getSliceViewer('axial');
    const coronalViewer = viewer.getSliceViewer('coronal');
    const sagittalViewer = viewer.getSliceViewer('sagittal');

    expect(axialViewer).toBeDefined();
    expect(coronalViewer).toBeDefined();
    expect(sagittalViewer).toBeDefined();
  });

  test.skip('should handle resize events', async () => {
    // TODO: This test needs proper event setup and async timing
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    // Get slice viewers
    const axialViewer = viewer.getSliceViewer('axial');
    const handleResizeSpy = vi.spyOn(axialViewer, 'handleResize');

    // Trigger resize
    window.dispatchEvent(new Event('resize'));

    // Verify handleResize was called
    expect(handleResizeSpy).toHaveBeenCalled();
  });

  test('should dispose properly without memory leaks', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    // Get slice viewers before disposal
    const axialViewer = viewer.getSliceViewer('axial');
    const disposeSpy = vi.spyOn(axialViewer, 'dispose');

    // Dispose the viewer
    viewer.dispose();

    // Verify cleanup
    expect(disposeSpy).toHaveBeenCalled();
    expect(container.children.length).toBe(0);
  });

  test('should handle coordinate updates without infinite loops', async () => {
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer
    });

    const updateCount = { count: 0 };
    const axialViewer = viewer.getSliceViewer('axial');
    
    // Mock setPosition to count calls
    const originalSetPosition = axialViewer.setPosition.bind(axialViewer);
    axialViewer.setPosition = vi.fn((coord) => {
      updateCount.count++;
      if (updateCount.count > 10) {
        throw new Error('Infinite loop detected');
      }
      originalSetPosition(coord);
    });

    // Update coordinate
    const newCoord = [25, 25, 25];
    axialViewer.setPosition(newCoord);

    // Should not trigger infinite updates
    expect(updateCount.count).toBeLessThanOrEqual(1);
  });
});