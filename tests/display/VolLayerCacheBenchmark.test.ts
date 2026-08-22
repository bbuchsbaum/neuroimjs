import { describe, it, expect, vi, beforeAll } from 'vitest';
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

describe('VolLayer cache behavior', () => {
  beforeAll(() => {
    setupConsoleMocks();
  });

  it('avoids repeated slice extraction for cached keys', () => {
    // Create test volume
    const space = new NeuroSpace([50, 50, 50], [1, 1, 1], [0, 0, 0]);
    const data = new Float32Array(50 * 50 * 50);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i % 101) / 100;
    }
    const volume = new FloatNeuroVol(space, data);
    
    // Create color map
    const colorMap = new ColorMap([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
      [1, 1, 1]
    ]);
    
    // Create VolLayer with cache
    const volLayerWithCache = new VolLayer('cached', volume, colorMap, null, [0, 0], 1.0, 20);
    
    // Create VolLayer without cache (size 1 = effectively no cache)
    const volLayerNoCache = new VolLayer('no-cache', volume, colorMap, null, [0, 0], 1.0, 1);
    
    const axialAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );
    
    const slicesToAccess = [10, 15, 20, 25, 30, 15, 20, 25, 10, 15, 20, 25, 30];
    const extractionSpy = vi.spyOn(volume, 'getSlice');

    for (let i = 0; i < 10; i++) {
      for (const slice of slicesToAccess) {
        volLayerWithCache.getSlice(slice, axialAxes);
      }
    }
    const cachedExtractions = extractionSpy.mock.calls.length;
    extractionSpy.mockClear();

    for (let i = 0; i < 10; i++) {
      for (const slice of slicesToAccess) {
        volLayerNoCache.getSlice(slice, axialAxes);
      }
    }
    const singleEntryExtractions = extractionSpy.mock.calls.length;
    
    // Get cache stats
    const statsWithCache = volLayerWithCache.getCacheStats();
    const statsNoCache = volLayerNoCache.getCacheStats();
    
    expect(cachedExtractions).toBe(5);
    expect(singleEntryExtractions).toBe(130);
    expect(statsWithCache.hits).toBe(125);
    expect(statsWithCache.misses).toBe(5);
    expect(statsNoCache.hits).toBe(0);
    expect(statsNoCache.misses).toBe(130);
  });

  it('should show memory boundedness with different cache sizes', () => {
    // Create test volume
    const space = new NeuroSpace([30, 30, 30], [1, 1, 1], [0, 0, 0]);
    const data = new Float32Array(30 * 30 * 30);
    data.fill(0.5);
    const volume = new FloatNeuroVol(space, data);
    
    const colorMap = new ColorMap([
      [0, 0, 0],
      [0.5, 0.5, 0.5],
      [1, 1, 1]
    ]);
    
    // Test different cache sizes
    const cacheSizes = [1, 5, 10, 20, 50];
    const results: { size: number; hitRatio: number; evictions: number }[] = [];
    
    for (const cacheSize of cacheSizes) {
      const volLayer = new VolLayer('test', volume, colorMap, null, [0, 0], 1.0, cacheSize);
      
      // Access pattern that exceeds cache size
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      
      // Access 30 different slices repeatedly
      for (let repeat = 0; repeat < 3; repeat++) {
        for (let slice = 0; slice < 30; slice++) {
          volLayer.getSlice(slice, axialAxes);
        }
      }
      
      const stats = volLayer.getCacheStats();
      results.push({
        size: cacheSize,
        hitRatio: stats.hitRatio,
        evictions: stats.evictions
      });
    }
    
    // Assertions
    expect(results[0].hitRatio).toBeLessThan(results[4].hitRatio); // Larger cache = better hit ratio
    expect(results[0].evictions).toBeGreaterThan(results[4].evictions); // Smaller cache = more evictions
  });
});
