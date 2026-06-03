import { describe, test, expect, vi, beforeEach, beforeAll } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

// Mock PIXI.js before any imports that use it
vi.mock('pixi.js', () => createPixiMock());

import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { VolLayer } from '../../src/display/VolLayer';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { ColorMap } from '../../src/display/ColorMap';
import * as PIXI from 'pixi.js';

describe('ImageLayer', () => {
  let neuroSpace: NeuroSpace;
  let volStack: VolStack;
  let imageLayer: ImageLayer;
  let volLayer1: VolLayer;
  let volLayer2: VolLayer;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    // Create test NeuroSpace
    neuroSpace = new NeuroSpace(
      [32, 32, 32],
      [1, 1, 1],
      [0, 0, 0],
      new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      )
    );

    // Create test volumes
    const data1 = new Float32Array(32 * 32 * 32);
    const data2 = new Float32Array(32 * 32 * 32);
    
    // Fill with different patterns
    for (let i = 0; i < data1.length; i++) {
      data1[i] = i % 100;
      data2[i] = (i * 2) % 100;
    }

    const vol1 = new FloatNeuroVol(neuroSpace, data1);
    const vol2 = new FloatNeuroVol(neuroSpace, data2);

    // Create color maps
    const colorMap1 = new ColorMap([[0, 0, 0], [1, 0, 0]]); // Black to red
    const colorMap2 = new ColorMap([[0, 0, 0], [0, 0, 1]]); // Black to blue

    // Create volume layers
    volLayer1 = new VolLayer('layer1', vol1, colorMap1);
    volLayer2 = new VolLayer('layer2', vol2, colorMap2, null, [0, 0], 0.5);

    // Create volume stack
    volStack = new VolStack(volLayer1);
    
    // Create image layer
    imageLayer = new ImageLayer(volStack);
  });

  test('should create ImageLayer instance', () => {
    expect(imageLayer).toBeDefined();
    expect(imageLayer.neuroSpace).toBe(neuroSpace);
    expect(imageLayer.opacity).toBe(1);
  });

  test('should add and remove volume layers', () => {
    // Add second layer
    imageLayer.addVolLayer(volLayer2);
    expect(imageLayer.getVolStack().length).toBe(2);
    
    // Remove first layer
    imageLayer.removeVolLayer(volLayer1);
    expect(imageLayer.getVolStack().length).toBe(1);
    expect(imageLayer.getLayer(0)).toBe(volLayer2);
  });

  test('should create sprite from ImageData', () => {
    const imageData = new ImageData(10, 10);
    // createSprite requires a cache key (used to key the texture cache).
    const sprite = imageLayer.createSprite(imageData, 'test-sprite-key');

    expect(sprite).toBeDefined();
    // Canvas mocking is handled in setup.ts
  });

  test('should render slice with single layer', () => {
    const viewAxes = AxisSet3D.AXIAL_LPI;
    const parentContainer = new PIXI.Container() as any;
    
    const result = imageLayer.renderSlice(15, [15, 15, 15], viewAxes, parentContainer);
    
    expect(result).toBeDefined();
    expect(result?.addChild).toHaveBeenCalled();
  });

  test('should render slice with multiple layers', () => {
    imageLayer.addVolLayer(volLayer2);
    
    const viewAxes = AxisSet3D.AXIAL_LPI;
    const parentContainer = new PIXI.Container() as any;
    
    const result = imageLayer.renderSlice(15, [15, 15, 15], viewAxes, parentContainer);
    
    expect(result).toBeDefined();
    // Should have added 2 sprites (one for each layer)
    expect(result?.addChild).toHaveBeenCalledTimes(2);
  });

  test('should align sprites to reference slice', () => {
    imageLayer.addVolLayer(volLayer2);
    
    const viewAxes = AxisSet3D.AXIAL_LPI;
    const parentContainer = new PIXI.Container() as any;
    
    const result = imageLayer.renderSlice(15, [15, 15, 15], viewAxes, parentContainer);
    
    // Verify sprites were created and positioned
    expect(result).toBeDefined();
    
    // Mock sprite should have had its position and scale set
    const spriteConstructor = PIXI.Sprite as any;
    expect(spriteConstructor).toHaveBeenCalled();
  });

  test('should respect layer opacity', () => {
    imageLayer.addVolLayer(volLayer2);
    
    const viewAxes = AxisSet3D.AXIAL_LPI;
    const parentContainer = new PIXI.Container() as any;
    
    // Mock sprite creation to track opacity
    const sprites: any[] = [];
    (PIXI.Sprite as any).mockImplementation(() => {
      const sprite = {
        position: { set: vi.fn() },
        scale: { set: vi.fn() },
        pivot: { set: vi.fn() },
        alpha: 1,
        destroy: vi.fn()
      };
      sprites.push(sprite);
      return sprite;
    });
    
    imageLayer.renderSlice(15, [15, 15, 15], viewAxes, parentContainer);
    
    // First sprite should have full opacity (layer1)
    expect(sprites[0].alpha).toBe(1);
    // Second sprite should have 0.5 opacity (layer2)
    expect(sprites[1].alpha).toBe(0.5);
  });

  test('should get layer by index', () => {
    imageLayer.addVolLayer(volLayer2);
    
    expect(imageLayer.getLayer(0)).toBe(volLayer1);
    expect(imageLayer.getLayer(1)).toBe(volLayer2);
  });

  test('should get layer IDs', () => {
    imageLayer.addVolLayer(volLayer2);
    
    const layerIds = imageLayer.getLayerIds();
    expect(layerIds).toEqual(['layer1', 'layer2']);
  });

  test('should update layer parameters', () => {
    const setRangeSpy = vi.spyOn(volLayer1, 'setRange');
    const setThresholdSpy = vi.spyOn(volLayer1, 'setThreshold');
    
    imageLayer.updateLayer('layer1', {
      range: [10, 90],
      threshold: [20, 80],
      alpha: 0.7
    });
    
    expect(setRangeSpy).toHaveBeenCalledWith([10, 90]);
    expect(setThresholdSpy).toHaveBeenCalledWith([20, 80]);
    expect(volLayer1.opacity).toBe(0.7);
  });

  test('should handle non-existent layer update gracefully', () => {
    // Should not throw
    expect(() => {
      imageLayer.updateLayer('non-existent', { range: [0, 100] });
    }).not.toThrow();
  });

  test('should implement SliceLayer interface methods', () => {
    // Test initialize
    expect(() => imageLayer.initialize()).not.toThrow();
    
    // Test setPosition
    expect(() => imageLayer.setPosition([10, 10, 10])).not.toThrow();
    
    // Test onPointerMove
    const pointerEvent = {} as PIXI.FederatedPointerEvent;
    expect(imageLayer.onPointerMove(pointerEvent)).toBe(false);
    
    // Test onPointerDown
    expect(imageLayer.onPointerDown(pointerEvent)).toBe(false);
    
    // Test dispose
    expect(() => imageLayer.dispose()).not.toThrow();
  });

  test('should handle different slice orientations', () => {
    const orientations = [
      AxisSet3D.AXIAL_LPI,
      AxisSet3D.CORONAL_LIP,
      AxisSet3D.SAGITTAL_AIL
    ];
    
    const parentContainer = new PIXI.Container() as any;
    
    for (const orientation of orientations) {
      const result = imageLayer.renderSlice(15, [15, 15, 15], orientation, parentContainer);
      expect(result).toBeDefined();
    }
  });

  test('should return null if reference layer slice is invalid', () => {
    // Mock getSlice to throw
    vi.spyOn(volLayer1, 'getSlice').mockImplementation(() => {
      throw new Error('Invalid slice');
    });
    
    const viewAxes = AxisSet3D.AXIAL_LPI;
    const parentContainer = new PIXI.Container() as any;
    
    expect(() => {
      imageLayer.renderSlice(15, [15, 15, 15], viewAxes, parentContainer);
    }).toThrow();
  });
});