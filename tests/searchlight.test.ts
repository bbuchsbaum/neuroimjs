import { describe, it, expect, beforeEach } from 'vitest';
import {
  searchlightIterator,
  searchlightCoords,
  randomSearchlight,
  clusteredSearchlight
} from '../src/searchlight/searchlight';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { LazyList } from '../src/utils/LazyList';
import { ROIVolWindow } from '../src/roi/ROI_improved';

describe('Searchlight Analysis', () => {
  let space: NeuroSpace;
  let mask: LogicalNeuroVol;
  let testVol: FloatNeuroVol;

  beforeEach(() => {
    // Create a small 10x10x10 volume
    space = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0]);
    
    // Create a mask with some non-zero voxels
    mask = new LogicalNeuroVol(space);
    const maskData = mask.getData() as Uint8Array;
    
    // Set center region as brain
    for (let z = 2; z < 8; z++) {
      for (let y = 2; y < 8; y++) {
        for (let x = 2; x < 8; x++) {
          const idx = space.gridToIndex([x, y, z]);
          maskData[idx] = 1;
        }
      }
    }
    
    // Create test volume with gradient values
    const volData = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      volData[i] = i % 100;
    }
    testVol = new FloatNeuroVol(space, volData);
  });

  describe('searchlightIterator', () => {
    it('should create lazy searchlight iterator', () => {
      const radius = 3; // mm
      console.log('Mask space size:', mask.space.size);
      console.log('Mask dimensions:', mask.space.dim);
      const result = searchlightIterator(mask, radius);
      
      expect(result).toBeInstanceOf(LazyList);
      
      const lazyList = result as LazyList<ROIVolWindow>;
      console.log('LazyList length:', lazyList.length);
      expect(lazyList.length).toBe(1000); // All voxels
      
      // Get first searchlight
      const firstSL = lazyList.get(0);
      expect(firstSL).toBeInstanceOf(ROIVolWindow);
      expect(firstSL.centerIndex).toBe(0);
    });

    it('should create searchlight iterator with nonzero option', () => {
      const radius = 3;
      const result = searchlightIterator(mask, radius, { nonzero: true });
      
      const lazyList = result as LazyList<ROIVolWindow>;
      expect(lazyList.length).toBe(216); // 6x6x6 center region
    });

    it('should eagerly compute searchlights', () => {
      const radius = 3;
      const result = searchlightIterator(mask, radius, { eager: true });
      
      expect(Array.isArray(result)).toBe(true);
      const eagerResults = result as ROIVolWindow[];
      expect(eagerResults.length).toBe(1000);
      
      // Check first searchlight
      expect(eagerResults[0]).toBeInstanceOf(ROIVolWindow);
    });

    it('should track progress during eager computation', () => {
      const radius = 3;
      const progressValues: number[] = [];
      
      const result = searchlightIterator(mask, radius, {
        eager: true,
        onProgress: (p) => progressValues.push(p)
      });
      
      expect(Array.isArray(result)).toBe(true);
      expect(progressValues.length).toBeGreaterThan(0);
      expect(progressValues[progressValues.length - 1]).toBe(1.0);
    });

    it('should handle different radius values', () => {
      const smallRadius = 1;
      const largeRadius = 5;
      
      const smallResult = searchlightIterator(mask, smallRadius, { eager: true }) as ROIVolWindow[];
      const largeResult = searchlightIterator(mask, largeRadius, { eager: true }) as ROIVolWindow[];
      
      // Larger radius should include more voxels per searchlight
      const smallSize = smallResult[100].data.length;
      const largeSize = largeResult[100].data.length;
      
      expect(largeSize).toBeGreaterThan(smallSize);
    });
  });

  describe('searchlightCoords', () => {
    it('should create coordinate-only searchlight iterator', async () => {
      const radius = 3;
      const result = await searchlightCoords(mask, radius);
      
      expect(result).toBeInstanceOf(LazyList);
      
      const lazyList = result as LazyList<Float32Array>;
      expect(lazyList.length).toBe(1000);
      
      // Get first searchlight coordinates
      const firstCoords = lazyList.get(0);
      expect(firstCoords).toBeInstanceOf(Float32Array);
      expect(firstCoords.length % 3).toBe(0); // Multiple of 3 for x,y,z
    });

    it('should handle nonzero option', async () => {
      const radius = 3;
      const result = await searchlightCoords(mask, radius, { nonzero: true });
      
      const lazyList = result as LazyList<Float32Array>;
      expect(lazyList.length).toBe(216); // Only brain voxels
    });
  });

  describe('randomSearchlight', () => {
    it('should create non-overlapping searchlights', () => {
      const radius = 3;
      const searchlights = randomSearchlight(mask, radius);
      
      expect(Array.isArray(searchlights)).toBe(true);
      expect(searchlights.length).toBeGreaterThan(0);
      
      // All searchlights should be ROIVolWindow
      searchlights.forEach(sl => {
        expect(sl).toBeInstanceOf(ROIVolWindow);
      });
      
      // Check that we don't have too many searchlights
      // (since they shouldn't overlap)
      expect(searchlights.length).toBeLessThan(216); // Less than total brain voxels
    });

    it('should cover all brain voxels', () => {
      const radius = 2; // Smaller radius
      const searchlights = randomSearchlight(mask, radius);
      
      // Collect all covered voxel indices that are in the brain mask
      const coveredIndices = new Set<number>();
      const maskData = mask.getData();
      
      searchlights.forEach(sl => {
        const coords = sl.coords;
        coords.forEach(coord => {
          const idx = space.gridToIndex(coord);
          // Only count voxels that are in the brain mask
          if (maskData[idx]) {
            coveredIndices.add(idx);
          }
        });
      });
      
      // Count brain voxels
      let brainVoxelCount = 0;
      for (let i = 0; i < maskData.length; i++) {
        if (maskData[i]) brainVoxelCount++;
      }
      
      // All brain voxels should be covered
      expect(coveredIndices.size).toBe(brainVoxelCount);
    });
  });

  describe('clusteredSearchlight', () => {
    it('should create searchlights based on clusters', () => {
      // Create clustered volume
      const clusterData = new Float32Array(1000);
      
      // Create 3 clusters
      for (let i = 0; i < 333; i++) clusterData[i] = 1;
      for (let i = 333; i < 666; i++) clusterData[i] = 2;
      for (let i = 666; i < 1000; i++) clusterData[i] = 3;
      
      const clusterVol = new FloatNeuroVol(space, clusterData);
      
      const radius = 3;
      const searchlights = clusteredSearchlight(clusterVol, radius);
      
      expect(searchlights.length).toBe(3); // One per cluster
      
      searchlights.forEach(sl => {
        expect(sl).toBeInstanceOf(ROIVolWindow);
      });
    });

    it('should skip background cluster', () => {
      // Create clustered volume with background
      const clusterData = new Float32Array(1000);
      
      // First third is background (0)
      for (let i = 333; i < 666; i++) clusterData[i] = 1;
      for (let i = 666; i < 1000; i++) clusterData[i] = 2;
      
      const clusterVol = new FloatNeuroVol(space, clusterData);
      
      const radius = 3;
      const searchlights = clusteredSearchlight(clusterVol, radius);
      
      expect(searchlights.length).toBe(2); // Only non-zero clusters
    });

    it('should center searchlights at cluster centroids', () => {
      // Create a simple cluster
      const clusterData = new Float32Array(1000);
      
      // Single cluster at specific location
      const centerX = 5, centerY = 5, centerZ = 5;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = space.gridToIndex([
              centerX + dx,
              centerY + dy,
              centerZ + dz
            ]);
            clusterData[idx] = 1;
          }
        }
      }
      
      const clusterVol = new FloatNeuroVol(space, clusterData);
      const searchlights = clusteredSearchlight(clusterVol, 3);
      
      expect(searchlights.length).toBe(1);
      
      // Check that center is approximately at cluster centroid
      const sl = searchlights[0];
      const centerIdx = sl.parentIndex; // Use parentIndex which is in the parent space
      const centerGrid = space.indexToGrid(centerIdx);
      
      expect(Math.abs(centerGrid[0] - centerX)).toBeLessThanOrEqual(1);
      expect(Math.abs(centerGrid[1] - centerY)).toBeLessThanOrEqual(1);
      expect(Math.abs(centerGrid[2] - centerZ)).toBeLessThanOrEqual(1);
    });
  });

  describe('Web Worker support', () => {
    it('should handle parallel computation when available', async () => {
      const radius = 3;
      
      // This will use Web Workers if available, otherwise fallback
      const result = await searchlightIterator(mask, radius, {
        eager: true,
        cores: 4
      });
      
      // Should still return results
      expect(Array.isArray(result) || result instanceof Promise).toBe(true);
      
      if (result instanceof Promise) {
        const resolved = await result;
        expect(Array.isArray(resolved)).toBe(true);
        expect(resolved.length).toBe(1000);
      }
    });

    it('should fallback gracefully when Workers unavailable', async () => {
      const radius = 3;
      
      // Even without Workers, should still work
      const result = searchlightIterator(mask, radius, {
        eager: true,
        cores: 1 // Force single-threaded
      });
      
      expect(Array.isArray(result)).toBe(true);
      const results = result as ROIVolWindow[];
      expect(results.length).toBe(1000);
    });
  });
});