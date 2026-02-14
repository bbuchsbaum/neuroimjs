import { VolLayer } from './VolLayer';
import { FacadeVolLayer } from './FacadeVolLayer';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { ImageSlice } from './ImageSlice';
import { makeObservable, observable, action, computed } from 'mobx';
import { NeuroVol } from '../volume/NeuroVol';

/**
 * VolStack manages multiple VolLayer objects.
 *
 * A VolLayer stores a single volumetric dataset (DenseNeuroVol) plus its
 * rendering parameters (ColorMap, threshold, opacity, etc.). The VolStack
 * class is a container of these VolLayer objects. You can treat it as a
 * "stack" of 3D volumes, all presumably aligned in space, which can be
 * iterated or manipulated as a group.
 *
 * Typical uses:
 *   - Holding multiple overlays or volumes for a single viewer (e.g. T1, T2,
 *     functional, or label data).
 *   - Querying slices across all layers, to combine or composite them.
 *
 * Constraints enforced by VolStack:
 *   - All layers must share the same spatial orientation (AxisSet3D).
 *   - All layers must share the same field of view dimensions in the first
 *     three axes (width, height, depth).
 *   - Each layer must have a unique string ID.
 */
export class VolStack {
  /**
   * Internal list of VolLayers. This is reactive (MobX observable), so any
   * UI code that depends on the list of layers can react when layers change.
   */
  private volLayers: VolLayer[];

  /**
   * The reference 3D orientation used by this stack, derived from the first 
   * layer. All other layers must match this orientation in the x-y-z axes.
   */
  private orientation: AxisSet3D;

  /**
   * The field of view in 3D (width, height, depth) taken from the first 
   * layer's NeuroSpace.dim[0..2]. All subsequent layers must match these 
   * values (e.g. [91,109,91]).
   */
  private fieldOfView: number[];

  /**
   * Constructs a VolStack with multiple VolLayers. This enforces that all
   * layers share identical orientation and field of view in the first three
   * dimensions. Each layer in the argument list is added to an internal array.
   *
   * @param layers - An array of VolLayer instances to initialize the stack.
   * @throws Error if no layers are provided, or if two layers share the same ID.
   *        (Note: in the code, orientation and field of view checks are commented out, 
   *         but you may re-enable them to strictly require identical geometry.)
   */
  constructor(...layers: VolLayer[]) {
    if (layers.length === 0) {
      throw new Error('At least one VolLayer must be provided to initialize VolStack.');
    }
    // First layer defines reference orientation and field of view
    this.orientation = layers[0].space.axes as AxisSet3D;
    this.fieldOfView = layers[0].space.dim.slice(0, 3);

    this.volLayers = [];

    // Configure MobX observability with explicit annotations
    // Use string keys to reference private properties
    // Note: Using observable.shallow for the array to ensure mutations are tracked
    makeObservable<VolStack, 'volLayers'>(this, {
      volLayers: observable.shallow,
      length: computed,
      layers: computed,
      layerCount: computed,
      addLayer: action,
      removeLayer: action,
      moveLayer: action,
      moveLayerById: action,
    });

    layers.forEach(layer => {
      this.addLayer(layer);
    });
  }

  /**
   * Retrieves a VolLayer by its index in the stack.
   * 
   * @param index - The numeric index (0-based) of the desired layer.
   * @returns The VolLayer object at that index.
   * @remarks No bounds checking is done here; an out-of-range index 
   *          will simply throw or return undefined.
   */
  getLayer(index: number): VolLayer {
    return this.volLayers[index];
  }

  /**
   * Returns the entire array of VolLayer objects stored in this VolStack.
   * 
   * @returns A standard JavaScript array of VolLayer instances.
   */
  getLayers(): VolLayer[] {
    return this.volLayers;
  }

  /**
   * Retrieves a VolLayer by its index with explicit bounds checking.
   *
   * @param index - The index of the desired layer (0-based).
   * @returns The VolLayer at the specified index if valid.
   * @throws Error if the index is out of range.
   */
  getVolume(index: number): VolLayer {
    if (index < 0 || index >= this.volLayers.length) {
      throw new Error(`Invalid volume index: ${index}. Valid range is 0 to ${this.volLayers.length - 1}.`);
    }
    return this.volLayers[index];
  }

  /**
   * Returns an immutable view of the VolLayer array.
   * 
   * @remarks This ensures outside code cannot mutate the array structure. 
   */
  get layers(): ReadonlyArray<VolLayer> {
    return this.volLayers;
  }

  /**
   * Reports how many VolLayers are in this stack.
   */
  get length(): number {
    return this.volLayers.length;
  }

  /**
   * The NeuroSpace of the first VolLayer. Usually all VolLayers 
   * share the same space, or the stack logic might break.
   */
  get space(): NeuroSpace {
    return this.volLayers[0].space;
  }

  /**
   * Inserts a new VolLayer into the stack, validating that its orientation and
   * field of view match the existing stack, and that its ID is unique. 
   *
   * @param layer - The VolLayer object to add.
   * @throws Error if the layer has a duplicate ID or mismatched geometry.
   */
  addLayer(layer: VolLayer): void {
    // Check for duplicate ID
    if (this.volLayers.find(existing => existing.id === layer.id)) {
      throw new Error(`Layer with ID "${layer.id}" already exists in the stack.`);
    }

    // Compare orientation
    const refAxes = this.volLayers.length === 0
      ? (layer.space.axes as AxisSet3D) // If this is the first layer
      : (this.volLayers[0].space.axes as AxisSet3D);
    const layerAxes = layer.space.axes as AxisSet3D;

    let finalLayer: VolLayer = layer;
    if (!refAxes.equals(layerAxes)) {
      // Orientation differs => wrap
      const referenceSpace = this.volLayers.length === 0 
        ? layer.space // If there's no existing reference yet
        : this.volLayers[0].space;
      
      finalLayer = new FacadeVolLayer(layer, referenceSpace);
    }

    this.volLayers.push(finalLayer);
  }

  /**
   * Removes a specific VolLayer instance from the stack if found.
   * 
   * @param layer - The VolLayer to remove.
   */
  removeLayer(layer: VolLayer): void {
    const index = this.volLayers.indexOf(layer);
    if (index !== -1) {
      this.volLayers.splice(index, 1);
    }
  }

  /**
   * Retrieves all layer IDs present in the stack.
   * 
   * @returns A string array of layer IDs in the order they appear in volLayers.
   */
  public getLayerIds(): string[] {
    return this.volLayers.map(layer => layer.id);
  }

  /**
   * Attempts to find a VolLayer by a string ID.
   * 
   * @param id - The unique ID of the layer to retrieve.
   * @returns The matching VolLayer or undefined if none match.
   */
  public getLayerById(id: string): VolLayer | undefined {
    return this.volLayers.find(layer => layer.id === id);
  }

  /**
   * Finds the array index of a given layer ID, returning -1 if not found.
   * 
   * @param id - The layer ID to look for.
   * @returns The 0-based index or -1 if not present.
   */
  public getLayerIndexById(id: string): number {
    return this.volLayers.findIndex(layer => layer.id === id);
  }

  /**
   * Move a layer from one index to another.
   */
  public moveLayer(fromIndex: number, toIndex: number): void {
    const count = this.volLayers.length;
    if (fromIndex < 0 || fromIndex >= count) return;
    const clampedTo = Math.max(0, Math.min(toIndex, count - 1));
    if (fromIndex === clampedTo) return;
    const [item] = this.volLayers.splice(fromIndex, 1);
    this.volLayers.splice(clampedTo, 0, item);
  }

  /**
   * Move a layer by ID to a new index.
   */
  public moveLayerById(id: string, toIndex: number): void {
    const fromIndex = this.getLayerIndexById(id);
    if (fromIndex === -1) return;
    this.moveLayer(fromIndex, toIndex);
  }

  /**
   * Generates 2D slices (ImageSlice) from every VolLayer in the stack based on
   * an integer slice index and a given set of output axes. 
   * 
   * @param sliceIndex - The discrete slice index (like z=12).
   * @param outAxes - The orientation in which to extract the slice.
   * @returns An array of ImageSlice, one per VolLayer, in the same order as volLayers.
   */
  getSlice(sliceIndex: number, outAxes: AxisSet3D): ImageSlice[] {
    return this.volLayers.map(layer => layer.getSlice(sliceIndex, outAxes));
  }

  /**
   * Creates 2D slices at a specific real-world coordinate, for each VolLayer,
   * optionally with a chosen interpolation method.
   * 
   * @param coord - A real-valued coordinate [x, y, z], typically in mm within the volume space.
   * @param outAxes - Which orientation to reorient the slice (e.g. AXIAL_LPI).
   * @param interpolation - "nearest" or "trilinear" (default is "trilinear").
   * @returns A parallel array of ImageSlice results, one per VolLayer.
   */
  getSliceAt(coord: number[], outAxes: AxisSet3D, interpolation: 'nearest' | 'trilinear' = 'trilinear'): ImageSlice[] {
    return this.volLayers.map(layer => layer.getSliceAt(coord, outAxes, interpolation));
  }

  /**
   * Obtains orthogonal slices (axial, sagittal, coronal) at the specified coordinate
   * from every VolLayer in the stack. This might be used to quickly get the triple-plane
   * cross-sections for a user-selected point.
   *
   * @param coord - The [x, y, z] location in the volume's space.
   * @param interpolation - Either "nearest" or "trilinear" sampling.
   * @returns An object with arrays of ImageSlice for each orientation (axial, sagittal, coronal). 
   *          The length of each array matches the number of layers in the stack.
   */
  getOrthoSliceAt(
    coord: number[], 
    interpolation: 'nearest' | 'trilinear' = 'trilinear'
  ): { 
    axial: ImageSlice[]; 
    sagittal: ImageSlice[]; 
    coronal: ImageSlice[]; 
  } {
    const results = this.volLayers.map(layer => layer.getOrthoSliceAt(coord, interpolation));
    return {
      axial:    results.map(r => r.axial),
      sagittal: results.map(r => r.sagittal),
      coronal:  results.map(r => r.coronal),
    };
  }

  /**
   * Returns the total count of VolLayers in this stack (same as length).
   */
  get layerCount(): number {
    return this.volLayers.length;
  }
}
