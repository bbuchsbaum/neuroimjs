/**
 * Test suite for AlignmentManager
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AlignmentManager } from '../AlignmentManager';
import { ImageSlice } from '../../ImageSlice';
import { CenterAlignmentStrategy } from '../CenterAlignmentStrategy';
import { CornerAlignmentStrategy } from '../CornerAlignmentStrategy';
import { OverlapAlignmentStrategy } from '../OverlapAlignmentStrategy';
import { AxisSet2D } from '../../../geometry/Axis';
import * as PIXI from 'pixi.js';

// Helper function to create mock ImageSlice
function createMockImageSlice(
  width: number,
  height: number,
  bounds: [[number, number], [number, number], [number, number], [number, number]],
  spacing: [number, number]
): ImageSlice {
  const imageData = new ImageData(width, height);
  const boundingBox = {
    xMin: bounds[0][0],
    xMax: bounds[1][0],
    yMin: bounds[2][0],
    yMax: bounds[3][0]
  };
  const axes = AxisSet2D.AXIAL_LP;
  return new ImageSlice(imageData, boundingBox, spacing, axes);
}

describe('AlignmentManager', () => {
  let manager: AlignmentManager;
  
  beforeEach(() => {
    manager = new AlignmentManager();
  });
  
  describe('Strategy Registration', () => {
    it('should have built-in strategies registered', () => {
      expect(manager.getStrategy('center')).toBeInstanceOf(CenterAlignmentStrategy);
      expect(manager.getStrategy('corner')).toBeInstanceOf(CornerAlignmentStrategy);
      expect(manager.getStrategy('overlap')).toBeInstanceOf(OverlapAlignmentStrategy);
    });
    
    it('should allow registering custom strategies', () => {
      const customStrategy = {
        getName: () => 'custom',
        canHandle: () => true,
        align: () => ({
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          pivot: { x: 0, y: 0 }
        }),
        applyAlignment: () => {}
      };
      
      manager.registerStrategy(customStrategy);
      expect(manager.getStrategy('custom')).toBe(customStrategy);
    });
  });
  
  describe('Automatic Strategy Selection', () => {
    it('should select overlap strategy for overlapping slices', () => {
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[5, 5], [15, 5], [15, 15], [5, 15]], // 50% overlap
        [0.1, 0.1]
      );
      
      const strategy = manager.selectBestStrategy(targetSlice, refSlice);
      expect(strategy.getName()).toBe('overlap');
    });
    
    it('should select corner strategy for large resolution differences', () => {
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[20, 20], [30, 20], [30, 30], [20, 30]], // No overlap with reference
        [0.5, 0.5] // 5x resolution difference
      );
      
      const strategy = manager.selectBestStrategy(targetSlice, refSlice);
      expect(strategy.getName()).toBe('corner');
    });
    
    it('should select center strategy for similar slices', () => {
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[20, 20], [30, 20], [30, 30], [20, 30]], // No overlap
        [0.15, 0.15] // Similar resolution
      );
      
      const strategy = manager.selectBestStrategy(targetSlice, refSlice);
      expect(strategy.getName()).toBe('center');
    });
  });
  
  describe('Sprite Alignment', () => {
    it('should align sprite using specified strategy', () => {
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.2, 0.2]
      );
      
      const sprite = new PIXI.Sprite();
      
      const result = manager.alignSprite(sprite, targetSlice, refSlice, {
        strategy: 'center'
      });
      
      // Physical size matching: when target has larger spacing (0.2), it needs to be scaled DOWN (0.5x)
      // to match reference spacing (0.1), so that physical dimensions are preserved
      expect(result.scale.x).toBe(0.5); // refSpacing / targetSpacing = 0.1 / 0.2
      expect(result.scale.y).toBe(0.5);
      expect(sprite.scale.x).toBe(0.5);
      expect(sprite.scale.y).toBe(0.5);
    });
    
    it('should use auto strategy when not specified', () => {
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.2, 0.2]
      );
      
      const sprite = new PIXI.Sprite();
      
      const result = manager.alignSprite(sprite, targetSlice, refSlice);
      
      expect(result).toBeDefined();
      expect(sprite.position).toBeDefined();
      expect(sprite.scale).toBeDefined();
      expect(sprite.pivot).toBeDefined();
    });
  });
  
  describe('Caching', () => {
    it('should cache alignment results when enabled', () => {
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.2, 0.2]
      );
      
      const sprite1 = new PIXI.Sprite();
      const sprite2 = new PIXI.Sprite();
      
      // First call
      manager.alignSprite(sprite1, targetSlice, refSlice, { enableCache: true });
      expect(manager.getCacheStats().size).toBe(1);
      
      // Second call with same parameters should use cache
      manager.alignSprite(sprite2, targetSlice, refSlice, { enableCache: true });
      expect(manager.getCacheStats().size).toBe(1); // Still 1, used cached result
    });
    
    it('should not cache when disabled', () => {
      manager.setCacheEnabled(false);
      
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.2, 0.2]
      );
      
      const sprite = new PIXI.Sprite();
      
      manager.alignSprite(sprite, targetSlice, refSlice);
      expect(manager.getCacheStats().size).toBe(0);
      expect(manager.getCacheStats().enabled).toBe(false);
    });
    
    it('should clear cache when requested', () => {
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.2, 0.2]
      );
      
      const sprite = new PIXI.Sprite();
      
      manager.alignSprite(sprite, targetSlice, refSlice);
      expect(manager.getCacheStats().size).toBe(1);
      
      manager.clearCache();
      expect(manager.getCacheStats().size).toBe(0);
    });
  });
  
  describe('Alignment Options', () => {
    it('should respect aspect ratio constraint', () => {
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.2, 0.4] // Different X and Y scaling
      );
      
      const sprite = new PIXI.Sprite();
      
      const result = manager.alignSprite(sprite, targetSlice, refSlice, {
        strategy: 'center',
        maintainAspectRatio: true
      });
      
      // Physical size matching: ref spacing 0.1, target spacing 0.2 (X) and 0.4 (Y)
      // scaleX = 0.1 / 0.2 = 0.5, scaleY = 0.1 / 0.4 = 0.25
      // With aspect ratio maintained, should use geometric mean
      const expectedScale = Math.sqrt(0.5 * 0.25); // sqrt(scaleX * scaleY) = sqrt(0.125) ≈ 0.354
      expect(result.scale.x).toBeCloseTo(expectedScale);
      expect(result.scale.y).toBeCloseTo(expectedScale);
    });
    
    it('should respect scale limits', () => {
      const refSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [0.1, 0.1]
      );
      
      const targetSlice = createMockImageSlice(
        100, 100,
        [[0, 0], [10, 0], [10, 10], [0, 10]],
        [2, 2] // Target spacing is 20x larger than reference
      );
      
      const sprite = new PIXI.Sprite();
      
      const result = manager.alignSprite(sprite, targetSlice, refSlice, {
        strategy: 'center',
        maxScale: 5,
        minScale: 0.5
      });
      
      // Physical size matching: scale = 0.1 / 2 = 0.05
      // But this is below minScale of 0.5, so should be clamped
      expect(result.scale.x).toBe(0.5); // Clamped to minScale
      expect(result.scale.y).toBe(0.5);
    });
  });
});