// File: src/display/ImageLayer.ts

import * as PIXI from 'pixi.js';
import { SliceLayer } from './SliceLayer';
import { VolStack } from './VolStack';
import { AxisSet3D, AxisSet2D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { VolLayer } from './VolLayer';
import { ImageSlice } from './ImageSlice';
import { Matrix } from 'ml-matrix';
import { SpritePool } from '../utils/SpritePool';
import { ContainerPool } from '../utils/ContainerPool';
import { AlignmentManager, AlignmentManagerOptions, AlignmentStrategyType } from './alignment/AlignmentManager';
import { TextureMemoryConsumer } from './memory/TextureMemoryConsumer';
import { MemoryManager } from './memory/MemoryManager';
import { LayerUpdateParams, ViewerUpdateParams, SlicePointerEvent } from './types/display';
import { getCategoryLogger, LogCategories, PerformanceLogger, MemoryLogger } from './logging/LoggerConfig';
import { ColorMapFactory } from './ColorMapFactory';
import { ColorMap } from './ColorMap';
import { resolveColorMap } from './ColorMapResolver';
import { SliceCoordinator } from '../core/SliceCoordinator';
import { SliceAccessStrategy, SliceAccessConfig, SliceAccessResult } from '../types/SliceAccess';

/**
 * ImageLayer handles retrieving 2D slices from a VolStack and drawing them in a single container,
 * each with a GPU transform so they align visually to the reference slice.
 */
export class ImageLayer implements SliceLayer {
  public neuroSpace: NeuroSpace;
  private volumeStack: VolStack;
  private needsRefresh: boolean = true;
  private textureMemory: TextureMemoryConsumer;
  private readonly layerId: string;
  private readonly logger = getCategoryLogger(LogCategories.IMAGE_LAYER);
  
  // Object pools for performance
  private spritePool: SpritePool;
  private containerPool: ContainerPool;
  private activeContainers: Set<PIXI.Container> = new Set();
  
  // Alignment manager for sophisticated layer alignment
  private alignmentManager: AlignmentManager;
  private alignmentOptions: AlignmentManagerOptions;
  
  // Slice coordinator for multi-volume slice validation
  private sliceCoordinator: SliceCoordinator;

  public opacity: number = 1;

  constructor(volStack: VolStack, alignmentOptions?: AlignmentManagerOptions) {
    this.volumeStack = volStack;
    this.neuroSpace = volStack.space;
    this.layerId = `image-layer-${Date.now()}`;
    
    this.logger.info('Creating ImageLayer', {
      layerId: this.layerId,
      volumeCount: volStack.length,
      space: volStack.space.dim
    });
    
    // Initialize pools with reasonable sizes
    this.spritePool = new SpritePool(50);
    this.containerPool = new ContainerPool(20);
    
    // Initialize texture memory consumer
    this.textureMemory = new TextureMemoryConsumer(
      `ImageLayer-${this.layerId}`,
      256 * 1024 * 1024 // 256MB default
    );
    
    // Register with global memory manager
    this.textureMemory.registerWithMemoryManager(this.layerId);
    
    // Initialize alignment manager
    this.alignmentManager = new AlignmentManager();
    this.alignmentOptions = alignmentOptions || {
      strategy: 'auto',
      enableCache: true,
      maintainAspectRatio: false,
      maxScale: 10,
      minScale: 0.1
    };
    
    // Initialize slice coordinator with default configuration
    this.sliceCoordinator = new SliceCoordinator({
      strategy: SliceAccessStrategy.CLAMP,
      logWarnings: true,
      onError: (error) => {
        this.logger.warn('Slice access error', {
          message: error.message,
          volumeIndex: error.volumeIndex,
          requestedIndex: error.requestedIndex,
          validRange: error.validRange
        });
      }
    });
    
    this.logger.debug('ImageLayer initialized', {
      alignmentOptions: this.alignmentOptions,
      sliceAccessStrategy: this.sliceCoordinator.getConfig().strategy
    });
  }

  initialize(): void {
    // no-op
  }

  public addVolLayer(volLayer: VolLayer): void {
    this.logger.info('Adding volume layer', { layerId: volLayer.id });
    this.volumeStack.addLayer(volLayer);
    this.needsRefresh = true;
  }

  public removeVolLayer(volLayer: VolLayer): void {
    this.logger.info('Removing volume layer', { layerId: volLayer.id });
    this.volumeStack.removeLayer(volLayer);
    this.needsRefresh = true;
  }

  /**
   * Creates a PIXI.Sprite from ImageData by drawing onto a Canvas, then returning a Sprite.
   * Uses TextureMemoryConsumer for intelligent caching and memory management.
   * Uses sprite pool to reduce garbage collection pressure.
   */
  createSprite(imageData: ImageData, cacheKey: string): PIXI.Sprite {
    // Check if we already have a texture for this key
    let texture = this.textureMemory.getTexture(cacheKey);
    
    if (!texture) {
      this.logger.debug('Creating new texture', { cacheKey });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = imageData.width;
      canvas.height = imageData.height;

      if (ctx) {
        ctx.putImageData(imageData, 0, 0);
        // Debug: sample center pixel to confirm non-black buffer
        try {
          const cx = Math.floor(imageData.width / 2);
          const cy = Math.floor(imageData.height / 2);
          const sample = ctx.getImageData(cx, cy, 1, 1).data;
          this.logger.debug('Center pixel RGBA', { x: cx, y: cy, r: sample[0], g: sample[1], b: sample[2], a: sample[3] });
        } catch {}
      } else {
        throw new Error('Failed to create 2D context');
      }

      // CRITICAL FIX for PIXI v8: Use Texture.from() but ensure proper GPU upload
      // The texture will be uploaded to GPU after being added to scene graph
      texture = PIXI.Texture.from(canvas);

      // CRITICAL: In PIXI v8, textures must be explicitly uploaded to GPU
      // This ensures the texture data is available for rendering
      // Note: We access texture.source via 'any' cast to avoid TypeScript errors with old @types/pixi.js
      const textureSource = (texture as any).source;
      if (textureSource && typeof textureSource.update === 'function') {
        textureSource.update();
      }

      // Add to texture memory (handles eviction automatically)
      this.textureMemory.addTexture(cacheKey, texture, canvas as HTMLCanvasElement);
    }
    
    // Get sprite from pool
    const sprite = this.spritePool.acquire(texture);
    this.logger.info('Sprite created', {
      layerId: cacheKey.split('_')[0],
      layerIndex: 0,
      spriteAlpha: sprite.alpha,
      spriteWidth: sprite.width,
      spriteHeight: sprite.height,
      spriteX: sprite.x,
      spriteY: sprite.y,
      spriteVisible: sprite.visible,
      textureWidth: texture.width,
      textureHeight: texture.height,
      textureValid: (texture as any)?.valid
    });
    return sprite;
  }

  /**
   * The crucial method: for each VolLayer, we get the slice, create a sprite, 
   * then call `alignSpriteToReference(...)` to position/scale it.
   */
  renderSlice(
    sliceIndex: number,
    coord: number[],
    viewAxes: AxisSet3D,
    parentContainer: PIXI.Container
  ): PIXI.Container | null {
    const renderTimer = `renderSlice_${sliceIndex}_${viewAxes.id}`;
    PerformanceLogger.start(renderTimer);
    
    // Validate slice access across all volumes
    const sliceValidation = this.sliceCoordinator.validateSliceAccess(
      sliceIndex,
      viewAxes,
      this.volumeStack
    );
    
    if (sliceValidation.warnings.length > 0) {
      this.logger.debug('Slice access validation warnings', {
        sliceIndex,
        warnings: sliceValidation.warnings,
        adjustedVolumes: sliceValidation.adjustedVolumes
      });
    }
    
    // Release any previously active containers and their sprites
    this.releaseActiveContainers();
    
    // Get container from pool
    const mainContainer = this.containerPool.acquire();
    this.activeContainers.add(mainContainer);

    // The "reference slice" is from layer 0 (the reference layer)
    const referenceLayer = this.volumeStack.getLayer(0);
    const referenceSliceIndex = sliceValidation.sliceIndices[0];
    const referenceSlice = referenceLayer.getSlice(referenceSliceIndex, viewAxes);

    // We'll store reference bounding box & spacing for alignment
    const refBounds = referenceSlice.bounds;       // e.g. [ [xMin,yMin],[xMax,yMin], ...]
    const refSpacing = referenceSlice.getSpacing;  // e.g. [sx, sy]
    const refWidth = referenceSlice.width;
    const refHeight = referenceSlice.height;

    // For each layer, get the slice, build a sprite, align, add
    for (let i = 0; i < this.volumeStack.length; i++) {
      const layer = this.volumeStack.getLayer(i);
      const validatedSliceIndex = sliceValidation.sliceIndices[i];
      
      // Skip if slice index is -1 (empty slice indicator)
      if (validatedSliceIndex === -1) {
        this.logger.debug('Skipping empty slice for volume', { volumeIndex: i });
        continue;
      }
      
      const imageSlice: ImageSlice = (i === 0)
        ? referenceSlice
        : layer.getSlice(validatedSliceIndex, viewAxes);

      // Create cache key based on layer ID, slice index, axes, and version
      // Version changes when opacity/threshold/range/colormap are modified
      const cacheKey = `${layer.id}_${validatedSliceIndex}_${viewAxes.id}_v${layer.version}`;
      const sprite = this.createSprite(imageSlice.data, cacheKey);
      sprite.alpha = layer.opacity;
      sprite.visible = layer.visible;

      // Debug logging
      this.logger.info('Sprite created', {
        layerIndex: i,
        layerId: layer.id,
        spriteWidth: sprite.width,
        spriteHeight: sprite.height,
        spriteAlpha: sprite.alpha,
        spriteVisible: sprite.visible,
        textureHasSource: sprite.texture ? !!(sprite.texture as any).source : false,
        textureWidth: sprite.texture?.width,
        textureHeight: sprite.texture?.height,
        spriteX: sprite.position.x,
        spriteY: sprite.position.y,
        spriteScaleX: sprite.scale.x,
        spriteScaleY: sprite.scale.y
      });

      // Use AlignmentManager for sophisticated alignment
      if (i !== 0) { // Don't align reference to itself
        this.alignmentManager.alignSprite(sprite, imageSlice, referenceSlice, this.alignmentOptions);
      }

      // Add sprite to container FIRST
      mainContainer.addChild(sprite);

      // CRITICAL FIX: Update texture source AFTER sprite is in scene graph
      // This ensures PIXI v8 properly uploads the texture to GPU
      // The texture must be part of the render tree before GPU upload
      const textureSource = (sprite.texture as any).source;
      if (textureSource && typeof textureSource.update === 'function') {
        textureSource.update();
      }
    }

    PerformanceLogger.end(renderTimer, {
      sliceIndex,
      layerCount: this.volumeStack.length,
      axis: viewAxes.id
    });

    return mainContainer;
  }
  
  /**
   * Releases all active containers and returns their sprites to the pool
   */
  private releaseActiveContainers(): void {
    this.activeContainers.forEach(container => {
      // Release all child sprites back to pool.
      // Copy the children array first: SpritePool.release() calls
      // sprite.parent.removeChild(sprite), which mutates container.children
      // in place. Iterating the live array would skip every other sprite and
      // leak roughly half of them back-pressure into the pool.
      const childrenToRelease = [...container.children];
      childrenToRelease.forEach(child => {
        if (child instanceof PIXI.Sprite) {
          this.spritePool.release(child);
        }
      });

      // Release container back to pool
      this.containerPool.release(container);
    });
    
    this.activeContainers.clear();
  }

  /**
   * Releases a container and its sprites back to the pool
   * @param container - The container to release
   */
  releaseContainer(container: PIXI.Container): void {
    // Release all child sprites back to pool
    const childrenToRelease = [...container.children]; // Copy array to avoid modification during iteration
    childrenToRelease.forEach(child => {
      if (child instanceof PIXI.Sprite) {
        this.spritePool.release(child);
      }
    });
    
    // Clear children from container
    container.removeChildren();
    
    // Release container back to pool
    this.containerPool.release(container);
    
    // Remove from active containers if present
    this.activeContainers.delete(container);
  }

  private invalidateLayerTextures(layerId: string): void {
    const prefix = `${layerId}_`;
    this.textureMemory.keys().forEach(key => {
      if (key.startsWith(prefix)) {
        this.textureMemory.removeTexture(key);
      }
    });
  }

  setPosition(coord: number[]): void {
    // no-op for intensity images
  }

  onPointerMove(e: SlicePointerEvent): boolean {
    return false;
  }
  onPointerDown(e: SlicePointerEvent): boolean {
    return false;
  }
  dispose(): void {
    this.logger.info('Disposing ImageLayer', { layerId: this.layerId });
    
    // Release all active containers
    this.releaseActiveContainers();
    
    // Clear pools
    this.spritePool.clear();
    this.containerPool.clear();
    
    // Clear texture memory
    const textureStats = this.textureMemory.getStats();
    this.textureMemory.clear();
    
    // Unregister from memory manager
    this.textureMemory.unregisterFromMemoryManager(this.layerId);
    
    // Clear alignment cache
    this.alignmentManager.clearCache();
    
    this.logger.debug('ImageLayer disposed', {
      texturesCleared: textureStats.count,
      memoryFreed: textureStats.size
    });
  }

  public getVolStack(): VolStack {
    return this.volumeStack;
  }
  public getLayer(index: number): VolLayer {
    return this.volumeStack.getLayer(index);
  }
  public getLayerIds(): string[] {
    return this.volumeStack.getLayerIds();
  }

  public updateLayer(layerId: string, params: LayerUpdateParams): void {
    // e.g. set colormap, range, threshold, alpha
    const volLayer = this.volumeStack.getLayerById(layerId);
    if (!volLayer) return;
    if (params.range) volLayer.setRange(params.range);
    if (params.threshold) volLayer.setThreshold(params.threshold);
    if (params.alpha !== undefined) volLayer.setOpacity(params.alpha);
    // Add other supported parameters
    if (params.visible !== undefined) volLayer.visible = params.visible;
    if (params.colormap) {
      const colorMap = resolveColorMap(params.colormap as any, volLayer.colorMap);
      volLayer.setColormap(colorMap);
    }
    this.invalidateLayerTextures(volLayer.id);
    this.needsRefresh = true;
    // Note: interpolation is handled at the slice extraction level, not at the VolLayer level
    // if (params.interpolation) volLayer.setInterpolation(params.interpolation);
  }

  /**
   * Replace the underlying volume data for a specific layer without changing its id.
   * Useful for fast overlay updates (e.g., sigma changes) without add/remove churn.
   */
  public replaceVolume(
    layerId: string,
    newVolume: import('../volume/NeuroVol').NeuroVol,
    opts?: { range?: [number, number] | null; threshold?: [number, number]; alpha?: number; colormap?: ColorMap }
  ): void {
    const volLayer = this.volumeStack.getLayerById(layerId);
    if (!volLayer) return;

    volLayer.replaceVolume(newVolume, {
      range: opts?.range,
      threshold: opts?.threshold,
      opacity: opts?.alpha,
      colormap: opts?.colormap,
    });

    this.invalidateLayerTextures(volLayer.id);
    this.needsRefresh = true;
  }

  public update(params: ViewerUpdateParams): void {
    // Handle viewer-level updates if needed
    if (params.position || params.zoom || params.rotation || params.center) {
      this.needsRefresh = true;
    }
  }
  
  /**
   * Public methods to expose SliceCoordinator functionality
   */
  
  /**
   * Get valid slice range for a given axis
   */
  public getValidSliceRange(axis: AxisSet3D): [number, number] {
    return this.sliceCoordinator.getValidSliceRange(axis, this.volumeStack);
  }
  
  /**
   * Validate slice access and get adjusted indices
   */
  public validateSliceAccess(sliceIndex: number, axis: AxisSet3D): SliceAccessResult {
    return this.sliceCoordinator.validateSliceAccess(sliceIndex, axis, this.volumeStack);
  }
  
  /**
   * Get safe slice indices for testing
   */
  public getSafeSliceIndices(axis: AxisSet3D, count: number = 3): number[] {
    return this.sliceCoordinator.getSafeSliceIndices(this.volumeStack, axis, count);
  }
  
  /**
   * Set slice access configuration
   */
  public setSliceAccessConfig(config: Partial<SliceAccessConfig>): void {
    this.sliceCoordinator.setConfig(config);
    this.needsRefresh = true;
  }
  
  /**
   * Get current slice access configuration
   */
  public getSliceAccessConfig(): SliceAccessConfig {
    return this.sliceCoordinator.getConfig();
  }

  /**
   * We no longer need a big “computeCorrespondingSliceIndex”, 
   * because pinned dimension logic is handled by Façade. 
   * So we skip that or keep it minimal if needed.
   */
  
  /**
   * Gets pool statistics for monitoring performance
   */
  public getPoolStats(): {
    spritePool: ReturnType<SpritePool['getStats']>;
    containerPool: ReturnType<ContainerPool['getStats']>;
  } {
    return {
      spritePool: this.spritePool.getStats(),
      containerPool: this.containerPool.getStats()
    };
  }
  
  /**
   * Set alignment options
   */
  public setAlignmentOptions(options: Partial<AlignmentManagerOptions>): void {
    this.alignmentOptions = { ...this.alignmentOptions, ...options };
    this.needsRefresh = true;
  }
  
  /**
   * Get current alignment options
   */
  public getAlignmentOptions(): AlignmentManagerOptions {
    return { ...this.alignmentOptions };
  }
  
  /**
   * Set alignment strategy
   */
  public setAlignmentStrategy(strategy: AlignmentStrategyType): void {
    this.alignmentOptions.strategy = strategy;
    this.needsRefresh = true;
  }
  
  /**
   * Get alignment cache statistics
   */
  public getAlignmentCacheStats(): { size: number; enabled: boolean } {
    return this.alignmentManager.getCacheStats();
  }
  
  /**
   * Clear alignment cache
   */
  public clearAlignmentCache(): void {
    this.alignmentManager.clearCache();
  }
  
  /**
   * Get texture memory statistics
   */
  public getTextureMemoryStats(): {
    count: number;
    size: number;
    maxSize: number;
    usage: number;
  } {
    return this.textureMemory.getStats();
  }
  
  /**
   * Set maximum texture cache size
   */
  public setTextureCacheSize(bytes: number): void {
    this.textureMemory.setMaxSize(bytes);
  }
  
  /**
   * Get combined memory statistics
   */
  public getMemoryStats(): {
    textureMemory: ReturnType<TextureMemoryConsumer['getStats']>;
    pools: ReturnType<ImageLayer['getPoolStats']>;
    alignment: ReturnType<AlignmentManager['getCacheStats']>;
  } {
    return {
      textureMemory: this.textureMemory.getStats(),
      pools: this.getPoolStats(),
      alignment: this.alignmentManager.getCacheStats()
    };
  }
}
