/**
 * Types for slice access and coordination across multiple volumes
 */

import { AxisSet3D } from '../geometry/Axis';

/**
 * Strategy for handling out-of-bounds slice access
 */
export enum SliceAccessStrategy {
  /** Throw an error when slice is out of bounds */
  THROW = 'throw',
  /** Clamp slice index to valid range */
  CLAMP = 'clamp',
  /** Return an empty/black slice */
  EMPTY = 'empty',
  /** Return the nearest valid slice */
  NEAREST = 'nearest',
  /** Interpolate between adjacent slices */
  INTERPOLATE = 'interpolate'
}

/**
 * Configuration for slice access behavior
 */
export interface SliceAccessConfig {
  /** Strategy to use for out-of-bounds access */
  strategy: SliceAccessStrategy;
  /** Optional error handler for logging/monitoring */
  onError?: (error: SliceAccessError) => void;
  /** Fallback value for empty slices */
  fallbackValue?: number;
  /** Whether to log warnings for out-of-bounds access */
  logWarnings?: boolean;
}

/**
 * Result of validating slice access across volumes
 */
export interface SliceAccessResult {
  /** Whether the requested slice is valid for all volumes */
  isValid: boolean;
  /** Actual slice indices to use for each volume */
  sliceIndices: number[];
  /** Any warnings generated during validation */
  warnings: string[];
  /** Volumes that had to be adjusted */
  adjustedVolumes: number[];
  /** The valid range across all volumes */
  validRange: [number, number];
}

/**
 * Error specific to slice access issues
 */
export class SliceAccessError extends Error {
  constructor(
    message: string,
    public readonly volumeIndex: number,
    public readonly requestedIndex: number,
    public readonly validRange: [number, number],
    public readonly axis: AxisSet3D
  ) {
    super(message);
    this.name = 'SliceAccessError';
  }
}

/**
 * Information about slice dimensions for a volume
 */
export interface VolumeSliceDimensions {
  /** Volume index in the stack */
  volumeIndex: number;
  /** Volume ID */
  volumeId: string;
  /** Number of slices in each axis */
  sliceCounts: {
    axial: number;    // Z axis slices
    sagittal: number; // X axis slices
    coronal: number;  // Y axis slices
  };
  /** Current axis being used */
  currentAxis: AxisSet3D;
  /** Number of slices for current axis */
  currentSliceCount: number;
}

/**
 * Parameters for slice extraction
 */
export interface SliceExtractionParams {
  /** The slice index to extract */
  sliceIndex: number;
  /** Which axis to slice along (0=X, 1=Y, 2=Z) */
  sliceAxis: 0 | 1 | 2;
  /** The desired output orientation */
  orientation: AxisSet3D;
}

/**
 * Result of checking volume compatibility
 */
export interface VolumeCompatibilityResult {
  /** Whether volumes are compatible */
  compatible: boolean;
  /** Reasons for incompatibility */
  issues: string[];
  /** Suggested alignment strategy */
  suggestedStrategy?: string;
  /** Whether volumes share same space */
  sameSpace: boolean;
  /** Whether volumes have same dimensions */
  sameDimensions: boolean;
  /** Whether volumes have same spacing */
  sameSpacing: boolean;
}