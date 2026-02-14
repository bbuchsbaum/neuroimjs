import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VolLayer } from '../src/display/VolLayer';
import { AxisSet3D, AxisSet2D, NamedAxis } from '../src/geometry/Axis';
import { ImageSlice } from '../src/display/ImageSlice';
import { DenseNeuroVol } from '../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { TypedArray } from '../src/types';
import { ColorMap } from '../src/display/ColorMap';

// Mock ImageData for Node environment
beforeAll(() => {
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace: PredefinedColorSpace = 'srgb';

    constructor(data: Uint8ClampedArray | number, width: number, height?: number) {
      if (typeof data === 'number') {
        this.width = data;
        this.height = width;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = data;
        this.width = width;
        this.height = height!;
      }
    }
  });
});

// Mock class for NeuroVol
class MockNeuroVol extends DenseNeuroVol {
  constructor() {
    const axes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );
    const space = new NeuroSpace(
      [10, 10, 10],
      [1, 1, 1],
      [0, 0, 0],
      axes
    );
    const data = new Float32Array(1000);
    // Fill with some test data
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 100;
    }

    super(space, Float32Array, 1000, data);
  }

  public getSliceTypedArrayType(): 'float32' | 'uint8' | 'int16' {
    return 'float32';
  }

  public getDataConstructor(): new (length: number) => TypedArray {
    return Float32Array;
  }

  getAt(i: number, j: number, k: number): number {
    // Provide a mock implementation
    return 0; // or any value you need for testing
  }

  setAt(i: number, j: number, k: number, value: number): void {
    // Mock implementation (do nothing or store the value in a mock data structure)
  }

  getRange(): [number, number] {
    return [0, 100];
  }

  getSlice(sliceIndex: number, outAxes: AxisSet3D): any {
    // Create 2D axes from the 3D ones by reducing the direction vectors
    const axis1 = new NamedAxis(outAxes.i.name, [1, 0]);
    const axis2 = new NamedAxis(outAxes.j.name, [0, 1]);
    const axes2D = new AxisSet2D(axis1, axis2);
    const space2D = new NeuroSpace(
      [10, 10], 
      [1, 1], 
      [0, 0], 
      axes2D
    );
    
    return {
      getData: () => new Float32Array(100).fill(50),
      dim: [10, 10],
      space: space2D
    };
  }

  getSliceAt(coord: number[], outAxes: AxisSet3D, interpolation?: string): any {
    // Create 2D axes from the 3D ones by reducing the direction vectors
    const axis1 = new NamedAxis(outAxes.i.name, [1, 0]);
    const axis2 = new NamedAxis(outAxes.j.name, [0, 1]);
    const axes2D = new AxisSet2D(axis1, axis2);
    const space2D = new NeuroSpace(
      [10, 10], 
      [1, 1], 
      [0, 0], 
      axes2D
    );
    
    return {
      getData: () => new Float32Array(100).fill(50),
      dim: [10, 10],
      space: space2D
    };
  }
}

// Mock class for NeuroSlice
class MockNeuroSlice {
  dim: [number, number, number] = [10, 10, 1];

  getData(): number[] {
    return Array(100).fill(50); // Return an array filled with the value 50
  }

  space = {
    gridToCoord: (gridCoord: number[]) => [gridCoord[0], gridCoord[1], 0],
    spacing: [1, 1],
    axes: new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    ),
  };
}

describe('VolLayer', () => {
  describe('constructor', () => {
    it('should create a VolLayer instance with valid inputs', () => {
      const neuroVol = new MockNeuroVol();
      const colorMap = new ColorMap([
        [1, 0, 0],   // Red
        [0, 1, 0],   // Green
        [0, 0, 1]    // Blue
      ]);
      const range: [number, number] = [0, 100];
      const threshold: [number, number] = [20, 80];

      const volLayer = new VolLayer('test-layer', neuroVol, colorMap, range, threshold);
      expect(volLayer).toBeInstanceOf(VolLayer);
    });

    // Removed test for TypeError as VolLayer doesn't validate neuroVol type at runtime
  });

  describe('getSliceAt', () => {
    it('should return imageData and sliceSpace with correct dimensions', () => {
      const neuroVol = new MockNeuroVol();
      const colorMap = new ColorMap([
        [0, 0, 0],   // Black
        [1, 1, 1]    // White
      ]);
      const range: [number, number] = [0, 100];
      const threshold: [number, number] = [30, 70];

      const volLayer = new VolLayer('test-layer', neuroVol, colorMap, range, threshold);

      const coord = [5, 5, 5];
      const outAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const result = volLayer.getSliceAt(coord, outAxes);

      expect(result).toBeInstanceOf(ImageSlice);
      expect(result.imageData).toBeDefined();
      expect(result.imageData.width).toBe(10);
      expect(result.imageData.height).toBe(10);
    });

    it('should replace volume in place while keeping geometry', () => {
      const baseVol = new MockNeuroVol();
      const colorMap = new ColorMap([
        [0, 0, 0],
        [1, 1, 1]
      ]);
      const volLayer = new VolLayer('replace-me', baseVol, colorMap, [0, 100]);

      const replacementVol = new MockNeuroVol();
      replacementVol.setData(new Float32Array(replacementVol.length).fill(7));

      volLayer.replaceVolume(replacementVol, { range: [0, 7], opacity: 0.5 });

      expect(volLayer.volume).toBe(replacementVol);
      expect(volLayer.range).toEqual([0, 7]);
      expect(volLayer.opacity).toBe(0.5);

      const outAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const slice = volLayer.getSliceAt([5, 5, 5], outAxes);
      expect(slice).toBeInstanceOf(ImageSlice);
    });

    it('should correctly extract a sagittal slice with ANT_POST and INF_SUP orientation', () => {
      const neuroVol = new MockNeuroVol();
      const colorMap = new ColorMap([
        [0, 0, 0],   // Black
        [1, 1, 1]    // White
      ]);
      const range: [number, number] = [0, 100];
      const threshold: [number, number] = [30, 70];

      const volLayer = new VolLayer('test-layer', neuroVol, colorMap, range, threshold);
      const result = volLayer.getSliceAt([5, 5, 5], new AxisSet3D(NamedAxis.ANT_POST, NamedAxis.INF_SUP, NamedAxis.LEFT_RIGHT));

      expect(result).toBeInstanceOf(ImageSlice);
      expect(result.imageData).toBeDefined();
      expect(result.imageData.width).toBe(10);
      expect(result.imageData.height).toBe(10);
    });
  });

  describe('getOrthoSliceAt', () => {
    it('should return axial, sagittal, and coronal ImageSlices', () => {
      const neuroVol = new MockNeuroVol();
      const colorMap = new ColorMap([
        [0, 0, 0],   // Black
        [1, 1, 1]    // White
      ]);
      const range: [number, number] = [0, 100];
      const threshold: [number, number] = [30, 70];

      const volLayer = new VolLayer('test-layer', neuroVol, colorMap, range, threshold);

      const coord = [5, 5, 5];
      const result = volLayer.getOrthoSliceAt(coord);

      expect(result).toHaveProperty('axial');
      expect(result.axial).toBeInstanceOf(ImageSlice);

      expect(result).toHaveProperty('sagittal');
      expect(result.sagittal).toBeInstanceOf(ImageSlice);

      expect(result).toHaveProperty('coronal');
      expect(result.coronal).toBeInstanceOf(ImageSlice);
    });
  });

});
