// src/index.ts

// Exporting classes and functions from your library
export { AxisSet1D } from './geometry/Axis';
export { AxisSet2D } from './geometry/Axis';
export { AxisSet3D } from './geometry/Axis';
export { NamedAxis } from './geometry/Axis';
export { AxisSet } from './geometry/Axis';

// Standard orientation constants for composable views
export { AXIAL_LPI, CORONAL_LIP, SAGITTAL_AIL } from './geometry/Axis';
export type { NeuroVol } from './volume/NeuroVol';
export { DenseNeuroVol } from './volume/DenseNeuroVol';
export { LogicalNeuroVol } from './volume/LogicalNeuroVol';
export { ClusteredNeuroVol, clusteredNeuroVol } from './volume/ClusteredNeuroVol';
export type { LabelMap, ClusterInfo } from './volume/ClusteredNeuroVol';

export { NeuroSlice } from './volume/NeuroSlice';
export { VoxelIterator } from './volume/VoxelIterator';
export { NeuroSpace } from './geometry/NeuroSpace';
export * from './types';
export { VolLayer } from './display/VolLayer';
export { read_vol, write_vol } from './io/nifti';
// Enhanced I/O exports
export { 
  readVol, 
  writeVol, 
  readHeader, 
  readVolList, 
  readVec, 
  writeVec
} from './io/io';
export { FileFormat, NIFTIFormat, NIFTIDualFormat, AFNIFormat, findDescriptor, getFormat } from './io/formats';
export type { ReadVolOptions, WriteVolOptions, HeaderInfo } from './io/io';
export { createNeuroVol } from './volume/NeuroIm';
export { createNeuroSlice } from './volume/NeuroIm';
export { SliceViewer } from './display/SliceViewer';
export { OrthogonalImageViewer } from './display/OrthogonalImageViewer';
export { SimpleOrthogonalViewer } from './display/SimpleOrthogonalViewer';
export { ImageLayer } from './display/ImageLayer';
export { ColorMap } from './display/ColorMap';
export { ColorMapFactory } from './display/ColorMapFactory';
export { VolStack } from './display/VolStack';
export { ViewerFactory } from './display/ViewerFactory';
export { buildScatterField } from './utils/ScatterFieldBuilder';
export { buildScatterFieldAsync } from './utils/ScatterFieldAsync';

// Composable view components (NEW)
export { SingleSliceViewer } from './display/SingleSliceViewer';
export { ViewSynchronizer } from './display/ViewSynchronizer';
export type { SingleSliceViewerOptions, SingleSliceViewerEvents } from './display/SingleSliceViewer';
export type { ViewSynchronizerOptions } from './display/ViewSynchronizer';

// Export interfaces for dependency injection
export type { ISliceModel, ISliceView, ISliceController, ICoordinateTransformer } from './display/interfaces';

// Export SliceLayer interface for custom layer development (PUBLIC API)
export type { SliceLayer, ScreenLayoutContext } from './display/SliceLayer';

// Orientation labels (L/R/A/P/S/I) overlay
export { OrientationLabelLayer } from './display/OrientationLabelLayer';
export type { OrientationLabelOptions } from './display/OrientationLabelLayer';

// Export concrete classes for backward compatibility
export { SliceModel } from './display/SliceModel';
export { SliceView } from './display/SliceView';
export { SliceController } from './display/SliceController';
export { CoordinateTransformer } from './display/CoordinateTransformer';
// ROI classes and functions
export { ROI } from './roi/ROI_base';
export { ROICoords, ROIVol, ROIVolWindow, ROIVec, ROIVecWindow } from './roi/ROI_improved';
export { 
  sphericalROI, 
  cuboidROI, 
  squareROI, 
  roiFromMask, 
  roiFromIndices, 
  roiFromCoords 
} from './roi/ROI_factories';
export { SparseNeuroVol } from './sparse/SparseNeuroVol';
export { LayerControlPanel } from './controls/LayerControlPanelLit';
export { StatusBar } from './controls/StatusBar';
export { NeuroAtlas } from './atlas/NeuroAtlas';

// Vector classes
export { BigNeuroVec, bigNeuroVecSeq } from './vector/BigNeuroVec';

// Enhanced 4D NeuroVec classes
export { INeuroVec, DetrendMethod, TemporalFilter, NeuroVecOptions } from './vec/INeuroVec';
export { NeuroVec, DenseNeuroVec, Float32NeuroVec, Float64NeuroVec, Int16NeuroVec, Uint8NeuroVec } from './vec/NeuroVec';
export { EnhancedDenseNeuroVec, EnhancedFloat32NeuroVec } from './vec/EnhancedNeuroVec';
export { FileBackedNeuroVec } from './vec/FileBackedNeuroVec';
export { MappedNeuroVec, MappedNeuroVecOptions } from './vec/MappedNeuroVec';
export { SparseNeuroVec } from './vec/SparseNeuroVec';

// Spatial filtering
export { ISpatialFilter, BilateralFilterOptions, GuidedFilterOptions, MorphOperation } from './spatial/ISpatialFilter';
export { Kernel3D } from './spatial/Kernel3D';
export { SpatialFilter, addSpatialFilteringToNeuroVol } from './spatial/SpatialFilter';

// Resampling and interpolation
export { IResampler, InterpolationMethod, ResampleOptions, TransformOptions } from './resampling/IResampler';
export { Resampler, addResamplingToNeuroVol } from './resampling/Resampler';

// High-dimensional data structures (5D+)
export { 
  INeuroHyperVec, 
  DimensionInfo, 
  NeuroHyperVecOptions, 
  ReductionOp, 
  ReductionOptions,
  FeatureExtractionOptions 
} from './hypervec/INeuroHyperVec';
export { DenseNeuroHyperVec, createNeuroHyperVec } from './hypervec/NeuroHyperVec';

// Volume arithmetic
export {
  addVol,
  subtractVol,
  multiplyVol,
  divideVol,
  greaterThan,
  lessThan,
  equalTo,
  negateVol,
  absVol,
  sqrtVol,
  sumVol,
  meanVol,
  minVol,
  maxVol,
  mapVol
} from './volume/VolumeOps';

// Statistical operations
export {
  splitBlocks,
  splitClusters,
  splitFill,
  splitReduce,
  splitScale,
  partition,
  mapValues,
  centroids,
  StatFunctions,
  concat,
  series,
  scaleSeries
} from './stats/stats';

// Connected components analysis
export {
  ConnectedComponents,
  clusterTable,
  localMaxima
} from './roi/ConnectedComponents';
export type {
  Cluster,
  Connectivity,
  ConnectedComponentsResult,
  ClusterTableEntry
} from './roi/ConnectedComponents';

// Searchlight analysis
export {
  searchlightIterator,
  searchlightCoords,
  randomSearchlight,
  clusteredSearchlight,
  bootstrapSearchlight
} from './searchlight/searchlight';
export type { SearchlightOptions } from './searchlight/searchlight';

// Orthogonal slice extraction
export {
  extractOrthogonalSlices,
  extractAxialSlice,
  extractSagittalSlice,
  extractCoronalSlice,
  getSliceOrientation,
  getWorldBoundsForSlice
} from './volume/orthogonalSlices';

// Slice helpers and coordination
export {
  extractSliceForView,
  getSliceAxisIndex,
  getMaxSliceIndex,
  isValidSliceIndex,
  getSliceAxisName,
  getCenterSliceIndex,
  getSafeSliceIndicesForSpaces
} from './geometry/SliceHelpers';

// Slice access types and coordination
export {
  SliceAccessStrategy,
  SliceAccessConfig,
  SliceAccessResult,
  SliceAccessError,
  VolumeSliceDimensions,
  SliceExtractionParams,
  VolumeCompatibilityResult
} from './types/SliceAccess';

export { SliceCoordinator } from './core/SliceCoordinator';

// Note: TestVolumeFactory (src/testing/) is intentionally NOT exported — it is a
// test-only helper. Tests import it directly via relative path.

// Add other exports as needed
