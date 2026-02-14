import * as PIXI from 'pixi.js';

/**
 * Configuration options for rendering orthogonal slices
 */
export interface RenderOptions {
  /** Whether to display crosshairs at the slice intersection point */
  showCrosshairs: boolean;
  /** Color of the crosshairs (as hex number, e.g., 0xFF0000 for red) */
  crosshairColor: number;
  /** Thickness of crosshair lines in pixels */
  crosshairThickness: number;
  /** Whether to display anatomical orientation labels */
  showLabels: boolean;
  /** Text style for orientation labels */
  labelStyle?: Partial<PIXI.TextStyle>;
  /** Background color for the rendered image */
  backgroundColor: number;
  /** Canvas dimensions */
  canvasWidth: number;
  canvasHeight: number;
  /** Whether to show a debug overlay with mapping details */
  showDebug?: boolean;
}

/**
 * Configuration for overlay elements
 */
export interface OverlayOptions {
  /** Type of overlay to render */
  type: 'crosshair' | 'label' | 'scale' | 'grid';
  /** Type-specific configuration */
  config: CrosshairConfig | LabelConfig | ScaleConfig | GridConfig;
}

/**
 * Crosshair overlay configuration
 */
export interface CrosshairConfig {
  /** World coordinate position [x, y, z] */
  position: number[];
  /** Color as hex number */
  color: number;
  /** Line thickness in pixels */
  thickness: number;
  /** Length of crosshair lines (0-1 as fraction of image dimension) */
  length: number;
  /** Gap at center of crosshair in pixels */
  gap?: number;
}

/**
 * Label overlay configuration
 */
export interface LabelConfig {
  /** Text content */
  text: string;
  /** Position on canvas */
  position: { x: number; y: number };
  /** Text style */
  style?: Partial<PIXI.TextStyle>;
  /** Anchor point (0-1) */
  anchor?: { x: number; y: number };
}

/**
 * Scale bar overlay configuration
 */
export interface ScaleConfig {
  /** Length in real-world units (mm) */
  length: number;
  /** Position on canvas */
  position: { x: number; y: number };
  /** Color as hex number */
  color: number;
  /** Line thickness */
  thickness: number;
  /** Whether to show text label */
  showLabel: boolean;
  /** Text style for label */
  labelStyle?: Partial<PIXI.TextStyle>;
}

/**
 * Grid overlay configuration
 */
export interface GridConfig {
  /** Grid spacing in real-world units (mm) */
  spacing: number;
  /** Color as hex number */
  color: number;
  /** Line thickness */
  thickness: number;
  /** Opacity (0-1) */
  alpha: number;
}

/**
 * Anatomical orientation labels
 */
export interface OrientationLabels {
  left: string;
  right: string;
  top: string;
  bottom: string;
}

/**
 * Result of rendering a slice with overlays
 */
export interface SliceRenderResult {
  /** The PIXI container with the rendered slice */
  container: PIXI.Container;
  /** The canvas element */
  canvas: HTMLCanvasElement;
  /** Metadata about the rendered slice */
  metadata: {
    viewType: 'axial' | 'sagittal' | 'coronal';
    sliceIndex: number;
    worldCoordinate: number[];
    orientation: OrientationLabels;
    pixelSpacing: number[];
  };
}

/**
 * Options for exporting rendered slices
 */
export interface ExportOptions {
  /** Output directory path */
  outputDir: string;
  /** File name pattern (can include {view}, {index}, {x}, {y}, {z} placeholders) */
  filePattern: string;
  /** Image format */
  format: 'png' | 'jpg';
  /** JPEG quality (0-1) if format is 'jpg' */
  quality?: number;
}
