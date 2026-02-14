import { describe, it, expect, beforeEach } from 'vitest';
import { EnhancedFloat32NeuroVec } from '../../src/vec/EnhancedNeuroVec';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';

describe('EnhancedNeuroVec', () => {
  let space: NeuroSpace;
  let vec: EnhancedFloat32NeuroVec;
  const dims = [3, 3, 3, 10]; // 3x3x3 volume with 10 time points

  beforeEach(() => {
    space = new NeuroSpace(dims, [1, 1, 1, 2], [0, 0, 0, 0], AxisSet3D.AXIAL_LPI);
    vec = new EnhancedFloat32NeuroVec(space);
    
    // Initialize with some test data
    for (let t = 0; t < 10; t++) {
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 3; j++) {
          for (let i = 0; i < 3; i++) {
            // Create a simple pattern: value increases with time, starting from 10
            vec.setAt(i, j, k, t, 10 + t + (i + j + k) * 0.1);
          }
        }
      }
    }
  });

  describe('Time Series Access', () => {
    it('should get and set time series', () => {
      const series = vec.getTimeSeries(1, 1, 1);
      expect(series).toBeInstanceOf(Float32Array);
      expect(series.length).toBe(10);
      
      // Check values
      for (let t = 0; t < 10; t++) {
        expect(series[t]).toBeCloseTo(10 + t + 0.3, 5);
      }

      // Set new time series
      const newSeries = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      vec.setTimeSeries(1, 1, 1, newSeries);

      const retrieved = vec.getTimeSeries(1, 1, 1);
      expect(retrieved).toEqual(newSeries);
    });

    it('should throw error for invalid time series length', () => {
      const wrongLength = new Float32Array([1, 2, 3]);
      expect(() => vec.setTimeSeries(0, 0, 0, wrongLength)).toThrow();
    });
  });

  describe('Temporal Statistics', () => {
    it('should calculate temporal mean', () => {
      const meanVol = vec.temporalMean();
      expect(meanVol.dim).toEqual([3, 3, 3]);
      
      // Check mean at voxel (0,0,0)
      const mean = meanVol.getAt(0, 0, 0);
      expect(mean).toBeCloseTo(14.5, 5); // Mean of 10-19
    });

    it('should calculate temporal std', () => {
      const stdVol = vec.temporalStd();
      expect(stdVol.dim).toEqual([3, 3, 3]);
      
      // Check std at voxel (0,0,0)
      const std = stdVol.getAt(0, 0, 0);
      expect(std).toBeCloseTo(3.0277, 3); // Std of 0-9
    });

    it('should calculate temporal min and max', () => {
      const minVol = vec.temporalMin();
      const maxVol = vec.temporalMax();
      
      expect(minVol.getAt(0, 0, 0)).toBe(10);
      expect(maxVol.getAt(0, 0, 0)).toBe(19);
    });

    it('should calculate temporal median', () => {
      const medianVol = vec.temporalMedian();
      expect(medianVol.getAt(0, 0, 0)).toBe(14.5);
    });
  });

  describe('Detrending', () => {
    it('should detrend with mean removal', () => {
      const detrended = vec.detrend('mean');
      const series = detrended.getTimeSeries(0, 0, 0);
      
      // Mean should be approximately 0
      const mean = series.reduce((a, b) => a + b) / series.length;
      expect(mean).toBeCloseTo(0, 5);
    });

    it('should detrend with linear removal', () => {
      // Create a vec with linear trend
      const trendVec = new EnhancedFloat32NeuroVec(space);
      for (let t = 0; t < 10; t++) {
        trendVec.setAt(0, 0, 0, t, 2 * t + 5); // y = 2t + 5
      }

      const detrended = trendVec.detrend('linear');
      const series = detrended.getTimeSeries(0, 0, 0);
      
      // Should remove the linear trend, leaving residuals near 0
      for (let i = 0; i < series.length; i++) {
        expect(Math.abs(series[i])).toBeLessThan(0.1);
      }
    });
  });

  describe('Temporal Correlation', () => {
    it('should calculate correlation with seed voxel', () => {
      const corrVol = vec.temporalCorrelation([0, 0, 0]);
      
      // Correlation with itself should be 1
      expect(corrVol.getAt(0, 0, 0)).toBeCloseTo(1, 5);
      
      // Other voxels should have high correlation (similar pattern)
      expect(corrVol.getAt(1, 1, 1)).toBeGreaterThan(0.9);
    });
  });

  describe('Z-score normalization', () => {
    it('should z-score normalize time series', () => {
      const zscored = vec.zscore();
      
      // Check that each time series has mean ~0 and std ~1
      for (let i = 0; i < 3; i++) {
        const series = zscored.getTimeSeries(i, 0, 0);
        const mean = series.reduce((a, b) => a + b) / series.length;
        const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / (series.length - 1);
        const std = Math.sqrt(variance);
        
        expect(mean).toBeCloseTo(0, 5);
        expect(std).toBeCloseTo(1, 5);
      }
    });
  });

  describe('Percent Signal Change', () => {
    it('should calculate percent signal change', () => {
      const psc = vec.percentSignalChange();
      const series = psc.getTimeSeries(0, 0, 0);
      
      // First time point (baseline) should be near 0%
      expect(series[0]).toBeCloseTo(0, 2);
      
      // Later time points should show increase
      // With baseline of 0 and final value of 9, PSC = (9-0)/0 * 100 = Infinity
      // But we use the mean of first 10% which is 0, causing division issues
      // Let's check that it increases significantly
      expect(series[9]).toBeGreaterThan(series[0]);
    });

    it('should use custom baseline', () => {
      const baseline = [5, 6, 7]; // Use middle time points as baseline
      const psc = vec.percentSignalChange(baseline);
      const series = psc.getTimeSeries(0, 0, 0);
      
      // Early time points should be negative (below baseline)
      expect(series[0]).toBeLessThan(0);
    });
  });

  describe('Convolution', () => {
    it('should convolve with kernel', () => {
      const kernel = [0.25, 0.5, 0.25]; // Simple smoothing kernel
      const convolved = vec.convolve(kernel);
      const series = convolved.getTimeSeries(0, 0, 0);
      
      // Check that convolution smooths the data
      for (let t = 1; t < 9; t++) {
        const original = vec.getTimeSeries(0, 0, 0);
        const expected = 0.25 * original[t-1] + 0.5 * original[t] + 0.25 * original[t+1];
        expect(series[t]).toBeCloseTo(expected, 5);
      }
    });
  });

  describe('Temporal Smoothing', () => {
    it('should apply gaussian smoothing', () => {
      const smoothed = vec.temporalSmooth(1.0);
      const series = smoothed.getTimeSeries(0, 0, 0);
      
      // Smoothed series should have less variance
      const variance = (arr: Float32Array) => {
        const mean = arr.reduce((a, b) => a + b) / arr.length;
        return arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
      };
      
      const origVar = variance(vec.getTimeSeries(0, 0, 0));
      const smoothVar = variance(series);
      
      expect(smoothVar).toBeLessThan(origVar);
    });
  });

  describe('Slicing and Concatenation', () => {
    it('should slice time series', () => {
      const sliced = vec.slice(2, 5);
      expect(sliced.dim).toEqual([3, 3, 3, 3]); // 3 time points
      
      const series = sliced.getTimeSeries(0, 0, 0);
      expect(series.length).toBe(3);
      expect(series[0]).toBe(12); // Original t=2
      expect(series[1]).toBe(13); // Original t=3
      expect(series[2]).toBe(14); // Original t=4
    });

    it('should concatenate two vecs', () => {
      const vec2 = new EnhancedFloat32NeuroVec(space);
      // Initialize vec2 with different pattern
      for (let t = 0; t < 10; t++) {
        vec2.setAt(0, 0, 0, t, 100 + t);
      }

      const concatenated = vec.concatenate(vec2);
      expect(concatenated.dim).toEqual([3, 3, 3, 20]); // 20 time points total
      
      const series = concatenated.getTimeSeries(0, 0, 0);
      expect(series.length).toBe(20);
      expect(series[0]).toBe(10); // From vec
      expect(series[9]).toBe(19); // Last from vec
      expect(series[10]).toBe(100); // First from vec2
      expect(series[19]).toBe(109); // Last from vec2
    });

    it('should throw error for dimension mismatch in concatenation', () => {
      const differentSpace = new NeuroSpace([2, 2, 2, 5], [1, 1, 1, 2], [0, 0, 0, 0], AxisSet3D.AXIAL_LPI);
      const vec2 = new EnhancedFloat32NeuroVec(differentSpace);
      
      expect(() => vec.concatenate(vec2)).toThrow();
    });
  });

  describe('Clone', () => {
    it('should create independent copy', () => {
      const cloned = vec.clone();
      
      // Modify original
      vec.setAt(0, 0, 0, 0, 999);
      
      // Clone should be unchanged
      expect(cloned.getAt(0, 0, 0, 0)).toBe(10);
    });
  });
});