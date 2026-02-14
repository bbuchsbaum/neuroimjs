/**
 * Event type definitions for display components
 * Provides type-safe event handling throughout the display system
 */

import { NeuroVol } from '../../volume/NeuroVol';
import { AxisSet3D } from '../../geometry/Axis';

/**
 * Common viewer events
 */
export interface ViewerEvents {
  /** Emitted when position changes */
  'positionChanged': [position: [number, number, number]];
  /** Emitted when zoom level changes */
  'zoomChanged': [zoom: number];
  /** Emitted when slice index changes */
  'sliceChanged': [sliceIndex: number, axis: AxisSet3D];
  /** Emitted when viewer is resized */
  'resize': [width: number, height: number];
  /** Emitted when layer is added */
  'layerAdded': [layerId: string];
  /** Emitted when layer is removed */
  'layerRemoved': [layerId: string];
  /** Emitted when layer properties change */
  'layerUpdated': [layerId: string, property: string, value: unknown];
}

/**
 * Model events
 */
export interface ModelEvents {
  /** Emitted when coordinate changes */
  'coordinateChanged': [coord: number[]];
  /** Emitted when value at cursor changes */
  'valueChanged': [value: number | undefined];
  /** Emitted when model slice index changes */
  'modelSliceChanged': [slice: number];
  /** Emitted when volume is loaded */
  'volumeLoaded': [volume: NeuroVol];
  /** Emitted when axis changes */
  'axisChanged': [axis: AxisSet3D];
}

/**
 * Interaction events
 */
export interface InteractionEvents {
  /** Mouse/touch moved */
  'pointerMove': [x: number, y: number, event: PointerEvent];
  /** Mouse/touch down */
  'pointerDown': [x: number, y: number, event: PointerEvent];
  /** Mouse/touch up */
  'pointerUp': [x: number, y: number, event: PointerEvent];
  /** Mouse wheel */
  'wheel': [delta: number, event: WheelEvent];
  /** Keyboard key down */
  'keyDown': [key: string, event: KeyboardEvent];
  /** Keyboard key up */
  'keyUp': [key: string, event: KeyboardEvent];
}

/**
 * Worker events
 */
export interface WorkerEvents {
  /** Worker task started */
  'taskStarted': [taskId: string, type: string];
  /** Worker task completed */
  'taskCompleted': [taskId: string, result: unknown];
  /** Worker task failed */
  'taskFailed': [taskId: string, error: Error];
  /** Worker task progress */
  'taskProgress': [taskId: string, progress: number];
}

/**
 * Memory events
 */
export interface MemoryEvents {
  /** Memory warning threshold reached */
  'memoryWarning': [usage: number, limit: number];
  /** Memory critical threshold reached */
  'memoryCritical': [usage: number, limit: number];
  /** Memory cleanup performed */
  'memoryCleanup': [freed: number, total: number];
}

/**
 * Alignment events
 */
export interface AlignmentEvents {
  /** Alignment strategy changed */
  'strategyChanged': [strategy: string];
  /** Alignment completed */
  'alignmentCompleted': [layerId: string, strategy: string];
  /** Alignment cache cleared */
  'cacheCleared': [];
}

/**
 * Combined events for comprehensive viewer
 */
export interface DisplayEvents extends 
  ViewerEvents, 
  ModelEvents, 
  InteractionEvents, 
  WorkerEvents, 
  MemoryEvents, 
  AlignmentEvents {}

/**
 * Event handler factories
 */
export type EventHandlerMap<T extends Record<string, unknown[]>> = {
  [K in keyof T]: (...args: T[K]) => void;
};

/**
 * Typed event listener interface
 */
export interface TypedEventListener<T extends Record<string, unknown[]>> {
  on<K extends keyof T>(event: K, handler: (...args: T[K]) => void): void;
  off<K extends keyof T>(event: K, handler: (...args: T[K]) => void): void;
  emit<K extends keyof T>(event: K, ...args: T[K]): void;
  once<K extends keyof T>(event: K, handler: (...args: T[K]) => void): void;
}

/**
 * Create a typed event handler
 */
export function createEventHandler<T extends Record<string, unknown[]>, K extends keyof T>(
  handler: (...args: T[K]) => void
): (...args: T[K]) => void {
  return handler;
}

/**
 * Type guard for event data
 */
export function isEventData<T extends Record<string, unknown[]>, K extends keyof T>(
  event: string,
  data: unknown[],
  expectedEvent: K
): data is T[K] {
  return event === expectedEvent;
}
