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

describe('VolLayer Cache Performance Benchmark', () => {
  beforeAll(() => {
    setupConsoleMocks();
  });

  it('should demonstrate cache performance improvements', () => {
    // Create test volume
    const space = new NeuroSpace([50, 50, 50], [1, 1, 1], [0, 0, 0]);
    const data = new Float32Array(50 * 50 * 50);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random();
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
    
    // Benchmark with cache
    const slicesToAccess = [10, 15, 20, 25, 30, 15, 20, 25, 10, 15, 20, 25, 30];
    
    // Warm up
    for (const slice of slicesToAccess) {
      volLayerWithCache.getSlice(slice, axialAxes);
      volLayerNoCache.getSlice(slice, axialAxes);
    }
    
    // Clear caches and stats
    volLayerWithCache.setRange([0, 1]); // This clears the cache
    volLayerNoCache.setRange([0, 1]);
    
    // Benchmark with cache
    const startWithCache = performance.now();
    for (let i = 0; i < 10; i++) {
      for (const slice of slicesToAccess) {
        volLayerWithCache.getSlice(slice, axialAxes);
      }
    }
    const durationWithCache = performance.now() - startWithCache;
    
    // Benchmark without cache (effective)
    const startNoCache = performance.now();
    for (let i = 0; i < 10; i++) {
      for (const slice of slicesToAccess) {
        volLayerNoCache.getSlice(slice, axialAxes);
      }
    }
    const durationNoCache = performance.now() - startNoCache;
    
    // Get cache stats
    const statsWithCache = volLayerWithCache.getCacheStats();
    const statsNoCache = volLayerNoCache.getCacheStats();
    
    console.log('\nPerformance Benchmark Results:');
    console.log('===============================');
    console.log(`With Cache (size ${statsWithCache.capacity}):`, durationWithCache.toFixed(2), 'ms');
    console.log(`  Hit ratio: ${(statsWithCache.hitRatio * 100).toFixed(1)}%`);
    console.log(`  Hits: ${statsWithCache.hits}, Misses: ${statsWithCache.misses}`);
    console.log(`  Evictions: ${statsWithCache.evictions}`);
    
    console.log(`\nWithout Cache (size ${statsNoCache.capacity}):`, durationNoCache.toFixed(2), 'ms');
    console.log(`  Hit ratio: ${(statsNoCache.hitRatio * 100).toFixed(1)}%`);
    console.log(`  Hits: ${statsNoCache.hits}, Misses: ${statsNoCache.misses}`);
    console.log(`  Evictions: ${statsNoCache.evictions}`);
    
    const improvement = ((durationNoCache - durationWithCache) / durationNoCache * 100);
    console.log(`\nPerformance improvement: ${improvement.toFixed(1)}%`);
    
    // Assertions
    expect(statsWithCache.hitRatio).toBeGreaterThan(0.5); // Should have good hit ratio
    expect(durationWithCache).toBeLessThan(durationNoCache); // Should be faster with cache
    expect(improvement).toBeGreaterThan(20); // Should be at least 20% faster
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
    
    console.log('\nCache Size Analysis:');
    console.log('====================');
    results.forEach(result => {
      console.log(`Cache size ${result.size}:`);
      console.log(`  Hit ratio: ${(result.hitRatio * 100).toFixed(1)}%`);
      console.log(`  Evictions: ${result.evictions}`);
    });
    
    // Assertions
    expect(results[0].hitRatio).toBeLessThan(results[4].hitRatio); // Larger cache = better hit ratio
    expect(results[0].evictions).toBeGreaterThan(results[4].evictions); // Smaller cache = more evictions
  });
});