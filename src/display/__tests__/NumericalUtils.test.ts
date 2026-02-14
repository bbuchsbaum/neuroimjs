/**
 * Test suite for NumericalUtils
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EPSILON,
  COORDINATE_EPSILON,
  MIN_SPACING,
  nearlyEqual,
  nearlyZero,
  clamp,
  safeDivide,
  roundToDigits,
  normalizeAngle,
  degreesToRadians,
  radiansToDegrees,
  interpolate,
  smoothstep
} from '../NumericalUtils';

describe('NumericalUtils', () => {
  describe('nearlyEqual', () => {
    it('should compare numbers within epsilon', () => {
      expect(nearlyEqual(1.0, 1.0)).toBe(true);
      expect(nearlyEqual(1.0, 1.0000001)).toBe(true);
      expect(nearlyEqual(1.0, 1.1)).toBe(false);
    });

    it('should use custom epsilon', () => {
      expect(nearlyEqual(1.0, 1.01, 0.1)).toBe(true);
      expect(nearlyEqual(1.0, 1.01, 0.001)).toBe(false);
    });

    it('should handle negative numbers', () => {
      expect(nearlyEqual(-1.0, -1.0000001)).toBe(true);
      expect(nearlyEqual(-1.0, -0.9)).toBe(false);
    });

    it('should handle zero', () => {
      expect(nearlyEqual(0, 0)).toBe(true);
      expect(nearlyEqual(0, 0.0000001)).toBe(true);
      expect(nearlyEqual(0, 0.1)).toBe(false);
    });

    it('should handle special values', () => {
      expect(nearlyEqual(Infinity, Infinity)).toBe(true);
      expect(nearlyEqual(-Infinity, -Infinity)).toBe(true);
      expect(nearlyEqual(NaN, NaN)).toBe(false); // NaN !== NaN
    });
  });

  describe('nearlyZero', () => {
    it('should detect near-zero values', () => {
      expect(nearlyZero(0)).toBe(true);
      expect(nearlyZero(0.0000001)).toBe(true);
      expect(nearlyZero(0.1)).toBe(false);
      expect(nearlyZero(-0.0000001)).toBe(true);
    });

    it('should use custom epsilon', () => {
      expect(nearlyZero(0.01, 0.1)).toBe(true);
      expect(nearlyZero(0.01, 0.001)).toBe(false);
    });
  });

  describe('clamp', () => {
    it('should clamp values within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should handle equal min and max', () => {
      expect(clamp(5, 3, 3)).toBe(3);
    });

    it('should handle inverted range', () => {
      expect(clamp(5, 10, 0)).toBe(5); // No clamping when min > max
    });
  });

  describe('safeDivide', () => {
    it('should perform normal division', () => {
      expect(safeDivide(10, 2)).toBe(5);
      expect(safeDivide(-10, 2)).toBe(-5);
      expect(safeDivide(10, -2)).toBe(-5);
    });

    it('should handle division by zero', () => {
      expect(safeDivide(10, 0)).toBe(0); // Default value
      expect(safeDivide(10, 0, 999)).toBe(999); // Custom default
    });

    it('should handle near-zero denominators', () => {
      expect(safeDivide(10, 0.0000001)).toBe(0); // Below epsilon
      expect(safeDivide(10, 0.1)).toBe(100); // Above epsilon
    });

    it('should use custom epsilon', () => {
      expect(safeDivide(10, 0.01, 0, 0.1)).toBe(0); // Below custom epsilon
      expect(safeDivide(10, 0.01, 0, 0.001)).toBe(1000); // Above custom epsilon
    });
  });

  describe('roundToDigits', () => {
    it('should round to specified decimal places', () => {
      expect(roundToDigits(3.14159, 2)).toBe(3.14);
      expect(roundToDigits(3.14159, 4)).toBe(3.1416);
      expect(roundToDigits(3.14159, 0)).toBe(3);
    });

    it('should handle negative numbers', () => {
      expect(roundToDigits(-3.14159, 2)).toBe(-3.14);
    });

    it('should handle large numbers', () => {
      expect(roundToDigits(1234.5678, 2)).toBe(1234.57);
    });

    it('should handle negative decimal places', () => {
      expect(roundToDigits(1234.5678, -2)).toBe(1200);
    });
  });

  describe('normalizeAngle', () => {
    it('should normalize angles to [0, 2π)', () => {
      expect(normalizeAngle(0)).toBe(0);
      expect(normalizeAngle(Math.PI)).toBe(Math.PI);
      expect(normalizeAngle(2 * Math.PI)).toBe(0);
      expect(normalizeAngle(3 * Math.PI)).toBe(Math.PI);
    });

    it('should handle negative angles', () => {
      expect(normalizeAngle(-Math.PI)).toBe(Math.PI);
      expect(normalizeAngle(-2 * Math.PI)).toBe(0);
    });

    it('should handle large angles', () => {
      expect(normalizeAngle(10 * Math.PI)).toBeCloseTo(0, 10);
    });
  });

  describe('angle conversions', () => {
    it('should convert degrees to radians', () => {
      expect(degreesToRadians(0)).toBe(0);
      expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2);
      expect(degreesToRadians(180)).toBeCloseTo(Math.PI);
      expect(degreesToRadians(360)).toBeCloseTo(2 * Math.PI);
    });

    it('should convert radians to degrees', () => {
      expect(radiansToDegrees(0)).toBe(0);
      expect(radiansToDegrees(Math.PI / 2)).toBeCloseTo(90);
      expect(radiansToDegrees(Math.PI)).toBeCloseTo(180);
      expect(radiansToDegrees(2 * Math.PI)).toBeCloseTo(360);
    });

    it('should handle round-trip conversion', () => {
      const degrees = 45;
      const radians = degreesToRadians(degrees);
      expect(radiansToDegrees(radians)).toBeCloseTo(degrees);
    });
  });

  describe('interpolate', () => {
    it('should interpolate between values', () => {
      expect(interpolate(0, 10, 0)).toBe(0);
      expect(interpolate(0, 10, 0.5)).toBe(5);
      expect(interpolate(0, 10, 1)).toBe(10);
    });

    it('should handle negative values', () => {
      expect(interpolate(-10, 10, 0.5)).toBe(0);
    });

    it('should extrapolate when t is outside [0,1]', () => {
      expect(interpolate(0, 10, 2)).toBe(20);
      expect(interpolate(0, 10, -1)).toBe(-10);
    });
  });

  describe('smoothstep', () => {
    it('should provide smooth interpolation', () => {
      expect(smoothstep(0, 10, -5)).toBe(0);
      expect(smoothstep(0, 10, 0)).toBe(0);
      expect(smoothstep(0, 10, 5)).toBe(0.5);
      expect(smoothstep(0, 10, 10)).toBe(1);
      expect(smoothstep(0, 10, 15)).toBe(1);
    });

    it('should handle edge == edge0', () => {
      expect(smoothstep(5, 5, 5)).toBe(0); // Defined as 0 when edges are equal
    });

    it('should provide smooth curve', () => {
      // Check that the derivative is 0 at the edges
      const edge0 = 0;
      const edge1 = 1;
      const epsilon = 0.001;
      
      // Near edge0
      const y0 = smoothstep(edge0, edge1, edge0 + epsilon);
      expect(y0).toBeCloseTo(0, 4);
      
      // Near edge1
      const y1 = smoothstep(edge0, edge1, edge1 - epsilon);
      expect(y1).toBeCloseTo(1, 4);
    });
  });

  describe('Edge Cases', () => {
    it('should handle infinity in calculations', () => {
      expect(nearlyEqual(Infinity, Infinity)).toBe(true);
      expect(clamp(Infinity, 0, 10)).toBe(10);
      expect(safeDivide(Infinity, 2)).toBe(Infinity);
      expect(safeDivide(2, Infinity)).toBe(0);
    });

    it('should handle NaN in calculations', () => {
      expect(nearlyEqual(NaN, 5)).toBe(false);
      expect(clamp(NaN, 0, 10)).toBe(NaN);
      expect(safeDivide(NaN, 2)).toBe(NaN);
      expect(safeDivide(2, NaN)).toBe(0); // NaN denominator treated as zero
    });
  });

  describe('Constants', () => {
    it('should have appropriate default values', () => {
      expect(DEFAULT_EPSILON).toBe(1e-6);
      expect(COORDINATE_EPSILON).toBe(1e-6);
      expect(MIN_SPACING).toBe(1e-6);
    });
  });
});