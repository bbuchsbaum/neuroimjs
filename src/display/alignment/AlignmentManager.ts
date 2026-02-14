/**
 * Alignment manager that selects and applies the best alignment strategy
 */

import { IAlignmentStrategy, AlignmentOptions, AlignmentResult } from './IAlignmentStrategy';
import { CenterAlignmentStrategy } from './CenterAlignmentStrategy';
import { CornerAlignmentStrategy } from './CornerAlignmentStrategy';
import { OverlapAlignmentStrategy } from './OverlapAlignmentStrategy';
import { ImageSlice } from '../ImageSlice';
import * as PIXI from 'pixi.js';

export type AlignmentStrategyType = 'auto' | 'center' | 'corner' | 'overlap';

export interface AlignmentManagerOptions extends AlignmentOptions {
  /** Strategy to use for alignment */
  strategy?: AlignmentStrategyType;
  /** Whether to cache alignment results */
  enableCache?: boolean;
}

/**
 * Manages layer alignment with multiple strategies
 */
export class AlignmentManager {
  private strategies: Map<string, IAlignmentStrategy>;
  private alignmentCache: Map<string, AlignmentResult>;
  private defaultStrategy: IAlignmentStrategy;
  private cacheEnabled: boolean;

  constructor() {
    this.strategies = new Map();
    this.alignmentCache = new Map();
    
    // Register built-in strategies
    this.registerStrategy(new CenterAlignmentStrategy());
    this.registerStrategy(new CornerAlignmentStrategy());
    this.registerStrategy(new OverlapAlignmentStrategy());
    
    // Default to center alignment
    this.defaultStrategy = this.strategies.get('center')!;
    this.cacheEnabled = true;
  }

  /**
   * Register a new alignment strategy
   */
  registerStrategy(strategy: IAlignmentStrategy): void {
    this.strategies.set(strategy.getName(), strategy);
  }

  /**
   * Get a registered strategy by name
   */
  getStrategy(name: string): IAlignmentStrategy | undefined {
    return this.strategies.get(name);
  }

  /**
   * Automatically select the best strategy for the given slices
   */
  selectBestStrategy(targetSlice: ImageSlice, referenceSlice: ImageSlice): IAlignmentStrategy {
    // Check overlap strategy first - it's most specific
    const overlapStrategy = this.strategies.get('overlap')!;
    if (overlapStrategy.canHandle(targetSlice, referenceSlice)) {
      // Check if there's significant overlap
      const overlap = this.calculateOverlapRatio(targetSlice, referenceSlice);
      if (overlap > 0.2) { // More than 20% overlap
        return overlapStrategy;
      }
    }

    // Check if slices have very different resolutions
    const [refSx, refSy] = referenceSlice.getSpacing;
    const [tarSx, tarSy] = targetSlice.getSpacing;
    const resolutionRatioX = Math.max(refSx / tarSx, tarSx / refSx);
    const resolutionRatioY = Math.max(refSy / tarSy, tarSy / refSy);

    if (resolutionRatioX > 2 || resolutionRatioY > 2) {
      // Large resolution difference - use corner alignment for better edge matching
      return this.strategies.get('corner')!;
    }

    // Default to center alignment
    return this.strategies.get('center')!;
  }

  /**
   * Calculate the overlap ratio between two slices
   */
  private calculateOverlapRatio(targetSlice: ImageSlice, referenceSlice: ImageSlice): number {
    const refBounds = referenceSlice.bounds;
    const tarBounds = targetSlice.bounds;

    // Calculate bounding box areas and overlap
    // bounds = [[xMin,yMin], [xMax,yMin], [xMax,yMax], [xMin,yMax]]
    const refMinX = Math.min(refBounds[0][0], refBounds[1][0], refBounds[2][0], refBounds[3][0]);
    const refMaxX = Math.max(refBounds[0][0], refBounds[1][0], refBounds[2][0], refBounds[3][0]);
    const refMinY = Math.min(refBounds[0][1], refBounds[1][1], refBounds[2][1], refBounds[3][1]);
    const refMaxY = Math.max(refBounds[0][1], refBounds[1][1], refBounds[2][1], refBounds[3][1]);
    
    const tarMinX = Math.min(tarBounds[0][0], tarBounds[1][0], tarBounds[2][0], tarBounds[3][0]);
    const tarMaxX = Math.max(tarBounds[0][0], tarBounds[1][0], tarBounds[2][0], tarBounds[3][0]);
    const tarMinY = Math.min(tarBounds[0][1], tarBounds[1][1], tarBounds[2][1], tarBounds[3][1]);
    const tarMaxY = Math.max(tarBounds[0][1], tarBounds[1][1], tarBounds[2][1], tarBounds[3][1]);

    // Calculate areas
    const refArea = (refMaxX - refMinX) * (refMaxY - refMinY);
    const tarArea = (tarMaxX - tarMinX) * (tarMaxY - tarMinY);

    // Calculate overlap
    const overlapMinX = Math.max(refMinX, tarMinX);
    const overlapMaxX = Math.min(refMaxX, tarMaxX);
    const overlapMinY = Math.max(refMinY, tarMinY);
    const overlapMaxY = Math.min(refMaxY, tarMaxY);

    if (overlapMaxX <= overlapMinX || overlapMaxY <= overlapMinY) {
      return 0; // No overlap
    }

    const overlapArea = (overlapMaxX - overlapMinX) * (overlapMaxY - overlapMinY);
    
    // Return ratio of overlap to smaller area
    return overlapArea / Math.min(refArea, tarArea);
  }

  /**
   * Align a sprite to match a reference slice
   */
  alignSprite(
    sprite: PIXI.Sprite,
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options: AlignmentManagerOptions = {}
  ): AlignmentResult {
    const {
      strategy = 'auto',
      enableCache = this.cacheEnabled,
      ...alignmentOptions
    } = options;

    // Generate cache key
    const cacheKey = this.generateCacheKey(targetSlice, referenceSlice, options);
    
    // Check cache
    if (enableCache && this.alignmentCache.has(cacheKey)) {
      const cached = this.alignmentCache.get(cacheKey)!;
      this.applyAlignmentToSprite(sprite, cached);
      return cached;
    }

    // Select strategy
    let selectedStrategy: IAlignmentStrategy;
    if (strategy === 'auto') {
      selectedStrategy = this.selectBestStrategy(targetSlice, referenceSlice);
    } else {
      selectedStrategy = this.strategies.get(strategy) || this.defaultStrategy;
    }

    // Calculate alignment
    const alignment = selectedStrategy.align(targetSlice, referenceSlice, alignmentOptions);

    // Cache result
    if (enableCache) {
      this.alignmentCache.set(cacheKey, alignment);
    }

    // Apply to sprite
    selectedStrategy.applyAlignment(sprite, alignment);

    return alignment;
  }

  /**
   * Apply a cached alignment result to a sprite
   */
  private applyAlignmentToSprite(sprite: PIXI.Sprite, alignment: AlignmentResult): void {
    sprite.pivot.set(alignment.pivot.x, alignment.pivot.y);
    sprite.position.set(alignment.position.x, alignment.position.y);
    sprite.scale.set(alignment.scale.x, alignment.scale.y);
    
    if (alignment.rotation !== undefined) {
      sprite.rotation = alignment.rotation;
    }
  }

  /**
   * Generate a cache key for alignment results
   */
  private generateCacheKey(
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options: AlignmentManagerOptions
  ): string {
    // Include relevant properties in the cache key
    const targetBounds = targetSlice.bounds;
    const refBounds = referenceSlice.bounds;
    
    return [
      targetBounds[0][0], targetBounds[0][1],
      targetBounds[2][0], targetBounds[2][1],
      targetSlice.width, targetSlice.height,
      refBounds[0][0], refBounds[0][1],
      refBounds[2][0], refBounds[2][1],
      referenceSlice.width, referenceSlice.height,
      options.strategy || 'auto',
      options.maintainAspectRatio || false,
      options.allowRotation || false
    ].join('_');
  }

  /**
   * Clear the alignment cache
   */
  clearCache(): void {
    this.alignmentCache.clear();
  }

  /**
   * Set whether caching is enabled
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    if (!enabled) {
      this.clearCache();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; enabled: boolean } {
    return {
      size: this.alignmentCache.size,
      enabled: this.cacheEnabled
    };
  }
}