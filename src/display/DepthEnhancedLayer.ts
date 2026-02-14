// File: src/display/DepthEnhancedLayer.ts

import * as PIXI from 'pixi.js';
import { SliceLayer } from './SliceLayer';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { SlicePointerEvent } from './types/display';
import { ImageLayer } from './ImageLayer';
import { makeObservable, observable, action } from 'mobx';

/**
 * Configuration options for depth-enhanced viewing
 */
export interface DepthEnhancedOptions {
  /**
   * Number of adjacent slices to render on each side (fore and aft)
   * @default 2
   */
  depthLayers?: number;

  /**
   * Maximum blur radius for the furthest slices (in pixels)
   * @default 8
   */
  maxBlurRadius?: number;

  /**
   * Parallax shift amount as a fraction of the slice dimensions
   * When cursor moves, adjacent slices shift by this amount * distance from center
   * @default 0.03
   */
  parallaxAmount?: number;

  /**
   * Base opacity for adjacent slices (0-1)
   * Opacity decreases with distance from current slice
   * @default 0.4
   */
  baseOpacity?: number;

  /**
   * Whether depth enhancement is initially enabled
   * @default true
   */
  enabled?: boolean;
}

/**
 * DepthEnhancedLayer renders adjacent slices with blur and parallax effects
 * to provide depth cues in 2D slice viewing.
 *
 * Features:
 * - Renders slices before and after the current slice
 * - Applies Gaussian blur proportional to distance from current slice
 * - Parallax effect: adjacent slices shift based on cursor position
 * - Opacity falloff with distance
 * - Toggleable at runtime
 *
 * @example
 * ```typescript
 * const depthLayer = new DepthEnhancedLayer(imageLayer, {
 *   depthLayers: 2,
 *   maxBlurRadius: 8,
 *   parallaxAmount: 0.03
 * });
 * sliceView.addLayer('depth-enhanced', depthLayer);
 * ```
 */
export class DepthEnhancedLayer implements SliceLayer {
  public neuroSpace: NeuroSpace;

  private imageLayer: ImageLayer;
  private container: PIXI.Container | null = null;

  // Cached blur filters for each depth level
  // Using 'any' for BlurFilter due to PIXI v8/v7 type differences
  private blurFilters: Map<number, any> = new Map();

  // Current cursor position for parallax (normalized -1 to 1)
  private cursorX: number = 0;
  private cursorY: number = 0;

  // Track last render params to avoid redundant work
  private lastSliceIndex: number = -1;
  private lastViewAxes: AxisSet3D | null = null;

  // Observable settings
  @observable public enabled: boolean;
  @observable public depthLayers: number;
  @observable public maxBlurRadius: number;
  @observable public parallaxAmount: number;
  @observable public baseOpacity: number;

  constructor(imageLayer: ImageLayer, options?: DepthEnhancedOptions) {
    this.imageLayer = imageLayer;
    this.neuroSpace = imageLayer.neuroSpace;

    // Apply defaults
    this.enabled = options?.enabled ?? true;
    this.depthLayers = options?.depthLayers ?? 2;
    this.maxBlurRadius = options?.maxBlurRadius ?? 8;
    this.parallaxAmount = options?.parallaxAmount ?? 0.03;
    this.baseOpacity = options?.baseOpacity ?? 0.4;

    makeObservable(this);

    // Pre-create blur filters for each depth level
    this.initBlurFilters();
  }

  /**
   * Initialize blur filters for each depth level
   */
  private initBlurFilters(): void {
    this.blurFilters.clear();
    for (let depth = 1; depth <= this.depthLayers; depth++) {
      const blurAmount = (depth / this.depthLayers) * this.maxBlurRadius;
      // PIXI v8 style: options object
      const filter = new (PIXI as any).BlurFilter({
        strength: blurAmount,
        quality: 4
      });
      this.blurFilters.set(depth, filter);
    }
  }

  initialize(): void {
    // No async initialization needed
  }

  /**
   * Render adjacent slices with depth effects
   */
  renderSlice(
    sliceIndex: number,
    coord: number[],
    viewAxes: AxisSet3D,
    parentContainer: PIXI.Container
  ): PIXI.Container | null {
    if (!this.enabled) {
      return null;
    }

    // Create or reuse container
    if (!this.container) {
      this.container = new PIXI.Container();
    }
    this.container.removeChildren();

    const volStack = this.imageLayer.getVolStack();
    const referenceLayer = volStack.getLayer(0);

    // Get dimension info for bounds checking
    const space = referenceLayer.space;
    const pinnedAxis = viewAxes.k;
    const pinnedDim = space.whichDim(pinnedAxis);
    const maxSlice = space.dim[pinnedDim] - 1;

    // Render background slices (behind current) - added first so they're behind
    for (let offset = -this.depthLayers; offset < 0; offset++) {
      const adjIndex = sliceIndex + offset;
      if (adjIndex >= 0 && adjIndex <= maxSlice) {
        this.renderAdjacentSlice(adjIndex, viewAxes, offset, referenceLayer);
      }
    }

    // Render foreground slices (ahead of current) - added last so they're on top
    for (let offset = this.depthLayers; offset > 0; offset--) {
      const adjIndex = sliceIndex + offset;
      if (adjIndex >= 0 && adjIndex <= maxSlice) {
        this.renderAdjacentSlice(adjIndex, viewAxes, offset, referenceLayer);
      }
    }

    this.lastSliceIndex = sliceIndex;
    this.lastViewAxes = viewAxes;

    return this.container;
  }

  /**
   * Render a single adjacent slice with blur and parallax
   */
  private renderAdjacentSlice(
    sliceIndex: number,
    viewAxes: AxisSet3D,
    depthOffset: number,
    layer: any // VolLayer
  ): void {
    if (!this.container) return;

    try {
      // Get the slice data
      const imageSlice = layer.getSlice(sliceIndex, viewAxes);
      if (!imageSlice || !imageSlice.data) return;

      // Create texture from ImageData
      const canvas = document.createElement('canvas');
      canvas.width = imageSlice.data.width;
      canvas.height = imageSlice.data.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.putImageData(imageSlice.data, 0, 0);
      const texture = PIXI.Texture.from(canvas);

      // Create sprite
      const sprite = new PIXI.Sprite(texture);

      // Apply blur filter based on depth
      const absDepth = Math.abs(depthOffset);
      const blurFilter = this.blurFilters.get(absDepth);
      if (blurFilter) {
        sprite.filters = [blurFilter];
      }

      // Calculate opacity falloff
      const opacityFactor = 1 - (absDepth / (this.depthLayers + 1));
      sprite.alpha = this.baseOpacity * opacityFactor;

      // Apply parallax offset based on cursor position
      const parallaxX = this.cursorX * this.parallaxAmount * depthOffset * imageSlice.data.width;
      const parallaxY = this.cursorY * this.parallaxAmount * depthOffset * imageSlice.data.height;
      sprite.position.set(parallaxX, parallaxY);

      // Depth ordering: negative offsets (behind) have lower z, positive (ahead) have higher
      // Since we add in order, this is handled by insertion order

      this.container.addChild(sprite);
    } catch (err) {
      // Silently skip if slice extraction fails
      console.warn('DepthEnhancedLayer: Failed to render slice', sliceIndex, err);
    }
  }

  /**
   * Update position - triggers parallax recalculation
   */
  setPosition(coord: number[]): void {
    // Position changes handled in renderSlice
  }

  /**
   * Handle pointer move for parallax effect
   */
  onPointerMove(event: SlicePointerEvent): boolean {
    if (!this.enabled || !event.imageCoord) return false;

    // Get the parent dimensions from the event or estimate
    const parentWidth = event.parentWidth || 256;
    const parentHeight = event.parentHeight || 256;

    // Normalize cursor position to -1 to 1 range (center = 0)
    this.cursorX = ((event.imageCoord.x / parentWidth) - 0.5) * 2;
    this.cursorY = ((event.imageCoord.y / parentHeight) - 0.5) * 2;

    // Update parallax positions if we have a container
    this.updateParallax();

    return false; // Don't consume the event
  }

  /**
   * Update parallax positions for all sprites
   */
  private updateParallax(): void {
    if (!this.container || !this.lastViewAxes) return;

    const children = this.container.children as PIXI.Sprite[];
    let depthIndex = 0;

    // Update each sprite's position based on cursor
    for (const sprite of children) {
      if (sprite instanceof PIXI.Sprite && sprite.texture) {
        // Reconstruct depth offset from child order
        // Background slices come first (negative offsets), then foreground
        const totalSlices = this.depthLayers * 2;
        const isBackground = depthIndex < this.depthLayers;
        const depthOffset = isBackground
          ? -(this.depthLayers - depthIndex)
          : (depthIndex - this.depthLayers + 1);

        const parallaxX = this.cursorX * this.parallaxAmount * depthOffset * sprite.texture.width;
        const parallaxY = this.cursorY * this.parallaxAmount * depthOffset * sprite.texture.height;
        sprite.position.set(parallaxX, parallaxY);

        depthIndex++;
      }
    }
  }

  onPointerDown(event: SlicePointerEvent): boolean {
    return false; // Don't consume click events
  }

  /**
   * Toggle depth enhancement on/off
   */
  @action
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Update depth enhancement settings
   */
  @action
  setOptions(options: Partial<DepthEnhancedOptions>): void {
    if (options.depthLayers !== undefined) {
      this.depthLayers = options.depthLayers;
      this.initBlurFilters(); // Recreate filters for new depth
    }
    if (options.maxBlurRadius !== undefined) {
      this.maxBlurRadius = options.maxBlurRadius;
      this.initBlurFilters();
    }
    if (options.parallaxAmount !== undefined) {
      this.parallaxAmount = options.parallaxAmount;
    }
    if (options.baseOpacity !== undefined) {
      this.baseOpacity = options.baseOpacity;
    }
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
  }

  /**
   * Get current settings
   */
  getOptions(): Required<DepthEnhancedOptions> {
    return {
      enabled: this.enabled,
      depthLayers: this.depthLayers,
      maxBlurRadius: this.maxBlurRadius,
      parallaxAmount: this.parallaxAmount,
      baseOpacity: this.baseOpacity
    };
  }

  dispose(): void {
    // Destroy blur filters
    this.blurFilters.forEach(filter => filter.destroy());
    this.blurFilters.clear();

    // Destroy container and children
    if (this.container) {
      this.container.destroy({ children: true });
      this.container = null;
    }
  }
}
