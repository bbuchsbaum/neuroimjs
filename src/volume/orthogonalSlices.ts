/**
 * Orthogonal slice extraction for neuroimaging volumes.
 * 
 * This module provides functionality to extract orthogonal slices (axial, sagittal, coronal)
 * from 3D neuroimaging volumes at specified world-space coordinates.
 */

import { NeuroVol } from './NeuroVol';
import { NeuroSlice } from './NeuroSlice';
import { AxisSet3D } from '../geometry/Axis';

/**
 * Extract orthogonal slices from a volume at a given world-space point.
 * 
 * This function extracts axial, sagittal, and/or coronal slices from a 3D
 * neuroimaging volume at the specified world-space coordinate.
 * 
 * @param vol - The 3D volume to extract slices from
 * @param worldPoint - World-space coordinates [x, y, z] at which to extract slices
 * @param sliceTypes - Array of slice types to extract. Valid values are 'axial', 'sagittal', 'coronal'.
 *                     If not provided, all three slice types are extracted.
 * @returns Object mapping slice type names to NeuroSlice objects
 * @throws Error if worldPoint is outside volume bounds or has wrong dimensions
 * @throws Error if vol is not a 3D volume
 * 
 * @example
 * ```typescript
 * // Extract all orthogonal slices at world point (10, 20, 30)
 * const slices = extractOrthogonalSlices(vol, [10, 20, 30]);
 * const axialSlice = slices.axial;
 * 
 * // Extract only sagittal slice
 * const slices = extractOrthogonalSlices(vol, [10, 20, 30], ['sagittal']);
 * const sagittalSlice = slices.sagittal;
 * ```
 */
export function extractOrthogonalSlices(
  vol: NeuroVol,
  worldPoint: number[],
  sliceTypes?: Array<'axial' | 'sagittal' | 'coronal'>
): Record<string, NeuroSlice> {
  // Validate volume dimensions
  if (vol.dim.length !== 3) {
    throw new Error('Volume must be 3-dimensional');
  }

  // Validate world point
  if (worldPoint.length !== 3) {
    throw new Error('worldPoint must be a 3-element array');
  }

  // Convert world coordinates to grid indices
  const gridPoint = vol.space.coordToGrid(worldPoint);

  // Check bounds
  for (let i = 0; i < 3; i++) {
    if (gridPoint[i] < 0 || gridPoint[i] >= vol.dim[i]) {
      throw new Error(
        `World point [${worldPoint.join(', ')}] is outside volume bounds. ` +
        `Grid index ${gridPoint[i]} is outside range [0, ${vol.dim[i] - 1}] for axis ${i}`
      );
    }
  }

  // Default to all slice types if not specified
  const types = sliceTypes || ['axial', 'sagittal', 'coronal'];

  // Validate slice types
  const validTypes = new Set(['axial', 'sagittal', 'coronal']);
  for (const sliceType of types) {
    if (!validTypes.has(sliceType)) {
      throw new Error(
        `Invalid slice type: ${sliceType}. Valid types are: ${Array.from(validTypes).join(', ')}`
      );
    }
  }

  // Extract requested slices
  const result: Record<string, NeuroSlice> = {};

  if (types.includes('axial')) {
    result.axial = extractAxialSlice(vol, worldPoint);
  }

  if (types.includes('sagittal')) {
    result.sagittal = extractSagittalSlice(vol, worldPoint);
  }

  if (types.includes('coronal')) {
    result.coronal = extractCoronalSlice(vol, worldPoint);
  }

  return result;
}

/**
 * Extract an axial slice at the given world-space point.
 * 
 * An axial slice is a horizontal slice that shows left-right and 
 * anterior-posterior dimensions.
 * 
 * @param vol - The 3D volume to extract slice from
 * @param worldPoint - World-space coordinates [x, y, z] at which to extract slice
 * @returns 2D axial slice at the specified z-coordinate
 * 
 * @remarks
 * The axial slice is extracted along the z-axis (inferior-superior axis),
 * showing the x-y plane (left-right and anterior-posterior).
 */
export function extractAxialSlice(vol: NeuroVol, worldPoint: number[]): NeuroSlice {
  // Convert world to grid coordinates
  const gridPoint = vol.space.coordToGrid(worldPoint);
  
  // Extract slice along z-axis (axis=2)
  const zIndex = Math.round(gridPoint[2]);
  
  // Use AXIAL_LPI orientation as default for axial slices
  return vol.getSlice(zIndex, AxisSet3D.AXIAL_LPI);
}

/**
 * Extract a sagittal slice at the given world-space point.
 * 
 * A sagittal slice is a vertical slice that divides the brain into 
 * left and right portions, showing anterior-posterior and inferior-superior
 * dimensions.
 * 
 * @param vol - The 3D volume to extract slice from
 * @param worldPoint - World-space coordinates [x, y, z] at which to extract slice
 * @returns 2D sagittal slice at the specified x-coordinate
 * 
 * @remarks
 * The sagittal slice is extracted along the x-axis (left-right axis),
 * showing the y-z plane (anterior-posterior and inferior-superior).
 */
export function extractSagittalSlice(vol: NeuroVol, worldPoint: number[]): NeuroSlice {
  // Convert world to grid coordinates
  const gridPoint = vol.space.coordToGrid(worldPoint);
  
  // Extract slice along x-axis (axis=0)
  const xIndex = Math.round(gridPoint[0]);
  
  // Use SAGITTAL_AIL orientation as default for sagittal slices
  return vol.getSlice(xIndex, AxisSet3D.SAGITTAL_AIL);
}

/**
 * Extract a coronal slice at the given world-space point.
 * 
 * A coronal slice is a vertical slice that divides the brain into 
 * anterior and posterior portions, showing left-right and inferior-superior
 * dimensions.
 * 
 * @param vol - The 3D volume to extract slice from
 * @param worldPoint - World-space coordinates [x, y, z] at which to extract slice
 * @returns 2D coronal slice at the specified y-coordinate
 * 
 * @remarks
 * The coronal slice is extracted along the y-axis (anterior-posterior axis),
 * showing the x-z plane (left-right and inferior-superior).
 */
export function extractCoronalSlice(vol: NeuroVol, worldPoint: number[]): NeuroSlice {
  // Convert world to grid coordinates
  const gridPoint = vol.space.coordToGrid(worldPoint);
  
  // Extract slice along y-axis (axis=1)
  const yIndex = Math.round(gridPoint[1]);
  
  // Use CORONAL_LIP orientation as default for coronal slices
  return vol.getSlice(yIndex, AxisSet3D.CORONAL_LIP);
}

/**
 * Get the anatomical orientation of a slice type for the given volume.
 * 
 * @param vol - The volume to check orientation for
 * @param sliceType - Type of slice: 'axial', 'sagittal', or 'coronal'
 * @returns Anatomical orientation string (e.g., 'LR-PA' for axial in LPI space)
 * 
 * @remarks
 * This function returns the anatomical orientation of the 2D slice axes
 * based on the volume's coordinate system. For example:
 * - Axial in LPI: shows Left-Right and Posterior-Anterior
 * - Sagittal in LPI: shows Posterior-Anterior and Inferior-Superior
 * - Coronal in LPI: shows Left-Right and Inferior-Superior
 */
export function getSliceOrientation(vol: NeuroVol, sliceType: 'axial' | 'sagittal' | 'coronal'): string {
  // Get the axis names from the volume's space
  const axes = vol.space.axes.axes();
  const axisNames = axes.map(axis => {
    // Convert axis names to abbreviated form
    switch (axis.name) {
      case 'LEFT_RIGHT': return 'LR';
      case 'RIGHT_LEFT': return 'RL';
      case 'ANT_POST': return 'AP';
      case 'POST_ANT': return 'PA';
      case 'INF_SUP': return 'IS';
      case 'SUP_INF': return 'SI';
      default: return axis.name;
    }
  });

  switch (sliceType) {
    case 'axial':
      // Axial shows x-y plane (dimensions 0 and 1)
      return `${axisNames[0]}-${axisNames[1]}`;
    case 'sagittal':
      // Sagittal shows y-z plane (dimensions 1 and 2)
      return `${axisNames[1]}-${axisNames[2]}`;
    case 'coronal':
      // Coronal shows x-z plane (dimensions 0 and 2)
      return `${axisNames[0]}-${axisNames[2]}`;
    default:
      throw new Error(`Invalid slice type: ${sliceType}`);
  }
}

/**
 * Get world-space bounds for a slice.
 * 
 * @param vol - The volume to get bounds from
 * @param sliceType - Type of slice: 'axial', 'sagittal', or 'coronal'
 * @param sliceIndex - Grid index of the slice. If not provided, returns bounds for entire dimension.
 * @returns Tuple of [minBounds, maxBounds] where each is a 3-element array of world coordinates
 */
export function getWorldBoundsForSlice(
  vol: NeuroVol,
  sliceType: 'axial' | 'sagittal' | 'coronal',
  sliceIndex?: number
): [number[], number[]] {
  // Get volume bounds in world space
  const bounds = vol.space.bounds();
  const minBounds = [...bounds[0]];
  const maxBounds = [...bounds[1]];

  if (sliceIndex !== undefined) {
    // Get the axis for this slice type
    let axis: number;
    switch (sliceType) {
      case 'axial':
        axis = 2; // z-axis
        break;
      case 'sagittal':
        axis = 0; // x-axis
        break;
      case 'coronal':
        axis = 1; // y-axis
        break;
      default:
        throw new Error(`Invalid slice type: ${sliceType}`);
    }

    // Convert slice index to world coordinate
    const gridPoint = [0, 0, 0];
    gridPoint[axis] = sliceIndex;
    const worldCoord = vol.space.gridToCoord(gridPoint);

    // Set bounds for the specific slice
    minBounds[axis] = worldCoord[axis];
    maxBounds[axis] = worldCoord[axis];
  }

  return [minBounds, maxBounds];
}