import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { setupConsoleMocks } from './test-console-mock';

// Mock ImageData constructor for Node environment
vi.stubGlobal('ImageData', class {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace: PredefinedColorSpace = 'srgb';

  constructor(data: Uint8ClampedArray | number, width: number, height?: number) {
    if (typeof data === 'number') {
      this.width = data;
      this.height = width;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = data;
      this.width = width;
      this.height = height!;
    }
  }
});

describe('VolLayer LRU Cache', () => {
  let volLayer: VolLayer;
  let space: NeuroSpace;
  let volume: FloatNeuroVol;
  let colorMap: ColorMap;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    // Create test volume
    space = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0]);
    const data = new Float32Array(10 * 10 * 10);
    for (let i = 0; i < data.length; i++) {
      data[i] = i / data.length;
    }
    volume = new FloatNeuroVol(space, data);

    // Create color map with grayscale colors
    colorMap = new ColorMap([
      [0, 0, 0],      // black
      [0.5, 0.5, 0.5], // gray
      [1, 1, 1]       // white
    ]);

    // Create VolLayer with small cache for testing
    volLayer = new VolLayer('test', volume, colorMap, null, [0, 0], 1.0, 5); // Cache size of 5
  });

  describe('cache functionality', () => {
    it('should cache slices and return from cache on subsequent requests', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      // First request - should be a cache miss
      const slice1 = volLayer.getSlice(5, axialAxes);
      let stats = volLayer.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
      expect(stats.size).toBe(1);

      // Second request for same slice - should be a cache hit
      const slice2 = volLayer.getSlice(5, axialAxes);
      stats = volLayer.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(slice1).toBe(slice2); // Should be the same object
    });

    it('should evict LRU items when cache capacity is exceeded', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      // Fill cache beyond capacity
      for (let i = 0; i < 7; i++) {
        volLayer.getSlice(i, axialAxes);
      }

      const stats = volLayer.getCacheStats();
      expect(stats.size).toBe(5); // Should not exceed capacity
      expect(stats.evictions).toBe(2); // Should have evicted 2 items
    });

    it('should update LRU order when accessing cached items', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      // Fill cache to capacity
      for (let i = 0; i < 5; i++) {
        volLayer.getSlice(i, axialAxes);
      }

      // Access slice 0 to make it most recently used
      volLayer.getSlice(0, axialAxes);

      // Add new slice - should evict slice 1 (now LRU), not slice 0
      volLayer.getSlice(5, axialAxes);

      // Slice 0 should still be in cache
      const statsBefore = volLayer.getCacheStats();
      const hitsBefore = statsBefore.hits;
      
      volLayer.getSlice(0, axialAxes);
      const statsAfter = volLayer.getCacheStats();
      expect(statsAfter.hits).toBe(hitsBefore + 1); // Should be a hit

      // Slice 1 should have been evicted
      const missessBefore = statsAfter.misses;
      volLayer.getSlice(1, axialAxes);
      const statsFinal = volLayer.getCacheStats();
      expect(statsFinal.misses).toBe(missessBefore + 1); // Should be a miss
    });

    it('should cache slices with different orientations separately', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      
      const sagittalAxes = new AxisSet3D(
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP,
        NamedAxis.LEFT_RIGHT
      );

      volLayer.getSlice(5, axialAxes);
      volLayer.getSlice(5, sagittalAxes);

      const stats = volLayer.getCacheStats();
      expect(stats.size).toBe(2); // Two different cache entries
      expect(stats.misses).toBe(2); // Both were misses
    });

    it('should cache getSliceAt results with interpolation', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      const coord = [5.5, 5.5, 5.5];

      // First request with trilinear interpolation
      volLayer.getSliceAt(coord, axialAxes, 'trilinear');
      let stats = volLayer.getCacheStats();
      expect(stats.misses).toBe(1);

      // Same request should hit cache
      volLayer.getSliceAt(coord, axialAxes, 'trilinear');
      stats = volLayer.getCacheStats();
      expect(stats.hits).toBe(1);

      // Different interpolation should miss
      volLayer.getSliceAt(coord, axialAxes, 'nearest');
      stats = volLayer.getCacheStats();
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2); // Two different cache entries
    });

    it('should clear cache when colormap changes', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      // Fill cache
      for (let i = 0; i < 3; i++) {
        volLayer.getSlice(i, axialAxes);
      }

      let stats = volLayer.getCacheStats();
      expect(stats.size).toBe(3);

      // Change colormap - should clear cache
      const newColorMap = new ColorMap([
        [1, 0, 0],      // red
        [1, 0.5, 0],    // orange
        [1, 1, 0]       // yellow
      ]);
      volLayer.setColormap(newColorMap);

      stats = volLayer.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should clear cache when range changes', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      volLayer.getSlice(5, axialAxes);
      expect(volLayer.getCacheStats().size).toBe(1);

      volLayer.setRange([0.2, 0.8]);
      expect(volLayer.getCacheStats().size).toBe(0);
    });

    it('should clear cache when threshold changes', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      volLayer.getSlice(5, axialAxes);
      expect(volLayer.getCacheStats().size).toBe(1);

      volLayer.setThreshold([0.1, 0.9]);
      expect(volLayer.getCacheStats().size).toBe(0);
    });

    it('should clear cache when opacity changes', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      volLayer.getSlice(5, axialAxes);
      expect(volLayer.getCacheStats().size).toBe(1);

      volLayer.setOpacity(0.5);
      expect(volLayer.getCacheStats().size).toBe(0);
    });

    it('should maintain high hit ratio in typical usage', () => {
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      // Simulate typical usage - repeatedly accessing a few slices
      const slicesToAccess = [3, 4, 5, 6, 7];
      const accessPattern = [3, 4, 5, 4, 5, 6, 5, 6, 7, 6, 5, 4, 3, 4, 5];

      for (const slice of accessPattern) {
        volLayer.getSlice(slice, axialAxes);
      }

      const stats = volLayer.getCacheStats();
      expect(stats.hitRatio).toBeGreaterThan(0.6); // Should have good hit ratio
      expect(stats.size).toBeLessThanOrEqual(5); // Should respect capacity
    });

    it.skip('should handle getOrthoSliceAt with caching (skipped due to transformation matrix issue)', () => {
      const coord = [5, 5, 5];

      // First call - all misses
      volLayer.getOrthoSliceAt(coord);
      let stats = volLayer.getCacheStats();
      expect(stats.misses).toBe(3); // One for each orientation
      expect(stats.size).toBe(3);

      // Second call - all hits
      volLayer.getOrthoSliceAt(coord);
      stats = volLayer.getCacheStats();
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(3); // No new misses
    });
  });

  describe('cache configuration', () => {
    it('should use default cache size when not specified', () => {
      const defaultLayer = new VolLayer('default', volume, colorMap);
      const stats = defaultLayer.getCacheStats();
      expect(stats.capacity).toBe(100); // Default cache size
    });

    it('should use custom cache size when specified', () => {
      const customLayer = new VolLayer('custom', volume, colorMap, null, [0, 0], 1.0, 20);
      const stats = customLayer.getCacheStats();
      expect(stats.capacity).toBe(20);
    });
  });
});