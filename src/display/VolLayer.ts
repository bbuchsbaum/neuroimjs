import { NeuroVol } from '../volume/NeuroVol';
import { ColorMap } from './ColorMap';
import { NeuroSlice } from '../volume/NeuroSlice';
import { AxisSet2D, AxisSet3D, NamedAxis } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { ImageSlice } from './ImageSlice';
import { createImageData } from 'canvas';
import { makeAutoObservable, observable, action } from 'mobx';
import { Range, Threshold } from '../types';
import { Matrix } from 'ml-matrix';
import { LRUCache } from '../utils/LRUCache';

/**
 * A custom ImageData interface that ensures `colorSpace` is not optional.
 * You can add additional properties to this interface if needed.
 */
interface CustomImageData extends ImageData {
  colorSpace: PredefinedColorSpace;
}

// In environments without `window` (e.g., Node), fallback to `createImageData`.
const ImageDataCtor = typeof window !== 'undefined' ? window.ImageData : createImageData;

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
    this.colorMap.setAlpha(this.opacity);
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
    const imageData = this.processSliceData(slice);

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
    const imageData = this.processSliceData(slice);

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
    const sameDim =
      newVolume.space.dim[0] === this.volume.space.dim[0] &&
      newVolume.space.dim[1] === this.volume.space.dim[1] &&
      newVolume.space.dim[2] === this.volume.space.dim[2];
    if (!sameDim || !newVolume.space.axes.equals(this.volume.space.axes)) {
      throw new Error('replaceVolume: geometry mismatch (dim or axes differ).');
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
    this.colorMap.setAlpha(this.opacity);

    // Invalidate cached slices
    this.sliceCache.clear();
  }

  /**
   * Extracts and color-maps the raw voxel data of a NeuroSlice into an RGBA ImageData.
   *
   * @param slice - The slice data extracted from the volume.
   * @returns A `CustomImageData` object containing RGBA pixel data.
   */
  private processSliceData(slice: NeuroSlice): CustomImageData {
    const data = slice.getData();
    const [width, height] = slice.dim;

    // Use the available ImageData constructor (browser or node/canvas).
    let imageData: CustomImageData;
    if (typeof window !== 'undefined' && window.ImageData) {
      imageData = new window.ImageData(
        new Uint8ClampedArray(width * height * 4),
        width,
        height
      ) as CustomImageData;
    } else {
      imageData = createImageData(
        new Uint8ClampedArray(width * height * 4),
        width,
        height
      ) as CustomImageData;
    }

    // Fill the imageData based on intensity values using the color map.
    this.colorMap.fillImageData(imageData, data);
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

    return new ImageSlice(imageData, boundingBox, spacing, axes);
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
    this.colorMap.setAlpha(this.opacity);
    this.invalidateCache();
  }

  /**
   * Clears the slice cache to force re-generation of slices on the next request.
   * Also increments the version counter to signal texture cache invalidation.
   */
  @action
  private invalidateCache(): void {
    this.sliceCache.clear();
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
    this.opacity = opacity;
    this.colorMap.setAlpha(this.opacity);
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
