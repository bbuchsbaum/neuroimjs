import { describe, it, beforeEach, expect } from 'vitest';
import { Float32NeuroVec, Int16NeuroVec, Uint8NeuroVec, Float64NeuroVec } from '../src/vec/NeuroVec';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { AxisSet3D} from '../src/geometry/Axis';
import { FloatNeuroVol, Int16NeuroVol, UInt8NeuroVol, Float64NeuroVol } from '../src/volume/DenseNeuroVol';

describe('NeuroVec Classes', () => {
  // Common variables for all tests
  const dim = [5, 5, 5, 10]; // Example dimensions (x, y, z, t)
  const spacing = [1.0, 1.0, 1.0];
  const origin = [0.0, 0.0, 0.0];
  const axes = AxisSet3D.AXIAL_LPI;
  const space = new NeuroSpace(dim, spacing, origin, axes);

  describe('Float32NeuroVec', () => {
    let vec: Float32NeuroVec;

    beforeEach(() => {
      vec = new Float32NeuroVec(space);
    });

    it('should have correct length', () => {
      expect(vec.length).toBe(5 * 5 * 5 * 10);
    });

    it('should get and set voxel values correctly', () => {
      vec.setAt(2, 2, 2, 5, 42.0);
      const value = vec.getAt(2, 2, 2, 5);
      expect(value).toBeCloseTo(42.0);
    });

    it('should retrieve the correct volume at time t', () => {
      vec.setAt(1, 1, 1, 3, 3.14);
      const volume = vec.getVolume(3);
      expect(volume).toBeInstanceOf(FloatNeuroVol);
      const volValue = volume.getAt(1, 1, 1);
      expect(volValue).toBeCloseTo(3.14);
    });

    it('should retrieve the correct time series at voxel (i, j, k)', () => {
      for (let t = 0; t < 10; t++) {
        vec.setAt(0, 0, 0, t, t * 1.0);
      }
      const series = vec.getSeries(0, 0, 0);
      expect(series.length).toBe(10);
      for (let t = 0; t < 10; t++) {
        expect(series[t]).toBeCloseTo(t * 1.0);
      }
    });

    it('should throw error for out-of-bounds coordinates in getAt', () => {
      expect(() => vec.getAt(5, 5, 5, 10)).toThrow('Coordinates out of bounds.');
    });

    it('should return correct data array', () => {
      const data = vec.getData();
      expect(data).toBeInstanceOf(Float32Array);
      expect(data.length).toBe(vec.length);
    });

    it('should return correct range of data values', () => {
      vec.setAt(0, 0, 0, 0, -1.0);
      vec.setAt(4, 4, 4, 9, 1.0);
      const [min, max] = vec.getRange();
      expect(min).toBeCloseTo(-1.0);
      expect(max).toBeCloseTo(1.0);
    });

    it('should throw error when getting range of empty data', () => {
      // Create a valid space but with empty data array
      const validSpace = new NeuroSpace([1, 1, 1, 1]);
      const emptyData = new Float32Array(0);
      const emptyVec = new Float32NeuroVec(validSpace, emptyData);
      expect(() => emptyVec.getRange()).toThrow('Volume data is empty');
    });

    it('should have correct dimension, spacing, and origin', () => {
      expect(vec.dim).toEqual(dim);
      expect(vec.spacing).toEqual(spacing);
      expect(vec.origin).toEqual(origin);
    });
  });

  describe('Int16NeuroVec', () => {
    let vec: Int16NeuroVec;

    beforeEach(() => {
      vec = new Int16NeuroVec(space);
    });

    it('should set and get integer voxel values correctly', () => {
      vec.setAt(3, 3, 3, 7, -32768);
      const value = vec.getAt(3, 3, 3, 7);
      expect(value).toBe(-32768);
    });

    it('should retrieve correct volume and its data type', () => {
      const volume = vec.getVolume(0);
      expect(volume).toBeInstanceOf(Int16NeuroVol);
      expect(volume.getData()).toBeInstanceOf(Int16Array);
    });
  });

  describe('Uint8NeuroVec', () => {
    let vec: Uint8NeuroVec;

    beforeEach(() => {
      vec = new Uint8NeuroVec(space);
    });

    it('should handle unsigned integer values correctly', () => {
      vec.setAt(4, 4, 4, 9, 255);
      const value = vec.getAt(4, 4, 4, 9);
      expect(value).toBe(255);
    });

    it('should not accept negative values', () => {
      expect(() => vec.setAt(0, 0, 0, 0, -1)).toThrow();
    });
  });

  describe('Float64NeuroVec', () => {
    let vec: Float64NeuroVec;

    beforeEach(() => {
      vec = new Float64NeuroVec(space);
    });

    it('should handle double-precision values correctly', () => {
      vec.setAt(2, 2, 2, 5, Math.PI);
      const value = vec.getAt(2, 2, 2, 5);
      expect(value).toBeCloseTo(Math.PI);
    });

    it('should retrieve correct volume and its data type', () => {
      const volume = vec.getVolume(1);
      expect(volume).toBeInstanceOf(Float64NeuroVol);
      expect(volume.getData()).toBeInstanceOf(Float64Array);
    });
  });

  describe('DenseNeuroVec Abstract Class', () => {
    it('should throw error when NeuroSpace is not 4D', () => {
      const invalidSpace = new NeuroSpace([5, 5, 5]); // 3D space
      expect(() => new Float32NeuroVec(invalidSpace)).toThrow('NeuroVec requires a 4D NeuroSpace.');
    });

    it('should throw error when space is not an instance of NeuroSpace', () => {
      expect(() => new Float32NeuroVec(null as unknown as NeuroSpace)).toThrow('space must be an instance of NeuroSpace');
    });
  });
});
