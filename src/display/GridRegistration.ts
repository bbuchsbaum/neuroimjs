// File: src/display/GridRegistration.ts

import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D } from '../geometry/Axis';

/**
 * How one layer's voxel grid sits inside the reference layer's grid for a
 * given view, after both have been reoriented to the view axes.
 *
 * A layer voxel (m, n, k) of the reoriented layer grid lands at reference
 * grid coordinates `origin + [stepI * m, stepJ * n, stepK * k]`. Image-content
 * space in a slice view is the reference slice's pixel grid, so this is all
 * that is needed to draw the layer's own slice at its true world position.
 */
export interface GridRegistration {
  /** Reference grid coordinates (reoriented) of layer voxel (0, 0, 0). */
  origin: [number, number, number];
  /** Reference voxels per layer voxel along the view's i axis. */
  stepI: number;
  /** Reference voxels per layer voxel along the view's j axis. */
  stepJ: number;
  /** Reference voxels per layer voxel through the plane. */
  stepK: number;
  /** Number of layer slices through the plane. */
  depth: number;
}

/**
 * Where to draw one layer slice in image-content space.
 *
 * A sprite with anchor and pivot at 0 maps texture pixel t to
 * `position + scale * t`; dividing `scale` by the slice's upsampling factor
 * keeps that true for resampled ('smooth', 'cubic') textures.
 */
export interface SlicePlacement {
  position: [number, number];
  scale: [number, number];
}

/**
 * Registers a layer grid to the reference grid for one view.
 *
 * Returns null when the two grids are not related by a per-axis scale and
 * shift once both are reoriented to the view, i.e. when the layer's slice
 * planes are not parallel to the reference's or its in-plane axes are rotated
 * or sheared relative to them. Callers then fall back to heuristic alignment.
 *
 * @param reference - Space of the reference (base) layer.
 * @param layer - Space of the layer to draw over it.
 * @param viewAxes - The view orientation.
 * @param tolerance - Largest off-axis coupling accepted, as a fraction of the
 *   largest per-axis step.
 */
export function registerGrid(
  reference: NeuroSpace,
  layer: NeuroSpace,
  viewAxes: AxisSet3D,
  tolerance = 1e-6
): GridRegistration | null {
  let ref: NeuroSpace;
  let own: NeuroSpace;
  try {
    ref = reference.reorient(viewAxes);
    own = layer.reorient(viewAxes);
  } catch {
    return null;
  }

  const toRef = (voxel: number[]): number[] => ref.coordToGrid(own.gridToCoord(voxel));
  const origin = toRef([0, 0, 0]);
  const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(unit => {
    const p = toRef(unit);
    return [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  });

  const steps = [columns[0][0], columns[1][1], columns[2][2]];
  if (steps.some(step => !Number.isFinite(step) || step === 0)) return null;
  const size = Math.max(...steps.map(Math.abs));
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) {
      if (row !== column && Math.abs(columns[column][row]) > tolerance * size) return null;
    }
  }

  return {
    origin: [origin[0], origin[1], origin[2]],
    stepI: steps[0],
    stepJ: steps[1],
    stepK: steps[2],
    depth: own.dim[2],
  };
}

/**
 * The layer slice nearest to a reference slice plane.
 *
 * @returns The layer's own (reoriented) slice index, or null when the
 *   reference plane lies outside the layer's slab.
 */
export function layerSliceForReference(
  registration: GridRegistration,
  referenceSliceIndex: number
): number | null {
  const exact = (referenceSliceIndex - registration.origin[2]) / registration.stepK;
  // Absorb floating-point noise so exact half-way planes round consistently.
  const index = Math.round(exact + 1e-9);
  return index >= 0 && index < registration.depth ? index : null;
}

/**
 * Sprite placement that puts each layer voxel centre on its world position in
 * image-content space, where reference voxel u covers [u, u + 1).
 */
export function placeLayerSlice(registration: GridRegistration, upsample = 1): SlicePlacement {
  const { origin, stepI, stepJ } = registration;
  return {
    position: [origin[0] + 0.5 * (1 - stepI), origin[1] + 0.5 * (1 - stepJ)],
    scale: [stepI / upsample, stepJ / upsample],
  };
}
