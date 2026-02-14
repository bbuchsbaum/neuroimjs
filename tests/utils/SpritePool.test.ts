import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SpritePool } from '../../src/utils/SpritePool';
import * as PIXI from 'pixi.js';

// Mock PIXI
vi.mock('pixi.js', () => {
  const createMockSprite = () => {
    const sprite = {
      visible: true,
      alpha: 1,
      scale: { set: vi.fn() },
      anchor: { set: vi.fn() },
      rotation: 0,
      tint: 0xFFFFFF,
      texture: null,
      parent: null,
      destroy: vi.fn(),
    };
    // Allow texture to be set
    Object.defineProperty(sprite, 'texture', {
      writable: true,
      value: null
    });
    return sprite;
  };

  const mockTexture = {
    EMPTY: 'EMPTY_TEXTURE',
  };

  return {
    Sprite: vi.fn((texture) => {
      const sprite = createMockSprite();
      if (texture) {
        sprite.texture = texture;
      }
      return sprite;
    }),
    Texture: mockTexture,
  };
});

describe('SpritePool', () => {
  let pool: SpritePool;

  beforeEach(() => {
    pool = new SpritePool(5);
    vi.clearAllMocks();
  });

  afterEach(() => {
    pool.clear();
  });

  describe('acquire', () => {
    it('should create a new sprite when pool is empty', () => {
      const sprite = pool.acquire();
      
      expect(sprite).toBeDefined();
      expect(PIXI.Sprite).toHaveBeenCalledTimes(1);
      
      const stats = pool.getStats();
      expect(stats.createCount).toBe(1);
      expect(stats.reuseCount).toBe(0);
      expect(stats.activeCount).toBe(1);
    });

    it('should reuse sprites from pool', () => {
      const sprite1 = pool.acquire();
      pool.release(sprite1);
      
      const sprite2 = pool.acquire();
      
      expect(sprite1).toBe(sprite2);
      expect(PIXI.Sprite).toHaveBeenCalledTimes(1);
      
      const stats = pool.getStats();
      expect(stats.createCount).toBe(1);
      expect(stats.reuseCount).toBe(1);
    });

    it('should reset sprite properties when reusing', () => {
      const sprite = pool.acquire();
      
      // Modify sprite properties
      sprite.visible = false;
      sprite.alpha = 0.5;
      sprite.rotation = Math.PI;
      sprite.tint = 0xFF0000;
      
      pool.release(sprite);
      const reusedSprite = pool.acquire();
      
      expect(reusedSprite.visible).toBe(true);
      expect(reusedSprite.alpha).toBe(1);
      expect(reusedSprite.rotation).toBe(0);
      expect(reusedSprite.tint).toBe(0xFFFFFF);
      expect(reusedSprite.scale.set).toHaveBeenCalledWith(1, 1);
      expect(reusedSprite.anchor.set).toHaveBeenCalledWith(0, 0);
    });

    it('should set texture if provided', () => {
      const mockTexture = { id: 'test-texture' };
      const sprite = pool.acquire(mockTexture as any);
      
      expect(sprite.texture).toBe(mockTexture);
    });
  });

  describe('release', () => {
    it('should return sprite to pool', () => {
      const sprite = pool.acquire();
      
      let stats = pool.getStats();
      expect(stats.activeCount).toBe(1);
      expect(stats.poolSize).toBe(0);
      
      pool.release(sprite);
      
      stats = pool.getStats();
      expect(stats.activeCount).toBe(0);
      expect(stats.poolSize).toBe(1);
    });

    it('should reset sprite texture to EMPTY', () => {
      const sprite = pool.acquire();
      sprite.texture = { id: 'some-texture' } as any;
      
      pool.release(sprite);
      
      expect(sprite.texture).toBe(PIXI.Texture.EMPTY);
      expect(sprite.visible).toBe(false);
    });

    it('should remove sprite from parent if attached', () => {
      const sprite = pool.acquire();
      const mockParent = {
        removeChild: vi.fn(),
      };
      sprite.parent = mockParent as any;
      
      pool.release(sprite);
      
      expect(mockParent.removeChild).toHaveBeenCalledWith(sprite);
    });

    it('should warn when releasing non-pool sprite', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const externalSprite = new (PIXI.Sprite as any)();
      
      pool.release(externalSprite);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Attempting to release a sprite that was not acquired from this pool'
      );
      
      consoleSpy.mockRestore();
    });

    it('should destroy sprites beyond pool size limit', () => {
      const sprites: any[] = [];
      
      // Acquire 6 sprites (one more than pool max size)
      for (let i = 0; i < 6; i++) {
        sprites.push(pool.acquire());
      }
      
      // Release all sprites - only first 5 should be kept in pool
      sprites.forEach(sprite => pool.release(sprite));
      
      // Pool should be at max size, 6th sprite should be destroyed
      const stats = pool.getStats();
      expect(stats.poolSize).toBe(5);
      expect(sprites[5].destroy).toHaveBeenCalled();
      
      // First 5 sprites should not be destroyed
      for (let i = 0; i < 5; i++) {
        expect(sprites[i].destroy).not.toHaveBeenCalled();
      }
    });
  });

  describe('releaseAll', () => {
    it('should release all active sprites', () => {
      const sprites = [pool.acquire(), pool.acquire(), pool.acquire()];
      
      let stats = pool.getStats();
      expect(stats.activeCount).toBe(3);
      
      pool.releaseAll();
      
      stats = pool.getStats();
      expect(stats.activeCount).toBe(0);
      expect(stats.poolSize).toBe(3);
    });
  });

  describe('clear', () => {
    it('should destroy all sprites and clear pool', () => {
      const sprites = [pool.acquire(), pool.acquire()];
      pool.release(sprites[0]);
      
      pool.clear();
      
      const stats = pool.getStats();
      expect(stats.poolSize).toBe(0);
      expect(stats.activeCount).toBe(0);
      expect(sprites[0].destroy).toHaveBeenCalled();
      expect(sprites[1].destroy).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const sprite1 = pool.acquire();
      const sprite2 = pool.acquire();
      pool.release(sprite1);
      const sprite3 = pool.acquire(); // Reused
      
      const stats = pool.getStats();
      expect(stats.poolSize).toBe(0);
      expect(stats.activeCount).toBe(2);
      expect(stats.createCount).toBe(2);
      expect(stats.reuseCount).toBe(1);
      expect(stats.reuseRatio).toBeCloseTo(1/3);
    });

    it('should handle zero usage', () => {
      const stats = pool.getStats();
      expect(stats.reuseRatio).toBe(0);
    });
  });

  describe('resize', () => {
    it('should update max pool size', () => {
      pool.resize(10);
      
      // Fill with more than original size
      const sprites: any[] = [];
      for (let i = 0; i < 10; i++) {
        sprites.push(pool.acquire());
      }
      
      sprites.forEach(sprite => pool.release(sprite));
      
      const stats = pool.getStats();
      expect(stats.poolSize).toBe(10);
    });

    it('should destroy excess sprites when downsizing', () => {
      const sprites: any[] = [];
      for (let i = 0; i < 5; i++) {
        sprites.push(pool.acquire());
      }
      
      // Release sprites in order
      sprites.forEach(sprite => pool.release(sprite));
      
      // Check pool size before resize
      let stats = pool.getStats();
      expect(stats.poolSize).toBe(5);
      expect(stats.activeCount).toBe(0);
      
      // Resize pool to 2
      pool.resize(2);
      
      stats = pool.getStats();
      expect(stats.poolSize).toBe(2);
      
      // Since pool is LIFO (Last In First Out), sprites are stored in reverse order
      // Released order: 0, 1, 2, 3, 4
      // Pool order (top to bottom): 4, 3, 2, 1, 0
      // When we resize to 2, we keep top 2 (4, 3) and destroy bottom 3 (2, 1, 0)
      
      // Check destroyed sprites
      let destroyedCount = 0;
      sprites.forEach((sprite, index) => {
        if ((sprite.destroy as any).mock.calls.length > 0) {
          destroyedCount++;
        }
      });
      
      expect(destroyedCount).toBe(3);
    });
  });
});