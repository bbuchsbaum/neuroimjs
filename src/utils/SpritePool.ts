import * as PIXI from 'pixi.js';

/**
 * A pool of reusable PIXI.Sprite objects to reduce garbage collection pressure
 * and improve rendering performance.
 */
export class SpritePool {
  private pool: PIXI.Sprite[] = [];
  private activeSprites: Set<PIXI.Sprite> = new Set();
  private maxPoolSize: number;
  private createCount: number = 0;
  private reuseCount: number = 0;

  /**
   * Creates a new SpritePool
   * @param maxPoolSize Maximum number of sprites to keep in the pool (default: 100)
   */
  constructor(maxPoolSize: number = 100) {
    this.maxPoolSize = maxPoolSize;
  }

  /**
   * Gets a sprite from the pool or creates a new one if the pool is empty
   * @param texture Optional texture to set on the sprite
   * @returns A PIXI.Sprite instance
   */
  acquire(texture?: PIXI.Texture): PIXI.Sprite {
    let sprite: PIXI.Sprite;

    if (this.pool.length > 0) {
      sprite = this.pool.pop()!;
      this.reuseCount++;
      
      // Reset sprite properties to defaults
      sprite.visible = true;
      sprite.alpha = 1;
      sprite.scale.set(1, 1);
      sprite.anchor.set(0, 0);
      sprite.rotation = 0;
      sprite.tint = 0xFFFFFF;
      
      if (texture) {
        sprite.texture = texture;
      }
    } else {
      sprite = new PIXI.Sprite(texture);
      this.createCount++;
      
      // Ensure texture is set even for new sprites
      if (texture) {
        sprite.texture = texture;
      }
    }

    this.activeSprites.add(sprite);
    return sprite;
  }

  /**
   * Returns a sprite to the pool for reuse
   * @param sprite The sprite to release
   */
  release(sprite: PIXI.Sprite): void {
    if (!this.activeSprites.has(sprite)) {
      console.warn('Attempting to release a sprite that was not acquired from this pool');
      return;
    }

    this.activeSprites.delete(sprite);

    // Only keep sprites in pool up to maxPoolSize
    if (this.pool.length < this.maxPoolSize) {
      // Reset sprite to minimize memory usage
      sprite.texture = PIXI.Texture.EMPTY;
      sprite.visible = false;
      
      // Remove from parent if attached
      if (sprite.parent) {
        sprite.parent.removeChild(sprite);
      }

      this.pool.push(sprite);
    } else {
      // Destroy sprites beyond pool size limit
      sprite.destroy();
    }
  }

  /**
   * Releases all active sprites back to the pool
   */
  releaseAll(): void {
    const activeSprites = Array.from(this.activeSprites);
    activeSprites.forEach(sprite => this.release(sprite));
  }

  /**
   * Clears the pool and destroys all sprites
   */
  clear(): void {
    // Release all active sprites first
    this.releaseAll();

    // Destroy all pooled sprites
    this.pool.forEach(sprite => sprite.destroy());
    this.pool = [];
  }

  /**
   * Gets statistics about pool usage
   */
  getStats(): {
    poolSize: number;
    activeCount: number;
    createCount: number;
    reuseCount: number;
    reuseRatio: number;
  } {
    const totalUse = this.createCount + this.reuseCount;
    return {
      poolSize: this.pool.length,
      activeCount: this.activeSprites.size,
      createCount: this.createCount,
      reuseCount: this.reuseCount,
      reuseRatio: totalUse > 0 ? this.reuseCount / totalUse : 0
    };
  }

  /**
   * Resizes the pool, destroying excess sprites if necessary
   * @param newMaxSize New maximum pool size
   */
  resize(newMaxSize: number): void {
    this.maxPoolSize = newMaxSize;
    
    // Remove excess sprites if pool is too large
    while (this.pool.length > this.maxPoolSize) {
      const sprite = this.pool.pop();
      if (sprite) {
        sprite.destroy();
      }
    }
  }
}