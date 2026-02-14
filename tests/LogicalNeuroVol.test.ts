import { describe, it, expect, beforeEach } from 'vitest';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { AxisSet3D } from '../src/geometry/Axis';

describe('LogicalNeuroVol', () => {
  let space: NeuroSpace;
  
  beforeEach(() => {
    // Create a simple 3x3x3 space for testing
    space = new NeuroSpace(
      [3, 3, 3],
      [1, 1, 1],
      [0, 0, 0],
      AxisSet3D.AXIAL_LPI
    );
  });

  describe('constructor', () => {
    it('should create an empty logical volume', () => {
      const vol = new LogicalNeuroVol(space);
      expect(vol.length).toBe(27);
      expect(vol.count()).toBe(0);
    });

    it('should create from boolean array', () => {
      const data = new Array(27).fill(false);
      data[0] = true;
      data[13] = true;
      data[26] = true;
      
      const vol = new LogicalNeuroVol(space, data);
      expect(vol.count()).toBe(3);
      expect(vol.getBool(0)).toBe(true);
      expect(vol.getBool(13)).toBe(true);
      expect(vol.getBool(26)).toBe(true);
    });

    it('should create from indices', () => {
      const indices = [0, 13, 26];
      const vol = new LogicalNeuroVol(space, undefined, indices);
      
      expect(vol.count()).toBe(3);
      expect(vol.getTrueIndices()).toEqual(indices);
    });

    it('should create from Uint8Array', () => {
      const data = new Uint8Array(27);
      data[5] = 1;
      data[10] = 1;
      
      const vol = new LogicalNeuroVol(space, data);
      expect(vol.count()).toBe(2);
      expect(vol.getBool(5)).toBe(true);
      expect(vol.getBool(10)).toBe(true);
    });
  });

  describe('boolean operations', () => {
    it('should get and set boolean values', () => {
      const vol = new LogicalNeuroVol(space);
      
      vol.setBool(5, true);
      expect(vol.getBool(5)).toBe(true);
      expect(vol.get(5)).toBe(1);
      
      vol.setBoolAt(1, 1, 1, true);
      expect(vol.getBoolAt(1, 1, 1)).toBe(true);
      expect(vol.getAt(1, 1, 1)).toBe(1);
    });

    it('should count true voxels', () => {
      const vol = new LogicalNeuroVol(space);
      expect(vol.count()).toBe(0);
      
      vol.setBool(0, true);
      vol.setBool(1, true);
      vol.setBool(2, true);
      expect(vol.count()).toBe(3);
    });

    it('should get true indices', () => {
      const indices = [5, 10, 15, 20];
      const vol = new LogicalNeuroVol(space, undefined, indices);
      
      const trueIndices = vol.getTrueIndices();
      expect(trueIndices).toEqual(indices);
    });

    it('should get true coordinates', () => {
      const vol = new LogicalNeuroVol(space);
      vol.setBoolAt(0, 0, 0, true);
      vol.setBoolAt(1, 1, 1, true);
      vol.setBoolAt(2, 2, 2, true);
      
      const coords = vol.getTrueCoords();
      expect(coords).toContainEqual([0, 0, 0]);
      expect(coords).toContainEqual([1, 1, 1]);
      expect(coords).toContainEqual([2, 2, 2]);
      expect(coords.length).toBe(3);
    });
  });

  describe('logical operations', () => {
    let vol1: LogicalNeuroVol;
    let vol2: LogicalNeuroVol;
    
    beforeEach(() => {
      vol1 = new LogicalNeuroVol(space, undefined, [0, 1, 2, 3]);
      vol2 = new LogicalNeuroVol(space, undefined, [2, 3, 4, 5]);
    });

    it('should perform AND operation', () => {
      const result = vol1.and(vol2);
      expect(result.count()).toBe(2);
      expect(result.getTrueIndices()).toEqual([2, 3]);
    });

    it('should perform OR operation', () => {
      const result = vol1.or(vol2);
      expect(result.count()).toBe(6);
      expect(result.getTrueIndices()).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('should perform XOR operation', () => {
      const result = vol1.xor(vol2);
      expect(result.count()).toBe(4);
      expect(result.getTrueIndices()).toEqual([0, 1, 4, 5]);
    });

    it('should perform NOT operation', () => {
      const vol = new LogicalNeuroVol(space, undefined, [0, 1, 2]);
      const result = vol.not();
      
      expect(result.count()).toBe(24); // 27 - 3
      expect(result.getBool(0)).toBe(false);
      expect(result.getBool(1)).toBe(false);
      expect(result.getBool(2)).toBe(false);
      expect(result.getBool(3)).toBe(true);
    });

    it('should throw error for operations with different spaces', () => {
      const otherSpace = new NeuroSpace(
        [4, 4, 4],
        [1, 1, 1],
        [0, 0, 0],
        AxisSet3D.AXIAL_LPI
      );
      const otherVol = new LogicalNeuroVol(otherSpace);
      
      expect(() => vol1.and(otherVol)).toThrow('Volumes must have the same space');
    });
  });

  describe('threshold operations', () => {
    it('should create from threshold', () => {
      const floatVol = new FloatNeuroVol(space);
      for (let i = 0; i < 27; i++) {
        floatVol.data[i] = i;
      }
      
      const logicalVol = LogicalNeuroVol.fromThreshold(floatVol, 13, 'gt');
      expect(logicalVol.count()).toBe(13); // values 14-26
      
      const logicalVolLte = LogicalNeuroVol.fromThreshold(floatVol, 5, 'lte');
      expect(logicalVolLte.count()).toBe(6); // values 0-5
      
      const logicalVolEq = LogicalNeuroVol.fromThreshold(floatVol, 10, 'eq');
      expect(logicalVolEq.count()).toBe(1); // only value 10
    });
  });

  describe('conversions', () => {
    it('should convert to dense', () => {
      const indices = [5, 10, 15];
      const logicalVol = new LogicalNeuroVol(space, undefined, indices);
      
      const denseVol = logicalVol.asDense();
      expect(denseVol).toBeInstanceOf(FloatNeuroVol);
      expect(denseVol.get(5)).toBe(1);
      expect(denseVol.get(10)).toBe(1);
      expect(denseVol.get(15)).toBe(1);
      expect(denseVol.get(0)).toBe(0);
    });

    it('should return self for asLogical', () => {
      const vol = new LogicalNeuroVol(space);
      expect(vol.asLogical()).toBe(vol);
    });
  });

  describe('slice extraction', () => {
    it('should extract slices', () => {
      const vol = new LogicalNeuroVol(space);
      // Set some values in the middle slice
      vol.setBoolAt(0, 0, 1, true);
      vol.setBoolAt(1, 1, 1, true);
      vol.setBoolAt(2, 2, 1, true);
      
      const slice = vol.getSlice(1, AxisSet3D.AXIAL_LPI);
      expect(slice.data[0]).toBe(1); // (0,0) in slice
      expect(slice.data[4]).toBe(1); // (1,1) in slice
      expect(slice.data[8]).toBe(1); // (2,2) in slice
    });
  });
});