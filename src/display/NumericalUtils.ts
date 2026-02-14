/**
 * Numerical utilities for floating-point operations
 * Provides epsilon-based comparisons and other numerical helpers
 */

/**
 * Default epsilon for floating-point comparisons
 */
export const DEFAULT_EPSILON = 1e-6;

/**
 * Epsilon for coordinate comparisons (slightly larger for practical use)
 */
export const COORDINATE_EPSILON = 1e-6;

/**
 * Minimum allowed spacing value to prevent division by zero
 */
export const MIN_SPACING = 1e-6;

/**
 * Check if two numbers are approximately equal within epsilon tolerance
 * @param a First number
 * @param b Second number
 * @param epsilon Tolerance (default: DEFAULT_EPSILON)
 * @returns true if numbers are within epsilon of each other
 */
export function nearlyEqual(a: number, b: number, epsilon: number = DEFAULT_EPSILON): boolean {
  // Handle special cases
  if (a === b) return true; // Handles Infinity === Infinity
  if (isNaN(a) || isNaN(b)) return false; // NaN is never equal
  
  return Math.abs(a - b) <= epsilon;
}

/**
 * Check if a number is approximately zero
 * @param value The number to check
 * @param epsilon Tolerance (default: DEFAULT_EPSILON)
 * @returns true if the number is within epsilon of zero
 */
export function nearlyZero(value: number, epsilon: number = DEFAULT_EPSILON): boolean {
  return Math.abs(value) <= epsilon;
}

/**
 * Check if two arrays of numbers are approximately equal
 * @param a First array
 * @param b Second array
 * @param epsilon Tolerance for each element (default: DEFAULT_EPSILON)
 * @returns true if arrays have same length and all elements are within epsilon
 */
export function arraysNearlyEqual(
  a: number[],
  b: number[],
  epsilon: number = DEFAULT_EPSILON
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  for (let i = 0; i < a.length; i++) {
    if (!nearlyEqual(a[i], b[i], epsilon)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Clamp a value between min and max
 * @param value The value to clamp
 * @param min Minimum value
 * @param max Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  // If min > max, don't clamp (return original value)
  if (min > max) {
    return value;
  }
  return Math.max(min, Math.min(max, value));
}

/**
 * Safe division that checks for zero divisor
 * @param numerator The numerator
 * @param denominator The denominator
 * @param defaultValue Value to return if denominator is too small (default: 0)
 * @param epsilon Minimum denominator value (default: MIN_SPACING)
 * @returns Result of division or defaultValue
 */
export function safeDivide(
  numerator: number,
  denominator: number,
  defaultValue: number = 0,
  epsilon: number = MIN_SPACING
): number {
  // Handle NaN denominator
  if (isNaN(denominator) || Math.abs(denominator) < epsilon) {
    return defaultValue;
  }
  // Handle NaN numerator
  if (isNaN(numerator)) {
    return NaN;
  }
  return numerator / denominator;
}

/**
 * Check if a number is within a range (inclusive)
 * @param value The value to check
 * @param min Minimum value (inclusive)
 * @param max Maximum value (inclusive)
 * @param epsilon Tolerance for boundary comparisons (default: 0)
 * @returns true if value is within range
 */
export function inRange(
  value: number,
  min: number,
  max: number,
  epsilon: number = 0
): boolean {
  return value >= min - epsilon && value <= max + epsilon;
}

/**
 * Round a number to a specified number of decimal places
 * @param value The value to round
 * @param decimals Number of decimal places (default: 0)
 * @returns Rounded value
 */
export function roundTo(value: number, decimals: number = 0): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Round a number to a specified number of decimal places (alias for roundTo)
 * @param value The value to round
 * @param decimals Number of decimal places (default: 0)
 * @returns Rounded value
 */
export function roundToDigits(value: number, decimals: number = 0): number {
  return roundTo(value, decimals);
}

/**
 * Normalize an angle to the range [0, 2π)
 * @param angle The angle in radians
 * @returns Normalized angle in the range [0, 2π)
 */
export function normalizeAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  let normalized = angle % twoPi;
  if (normalized < 0) {
    normalized += twoPi;
  }
  // Handle -0 vs 0 issue
  return normalized === 0 ? 0 : normalized;
}

/**
 * Convert degrees to radians
 * @param degrees Angle in degrees
 * @returns Angle in radians
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Convert radians to degrees
 * @param radians Angle in radians
 * @returns Angle in degrees
 */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Linear interpolation between two values (no clamping)
 * @param a Start value
 * @param b End value
 * @param t Interpolation factor (can be outside [0,1] for extrapolation)
 * @returns Interpolated value
 */
export function interpolate(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Smooth interpolation function with zero derivatives at edges
 * @param edge0 Lower edge
 * @param edge1 Upper edge
 * @param x Input value
 * @returns Smoothly interpolated value between 0 and 1
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return 0;
  }
  
  // Scale, bias and saturate x to 0..1 range
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  
  // Evaluate polynomial
  return t * t * (3 - 2 * t);
}

/**
 * Calculate the Euclidean distance between two points
 * @param a First point
 * @param b Second point
 * @returns Euclidean distance
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Points must have the same dimension');
  }
  
  let sumSquares = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sumSquares += diff * diff;
  }
  
  return Math.sqrt(sumSquares);
}

/**
 * Check if two points are approximately at the same location
 * @param a First point
 * @param b Second point
 * @param epsilon Distance tolerance (default: COORDINATE_EPSILON)
 * @returns true if points are within epsilon distance
 */
export function pointsNearlyEqual(
  a: number[],
  b: number[],
  epsilon: number = COORDINATE_EPSILON
): boolean {
  return euclideanDistance(a, b) < epsilon;
}

/**
 * Linear interpolation between two values
 * @param a Start value
 * @param b End value
 * @param t Interpolation factor (0-1)
 * @returns Interpolated value
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Bilinear interpolation for 2D data
 * @param x00 Value at (0,0)
 * @param x10 Value at (1,0)
 * @param x01 Value at (0,1)
 * @param x11 Value at (1,1)
 * @param u Interpolation factor in x (0-1)
 * @param v Interpolation factor in y (0-1)
 * @returns Interpolated value
 */
export function bilinearInterpolate(
  x00: number,
  x10: number,
  x01: number,
  x11: number,
  u: number,
  v: number
): number {
  const u1 = 1 - u;
  const v1 = 1 - v;
  
  return x00 * u1 * v1 + x10 * u * v1 + x01 * u1 * v + x11 * u * v;
}