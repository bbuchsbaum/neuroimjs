import { describe, it, expect, beforeEach } from 'vitest';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { SparseNeuroVol } from '../src/sparse/SparseNeuroVol';
import { VolLayer } from '../src/display/VolLayer';
import { VolStack } from '../src/display/VolStack';
import { ColorMapFactory } from '../src/display/ColorMapFactory';
import { AxisSet3D, NamedAxis } from '../src/geometry/Axis';
import { ROICoords, ROIVol } from '../src/roi/ROI_improved';

describe('SparseNeuroVol Overlay Support', () => {
  let space: NeuroSpace;
  let denseVol: FloatNeuroVol;
  let sparseVol: SparseNeuroVol;

  beforeEach(() => {
    // Create a small test space
    space = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0]);

    // Create a dense volume with some data
    const denseData = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      denseData[i] = i / 1000; // Gradient values
    }
    denseVol = new FloatNeuroVol(space, denseData);

    // Create a sparse volume with a few highlighted voxels
    const sparseIndices = [555, 556, 557, 565, 566, 567]; // A small cluster
    const sparseValues = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
    sparseVol = new SparseNeuroVol(space, 'float32', 0, sparseIndices, sparseValues);
  });

  describe('VolLayer accepts SparseNeuroVol', () => {
    it('should create a VolLayer from SparseNeuroVol', () => {
      const colorMap = ColorMapFactory.createGrayscale();
      const layer = new VolLayer('sparse-layer', sparseVol, colorMap);

      expect(layer.id).toBe('sparse-layer');
      expect(layer.volume).toBe(sparseVol);
      expect(layer.space).toBe(space);
    });

    it('should correctly compute range from SparseNeuroVol', () => {
      const colorMap = ColorMapFactory.createGrayscale();
      const layer = new VolLayer('sparse-layer', sparseVol, colorMap);
      const range = layer.getVolumeRange();

      expect(range[0]).toBe(0); // default value
      expect(range[1]).toBe(1); // max sparse value
    });

    it('should extract slices from SparseNeuroVol', () => {
      const colorMap = ColorMapFactory.createGrayscale();
      const layer = new VolLayer('sparse-layer', sparseVol, colorMap);
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      const slice = layer.getSlice(5, axialAxes);

      expect(slice).toBeDefined();
      expect(slice.data).toBeDefined();
    });
  });

  describe('VolStack supports mixed volume types', () => {
    it('should create a VolStack with both DenseNeuroVol and SparseNeuroVol', () => {
      const grayscaleMap = ColorMapFactory.createGrayscale();
      const hotMap = ColorMapFactory.createHot();
      const denseLayer = new VolLayer('base', denseVol, grayscaleMap);
      const sparseLayer = new VolLayer('overlay', sparseVol, hotMap);

      const stack = new VolStack(denseLayer, sparseLayer);

      expect(stack.length).toBe(2);
      expect(stack.getLayer(0).id).toBe('base');
      expect(stack.getLayer(1).id).toBe('overlay');
    });

    it('should extract slices from both layers in a mixed stack', () => {
      const grayscaleMap = ColorMapFactory.createGrayscale();
      const hotMap = ColorMapFactory.createHot();
      const denseLayer = new VolLayer('base', denseVol, grayscaleMap);
      const sparseLayer = new VolLayer('overlay', sparseVol, hotMap);

      const stack = new VolStack(denseLayer, sparseLayer);
      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      const slices = stack.getSlice(5, axialAxes);

      expect(slices.length).toBe(2);
      expect(slices[0]).toBeDefined();
      expect(slices[1]).toBeDefined();
    });
  });

  describe('SparseNeuroVol static factory methods', () => {
    it('should create SparseNeuroVol from coordinates', () => {
      const coords = [[5, 5, 5], [5, 5, 6], [5, 6, 5]];
      const values = [1.0, 2.0, 3.0];

      const vol = SparseNeuroVol.fromCoords(space, coords, values);

      expect(vol.getAt(5, 5, 5)).toBe(1.0);
      expect(vol.getAt(5, 5, 6)).toBe(2.0);
      expect(vol.getAt(5, 6, 5)).toBe(3.0);
      expect(vol.getAt(0, 0, 0)).toBe(0); // default value
    });

    it('should create SparseNeuroVol from coordinates with default fill', () => {
      const coords = [[5, 5, 5], [5, 5, 6]];

      const vol = SparseNeuroVol.fromCoords(space, coords);

      expect(vol.getAt(5, 5, 5)).toBe(1); // default fill value
      expect(vol.getAt(5, 5, 6)).toBe(1);
    });

    it('should create SparseNeuroVol from a single point', () => {
      const vol = SparseNeuroVol.fromPoint(space, [5, 5, 5], 42);

      expect(vol.getAt(5, 5, 5)).toBe(42);
      expect(vol.nonDefaultCount).toBe(1);
    });

    it('should create SparseNeuroVol from a sphere', () => {
      const vol = SparseNeuroVol.fromSphere(space, [5, 5, 5], 2, 1.0);

      // Center should be filled
      expect(vol.getAt(5, 5, 5)).toBe(1.0);
      // Adjacent voxels should be filled
      expect(vol.getAt(5, 5, 6)).toBe(1.0);
      expect(vol.getAt(5, 6, 5)).toBe(1.0);
      // Far voxel should not be filled
      expect(vol.getAt(0, 0, 0)).toBe(0);
    });

    it('should create SparseNeuroVol from DenseNeuroVol', () => {
      // Create a dense volume with mostly zeros and a few non-zero values
      const data = new Float32Array(1000);
      data[555] = 5.0;
      data[556] = 6.0;
      const dense = new FloatNeuroVol(space, data);

      const sparse = SparseNeuroVol.fromDense(dense);

      expect(sparse.getAt(5, 5, 5)).toBe(5.0);
      expect(sparse.nonDefaultCount).toBe(2);
    });
  });

  describe('ROI to SparseNeuroVol conversion', () => {
    it('should convert ROICoords to SparseNeuroVol', () => {
      const coords = [[5, 5, 5], [5, 5, 6], [5, 6, 5]];
      const roi = new ROICoords(coords, space);

      const sparse = roi.asSparse();

      expect(sparse.getAt(5, 5, 5)).toBe(1);
      expect(sparse.getAt(5, 5, 6)).toBe(1);
      expect(sparse.getAt(5, 6, 5)).toBe(1);
      expect(sparse.getAt(0, 0, 0)).toBe(0);
    });

    it('should convert ROICoords to SparseNeuroVol with custom fill value', () => {
      const coords = [[5, 5, 5]];
      const roi = new ROICoords(coords, space);

      const sparse = roi.asSparse(42);

      expect(sparse.getAt(5, 5, 5)).toBe(42);
    });

    it('should convert ROIVol to SparseNeuroVol preserving values', () => {
      const coords = [[5, 5, 5], [5, 5, 6]];
      const values = new Float32Array([10.0, 20.0]);
      const roi = new ROIVol(values, space, coords);

      const sparse = roi.asSparse();

      expect(sparse.getAt(5, 5, 5)).toBe(10.0);
      expect(sparse.getAt(5, 5, 6)).toBe(20.0);
    });

    it('should be able to use ROI-derived SparseNeuroVol in VolStack', () => {
      const coords = [[5, 5, 5], [5, 5, 6], [5, 6, 5]];
      const roi = new ROICoords(coords, space);
      const roiSparse = roi.asSparse(1);

      const grayscaleMap = ColorMapFactory.createGrayscale();
      const hotMap = ColorMapFactory.createHot();
      const baseLayer = new VolLayer('base', denseVol, grayscaleMap);
      const roiLayer = new VolLayer('roi-overlay', roiSparse, hotMap);

      const stack = new VolStack(baseLayer, roiLayer);

      expect(stack.length).toBe(2);

      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const slices = stack.getSlice(5, axialAxes);

      expect(slices.length).toBe(2);
    });
  });

  describe('SparseNeuroVol getSlice functionality', () => {
    it('should correctly extract axial slice with sparse data', () => {
      // Create sparse vol with known values at z=5
      const sparse = SparseNeuroVol.fromCoords(space, [[5, 5, 5]], [100]);

      const axialAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );

      const slice = sparse.getSlice(5, axialAxes);
      const sliceData = slice.getData();

      // The voxel at position (5,5) in the slice should have value 100
      // Slice is 10x10, so index = 5 + 5*10 = 55
      expect(sliceData[55]).toBe(100);

      // Other positions should be 0
      expect(sliceData[0]).toBe(0);
    });
  });
});
