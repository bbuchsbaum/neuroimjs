/**
 * Integration tests for the display system
 * Tests the interaction between multiple components
 */

import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { ImageLayer } from '../../ImageLayer';
import { VolStack } from '../../VolStack';
import { VolLayer } from '../../VolLayer';
import { FloatNeuroVol } from '../../../volume/DenseNeuroVol';
import { NeuroSpace } from '../../../geometry/NeuroSpace';
import { AxisSet3D, AxisSet2D, NamedAxis } from '../../../geometry/Axis';
import { AlignmentManager } from '../../alignment/AlignmentManager';
import { MemoryManager } from '../../memory/MemoryManager';
import { TextureMemoryConsumer } from '../../memory/TextureMemoryConsumer';
import { WorkerService } from '../../workers/WorkerService';
import { Logger, LogLevel } from '../../logging/Logger';
import { getCategoryLogger, LogCategories } from '../../logging/LoggerConfig';
import { ColorMapFactory } from '../../ColorMapFactory';
import { ImageSlice } from '../../ImageSlice';
import * as PIXI from 'pixi.js';

// Mock PIXI for testing (ensure Texture.from exists)
vi.mock('pixi.js', () => {
  const Application = vi.fn().mockImplementation(() => ({
    stage: { on: vi.fn(), off: vi.fn() },
    renderer: { width: 800, height: 600, resize: vi.fn() },
    view: (typeof document !== 'undefined') ? document.createElement('canvas') : undefined,
    destroy: vi.fn()
  }));

  const Container = vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    removeChildren: vi.fn(),
    destroy: vi.fn(),
    getLocalBounds: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 100 })),
    scale: { x: 1, y: 1, set: vi.fn() },
    position: { x: 0, y: 0, set: vi.fn() },
    pivot: { set: vi.fn() },
    children: []
  }));

  const Sprite = vi.fn().mockImplementation((texture?: any) => ({
    texture: texture ?? null,
    alpha: 1,
    visible: true,
    tint: 0xFFFFFF,
    anchor: { set: vi.fn() },
    scale: { x: 1, y: 1, set: vi.fn() },
    position: { x: 0, y: 0, set: vi.fn() },
    pivot: { set: vi.fn() },
    destroy: vi.fn()
  }));

  class Texture {
    static from = vi.fn((src: any) => new Texture(src));
    static EMPTY = new Texture({});
    source: any;
    constructor(src?: any) { this.source = src; }
    destroy = vi.fn();
  }

  const Graphics = vi.fn().mockImplementation(() => ({
    lineStyle: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
  }));

  return { Application, Container, Sprite, Texture, Graphics };
});

describe('Display System Integration', () => {
  let testSpace: NeuroSpace;
  let testVolume: FloatNeuroVol;
  let logger: ReturnType<typeof getCategoryLogger>;
  let grayscaleColorMap: any;

  beforeAll(() => {
    // Initialize logger
    Logger.getInstance({
      level: LogLevel.DEBUG,
      console: false,
      store: true
    });
    logger = getCategoryLogger(LogCategories.VIEW);
  });

  beforeEach(() => {
    // Clear any existing instances
    MemoryManager.destroy();
    WorkerService.getInstance().terminate();
    
    // Create test data
    testSpace = new NeuroSpace(
      [64, 64, 32],
      [2, 2, 4],
      [0, 0, 0],
      AxisSet3D.AXIAL_LPI
    );
    
    const data = new Float32Array(64 * 64 * 32);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random();
    }
    
    testVolume = new FloatNeuroVol(testSpace, data);
    
    // Create default grayscale colormap
    grayscaleColorMap = ColorMapFactory.createGrayscale();
  });

  afterEach(() => {
    MemoryManager.destroy();
    WorkerService.getInstance().terminate();
    Logger.getInstance().clearEntries();
  });

  describe('ImageLayer with VolStack', () => {
    it('should create and render layers', () => {
      const volLayer1 = new VolLayer('layer1', testVolume, grayscaleColorMap, [0, 1]);
      const volLayer2 = new VolLayer('layer2', testVolume, grayscaleColorMap, [0, 1]);
      
      const volStack = new VolStack(volLayer1, volLayer2);
      
      const imageLayer = new ImageLayer(volStack);
      
      expect(imageLayer.getLayerIds()).toEqual(['layer1', 'layer2']);
      
      // Test rendering
      const container = new PIXI.Container();
      const result = imageLayer.renderSlice(16, [32, 32, 16], AxisSet3D.fromStr('XYZ'), container);
      
      expect(result).toBeDefined();
      expect(result).toBeTruthy();
    });

    it('should handle layer updates', () => {
      const volLayer = new VolLayer('test', testVolume, grayscaleColorMap);
      const volStack = new VolStack(volLayer);
      
      const imageLayer = new ImageLayer(volStack);
      
      imageLayer.updateLayer('test', {
        alpha: 0.5,
        range: [0, 100],
        threshold: [10, 90]
      });
      
      expect(volLayer.opacity).toBe(0.5);
    });
  });

  describe('Alignment System', () => {
    it('should align layers with different resolutions', () => {
      // Create two volumes with different resolutions
      const space1 = new NeuroSpace([64, 64, 32], [1, 1, 2], [0, 0, 0], AxisSet3D.AXIAL_LPI);
      const space2 = new NeuroSpace([32, 32, 16], [2, 2, 4], [0, 0, 0], AxisSet3D.AXIAL_LPI);
      
      const vol1 = new FloatNeuroVol(space1, new Float32Array(64 * 64 * 32));
      const vol2 = new FloatNeuroVol(space2, new Float32Array(32 * 32 * 16));
      
      const volStack = new VolStack(
        new VolLayer('high-res', vol1, grayscaleColorMap),
        new VolLayer('low-res', vol2, grayscaleColorMap)
      );
      
      const imageLayer = new ImageLayer(volStack, {
        strategy: 'auto',
        maintainAspectRatio: true
      });
      
      const container = new PIXI.Container();
      const result = imageLayer.renderSlice(16, [32, 32, 16], AxisSet3D.fromStr('XYZ'), container);
      
      expect(result).toBeDefined();
      
      // Check alignment stats
      const alignStats = imageLayer.getAlignmentCacheStats();
      expect(alignStats.size).toBeGreaterThan(0);
    });

    it('should select appropriate alignment strategy', () => {
      const manager = new AlignmentManager();
      
      // Create proper ImageSlice objects
      const refSlice = new ImageSlice(
        new ImageData(100, 100),
        { xMin: 0, yMin: 0, xMax: 10, yMax: 10 },
        [0.1, 0.1],
        new AxisSet2D(NamedAxis.LEFT_RIGHT, NamedAxis.ANT_POST)
      );
      
      const targetSlice = new ImageSlice(
        new ImageData(50, 50),
        { xMin: 5, yMin: 5, xMax: 10, yMax: 10 },
        [0.1, 0.1],
        new AxisSet2D(NamedAxis.LEFT_RIGHT, NamedAxis.ANT_POST)
      );
      
      const strategy = manager.selectBestStrategy(targetSlice as any, refSlice as any);
      expect(strategy.getName()).toBe('overlap'); // Should detect overlap
    });
  });

  describe('Memory Management', () => {
    it('should manage texture memory automatically', () => {
      const memoryManager = MemoryManager.getInstance({
        maxMemoryBytes: 10 * 1024 * 1024, // 10MB
        warningThreshold: 0.7,
        autoCleanup: true
      });
      
      const textureConsumer = new TextureMemoryConsumer('test', 5 * 1024 * 1024); // 5MB
      textureConsumer.registerWithMemoryManager('test-consumer');
      
      // Simulate adding textures
      for (let i = 0; i < 10; i++) {
        const texture = new PIXI.Texture({} as any);
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        
        textureConsumer.addTexture(`texture-${i}`, texture, canvas);
      }
      
      const stats = memoryManager.getStats();
      expect(stats.totalUsage).toBeLessThanOrEqual(memoryManager['options'].maxMemoryBytes);
    });

    it('should trigger cleanup on memory pressure', async () => {
      const memoryManager = MemoryManager.getInstance({
        maxMemoryBytes: 1024 * 1024, // 1MB
        criticalThreshold: 0.8,
        autoCleanup: true,
        checkInterval: 10
      });
      
      let cleanupTriggered = false;
      memoryManager.onMemoryCritical(() => {
        cleanupTriggered = true;
      });
      
      // Create consumer that uses too much memory
      const consumer = {
        getName: () => 'test',
        getMemoryUsage: () => 900 * 1024, // 900KB
        releaseMemory: vi.fn(() => 400 * 1024) // Frees 400KB
      };
      
      memoryManager.registerConsumer('heavy', consumer);
      
      // Wait for memory check interval
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(cleanupTriggered).toBe(true);
      expect(consumer.releaseMemory).toHaveBeenCalled();
    });
  });

  describe('Worker Integration', () => {
    it('should handle worker service lifecycle', async () => {
      const workerService = WorkerService.getInstance({
        enabled: false // Disable for testing
      });
      
      expect(workerService.isEnabled()).toBe(false);
      
      const stats = workerService.getStats();
      expect(stats.enabled).toBe(false);
      
      // Cleanup
      workerService.terminate();
    });
  });

  describe('Logging Integration', () => {
    it('should log component lifecycle events', () => {
      const volLayer = new VolLayer('test', testVolume, grayscaleColorMap, [0, 1]);
      const volStack = new VolStack(volLayer);
      const imageLayer = new ImageLayer(volStack);
      
      const logs = Logger.getInstance().getEntries({
        category: LogCategories.IMAGE_LAYER
      });
      
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].message).toContain('Creating ImageLayer');
      
      imageLayer.dispose();
      
      const disposeLogs = Logger.getInstance().getEntries({
        category: LogCategories.IMAGE_LAYER,
        since: new Date(Date.now() - 100)
      });
      
      expect(disposeLogs.some(log => log.message.includes('Disposing'))).toBe(true);
    });

    it('should track performance metrics', () => {
      const volLayer = new VolLayer('test', testVolume, grayscaleColorMap, [0, 1]);
      const volStack = new VolStack(volLayer);
      const imageLayer = new ImageLayer(volStack);
      
      // Render a slice
      const container = new PIXI.Container();
      imageLayer.renderSlice(0, [0, 0, 0], AxisSet3D.fromStr('XYZ'), container);
      
      const perfLogs = Logger.getInstance().getEntries({
        category: LogCategories.PERFORMANCE
      });
      
      expect(perfLogs.some(log => 
        log.message.includes('renderSlice') && 
        log.data && 
        typeof log.data === 'object' && 
        'duration' in log.data
      )).toBe(true);
    });
  });

  describe('Complete Workflow', () => {
    it('should handle full rendering pipeline', () => {
      // 1. Create layers
      const layers = ['anatomical', 'functional', 'overlay'].map(name => {
        const data = new Float32Array(64 * 64 * 32);
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.random();
        }
        const vol = new FloatNeuroVol(testSpace, data);
        return new VolLayer(name, vol, grayscaleColorMap);
      });
      
      // 2. Create volume stack with layers
      const volStack = new VolStack(...layers);
      
      // 3. Create image layer with options
      const imageLayer = new ImageLayer(volStack, {
        strategy: 'auto',
        enableCache: true,
        maintainAspectRatio: false
      });
      
      // 4. Update layer properties
      imageLayer.updateLayer('functional', {
        alpha: 0.7,
        range: [0, 1000],
        colormap: 'hot'
      });
      
      // 5. Render multiple slices
      const container = new PIXI.Container();
      const axes = [AxisSet3D.AXIAL_LPI, AxisSet3D.SAGITTAL_PIL, AxisSet3D.CORONAL_LIP];
      
      axes.forEach((axis, index) => {
        const result = imageLayer.renderSlice(
          index * 10,
          [32, 32, 16],
          axis,
          container
        );
        expect(result).toBeDefined();
      });
      
      // 6. Check resource usage
      const memStats = imageLayer.getMemoryStats();
      expect(memStats.textureMemory.count).toBeGreaterThan(0);
      expect(memStats.pools.spritePool.activeCount).toBeGreaterThanOrEqual(0);
      
      // 7. Cleanup
      imageLayer.dispose();
      
      // 8. Verify cleanup
      const finalMemStats = imageLayer.getMemoryStats();
      expect(finalMemStats.textureMemory.count).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid operations gracefully', () => {
      const volLayer = new VolLayer('test', testVolume, grayscaleColorMap, [0, 1]);
      const volStack = new VolStack(volLayer);
      const imageLayer = new ImageLayer(volStack);
      
      // Try to update non-existent layer
      expect(() => {
        imageLayer.updateLayer('non-existent', { alpha: 0.5 });
      }).not.toThrow();
      
      // Try to render with valid stack - should not throw
      const container = new PIXI.Container();
      expect(() => {
        imageLayer.renderSlice(0, [0, 0, 0], AxisSet3D.fromStr('XYZ'), container);
      }).not.toThrow();
    });
  });
});
