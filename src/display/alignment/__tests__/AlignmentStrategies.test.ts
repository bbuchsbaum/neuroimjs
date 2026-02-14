/**
 * Test suite for individual alignment strategies
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CenterAlignmentStrategy } from '../CenterAlignmentStrategy';
import { CornerAlignmentStrategy } from '../CornerAlignmentStrategy';
import { OverlapAlignmentStrategy } from '../OverlapAlignmentStrategy';
import { ImageSlice } from '../../ImageSlice';
import { AxisSet2D } from '../../../geometry/Axis';
import * as PIXI from 'pixi.js';

// Helper function to create mock ImageSlice
class MockImageSlice extends ImageSlice {
  private _bounds: [number, number][];
  constructor(imageData: ImageData, boundingBox: any, spacing: number[], axes: any, bounds: [number, number][]) {
    super(imageData, boundingBox, spacing, axes);
    this._bounds = bounds as any;
  }
  get bounds(): [number, number][] {
    return this._bounds as any;
  }
}

function createMockImageSlice(
  width: number,
  height: number,
  bounds: [[number, number], [number, number], [number, number], [number, number]],
  spacing: [number, number]
): ImageSlice {
  const imageData = new ImageData(width, height);
  const xs = bounds.map(b => b[0]);
  const ys = bounds.map(b => b[1]);
  const boundingBox = {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys)
  };
  const axes = AxisSet2D.AXIAL_LP;
  return new MockImageSlice(imageData, boundingBox, spacing, axes, bounds);
}

describe('CenterAlignmentStrategy', () => {
  let strategy: CenterAlignmentStrategy;
  
  beforeEach(() => {
    strategy = new CenterAlignmentStrategy();
  });
  
  it('should align centers of slices', () => {
    const refSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]], // Center at (5, 5)
      [0.1, 0.1]
    );
    
    const targetSlice = createMockImageSlice(
      100, 100,
      [[10, 10], [20, 10], [20, 20], [10, 20]], // Center at (15, 15)
      [0.1, 0.1]
    );
    
    const result = strategy.align(targetSlice, refSlice);
    
    // The offset in world coordinates is (15-5, 15-5) = (10, 10)
    // In pixel space: 10/0.1 = 100 pixels
    expect(result.position.x).toBe(50 + 100); // refWidth/2 + offsetX
    expect(result.position.y).toBe(50 - 100); // refHeight/2 - offsetY (flipped for PIXI)
    expect(result.scale.x).toBe(1); // Same spacing
    expect(result.scale.y).toBe(1);
  });
  
  it('should handle different spacings', () => {
    const refSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [0.1, 0.1]
    );
    
    const targetSlice = createMockImageSlice(
      50, 50,
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [0.2, 0.2] // 2x spacing
    );
    
    const result = strategy.align(targetSlice, refSlice);
    
    // Physical size matching: scale = refSpacing / targetSpacing = 0.1 / 0.2 = 0.5
    expect(result.scale.x).toBe(0.5);
    expect(result.scale.y).toBe(0.5);
  });
  
  it('should respect custom anchor points', () => {
    const refSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [0.1, 0.1]
    );
    
    const targetSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [0.1, 0.1]
    );
    
    const result = strategy.align(targetSlice, refSlice, {
      anchor: { x: 0, y: 0 } // Top-left anchor
    });
    
    expect(result.pivot.x).toBe(0);
    expect(result.pivot.y).toBe(0);
    expect(result.position.x).toBe(0);
    expect(result.position.y).toBe(0);
  });
});

describe('CornerAlignmentStrategy', () => {
  let strategy: CornerAlignmentStrategy;
  
  beforeEach(() => {
    strategy = new CornerAlignmentStrategy();
  });
  
  it('should align bottom-left corners', () => {
    const refSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [0.1, 0.1]
    );
    
    const targetSlice = createMockImageSlice(
      100, 100,
      [[5, 5], [15, 5], [15, 15], [5, 15]], // Offset by (5, 5)
      [0.1, 0.1]
    );
    
    const result = strategy.align(targetSlice, refSlice);
    
    // Bottom-left offset is (5-0, 5-0) = (5, 5) in world coords
    // In pixels: 5/0.1 = 50
    expect(result.position.x).toBe(-50); // Negative to align corners
    expect(result.position.y).toBe(100 + 50); // refHeight - offsetY
    expect(result.pivot.x).toBe(0); // Bottom-left pivot
    expect(result.pivot.y).toBe(100);
  });
  
  it('should scale based on world dimensions', () => {
    const refSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]], // 10x10 world units
      [0.1, 0.1]
    );
    
    const targetSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [5, 0], [5, 5], [0, 5]], // 5x5 world units
      [0.05, 0.05]
    );
    
    const result = strategy.align(targetSlice, refSlice);
    
    // CornerAlignmentStrategy scales based on world dimensions AND pixel spacing
    // ref world size: 10x10, target world size: 5x5, world scale = 10/5 = 2
    // But also accounts for pixel spacing: tarSx/refSx = 0.05/0.1 = 0.5
    // Final scale = worldScale * spacingRatio = 2 * 0.5 = 1
    expect(result.scale.x).toBe(1);
    expect(result.scale.y).toBe(1);
  });
  
  it('should calculate rotation when allowed', () => {
    const refSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]], // Axis-aligned
      [0.1, 0.1]
    );
    
    const targetSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [0, 10], [-10, 10], [-10, 0]], // 90 degree rotation
      [0.1, 0.1]
    );
    
    const result = strategy.align(targetSlice, refSlice, {
      allowRotation: true
    });
    
    expect(result.rotation).toBeDefined();
    // Target is rotated 90 degrees CCW, so rotation should be -π/2 to align with reference
    expect(Math.abs(result.rotation! + Math.PI/2)).toBeLessThan(0.01);
  });
});

describe('OverlapAlignmentStrategy', () => {
  let strategy: OverlapAlignmentStrategy;
  
  beforeEach(() => {
    strategy = new OverlapAlignmentStrategy();
  });
  
  it('should detect overlapping slices', () => {
    const refSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [0.1, 0.1]
    );
    
    const overlappingSlice = createMockImageSlice(
      100, 100,
      [[5, 5], [15, 5], [15, 15], [5, 15]],
      [0.1, 0.1]
    );
    
    const nonOverlappingSlice = createMockImageSlice(
      100, 100,
      [[20, 20], [30, 20], [30, 30], [20, 30]],
      [0.1, 0.1]
    );
    
    expect(strategy.canHandle(overlappingSlice, refSlice)).toBe(true);
    expect(strategy.canHandle(nonOverlappingSlice, refSlice)).toBe(false);
  });
  
  it('should align based on overlap center', () => {
    const refSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [0.1, 0.1]
    );
    
    const targetSlice = createMockImageSlice(
      100, 100,
      [[5, 5], [15, 5], [15, 15], [5, 15]], // Overlaps from (5,5) to (10,10)
      [0.1, 0.1]
    );
    
    const result = strategy.align(targetSlice, refSlice);
    
    // Overlap center is at (7.5, 7.5) in world coords
    // This is 75% through reference bounds and 25% through target bounds
    expect(result.pivot.x).toBe(25); // 25% of target width
    expect(result.pivot.y).toBe(25);
    expect(result.position.x).toBe(75); // 75% of reference width
    expect(result.position.y).toBe(25); // Flipped for PIXI
  });
  
  it('should adjust scale for overlap visibility', () => {
    const refSlice = createMockImageSlice(
      100, 100,
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [0.1, 0.1] // 100 pixels = 10 world units
    );
    
    const targetSlice = createMockImageSlice(
      50, 50,
      [[5, 5], [10, 5], [10, 10], [5, 10]], // 5x5 world units
      [0.1, 0.1] // 50 pixels = 5 world units
    );
    
    const result = strategy.align(targetSlice, refSlice);
    
    // The overlap region is 5x5 world units
    // In reference: 50 pixels, in target: 50 pixels
    // Base scale is 1 (same spacing), overlap scale is also 1
    expect(result.scale.x).toBe(1); // Average of base and overlap scale
    expect(result.scale.y).toBe(1);
  });
});

describe('Strategy Apply Alignment', () => {
  it('should apply alignment result to sprite', () => {
    const sprite = new PIXI.Sprite();
    const alignment = {
      position: { x: 100, y: 200 },
      scale: { x: 2, y: 3 },
      pivot: { x: 50, y: 50 },
      rotation: Math.PI / 4
    };
    
    const strategy = new CenterAlignmentStrategy();
    strategy.applyAlignment(sprite, alignment);
    
    expect(sprite.position.x).toBe(100);
    expect(sprite.position.y).toBe(200);
    expect(sprite.scale.x).toBe(2);
    expect(sprite.scale.y).toBe(3);
    expect(sprite.pivot.x).toBe(50);
    expect(sprite.pivot.y).toBe(50);
    expect(sprite.rotation).toBe(Math.PI / 4);
  });
});
