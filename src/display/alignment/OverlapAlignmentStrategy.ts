/**
 * Overlap-based alignment strategy
 * Optimizes alignment for maximum overlap between layers
 */

import { IAlignmentStrategy, AlignmentResult, AlignmentOptions } from './IAlignmentStrategy';
import { ImageSlice } from '../ImageSlice';
import * as PIXI from 'pixi.js';

export class OverlapAlignmentStrategy implements IAlignmentStrategy {
  
  getName(): string {
    return 'overlap';
  }

  canHandle(targetSlice: ImageSlice, referenceSlice: ImageSlice): boolean {
    // Check if there's potential overlap
    const refBounds = referenceSlice.bounds;
    const tarBounds = targetSlice.bounds;
    
    // Check if bounding boxes could overlap
    // bounds = [[xMin,yMin], [xMax,yMin], [xMax,yMax], [xMin,yMax]]
    const refMinX = Math.min(refBounds[0][0], refBounds[1][0], refBounds[2][0], refBounds[3][0]);
    const refMaxX = Math.max(refBounds[0][0], refBounds[1][0], refBounds[2][0], refBounds[3][0]);
    const refMinY = Math.min(refBounds[0][1], refBounds[1][1], refBounds[2][1], refBounds[3][1]);
    const refMaxY = Math.max(refBounds[0][1], refBounds[1][1], refBounds[2][1], refBounds[3][1]);
    
    const tarMinX = Math.min(tarBounds[0][0], tarBounds[1][0], tarBounds[2][0], tarBounds[3][0]);
    const tarMaxX = Math.max(tarBounds[0][0], tarBounds[1][0], tarBounds[2][0], tarBounds[3][0]);
    const tarMinY = Math.min(tarBounds[0][1], tarBounds[1][1], tarBounds[2][1], tarBounds[3][1]);
    const tarMaxY = Math.max(tarBounds[0][1], tarBounds[1][1], tarBounds[2][1], tarBounds[3][1]);
    
    // Check for no overlap
    if (refMaxX < tarMinX || tarMaxX < refMinX || 
        refMaxY < tarMinY || tarMaxY < refMinY) {
      return false;
    }
    
    return true;
  }

  align(
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options: AlignmentOptions = {}
  ): AlignmentResult {
    const {
      maintainAspectRatio = true,
      maxScale = 10,
      minScale = 0.1
    } = options;

    // Get bounds
    const refBounds = referenceSlice.bounds;
    const tarBounds = targetSlice.bounds;

    // Extract spacing
    const [refSx, refSy] = referenceSlice.getSpacing;
    const [tarSx, tarSy] = targetSlice.getSpacing;

    // Calculate overlap region in world coordinates
    const refMinX = Math.min(refBounds[0][0], refBounds[1][0], refBounds[2][0], refBounds[3][0]);
    const refMaxX = Math.max(refBounds[0][0], refBounds[1][0], refBounds[2][0], refBounds[3][0]);
    const refMinY = Math.min(refBounds[0][1], refBounds[1][1], refBounds[2][1], refBounds[3][1]);
    const refMaxY = Math.max(refBounds[0][1], refBounds[1][1], refBounds[2][1], refBounds[3][1]);
    
    const tarMinX = Math.min(tarBounds[0][0], tarBounds[1][0], tarBounds[2][0], tarBounds[3][0]);
    const tarMaxX = Math.max(tarBounds[0][0], tarBounds[1][0], tarBounds[2][0], tarBounds[3][0]);
    const tarMinY = Math.min(tarBounds[0][1], tarBounds[1][1], tarBounds[2][1], tarBounds[3][1]);
    const tarMaxY = Math.max(tarBounds[0][1], tarBounds[1][1], tarBounds[2][1], tarBounds[3][1]);

    // Find overlap region
    const overlapMinX = Math.max(refMinX, tarMinX);
    const overlapMaxX = Math.min(refMaxX, tarMaxX);
    const overlapMinY = Math.max(refMinY, tarMinY);
    const overlapMaxY = Math.min(refMaxY, tarMaxY);

    // Calculate overlap center
    const overlapCenterX = (overlapMinX + overlapMaxX) * 0.5;
    const overlapCenterY = (overlapMinY + overlapMaxY) * 0.5;

    // Calculate where this center falls in each image
    const refRelX = (overlapCenterX - refMinX) / (refMaxX - refMinX);
    const refRelY = (overlapCenterY - refMinY) / (refMaxY - refMinY);
    
    const tarRelX = (overlapCenterX - tarMinX) / (tarMaxX - tarMinX);
    const tarRelY = (overlapCenterY - tarMinY) / (tarMaxY - tarMinY);

    // Calculate scale to match physical dimensions
    // Scale target to match reference spacing
    let scaleX = refSx / tarSx;
    let scaleY = refSy / tarSy;

    // Optionally adjust scale to maximize overlap visibility
    const overlapWidthRef = (overlapMaxX - overlapMinX) / refSx;
    const overlapHeightRef = (overlapMaxY - overlapMinY) / refSy;
    const overlapWidthTar = (overlapMaxX - overlapMinX) / tarSx;
    const overlapHeightTar = (overlapMaxY - overlapMinY) / tarSy;

    if (overlapWidthRef > 0 && overlapHeightRef > 0) {
      // Adjust scale to fit overlap region
      const overlapScaleX = overlapWidthRef / overlapWidthTar;
      const overlapScaleY = overlapHeightRef / overlapHeightTar;
      
      // Blend with spacing-based scale
      scaleX = (scaleX + overlapScaleX) * 0.5;
      scaleY = (scaleY + overlapScaleY) * 0.5;
    }

    if (maintainAspectRatio) {
      const avgScale = Math.sqrt(scaleX * scaleY);
      scaleX = avgScale;
      scaleY = avgScale;
    }

    // Apply scale limits
    scaleX = Math.max(minScale, Math.min(maxScale, scaleX));
    scaleY = Math.max(minScale, Math.min(maxScale, scaleY));

    // Set pivot at the overlap center in target image
    const pivotX = targetSlice.width * tarRelX;
    const pivotY = targetSlice.height * tarRelY;

    // Position at the overlap center in reference image
    const posX = referenceSlice.width * refRelX;
    const posY = referenceSlice.height * (1 - refRelY); // Flip Y for PIXI

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