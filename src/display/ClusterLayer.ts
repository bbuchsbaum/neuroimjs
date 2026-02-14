import * as PIXI from 'pixi.js';
import { SliceLayer } from './SliceLayer';
import { ClusteredNeuroVol } from '../volume/ClusteredNeuroVol';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import cv, { Mat, Point } from 'opencv-ts';

/**
 * ClusterLayer
 *
 * Implements the SliceLayer interface to render cluster boundaries
 * overlaid on a slice image.
 */
export class ClusterLayer implements SliceLayer {
  public neuroSpace: NeuroSpace;
  private clusteredVol: ClusteredNeuroVol;
  private graphicsCache: Map<string, PIXI.Container>;
  private readonly MAX_CACHE_SIZE = 50;
  private currentSliceIndex: number;
  private currentViewAxes: AxisSet3D;
  private isInitialized: boolean;

  constructor(clusteredVol: ClusteredNeuroVol) {
    this.clusteredVol = clusteredVol;
    this.neuroSpace = clusteredVol.space;
    this.graphicsCache = new Map();
    this.currentSliceIndex = 0;
    this.currentViewAxes = AxisSet3D.AXIAL_LPI;
    this.isInitialized = false;
  }

  /**
   * Initializes the layer.
   * Ensures that OpenCV.js is ready before proceeding.
   */
  public async initialize(): Promise<void> {
    if ((cv as any)['onRuntimeInitialized']) {
      await new Promise<void>((resolve) => {
        (cv as any)['onRuntimeInitialized'] = () => {
          resolve();
        };
      });
    }
    this.isInitialized = true;
  }

  /**
   * Renders the slice for the current slice index and view axes.
   * @param sliceIndex - The index of the slice to render.
   * @param coord - The volume coordinates [x, y, z].
   * @param viewAxes - The AxisSet3D defining the view orientation.
   * @param parentContainer - The parent PIXI.Container to add graphics to.
   * @returns A PIXI.Container containing the rendered cluster boundaries.
   */
  public renderSlice(
    sliceIndex: number,
    coord: number[],
    viewAxes: AxisSet3D,
    parentContainer: PIXI.Container
  ): PIXI.Container | null {
    if (!this.isInitialized) {
      console.warn('ClusterLayer is not initialized.');
      return null;
    }

    this.currentSliceIndex = sliceIndex;
    this.currentViewAxes = viewAxes;

    const cacheKey = this.getCacheKey(sliceIndex, viewAxes);

    // Check if the graphics for this slice are already cached
    if (this.graphicsCache.has(cacheKey)) {
      return this.graphicsCache.get(cacheKey)!;
    }

    // Extract the slice data
    const neuroSlice = this.clusteredVol.getSlice(sliceIndex, viewAxes);

    // Extract contours
    const contoursPerCluster = this.extractContours(neuroSlice);

    // Create PIXI Graphics
    const graphicsContainer = this.contoursToPixiGraphics(contoursPerCluster);

    // Cache the graphics for future use with size limit
    if (this.graphicsCache.size >= this.MAX_CACHE_SIZE) {
      // Evict the oldest entry
      const firstKey = this.graphicsCache.keys().next().value;
      if (firstKey !== undefined) {
        const oldContainer = this.graphicsCache.get(firstKey);
        if (oldContainer) {
          oldContainer.destroy({ children: true });
        }
        this.graphicsCache.delete(firstKey);
      }
    }
    this.graphicsCache.set(cacheKey, graphicsContainer);

    // Add graphics to the parent container
    parentContainer.addChild(graphicsContainer);

    return graphicsContainer;
  }

  /**
   * Updates the layer's position.
   */
  public setPosition(coord: number[]): void {
    // Update position if necessary (not used in this implementation)
  }

  /**
   * Handles pointer move events.
   */
  public onPointerMove(event: any): boolean {
    // Implement interaction if needed
    return false;
  }

  /**
   * Handles pointer down events.
   */
  public onPointerDown(event: any): boolean {
    // Implement interaction if needed
    return false;
  }

  /**
   * Disposes of the layer.
   */
  public dispose(): void {
    // Clean up resources
    this.graphicsCache.forEach((container) => {
      container.destroy({ children: true });
    });
    this.graphicsCache.clear();
  }

  /**
   * Generates a unique cache key for a given slice index and view axes.
   */
  private getCacheKey(sliceIndex: number, viewAxes: AxisSet3D): string {
    return `${sliceIndex}_${viewAxes.i.name}_${viewAxes.j.name}_${viewAxes.k.name}`;
  }

  /**
   * Extracts contours for each unique cluster index in the NeuroSlice.
   */
  private extractContours(
    neuroSlice: any
  ): { [clusterIndex: number]: Point[][] } {
    const mat = this.neuroSliceToMat(neuroSlice);
    const dataArray = Array.from(neuroSlice.getData());

    // Get unique cluster indices
    const uniqueIndices = Array.from(new Set(dataArray)) as number[];

    const contoursPerCluster: { [clusterIndex: number]: Point[][] } = {};

    uniqueIndices.forEach((clusterIndex) => {
      if (clusterIndex === 0) return; // Skip background if 0 represents background

      // Create a binary mask for the current cluster
      const clusterMask = new cv.Mat();
      const cind = new cv.Scalar(clusterIndex);
      cv.inRange(
        mat,
        new cv.Mat(mat.rows, mat.cols, mat.type(), cind),
        new cv.Mat(mat.rows, mat.cols, mat.type(), cind),
        clusterMask
      );

      // Apply morphological operations to clean up the mask
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3), new cv.Point(-1, -1));
      const anchor = new cv.Point(-1, -1);
      cv.morphologyEx(clusterMask, clusterMask, cv.MORPH_CLOSE, kernel, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
      cv.morphologyEx(clusterMask, clusterMask, cv.MORPH_OPEN, kernel, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

      // Find contours
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(
        clusterMask,
        contours,
        hierarchy,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE
      );

      // Simplify contours to reduce points and smooth edges
      const simplifiedContours: Point[][] = [];
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const simplified = new cv.Mat();
        cv.approxPolyDP(
          contour,
          simplified,
          1.5, // Adjust the approximation accuracy as needed
          true
        );

        // Convert simplified contour to array of Points
        const points: Point[] = [];
        for (let j = 0; j < simplified.data32S.length / 2; j++) {
          const point = new cv.Point(
            simplified.data32S[j * 2],
            simplified.data32S[j * 2 + 1]
          );
          points.push(point);
        }
        simplifiedContours.push(points);
        contour.delete();
        simplified.delete();
      }

      contoursPerCluster[clusterIndex] = simplifiedContours;

      // Clean up
      clusterMask.delete();
      contours.delete();
      hierarchy.delete();
    });

    mat.delete();

    return contoursPerCluster;
  }

  /**
   * Converts the NeuroSlice data to an OpenCV Mat.
   */
  private neuroSliceToMat(neuroSlice: any): Mat {
    const [width, height] = neuroSlice.dim;
    const data = neuroSlice.getData();

    // Create a Mat of the same size with 8-bit unsigned integers
    const mat = new cv.Mat(height, width, cv.CV_32SC1);

    // Copy data into the Mat
    mat.data32S.set(data);

    return mat;
  }

  /**
   * Converts OpenCV contours to a single PixiJS Container.
   */
  private contoursToPixiGraphics(
    contoursPerCluster: { [clusterIndex: number]: Point[][] }
  ): PIXI.Container {
    const container = new PIXI.Container();

    Object.entries(contoursPerCluster).forEach(([clusterIndex, contours]) => {
      const graphics = new PIXI.Graphics();

      // Assign a color based on the cluster index
      const color = this.stringToHex(
        this.getColorForCluster(Number(clusterIndex))
      );

      // Set stroke style for Pixi v8
      graphics.setStrokeStyle({ width: 2, color, alpha: 1 });

      contours.forEach((contour) => {
        if (contour.length === 0) return;

        graphics.moveTo(contour[0].x, contour[0].y);
        for (let i = 1; i < contour.length; i++) {
          graphics.lineTo(contour[i].x, contour[i].y);
        }
        graphics.closePath();
        graphics.stroke();
      });

      container.addChild(graphics);
    });

    return container;
  }

  /**
   * Generates a color string for a given cluster index.
   */
  private getColorForCluster(clusterIndex: number): string {
    // Simple color mapping function (customize as needed)
    const hue = (clusterIndex * 137) % 360; // Using a prime number to distribute colors
    return `hsl(${hue}, 100%, 50%)`;
  }

  /**
   * Converts a color string to a hex number.
   */
  private stringToHex(colorString: string): number {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = colorString;
    return parseInt(ctx.fillStyle.slice(1), 16);
  }
}
