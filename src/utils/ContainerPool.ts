import * as PIXI from 'pixi.js';

/**
 * A pool of reusable PIXI.Container objects to reduce garbage collection pressure
 * and improve rendering performance.
 */
export class ContainerPool {
  private pool: PIXI.Container[] = [];
  private activeContainers: Set<PIXI.Container> = new Set();
  private maxPoolSize: number;
  private createCount: number = 0;
  private reuseCount: number = 0;

  /**
   * Creates a new ContainerPool
   * @param maxPoolSize Maximum number of containers to keep in the pool (default: 50)
   */
  constructor(maxPoolSize: number = 50) {
    this.maxPoolSize = maxPoolSize;
  }

  /**
   * Gets a container from the pool or creates a new one if the pool is empty
   * @returns A PIXI.Container instance
   */
  acquire(): PIXI.Container {
    let container: PIXI.Container;

    if (this.pool.length > 0) {
      container = this.pool.pop()!;
      this.reuseCount++;
      
      // Reset container properties to defaults
      container.visible = true;
      container.alpha = 1;
      container.scale.set(1, 1);
      container.position.set(0, 0);
      container.rotation = 0;
      container.pivot.set(0, 0);
      
      // Ensure container is empty
      container.removeChildren();
    } else {
      container = new PIXI.Container();
      this.createCount++;
    }

    this.activeContainers.add(container);
    return container;
  }

  /**
   * Returns a container to the pool for reuse
   * @param container The container to release
   */
  release(container: PIXI.Container): void {
    if (!this.activeContainers.has(container)) {
      console.warn('Attempting to release a container that was not acquired from this pool');
      return;
    }

    this.activeContainers.delete(container);

    // Only keep containers in pool up to maxPoolSize
    if (this.pool.length < this.maxPoolSize) {
      // Clear container to minimize memory usage
      container.removeChildren();
      container.visible = false;
      
      // Remove from parent if attached
      if (container.parent) {
        container.parent.removeChild(container);
      }

      this.pool.push(container);
    } else {
      // Destroy containers beyond pool size limit
      container.destroy({ children: true });
    }
  }

  /**
   * Releases all active containers back to the pool
   */
  releaseAll(): void {
    const activeContainers = Array.from(this.activeContainers);
    activeContainers.forEach(container => this.release(container));
  }

  /**
   * Clears the pool and destroys all containers
   */
  clear(): void {
    // Release all active containers first
    this.releaseAll();

    // Destroy all pooled containers
    this.pool.forEach(container => container.destroy({ children: true }));
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
      activeCount: this.activeContainers.size,
      createCount: this.createCount,
      reuseCount: this.reuseCount,
      reuseRatio: totalUse > 0 ? this.reuseCount / totalUse : 0
    };
  }

  /**
   * Resizes the pool, destroying excess containers if necessary
   * @param newMaxSize New maximum pool size
   */
  resize(newMaxSize: number): void {
    this.maxPoolSize = newMaxSize;
    
    // Remove excess containers if pool is too large
    while (this.pool.length > this.maxPoolSize) {
      const container = this.pool.pop();
      if (container) {
        container.destroy({ children: true });
      }
    }
  }
}