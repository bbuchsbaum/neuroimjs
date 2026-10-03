// File: src/display/FacadeVolLayer.ts

import { VolLayer, SliceInterpolation } from './VolLayer';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D, oppositeAxis } from '../geometry/Axis';
import { ImageSlice } from './ImageSlice';
import { ColorMap } from './ColorMap';
import { NeuroVol } from '../volume/NeuroVol';
import { Range, Threshold } from '../types';

/**
 * A minimal facade that handles pinned-dimension logic for volumes that differ in orientation.
 * It does NOT do CPU re-sampling. The returned ImageSlice is still in the real layer's
 * bounding box/orientation, so a subsequent GPU transform can align it visually.
 *
 * The facade carries the wrapped layer's id and display state. Renderers read
 * that state (and track `version`) from the facade, while slices come from the
 * wrapped layer, so every display setter is applied to both. Change display
 * settings through the layer in the stack (e.g. `stack.getLayerById(id)`):
 * setters called on the original VolLayer do not reach the facade.
 */
export class FacadeVolLayer extends VolLayer {
  private realLayer: VolLayer;
  private referenceSpace: NeuroSpace;

  constructor(realLayer: VolLayer, referenceSpace: NeuroSpace) {
    super(
      realLayer.id,
      realLayer.volume,
      realLayer.colorMap,
      realLayer.getRange(),
      realLayer.getThreshold(),
      realLayer.opacity
    );
    this.realLayer = realLayer;
    this.referenceSpace = referenceSpace;

    this.visible = realLayer.visible;
    this.interpolation = realLayer.interpolation;
    this.outline = realLayer.outline;
    this.edgeFade = realLayer.edgeFade;
    this.minOutlineClusterSize = realLayer.minOutlineClusterSize;
  }

  /** 
   * We override `space` so outside code sees the "reference" NeuroSpace.
   * But the actual slice data we return is STILL in `realLayer` orientation.
   */
  public get space(): NeuroSpace {
    return this.referenceSpace;
  }

  /**
   * Overridden getSlice: `sliceIndex` is a reference-grid index along the
   * pinned axis. The plane it selects is located in world space and the real
   * layer is sliced at its own grid index for that plane. Both spaces share
   * the world (scanner) frame, so no transform is applied between them.
   */
  getSlice(sliceIndex: number, outAxes: AxisSet3D): ImageSlice {
    const pinnedDimRef = pinnedDim(this.referenceSpace, outAxes, 'reference');

    const refGrid = [0, 0, 0];
    refGrid[pinnedDimRef] = sliceIndex;
    const world = this.referenceSpace.gridToCoord(refGrid);

    const realSpace = this.realLayer.space;
    const realGrid = realSpace.coordToGrid(world);
    const realSliceIndex = Math.round(realGrid[pinnedDim(realSpace, outAxes, 'real')]);

    return this.realLayer.getSlice(realSliceIndex, outAxes);
  }

  /**
   * Overridden getSliceAt(...): `coord` is a world coordinate, shared by both
   * spaces, so it is passed to the real layer unchanged. No re-sampling to the
   * reference grid is done.
   */
  getSliceAt(coord: number[], outAxes: AxisSet3D, interpolation: 'nearest' | 'trilinear'='trilinear'): ImageSlice {
    return this.realLayer.getSliceAt(coord, outAxes, interpolation);
  }

  /** Overridden getOrthoSliceAt(...): world coordinates pass through unchanged. */
  getOrthoSliceAt(coord: number[], interpolation: 'nearest'|'trilinear'='trilinear') {
    return this.realLayer.getOrthoSliceAt(coord, interpolation);
  }

  // Display setters update the facade (read by renderers) and the real layer
  // (which colour-maps the slices).
  public setRange(range: Range): void {
    super.setRange(range);
    this.realLayer.setRange(range);
  }
  public setThreshold(th: Threshold): void {
    super.setThreshold(th);
    this.realLayer.setThreshold(th);
  }
  public setOpacity(op: number): void {
    super.setOpacity(op);
    this.realLayer.setOpacity(op);
  }
  public setColormap(colormap: ColorMap): void {
    super.setColormap(colormap);
    this.realLayer.setColormap(colormap);
  }
  public setVisible(visible: boolean): void {
    super.setVisible(visible);
    this.realLayer.setVisible(visible);
  }
  public setInterpolation(interpolation: SliceInterpolation): void {
    super.setInterpolation(interpolation);
    this.realLayer.setInterpolation(interpolation);
  }
  public setOutline(strength: number): void {
    super.setOutline(strength);
    this.realLayer.setOutline(strength);
  }
  public setEdgeFade(voxels: number): void {
    super.setEdgeFade(voxels);
    this.realLayer.setEdgeFade(voxels);
  }
  public setMinOutlineClusterSize(voxels: number): void {
    super.setMinOutlineClusterSize(voxels);
    this.realLayer.setMinOutlineClusterSize(voxels);
  }
  public replaceVolume(
    newVolume: NeuroVol,
    opts?: { range?: Range | null; threshold?: Threshold; opacity?: number; colormap?: ColorMap }
  ): void {
    super.replaceVolume(newVolume, opts);
    this.realLayer.replaceVolume(newVolume, opts);
  }
}

/** Index of the space's dimension along the view's pinned axis. */
function pinnedDim(space: NeuroSpace, outAxes: AxisSet3D, label: string): number {
  const axes = space.axes.axes();
  for (let i = 0; i < axes.length; i++) {
    if (axes[i].name === outAxes.k.name || axes[i].name === oppositeAxis(outAxes.k).name) {
      return i;
    }
  }
  console.error(`Cannot find pinned axis ${outAxes.k.name} in ${label} space`);
  // Fall back to using the last dimension
  return axes.length - 1;
}
