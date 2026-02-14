/**
 * Corner-based alignment strategy
 * Aligns layers by matching their corner points for better edge alignment
 */

import { IAlignmentStrategy, AlignmentResult, AlignmentOptions } from './IAlignmentStrategy';
import { ImageSlice } from '../ImageSlice';
import * as PIXI from 'pixi.js';
import { nearlyEqual, COORDINATE_EPSILON } from '../NumericalUtils';

export class CornerAlignmentStrategy implements IAlignmentStrategy {
  
  getName(): string {
    return 'corner';
  }

  canHandle(targetSlice: ImageSlice, referenceSlice: ImageSlice): boolean {
    // This strategy works best when slices have similar orientations
    return true;
  }

  align(
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options: AlignmentOptions = {}
  ): AlignmentResult {
    const {
      maintainAspectRatio = false,
      allowRotation = false,
      maxScale = 10,
      minScale = 0.1
    } = options;

    // Get bounds (corners in world coordinates)
    const refBounds = referenceSlice.bounds;
    const tarBounds = targetSlice.bounds;

    // Extract spacing
    const [refSx, refSy] = referenceSlice.getSpacing;
    const [tarSx, tarSy] = targetSlice.getSpacing;

    // Compute robust min/max for dimensions and bottom-left
    const refXs = refBounds.map(p => p[0]);
    const refYs = refBounds.map(p => p[1]);
    const tarXs = tarBounds.map(p => p[0]);
    const tarYs = tarBounds.map(p => p[1]);

    const refXMin = Math.min(...refXs), refXMax = Math.max(...refXs);
    const refYMin = Math.min(...refYs), refYMax = Math.max(...refYs);
    const tarXMin = Math.min(...tarXs), tarXMax = Math.max(...tarXs);
    const tarYMin = Math.min(...tarYs), tarYMax = Math.max(...tarYs);

    const refBottomLeft: [number, number] = [refXMin, refYMin];
    const tarBottomLeft: [number, number] = [tarXMin, tarYMin];

    // World dimensions (always positive)
    const refWidthWorld = refXMax - refXMin;
    const refHeightWorld = refYMax - refYMin;
    const tarWidthWorld = tarXMax - tarXMin;
    const tarHeightWorld = tarYMax - tarYMin;

    // Calculate scale based on world dimensions
    let scaleX = refWidthWorld / tarWidthWorld;
    let scaleY = refHeightWorld / tarHeightWorld;

    // If we need to maintain aspect ratio, use average scale
    if (maintainAspectRatio) {
      const avgScale = Math.sqrt(scaleX * scaleY);
      scaleX = avgScale;
      scaleY = avgScale;
    }

    // Apply scale limits
    scaleX = Math.max(minScale, Math.min(maxScale, scaleX));
    scaleY = Math.max(minScale, Math.min(maxScale, scaleY));

    // Calculate rotation if allowed
    let rotation = 0;
    if (allowRotation) {
      // Calculate rotation that rotates target's primary edge to reference's primary edge
      const refEdgeX = refBounds[1][0] - refBounds[0][0];
      const refEdgeY = refBounds[1][1] - refBounds[0][1];
      const tarEdgeX = tarBounds[1][0] - tarBounds[0][0];
      const tarEdgeY = tarBounds[1][1] - tarBounds[0][1];

      const dot = tarEdgeX * refEdgeX + tarEdgeY * refEdgeY;
      const cross = tarEdgeX * refEdgeY - tarEdgeY * refEdgeX;
      rotation = Math.atan2(cross, dot); // signed angle from target edge to reference edge
    }

    // Calculate position to align bottom-left corners
    const offsetXworld = refBottomLeft[0] - tarBottomLeft[0];
    const offsetYworld = refBottomLeft[1] - tarBottomLeft[1];

    // Convert to pixel coordinates
    const offsetXpix = offsetXworld / refSx;
    const offsetYpix = offsetYworld / refSy;

    // Set pivot at bottom-left of target
    const pivotX = 0;
    const pivotY = targetSlice.height;

    // Position in reference pixel space
    const posX = offsetXpix;
    const posY = referenceSlice.height - offsetYpix; // Flip Y for PIXI

    return {
      position: { x: posX, y: posY },
      scale: { x: scaleX * tarSx / refSx, y: scaleY * tarSy / refSy },
      pivot: { x: pivotX, y: pivotY },
      rotation
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
