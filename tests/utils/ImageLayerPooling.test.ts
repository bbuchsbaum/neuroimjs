import { describe, it, expect, vi } from 'vitest';
import { SpritePool } from '../../src/utils/SpritePool';
import { ContainerPool } from '../../src/utils/ContainerPool';
import * as PIXI from 'pixi.js';

// Mock PIXI
vi.mock('pixi.js', () => ({
  Sprite: vi.fn(() => ({
    visible: true,
    alpha: 1,
    scale: { set: vi.fn() },
    anchor: { set: vi.fn() },
    pivot: { set: vi.fn() },
    position: { set: vi.fn() },
    rotation: 0,
    tint: 0xFFFFFF,
    texture: null,
    parent: null,
    destroy: vi.fn(),
  })),
  Container: vi.fn(() => ({
    visible: true,
    alpha: 1,
    scale: { set: vi.fn() },
    position: { set: vi.fn() },
    pivot: { set: vi.fn() },
    rotation: 0,
    parent: null,
    children: [],
    addChild: vi.fn(function(child) { this.children.push(child); }),
    removeChild: vi.fn(function(child) { 
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
    }),
    removeChildren: vi.fn(function() { this.children = []; }),
    destroy: vi.fn(),
  })),
  Texture: {
    EMPTY: 'EMPTY_TEXTURE',
  },
  CanvasSource: vi.fn(() => ({})),
}));

describe('ImageLayer with Pooling', () => {
  it('should demonstrate sprite pooling reduces object creation', () => {
    const spritePool = new SpritePool(10);
    
    // Simulate multiple render cycles
    const cycles = 50;
    const spritesPerCycle = 5;
    
    for (let cycle = 0; cycle < cycles; cycle++) {
      const sprites: PIXI.Sprite[] = [];
      
      // Acquire sprites for this render cycle
      for (let i = 0; i < spritesPerCycle; i++) {
        sprites.push(spritePool.acquire());
      }
      
      // Release sprites back to pool
      sprites.forEach(sprite => spritePool.release(sprite));
    }
    
    const stats = spritePool.getStats();
    console.log('Sprite Pool Stats after', cycles, 'cycles:', stats);
    
    // Verify pooling efficiency
    expect(stats.createCount).toBeLessThanOrEqual(10); // Should not exceed pool size
    expect(stats.reuseCount).toBeGreaterThan(200); // Should have many reuses
    expect(stats.reuseRatio).toBeGreaterThan(0.95); // >95% reuse rate
  });

  it('should demonstrate container pooling reduces object creation', () => {
    const containerPool = new ContainerPool(5);
    
    // Simulate multiple render cycles
    const cycles = 30;
    
    for (let cycle = 0; cycle < cycles; cycle++) {
      // Acquire container for this render cycle
      const container = containerPool.acquire();
      
      // Add some mock children
      for (let i = 0; i < 3; i++) {
        container.addChild(new (PIXI.Sprite as any)());
      }
      
      // Release container back to pool
      containerPool.release(container);
    }
    
    const stats = containerPool.getStats();
    console.log('Container Pool Stats after', cycles, 'cycles:', stats);
    
    // Verify pooling efficiency
    expect(stats.createCount).toBeLessThanOrEqual(5); // Should not exceed pool size
    expect(stats.reuseCount).toBeGreaterThan(25); // Should have many reuses
    expect(stats.reuseRatio).toBeGreaterThan(0.85); // >85% reuse rate
  });

  it('should show performance comparison with and without pooling', () => {
    // Without pooling
    const startNoPool = performance.now();
    const spritesNoPool: any[] = [];
    
    for (let i = 0; i < 1000; i++) {
      spritesNoPool.push(new (PIXI.Sprite as any)());
    }
    
    const durationNoPool = performance.now() - startNoPool;
    
    // With pooling
    const pool = new SpritePool(50);
    const startWithPool = performance.now();
    
    for (let i = 0; i < 1000; i++) {
      const sprite = pool.acquire();
      pool.release(sprite);
    }
    
    const durationWithPool = performance.now() - startWithPool;
    
    console.log('Performance comparison:');
    console.log('  Without pooling:', durationNoPool.toFixed(2), 'ms');
    console.log('  With pooling:', durationWithPool.toFixed(2), 'ms');
    console.log('  Improvement:', ((1 - durationWithPool/durationNoPool) * 100).toFixed(1), '%');
    
    const stats = pool.getStats();
    console.log('Pool stats:', stats);
    
    // With pooling should be faster
    expect(durationWithPool).toBeLessThan(durationNoPool);
  });
});