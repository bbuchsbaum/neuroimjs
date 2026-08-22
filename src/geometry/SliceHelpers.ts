/**
 * SliceHelpers - View-specific helper functions for slice extraction
 */

import { AxisSet3D } from './Axis';
import { NeuroSpace } from './NeuroSpace';

/**
 * Extract a slice space for a specific view orientation
 * @param space The 3D NeuroSpace to extract from
 * @param sliceIndex The index of the slice to extract
 * @param _viewAxis The viewing orientation (retained for API consistency)
 * @returns A 2D NeuroSpace representing the slice
 */
export function extractSliceForView(
  space: NeuroSpace,
  sliceIndex: number,
  _viewAxis: AxisSet3D
): NeuroSpace {
  // The input space is already reoriented so that its k-axis (index 2)
  // is the dimension we slice along. Simply drop axis 2.
  return space.extractSliceNeuroSpace(sliceIndex, 2);
}

/**
 * Get the axis index that should be used for slicing in a given view
 * @param _viewAxis The viewing orientation (retained for API consistency)
 * @returns The axis index (0=X, 1=Y, 2=Z) to slice along
 */
export function getSliceAxisIndex(_viewAxis: AxisSet3D): number {
  // After reorientation, the third axis (k) is the sliced axis
  return 2;
}

/**
 * Get the maximum valid slice index for a given view and space
 * @param space The NeuroSpace
 * @param viewAxis The viewing orientation
 * @returns The maximum valid slice index
 */
export function getMaxSliceIndex(space: NeuroSpace, viewAxis: AxisSet3D): number {
  const axisIndex = getSliceAxisIndex(viewAxis);
  return space.dim[axisIndex] - 1;
}

/**
 * Validate a slice index for a given view and space
 * @param space The NeuroSpace
 * @param sliceIndex The slice index to validate
 * @param viewAxis The viewing orientation
 * @returns True if the slice index is valid
 */
export function isValidSliceIndex(
  space: NeuroSpace,
  sliceIndex: number,
  viewAxis: AxisSet3D
): boolean {
  const axisIndex = getSliceAxisIndex(viewAxis);
  return sliceIndex >= 0 && sliceIndex < space.dim[axisIndex];
}

/**
 * Get the name of the axis being sliced for a given view
 * @param viewAxis The viewing orientation
 * @returns The name of the axis being sliced ('X', 'Y', or 'Z')
 */
export function getSliceAxisName(viewAxis: AxisSet3D): string {
  const axisIndex = getSliceAxisIndex(viewAxis);
  return ['X', 'Y', 'Z'][axisIndex];
}

/**
 * Calculate the center slice index for a given view
 * @param space The NeuroSpace
 * @param viewAxis The viewing orientation
 * @returns The center slice index
 */
export function getCenterSliceIndex(space: NeuroSpace, viewAxis: AxisSet3D): number {
  const axisIndex = getSliceAxisIndex(viewAxis);
  return Math.floor((space.dim[axisIndex] - 1) / 2);
}

/**
 * Get safe slice indices for testing across multiple volumes
 * @param spaces Array of NeuroSpaces
 * @param viewAxis The viewing orientation
 * @param count Number of indices to generate
 * @returns Array of safe slice indices
 */
export function getSafeSliceIndicesForSpaces(
  spaces: NeuroSpace[],
  viewAxis: AxisSet3D,
  count: number = 3
): number[] {
  if (spaces.length === 0) return [];
  
  const axisIndex = getSliceAxisIndex(viewAxis);
  
  // Find minimum dimension across all spaces
  let minDim = Infinity;
  for (const space of spaces) {
    minDim = Math.min(minDim, space.dim[axisIndex]);
  }
  
  // Generate evenly spaced indices
  const indices: number[] = [];
  const step = Math.max(1, Math.floor(minDim / (count + 1)));
  
  for (let i = 0; i < count; i++) {
    const index = Math.min(step * (i + 1), minDim - 1);
    indices.push(index);
  }
  
  return indices;
}
