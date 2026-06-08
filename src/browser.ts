// Browser-friendly entry point for UMD/ES bundles.
// Export only browser-safe modules (no fs/path/canvas node-only usage).

export { SimpleOrthogonalViewer } from './display/SimpleOrthogonalViewer';
export { OrthogonalImageViewer } from './display/OrthogonalImageViewer';
export { SliceViewer } from './display/SliceViewer';
export { SingleSliceViewer } from './display/SingleSliceViewer';
export { ViewSynchronizer } from './display/ViewSynchronizer';
export type { ViewSynchronizerOptions } from './display/ViewSynchronizer';

export { ImageLayer } from './display/ImageLayer';
export { VolLayer } from './display/VolLayer';
export { VolStack } from './display/VolStack';
export { DepthEnhancedLayer } from './display/DepthEnhancedLayer';
export type { DepthEnhancedOptions } from './display/DepthEnhancedLayer';

export { OrientationLabelLayer } from './display/OrientationLabelLayer';
export type { OrientationLabelOptions } from './display/OrientationLabelLayer';

export { ColorMap } from './display/ColorMap';
export { ColorMapFactory } from './display/ColorMapFactory';

export { AxisSet1D, AxisSet2D, AxisSet3D, NamedAxis } from './geometry/Axis';
export { NeuroSpace } from './geometry/NeuroSpace';

// Types-only exports (erased at runtime)
export type { ISliceModel, ISliceView, ISliceController, ICoordinateTransformer } from './display/interfaces';

// Volume factory and concrete volume classes for browser consumers
export { createNeuroVol } from './volume/NeuroIm';
export {
  DenseNeuroVol,
  FloatNeuroVol,
  Float64NeuroVol,
  Int16NeuroVol,
  Int32NeuroVol,
  Int8NeuroVol,
  UInt8NeuroVol,
  UInt16NeuroVol,
} from './volume/DenseNeuroVol';

// Sparse volume support
export { SparseNeuroVol } from './sparse/SparseNeuroVol';

// ROI classes
export { ROICoords, ROIVol, ROIVec } from './roi/ROI_improved';

// Control panel components (Web Components for browser)
export { LayerControlPanel } from './controls/LayerControlPanelLit';
