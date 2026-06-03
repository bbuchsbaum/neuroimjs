import { describe, it, expect } from 'vitest';
import {
  seriesMean,
  seriesStd,
  seriesMin,
  seriesMax,
  seriesMedian,
} from '../../src/vec/temporalOps';

describe('temporalOps', () => {
  describe('seriesMean', () => {
    it('computes the arithmetic mean (number[])', () => {
      expect(seriesMean([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])).toBeCloseTo(14.5, 10);
    });

    it('computes the mean of a Float32Array', () => {
      expect(seriesMean(new Float32Array([1, 2, 3, 4]))).toBeCloseTo(2.5, 10);
    });

    it('returns NaN for an empty series', () => {
      expect(Number.isNaN(seriesMean([]))).toBe(true);
    });
  });

  describe('seriesStd', () => {
    it('computes the sample (n-1) standard deviation', () => {
      // values 10..19 -> sample sd = sqrt(82.5 / 9) = 3.0276503...
      expect(seriesStd([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])).toBeCloseTo(3.0276503, 6);
    });

    it('matches a hand-computed sample sd', () => {
      // [2,4,4,4,5,5,7,9]: mean 5, sum sq dev 32, sample sd = sqrt(32/7)
      expect(seriesStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10);
    });

    it('works on a Float64Array', () => {
      expect(seriesStd(new Float64Array([1, 1, 1, 1]))).toBeCloseTo(0, 10);
    });
  });

  describe('seriesMin / seriesMax', () => {
    it('finds min and max (number[])', () => {
      const s = [3, -2, 7, 0, 5, -10, 4];
      expect(seriesMin(s)).toBe(-10);
      expect(seriesMax(s)).toBe(7);
    });

    it('finds min and max (Float32Array)', () => {
      const s = new Float32Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      expect(seriesMin(s)).toBe(10);
      expect(seriesMax(s)).toBe(19);
    });

    it('returns identity elements for an empty series', () => {
      expect(seriesMin([])).toBe(Number.POSITIVE_INFINITY);
      expect(seriesMax([])).toBe(Number.NEGATIVE_INFINITY);
    });

    it('does not throw or overflow on a very long series (200k elements)', () => {
      // A naive Math.min(...series) / Math.max(...series) spread would
      // RangeError ("Maximum call stack size exceeded" / too many arguments)
      // on a series this long. The loop-based helpers must handle it.
      const n = 200_000;
      const long = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        long[i] = i; // strictly increasing -> known min/max
      }

      let min = NaN;
      let max = NaN;
      expect(() => {
        min = seriesMin(long);
        max = seriesMax(long);
      }).not.toThrow();

      expect(min).toBe(0);
      expect(max).toBe(n - 1);
    });

    it('also handles a long plain number[] without throwing', () => {
      const n = 200_000;
      const long: number[] = new Array(n);
      for (let i = 0; i < n; i++) {
        long[i] = n - i; // strictly decreasing
      }
      expect(() => seriesMin(long)).not.toThrow();
      expect(() => seriesMax(long)).not.toThrow();
      expect(seriesMin(long)).toBe(1);
      expect(seriesMax(long)).toBe(n);
    });
  });

  describe('seriesMedian', () => {
    it('computes median for an even-length series (average of two centers)', () => {
      expect(seriesMedian([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])).toBe(14.5);
    });

    it('computes median for an odd-length series', () => {
      expect(seriesMedian([7, 1, 3, 9, 5])).toBe(5);
    });

    it('returns NaN for an empty series', () => {
      expect(Number.isNaN(seriesMedian([]))).toBe(true);
    });

    it('sorts numerically, not lexicographically', () => {
      // Lexicographic sort would order [1, 10, 100, 2, 20] and give a wrong median.
      expect(seriesMedian([100, 2, 20, 1, 10])).toBe(10);
    });

    it('does NOT mutate the input array (number[])', () => {
      const input = [5, 3, 1, 4, 2];
      const snapshot = input.slice();
      const result = seriesMedian(input);
      expect(result).toBe(3);
      expect(input).toEqual(snapshot); // unchanged order
    });

    it('does NOT mutate the input Float32Array', () => {
      const input = new Float32Array([5, 3, 1, 4, 2]);
      const snapshot = Float32Array.from(input);
      const result = seriesMedian(input);
      expect(result).toBe(3);
      expect(input).toEqual(snapshot); // unchanged order
    });
  });
});
