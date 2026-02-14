/**
 * SliceCoordinator manages slice access across multiple volumes in a stack
 * ensuring valid slice indices and consistent behavior
 */

import { VolStack } from '../display/VolStack';
import { AxisSet3D } from '../geometry/Axis';
import {
  SliceAccessStrategy,
  SliceAccessConfig,
  SliceAccessResult,
  SliceAccessError,
  VolumeSliceDimensions
} from '../types/SliceAccess';

export class SliceCoordinator {
  private config: SliceAccessConfig;

  constructor(config?: Partial<SliceAccessConfig>) {
    this.config = {
      strategy: SliceAccessStrategy.THROW,
      logWarnings: true,
      fallbackValue: 0,
      ...config
    };
  }

  /**
   * Validates and normalizes slice access across all volumes in a stack
   */
  validateSliceAccess(
    sliceIndex: number,
    axis: AxisSet3D,
    volStack: VolStack
  ): SliceAccessResult {
    const validRange = this.getValidSliceRange(axis, volStack);
    const volumeDimensions = this.getVolumeDimensions(volStack, axis);
    
    const result: SliceAccessResult = {
      isValid: sliceIndex >= validRange[0] && sliceIndex <= validRange[1],
      sliceIndices: [],
      warnings: [],
      adjustedVolumes: [],
      validRange
    };

    // Check each volume and determine appropriate slice index
    for (let i = 0; i < volStack.length; i++) {
      const volDim = volumeDimensions[i];
      const maxIndex = volDim.currentSliceCount - 1;
      
      if (sliceIndex < 0 || sliceIndex > maxIndex) {
        // Handle out-of-bounds access based on strategy
        const adjustedIndex = this.handleOutOfBounds(
          sliceIndex,
          [0, maxIndex],
          i,
          axis
        );
        
        result.sliceIndices.push(adjustedIndex);
        result.adjustedVolumes.push(i);
        
        const warning = `Volume ${i} (${volDim.volumeId}): Slice ${sliceIndex} out of bounds [0, ${maxIndex}], using ${adjustedIndex}`;
        result.warnings.push(warning);
        
        if (this.config.logWarnings) {
          console.warn(warning);
        }
      } else {
        result.sliceIndices.push(sliceIndex);
      }
    }

    return result;
  }

  /**
   * Returns the valid slice range that works for all volumes in the stack
   */
  getValidSliceRange(axis: AxisSet3D, volStack: VolStack): [number, number] {
    const dimensions = this.getVolumeDimensions(volStack, axis);
    
    if (dimensions.length === 0) {
      return [0, 0];
    }

    // Find the minimum slice count across all volumes
    const minSliceCount = Math.min(
      ...dimensions.map(d => d.currentSliceCount)
    );

    return [0, Math.max(0, minSliceCount - 1)];
  }

  /**
   * Gets dimension information for all volumes in the stack
   */
  getVolumeDimensions(volStack: VolStack, axis: AxisSet3D): VolumeSliceDimensions[] {
    const dimensions: VolumeSliceDimensions[] = [];
    
    for (let i = 0; i < volStack.length; i++) {
      const layer = volStack.getLayer(i);
      const space = layer.space;
      const sliceAxisIndex = this.getSliceAxisIndex(axis);
      
      dimensions.push({
        volumeIndex: i,
        volumeId: layer.id,
        sliceCounts: {
          axial: space.dim[2] || 1,    // Z axis
          sagittal: space.dim[0] || 1,  // X axis
          coronal: space.dim[1] || 1    // Y axis
        },
        currentAxis: axis,
        currentSliceCount: space.dim[sliceAxisIndex] || 1
      });
    }

    return dimensions;
  }

  /**
   * Determines which axis index corresponds to slicing for a given orientation
   */
  private getSliceAxisIndex(axis: AxisSet3D): number {
    const axisStr = axis.toString();
    
    // Determine which dimension we're slicing along
    if (axisStr.includes('XYZ') || axisStr.includes('AXIAL')) {
      return 2; // Slice along Z axis
    } else if (axisStr.includes('YZX') || axisStr.includes('SAGITTAL')) {
      return 0; // Slice along X axis
    } else if (axisStr.includes('XZY') || axisStr.includes('CORONAL')) {
      return 1; // Slice along Y axis
    }
    
    // Default to Z axis for unknown orientations
    return 2;
  }

  /**
   * Handles out-of-bounds slice access based on configured strategy
   */
  private handleOutOfBounds(
    requestedIndex: number,
    validRange: [number, number],
    volumeIndex: number,
    axis: AxisSet3D
  ): number {
    switch (this.config.strategy) {
      case SliceAccessStrategy.THROW:
        throw new SliceAccessError(
          `Slice index ${requestedIndex} is out of bounds for volume ${volumeIndex}`,
          volumeIndex,
          requestedIndex,
          validRange,
          axis
        );
      
      case SliceAccessStrategy.CLAMP:
        return Math.max(validRange[0], Math.min(validRange[1], requestedIndex));
      
      case SliceAccessStrategy.NEAREST:
        if (requestedIndex < validRange[0]) {
          return validRange[0];
        } else if (requestedIndex > validRange[1]) {
          return validRange[1];
        }
        return requestedIndex;
      
      case SliceAccessStrategy.EMPTY:
        // Return -1 to indicate empty slice should be used
        if (this.config.onError) {
          this.config.onError(
            new SliceAccessError(
              `Returning empty slice for out of bounds index ${requestedIndex}`,
              volumeIndex,
              requestedIndex,
              validRange,
              axis
            )
          );
        }
        return -1;
      
      case SliceAccessStrategy.INTERPOLATE:
        // For now, just clamp. Full interpolation would be implemented later
        console.warn('INTERPOLATE strategy not yet implemented, using CLAMP');
        return Math.max(validRange[0], Math.min(validRange[1], requestedIndex));
      
      default:
        return requestedIndex;
    }
  }

  /**
   * Updates the slice access configuration
   */
  setConfig(config: Partial<SliceAccessConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Gets the current configuration
   */
  getConfig(): SliceAccessConfig {
    return { ...this.config };
  }

  /**
   * Utility method to get safe slice indices for testing
   */
  getSafeSliceIndices(
    volStack: VolStack,
    axis: AxisSet3D,
    count: number = 3
  ): number[] {
    const [min, max] = this.getValidSliceRange(axis, volStack);
    const range = max - min + 1;
    
    if (range <= count) {
      // Return all valid indices if we have fewer than requested
      return Array.from({ length: range }, (_, i) => min + i);
    }
    
    // Return evenly spaced indices
    const indices: number[] = [];
    const step = Math.floor(range / (count + 1));
    
    for (let i = 1; i <= count; i++) {
      indices.push(min + step * i);
    }
    
    return indices;
  }
}