import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BigNeuroVec, bigNeuroVecSeq } from '../src/vector/BigNeuroVec';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import * as fs from 'fs';
import * as path from 'path';

describe('BigNeuroVec', () => {
  let tempDir: string;
  let tempFiles: string[] = [];
  
  beforeEach(() => {
    // Create temp directory for test files
    tempDir = path.join(process.env.TMPDIR || '/tmp', `bigneuro_test_${Date.now()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });
  
  afterEach(() => {
    // Clean up temp files
    for (const file of tempFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
    tempFiles = [];
    
    // Remove temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }
  });
  
  describe('construction', () => {
    it('should create from data and space', () => {
      const shape = [10, 5, 5, 5];
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(10 * 5 * 5 * 5);
      
      // Fill with test data
      for (let i = 0; i < data.length; i++) {
        data[i] = i;
      }
      
      const vec = new BigNeuroVec(data, space);
      
      expect(vec.shape).toEqual(shape);
      expect(vec.space.dim).toEqual(shape);
      expect(vec.filename).toBeDefined();
      
      // Add to cleanup
      tempFiles.push(vec.filename);
    });
    
    it('should create from filename and shape', () => {
      const filename = path.join(tempDir, 'test.dat');
      const shape = [10, 5, 5, 5];
      
      const vec = new BigNeuroVec(filename, shape);
      
      expect(vec.shape).toEqual(shape);
      expect(vec.filename).toBe(filename);
      expect(fs.existsSync(filename)).toBe(true);
      
      tempFiles.push(filename);
    });
    
    it('should create with custom filename', () => {
      const shape = [10, 5, 5, 5];
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(10 * 5 * 5 * 5);
      const filename = path.join(tempDir, 'custom.dat');
      
      const vec = new BigNeuroVec(data, space, { filename });
      
      expect(vec.filename).toBe(filename);
      expect(fs.existsSync(filename)).toBe(true);
      
      tempFiles.push(filename);
    });
  });
  
  describe('data access', () => {
    it('should get and set values', () => {
      const shape = [4, 3, 3, 3];
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(4 * 3 * 3 * 3);
      
      const vec = new BigNeuroVec(data, space);
      tempFiles.push(vec.filename);
      
      // Set some values
      vec.setAt(0, 0, 0, 0, 1.0);
      vec.setAt(1, 1, 1, 1, 2.0);
      vec.setAt(2, 2, 2, 3, 3.0);
      
      // Get values
      expect(vec.getAt(0, 0, 0, 0)).toBe(1.0);
      expect(vec.getAt(1, 1, 1, 1)).toBe(2.0);
      expect(vec.getAt(2, 2, 2, 3)).toBe(3.0);
      expect(vec.getAt(1, 0, 0, 0)).toBe(0.0);
    });
    
    it('should throw error for read-only access', () => {
      const filename = path.join(tempDir, 'readonly.dat');
      const shape = [4, 3, 3, 3];
      
      // Create file first
      const vec1 = new BigNeuroVec(filename, shape);
      vec1.setAt(0, 0, 0, 0, 1.0);
      vec1.flush();
      vec1.close();
      
      // Open as read-only
      const vec2 = new BigNeuroVec(filename, shape, { mode: 'r' });
      
      expect(() => vec2.setAt(0, 0, 0, 0, 2.0)).toThrow('Cannot modify read-only BigNeuroVec');
      
      tempFiles.push(filename);
    });
  });
  
  describe('series extraction', () => {
    it('should extract single voxel time series', () => {
      const shape = [5, 3, 3, 3];
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(5 * 3 * 3 * 3);
      
      const vec = new BigNeuroVec(data, space);
      tempFiles.push(vec.filename);
      
      // Set time series for voxel (1, 1, 1)
      for (let t = 0; t < 5; t++) {
        vec.setAt(1, 1, 1, t, t * 10);
      }
      
      const series = vec.series(1, 1, 1);
      expect(series).toBeInstanceOf(Float32Array);
      expect(series.length).toBe(5);
      expect(Array.from(series)).toEqual([0, 10, 20, 30, 40]);
    });
    
    it('should extract multiple voxel time series', () => {
      const shape = [3, 2, 2, 2];
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(3 * 2 * 2 * 2);
      
      const vec = new BigNeuroVec(data, space);
      tempFiles.push(vec.filename);
      
      // Set different values for different voxels
      for (let t = 0; t < 3; t++) {
        vec.setAt(0, 0, 0, t, t);
        vec.setAt(1, 1, 1, t, t + 10);
      }
      
      const coords = [[0, 0, 0], [1, 1, 1]];
      const series = vec.series(coords);
      
      expect(series.length).toBe(6); // 3 time points * 2 voxels
      // Data should be in format: [t0v0, t0v1, t1v0, t1v1, t2v0, t2v1]
      expect(Array.from(series)).toEqual([0, 10, 1, 11, 2, 12]);
    });
  });
  
  describe('volume extraction', () => {
    it('should extract volumes', () => {
      const shape = [3, 2, 2, 2];
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(3 * 2 * 2 * 2);
      
      // Fill with sequential values
      for (let i = 0; i < data.length; i++) {
        data[i] = i;
      }
      
      const vec = new BigNeuroVec(data, space);
      tempFiles.push(vec.filename);
      
      const vols = vec.vols();
      
      expect(vols.length).toBe(3);
      expect(vols[0]).toBeInstanceOf(FloatNeuroVol);
      expect(vols[0].space.dim).toEqual([2, 2, 2]);
      
      // Check first volume data
      const vol0Data = vols[0].getData();
      expect(vol0Data.length).toBe(8);
      expect(Array.from(vol0Data.slice(0, 4))).toEqual([0, 1, 2, 3]);
    });
    
    it('should extract specific volumes', () => {
      const shape = [5, 2, 2, 2];
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(5 * 2 * 2 * 2);
      
      const vec = new BigNeuroVec(data, space);
      tempFiles.push(vec.filename);
      
      // Set unique values for each volume
      for (let t = 0; t < 5; t++) {
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            for (let k = 0; k < 2; k++) {
              vec.setAt(i, j, k, t, t * 100);
            }
          }
        }
      }
      
      const vols = vec.vols([0, 2, 4]);
      
      expect(vols.length).toBe(3);
      expect(vols[0].getData()[0]).toBe(0);
      expect(vols[1].getData()[0]).toBe(200);
      expect(vols[2].getData()[0]).toBe(400);
    });
  });
  
  describe('subVector', () => {
    it('should extract subset of time points', () => {
      const shape = [5, 2, 2, 2];
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(5 * 2 * 2 * 2);
      
      const vec = new BigNeuroVec(data, space);
      tempFiles.push(vec.filename);
      
      // Set values
      for (let t = 0; t < 5; t++) {
        vec.setAt(0, 0, 0, t, t * 10);
      }
      
      const subset = vec.subVector([1, 3]);
      tempFiles.push(subset.filename);
      
      expect(subset.shape[0]).toBe(2);
      expect(subset.getAt(0, 0, 0, 0)).toBe(10);
      expect(subset.getAt(0, 0, 0, 1)).toBe(30);
    });
  });
  
  describe('chunk processing', () => {
    it('should process data in chunks', () => {
      const shape = [100, 2, 2, 2];
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(100 * 2 * 2 * 2);
      
      const vec = new BigNeuroVec(data, space);
      tempFiles.push(vec.filename);
      
      // Process in chunks of 10
      const results = vec.processChunks(
        chunk => chunk.length,
        10
      );
      
      expect(results.length).toBe(10);
      expect(results[0]).toBe(10 * 2 * 2 * 2); // 10 volumes * 8 voxels
    });
  });
  
  describe('bigNeuroVecSeq', () => {
    it('should create from volume sequence', () => {
      const volShape = [3, 3, 3];
      const volSpace = new NeuroSpace(volShape, [1, 1, 1], [0, 0, 0]);
      
      const vols = [];
      for (let i = 0; i < 4; i++) {
        const data = new Float32Array(27);
        data.fill(i);
        vols.push(new FloatNeuroVol(volSpace, data));
      }
      
      const vec = bigNeuroVecSeq(vols);
      tempFiles.push(vec.filename);
      
      expect(vec.shape).toEqual([4, 3, 3, 3]);
      expect(vec.getAt(0, 0, 0, 0)).toBe(0);
      expect(vec.getAt(0, 0, 0, 1)).toBe(1);
      expect(vec.getAt(0, 0, 0, 3)).toBe(3);
    });
    
    it('should throw error for inconsistent volumes', () => {
      const vol1 = new FloatNeuroVol(
        new NeuroSpace([2, 2, 2], [1, 1, 1], [0, 0, 0]),
        new Float32Array(8)
      );

      const vol2 = new FloatNeuroVol(
        new NeuroSpace([3, 3, 3], [1, 1, 1], [0, 0, 0]),
        new Float32Array(27)
      );

      expect(() => bigNeuroVecSeq([vol1, vol2])).toThrow('Volume 1 has inconsistent shape');
    });
  });

  describe('non-cubic layout (transpose regression)', () => {
    it('extracts volumes without transposing axes (nx != ny != nz)', () => {
      // Distinct nx, ny, nz so any X<->Z transpose corrupts results.
      const shape = [2, 2, 3, 4]; // [T, X, Y, Z]
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const vec = new BigNeuroVec(new Float32Array(2 * 2 * 3 * 4), space);
      tempFiles.push(vec.filename);

      // Encode each voxel's identity so a transpose is detectable.
      const tag = (i: number, j: number, k: number, t: number) =>
        t * 1000 + i * 100 + j * 10 + k;
      for (let t = 0; t < 2; t++)
        for (let i = 0; i < 2; i++)
          for (let j = 0; j < 3; j++)
            for (let k = 0; k < 4; k++) vec.setAt(i, j, k, t, tag(i, j, k, t));

      const vols = vec.vols();
      expect(vols[1].space.dim).toEqual([2, 3, 4]);
      for (let t = 0; t < 2; t++) {
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 3; j++) {
            for (let k = 0; k < 4; k++) {
              // The extracted volume must agree with the 4D accessor.
              expect(vols[t].getAt(i, j, k)).toBe(tag(i, j, k, t));
              expect(vec.getAt(i, j, k, t)).toBe(tag(i, j, k, t));
            }
          }
        }
      }
    });
  });
});