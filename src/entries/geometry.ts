/**
 * `neuroimjs/geometry` — spaces, axes and volume geometry without the viewer.
 *
 * This entry is guaranteed not to load the display layer (pixi.js, mobx,
 * lit, src/display, src/controls). `scripts/verify-subpaths.mjs` enforces
 * that guarantee against the packed tarball.
 *
 * @packageDocumentation
 */
export { NeuroSpace } from '../geometry/NeuroSpace';
export {
  NamedAxis,
  AxisSet,
  AxisSet1D,
  AxisSet2D,
  AxisSet3D,
  AXIAL_LPI,
  CORONAL_LIP,
  SAGITTAL_AIL,
} from '../geometry/Axis';
export { getVolumeGeometry, assertSameVolumeGeometry } from '../geometry/VolumeGeometry';
export type { VolumeGeometry } from '../geometry/VolumeGeometry';
