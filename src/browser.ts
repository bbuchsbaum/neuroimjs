// Browser-friendly entry point for UMD/ES bundles.
// Export only browser-safe modules (no fs/path/canvas node-only usage).

export { SimpleOrthogonalViewer } from './display/SimpleOrthogonalViewer';
export type { LayoutMode, SimpleOrthogonalViewerOptions } from './display/SimpleOrthogonalViewer';
export { OrthogonalImageViewer, ViewName } from './display/OrthogonalImageViewer';
export type {
  OrthogonalImageViewerOptions,
  OrthogonalImageViewerParams,
} from './display/OrthogonalImageViewer';
export { SliceViewer } from './display/SliceViewer';
export { SingleSliceViewer } from './display/SingleSliceViewer';
export { ViewSynchronizer } from './display/ViewSynchronizer';
export type { ViewSynchronizerOptions } from './display/ViewSynchronizer';

export { ImageLayer } from './display/ImageLayer';
export { VolLayer } from './display/VolLayer';
export { VolStack } from './display/VolStack';
export { ImageSlice } from './display/ImageSlice';
export type { BoundingBox } from './display/ImageSlice';
export { DepthEnhancedLayer } from './display/DepthEnhancedLayer';
export type { DepthEnhancedOptions } from './display/DepthEnhancedLayer';

export { OrientationLabelLayer } from './display/OrientationLabelLayer';
export type { OrientationLabelOptions } from './display/OrientationLabelLayer';

export { ColorMap } from './display/ColorMap';
export type {
  Color,
  ColorMapEvents,
  ColorMapOptions,
  NumericTypedArray,
} from './display/ColorMap';
export { ColorMapFactory } from './display/ColorMapFactory';
export type { PresetConfig } from './display/ColorMapFactory';

export { AxisSet1D, AxisSet2D, AxisSet3D, NamedAxis } from './geometry/Axis';
export { NeuroSpace } from './geometry/NeuroSpace';
export type { ViewerStateInfo } from './display/ViewerStateInfo';
export type { ValidationOptions, ValidationResult } from './display/CoordinateValidation';
export type {
  LayerUpdateParams,
  PointerEventHandler,
  SlicePointerEvent,
  ViewerUpdateParams,
} from './display/types/display';
export type {
  AlignmentManagerOptions,
  AlignmentStrategyType,
} from './display/alignment/AlignmentManager';

// Types-only exports (erased at runtime)
export type { ISliceModel, ISliceView, ISliceController, ICoordinateTransformer } from './display/interfaces/index';

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
export { buildScatterField } from './utils/ScatterFieldBuilder';
export { buildScatterFieldAsync } from './utils/ScatterFieldAsync';
export type {
  ScatterFieldMessage,
  ScatterFieldOptions,
  ScatterFieldResult,
  ScatterFieldSpaceMetadata,
  ScatterFieldWorkerRequest,
  ScatterKernel,
  ScatterKernelParameters,
  ScatterPoint,
} from './utils/ScatterFieldBuilder';

// ROI classes
export { ROICoords, ROIVol, ROIVec } from './roi/ROI_improved';

// Browser-parallel neighborhood generation
export {
  searchlightIterator,
  searchlightCoords,
  randomSearchlight,
  clusteredSearchlight,
  bootstrapSearchlight,
} from './searchlight/searchlight';
export type { SearchlightOptions } from './searchlight/searchlight';

// Overlay review / subject consistency helpers
export {
  createReviewVecFromVolumes,
  validateOverlayReviewDataset,
  OverlayReviewSession,
  computeSufficientStats,
  consistencyVolume,
  differenceOfMeansVolume,
  effectVolume,
  meanVolume,
  oneSampleTVolume,
  OverlaySummaryService,
  pairedDifferenceEffectVolume,
  pairedDifferenceMeanVolume,
  pairedDifferenceStats,
  pairedDifferenceTVolume,
  pairedDifferenceVec,
  standardDeviationVolume,
  subtractSubjectFromStats,
  subtractVolumeFromStats,
  welchTVolume,
} from './review/index';
export type {
  ConsistencyOptions,
  OverlayReviewContrast,
  OverlayReviewDataset,
  OverlayReviewSessionOptions,
  ReviewNeuroVec,
  SubjectInfo,
  SufficientStats,
  OverlaySummaryCachePolicy,
  OverlaySummaryServiceOptions,
  PairedDifferenceNeuroVec,
  StatisticalNeuroVec,
  ValidatedOverlayReviewContrast,
  ValidatedOverlayReviewDataset,
} from './review/index';
export { SubjectOverlayViewer } from './review/SubjectOverlayViewer';
export type {
  OverlayReviewLayerOrder,
  SubjectOverlayViewerOptions,
  SubjectOverlayViewerState,
  SummaryLayerOptions,
} from './review/SubjectOverlayViewer';
export {
  OverlayReviewPanel,
  DEFAULT_OVERLAY_REVIEW_REDUCERS,
  overlayCutoffHint,
  sampleOverlayReadout,
} from './controls/OverlayReviewPanelLit';
export type {
  OverlayReviewBuiltInReducerId,
  OverlayReviewMode,
  OverlayReviewView,
  OverlayReviewPanelViewer,
  OverlayReviewReadout,
  OverlayReviewReducer,
  OverlayReviewReducerContext,
  OverlayReviewReducerKind,
  OverlayLegendSpec,
} from './controls/OverlayReviewPanelLit';

// Control panel components (Web Components for browser)
export { LayerControlPanel } from './controls/LayerControlPanelLit';
