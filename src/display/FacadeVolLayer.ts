// File: src/display/FacadeVolLayer.ts

import { VolLayer } from './VolLayer';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D, NamedAxis, oppositeAxis } from '../geometry/Axis';
import { ImageSlice } from './ImageSlice';
import { Matrix } from 'ml-matrix';

/**
 * A minimal facade that handles pinned-dimension logic for volumes that differ in orientation.
 * It does NOT do CPU re-sampling. The returned ImageSlice is still in the real layer's
 * bounding box/orientation, so a subsequent GPU transform can align it visually.
 */
export class FacadeVolLayer extends VolLayer {
  private realLayer: VolLayer;
  private referenceSpace: NeuroSpace;
  private toRealXform: Matrix;   // from referenceSpace => realLayer.space
  private fromRealXform: Matrix; // from realLayer.space => referenceSpace

  constructor(realLayer: VolLayer, referenceSpace: NeuroSpace) {
    // We keep colorMap, range, etc. in sync by calling super(...) with the real layer's parameters
    super(
      `facade_${realLayer.id}`, 
      realLayer.volume, 
      realLayer.colorMap,
      realLayer.getRange(),  // Explicitly get the range from the real layer
      realLayer.getThreshold(),
      realLayer.opacity
    );
    this.realLayer = realLayer;
    this.referenceSpace = referenceSpace;

    this.toRealXform   = referenceSpace.getTransformationMatrixTo(realLayer.space);
    this.fromRealXform = realLayer.space.getTransformationMatrixTo(referenceSpace);
    
    // Ensure the ColorMap has the correct range
    this.colorMap.setRange(this.range);
    
    // Log the range to verify it's set correctly
  }

  /** 
   * We override `space` so outside code sees the "reference" NeuroSpace.
   * But the actual slice data we return is STILL in `realLayer` orientation.
   */
  public get space(): NeuroSpace {
    return this.referenceSpace;
  }

  /**
   * Overridden getSlice: 
   *   1) Find the pinned dimension in reference space by comparing axis names
   *   2) Build a reference voxel coordinate [0,0,0], set pinnedDimRef=sliceIndex
   *   3) Convert reference grid coordinates to world coordinates
   *   4) Transform world coordinates to real layer's world coordinates
   *   5) Convert real world coordinates to real grid coordinates
   *   6) Find the pinned dimension in real space by comparing axis names
   *   7) Get the slice index in real space
   *   8) Get the slice from the real layer
   */
  getSlice(sliceIndex: number, outAxes: AxisSet3D): ImageSlice {
    
    // 1) Find the pinned dimension in reference space by comparing axis names
    const refAxes = this.referenceSpace.axes.axes();
    const pinnedAxisName = outAxes.k.name;
    let pinnedDimRef = -1;
    
    for (let i = 0; i < refAxes.length; i++) {
      if (refAxes[i].name === pinnedAxisName || refAxes[i].name === oppositeAxis(outAxes.k).name) {
        pinnedDimRef = i;
        break;
      }
    }
    
    if (pinnedDimRef === -1) {
      console.error(`Cannot find pinned axis ${pinnedAxisName} in reference space`);
      // Fall back to using the last dimension
      pinnedDimRef = refAxes.length - 1;
    }
    

    // 2) Build a reference voxel coordinate [0,0,0], set pinnedDimRef=sliceIndex
    const refGrid = [0, 0, 0];
    refGrid[pinnedDimRef] = sliceIndex;
    
    // 3) Convert reference grid coordinates to world coordinates
    const refWorld = this.referenceSpace.gridToCoord(refGrid);
    
    // 4) Transform world coordinates to real layer's world coordinates
    const realWorld = transformCoord4D(refWorld, this.toRealXform);
    
    // 5) Convert real world coordinates to real grid coordinates
    const realGrid = this.realLayer.space.coordToGrid(realWorld);
    
    // 6) Find the pinned dimension in real space by comparing axis names
    const realAxes = this.realLayer.space.axes.axes();
    let pinnedDimReal = -1;
    
    for (let i = 0; i < realAxes.length; i++) {
      if (realAxes[i].name === pinnedAxisName || realAxes[i].name === oppositeAxis(outAxes.k).name) {
        pinnedDimReal = i;
        break;
      }
    }
    
    if (pinnedDimReal === -1) {
      console.error(`Cannot find pinned axis ${pinnedAxisName} in real space`);
      // Fall back to using the last dimension
      pinnedDimReal = realAxes.length - 1;
    }
    
    
    // 7) Get the slice index in real space
    const realSliceIndex = Math.round(realGrid[pinnedDimReal]);
    
    // 8) Get the slice from the real layer
    const outSlice = this.realLayer.getSlice(realSliceIndex, outAxes);
    
    // Print the range of values in the slice
    const sliceData = outSlice.data;
    if (sliceData.width > 0) {
      const minValue = Math.min(...sliceData.data);
      const maxValue = Math.max(...sliceData.data);
    } else {
    }
    
    return outSlice;
  }

  /**
   * Overridden getSliceAt(...) => interpret [x,y,z] as reference mm => real mm => realLayer.getSliceAt(...)
   * We do no re-sampling to reference. The returned slice bounding box is still in the real orientation.
   */
  getSliceAt(coord: number[], outAxes: AxisSet3D, interpolation: 'nearest' | 'trilinear'='trilinear'): ImageSlice {
    const realMm = transformCoord4D(coord, this.toRealXform);
    return this.realLayer.getSliceAt(realMm, outAxes, interpolation);
  }

  /** Overridden getOrthoSliceAt(...) similarly transforms reference mm => real mm. */
  getOrthoSliceAt(coord: number[], interpolation: 'nearest'|'trilinear'='trilinear') {
    const realMm = transformCoord4D(coord, this.toRealXform);
    return this.realLayer.getOrthoSliceAt(realMm, interpolation);
  }

  // Overridden setters to keep facade & real layer in sync
  public setRange(range: [number, number]): void {
    this.realLayer.setRange(range);
  }
  public setThreshold(th: [number, number]): void {
    this.realLayer.setThreshold(th);
  }
  public setOpacity(op: number): void {
    this.realLayer.setOpacity(op);
  }
  public setColormap(colormap: any): void {
    this.realLayer.setColormap(colormap);
  }
}

/** Utility to apply a 4×4 transform in homogeneous coords. */
function transformCoord4D(coord3: number[], transform: Matrix): number[] {
  const [x, y, z] = coord3;
  const vec = new Matrix([
    [x],
    [y],
    [z],
    [1],
  ]);
  const res = transform.mmul(vec);
  const X = res.get(0,0);
  const Y = res.get(1,0);
  const Z = res.get(2,0);
  const W = res.get(3,0);

  if (W && W !== 1) {
    return [X / W, Y / W, Z / W];
  } else {
    return [X, Y, Z];
  }
}