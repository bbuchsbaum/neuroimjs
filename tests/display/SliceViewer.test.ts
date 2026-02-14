import { describe, test, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

// Mock PIXI.js before any imports that use it
vi.mock('pixi.js', () => createPixiMock());

import { SliceViewer } from '../../src/display/SliceViewer';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';

describe('SliceViewer', () => {
  let container: HTMLElement;
  let neuroSpace: NeuroSpace;
  let volStack: VolStack;
  let imageLayer: ImageLayer;
  let viewer: SliceViewer;
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

    // Create test volume with gradient data
    const data = new Float32Array(64 * 64 * 64);
    for (let k = 0; k < 64; k++) {
      for (let j = 0; j < 64; j++) {
        for (let i = 0; i < 64; i++) {
          const idx = k * 64 * 64 + j * 64 + i;
          data[idx] = (i + j + k) / 3;
        }
      }
    }
    const vol = new FloatNeuroVol(neuroSpace, data);

    // Create volume layer
    const colorMap = new ColorMap([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
      [1, 1, 1]
    ]);
    const volLayer = new VolLayer('test-layer', vol, colorMap, [0, 63]);

    // Create volume stack and image layer
    volStack = new VolStack(volLayer);
    imageLayer = new ImageLayer(volStack);

    // Set view axes for axial view
    viewAxes = AxisSet3D.AXIAL_LPI;
  });

  afterEach(() => {
    if (viewer) {
      viewer.dispose();
    }
    document.body.removeChild(container);
  });

  test('should create SliceViewer instance', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    expect(viewer).toBeDefined();
    expect(viewer.model).toBeDefined();
    expect(viewer.view).toBeDefined();
    expect(viewer.controller).toBeDefined();
  });

  test('should initialize with correct total slices', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    // For axial view, total slices should be the k dimension (64)
    expect(viewer.model.totalSlices).toBe(64);
  });

  test('should set initial slice index to middle', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    // Middle slice should be (64-1)/2 = 31.5, floored to 31
    expect(viewer.currentSliceIndex).toBe(31);
  });

  test('should update position correctly', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    const newCoord = [32, 32, 16]; // mm coordinates
    viewer.setPosition(newCoord);
    
    expect(viewer.currentCoord).toEqual(newCoord);
  });

  test('should not update position if coordinates are equal', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    const initialCoord = viewer.currentCoord.slice();
    const initialSliceIndex = viewer.currentSliceIndex;
    
    // Set same position
    viewer.setPosition(initialCoord);
    
    // Verify that the slice index hasn't changed
    expect(viewer.currentSliceIndex).toBe(initialSliceIndex);
    expect(viewer.currentCoord).toEqual(initialCoord);
  });

  test('should track mouse position', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    // Check that mouse tracking properties are available
    expect(viewer.mouseImagePosition).toBeDefined();
    expect(viewer.mouseVolumeCoordinate).toBeDefined();
    expect(viewer.mouseWorldCoordinate).toBeDefined();
    
    // Initial mouse coordinates should be null (no mouse interaction yet)
    expect(viewer.mouseVolumeCoordinate).toBeNull();
    expect(viewer.mouseWorldCoordinate).toBeNull();
  });

  test('should provide scale information', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    // The scale is calculated based on container size (400x400) and content size
    // With a 64x64 volume with spacing [2,2,2], content is 128x128
    // Scale should be 400/128 = 3.125, but the actual scale might be adjusted
    expect(viewer.scale).toBeGreaterThan(0);
    expect(viewer.scale).toBeLessThanOrEqual(10); // Should be within reasonable bounds
  });

  test('should implement ViewerStateInfo interface', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    // Check all required properties
    expect(viewer.currentCoord).toBeDefined();
    expect(viewer.mouseState).toBeDefined();
    expect(viewer.sliceIndices).toBeDefined();
    expect(viewer.totalSlices).toBeDefined();
    expect(viewer.viewOrientation).toBeDefined();
    expect(viewer.scale).toBeDefined();
    expect(viewer.viewerType).toBe('slice');
    expect(viewer.visibleLayers).toBeDefined();
  });

  test('should provide correct slice indices', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    const sliceIndices = viewer.sliceIndices;
    expect(sliceIndices).toHaveProperty('slice', 31); // Middle slice
  });

  test('should provide correct total slices', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    const totalSlices = viewer.totalSlices;
    expect(totalSlices).toHaveProperty('slice', 64);
  });

  test('should handle resize', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    const handleResizeSpy = vi.spyOn(viewer.view, 'handleResize');
    
    // Change container size
    container.style.width = '500px';
    container.style.height = '500px';
    
    viewer.handleResize();
    
    expect(handleResizeSpy).toHaveBeenCalled();
  });

  test('should dispose properly', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    const viewDisposeSpy = vi.spyOn(viewer.view, 'dispose');
    const controllerDisposeSpy = vi.spyOn(viewer.controller, 'dispose');
    
    viewer.dispose();
    
    expect(viewDisposeSpy).toHaveBeenCalled();
    expect(controllerDisposeSpy).toHaveBeenCalled();
  });

  test('should handle different view orientations', async () => {
    // Test coronal view
    const coronalAxes = AxisSet3D.CORONAL_LIP;
    const coronalViewer = await SliceViewer.create(container, imageLayer, coronalAxes);
    
    expect(coronalViewer.model.totalSlices).toBe(64); // j dimension for coronal
    
    coronalViewer.dispose();
    
    // Test sagittal view
    const sagittalAxes = AxisSet3D.SAGITTAL_AIL;
    const sagittalViewer = await SliceViewer.create(container, imageLayer, sagittalAxes);
    
    expect(sagittalViewer.model.totalSlices).toBe(64); // i dimension for sagittal
    
    sagittalViewer.dispose();
  });

  test('should create with options', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes, {
      width: 300,
      height: 300,
      showCrosshair: true,
      showSlider: true
    });
    
    expect(viewer).toBeDefined();
    // Options should be passed to SliceView
  });

  test('should update visible layers information', async () => {
    viewer = await SliceViewer.create(container, imageLayer, viewAxes);
    
    const visibleLayers = viewer.visibleLayers;
    expect(visibleLayers).toHaveLength(1);
    expect(visibleLayers[0].id).toBe('test-layer');
    expect(visibleLayers[0].visible).toBe(true);
    expect(visibleLayers[0].opacity).toBe(1);
  });
});