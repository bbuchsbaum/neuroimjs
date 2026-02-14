import * as PIXI from 'pixi.js';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';

/**
 * Transforms a display object (e.g., sprite or graphics) from grid space to image space.
 * Applies scaling, y-axis flipping, and anchoring.
 *
 * @param object - The PIXI.DisplayObject to transform.
 * @param neuroSpace - The NeuroSpace of the image.
 * @param viewAxes - The current view axes.
 */
export function transformToImageSpace(
  object: PIXI.Container,
  neuroSpace: NeuroSpace,
  viewAxes: AxisSet3D
): void {
  // Get image dimensions
  const axes = viewAxes.axes();
  const imageWidth = neuroSpace.dimOf(axes[0]);
  const imageHeight = neuroSpace.dimOf(axes[1]);

  // (1) Remove any forced negative scale
- // object.scale.y *= -1;

  // If you want to preserve the user’s anchor, you can keep anchor or set:
  // if (object instanceof PIXI.Sprite) {
  //   object.anchor.set(0.5);
  // }

  // (2) Set object’s position to (0,0). We’ll rely on SliceView’s `fitContainerToScreen()`.
  object.position.set(0, 0);

  // (3) If you want to scale by voxel spacing, that’s still valid:
  const xIndex = neuroSpace.whichDim(axes[0]);
  const yIndex = neuroSpace.whichDim(axes[1]);
  const xSpacing = neuroSpace.spacing[xIndex];
  const ySpacing = neuroSpace.spacing[yIndex];

  object.scale.x *= xSpacing; 
  object.scale.y *= ySpacing;

  // (Optional) If you want the local `object.width/height` to match real mm:
  object.width = imageWidth * xSpacing;
  object.height = imageHeight * ySpacing;
}