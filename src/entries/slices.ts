/**
 * `neuroimjs/slices` — orthogonal slice extraction without the viewer.
 *
 * This entry is guaranteed not to load the display layer (pixi.js, mobx,
 * lit, src/display, src/controls). `scripts/verify-subpaths.mjs` enforces
 * that guarantee against the packed tarball.
 *
 * @packageDocumentation
 */
export {
  extractOrthogonalSlices,
  extractAxialSlice,
  extractSagittalSlice,
  extractCoronalSlice,
  getSliceOrientation,
  getWorldBoundsForSlice,
} from '../volume/orthogonalSlices';
export {
  extractSliceForView,
  getSliceAxisIndex,
  getMaxSliceIndex,
  isValidSliceIndex,
  getSliceAxisName,
  getCenterSliceIndex,
  getSafeSliceIndicesForSpaces,
} from '../geometry/SliceHelpers';
export { NeuroSlice } from '../volume/NeuroSlice';
export type { NeuroVol } from '../volume/NeuroVol';
