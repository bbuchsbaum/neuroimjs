import * as PIXI from 'pixi.js';

/**
 * A PIXI Container that automatically flips the Y-axis to match medical imaging coordinate systems.
 * 
 * In medical imaging (NIFTI, DICOM, etc.), the Y-axis positive direction goes upward:
 * - For axial views: Y goes from posterior to anterior (positive = anterior)
 * - For sagittal/coronal views: Y goes from inferior to superior (positive = superior)
 * 
 * In PIXI.js/Canvas, Y-axis positive direction goes downward (top=0, bottom=height).
 * 
 * This container applies a Y-axis scale of -1 and adjusts its position to maintain
 * the correct visual origin, allowing all child objects to use medical coordinates
 * directly without manual transformation.
 */
export class MedicalCoordinateContainer extends PIXI.Container {
  private viewportHeight: number;

  /**
   * Creates a new MedicalCoordinateContainer
   * @param viewportHeight - The height of the viewport in pixels
   */
  constructor(viewportHeight: number) {
    super();
    
    this.viewportHeight = viewportHeight;
    
    // Flip the Y-axis to match medical coordinate system
    // This makes positive Y go upward instead of downward
    this.scale.y = -1;
    
    // Move the container down by viewport height to maintain
    // the visual origin at the top-left corner
    this.position.y = viewportHeight;
  }

  /**
   * Updates the viewport height and adjusts the container position accordingly.
   * Call this when the viewport is resized.
   * @param height - The new viewport height in pixels
   */
  updateViewportHeight(height: number): void {
    this.viewportHeight = height;
    this.position.y = height;
  }

  /**
   * Converts screen coordinates to medical coordinates
   * @param screenPoint - Point in screen coordinates
   * @returns Point in medical coordinates
   */
  screenToMedical(screenPoint: PIXI.Point): PIXI.Point {
    return this.toLocal(screenPoint);
  }

  /**
   * Converts medical coordinates to screen coordinates
   * @param medicalPoint - Point in medical coordinates
   * @returns Point in screen coordinates
   */
  medicalToScreen(medicalPoint: PIXI.Point): PIXI.Point {
    return this.toGlobal(medicalPoint);
  }

  /**
   * Helper method to add debug axes showing the coordinate system
   * @param length - Length of the axis lines in pixels
   * @param showLabels - Whether to show axis labels
   */
  addDebugAxes(length: number = 100, showLabels: boolean = true): void {
    const graphics = new PIXI.Graphics();
    
    // X-axis (red)
    graphics.setStrokeStyle({ width: 2, color: 0xff0000, alpha: 1 });
    graphics.moveTo(0, 0);
    graphics.lineTo(length, 0);
    graphics.stroke();

    // Y-axis (green)
    graphics.setStrokeStyle({ width: 2, color: 0x00ff00, alpha: 1 });
    graphics.moveTo(0, 0);
    graphics.lineTo(0, length);
    graphics.stroke();

    // Arrows
    graphics.setStrokeStyle({ width: 2, color: 0xff0000, alpha: 1 });
    graphics.moveTo(length, 0);
    graphics.lineTo(length - 10, -5);
    graphics.moveTo(length, 0);
    graphics.lineTo(length - 10, 5);
    graphics.stroke();

    graphics.setStrokeStyle({ width: 2, color: 0x00ff00, alpha: 1 });
    graphics.moveTo(0, length);
    graphics.lineTo(-5, length - 10);
    graphics.moveTo(0, length);
    graphics.lineTo(5, length - 10);
    graphics.stroke();
    
    this.addChild(graphics);
    
    if (showLabels) {
      // X label
      const xLabel = new PIXI.Text('X', {
        fontSize: 14,
        fill: 0xff0000,
      });
      xLabel.position.set(length + 10, -5);
      this.addChild(xLabel);
      
      // Y label
      const yLabel = new PIXI.Text('Y', {
        fontSize: 14,
        fill: 0x00ff00,
      });
      yLabel.position.set(-20, length);
      this.addChild(yLabel);
      
      // Origin label
      const originLabel = new PIXI.Text('(0,0)', {
        fontSize: 12,
        fill: 0x666666,
      });
      originLabel.position.set(-30, -20);
      this.addChild(originLabel);
    }
  }
}

/**
 * Helper function to get orientation-specific transformations for medical images
 * @param orientation - The orientation string (e.g., 'AXIAL_LPI', 'SAGITTAL_AIL', 'CORONAL_LIP')
 * @returns Transformation parameters for rotation and scaling
 */
export function getMedicalOrientationTransform(orientation: string): {
  rotation: number;
  scaleX: number;
  scaleY: number;
  anchorX: number;
  anchorY: number;
} {
  // Default transformation (no additional changes)
  const defaultTransform = {
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    anchorX: 0.5,
    anchorY: 0.5
  };

  // Map common medical orientations to transformations
  const orientationMap: Record<string, typeof defaultTransform> = {
    'AXIAL_LPI': defaultTransform,
    'AXIAL_RPI': { ...defaultTransform, scaleX: -1 }, // Flip horizontally
    'SAGITTAL_AIL': { ...defaultTransform, rotation: Math.PI / 2 },
    'SAGITTAL_PIL': { ...defaultTransform, rotation: Math.PI / 2, scaleX: -1 },
    'CORONAL_LIP': defaultTransform,
    'CORONAL_RIP': { ...defaultTransform, scaleX: -1 }, // Flip horizontally
  };

  return orientationMap[orientation] || defaultTransform;
}

/**
 * Applies medical orientation transformation to a PIXI sprite
 * @param sprite - The sprite to transform
 * @param orientation - The medical orientation string
 */
export function applyMedicalOrientation(sprite: PIXI.Sprite, orientation: string): void {
  const transform = getMedicalOrientationTransform(orientation);
  
  sprite.anchor.set(transform.anchorX, transform.anchorY);
  sprite.rotation = transform.rotation;
  sprite.scale.x = transform.scaleX;
  sprite.scale.y = transform.scaleY;
}
