/**
 * Test suite for CoordinateValidation
 */

import { describe, it, expect } from 'vitest';
import { CoordinateValidator, ValidationOptions } from '../CoordinateValidation';
import { NeuroSpace } from '../../geometry/NeuroSpace';

describe('CoordinateValidator', () => {
  const testSpace = new NeuroSpace(
    [100, 100, 50],
    [1, 1, 2],
    [0, 0, 0]
  );

  describe('validateVoxelCoord', () => {
    it('should validate valid voxel coordinates', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [50, 50, 25],
        [100, 100, 50]
      );
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.clamped).toBeUndefined();
    });

    it('should detect out of bounds coordinates', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [150, 50, 25],
        [100, 100, 50]
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('X coordinate 150 is out of bounds [0, 100)');
    });

    it('should detect negative coordinates', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [50, -10, 25],
        [100, 100, 50]
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Y coordinate -10 is out of bounds [0, 100)');
    });

    it('should detect non-finite coordinates', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [50, Infinity, 25],
        [100, 100, 50]
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Y coordinate is not finite: Infinity');
    });

    it('should clamp coordinates when requested', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [150, -10, 25],
        [100, 100, 50],
        { clamp: true }
      );
      
      expect(result.isValid).toBe(true);
      expect(result.clamped).toEqual([99, 0, 25]);
    });

    it('should respect epsilon tolerance', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [99.9999, 50, 25],
        [100, 100, 50],
        { epsilon: 0.001 }
      );
      
      expect(result.isValid).toBe(true);
    });

    it('should validate dimension count', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [50, 50],
        [100, 100, 50]
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Coordinate dimension mismatch: expected 3, got 2');
    });
  });

  describe('validateWorldCoord', () => {
    it('should validate valid world coordinates', () => {
      const result = CoordinateValidator.validateWorldCoord(
        [50, 50, 50],
        testSpace
      );
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect out of bounds world coordinates', () => {
      const result = CoordinateValidator.validateWorldCoord(
        [150, 50, 50],
        testSpace
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('X coordinate 150 is out of bounds [0, 100)');
    });

    it('should clamp world coordinates', () => {
      const result = CoordinateValidator.validateWorldCoord(
        [150, -10, 50],
        testSpace,
        { clamp: true }
      );
      
      expect(result.isValid).toBe(true);
      expect(result.clamped).toBeDefined();
      if (!Array.isArray(result.clamped)) {
        throw new Error('Expected clamped world coordinates to be an array');
      }
      expect(result.clamped[0]).toBeLessThan(100);
      expect(result.clamped[1]).toBeGreaterThanOrEqual(0);
    });
  });

  describe('validateSliceCoord', () => {
    it('should validate valid slice coordinates', () => {
      const result = CoordinateValidator.validateSliceCoord(
        { x: 50, y: 50 },
        [100, 100],
        [1, 1]
      );
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect out of bounds slice coordinates', () => {
      const result = CoordinateValidator.validateSliceCoord(
        { x: 150, y: 50 },
        [100, 100],
        [1, 1]
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('X coordinate 150 is out of bounds [0, 100)');
    });

    it('should clamp slice coordinates', () => {
      const result = CoordinateValidator.validateSliceCoord(
        { x: 150, y: -10 },
        [100, 100],
        [1, 1],
        { clamp: true }
      );
      
      expect(result.isValid).toBe(true);
      expect(result.clamped).toEqual({ x: 99, y: 0 });
    });

    it('should handle different spacing', () => {
      const result = CoordinateValidator.validateSliceCoord(
        { x: 100, y: 100 },
        [50, 50],
        [2, 2]
      );
      
      expect(result.isValid).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty arrays', () => {
      const result = CoordinateValidator.validateVoxelCoord([], []);
      expect(result.isValid).toBe(true);
    });

    it('should handle NaN values', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [NaN, 50, 25],
        [100, 100, 50]
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('X coordinate is not finite: NaN');
    });

    it('should handle very small epsilon', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [99.999999999],
        [100],
        { epsilon: 1e-12 }
      );
      
      expect(result.isValid).toBe(false);
    });

    it('should handle zero dimensions', () => {
      const result = CoordinateValidator.validateVoxelCoord(
        [0],
        [0]
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('X coordinate 0 is out of bounds [0, 0)');
    });
  });

  describe('Performance', () => {
    it('should handle large coordinate arrays efficiently', () => {
      const largeCoord = new Array(1000).fill(50);
      const largeDims = new Array(1000).fill(100);
      
      const start = performance.now();
      const result = CoordinateValidator.validateVoxelCoord(largeCoord, largeDims);
      const duration = performance.now() - start;
      
      expect(result.isValid).toBe(true);
      expect(duration).toBeLessThan(10); // Should complete in less than 10ms
    });
  });
});
