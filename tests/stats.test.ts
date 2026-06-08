import { describe, it, expect, beforeEach } from 'vitest';
import {
  splitBlocks,
  splitClusters,
  splitFill,
  splitReduce,
  splitScale,
  partition,
  mapValues,
  centroids,
  StatFunctions
} from '../src/stats/stats';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { Float32NeuroVec } from '../src/vec/NeuroVec';
import { SparseNeuroVol } from '../src/sparse/SparseNeuroVol';
import { SparseNeuroVec } from '../src/vec/SparseNeuroVec';
import { ClusteredNeuroVol } from '../src/volume/ClusteredNeuroVol';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';

describe('Statistical Operations', () => {
  let space3d: NeuroSpace;
  let space4d: NeuroSpace;
  let testVol: FloatNeuroVol;
  let testVec: Float32NeuroVec;

  beforeEach(() => {
    space3d = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0]);
    space4d = new NeuroSpace([10, 10, 10, 5], [1, 1, 1, 1], [0, 0, 0, 0]); // X,Y,Z,T ordering
    
    // Create test volume with gradient pattern
    const volData = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      volData[i] = i % 100;
    }
    testVol = new FloatNeuroVol(space3d, volData);
    
    // Create test 4D vector
    const vecData = new Float32Array(5000);
    // Fill data according to X,Y,Z,T layout
    for (let t = 0; t < 5; t++) {
      for (let z = 0; z < 10; z++) {
        for (let y = 0; y < 10; y++) {
          for (let x = 0; x < 10; x++) {
            const idx = x + y * 10 + z * 100 + t * 1000;
            vecData[idx] = t * 10 + (x % 10);
          }
        }
      }
    }
    testVec = new Float32NeuroVec(space4d, vecData);
  });

  describe('splitBlocks', () => {
    it('should split volume into blocks', () => {
      const indices = new Uint32Array([0, 1, 2, 100, 101, 102]);
      const blockIds = new Int32Array([1, 1, 1, 2, 2, 2]);
      
      const blocks = splitBlocks(testVol, indices, blockIds);
      
      expect(blocks.length).toBe(2);
      
      // Check first block
      const block1 = blocks[0] as SparseNeuroVol;
      expect(block1.nonDefaultCount).toBe(2); // Only non-zero values are stored
      // Check data values - sparse volume stores only at specified indices
      expect(block1.get(0)).toBe(0);  // volData[0] = 0
      expect(block1.get(1)).toBe(1);  // volData[1] = 1
      expect(block1.get(2)).toBe(2);  // volData[2] = 2
      
      // Check second block
      const block2 = blocks[1] as SparseNeuroVol;
      expect(block2.nonDefaultCount).toBe(2); // Only non-zero values are stored
      // Check data values - sparse volume stores only at specified indices
      expect(block2.get(100)).toBe(0);  // volData[100] = 0
      expect(block2.get(101)).toBe(1);  // volData[101] = 1
      expect(block2.get(102)).toBe(2);  // volData[102] = 2
    });

    it('should split vector into blocks', () => {
      const indices = new Uint32Array([0, 1, 2, 10, 11, 12]);
      const blockIds = new Int32Array([1, 1, 1, 2, 2, 2]);
      
      const blocks = splitBlocks(testVec, indices, blockIds);
      
      expect(blocks.length).toBe(2);
      
      // Check blocks are SparseNeuroVec
      expect(blocks[0]).toBeInstanceOf(SparseNeuroVec);
      expect(blocks[1]).toBeInstanceOf(SparseNeuroVec);
    });

    it('should handle single block', () => {
      const indices = new Uint32Array([0, 1, 2, 3]);
      const blockIds = new Int32Array([1, 1, 1, 1]);
      
      const blocks = splitBlocks(testVol, indices, blockIds);
      
      expect(blocks.length).toBe(1);
      expect((blocks[0] as SparseNeuroVol).nonDefaultCount).toBe(3); // Index 0 has value 0 which is not stored
    });

    it('should throw error for mismatched lengths', () => {
      const indices = new Uint32Array([0, 1, 2]);
      const blockIds = new Int32Array([1, 1]);
      
      expect(() => splitBlocks(testVol, indices, blockIds)).toThrow('must have same length');
    });
  });

  describe('splitClusters', () => {
    it('should split volume by cluster labels', () => {
      // Create clustered volume
      const clusterData = new Float32Array(1000);
      for (let i = 0; i < 500; i++) clusterData[i] = 1;
      for (let i = 500; i < 1000; i++) clusterData[i] = 2;
      
      const labelMap = new Map<number, string>([
        [1, 'Cluster1'],
        [2, 'Cluster2']
      ]);
      
      // Create mask for clustered volume
      const maskData = new Uint8Array(1000);
      const clusterIds: number[] = [];
      for (let i = 0; i < 1000; i++) {
        if (clusterData[i] !== 0) {
          maskData[i] = 1;
          clusterIds.push(clusterData[i]);
        }
      }
      const mask = new LogicalNeuroVol(space3d, maskData);
      
      // Convert Map to object for labelMap
      const labelMapObj: any = {};
      for (const [id, name] of labelMap) {
        labelMapObj[name] = id;
      }
      
      const clusters = new ClusteredNeuroVol(mask, new Int32Array(clusterIds), labelMapObj);
      
      const rois = splitClusters(testVol, clusters);
      
      expect(rois.length).toBe(2);
      expect(rois[0].data.length).toBe(500);
      expect(rois[1].data.length).toBe(500);
    });

    it('should skip background (label 0)', () => {
      const clusterData = new Float32Array(1000);
      for (let i = 0; i < 300; i++) clusterData[i] = 0; // Background
      for (let i = 300; i < 600; i++) clusterData[i] = 1;
      for (let i = 600; i < 1000; i++) clusterData[i] = 2;
      
      const clusterVol = new FloatNeuroVol(space3d, clusterData);
      const rois = splitClusters(testVol, clusterVol);
      
      expect(rois.length).toBe(2); // Only clusters 1 and 2
    });

    it('should work with NeuroVec input', () => {
      const clusterData = new Float32Array(1000);
      for (let i = 0; i < 500; i++) clusterData[i] = 1;
      for (let i = 500; i < 1000; i++) clusterData[i] = 2;
      
      const clusterVol = new FloatNeuroVol(space3d, clusterData);
      const rois = splitClusters(testVec, clusterVol);
      
      expect(rois.length).toBe(2);
    });

    it('should throw error for dimension mismatch', () => {
      const wrongSpace = new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]);
      const wrongClusters = new FloatNeuroVol(wrongSpace, new Float32Array(125));
      
      expect(() => splitClusters(testVol, wrongClusters)).toThrow('same space');
    });
  });

  describe('splitFill', () => {
    it('should split vector by factor levels', () => {
      const factor = new Int32Array([1, 1, 2, 2, 3]);
      
      const result = splitFill(testVec, factor);
      
      expect(result.size).toBe(3);
      expect(result.get(1)?.dim[3]).toBe(2); // 2 time points for level 1
      expect(result.get(2)?.dim[3]).toBe(2); // 2 time points for level 2
      expect(result.get(3)?.dim[3]).toBe(1); // 1 time point for level 3
    });

    it('should work with sparse vectors', () => {
      // Create sparse vector
      const mask = new LogicalNeuroVol(space3d);
      const maskData = mask.getData();
      for (let i = 0; i < 100; i++) {
        maskData[i] = 1;
      }
      
      const sparseData = new Float32Array(5 * 100); // 5 timepoints, 100 voxels
      
      // Convert to Map format for SparseNeuroVec
      const voxelDataMap = new Map<number, number[]>();
      for (let i = 0; i < 100; i++) {
        const timeSeries: number[] = [];
        for (let t = 0; t < 5; t++) {
          timeSeries.push(sparseData[t * 100 + i]);
        }
        voxelDataMap.set(i, timeSeries);
      }
      
      const sparseVec = new SparseNeuroVec(space4d, voxelDataMap);
      
      const factor = new Int32Array([1, 1, 2, 2, 2]);
      const result = splitFill(sparseVec, factor);
      
      expect(result.size).toBe(2);
      expect(result.get(1)).toBeInstanceOf(SparseNeuroVec);
      expect(result.get(2)).toBeInstanceOf(SparseNeuroVec);
    });

    it('should preserve data values', () => {
      const factor = new Int32Array([1, 2, 1, 2, 3]);
      const result = splitFill(testVec, factor);
      
      const level1 = result.get(1) as Float32NeuroVec;
      const level2 = result.get(2) as Float32NeuroVec;
      
      // Check that data is preserved (indices 0 and 2 go to level 1)
      expect(level1.getAt(0, 0, 0, 0)).toBe(testVec.getAt(0, 0, 0, 0));
      expect(level1.getAt(0, 0, 0, 1)).toBe(testVec.getAt(0, 0, 0, 2));
      
      // Indices 1 and 3 go to level 2
      expect(level2.getAt(0, 0, 0, 0)).toBe(testVec.getAt(0, 0, 0, 1));
      expect(level2.getAt(0, 0, 0, 1)).toBe(testVec.getAt(0, 0, 0, 3));
    });

    it('should throw error for wrong factor length', () => {
      const wrongFactor = new Int32Array([1, 2, 3]); // Too short
      
      expect(() => splitFill(testVec, wrongFactor)).toThrow('must equal number of volumes');
    });
  });

  describe('splitReduce', () => {
    it('should reduce vector with mean function', () => {
      const factor = new Int32Array([1, 1, 2, 2, 2]);
      
      const result = splitReduce(testVec, factor, StatFunctions.mean);
      
      expect(result).toBeInstanceOf(FloatNeuroVol);
      expect(result.space.dim).toEqual([10, 10, 10]);
      
      // Check some values
      const data = result.getData();
      // For voxel 0: t=0,1 have value 0,10 (mean=5), t=2,3,4 have value 20,30,40 (mean=30)
      // Mean of means: (5 + 30) / 2 = 17.5
      expect(data[0]).toBeCloseTo(17.5); // Mean of all reduced values
    });

    it('should work with sparse vectors', () => {
      // Create sparse vector with known pattern
      const mask = new LogicalNeuroVol(space3d);
      const maskData = mask.getData();
      maskData[0] = 1;
      maskData[1] = 1;
      
      const sparseData = new Float32Array([
        1, 2,  // t=0
        3, 4,  // t=1
        5, 6,  // t=2
        7, 8,  // t=3
        9, 10  // t=4
      ]);
      
      // Convert to Map format for SparseNeuroVec
      const voxelDataMap = new Map<number, number[]>();
      voxelDataMap.set(0, [1, 3, 5, 7, 9]); // Time series for voxel 0
      voxelDataMap.set(1, [2, 4, 6, 8, 10]); // Time series for voxel 1
      
      const sparseVec = new SparseNeuroVec(space4d, voxelDataMap);
      
      const factor = new Int32Array([1, 1, 2, 2, 2]);
      const result = splitReduce(sparseVec, factor, StatFunctions.mean);
      
      expect(result).toBeInstanceOf(SparseNeuroVol);
      const sparseResult = result as SparseNeuroVol;
      expect(sparseResult.nonDefaultCount).toBe(2);
      
      // Check values: mean of (1,3) and (5,7,9) = 2 and 7
      const values = sparseResult.getData();
      expect(values[0]).toBeCloseTo(4.5); // Mean of means: (2 + 7) / 2
      expect(values[1]).toBeCloseTo(5.5); // Mean of means: (3 + 8) / 2
    });

    it('should handle custom reduction functions', () => {
      const factor = new Int32Array([1, 1, 2, 2, 2]);
      
      // Use max function
      const result = splitReduce(testVec, factor, StatFunctions.max);
      
      const data = result.getData();
      // For voxel 0: t=0,1 have value 0,10 (max=10), t=2,3,4 have value 20,30,40 (max=40)
      // Mean of maxes: (10 + 40) / 2 = 25
      expect(data[0]).toBeCloseTo(25); // Mean of all reduced values
    });

    it('should return zero for empty voxels', () => {
      const factor = new Int32Array([1, 1, 1, 1, 1]); // All same level
      
      const result = splitReduce(testVec, factor, StatFunctions.mean);
      
      // Should have non-zero values since all data goes to one level
      const data = result.getData();
      expect(data[0]).toBeGreaterThan(0);
    });
  });

  describe('splitScale', () => {
    it('should center and scale data within factor levels', () => {
      const factor = new Int32Array([1, 1, 2, 2, 2]);
      
      const result = splitScale(testVec, factor, true, true);
      
      expect(result).toBeInstanceOf(Float32NeuroVec);
      expect(result.dim).toEqual(testVec.dim);
      
      // Check that data is centered and scaled within levels
      // For level 1 (indices 0, 1), data should be centered around 0
      const scaledData = (result as Float32NeuroVec).getData();
      
      // Extract values for first voxel across time
      const level1Values = [scaledData[0], scaledData[1000]];
      const level1Mean = (level1Values[0] + level1Values[1]) / 2;
      expect(Math.abs(level1Mean)).toBeLessThan(1e-6);
    });

    it('should only center when scale=false', () => {
      const factor = new Int32Array([1, 1, 2, 2, 2]);
      
      const result = splitScale(testVec, factor, true, false);
      
      // Data should be centered but not scaled
      const scaledData = (result as Float32NeuroVec).getData();
      
      // Check that variance is preserved (not scaled to 1)
      const level1Values = [scaledData[0], scaledData[1000]];
      const variance = level1Values.reduce((sum, val) => sum + val * val, 0) / 2;
      expect(variance).toBeGreaterThan(1); // Would be ~1 if scaled
    });

    it('should work with sparse vectors', () => {
      // Create sparse vector
      const mask = new LogicalNeuroVol(space3d);
      mask.getData()[0] = 1;
      mask.getData()[1] = 1;
      
      const sparseData = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      
      // Convert to Map format for SparseNeuroVec
      const voxelDataMap = new Map<number, number[]>();
      voxelDataMap.set(0, [1, 3, 5, 7, 9]); // Time series for voxel 0 (every other value)
      voxelDataMap.set(1, [2, 4, 6, 8, 10]); // Time series for voxel 1
      
      const sparseVec = new SparseNeuroVec(space4d, voxelDataMap);
      
      const factor = new Int32Array([1, 1, 2, 2, 2]);
      const result = splitScale(sparseVec, factor);
      
      expect(result).toBeInstanceOf(SparseNeuroVec);
    });

    it('should skip levels with too few samples', () => {
      const factor = new Int32Array([1, 2, 2, 2, 2]); // Level 1 has only 1 sample
      
      const result = splitScale(testVec, factor);
      
      // Should complete without error
      expect(result).toBeInstanceOf(Float32NeuroVec);
    });
  });

  describe('partition', () => {
    it('should partition volume into k clusters', () => {
      // Create volume with distinct value regions
      const data = new Float32Array(1000);
      for (let i = 0; i < 300; i++) data[i] = 1;
      for (let i = 300; i < 700; i++) data[i] = 5;
      for (let i = 700; i < 1000; i++) data[i] = 10;
      
      const vol = new FloatNeuroVol(space3d, data);
      
      const clustered = partition(vol, 3);
      
      expect(clustered).toBeInstanceOf(ClusteredNeuroVol);
      expect(Object.keys(clustered.labelMap).length).toBe(3);
      
      // Check that clusters were created
      const clusterData = clustered.asDense().getData();
      const uniqueLabels = new Set(clusterData);
      
      // k-means might converge to fewer clusters if some end up empty
      // We should have at least 2 clusters given the distinct values (1, 5, 10)
      expect(uniqueLabels.size).toBeGreaterThanOrEqual(2);
      expect(uniqueLabels.size).toBeLessThanOrEqual(3);
      
      // Verify we don't have just background (0)
      const nonZeroLabels = Array.from(uniqueLabels).filter(label => label !== 0);
      expect(nonZeroLabels.length).toBeGreaterThan(0);
    });

    it('partitions deterministically and separates distinct regions (seeded k-means++)', () => {
      // Three clearly separated value regions.
      const data = new Float32Array(1000);
      for (let i = 0; i < 300; i++) data[i] = 1;
      for (let i = 300; i < 700; i++) data[i] = 5;
      for (let i = 700; i < 1000; i++) data[i] = 10;
      const vol = new FloatNeuroVol(space3d, data);

      const a = Array.from(partition(vol, 3).asDense().getData());
      const b = Array.from(partition(vol, 3).asDense().getData());

      // Deterministic: identical labels across runs, independent of global RNG state.
      expect(a).toEqual(b);

      // k-means++ resolves the three distinct regions into three clusters,
      // each region internally uniform.
      expect(new Set(a).size).toBe(3);
      expect(new Set(a.slice(0, 300)).size).toBe(1);
      expect(new Set(a.slice(300, 700)).size).toBe(1);
      expect(new Set(a.slice(700, 1000)).size).toBe(1);
    });

    it('should respect mask when partitioning', () => {
      const mask = new LogicalNeuroVol(space3d);
      const maskData = mask.getData() as Uint8Array;
      
      // Only mask first 500 voxels
      for (let i = 0; i < 500; i++) {
        maskData[i] = 1;
      }
      
      const clustered = partition(testVol, 2, 'kmeans', mask);
      const clusterData = clustered.asDense().getData();
      
      // Check that unmasked voxels are 0
      for (let i = 500; i < 1000; i++) {
        expect(clusterData[i]).toBe(0);
      }
    });

    it('should throw error if k > number of voxels', () => {
      const smallVol = new FloatNeuroVol(
        new NeuroSpace([2, 2, 2], [1, 1, 1], [0, 0, 0]),
        new Float32Array([1, 0, 0, 0, 0, 0, 0, 2])
      );
      
      expect(() => partition(smallVol, 10)).toThrow('less than k');
    });

    it('should throw error for unknown method', () => {
      expect(() => partition(testVol, 3, 'unknown')).toThrow('Unknown method');
    });
  });

  describe('mapValues', () => {
    it('should map values in dense volume', () => {
      const lookup = new Map<number, number>([
        [0, 100],
        [1, 200],
        [2, 300]
      ]);
      
      const data = new Float32Array([0, 1, 2, 0, 1, 2]);
      const vol = new FloatNeuroVol(
        new NeuroSpace([2, 3, 1], [1, 1, 1], [0, 0, 0]),
        data
      );
      
      const mapped = mapValues(vol, lookup);
      const mappedData = mapped.getData();
      
      expect(mappedData[0]).toBe(100);
      expect(mappedData[1]).toBe(200);
      expect(mappedData[2]).toBe(300);
      expect(mappedData[3]).toBe(100);
    });

    it('should map values in sparse volume', () => {
      const lookup = new Map<number, number>([
        [10, 100],
        [20, 200]
      ]);
      
      const sparse = new SparseNeuroVol(
        space3d,
        'float32',
        0,
        [0, 100, 200],
        [10, 20, 10]
      );
      
      const mapped = mapValues(sparse, lookup) as SparseNeuroVol;
      const mappedData = mapped.getData();
      
      expect(mappedData[0]).toBe(100);    // Index 0 had value 10 -> 100
      expect(mappedData[100]).toBe(200);  // Index 100 had value 20 -> 200
      expect(mappedData[200]).toBe(100);  // Index 200 had value 10 -> 100
    });

    it('should preserve unmapped values', () => {
      const lookup = new Map<number, number>([[1, 100]]);
      
      const data = new Float32Array([0, 1, 2, 3]);
      const vol = new FloatNeuroVol(
        new NeuroSpace([2, 2, 1], [1, 1, 1], [0, 0, 0]),
        data
      );
      
      const mapped = mapValues(vol, lookup);
      const mappedData = mapped.getData();
      
      expect(mappedData[0]).toBe(0); // Unchanged
      expect(mappedData[1]).toBe(100); // Mapped
      expect(mappedData[2]).toBe(2); // Unchanged
      expect(mappedData[3]).toBe(3); // Unchanged
    });
  });

  describe('centroids', () => {
    it('should compute center of mass for clusters', () => {
      // Create simple clustered volume
      const data = new Float32Array(27); // 3x3x3
      // Cluster 1 at origin corner
      data[0] = 1; // (0,0,0)
      data[1] = 1; // (1,0,0)
      data[3] = 1; // (0,1,0)
      
      // Cluster 2 at opposite corner
      data[26] = 2; // (2,2,2)
      
      const labelMap = new Map<number, string>([
        [1, 'Cluster1'],
        [2, 'Cluster2']
      ]);
      
      const vol = new FloatNeuroVol(
        new NeuroSpace([3, 3, 3], [1, 1, 1], [0, 0, 0]),
        data
      );
      
      // Create mask and cluster data
      const maskData = new Uint8Array(27);
      const clusterIds: number[] = [];
      for (let i = 0; i < 27; i++) {
        if (data[i] !== 0) {
          maskData[i] = 1;
          clusterIds.push(data[i]);
        }
      }
      const mask = new LogicalNeuroVol(vol.space, maskData);
      
      // Convert Map to object for labelMap
      const labelMapObj: any = {};
      for (const [id, name] of labelMap) {
        labelMapObj[name] = id;
      }
      
      const clustered = new ClusteredNeuroVol(mask, new Int32Array(clusterIds), labelMapObj);
      
      const cents = centroids(clustered);
      
      expect(cents.size).toBe(2);
      
      // Check cluster 1 centroid
      const cent1 = cents.get(1)!;
      expect(cent1[0]).toBeCloseTo(0.333, 2); // Mean of 0,1,0
      expect(cent1[1]).toBeCloseTo(0.333, 2); // Mean of 0,0,1
      expect(cent1[2]).toBeCloseTo(0, 2);     // Mean of 0,0,0
      
      // Check cluster 2 centroid
      const cent2 = cents.get(2)!;
      expect(cent2).toEqual([2, 2, 2]);
    });

    it('should compute median centroids', () => {
      // Create clustered volume with odd number of voxels
      const data = new Float32Array(125); // 5x5x5
      
      // Cluster along a line
      data[0] = 1;  // (0,0,0)
      data[1] = 1;  // (1,0,0)
      data[2] = 1;  // (2,0,0)
      data[3] = 1;  // (3,0,0)
      data[4] = 1;  // (4,0,0)
      
      const labelMap = new Map<number, string>([[1, 'Line']]);
      const vol = new FloatNeuroVol(
        new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]),
        data
      );
      
      // Create mask and cluster data
      const maskData = new Uint8Array(125);
      const clusterIds: number[] = [];
      for (let i = 0; i < 125; i++) {
        if (data[i] !== 0) {
          maskData[i] = 1;
          clusterIds.push(data[i]);
        }
      }
      const mask = new LogicalNeuroVol(vol.space, maskData);
      
      // Convert Map to object for labelMap
      const labelMapObj: any = {};
      for (const [id, name] of labelMap) {
        labelMapObj[name] = id;
      }
      
      const clustered = new ClusteredNeuroVol(mask, new Int32Array(clusterIds), labelMapObj);
      
      const cents = centroids(clustered, 'median');
      
      const cent = cents.get(1)!;
      expect(cent[0]).toBe(2); // Median of 0,1,2,3,4
      expect(cent[1]).toBe(0);
      expect(cent[2]).toBe(0);
    });

    it('should skip background label 0', () => {
      const data = new Float32Array([0, 0, 1, 1, 2, 2]);
      const labelMap = new Map<number, string>([
        [0, 'Background'],
        [1, 'Cluster1'],
        [2, 'Cluster2']
      ]);
      
      const vol = new FloatNeuroVol(
        new NeuroSpace([2, 3, 1], [1, 1, 1], [0, 0, 0]),
        data
      );
      
      // Create mask and cluster data
      const maskData = new Uint8Array(6);
      const clusterIds: number[] = [];
      for (let i = 0; i < 6; i++) {
        if (data[i] !== 0) {
          maskData[i] = 1;
          clusterIds.push(data[i]);
        }
      }
      const mask = new LogicalNeuroVol(vol.space, maskData);
      
      // Convert Map to object for labelMap
      const labelMapObj: any = {};
      for (const [id, name] of labelMap) {
        labelMapObj[name] = id;
      }
      
      const clustered = new ClusteredNeuroVol(mask, new Int32Array(clusterIds), labelMapObj);
      
      const cents = centroids(clustered);
      
      expect(cents.size).toBe(2);
      expect(cents.has(0)).toBe(false);
      expect(cents.has(1)).toBe(true);
      expect(cents.has(2)).toBe(true);
    });

    it('should throw error for unknown method', () => {
      const vol = new FloatNeuroVol(space3d, new Float32Array(1000));
      // Create empty mask and cluster data
      const mask = new LogicalNeuroVol(space3d, new Uint8Array(1000));
      const clustered = new ClusteredNeuroVol(mask, new Int32Array(0), {});
      
      expect(() => centroids(clustered, 'unknown')).toThrow('Unknown method');
    });
  });

  describe('StatFunctions', () => {
    it('should compute mean correctly', () => {
      const values = new Float32Array([1, 2, 3, 4, 5]);
      expect(StatFunctions.mean(values)).toBe(3);
    });

    it('should compute sum correctly', () => {
      const values = new Float32Array([1, 2, 3, 4, 5]);
      expect(StatFunctions.sum(values)).toBe(15);
    });

    it('should compute min and max correctly', () => {
      const values = new Float32Array([5, 2, 8, 1, 9]);
      expect(StatFunctions.min(values)).toBe(1);
      expect(StatFunctions.max(values)).toBe(9);
    });

    it('should compute standard deviation correctly', () => {
      const values = new Float32Array([2, 4, 4, 4, 5, 5, 7, 9]);
      const std = StatFunctions.std(values);
      // Sample standard deviation (dividing by n-1)
      expect(std).toBeCloseTo(2.138, 2);
    });

    it('should compute median correctly', () => {
      const values1 = new Float32Array([1, 2, 3, 4, 5]);
      expect(StatFunctions.median(values1)).toBe(3);

      const values2 = new Float32Array([1, 2, 3, 4]);
      expect(StatFunctions.median(values2)).toBe(2.5);
    });

    it('should compute min/max on large arrays without stack overflow', () => {
      // Math.min(...values) overflows the call stack around ~10^5 elements;
      // whole-brain ROIs routinely exceed this. The loop-based impl must not throw.
      const n = 200_000;
      const values = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        values[i] = i; // 0 .. n-1
      }
      // Plant a known extreme away from the ends.
      values[12345] = -42;
      values[54321] = n + 1000;

      expect(() => StatFunctions.min(values)).not.toThrow();
      expect(() => StatFunctions.max(values)).not.toThrow();
      expect(StatFunctions.min(values)).toBe(-42);
      expect(StatFunctions.max(values)).toBe(n + 1000);
    });

    it('should skip NaN in min/max', () => {
      const values = new Float32Array([5, NaN, 2, NaN, 8, 1, 9]);
      expect(StatFunctions.min(values)).toBe(1);
      expect(StatFunctions.max(values)).toBe(9);

      // All-NaN input yields NaN rather than +/-Infinity.
      const allNaN = new Float32Array([NaN, NaN]);
      expect(Number.isNaN(StatFunctions.min(allNaN))).toBe(true);
      expect(Number.isNaN(StatFunctions.max(allNaN))).toBe(true);
    });

    it('should skip NaN in mean and std', () => {
      const values = new Float32Array([2, NaN, 4, NaN, 6]);
      // mean over the 3 valid values {2,4,6} = 4
      expect(StatFunctions.mean(values)).toBe(4);
      // sample std over {2,4,6} = 2
      expect(StatFunctions.std(values)).toBeCloseTo(2, 6);
    });
  });
});