/**
 * Center-based alignment strategy
 * Aligns layers by their centers with spacing-based scaling
 */

import { IAlignmentStrategy, AlignmentResult, AlignmentOptions } from './IAlignmentStrategy';
import { ImageSlice } from '../ImageSlice';
import * as PIXI from 'pixi.js';

export class CenterAlignmentStrategy implements IAlignmentStrategy {
  
  getName(): string {
    return 'center';
  }

  canHandle(targetSlice: ImageSlice, referenceSlice: ImageSlice): boolean {
    // This strategy can handle any slices
    return true;
  }

  align(
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options: AlignmentOptions = {}
  ): AlignmentResult {
    const {
      maintainAspectRatio = false,
      anchor = { x: 0.5, y: 0.5 },
      maxScale = 10,
      minScale = 0.1
    } = options;

    // Extract bounding boxes
    const refBounds = referenceSlice.bounds;
    const tarBounds = targetSlice.bounds;

    // Extract spacing
    const [refSx, refSy] = referenceSlice.getSpacing;
    const [tarSx, tarSy] = targetSlice.getSpacing;

    // Compute bounding box centers in world coordinates
    const refCenterX = (refBounds[0][0] + refBounds[1][0]) * 0.5;
    const refCenterY = (refBounds[0][1] + refBounds[2][1]) * 0.5;

    const tarCenterX = (tarBounds[0][0] + tarBounds[1][0]) * 0.5;
    const tarCenterY = (tarBounds[0][1] + tarBounds[2][1]) * 0.5;

    // Compute offset in world coordinates (mm)
    const offsetXmm = tarCenterX - refCenterX;
    const offsetYmm = tarCenterY - refCenterY;

    // Convert offset to reference pixel space
    const offsetXpix = offsetXmm / refSx;
    const offsetYpix = offsetYmm / refSy;

    // Calculate scale factors for physical size matching
    // 
    // IMPORTANT: Alignment Philosophy
    // The goal is to preserve physical dimensions, not pixel dimensions.
    // If the target has spacing of 0.2mm/pixel and reference has 0.1mm/pixel,
    // then each target pixel represents 2x the physical area of a reference pixel.
    // To make the physical sizes match, we scale DOWN the target by 0.5x.
    // 
    // Formula: scale = referenceSpacing / targetSpacing
    // This ensures that 1mm in target space equals 1mm in reference space.
    let scaleX = refSx / tarSx;
    let scaleY = refSy / tarSy;

    // Apply aspect ratio constraint if requested
    if (maintainAspectRatio) {
      const avgScale = Math.sqrt(scaleX * scaleY);
      scaleX = avgScale;
      scaleY = avgScale;
    }

    // Apply scale limits
    scaleX = Math.max(minScale, Math.min(maxScale, scaleX));
    scaleY = Math.max(minScale, Math.min(maxScale, scaleY));

    // Calculate pivot based on anchor
    const pivotX = targetSlice.width * anchor.x;
    const pivotY = targetSlice.height * anchor.y;

    // Calculate position
    const posX = referenceSlice.width * anchor.x + offsetXpix;
    const posY = referenceSlice.height * anchor.y - offsetYpix; // Negative for PIXI's coordinate system

    return {
      position: { x: posX, y: posY },
      scale: { x: scaleX, y: scaleY },
      pivot: { x: pivotX, y: pivotY }
    };
  }

  applyAlignment(sprite: PIXI.Sprite, alignment: AlignmentResult): void {
    sprite.pivot.set(alignment.pivot.x, alignment.pivot.y);
    sprite.position.set(alignment.position.x, alignment.position.y);
    sprite.scale.set(alignment.scale.x, alignment.scale.y);
    
    if (alignment.rotation !== undefined) {
      sprite.rotation = alignment.rotation;
    }
  }
}