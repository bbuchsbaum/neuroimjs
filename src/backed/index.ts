export type { Axis, Backing, Column, Extract, Provenance, Row, Value } from './types';
export { type Probe, voxel, sphere, mask, region, probeIndices, probeLabel } from './probe';
export { MemoryBacking, inferColumns, type MemoryBackingOptions } from './MemoryBacking';
export { long, cellMeans, summarise, variesWithin, type Cell, type Summary, type SummaryOptions, type ErrorKind } from './frame';
export { type PlotSpec, type Scene, type Series, type Panel, inferSpec, buildScene, factors, covariates } from './spec';
export { renderScene, niceTicks, type RenderOptions } from './render';
export { PlotPanel, type PlotPanelOptions } from './PlotPanel';
export { mean, sd, tQuantile, tPValue, fitLine } from './stats';
