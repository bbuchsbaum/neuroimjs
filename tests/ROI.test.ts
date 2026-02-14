import { describe, it, expect, beforeEach } from 'vitest';
import { 
  ROICoords, 
  ROIVol, 
  ROIVolWindow, 
  ROIVec 
} from '../src/roi/ROI_improved';
import {
  sphericalROI,
  cuboidROI,
  squareROI,
  roiFromMask,
  roiFromIndices,
  roiFromCoords
} from '../src/roi/ROI_factories';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { AxisSet3D } from '../src/geometry/Axis';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import { Matrix } from 'ml-matrix';

describe('ROI Classes', () => {
  let space: NeuroSpace;
  
  beforeEach(() => {
    space = new NeuroSpace(
      [10, 10, 10],
      [1, 1, 1],
      [0, 0, 0],
      AxisSet3D.AXIAL_LPI
    );
  });

  describe('ROICoords', () => {
    it('should create from coordinates', () => {
      const coords = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
      const roi = new ROICoords(coords, space);
      
      expect(roi.length).toBe(3);
      expect(roi.coords).toEqual(coords);
      expect(roi.dim).toEqual([3, 3]);
    });

    it('should create default space if not provided', () => {
      const coords = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
      const roi = new ROICoords(coords);
      
      expect(roi.space.dim).toEqual([8, 9, 10]); // max + 1
    });

    it('should throw error for empty coordinates', () => {
      expect(() => new ROICoords([], space)).toThrow('coords must be a non-empty array');
    });

    it('should validate coordinate dimensions', () => {
      const badCoords = [[1, 2], [3, 4, 5]]; // Mixed dimensions
      expect(() => new ROICoords(badCoords as any, space)).toThrow('Each coordinate must be an array of length 3');
    });

    it('should calculate indices', () => {
      const coords = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
      const roi = new ROICoords(coords, space);
      
      const indices = roi.indices();
      expect(indices).toEqual([0, 1, 10]); // Based on row-major indexing
    });

    it('should calculate centroid', () => {
      const coords = [[0, 0, 0], [2, 0, 0], [1, 3, 0]];
      const roi = new ROICoords(coords, space);
      
      const centroid = roi.centroid();
      expect(centroid[0]).toBeCloseTo(1.0);
      expect(centroid[1]).toBeCloseTo(1.0);
      expect(centroid[2]).toBeCloseTo(0.0);
    });

    it('should extract subset', () => {
      const coords = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
      const roi = new ROICoords(coords, space);
      
      // Single index
      const sub1 = roi.getSubset(1);
      expect(sub1.coords).toEqual([[4, 5, 6]]);
      
      // Multiple indices
      const sub2 = roi.getSubset([0, 2]);
      expect(sub2.coords).toEqual([[1, 2, 3], [7, 8, 9]]);
      
      // Boolean mask
      const sub3 = roi.getSubset([true, false, true]);
      expect(sub3.coords).toEqual([[1, 2, 3], [7, 8, 9]]);
    });
  });

  describe('ROIVol', () => {
    it('should create with data', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = new Float32Array([10, 20]);
      const roi = new ROIVol(data, space, coords);
      
      expect(roi.data).toEqual(data);
      expect(roi.get(0)).toBe(10);
      expect(roi.get(1)).toBe(20);
    });

    it('should convert array to TypedArray', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = [10, 20];
      const roi = new ROIVol(data, space, coords);
      
      expect(roi.data).toBeInstanceOf(Float32Array);
      expect(roi.get(0)).toBe(10);
    });

    it('should throw error for mismatched data length', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = new Float32Array([10]); // Wrong length
      
      expect(() => new ROIVol(data, space, coords)).toThrow(
        'Length of data (1) must equal number of coordinates (2)'
      );
    });

    it('should get value at coordinates', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = new Float32Array([10, 20]);
      const roi = new ROIVol(data, space, coords);
      
      expect(roi.getAt(1, 2, 3)).toBe(10);
      expect(roi.getAt(4, 5, 6)).toBe(20);
      expect(roi.getAt(0, 0, 0)).toBe(0); // Not in ROI
    });

    it('should convert to sparse', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = new Float32Array([10, 20]);
      const roi = new ROIVol(data, space, coords);
      
      const sparse = roi.asSparse();
      expect(sparse.get(space.gridToIndex([1, 2, 3]))).toBe(10);
      expect(sparse.get(space.gridToIndex([4, 5, 6]))).toBe(20);
    });

    it('should extract subset with data', () => {
      const coords = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
      const data = new Float32Array([10, 20, 30]);
      const roi = new ROIVol(data, space, coords);
      
      const sub = roi.getSubset([0, 2]);
      expect(sub.coords).toEqual([[1, 2, 3], [7, 8, 9]]);
      expect(Array.from(sub.data)).toEqual([10, 30]);
    });
  });

  describe('ROIVolWindow', () => {
    it('should create with center index', () => {
      const coords = [[4, 5, 5], [5, 5, 5], [6, 5, 5]];
      const data = new Float32Array([1, 2, 1]);
      const roi = new ROIVolWindow(space, coords, data, 1);
      
      expect(roi.centerIndex).toBe(1);
      expect(roi.parentIndex).toBe(space.gridToIndex([5, 5, 5]));
    });

    it('should throw error for invalid center index', () => {
      const coords = [[4, 5, 5], [5, 5, 5], [6, 5, 5]];
      const data = new Float32Array([1, 2, 1]);
      
      expect(() => new ROIVolWindow(space, coords, data, 5)).toThrow(
        'centerIndex must be a valid index within coords'
      );
    });
  });

  describe('ROIVec', () => {
    it('should create with matrix data', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = new Matrix([[10, 11], [20, 21]]); // 2 voxels, 2 components
      const roi = new ROIVec(data, space, coords);
      
      expect(roi.ncol).toBe(2);
      expect(roi.getVector(0)).toEqual([10, 11]);
      expect(roi.getVector(1)).toEqual([20, 21]);
    });

    it('should create from array data', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = [[10, 11], [20, 21]];
      const roi = new ROIVec(data, space, coords);
      
      expect(roi.data).toBeInstanceOf(Matrix);
      expect(roi.getVector(0)).toEqual([10, 11]);
    });

    it('should get and set vectors', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = new Matrix([[10, 11], [20, 21]]);
      const roi = new ROIVec(data, space, coords);
      
      roi.setVector(0, [30, 31]);
      expect(roi.getVector(0)).toEqual([30, 31]);
    });

    it('should get and set columns', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = new Matrix([[10, 11], [20, 21]]);
      const roi = new ROIVec(data, space, coords);
      
      expect(roi.getColumn(0)).toEqual([10, 20]);
      expect(roi.getColumn(1)).toEqual([11, 21]);
      
      roi.setColumn(0, [30, 40]);
      expect(roi.getColumn(0)).toEqual([30, 40]);
    });
  });
});

describe('ROI Factory Functions', () => {
  let space: NeuroSpace;
  let vol: FloatNeuroVol;
  
  beforeEach(() => {
    space = new NeuroSpace(
      [10, 10, 10],
      [1, 1, 1],
      [0, 0, 0],
      AxisSet3D.AXIAL_LPI
    );
    vol = new FloatNeuroVol(space);
    
    // Fill with some test data
    for (let i = 0; i < vol.length; i++) {
      vol.data[i] = i % 10;
    }
  });

  describe('sphericalROI', () => {
    it('should create spherical ROI', () => {
      const roi = sphericalROI(vol, [5, 5, 5], 2);
      
      expect(roi).toBeInstanceOf(ROIVolWindow);
      expect(roi.centerIndex).toBeGreaterThanOrEqual(0);
      
      // Check that all coords are within radius
      const center = [5, 5, 5];
      for (const coord of roi.coords) {
        const dist = Math.sqrt(
          (coord[0] - center[0]) ** 2 +
          (coord[1] - center[1]) ** 2 +
          (coord[2] - center[2]) ** 2
        );
        expect(dist).toBeLessThanOrEqual(2);
      }
    });

    it('should respect nonzero constraint', () => {
      // Set some voxels to zero
      vol.setAt(5, 5, 5, 0);
      vol.setAt(5, 5, 6, 0);
      
      const roi = sphericalROI(vol, [5, 5, 5], 1, 1, true);
      
      // Center and adjacent zero voxel should be excluded
      const hasCenter = roi.coords.some(c => 
        c[0] === 5 && c[1] === 5 && c[2] === 5
      );
      expect(hasCenter).toBe(false);
    });
  });

  describe('cuboidROI', () => {
    it('should create cuboid ROI with uniform surround', () => {
      const roi = cuboidROI(vol, [5, 5, 5], 1);
      
      expect(roi).toBeInstanceOf(ROIVolWindow);
      expect(roi.length).toBe(27); // 3x3x3 cube
      expect(roi.centerIndex).toBeGreaterThanOrEqual(0);
    });

    it('should create cuboid ROI with different surrounds', () => {
      const roi = cuboidROI(vol, [5, 5, 5], [1, 2, 0]);
      
      // Should be 3x5x1 cuboid
      const dims = [
        new Set(roi.coords.map(c => c[0])).size,
        new Set(roi.coords.map(c => c[1])).size,
        new Set(roi.coords.map(c => c[2])).size
      ];
      expect(dims).toEqual([3, 5, 1]);
    });
  });

  describe('squareROI', () => {
    it('should create square ROI in xy plane', () => {
      const roi = squareROI(vol, [5, 5, 5], 1, 2); // Fix z dimension
      
      // All z coordinates should be 5
      const zCoords = new Set(roi.coords.map(c => c[2]));
      expect(zCoords.size).toBe(1);
      expect(zCoords.has(5)).toBe(true);
      
      // Should be 3x3 in xy
      expect(roi.length).toBe(9);
    });

    it('should create square ROI in xz plane', () => {
      const roi = squareROI(vol, [5, 5, 5], 1, 1); // Fix y dimension
      
      // All y coordinates should be 5
      const yCoords = new Set(roi.coords.map(c => c[1]));
      expect(yCoords.size).toBe(1);
      expect(yCoords.has(5)).toBe(true);
    });
  });

  describe('roiFromMask', () => {
    it('should create ROI from mask', () => {
      const mask = new LogicalNeuroVol(space);
      mask.setBoolAt(1, 2, 3, true);
      mask.setBoolAt(4, 5, 6, true);
      
      const roi = roiFromMask(mask);
      
      expect(roi.coords).toEqual([[1, 2, 3], [4, 5, 6]]);
      expect(Array.from(roi.data)).toEqual([1, 1]);
    });

    it('should use custom fill value', () => {
      const mask = new LogicalNeuroVol(space);
      mask.setBoolAt(1, 2, 3, true);
      
      const roi = roiFromMask(mask, 42);
      expect(roi.get(0)).toBe(42);
    });
  });

  describe('roiFromIndices', () => {
    it('should create ROI from linear indices', () => {
      const indices = [100, 200, 300];
      const roi = roiFromIndices(space, indices);
      
      expect(roi.length).toBe(3);
      expect(roi.indices()).toEqual(indices);
    });
  });

  describe('roiFromCoords', () => {
    it('should create ROICoords without data', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const roi = roiFromCoords(space, coords);
      
      expect(roi).toBeInstanceOf(ROICoords);
      expect(roi.coords).toEqual(coords);
    });

    it('should create ROIVol with data', () => {
      const coords = [[1, 2, 3], [4, 5, 6]];
      const data = [10, 20];
      const roi = roiFromCoords(space, coords, data);
      
      expect(roi).toBeInstanceOf(ROIVol);
      expect((roi as ROIVol).get(0)).toBe(10);
    });
  });
});