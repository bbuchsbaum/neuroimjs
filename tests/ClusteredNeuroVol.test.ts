import { describe, it, expect, beforeEach } from 'vitest';
import { ClusteredNeuroVol, clusteredNeuroVol } from '../src/volume/ClusteredNeuroVol';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { AxisSet3D } from '../src/geometry/Axis';

describe('ClusteredNeuroVol', () => {
  let space: NeuroSpace;
  let mask: LogicalNeuroVol;
  
  beforeEach(() => {
    // Create a 5x5x5 space for testing
    space = new NeuroSpace(
      [5, 5, 5],
      [1, 1, 1],
      [0, 0, 0],
      AxisSet3D.AXIAL_LPI
    );
    
    // Create a mask with some true voxels
    const maskIndices = [
      0, 1, 2, 5, 6, 7,     // Cluster 1 region
      50, 51, 52, 55, 56,   // Cluster 2 region
      100, 101, 102         // Cluster 3 region
    ];
    mask = new LogicalNeuroVol(space, undefined, maskIndices);
  });

  describe('constructor', () => {
    it('should create a clustered volume with cluster assignments', () => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      const vol = new ClusteredNeuroVol(mask, clusters);
      
      expect(vol.numClusters()).toBe(3);
      expect(vol.length).toBe(125); // 5x5x5
    });

    it('should create with label map', () => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      const labelMap = {
        'region_a': 1,
        'region_b': 2,
        'region_c': 3
      };
      
      const vol = new ClusteredNeuroVol(mask, clusters, labelMap);
      expect(vol.labelMap).toEqual(labelMap);
    });

    it('should throw error if clusters length does not match mask', () => {
      const wrongClusters = [1, 2, 3]; // Too few
      expect(() => new ClusteredNeuroVol(mask, wrongClusters)).toThrow(
        'Clusters array length (3) must match number of true voxels in mask (14)'
      );
    });

    it('should accept number array and convert to Int32Array', () => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      const vol = new ClusteredNeuroVol(mask, clusters);
      expect(vol.clusters).toBeInstanceOf(Int32Array);
    });
  });

  describe('data access', () => {
    let vol: ClusteredNeuroVol;
    
    beforeEach(() => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      vol = new ClusteredNeuroVol(mask, clusters);
    });

    it('should get cluster ID at masked voxels', () => {
      expect(vol.get(0)).toBe(1);
      expect(vol.get(1)).toBe(1);
      expect(vol.get(50)).toBe(2);
      expect(vol.get(100)).toBe(3);
    });

    it('should return 0 for unmasked voxels', () => {
      expect(vol.get(3)).toBe(0);
      expect(vol.get(4)).toBe(0);
      expect(vol.get(60)).toBe(0);
    });

    it('should get cluster ID at coordinates', () => {
      expect(vol.getAt(0, 0, 0)).toBe(1); // Index 0
      expect(vol.getAt(0, 0, 2)).toBe(2); // Index 50
      expect(vol.getAt(0, 0, 4)).toBe(3); // Index 100
    });

    it('should throw error when trying to set values', () => {
      expect(() => vol.setAt(0, 0, 0, 5)).toThrow(
        'ClusteredNeuroVol does not support item assignment'
      );
    });

    it('should get data as dense array', () => {
      const data = vol.getData();
      expect(data).toBeInstanceOf(Int32Array);
      expect(data.length).toBe(125);
      expect(data[0]).toBe(1);
      expect(data[50]).toBe(2);
      expect(data[100]).toBe(3);
      expect(data[3]).toBe(0); // Unmasked
    });
  });

  describe('cluster operations', () => {
    let vol: ClusteredNeuroVol;
    
    beforeEach(() => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      const labelMap = {
        'frontal': 1,
        'parietal': 2,
        'occipital': 3
      };
      vol = new ClusteredNeuroVol(mask, clusters, labelMap);
    });

    it('should get cluster info by ID', () => {
      const info = vol.getClusterInfo(1);
      expect(info).toBeDefined();
      expect(info!.id).toBe(1);
      expect(info!.size).toBe(6);
      expect(info!.label).toBe('frontal');
      expect(info!.indices).toContain(0);
      expect(info!.indices).toContain(1);
    });

    it('should get cluster info by label', () => {
      const info = vol.getClusterInfo('parietal');
      expect(info).toBeDefined();
      expect(info!.id).toBe(2);
      expect(info!.size).toBe(5);
      expect(info!.label).toBe('parietal');
    });

    it('should return undefined for non-existent cluster', () => {
      expect(vol.getClusterInfo(999)).toBeUndefined();
      expect(vol.getClusterInfo('nonexistent')).toBeUndefined();
    });

    it('should get cluster mask', () => {
      const clusterMask = vol.getClusterMask(1);
      expect(clusterMask).toBeInstanceOf(LogicalNeuroVol);
      expect(clusterMask.count()).toBe(6);
      expect(clusterMask.getBool(0)).toBe(true);
      expect(clusterMask.getBool(1)).toBe(true);
      expect(clusterMask.getBool(50)).toBe(false);
    });

    it('should throw error for non-existent cluster mask', () => {
      expect(() => vol.getClusterMask(999)).toThrow('Cluster 999 not found');
    });

    it('should get cluster sizes', () => {
      const sizes = vol.clusterSizes();
      expect(sizes.get(1)).toBe(6);
      expect(sizes.get(2)).toBe(5);
      expect(sizes.get(3)).toBe(3);
    });

    it('should calculate cluster centers', () => {
      const centers = vol.clusterCenters();
      const center1 = centers.get(1);
      expect(center1).toBeDefined();
      expect(center1!.length).toBe(3);
      // Centers should be averages of coordinates
    });
  });

  describe('cluster data extraction', () => {
    it('should extract cluster data from another volume', () => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      const vol = new ClusteredNeuroVol(mask, clusters);
      
      // Create a data volume with values
      const dataVol = new FloatNeuroVol(space);
      for (let i = 0; i < dataVol.length; i++) {
        dataVol.data[i] = i * 0.1;
      }
      
      const cluster1Data = vol.getClusterData(dataVol, 1);
      expect(cluster1Data).toBeInstanceOf(Float32Array);
      expect(cluster1Data.length).toBe(6);
      expect(cluster1Data[0]).toBeCloseTo(0.0); // Index 0
      expect(cluster1Data[1]).toBeCloseTo(0.1); // Index 1
    });

    it('should throw error for mismatched space', () => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      const vol = new ClusteredNeuroVol(mask, clusters);
      
      const otherSpace = new NeuroSpace(
        [3, 3, 3],
        [1, 1, 1],
        [0, 0, 0],
        AxisSet3D.AXIAL_LPI
      );
      const otherVol = new FloatNeuroVol(otherSpace);
      
      expect(() => vol.getClusterData(otherVol, 1)).toThrow(
        'Data volume must have matching space'
      );
    });
  });

  describe('conversions', () => {
    let vol: ClusteredNeuroVol;
    
    beforeEach(() => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      vol = new ClusteredNeuroVol(mask, clusters);
    });

    it('should convert to sparse', () => {
      const sparse = vol.asSparse();
      expect(sparse.nonDefaultCount).toBe(14); // Number of masked voxels
      expect(sparse.get(0)).toBe(1);
      expect(sparse.get(50)).toBe(2);
      expect(sparse.get(100)).toBe(3);
    });

    it('should convert to dense', () => {
      const dense = vol.asDense();
      expect(dense.get(0)).toBe(1);
      expect(dense.get(50)).toBe(2);
      expect(dense.get(100)).toBe(3);
      expect(dense.get(3)).toBe(0); // Unmasked
    });

    it('should convert to logical (returns mask)', () => {
      const logical = vol.asLogical();
      expect(logical).toBe(mask);
    });
  });

  describe('range and metadata', () => {
    it('should get range of cluster IDs', () => {
      const clusters = [1, 1, 5, 5, 10, 10, 2, 2, 3, 3, 3, 7, 7, 7];
      const vol = new ClusteredNeuroVol(mask, clusters);
      
      const [min, max] = vol.getRange();
      expect(min).toBe(1);
      expect(max).toBe(10);
    });

    it('should handle empty clusters', () => {
      const emptyMask = new LogicalNeuroVol(space);
      const vol = new ClusteredNeuroVol(emptyMask, []);
      
      expect(vol.numClusters()).toBe(0);
      const [min, max] = vol.getRange();
      expect(min).toBe(0);
      expect(max).toBe(0);
    });

    it('should provide string representation', () => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      const labelMap = { 'a': 1, 'b': 2, 'c': 3 };
      const vol = new ClusteredNeuroVol(mask, clusters, labelMap);
      
      const str = vol.toString();
      expect(str).toContain('Num clusters   : 3');
      expect(str).toContain('Dimension      : 5 x 5 x 5');
      expect(str).toContain('Label map      : 3 labels');
    });
  });

  describe('factory function', () => {
    it('should create using factory function', () => {
      const clusters = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
      const vol = clusteredNeuroVol(mask, clusters);
      
      expect(vol).toBeInstanceOf(ClusteredNeuroVol);
      expect(vol.numClusters()).toBe(3);
    });
  });
});