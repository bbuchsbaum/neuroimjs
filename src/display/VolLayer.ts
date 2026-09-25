import { NeuroVol } from '../volume/NeuroVol';
import { ColorMap } from './ColorMap';
import { NeuroSlice } from '../volume/NeuroSlice';
import { AxisSet2D, AxisSet3D, NamedAxis } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { ImageSlice } from './ImageSlice';
import { makeAutoObservable, observable, action } from 'mobx';
import { Range, Threshold } from '../types';
import { Matrix } from 'ml-matrix';
import { LRUCache } from '../utils/LRUCache';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { assertSameVolumeGeometry } from '../geometry/VolumeGeometry';

/**
 * A custom ImageData interface that ensures `colorSpace` is not optional.
 * You can add additional properties to this interface if needed.
 */
interface CustomImageData extends ImageData {
  colorSpace: PredefinedColorSpace;
}

/**
 * VolLayer is a wrapper around a NeuroVol (3D neuroimaging volume) that
 * manages slice extraction, caching, and color/opacity settings for visualization.
 *
 * Supports any volume type implementing NeuroVol interface:
 * - DenseNeuroVol: Dense typed array storage
 * - SparseNeuroVol: Sparse voxel storage (memory efficient for masks/ROIs)
 * - LogicalNeuroVol: Boolean mask volumes
 * - ClusteredNeuroVol: Labeled/parcellated volumes
 */
/**
 * How a slice is resampled for display:
 * - 'linear': colours are blended by the GPU when magnified (smooth anatomy).
 * - 'nearest': voxel-exact blocks; colour never bleeds past a voxel edge.
 * - 'smooth': the *values* are bilinearly interpolated to a finer grid before
 *   colour mapping and thresholding, so thresholded contours follow the
 *   interpolated statistic (as in MRIcroGL / niivue) instead of voxel steps.
 * - 'cubic': values are resampled with clamped Catmull-Rom (bicubic) splines,
 *   sharper than 'linear' for anatomy, without ringing halos at edges.
 */
export type SliceInterpolation = 'linear' | 'nearest' | 'smooth' | 'cubic';

/** Upsampling factor used by the 'smooth' and 'cubic' interpolation modes. */
export const SMOOTH_UPSAMPLE = 4;

export class VolLayer {
  /**
   * A unique identifier for the layer.
   */
  public id: string;

  /**
   * The underlying volume data. Can be any NeuroVol implementation.
   */
  public volume: NeuroVol;

  /**
   * Color mapping configuration for this volume layer.
   * Used to transform intensity values to RGBA values.
   */
  @observable public colorMap: ColorMap;

  /**
   * Global opacity for this layer (0 to 1).
   */
  @observable public opacity: number;

  /**
   * Whether this layer is visible.
   */
  @observable public visible: boolean;

  /**
   * The intensity range [min, max] used for visualization.
   * Values outside this range may be clipped or mapped differently,
   * depending on the color map.
   */
  @observable public range: Range;

  /**
   * The intensity threshold [low, high] used for masking.
   * Intensity values outside this threshold range may be set to transparent,
   * depending on the color map.
   */
  @observable public threshold: Threshold;

  /**
   * Version number that increments whenever colormap settings change.
   * Used by ImageLayer to invalidate texture cache.
   */
  @observable public version: number = 0;

  /**
   * Bumped only when the colour-mapped pixels change (not for opacity), so
   * renderers can reuse uploaded textures across opacity changes.
   */
  public textureVersion: number = 0;

  /**
   * Texture sampling used when the slice is magnified on screen.
   */
  /**
   * Sampling for display. Note: 'smooth' is meant for overlays resampled on the
   * reference (layer 0) grid; the reference layer itself should not use it.
   */
  @observable public interpolation: SliceInterpolation = 'linear';

  /**
   * Strength in [0, 1] of a dark outline drawn on the visible side of every
   * edge between drawn and transparent pixels (i.e. at the threshold contour).
   * 0 disables it.
   */
  @observable public outline: number = 0;

  /**
   * Width, in voxels, of an alpha ramp at the slice's outer edges, so a field
   * of view that ends inside tissue fades out instead of stopping at a hard
   * line. 0 disables it.
   */
  @observable public edgeFade: number = 0;

  /**
   * Only suprathreshold clusters with at least this many voxels (3-D,
   * 26-connected, same sign) get the threshold-contour outline; smaller
   * clusters are still drawn, just not outlined. 0 or 1 outlines everything.
   */
  @observable public minOutlineClusterSize: number = 0;

  private clusterSizeCache: { key: string; volume: NeuroVol; sizes: FloatNeuroVol } | null = null;

  /**
   * A cache of generated slices to avoid recomputation.
   * Keys are constructed from slice index or coordinates, orientation (outAxes),
   * and interpolation mode when relevant.
   */
  private sliceCache: LRUCache<string, ImageSlice>;
  private readonly DEFAULT_CACHE_SIZE = 100;

  /**
   * Constructs a new VolLayer.
   *
   * @param id - A unique identifier for the layer.
   * @param volume - The 3D neuroimaging volume data. Can be any NeuroVol implementation
   *                 (DenseNeuroVol, SparseNeuroVol, LogicalNeuroVol, ClusteredNeuroVol).
   * @param colorMap - Instance of a ColorMap used for intensity -> RGBA transformation.
   * @param range - [Optional] The initial intensity range [min, max].
   *               If not provided, it is inferred from the volume data.
   * @param threshold - [Optional] The threshold range [low, high]. Defaults to [0, 0].
   * @param opacity - [Optional] The global opacity of this layer (0 to 1). Defaults to 1.0.
   */
  constructor(
    id: string,
    volume: NeuroVol,
    colorMap: ColorMap,
    range: Range | null = null,
    threshold: Threshold = [0, 0],
    opacity: number = 1.0,
    cacheSize?: number
  ) {
    makeAutoObservable(this);

    this.id = id;
    this.volume = volume;
    this.colorMap = colorMap;

    // If no range is provided, use the volume's own range.
    this.range = range ?? this.volume.getRange();
    this.threshold = threshold;
    this.opacity = opacity;
    this.visible = true;
    
    // Initialize LRU cache with optional custom size
    this.sliceCache = new LRUCache<string, ImageSlice>(cacheSize ?? this.DEFAULT_CACHE_SIZE);

    // Sync the color map with the current settings.
    this.colorMap.setRange(this.range);
    this.colorMap.setThreshold(this.threshold);
  }

  /**
   * Returns the NeuroSpace of the underlying volume,
   * describing dimensions, spacing, and orientation.
   */
  get space(): NeuroSpace {
    return this.volume.space;
  }

  /**
   * Retrieves a 2D slice from the volume given a slice index (in voxel coordinates)
   * and an orientation (outAxes). The result is cached to avoid recomputation.
   *
   * @param sliceIndex - The integer slice index in the volume (voxel coordinate).
   * @param outAxes - The desired orientation axes for the output slice.
   * @returns An `ImageSlice` containing the 2D image data plus spatial metadata.
   */
  getSlice(sliceIndex: number, outAxes: AxisSet3D): ImageSlice {
    const cacheKey = `${sliceIndex}-${outAxes.toString()}`;

    // Return from cache if available.
    const cachedSlice = this.sliceCache.get(cacheKey);
    if (cachedSlice) {
      return cachedSlice;
    }

    // Generate the slice from the volume, then process it into RGBA data.
    const slice = this.volume.getSlice(sliceIndex, outAxes);
    const sizes = this.clusterSizeSlice(vol => vol.getSlice(sliceIndex, outAxes));
    const imageData = this.processSliceData(slice, sizes);

    // Wrap the raw ImageData and space info into an ImageSlice.
    const imageSlice = this.createImageSlice({
      imageData,
      sliceSpace: slice.space,
    });


    // Store in cache and return.
    this.sliceCache.put(cacheKey, imageSlice);
    return imageSlice;
  }

  /**
   * Retrieves a transformation matrix from this layer's space to a reference space.
   *
   * @param referenceSpace - The reference NeuroSpace to transform into.
   * @returns A 4x4 transformation `Matrix`.
   */
  public getTransformationToReference(referenceSpace: NeuroSpace): Matrix {
    return this.space.getTransformationMatrixTo(referenceSpace);
  }

  /**
   * Retrieves a 2D slice by real-world (or continuous) coordinates, rather than integer indices.
   * Uses the specified interpolation mode. Caches the result for faster subsequent retrieval.
   *
   * @param coord - The [x, y, z] coordinate in the volume's space.
   * @param outAxes - The orientation for the output slice.
   * @param interpolation - The interpolation method: 'nearest' or 'trilinear'. Defaults to 'trilinear'.
   * @returns An `ImageSlice` with the processed 2D image data plus spatial metadata.
   */
  getSliceAt(
    coord: number[],
    outAxes: AxisSet3D,
    interpolation: 'nearest' | 'trilinear' = 'trilinear'
  ): ImageSlice {
    const cacheKey = `${coord.toString()}-${outAxes.toString()}-${interpolation}`;

    // Return from cache if available.
    const cachedSlice = this.sliceCache.get(cacheKey);
    if (cachedSlice) {
      return cachedSlice;
    }

    // Generate slice from the volume using interpolation.
    const slice = this.volume.getSliceAt(coord, outAxes, interpolation);
    const sizes = this.clusterSizeSlice(vol => vol.getSliceAt(coord, outAxes, 'nearest'));
    const imageData = this.processSliceData(slice, sizes);

    // Create an ImageSlice object.
    const imageSlice = this.createImageSlice({
      imageData,
      sliceSpace: slice.space,
    });

    // Store in the cache for reuse.
    this.sliceCache.put(cacheKey, imageSlice);
    return imageSlice;
  }

  /**
   * Replace the underlying volume while keeping the same layer id and color settings.
   * Faster than removing/re-adding a layer because it preserves viewer references.
   *
   * @param newVolume - A NeuroVol with matching geometry (dim, axes, spacing, origin).
   * @param opts - Optional display overrides (range/threshold/opacity/colormap).
   */
  replaceVolume(
    newVolume: NeuroVol,
    opts?: { range?: Range | null; threshold?: Threshold; opacity?: number; colormap?: ColorMap }
  ): void {
    // Compare the complete voxel grid (dims, axes, spacing, origin, affine),
    // not just dims/axes: an overlay on a shifted grid must not be displayed.
    try {
      assertSameVolumeGeometry(this.volume, newVolume);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`replaceVolume: ${detail}`);
    }

    this.volume = newVolume;

    // Update display settings, falling back to existing values
    const nextRange = opts?.range ?? this.range ?? this.volume.getRange();
    const nextThreshold = opts?.threshold ?? this.threshold;
    const nextOpacity = opts?.opacity ?? this.opacity;
    const nextColorMap = opts?.colormap ?? this.colorMap;

    this.range = nextRange ?? this.volume.getRange();
    this.threshold = nextThreshold;
    this.opacity = nextOpacity;
    this.colorMap = nextColorMap;

    // Sync colormap to new settings
    this.colorMap.setRange(this.range);
    this.colorMap.setThreshold(this.threshold);

    // Invalidate cached slices
    this.sliceCache.clear();
  }

  /**
   * Extracts and color-maps the raw voxel data of a NeuroSlice into an RGBA ImageData.
   *
   * @param slice - The slice data extracted from the volume.
   * @returns A `CustomImageData` object containing RGBA pixel data.
   */
  private processSliceData(slice: NeuroSlice, clusterSizes: ArrayLike<number> | null = null): CustomImageData {
    let data: ArrayLike<number> = slice.getData();
    const [nativeW, nativeH] = slice.dim;
    let width = nativeW;
    let height = nativeH;
    const factor = this.upsampleFactor();
    if (this.interpolation === 'smooth') {
      data = upsampleBilinear(data, width, height, factor);
    } else if (this.interpolation === 'cubic') {
      data = upsampleCubicClamped(data, width, height, factor);
    }
    width *= factor;
    height *= factor;

    const rgba = new Uint8ClampedArray(width * height * 4);
    const imageData = typeof globalThis.ImageData === 'function'
      ? new globalThis.ImageData(rgba, width, height) as CustomImageData
      : {
          data: rgba,
          width,
          height,
          colorSpace: 'srgb' as PredefinedColorSpace,
        } as CustomImageData;

    // Fill the imageData based on intensity values using the color map.
    this.colorMap.fillImageData(imageData, data as any);
    if (this.outline > 0) {
      const min = this.minOutlineClusterSize;
      const eligible = clusterSizes && min > 1
        ? (x: number, y: number) =>
            clusterSizes[Math.floor(y / factor) * nativeW + Math.floor(x / factor)] >= min
        : undefined;
      darkenAlphaEdges(imageData.data, width, height, this.outline, eligible);
    }
    if (this.edgeFade > 0) {
      fadeImageEdges(imageData.data, width, height, this.edgeFade * factor);
    }
    return imageData;
  }

  /**
   * Retrieves three orthogonal slices (axial, sagittal, coronal) at a specific coordinate.
   *
   * @param coord - The [x, y, z] coordinate in the volume's space.
   * @param interpolation - Interpolation method: 'nearest' or 'trilinear'. Defaults to 'trilinear'.
   * @returns An object containing `axial`, `sagittal`, and `coronal` slices.
   */
  getOrthoSliceAt(
    coord: number[],
    interpolation: 'nearest' | 'trilinear' = 'trilinear'
  ): {
    axial: ImageSlice;
    sagittal: ImageSlice;
    coronal: ImageSlice;
  } {
    // Axial: L-R, P-A, I-S
    const axialAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );
    const axialImageSlice = this.getSliceAt(coord, axialAxes, interpolation);

    // Sagittal: A-P, I-S, L-R
    const sagittalAxes = new AxisSet3D(
      NamedAxis.ANT_POST,
      NamedAxis.INF_SUP,
      NamedAxis.LEFT_RIGHT
    );
    const sagittalImageSlice = this.getSliceAt(coord, sagittalAxes, interpolation);

    // Coronal: L-R, I-S, P-A
    const coronalAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.INF_SUP,
      NamedAxis.POST_ANT
    );
    const coronalImageSlice = this.getSliceAt(coord, coronalAxes, interpolation);

    return {
      axial: axialImageSlice,
      sagittal: sagittalImageSlice,
      coronal: coronalImageSlice,
    };
  }

  /**
   * Creates an ImageSlice object given the raw image data and slice space metadata.
   *
   * @param sliceResult - An object containing the `imageData` and `sliceSpace`.
   * @returns A new `ImageSlice` containing the image data, bounding box, spacing, and axes info.
   */
  private createImageSlice(sliceResult: {
    imageData: ImageData;
    sliceSpace: NeuroSpace;
  }): ImageSlice {
    const { imageData, sliceSpace } = sliceResult;
    const { width, height } = imageData;

    // Compute bounding box from the slice space's bounds.
    const bounds = sliceSpace.bounds();
    const boundingBox = {
      xMin: bounds[0][0],
      yMin: bounds[0][1],
      xMax: bounds[1][0],
      yMax: bounds[1][1],
    };

    // The 2D spacing and axes for this slice.
    const spacing = sliceSpace.spacing;
    const axes = sliceSpace.axes as AxisSet2D;

    return new ImageSlice(imageData, boundingBox, spacing, axes, this.upsampleFactor());
  }

  /**
   * Checks if the provided coordinate is within the boundaries of this volume's space.
   *
   * @param coord - A [x, y, z] coordinate in real-world or continuous space.
   * @returns True if the coordinate lies within the volume bounds, false otherwise.
   */
  public containsCoord(coord: number[]): boolean {
    return this.volume.space.containsCoord(coord);
  }

  /**
   * Replaces the current ColorMap with a new one and invalidates the slice cache.
   *
   * @param colormap - The new ColorMap to use.
   */
  @action
  public setColormap(colormap: ColorMap): void {
    this.colorMap = colormap;
    this.colorMap.setRange(this.range);
    this.colorMap.setThreshold(this.threshold);
    this.invalidateCache();
  }

  /**
   * Clears the slice cache to force re-generation of slices on the next request.
   * Also increments the version counter to signal texture cache invalidation.
   */
  @action
  private invalidateCache(): void {
    this.sliceCache.clear();
    this.textureVersion++;
    this.version++;
  }


  /**
   * Gets cache statistics for monitoring performance
   */
  public getCacheStats(): {
    size: number;
    capacity: number;
    hits: number;
    misses: number;
    evictions: number;
    hitRatio: number;
  } {
    return this.sliceCache.getStats();
  }

  /**
   * Retrieves the current intensity range used by this layer.
   */
  public getRange(): Range {
    return this.range;
  }

  /**
   * Retrieves the full intensity range of the underlying volume, 
   * as calculated by the volume data itself.
   */
  public getVolumeRange(): [number, number] {
    return this.volume.getRange();
  }

  /**
   * Retrieves the current threshold range used by this layer.
   */
  public getThreshold(): Threshold {
    return this.threshold;
  }

  /**
   * Sets a new intensity threshold [low, high] and invalidates the cache.
   *
   * @param threshold - The new threshold to apply.
   */
  @action
  public setThreshold(threshold: Threshold): void {
    this.threshold = threshold;
    this.colorMap.setThreshold(threshold);
    this.invalidateCache();
  }

  /**
   * Sets a new opacity (0-1) for this layer and invalidates the cache.
   *
   * @param opacity - The new opacity value.
   */
  @action
  public setOpacity(opacity: number): void {
    // Opacity is applied once, at composite time (ImageLayer sets sprite.alpha).
    // It is deliberately NOT baked into the colormap: doing both squared the
    // effective opacity (0.7 rendered as 0.49) and overwrote any per-entry LUT alpha.
    this.opacity = opacity;
    this.version++;
  }

  /** Display pixels per voxel for the current sampling mode. */
  private upsampleFactor(): number {
    return this.interpolation === 'smooth' || this.interpolation === 'cubic' ? SMOOTH_UPSAMPLE : 1;
  }

  /**
   * The component-size slice matching a data slice, when outlines are limited
   * by cluster size; null when every drawn pixel may be outlined.
   */
  private clusterSizeSlice(extract: (vol: NeuroVol) => NeuroSlice): ArrayLike<number> | null {
    if (!(this.outline > 0) || !(this.minOutlineClusterSize > 1)) return null;
    const sizes = this.clusterSizeVolume();
    return sizes ? extract(sizes).getData() : null;
  }

  /**
   * A volume holding, for every suprathreshold voxel, the size of its 3-D
   * 26-connected same-sign cluster (0 elsewhere). Cached per threshold.
   */
  private clusterSizeVolume(): FloatNeuroVol | null {
    const [low, high] = this.threshold;
    if (!(low < high)) return null;
    const key = `${low}:${high}`;
    const cache = this.clusterSizeCache;
    if (cache && cache.key === key && cache.volume === this.volume) return cache.sizes;
    const data = (this.volume as any).getData?.() as ArrayLike<number> | undefined;
    if (!data) return null;
    const sizes = clusterSizes(data, this.volume.space.dim as number[], low, high);
    const vol = new FloatNeuroVol(this.volume.space, sizes);
    this.clusterSizeCache = { key, volume: this.volume, sizes: vol };
    return vol;
  }

  /**
   * Sets the minimum 3-D cluster size (voxels) that gets a threshold outline.
   */
  @action
  public setMinOutlineClusterSize(voxels: number): void {
    const next = Math.max(0, Math.floor(voxels));
    if (next === this.minOutlineClusterSize) return;
    this.minOutlineClusterSize = next;
    this.invalidateCache();
  }

  /**
   * Sets the edge fade width in voxels (0 disables).
   */
  @action
  public setEdgeFade(voxels: number): void {
    const next = Math.max(0, voxels);
    if (next === this.edgeFade) return;
    this.edgeFade = next;
    this.invalidateCache();
  }

  /**
   * Sets the threshold-contour outline strength (0 disables).
   */
  @action
  public setOutline(strength: number): void {
    const next = Math.max(0, Math.min(1, strength));
    if (next === this.outline) return;
    this.outline = next;
    this.invalidateCache();
  }

  /**
   * Sets how the slice is resampled for display; see {@link SliceInterpolation}.
   */
  @action
  public setInterpolation(interpolation: SliceInterpolation): void {
    if (interpolation === this.interpolation) return;
    this.interpolation = interpolation;
    // Cached slices were colour-mapped at the previous sampling.
    this.invalidateCache();
  }

  /**
   * Sets a new intensity range [min, max] for visualization and invalidates the cache.
   *
   * @param range - The new intensity range.
   */
  @action
  public setRange(range: Range): void {
    this.range = range;
    this.colorMap.setRange(this.range);
    this.invalidateCache();
  }

  /**
   * Sets the visibility of this layer.
   *
   * @param visible - Whether the layer should be visible.
   */
  @action
  public setVisible(visible: boolean): void {
    this.visible = visible;
  }
}

/**
 * Bilinearly resamples a row-major (x fastest) 2D grid by an integer factor,
 * sampling at output pixel centres. Where any contributing voxel is not finite
 * the nearest voxel is used, so "no data" never smears into its neighbours.
 */
export function upsampleBilinear(
  src: ArrayLike<number>,
  width: number,
  height: number,
  factor: number
): Float32Array {
  const ow = width * factor;
  const oh = height * factor;
  const out = new Float32Array(ow * oh);
  for (let oy = 0; oy < oh; oy++) {
    const fy = Math.min(Math.max((oy + 0.5) / factor - 0.5, 0), height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, height - 1);
    const ty = fy - y0;
    for (let ox = 0; ox < ow; ox++) {
      const fx = Math.min(Math.max((ox + 0.5) / factor - 0.5, 0), width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, width - 1);
      const tx = fx - x0;
      const a = src[y0 * width + x0];
      const b = src[y0 * width + x1];
      const c = src[y1 * width + x0];
      const d = src[y1 * width + x1];
      let v: number;
      if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d)) {
        v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      } else {
        v = src[(ty < 0.5 ? y0 : y1) * width + (tx < 0.5 ? x0 : x1)];
      }
      out[oy * ow + ox] = v;
    }
  }
  return out;
}

/**
 * Darkens drawn pixels (alpha > 0) that touch a transparent 4-neighbour, which
 * traces the threshold contour one pixel wide on its visible side.
 */
export function darkenAlphaEdges(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
  eligible?: (x: number, y: number) => boolean
): void {
  const k = 1 - strength;
  // Outside the slice counts as drawn, so clusters cut by the field of view
  // are not outlined along the image border.
  const alpha = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 255 : rgba[(y * width + x) * 4 + 3];
  const edges: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha(x, y) === 0) continue;
      if (alpha(x - 1, y) === 0 || alpha(x + 1, y) === 0 || alpha(x, y - 1) === 0 || alpha(x, y + 1) === 0) {
        if (!eligible || eligible(x, y)) edges.push((y * width + x) * 4);
      }
    }
  }
  for (const o of edges) {
    rgba[o] = rgba[o] * k;
    rgba[o + 1] = rgba[o + 1] * k;
    rgba[o + 2] = rgba[o + 2] * k;
  }
}

/**
 * Multiplies alpha by a linear ramp over the outermost `widthPx` pixels.
 */
export function fadeImageEdges(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  widthPx: number
): void {
  if (widthPx <= 0) return;
  for (let y = 0; y < height; y++) {
    const dy = Math.min(y, height - 1 - y);
    for (let x = 0; x < width; x++) {
      const d = Math.min(dy, x, width - 1 - x);
      if (d >= widthPx) continue;
      const o = (y * width + x) * 4 + 3;
      rgba[o] = rgba[o] * ((d + 0.5) / widthPx);
    }
  }
}

/**
 * Clamped Catmull-Rom (bicubic) resampling of a row-major grid by an integer
 * factor, sampling at output pixel centres. Each result is clamped to the
 * range of its four nearest source values, which removes the overshoot
 * (dark/bright rings) cubic kernels produce at sharp edges. Non-finite
 * neighbourhoods fall back to the nearest voxel.
 */
export function upsampleCubicClamped(
  src: ArrayLike<number>,
  width: number,
  height: number,
  factor: number
): Float32Array {
  const ow = width * factor;
  const oh = height * factor;
  const out = new Float32Array(ow * oh);

  // Taps and Catmull-Rom weights depend only on the output column (or row),
  // so precompute them once: 4 clamped source indices + 4 weights per column.
  const taps = (n: number, on: number) => {
    const idx = new Int32Array(on * 4);
    const wts = new Float32Array(on * 4);
    const near = new Int32Array(on * 2); // the two bracketing source samples
    const round = new Int32Array(on); // the nearest source sample
    for (let o = 0; o < on; o++) {
      const f = Math.min(Math.max((o + 0.5) / factor - 0.5, 0), n - 1);
      const i1 = Math.floor(f);
      const t = f - i1, t2 = t * t, t3 = t2 * t;
      wts[o * 4] = -0.5 * t3 + t2 - 0.5 * t;
      wts[o * 4 + 1] = 1.5 * t3 - 2.5 * t2 + 1;
      wts[o * 4 + 2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
      wts[o * 4 + 3] = 0.5 * t3 - 0.5 * t2;
      for (let q = 0; q < 4; q++) idx[o * 4 + q] = Math.min(n - 1, Math.max(0, i1 - 1 + q));
      near[o * 2] = i1;
      near[o * 2 + 1] = Math.min(n - 1, i1 + 1);
      round[o] = Math.round(f);
    }
    return { idx, wts, near, round };
  };
  const cx = taps(width, ow);
  const cy = taps(height, oh);

  for (let oy = 0; oy < oh; oy++) {
    const r0 = cy.idx[oy * 4] * width, r1 = cy.idx[oy * 4 + 1] * width;
    const r2 = cy.idx[oy * 4 + 2] * width, r3 = cy.idx[oy * 4 + 3] * width;
    const wy0 = cy.wts[oy * 4], wy1 = cy.wts[oy * 4 + 1];
    const wy2 = cy.wts[oy * 4 + 2], wy3 = cy.wts[oy * 4 + 3];
    const ny1 = cy.near[oy * 2] * width, ny2 = cy.near[oy * 2 + 1] * width;
    const nearY = cy.round[oy] * width;
    for (let ox = 0; ox < ow; ox++) {
      const c = ox * 4;
      const x0 = cx.idx[c], x1 = cx.idx[c + 1], x2 = cx.idx[c + 2], x3 = cx.idx[c + 3];
      const wx0 = cx.wts[c], wx1 = cx.wts[c + 1], wx2 = cx.wts[c + 2], wx3 = cx.wts[c + 3];
      const sum =
        wy0 * (wx0 * src[r0 + x0] + wx1 * src[r0 + x1] + wx2 * src[r0 + x2] + wx3 * src[r0 + x3]) +
        wy1 * (wx0 * src[r1 + x0] + wx1 * src[r1 + x1] + wx2 * src[r1 + x2] + wx3 * src[r1 + x3]) +
        wy2 * (wx0 * src[r2 + x0] + wx1 * src[r2 + x1] + wx2 * src[r2 + x2] + wx3 * src[r2 + x3]) +
        wy3 * (wx0 * src[r3 + x0] + wx1 * src[r3 + x1] + wx2 * src[r3 + x2] + wx3 * src[r3 + x3]);
      const nx1 = cx.near[ox * 2], nx2 = cx.near[ox * 2 + 1];
      const a = src[ny1 + nx1], b = src[ny1 + nx2], cc = src[ny2 + nx1], d = src[ny2 + nx2];
      if (!Number.isFinite(sum) || !Number.isFinite(a + b + cc + d)) {
        // Non-finite neighbourhood ("no data"): nearest voxel, never smeared.
        out[oy * ow + ox] = src[nearY + cx.round[ox]];
        continue;
      }
      const lo = Math.min(a, b, cc, d);
      const hi = Math.max(a, b, cc, d);
      out[oy * ow + ox] = sum < lo ? lo : sum > hi ? hi : sum;
    }
  }
  return out;
}

/**
 * For each voxel beyond the threshold (value <= low or >= high), the size of
 * its 26-connected cluster of same-sign suprathreshold voxels; 0 elsewhere.
 * Data are row-major with x fastest: index = i + j*nx + k*nx*ny.
 */
export function clusterSizes(
  data: ArrayLike<number>,
  dim: number[],
  low: number,
  high: number
): Float32Array {
  const [nx, ny, nz] = [dim[0], dim[1] ?? 1, dim[2] ?? 1];
  const n = nx * ny * nz;
  const sizes = new Float32Array(n);
  const sign = (v: number) => (v >= high && v > 0 ? 1 : v <= low && v < 0 ? -1 : 0);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const members: number[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (seen[seed]) continue;
    const s = sign(data[seed]);
    if (s === 0) continue;
    seen[seed] = 1;
    stack.push(seed);
    members.length = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      members.push(idx);
      const i = idx % nx;
      const j = Math.floor(idx / nx) % ny;
      const k = Math.floor(idx / (nx * ny));
      for (let dk = -1; dk <= 1; dk++) {
        const kk = k + dk;
        if (kk < 0 || kk >= nz) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= ny) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= nx) continue;
            const m = (kk * ny + jj) * nx + ii;
            if (seen[m] || sign(data[m]) !== s) continue;
            seen[m] = 1;
            stack.push(m);
          }
        }
      }
    }
    for (const m of members) sizes[m] = members.length;
  }
  return sizes;
}
