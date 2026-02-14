import { NeuroSpace } from '../geometry/NeuroSpace';

/**
 * Abstract base class for Region of Interest (ROI) objects.
 * 
 * Direct translation of Python's ROI abstract base class.
 * 
 * @abstract
 */
export abstract class ROI {
  abstract readonly space: NeuroSpace;
  abstract readonly coords: number[][];
  
  /**
   * Get the number of voxels in the ROI.
   */
  abstract get length(): number;
  
  /**
   * Get linear indices for the coordinates.
   */
  abstract indices(): number[];
  
  /**
   * String representation of the ROI.
   */
  abstract toString(): string;
}