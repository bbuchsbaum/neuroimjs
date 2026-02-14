/**
 * Type definitions for display components
 * Replaces 'any' types with proper type definitions
 */

/**
 * Parameters for updating layer properties
 */
export interface LayerUpdateParams {
  /** Value range for display [min, max] */
  range?: [number, number];
  /** Threshold range [min, max] */
  threshold?: [number, number];
  /** Opacity/alpha value (0-1) */
  alpha?: number;
  /** Colormap name or ColorMap instance */
  colormap?: string | import('../ColorMap').ColorMap;
  /** Visibility flag */
  visible?: boolean;
  /** Interpolation method */
  interpolation?: 'nearest' | 'linear' | 'cubic';
}

/**
 * Data for slice extraction in workers
 */
export interface ExtractSliceData {
  volumeData: Float32Array;
  dimensions: number[];
  sliceIndex: number;
  axis: number;
  spacing: number[];
}

/**
 * Data for slice processing in workers
 */
export interface ProcessSliceData {
  imageData: ImageData;
  operation: SliceOperation;
  params: ProcessParams;
}

/**
 * Available slice processing operations
 */
export type SliceOperation = 'blur' | 'sharpen' | 'edge' | 'threshold';

/**
 * Parameters for slice processing operations
 */
export interface ProcessParams {
  /** Blur radius */
  radius?: number;
  /** Sharpen strength */
  strength?: number;
  /** Edge detection threshold */
  threshold?: number;
  /** Minimum threshold value */
  min?: number;
  /** Maximum threshold value */
  max?: number;
}

/**
 * Data for image resampling in workers
 */
export interface ResampleData {
  imageData: ImageData;
  targetWidth: number;
  targetHeight: number;
  method: ResampleMethod;
}

/**
 * Available resampling methods
 */
export type ResampleMethod = 'nearest' | 'bilinear' | 'bicubic';

/**
 * Union type for all worker request data
 */
export type WorkerRequestData = ExtractSliceData | ProcessSliceData | ResampleData;

/**
 * Worker response data for slice operations
 */
export interface SliceResultData {
  imageData: ImageData;
  width: number;
  height: number;
  spacing: [number, number];
}

/**
 * Worker response data for processing operations
 */
export interface ProcessResultData {
  imageData: ImageData;
}

/**
 * Union type for all worker response data
 */
export type WorkerResponseData = SliceResultData | ProcessResultData;

import * as PIXI from 'pixi.js';

/**
 * Minimal pointer event wrapper used throughout the viewer.
 * Provides access to PIXI's global coordinates regardless of the underlying event type.
 */
export interface SlicePointerEvent {
  global: PIXI.Point;
  data?: { global: PIXI.Point };
  [key: string]: any;
}

/**
 * Event handler type for pointer events
 */
export type PointerEventHandler = (event: SlicePointerEvent) => void;

/**
 * Event handler type for wheel events
 */
export type WheelEventHandler = (event: WheelEvent) => void;

/**
 * Generic event handler
 */
export type EventHandler<T = Event> = (event: T) => void;

/**
 * Viewer update parameters
 */
export interface ViewerUpdateParams {
  /** Camera position */
  position?: [number, number, number];
  /** Zoom level */
  zoom?: number;
  /** Rotation angle */
  rotation?: number;
  /** Center point */
  center?: [number, number];
}

/**
 * Cluster visualization parameters
 */
export interface ClusterParams {
  /** Cluster ID to highlight */
  highlightId?: number;
  /** Opacity for clusters */
  opacity?: number;
  /** Color map for clusters */
  colorMap?: Map<number, number>;
  /** Minimum cluster size to display */
  minSize?: number;
}

/**
 * Type guard for slice result data
 */
export function isSliceResultData(data: WorkerResponseData): data is SliceResultData {
  return 'width' in data && 'height' in data && 'spacing' in data;
}

/**
 * Type guard for process result data
 */
export function isProcessResultData(data: WorkerResponseData): data is ProcessResultData {
  return 'imageData' in data && !('width' in data);
}

/**
 * Type guard for extract slice data
 */
export function isExtractSliceData(data: WorkerRequestData): data is ExtractSliceData {
  return 'volumeData' in data && 'sliceIndex' in data;
}

/**
 * Type guard for process slice data
 */
export function isProcessSliceData(data: WorkerRequestData): data is ProcessSliceData {
  return 'operation' in data && 'params' in data;
}

/**
 * Type guard for resample data
 */
export function isResampleData(data: WorkerRequestData): data is ResampleData {
  return 'targetWidth' in data && 'targetHeight' in data && 'method' in data;
}
