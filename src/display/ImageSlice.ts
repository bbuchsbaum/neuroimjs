/**
 * File: src/display/ImageSlice.ts
 *
 * The ImageSlice class represents a 2D slice of image data, including:
 *  - The underlying pixel data (as an ImageData object).
 *  - Real-world bounding box in the X-Y plane.
 *  - Pixel spacing and orientation axes.
 * 
 * Typically used for displaying a 2D slice from a 3D or 4D neuroimaging volume
 * once it’s been re-sliced or reoriented.
 */

import { AxisSet2D } from '../geometry/Axis';

/**
 * An interface describing the real-world bounding box of this 2D slice.
 */
interface BoundingBox {
  /** The minimum X coordinate (left) in real units (e.g., mm). */
  xMin: number;
  /** The maximum X coordinate (right) in real units. */
  xMax: number;
  /** The minimum Y coordinate (bottom) in real units. */
  yMin: number;
  /** The maximum Y coordinate (top) in real units. */
  yMax: number;
}

/**
 * Represents a single 2D slice of image data along with spatial metadata.
 */
export class ImageSlice {
  private imageData: ImageData;          // The raw pixel data (RGBA).
  private boundingBox: BoundingBox;      // The real-world bounding box for this slice.
  private spacing: number[];             // The pixel spacing (size) along the X and Y axes.
  private axes: AxisSet2D;               // A 2D axis set describing orientation (e.g. L-R, A-P).

  /**
   * Constructs an ImageSlice instance.
   * @param imageData - A browser ImageData object containing pixel data (RGBA).
   * @param boundingBox - The real-world bounding box (xMin, xMax, yMin, yMax).
   * @param spacing - The slice's pixel spacing along X and Y in real units (e.g., mm per pixel).
   * @param axes - A 2D axis set specifying how the slice is oriented (e.g., LEFT_RIGHT x POST_ANT).
   */
  constructor(
    imageData: ImageData,
    boundingBox: BoundingBox,
    spacing: number[],
    axes: AxisSet2D
  ) {
    this.imageData = imageData;
    this.boundingBox = boundingBox;
    this.spacing = spacing;
    this.axes = axes;
  }

  /**
   * Returns the pixel width of the slice.
   * @example
   *   const sliceWidth = mySlice.width;
   */
  get width(): number {
    return this.imageData.width;
  }

  /**
   * Returns the pixel height of the slice.
   * @example
   *   const sliceHeight = mySlice.height;
   */
  get height(): number {
    return this.imageData.height;
  }

  /**
   * The raw browser ImageData (width, height, RGBA pixel array).
   * This is typically fed directly into a texture for rendering.
   */
  get data(): ImageData {
    return this.imageData;
  }

  /**
   * Returns the pixel spacing for X and Y axes.
   * Usually measured in real units (e.g., mm/pixel).
   * @example
   *   const [sx, sy] = mySlice.getSpacing; // 2.0, 2.0
   */
  get getSpacing(): number[] {
    return this.spacing.slice(0, 2);
  }

  /**
   * Returns the real-world origin of the slice in the X-Y plane,
   * typically corresponding to the bounding box’s (xMin, yMin).
   * @example
   *   const [ox, oy] = mySlice.getOrigin; // e.g., [-90, -126]
   */
  get getOrigin(): [number, number] {
    return [this.boundingBox.xMin, this.boundingBox.yMin];
  }

  /**
   * The corner coordinates of this slice in real-world space (X-Y).
   * Points are returned in the order: bottom-left, bottom-right,
   * top-left, top-right.
   * @example
   *   const corners = mySlice.bounds; // [[xMin,yMin],[xMax,yMin],...]
   */
  get bounds(): [number, number][] {
    return [
      [this.boundingBox.xMin, this.boundingBox.yMin], // Bottom-left
      [this.boundingBox.xMax, this.boundingBox.yMin], // Bottom-right
      [this.boundingBox.xMin, this.boundingBox.yMax], // Top-left
      [this.boundingBox.xMax, this.boundingBox.yMax], // Top-right
    ];
  }

  /**
   * Returns a string representation of the slice for debugging purposes.
   * Includes dimensions, spacing, origin, and bounding box information.
   * @returns A formatted string with slice details.
   * @example
   *   console.log(mySlice.prettyPrint());
   *   // ImageSlice: 256×256 pixels
   *   // Spacing: [1.0, 1.0] mm/pixel
   *   // Origin: [-128.0, -128.0]
   *   // Bounds: [[-128,-128], [128,-128], [-128,128], [128,128]]
   */
  prettyPrint(): string {
    const [sx, sy] = this.getSpacing;
    const [ox, oy] = this.getOrigin;
    const boundsStr = this.bounds
      .map(([x, y]) => `[${x.toFixed(1)},${y.toFixed(1)}]`)
      .join(', ');
    
    return [
      `ImageSlice: ${this.width}×${this.height} pixels`,
      `Spacing: [${sx.toFixed(1)}, ${sy.toFixed(1)}] mm/pixel`,
      `Origin: [${ox.toFixed(1)}, ${oy.toFixed(1)}]`,
      `Bounds: [${boundsStr}]`
    ].join('\n');
  }
}