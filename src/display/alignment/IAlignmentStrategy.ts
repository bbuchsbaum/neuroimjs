/**
 * Interface for layer alignment strategies
 * Provides different methods for aligning layers with different resolutions/FOV
 * 
 * ALIGNMENT SCALING PHILOSOPHY:
 * All alignment strategies prioritize physical dimension matching over pixel matching.
 * This means that when aligning images with different pixel spacings (mm/pixel),
 * the scaling is calculated to preserve real-world measurements.
 * 
 * Example:
 * - Reference image: 100x100 pixels at 0.1mm/pixel = 10x10mm physical size
 * - Target image: 50x50 pixels at 0.2mm/pixel = 10x10mm physical size
 * - Scale factor: 0.1/0.2 = 0.5x (scales DOWN to match physical size)
 * 
 * This approach ensures anatomical structures maintain correct proportions
 * and measurements remain accurate across different image resolutions.
 */

import { ImageSlice } from '../ImageSlice';
import * as PIXI from 'pixi.js';

/**
 * Alignment result containing position and scale
 */
export interface AlignmentResult {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  pivot: { x: number; y: number };
  rotation?: number;
}

/**
 * Alignment options
 */
export interface AlignmentOptions {
  /** Whether to maintain aspect ratio */
  maintainAspectRatio?: boolean;
  /** Anchor point for alignment (0-1 for each axis) */
  anchor?: { x: number; y: number };
  /** Whether to allow rotation for better alignment */
  allowRotation?: boolean;
  /** Maximum scale factor to prevent excessive upscaling */
  maxScale?: number;
  /** Minimum scale factor to prevent excessive downscaling */
  minScale?: number;
}

/**
 * Interface for layer alignment strategies
 */
export interface IAlignmentStrategy {
  /**
   * Calculate alignment transformation for a target slice relative to a reference slice
   * @param targetSlice The slice to align
   * @param referenceSlice The reference slice to align to
   * @param options Alignment options
   * @returns Alignment transformation result
   */
  align(
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options?: AlignmentOptions
  ): AlignmentResult;

  /**
   * Apply alignment transformation to a sprite
   * @param sprite The sprite to transform
   * @param alignment The alignment result
   */
  applyAlignment(sprite: PIXI.Sprite, alignment: AlignmentResult): void;

  /**
   * Get the name of this alignment strategy
   */
  getName(): string;

  /**
   * Check if this strategy can handle the given slices
   * @param targetSlice The slice to align
   * @param referenceSlice The reference slice
   * @returns true if this strategy can handle the alignment
   */
  canHandle(targetSlice: ImageSlice, referenceSlice: ImageSlice): boolean;
}