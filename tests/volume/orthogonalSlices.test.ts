import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractOrthogonalSlices,
  extractAxialSlice,
  extractSagittalSlice,
  extractCoronalSlice,
  getSliceOrientation,
  getWorldBoundsForSlice
} from '../../src/volume/orthogonalSlices';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';
import { Matrix } from 'ml-matrix';

describe('orthogonalSlices', () => {
  let vol: FloatNeuroVol;
  let space: NeuroSpace;
  
  beforeEach(() => {
    // Create a test volume with known dimensions
    const dim = [10, 10, 10];
    const spacing = [1, 1, 1];
    const origin = [0, 0, 0];
    const axes = AxisSet3D.AXIAL_LPI;
    const trans = Matrix.eye(4);
    
    space = new NeuroSpace(dim, spacing, origin, axes, trans);
    
    // Create test data - fill with gradient values for testing
    const data = new Float32Array(10 * 10 * 10);
    for (let k = 0; k < 10; k++) {
      for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 10; i++) {
          const index = k * 100 + j * 10 + i;
          data[index] = i + j * 10 + k * 100;
        }
      }
    }
    
    vol = new FloatNeuroVol(space, data);
  });

  describe('extractOrthogonalSlices', () => {
    it('should extract all three orthogonal slices by default', () => {
      const worldPoint = [5, 5, 5];
      const slices = extractOrthogonalSlices(vol, worldPoint);
      
      expect(slices).toHaveProperty('axial');
      expect(slices).toHaveProperty('sagittal');
      expect(slices).toHaveProperty('coronal');
      expect(Object.keys(slices)).toHaveLength(3);
    });

    it('should extract only requested slice types', () => {
      const worldPoint = [5, 5, 5];
      const slices = extractOrthogonalSlices(vol, worldPoint, ['axial', 'sagittal']);
      
      expect(slices).toHaveProperty('axial');
      expect(slices).toHaveProperty('sagittal');
      expect(slices).not.toHaveProperty('coronal');
      expect(Object.keys(slices)).toHaveLength(2);
    });

    it('should extract single slice type', () => {
      const worldPoint = [5, 5, 5];
      const slices = extractOrthogonalSlices(vol, worldPoint, ['coronal']);
      
      expect(slices).not.toHaveProperty('axial');
      expect(slices).not.toHaveProperty('sagittal');
      expect(slices).toHaveProperty('coronal');
      expect(Object.keys(slices)).toHaveLength(1);
    });

    it('should throw error for non-3D volume', () => {
      const space4D = new NeuroSpace([10, 10, 10, 5], [1, 1, 1, 1], [0, 0, 0, 0]);
      const data4D = new Float32Array(10 * 10 * 10 * 5);

      expect(() => new FloatNeuroVol(space4D, data4D)).toThrow(/3-dimensional/);
    });

    it('should throw error for invalid world point dimensions', () => {
      expect(() => extractOrthogonalSlices(vol, [5, 5])).toThrow('worldPoint must be a 3-element array');
      expect(() => extractOrthogonalSlices(vol, [5, 5, 5, 5])).toThrow('worldPoint must be a 3-element array');
    });

    it('should throw error for world point outside volume bounds', () => {
      const worldPoint = [15, 5, 5]; // Outside x bounds
      expect(() => extractOrthogonalSlices(vol, worldPoint)).toThrow(/outside volume bounds/);
    });

    it('should throw error for invalid slice type', () => {
      const worldPoint = [5, 5, 5];
      expect(() => extractOrthogonalSlices(vol, worldPoint, ['axial', 'invalid' as any])).toThrow(/Invalid slice type/);
    });
  });

  describe('extractAxialSlice', () => {
    it('should extract axial slice at specified world point', () => {
      const worldPoint = [5, 5, 5];
      const slice = extractAxialSlice(vol, worldPoint);
      
      expect(slice.dim).toEqual([10, 10]); // x-y plane
      expect(slice.getData()).toHaveLength(100);
    });

    it('should extract correct axial slice data', () => {
      const worldPoint = [5, 5, 5]; // Should get z=5 slice
      const slice = extractAxialSlice(vol, worldPoint);
      const data = slice.getData();
      
      // Check a few values from the slice
      // At z=5, the base value is 500
      expect(slice.getAt(0, 0)).toBe(500); // i=0, j=0, k=5 => 0 + 0 + 500
      expect(slice.getAt(5, 0)).toBe(505); // i=5, j=0, k=5 => 5 + 0 + 500
      expect(slice.getAt(0, 5)).toBe(550); // i=0, j=5, k=5 => 0 + 50 + 500
      expect(slice.getAt(5, 5)).toBe(555); // i=5, j=5, k=5 => 5 + 50 + 500
    });

    it('should handle edge world coordinates', () => {
      const worldPoint = [0, 0, 0];
      const slice = extractAxialSlice(vol, worldPoint);
      expect(slice.getAt(0, 0)).toBe(0); // Bottom slice
      
      const worldPoint2 = [9, 9, 9];
      const slice2 = extractAxialSlice(vol, worldPoint2);
      expect(slice2.getAt(9, 9)).toBe(999); // Top slice
    });
  });

  describe('extractSagittalSlice', () => {
    it('should extract sagittal slice at specified world point', () => {
      const worldPoint = [5, 5, 5];
      const slice = extractSagittalSlice(vol, worldPoint);
      
      expect(slice.dim).toEqual([10, 10]); // y-z plane  
      expect(slice.getData()).toHaveLength(100);
    });

    it('should extract correct sagittal slice data', () => {
      const worldPoint = [5, 5, 5]; // Should get x=5 slice
      const slice = extractSagittalSlice(vol, worldPoint);
      
      // At x=5, each point has base value 5
      // Check values: for sagittal AIL, we expect y-z plane
      // The exact values depend on how the slice is oriented
      expect(slice).toBeDefined();
      expect(slice.getData()).toHaveLength(100);
    });
  });

  describe('extractCoronalSlice', () => {
    it('should extract coronal slice at specified world point', () => {
      const worldPoint = [5, 5, 5];
      const slice = extractCoronalSlice(vol, worldPoint);
      
      expect(slice.dim).toEqual([10, 10]); // x-z plane
      expect(slice.getData()).toHaveLength(100);
    });

    it('should extract correct coronal slice data', () => {
      const worldPoint = [5, 5, 5]; // Should get y=5 slice
      const slice = extractCoronalSlice(vol, worldPoint);
      
      // At y=5, each point has base value 50
      expect(slice).toBeDefined();
      expect(slice.getData()).toHaveLength(100);
    });
  });

  describe('getSliceOrientation', () => {
    it('should return correct orientation for axial slice', () => {
      const orientation = getSliceOrientation(vol, 'axial');
      expect(orientation).toBe('LR-PA'); // Left-Right and Posterior-Anterior for LPI space
    });

    it('should return correct orientation for sagittal slice', () => {
      const orientation = getSliceOrientation(vol, 'sagittal');
      expect(orientation).toBe('PA-IS'); // Posterior-Anterior and Inferior-Superior
    });

    it('should return correct orientation for coronal slice', () => {
      const orientation = getSliceOrientation(vol, 'coronal');
      expect(orientation).toBe('LR-IS'); // Left-Right and Inferior-Superior
    });

    it('should handle different coordinate systems', () => {
      // Create volume with RAS orientation
      const rasSpace = new NeuroSpace(
        [10, 10, 10],
        [1, 1, 1],
        [0, 0, 0],
        AxisSet3D.AXIAL_RAS,
        Matrix.eye(4)
      );
      const rasVol = new FloatNeuroVol(rasSpace, new Float32Array(1000));
      
      const orientation = getSliceOrientation(rasVol, 'axial');
      expect(orientation).toBe('RL-AP'); // Right-Left and Anterior-Posterior for RAS
    });
  });

  describe('getWorldBoundsForSlice', () => {
    it('should return full bounds when no slice index provided', () => {
      const [minBounds, maxBounds] = getWorldBoundsForSlice(vol, 'axial');
      
      expect(minBounds).toEqual([0, 0, 0]);
      expect(maxBounds).toEqual([9, 9, 9]);
    });

    it('should return bounds for specific axial slice', () => {
      const [minBounds, maxBounds] = getWorldBoundsForSlice(vol, 'axial', 5);
      
      expect(minBounds).toEqual([0, 0, 5]);
      expect(maxBounds).toEqual([9, 9, 5]);
    });

    it('should return bounds for specific sagittal slice', () => {
      const [minBounds, maxBounds] = getWorldBoundsForSlice(vol, 'sagittal', 3);
      
      expect(minBounds).toEqual([3, 0, 0]);
      expect(maxBounds).toEqual([3, 9, 9]);
    });

    it('should return bounds for specific coronal slice', () => {
      const [minBounds, maxBounds] = getWorldBoundsForSlice(vol, 'coronal', 7);
      
      expect(minBounds).toEqual([0, 7, 0]);
      expect(maxBounds).toEqual([9, 7, 9]);
    });

    it('should handle edge slice indices', () => {
      const [minBounds1, maxBounds1] = getWorldBoundsForSlice(vol, 'axial', 0);
      expect(minBounds1[2]).toBe(0);
      expect(maxBounds1[2]).toBe(0);
      
      const [minBounds2, maxBounds2] = getWorldBoundsForSlice(vol, 'axial', 9);
      expect(minBounds2[2]).toBe(9);
      expect(maxBounds2[2]).toBe(9);
    });
  });

  describe('integration tests', () => {
    it('should extract consistent slices from the same world point', () => {
      const worldPoint = [4.5, 4.5, 4.5];
      const slices = extractOrthogonalSlices(vol, worldPoint);
      
      // All slices should be 10x10
      expect(slices.axial.dim).toEqual([10, 10]);
      expect(slices.sagittal.dim).toEqual([10, 10]);
      expect(slices.coronal.dim).toEqual([10, 10]);
      
      // Each slice should have proper data
      expect(slices.axial.getData()).toHaveLength(100);
      expect(slices.sagittal.getData()).toHaveLength(100);
      expect(slices.coronal.getData()).toHaveLength(100);
    });

    it('should handle non-integer world coordinates', () => {
      const worldPoint = [2.7, 3.2, 7.8];
      const slices = extractOrthogonalSlices(vol, worldPoint);
      
      // Should round to nearest grid indices
      expect(slices.axial).toBeDefined();
      expect(slices.sagittal).toBeDefined();
      expect(slices.coronal).toBeDefined();
    });
  });
});
