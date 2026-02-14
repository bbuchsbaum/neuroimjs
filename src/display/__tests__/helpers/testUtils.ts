/**
 * Test utility functions for display tests
 */

import { VolStack } from '../../VolStack';
import { AxisSet3D } from '../../../geometry/Axis';

/**
 * Get a safe slice index that is within bounds for all volumes in a stack
 * @param volStack The volume stack to check
 * @param axis The axis orientation for slicing
 * @param preferredIndex The preferred slice index (will be clamped to valid range)
 * @returns A slice index that is valid for all volumes in the stack
 */
export function getSafeSliceIndex(
  volStack: VolStack,
  axis: AxisSet3D,
  preferredIndex: number = -1
): number {
  // Get the minimum valid slice count across all volumes
  let minSliceCount = Infinity;
  
  for (let i = 0; i < volStack.length; i++) {
    const layer = volStack.getLayer(i);
    const space = layer.space;
    
    // For axial (XYZ), we slice along Z axis (index 2)
    // For sagittal (YZX), we slice along X axis (index 0)  
    // For coronal (XZY), we slice along Y axis (index 1)
    let sliceAxisIndex: number;
    const axisStr = axis.toString();
    
    if (axisStr.includes('XYZ')) {
      sliceAxisIndex = 2; // Z axis
    } else if (axisStr.includes('YZX')) {
      sliceAxisIndex = 0; // X axis
    } else if (axisStr.includes('XZY')) {
      sliceAxisIndex = 1; // Y axis
    } else {
      // Default to Z axis for unknown orientations
      sliceAxisIndex = 2;
    }
    
    const sliceCount = space.dim[sliceAxisIndex];
    minSliceCount = Math.min(minSliceCount, sliceCount);
  }
  
  // If preferred index is negative or not specified, use middle slice
  if (preferredIndex < 0) {
    return Math.floor(minSliceCount / 2);
  }
  
  // Clamp preferred index to valid range
  return Math.max(0, Math.min(preferredIndex, minSliceCount - 1));
}

/**
 * Get the maximum valid slice indices for each axis orientation
 * @param volStack The volume stack to check
 * @returns Object with max indices for each standard view
 */
export function getMaxSliceIndices(volStack: VolStack): {
  axial: number;
  sagittal: number;
  coronal: number;
} {
  const axial = getSafeSliceIndex(volStack, AxisSet3D.fromStr('XYZ'), Infinity);
  const sagittal = getSafeSliceIndex(volStack, AxisSet3D.fromStr('YZX'), Infinity);
  const coronal = getSafeSliceIndex(volStack, AxisSet3D.fromStr('XZY'), Infinity);
  
  return { axial, sagittal, coronal };
}