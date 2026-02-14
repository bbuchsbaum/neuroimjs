import * as PIXI from 'pixi.js';
import { ImageLayer } from './ImageLayer';
import { ImageSlice } from './ImageSlice';
import { VolStack } from './VolStack';
import { VolLayer } from './VolLayer';
import { NeuroVol } from '../volume/NeuroVol';
import { DenseNeuroVol } from '../volume/DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../geometry/Axis';
import { ColorMapFactory } from './ColorMapFactory';
import {
  RenderOptions,
  SliceRenderResult,
  OrientationLabels,
  CrosshairConfig,
  LabelConfig,
  ExportOptions
} from './types/visualization';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, CanvasRenderingContext2D as NodeCanvasRenderingContext2D } from 'canvas';
import { SliceTransform } from './SliceTransform';

type NodeCanvas = ReturnType<typeof createCanvas>;

/**
 * Default render options
 */
const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  showCrosshairs: true,
  crosshairColor: 0xFF0000, // Red
  crosshairThickness: 2,
  showLabels: true,
  labelStyle: {
    fill: 0xFFFFFF,
    fontSize: 14,
    fontFamily: 'Arial',
    fontWeight: 'bold'
  },
  backgroundColor: 0x000000, // Black
  canvasWidth: 512,
  canvasHeight: 512,
  showDebug: false
};

/**
 * OrthogonalSliceRenderer provides high-level functionality for rendering
 * neuroimaging slices with crosshairs, labels, and other overlays.
 */
export class OrthogonalSliceRenderer {
  private readonly isNodeEnvironment: boolean;
  private app?: PIXI.Application;
  private appReady?: Promise<void>;
  private imageLayer?: ImageLayer;
  private volStack: VolStack;
  private options: RenderOptions;

  constructor(volume: NeuroVol, options: Partial<RenderOptions> = {}) {
    this.options = { ...DEFAULT_RENDER_OPTIONS, ...options };
    this.isNodeEnvironment =
      typeof window === 'undefined' || typeof document === 'undefined';
    
    const colorMap = ColorMapFactory.createGrayscale();
    const volLayer = new VolLayer(
      'primary',
      volume as DenseNeuroVol,
      colorMap,
      null, // Auto-detect range
      [0, 0], // No threshold
      1.0 // Full opacity
    );
    
    this.volStack = new VolStack(volLayer);

    if (!this.isNodeEnvironment) {
      this.app = new PIXI.Application();
      this.appReady = (this.app as any).init({
        width: this.options.canvasWidth,
        height: this.options.canvasHeight,
        backgroundColor: this.options.backgroundColor,
        preserveDrawingBuffer: true,
        antialias: true
      });

      this.imageLayer = new ImageLayer(this.volStack);
      this.imageLayer.initialize();
    }
  }

  /**
   * Render orthogonal slices at a given world coordinate
   */
  async renderOrthogonalSlices(
    worldCoord: number[]
  ): Promise<{
    axial: SliceRenderResult;
    sagittal: SliceRenderResult;
    coronal: SliceRenderResult;
  }> {
    const results = {
      axial: await this.renderSlice(worldCoord, 'axial'),
      sagittal: await this.renderSlice(worldCoord, 'sagittal'),
      coronal: await this.renderSlice(worldCoord, 'coronal')
    };
    
    return results;
  }

  /**
   * Render a single slice view
   */
  private async renderSlice(
    worldCoord: number[],
    viewType: 'axial' | 'sagittal' | 'coronal'
  ): Promise<SliceRenderResult> {
    if (this.isNodeEnvironment) {
      return this.renderSliceNode(worldCoord, viewType);
    }

    return this.renderSlicePixi(worldCoord, viewType);
  }

  /**
   * Render using the PIXI pipeline (browser environments)
   */
  private async renderSlicePixi(
    worldCoord: number[],
    viewType: 'axial' | 'sagittal' | 'coronal'
  ): Promise<SliceRenderResult> {
    if (!this.app || !this.imageLayer) {
      throw new Error('PIXI application is not initialized in this environment.');
    }

    await this.ensurePixiReady();

    // Clear the stage
    this.app.stage.removeChildren();
    
    // Get the appropriate axis set and slice index
    const { axes, sliceIndex, planeCoord, reorientedGrid } = this.getViewConfiguration(
      worldCoord,
      viewType
    );
    const referenceSlice = this.options.showCrosshairs
      ? this.volStack.getLayer(0).getSlice(sliceIndex, axes)
      : null;
    
    // Render the slice using ImageLayer
    const container = this.imageLayer.renderSlice(
      sliceIndex,
      worldCoord,
      axes,
      this.app.stage
    );
    
    if (!container) {
      throw new Error(`Failed to render ${viewType} slice at ${worldCoord}`);
    }
    
    // Scale and center the slice
    this.fitSliceToCanvas(container);
    
    // Get orientation labels for this view
    const orientationLabels = this.getOrientationLabels(viewType);
    
    // Add overlays if requested
    if (this.options.showCrosshairs && referenceSlice) {
      const xform = new SliceTransform(this.volStack.space, axes, sliceIndex);
      const p = xform.worldToImageCoord(worldCoord);
      this.addCrosshairs(container, referenceSlice, { x: p.x, y: p.y });
    }

    if (this.options.showDebug && referenceSlice) {
      const xform = new SliceTransform(this.volStack.space, axes, sliceIndex);
      const px = xform.worldToImageCoord(worldCoord);
      const debug = {
        axes: { i: axes.i.name, j: axes.j.name, k: axes.k.name },
        reorientedGrid,
        planeCoord,
        invertX: false,
        invertY: false,
        dim: [referenceSlice.width, referenceSlice.height] as [number, number],
        pixel: { x: px.x, y: px.y }
      };
      this.addDebugOverlayPIXI(this.app.stage, debug);
    }
    
    if (this.options.showLabels) {
      this.addOrientationLabels(this.app.stage, orientationLabels);
    }
    
    // Render the stage
    this.app.render();
    
    // Get pixel spacing for this view
    const space = this.volStack.space;
    const pixelSpacing = this.getPixelSpacing(space, viewType);
    
    return {
      container,
      canvas: (this.app as any).canvas as HTMLCanvasElement,
      metadata: {
        viewType,
        sliceIndex,
        worldCoordinate: worldCoord,
        orientation: orientationLabels,
        pixelSpacing
      }
    };
  }

  /**
   * Render using a headless canvas pipeline (Node environments)
   */
  private async renderSliceNode(
    worldCoord: number[],
    viewType: 'axial' | 'sagittal' | 'coronal'
  ): Promise<SliceRenderResult> {
    const { axes, sliceIndex, planeCoord, reorientedGrid } = this.getViewConfiguration(
      worldCoord,
      viewType
    );
    const volLayer = this.volStack.getLayer(0);
    const imageSlice = volLayer.getSlice(sliceIndex, axes);
    const orientationLabels = this.getOrientationLabels(viewType);

    // Prepare source canvas with raw slice data
    const sliceCanvas: NodeCanvas = createCanvas(imageSlice.width, imageSlice.height);
    const sliceCtx = sliceCanvas.getContext('2d');
    if (!sliceCtx) {
      throw new Error('Failed to acquire 2D context for slice canvas');
    }
    sliceCtx.putImageData(imageSlice.data, 0, 0);

    // Prepare target canvas
    const canvas: NodeCanvas = createCanvas(
      this.options.canvasWidth,
      this.options.canvasHeight
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D context for output canvas');
    }

    // Fill background
    ctx.fillStyle = this.colorToCss(this.options.backgroundColor);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Scale slice to fit canvas with margin
    const scaleX = canvas.width / imageSlice.width;
    const scaleY = canvas.height / imageSlice.height;
    const scale = Math.min(scaleX, scaleY) * 0.9;
    const drawWidth = imageSlice.width * scale;
    const drawHeight = imageSlice.height * scale;
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.save();
    ctx.translate(offsetX, offsetY + drawHeight);
    ctx.scale(1, -1);
    ctx.drawImage(
      sliceCanvas as any,
      0,
      0,
      imageSlice.width,
      imageSlice.height,
      0,
      0,
      drawWidth,
      drawHeight
    );
    // No-op; drawing happens post-restore in screen coords
    ctx.restore();

    if (this.options.showCrosshairs) {
      const xform = new SliceTransform(this.volStack.space, axes, sliceIndex);
      const p = xform.worldToImageCoord(worldCoord);
      this.drawCrosshairs2D(
        ctx,
        { x: offsetX, y: offsetY, width: drawWidth, height: drawHeight },
        imageSlice,
        { x: p.x, y: p.y }
      );
    }

    if (this.options.showLabels) {
      this.drawOrientationLabels2D(ctx, orientationLabels);
    }

    if (this.options.showDebug) {
      const xform = new SliceTransform(this.volStack.space, axes, sliceIndex);
      const px = xform.worldToImageCoord(worldCoord);
      const debug = {
        axes: { i: axes.i.name, j: axes.j.name, k: axes.k.name },
        reorientedGrid,
        planeCoord,
        invertX: false,
        invertY: true,
        dim: [imageSlice.width, imageSlice.height] as [number, number],
        pixel: { x: px.x, y: px.y }
      };
      this.drawDebugOverlay2D(ctx, debug);
    }

    const pixelSpacing = this.getPixelSpacing(this.volStack.space, viewType);

    return {
      container: new PIXI.Container(),
      canvas: canvas as unknown as HTMLCanvasElement,
      metadata: {
        viewType,
        sliceIndex,
        worldCoordinate: worldCoord,
        orientation: orientationLabels,
        pixelSpacing
      }
    };
  }

  /**
   * Get view configuration for a given view type
   */
  private getViewConfiguration(
    worldCoord: number[],
    viewType: 'axial' | 'sagittal' | 'coronal'
  ): { axes: AxisSet3D; sliceIndex: number; planeCoord: [number, number]; reorientedGrid: number[] } {
    const space = this.volStack.space;
    let axes: AxisSet3D;

    switch (viewType) {
      case 'axial':
        axes = new AxisSet3D(
          NamedAxis.LEFT_RIGHT,
          NamedAxis.POST_ANT,
          NamedAxis.INF_SUP
        );
        break;
      case 'sagittal':
        axes = new AxisSet3D(
          NamedAxis.POST_ANT,
          NamedAxis.INF_SUP,
          NamedAxis.LEFT_RIGHT
        );
        break;
      case 'coronal':
        axes = new AxisSet3D(
          NamedAxis.LEFT_RIGHT,
          NamedAxis.INF_SUP,
          NamedAxis.POST_ANT
        );
        break;
      default:
        throw new Error(`Unknown view type: ${viewType}`);
    }

    // Use SliceTransform for correct coordinate transformation
    // First, determine the slice index by computing grid coordinates in the view orientation
    const volumeGrid = space.coordToGrid(worldCoord);

    // Determine which dimension of the original volume corresponds to the pinned axis
    const pinnedAxis = axes.k; // The third axis is the one we're slicing through
    const pinnedDim = space.whichDim(pinnedAxis);
    const sliceIndex = Math.round(volumeGrid[pinnedDim]);

    // Now create SliceTransform to properly compute in-plane coordinates
    const xform = new SliceTransform(space, axes, sliceIndex);
    const imageCoord = xform.worldToImageCoord(worldCoord);

    // planeCoord should be in image pixel coordinates, not grid coordinates
    const planeCoord: [number, number] = [imageCoord.x, imageCoord.y];

    // For debugging, also compute reorientedGrid (though it shouldn't be used for pixel positioning)
    const reorientedGrid = [imageCoord.x, imageCoord.y, sliceIndex];

    return { axes, sliceIndex, planeCoord, reorientedGrid };
  }

  private computeCrosshairPosition(
    axes: AxisSet3D,
    planeCoord: [number, number],
    referenceSlice: ImageSlice,
    reorientedGrid?: number[]
  ): { x: number; y: number; debug?: any } {
    // planeCoord now contains pixel coordinates directly from SliceTransform.worldToImageCoord()
    // No additional transformation needed - just return the coordinates
    const x = planeCoord[0];
    const y = planeCoord[1];

    // For debugging
    const debug = {
      axes: {
        i: axes.i.name,
        j: axes.j.name,
        k: axes.k.name
      },
      reorientedGrid: reorientedGrid ?? [Number.NaN, Number.NaN, Number.NaN],
      planeCoord: [planeCoord[0], planeCoord[1]] as [number, number],
      invertX: false,
      invertY: false,
      dim: [referenceSlice.width, referenceSlice.height] as [number, number],
      pixel: { x, y }
    };

    return { x, y, debug };
  }

  /**
   * Fit slice to canvas with proper aspect ratio
   */
  private fitSliceToCanvas(container: PIXI.Container): void {
    const bounds = container.getLocalBounds();
    const containerWidth = bounds.width;
    const containerHeight = bounds.height;
    
    const canvasWidth = this.options.canvasWidth;
    const canvasHeight = this.options.canvasHeight;
    
    // Calculate scale to fit with small margin
    const scaleX = canvasWidth / containerWidth;
    const scaleY = canvasHeight / containerHeight;
    const scale = Math.min(scaleX, scaleY) * 0.9;

    // Pivot to visual center and position at canvas center
    container.pivot.set(bounds.x + containerWidth / 2, bounds.y + containerHeight / 2);
    container.position.set(canvasWidth / 2, canvasHeight / 2);

    // Medical Y-up: flip Y by using negative scale
    container.scale.set(scale, -scale);
  }

  /**
   * Add crosshairs to mark the world coordinate
   */
  private addCrosshairs(
    container: PIXI.Container,
    slice: ImageSlice,
    position?: { x: number; y: number }
  ): void {
    const graphics = new PIXI.Graphics();
    const width = slice.width;
    const height = slice.height;
    const crosshairX = position ? position.x : width / 2;
    const crosshairY = position ? position.y : height / 2;

    graphics.setStrokeStyle({
      width: this.options.crosshairThickness,
      color: this.options.crosshairColor,
      alpha: 1
    });

    graphics.moveTo(0, crosshairY);
    graphics.lineTo(width, crosshairY);
    graphics.stroke();

    graphics.moveTo(crosshairX, 0);
    graphics.lineTo(crosshairX, height);
    graphics.stroke();

    container.addChild(graphics);
  }

  /**
   * Get orientation labels for a view
   */
  private getOrientationLabels(viewType: string): OrientationLabels {
    switch (viewType) {
      case 'axial':
        return {
          left: 'R',
          right: 'L',
          top: 'A',
          bottom: 'P'
        };
      
      case 'sagittal':
        return {
          left: 'P',
          right: 'A',
          top: 'S',
          bottom: 'I'
        };
      
      case 'coronal':
        return {
          left: 'R',
          right: 'L',
          top: 'S',
          bottom: 'I'
        };
      
      default:
        return { left: '', right: '', top: '', bottom: '' };
    }
  }

  /**
   * Add orientation labels to the canvas
   */
  private addOrientationLabels(
    stage: PIXI.Container,
    labels: OrientationLabels
  ): void {
    const style = new PIXI.TextStyle(this.options.labelStyle || {});
    const margin = 20;
    
    const createLabel = (text: string) =>
      new (PIXI.Text as any)(text, style);
    
    // Left label
    const leftText = createLabel(labels.left);
    leftText.anchor.set(0.5, 0.5);
    leftText.position.set(margin, this.options.canvasHeight / 2);
    stage.addChild(leftText);
    
    // Right label
    const rightText = createLabel(labels.right);
    rightText.anchor.set(0.5, 0.5);
    rightText.position.set(this.options.canvasWidth - margin, this.options.canvasHeight / 2);
    stage.addChild(rightText);
    
    // Top label
    const topText = createLabel(labels.top);
    topText.anchor.set(0.5, 0.5);
    topText.position.set(this.options.canvasWidth / 2, margin);
    stage.addChild(topText);
    
    // Bottom label
    const bottomText = createLabel(labels.bottom);
    bottomText.anchor.set(0.5, 0.5);
    bottomText.position.set(this.options.canvasWidth / 2, this.options.canvasHeight - margin);
    stage.addChild(bottomText);
  }

  /**
   * Add debug overlay (PIXI path)
   */
  private addDebugOverlayPIXI(stage: PIXI.Container, debug: any): void {
    const text = [
      `axes: i=${debug.axes.i}, j=${debug.axes.j}, k=${debug.axes.k}`,
      `grid: [${debug.reorientedGrid.map((v: number) => v.toFixed(2)).join(', ')}]`,
      `plane: [${debug.planeCoord.map((v: number) => v.toFixed(2)).join(', ')}]`,
      `invert: x=${debug.invertX}, y=${debug.invertY}`,
      `pixel: (${debug.pixel.x.toFixed(1)}, ${debug.pixel.y.toFixed(1)})`
    ].join('\n');

    const style = new PIXI.TextStyle({
      fontSize: 12,
      fill: '#00FF66',
      fontFamily: 'monospace'
    });
    const overlay = new (PIXI.Text as any)(text, style);
    overlay.anchor.set(0, 0);
    overlay.position.set(8, 8);
    overlay.zIndex = 9999;
    stage.addChild(overlay);
  }

  /**
   * Draw debug overlay (canvas path)
   */
  private drawDebugOverlay2D(
    ctx: CanvasRenderingContext2D | NodeCanvasRenderingContext2D,
    debug: any
  ): void {
    const lines = [
      `axes: i=${debug.axes.i}, j=${debug.axes.j}, k=${debug.axes.k}`,
      `grid: [${debug.reorientedGrid.map((v: number) => v.toFixed(2)).join(', ')}]`,
      `plane: [${debug.planeCoord.map((v: number) => v.toFixed(2)).join(', ')}]`,
      `invert: x=${debug.invertX}, y=${debug.invertY}`,
      `pixel: (${debug.pixel.x.toFixed(1)}, ${debug.pixel.y.toFixed(1)})`
    ];

    ctx.save();
    ctx.font = '12px monospace';
    ctx.fillStyle = '#00FF66';
    ctx.textBaseline = 'top';
    let y = 8;
    for (const line of lines) {
      ctx.fillText(line, 8, y);
      y += 14;
    }
    ctx.restore();
  }

  /**
   * Draw crosshairs on a 2D canvas
   */
  private drawCrosshairs2D(
    ctx: CanvasRenderingContext2D | NodeCanvasRenderingContext2D,
    region: { x: number; y: number; width: number; height: number },
    slice: ImageSlice,
    position?: { x: number; y: number }
  ): void {
    const width = slice.width;
    const height = slice.height;
    const crosshairX = position ? position.x : width / 2;
    const crosshairY = position ? position.y : height / 2;
    const scaleX = region.width / width;
    const scaleY = region.height / height;

    ctx.save();
    ctx.strokeStyle = this.colorToCss(this.options.crosshairColor);
    ctx.lineWidth = this.options.crosshairThickness;

    // Flip Y-coordinate to match the image rendering (which uses ctx.scale(1, -1))
    const yPos = region.y + region.height - crosshairY * scaleY;
    const xPos = region.x + crosshairX * scaleX;

    ctx.beginPath();
    ctx.moveTo(region.x, yPos);
    ctx.lineTo(region.x + region.width, yPos);
    ctx.moveTo(xPos, region.y);
    ctx.lineTo(xPos, region.y + region.height);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw orientation labels on a 2D canvas
   */
  private drawOrientationLabels2D(
    ctx: CanvasRenderingContext2D | NodeCanvasRenderingContext2D,
    labels: OrientationLabels
  ): void {
    const { fontSize, fontFamily, fontWeight, fill } = this.getEffectiveLabelStyle();
    const margin = 20;

    ctx.save();
    ctx.font = `${fontWeight || 'bold'} ${fontSize}px ${fontFamily || 'Arial'}`;
    ctx.fillStyle = fill;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    if (labels.left) {
      ctx.fillText(labels.left, margin, this.options.canvasHeight / 2);
    }
    if (labels.right) {
      ctx.fillText(labels.right, this.options.canvasWidth - margin, this.options.canvasHeight / 2);
    }
    if (labels.top) {
      ctx.fillText(labels.top, this.options.canvasWidth / 2, margin);
    }
    if (labels.bottom) {
      ctx.fillText(labels.bottom, this.options.canvasWidth / 2, this.options.canvasHeight - margin);
    }

    ctx.restore();
  }

  /**
   * Resolve the effective text style for labels
   */
  private getEffectiveLabelStyle(): {
    fontSize: number;
    fontFamily: string;
    fontWeight: string | number;
    fill: string;
  } {
    const defaultStyle = DEFAULT_RENDER_OPTIONS.labelStyle ?? {};
    const currentStyle = this.options.labelStyle ?? {};
    const style = { ...defaultStyle, ...currentStyle };

    const resolveFontSize = (value: any): number => {
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 14;
      }
      return 14;
    };

    const resolveFontFamily = (value: any): string => {
      if (Array.isArray(value)) {
        return value[0] ?? 'Arial';
      }
      return value ?? 'Arial';
    };

    const resolveFontWeight = (value: any): string | number => {
      if (Array.isArray(value)) {
        return value[0] ?? 'bold';
      }
      return value ?? 'bold';
    };

    const resolveFill = (value: any): string => {
      if (typeof value === 'number') {
        return this.colorToCss(value);
      }
      if (Array.isArray(value)) {
        const first = value[0];
        if (typeof first === 'number') {
          return this.colorToCss(first);
        }
        return first ?? '#FFFFFF';
      }
      if (typeof value === 'string') {
        return value;
      }
      return '#FFFFFF';
    };

    return {
      fontSize: resolveFontSize(style.fontSize),
      fontFamily: resolveFontFamily(style.fontFamily),
      fontWeight: resolveFontWeight(style.fontWeight),
      fill: resolveFill(style.fill)
    };
  }

  /**
   * Get pixel spacing for a view
   */
  private getPixelSpacing(space: NeuroSpace, viewType: string): number[] {
    const spacing = space.spacing;
    
    switch (viewType) {
      case 'axial':
        return [spacing[0], spacing[1]];
      case 'sagittal':
        return [spacing[1], spacing[2]];
      case 'coronal':
        return [spacing[0], spacing[2]];
      default:
        return [1, 1];
    }
  }

  /**
   * Export a rendered slice to PNG
   */
  async exportToPNG(
    renderResult: SliceRenderResult,
    filePath: string
  ): Promise<void> {
    const canvas = renderResult.canvas;
    
    // Handle both browser HTMLCanvasElement and node-canvas
    let buffer: Buffer;
    if ('toBuffer' in canvas && typeof canvas.toBuffer === 'function') {
      // Node canvas
      buffer = (canvas as any).toBuffer('image/png');
    } else {
      // Browser canvas - convert to blob then to buffer
      const blob = await new Promise<Blob>((resolve) => {
        (canvas as HTMLCanvasElement).toBlob((blob) => resolve(blob!), 'image/png');
      });
      const arrayBuffer = await blob.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }
    
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write file
    fs.writeFileSync(filePath, buffer);
  }

  /**
   * Export all orthogonal slices for a coordinate
   */
  async exportOrthogonalSlices(
    worldCoord: number[],
    exportOptions: ExportOptions
  ): Promise<void> {
    const slices = await this.renderOrthogonalSlices(worldCoord);
    
    // Ensure output directory exists
    if (!fs.existsSync(exportOptions.outputDir)) {
      fs.mkdirSync(exportOptions.outputDir, { recursive: true });
    }
    
    // Export each view
    for (const [viewType, result] of Object.entries(slices)) {
      const filename = exportOptions.filePattern
        .replace('{view}', viewType)
        .replace('{x}', worldCoord[0].toFixed(1))
        .replace('{y}', worldCoord[1].toFixed(1))
        .replace('{z}', worldCoord[2].toFixed(1));
      
      const filePath = path.join(exportOptions.outputDir, filename);
      await this.exportToPNG(result, filePath);
    }
  }

  /**
   * Get the PIXI application
   */
  getApp(): PIXI.Application {
    if (!this.app) {
      throw new Error('PIXI Application is not available in this environment.');
    }
    return this.app;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.imageLayer?.dispose();

    if (this.app) {
      if (this.app.renderer) {
        this.app.destroy(true);
      } else if (this.appReady) {
        this.appReady
          .then(() => this.app?.destroy(true))
          .catch(() => {
            // If initialization failed (e.g., unsupported environment), ignore destroy errors
          });
      }
    }
  }

  /**
   * Convert a numeric Pixi color to CSS string
   */
  private colorToCss(color: number | string): string {
    if (typeof color === 'string') {
      return color;
    }
    const hex = color.toString(16).padStart(6, '0');
    return `#${hex}`;
  }

  /**
   * Ensure the PIXI application has completed initialization
   */
  private async ensurePixiReady(): Promise<void> {
    if (this.appReady) {
      await this.appReady;
    }
  }
}
