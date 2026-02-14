import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContainerPool } from '../../src/utils/ContainerPool';
import * as PIXI from 'pixi.js';

// Mock PIXI
vi.mock('pixi.js', () => {
  const createMockContainer = () => ({
    visible: true,
    alpha: 1,
    scale: { set: vi.fn() },
    position: { set: vi.fn() },
    pivot: { set: vi.fn() },
    rotation: 0,
    parent: null,
    removeChildren: vi.fn(),
    destroy: vi.fn(),
  });

  return {
    Container: vi.fn(() => createMockContainer()),
  };
});

describe('ContainerPool', () => {
  let pool: ContainerPool;

  beforeEach(() => {
    pool = new ContainerPool(3);
    vi.clearAllMocks();
  });

  afterEach(() => {
    pool.clear();
  });

  describe('acquire', () => {
    it('should create a new container when pool is empty', () => {
      const container = pool.acquire();
      
      expect(container).toBeDefined();
      expect(PIXI.Container).toHaveBeenCalledTimes(1);
      
      const stats = pool.getStats();
      expect(stats.createCount).toBe(1);
      expect(stats.reuseCount).toBe(0);
      expect(stats.activeCount).toBe(1);
    });

    it('should reuse containers from pool', () => {
      const container1 = pool.acquire();
      pool.release(container1);
      
      const container2 = pool.acquire();
      
      expect(container1).toBe(container2);
      expect(PIXI.Container).toHaveBeenCalledTimes(1);
      
      const stats = pool.getStats();
      expect(stats.createCount).toBe(1);
      expect(stats.reuseCount).toBe(1);
    });

    it('should reset container properties when reusing', () => {
      const container = pool.acquire();
      
      // Modify container properties
      container.visible = false;
      container.alpha = 0.5;
      container.rotation = Math.PI;
      
      pool.release(container);
      const reusedContainer = pool.acquire();
      
      expect(reusedContainer.visible).toBe(true);
      expect(reusedContainer.alpha).toBe(1);
      expect(reusedContainer.rotation).toBe(0);
      expect(reusedContainer.scale.set).toHaveBeenCalledWith(1, 1);
      expect(reusedContainer.position.set).toHaveBeenCalledWith(0, 0);
      expect(reusedContainer.pivot.set).toHaveBeenCalledWith(0, 0);
    });

    it('should clear children when reusing', () => {
      const container = pool.acquire();
      pool.release(container);
      
      container.removeChildren.mockClear();
      pool.acquire();
      
      expect(container.removeChildren).toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('should return container to pool', () => {
      const container = pool.acquire();
      
      let stats = pool.getStats();
      expect(stats.activeCount).toBe(1);
      expect(stats.poolSize).toBe(0);
      
      pool.release(container);
      
      stats = pool.getStats();
      expect(stats.activeCount).toBe(0);
      expect(stats.poolSize).toBe(1);
    });

    it('should clear container children', () => {
      const container = pool.acquire();
      container.removeChildren.mockClear();
      
      pool.release(container);
      
      expect(container.removeChildren).toHaveBeenCalled();
      expect(container.visible).toBe(false);
    });

    it('should remove container from parent if attached', () => {
      const container = pool.acquire();
      const mockParent = {
        removeChild: vi.fn(),
      };
      container.parent = mockParent as any;
      
      pool.release(container);
      
      expect(mockParent.removeChild).toHaveBeenCalledWith(container);
    });

    it('should warn when releasing non-pool container', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const externalContainer = new (PIXI.Container as any)();
      
      pool.release(externalContainer);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Attempting to release a container that was not acquired from this pool'
      );
      
      consoleSpy.mockRestore();
    });

    it('should destroy containers beyond pool size limit', () => {
      const containers: any[] = [];
      
      // Acquire 4 containers (one more than pool max size)
      for (let i = 0; i < 4; i++) {
        containers.push(pool.acquire());
      }
      
      // Release all containers - only first 3 should be kept in pool
      containers.forEach(container => pool.release(container));
      
      // Pool should be at max size, 4th container should be destroyed
      const stats = pool.getStats();
      expect(stats.poolSize).toBe(3);
      expect(containers[3].destroy).toHaveBeenCalledWith({ children: true });
      
      // First 3 containers should not be destroyed
      for (let i = 0; i < 3; i++) {
        expect(containers[i].destroy).not.toHaveBeenCalled();
      }
    });
  });

  describe('releaseAll', () => {
    it('should release all active containers', () => {
      const containers = [pool.acquire(), pool.acquire()];
      
      let stats = pool.getStats();
      expect(stats.activeCount).toBe(2);
      
      pool.releaseAll();
      
      stats = pool.getStats();
      expect(stats.activeCount).toBe(0);
      expect(stats.poolSize).toBe(2);
    });
  });

  describe('clear', () => {
    it('should destroy all containers and clear pool', () => {
      const containers = [pool.acquire(), pool.acquire()];
      pool.release(containers[0]);
      
      pool.clear();
      
      const stats = pool.getStats();
      expect(stats.poolSize).toBe(0);
      expect(stats.activeCount).toBe(0);
      expect(containers[0].destroy).toHaveBeenCalledWith({ children: true });
      expect(containers[1].destroy).toHaveBeenCalledWith({ children: true });
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const container1 = pool.acquire();
      const container2 = pool.acquire();
      pool.release(container1);
      const container3 = pool.acquire(); // Reused
      
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
      pool.resize(5);
      
      // Fill with more than original size
      const containers: any[] = [];
      for (let i = 0; i < 5; i++) {
        containers.push(pool.acquire());
      }
      
      containers.forEach(container => pool.release(container));
      
      const stats = pool.getStats();
      expect(stats.poolSize).toBe(5);
    });

    it('should destroy excess containers when downsizing', () => {
      const containers: any[] = [];
      for (let i = 0; i < 3; i++) {
        containers.push(pool.acquire());
      }
      
      // Release containers in order
      containers.forEach(container => pool.release(container));
      
      // Check pool size before resize
      let stats = pool.getStats();
      expect(stats.poolSize).toBe(3);
      expect(stats.activeCount).toBe(0);
      
      // Resize pool to 1
      pool.resize(1);
      
      stats = pool.getStats();
      expect(stats.poolSize).toBe(1);
      
      // Check that 2 containers were destroyed
      let destroyedCount = 0;
      containers.forEach((container) => {
        if ((container.destroy as any).mock.calls.length > 0) {
          destroyedCount++;
          // Verify it was called with correct args
          expect(container.destroy).toHaveBeenCalledWith({ children: true });
        }
      });
      
      expect(destroyedCount).toBe(2);
    });
  });
});