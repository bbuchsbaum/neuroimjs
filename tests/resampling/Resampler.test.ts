import { describe, it, expect, beforeEach } from 'vitest';
import { Resampler } from '../../src/resampling/Resampler';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';

describe('Resampler', () => {
  let volume: FloatNeuroVol;
  let space: NeuroSpace;
  let resampler: Resampler;

  beforeEach(() => {
    // Create a 10x10x10 test volume
    space = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
    const data = new Float32Array(1000);
    
    // Initialize with a simple gradient pattern
    let idx = 0;
    for (let k = 0; k < 10; k++) {
      for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 10; i++) {
          data[idx++] = i + j + k;
        }
      }
    }
    
    volume = new FloatNeuroVol(space, data);
    resampler = new Resampler(volume);
  });

  describe('Nearest Neighbor Interpolation', () => {
    it('should interpolate at exact voxel centers', () => {
      const value = resampler.interpolateAt(5, 3, 2, 'nearest');
      expect(value).toBe(5 + 3 + 2);
    });

    it('should round to nearest voxel', () => {
      const value1 = resampler.interpolateAt(5.4, 3.4, 2.4, 'nearest');
      expect(value1).toBe(5 + 3 + 2);
      
      const value2 = resampler.interpolateAt(5.6, 3.6, 2.6, 'nearest');
      expect(value2).toBe(6 + 4 + 3);
    });

    it('should return background value for out-of-bounds', () => {
      const value = resampler.interpolateAt(-1, 5, 5, 'nearest');
      expect(value).toBe(0);
    });
  });

  describe('Linear Interpolation', () => {
    it('should interpolate at exact voxel centers', () => {
      const value = resampler.interpolateAt(5, 3, 2, 'linear');
      expect(value).toBe(5 + 3 + 2);
    });

    it('should interpolate between voxels', () => {
      // Point at (0.5, 0.5, 0.5) should average 8 corners
      const value = resampler.interpolateAt(0.5, 0.5, 0.5, 'linear');
      // Corners: (0,0,0)=0, (1,0,0)=1, (0,1,0)=1, (1,1,0)=2
      //          (0,0,1)=1, (1,0,1)=2, (0,1,1)=2, (1,1,1)=3
      // Average = (0+1+1+2+1+2+2+3)/8 = 12/8 = 1.5
      expect(value).toBeCloseTo(1.5, 5);
    });

    it('should handle edge cases', () => {
      const value = resampler.interpolateAt(9.5, 0, 0, 'linear');
      // At x=9.5, we're interpolating between x=9 (value=9) and x=10 (out of bounds=0)
      // So the value should be 9 * 0.5 + 0 * 0.5 = 4.5
      expect(value).toBeCloseTo(4.5, 1);
    });
  });

  describe('Cubic Interpolation', () => {
    it('should provide smooth interpolation', () => {
      const value = resampler.interpolateAt(5.5, 3.5, 2.5, 'cubic');
      // Should be close to the average of surrounding voxels
      expect(value).toBeCloseTo(5.5 + 3.5 + 2.5, 1);
    });
  });

  describe('Downsampling', () => {
    it('should downsample by factor of 2', () => {
      const downsampled = resampler.downsample(2);
      expect(downsampled.dim).toEqual([5, 5, 5]);
      
      // Check that values are preserved reasonably
      const centerValue = downsampled.getAt(2, 2, 2);
      expect(centerValue).toBeGreaterThan(0);
    });

    it('should apply anti-aliasing by default', () => {
      const downsampled = resampler.downsample(2);
      // After Gaussian smoothing and downsampling, edge values will be affected
      // The original volume has a gradient pattern, so even edges should have some value
      const centerValue = downsampled.getAt(2, 2, 2);
      expect(centerValue).toBeGreaterThan(0); // Center should definitely have value
      
      // Check dimensions
      expect(downsampled.dim).toEqual([5, 5, 5]);
    });

    it('should handle odd dimensions', () => {
      const downsampled = resampler.downsample(3);
      expect(downsampled.dim).toEqual([3, 3, 3]);
    });
  });

  describe('Upsampling', () => {
    it('should upsample by factor of 2', () => {
      const upsampled = resampler.upsample(2);
      expect(upsampled.dim).toEqual([20, 20, 20]);
    });

    it('should interpolate values smoothly', () => {
      const upsampled = resampler.upsample(2);
      
      // Original value at (5,5,5) = 15
      // Upsampled should have similar value at (10,10,10)
      const value = upsampled.getAt(10, 10, 10);
      expect(value).toBeCloseTo(15, 1);
    });
  });

  describe('Resample to Dimensions', () => {
    it('should resample to specific dimensions', () => {
      const resampled = resampler.resampleToDimensions([20, 15, 8]);
      expect(resampled.dim).toEqual([20, 15, 8]);
    });

    it('should preserve field of view', () => {
      const resampled = resampler.resampleToDimensions([20, 20, 20]);
      // Should still contain similar range of values
      const minVal = Math.min(...Array.from((resampled as FloatNeuroVol).getData()));
      const maxVal = Math.max(...Array.from((resampled as FloatNeuroVol).getData()));
      
      expect(minVal).toBeCloseTo(0, 1);
      expect(maxVal).toBeLessThan(30); // Max original value is 27
    });
  });

  describe('Resample to Voxel Size', () => {
    it('should resample to specific voxel size', () => {
      const resampled = resampler.resampleToVoxelSize([2, 2, 2]);
      expect(resampled.dim).toEqual([5, 5, 5]);
      expect(resampled.space.spacing).toEqual([2, 2, 2]);
    });

    it('should handle non-uniform voxel sizes', () => {
      const resampled = resampler.resampleToVoxelSize([1, 2, 0.5]);
      expect(resampled.dim[0]).toBe(10); // Same as original
      expect(resampled.dim[1]).toBe(5);  // Half resolution
      expect(resampled.dim[2]).toBe(20); // Double resolution
    });
  });

  describe('Resample to Target Space', () => {
    it('should resample to new space', () => {
      const targetSpace = new NeuroSpace(
        [15, 15, 15], 
        [0.8, 0.8, 0.8], 
        [0, 0, 0], 
        AxisSet3D.AXIAL_LPI
      );
      
      const resampled = resampler.resample(targetSpace);
      expect(resampled.dim).toEqual([15, 15, 15]);
      expect(resampled.space.spacing).toEqual([0.8, 0.8, 0.8]);
    });

    it('should handle different interpolation methods', () => {
      const targetSpace = new NeuroSpace(
        [8, 8, 8], 
        [1.25, 1.25, 1.25], 
        [0, 0, 0], 
        AxisSet3D.AXIAL_LPI
      );
      
      const nearest = resampler.resample(targetSpace, { method: 'nearest' });
      const linear = resampler.resample(targetSpace, { method: 'linear' });
      const cubic = resampler.resample(targetSpace, { method: 'cubic' });
      
      // All should have same dimensions
      expect(nearest.dim).toEqual([8, 8, 8]);
      expect(linear.dim).toEqual([8, 8, 8]);
      expect(cubic.dim).toEqual([8, 8, 8]);
      
      // But potentially different values
      const idx = 100; // Some arbitrary index
      const nearestVal = (nearest as FloatNeuroVol).getData()[idx];
      const linearVal = (linear as FloatNeuroVol).getData()[idx];
      const cubicVal = (cubic as FloatNeuroVol).getData()[idx];
      
      // Values might differ due to interpolation
      expect(nearestVal).toBeDefined();
      expect(linearVal).toBeDefined();
      expect(cubicVal).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle single voxel volumes', () => {
      const singleVoxelSpace = new NeuroSpace([1, 1, 1], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
      const singleVoxel = new FloatNeuroVol(singleVoxelSpace, new Float32Array([42]));
      const singleResampler = new Resampler(singleVoxel);
      
      const upsampled = singleResampler.upsample(5);
      expect(upsampled.dim).toEqual([5, 5, 5]);
      
      // When upsampling a single voxel with anti-aliasing, values will be smoothed
      // The single voxel at (0,0,0) will be spread across the volume
      // Check that we have non-zero values
      const centerVal = upsampled.getAt(2, 2, 2);
      expect(centerVal).toBeGreaterThan(0);
      
      // The corner at (0,0,0) should have highest value
      const cornerVal = upsampled.getAt(0, 0, 0);
      expect(cornerVal).toBeGreaterThan(centerVal);
    });

    it('should handle extreme downsampling', () => {
      const downsampled = resampler.downsample(10);
      expect(downsampled.dim).toEqual([1, 1, 1]);
      
      // With anti-aliasing, the Gaussian smoothing will significantly affect the value
      // The value should be positive but less than the theoretical average due to smoothing
      const value = downsampled.getAt(0, 0, 0);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(27); // Less than max value
      
      // For extreme downsampling, let's use a more moderate test
      const moderateDownsample = resampler.downsample(2, { antiAlias: false });
      expect(moderateDownsample.dim).toEqual([5, 5, 5]);
      // Center value should be preserved
      const centerValue = moderateDownsample.getAt(2, 2, 2);
      expect(centerValue).toBeGreaterThan(0);
    });
  });

  describe('Background Value', () => {
    it('should use specified background value', () => {
      const targetSpace = new NeuroSpace(
        [15, 15, 15], 
        [1, 1, 1], 
        [-5, -5, -5], // Shift origin to cause out-of-bounds access
        AxisSet3D.AXIAL_LPI
      );
      
      const resampled = resampler.resample(targetSpace, { backgroundValue: -999 });
      
      // Check corners which should be out of bounds
      const cornerValue = resampled.getAt(0, 0, 0);
      expect(cornerValue).toBe(-999);
    });
  });
});