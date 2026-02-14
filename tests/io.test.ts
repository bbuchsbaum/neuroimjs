import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVol,
  writeVol,
  readHeader,
  readVolList,
  readVec,
  writeVec
} from '../src/io/io';
import { 
  FileFormat,
  NIFTIFormat,
  NIFTIDualFormat,
  AFNIFormat,
  findDescriptor,
  getFormat
} from '../src/io/formats';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { BigNeuroVec } from '../src/vector/BigNeuroVec';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as nifti from 'nifti-reader-js';

describe('Enhanced I/O', () => {
  let tempDir: string;
  let tempFiles: string[] = [];
  
  beforeEach(async () => {
    // Create temp directory
    tempDir = path.join(process.env.TMPDIR || '/tmp', `io_test_${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });
  
  afterEach(async () => {
    // Clean up temp files
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch (err) {
        // Ignore if file doesn't exist
      }
    }
    tempFiles = [];
    
    // Remove temp directory
    try {
      await fs.rmdir(tempDir);
    } catch (err) {
      // Ignore if not empty
    }
  });
  
  describe('File Formats', () => {
    it('should identify NIfTI format', () => {
      const format = new NIFTIFormat();
      expect(format.fileFormat).toBe('NIFTI');
      expect(format.headerExtension).toBe('nii');
      expect(format.headerFileMatches('test.nii')).toBe(true);
      expect(format.headerFileMatches('test.hdr')).toBe(false);
    });
    
    it('should identify compressed NIfTI format', () => {
      const format = new NIFTIFormat('gzip');
      expect(format.headerEncoding).toBe('gzip');
      expect(format.headerExtension).toBe('nii.gz');
      expect(format.headerFileMatches('test.nii.gz')).toBe(true);
      expect(format.headerFileMatches('test.nii')).toBe(false);
    });
    
    it('should identify NIfTI dual format', () => {
      const format = new NIFTIDualFormat();
      expect(format.fileFormat).toBe('NIFTI_DUAL');
      expect(format.headerExtension).toBe('hdr');
      expect(format.dataExtension).toBe('img');
      expect(format.headerFileMatches('test.hdr')).toBe(true);
      expect(format.dataFileMatches('test.img')).toBe(true);
    });
    
    it('should identify AFNI format', () => {
      const format = new AFNIFormat();
      expect(format.fileFormat).toBe('AFNI');
      expect(format.headerExtension).toBe('HEAD');
      expect(format.dataExtension).toBe('BRIK');
    });
    
    it('should get format by name', () => {
      const format = getFormat('NIFTI');
      expect(format).toBeInstanceOf(NIFTIFormat);
      
      const formatGz = getFormat('NIFTI_GZ');
      expect(formatGz).toBeInstanceOf(NIFTIFormat);
      expect(formatGz.headerEncoding).toBe('gzip');
    });
    
    it('should throw error for unknown format', () => {
      expect(() => getFormat('UNKNOWN')).toThrow('Unknown file format: UNKNOWN');
    });
  });
  
  describe('Volume I/O', () => {
    it('should write and read a volume', async () => {
      // Create test volume
      const space = new NeuroSpace(
        [10, 10, 10],
        [2, 2, 2],
        [0, 0, 0]
      );
      const data = new Float32Array(1000);
      for (let i = 0; i < 1000; i++) {
        data[i] = i % 256;
      }
      const vol = new FloatNeuroVol(space, data);
      
      // Write volume
      const filePath = path.join(tempDir, 'test_vol.nii');
      tempFiles.push(filePath);
      
      await writeVol(vol, filePath);
      
      // Check file exists
      const stats = await fs.stat(filePath);
      expect(stats.isFile()).toBe(true);
      
      // Read volume back
      const readVol2 = await readVol(filePath);
      
      expect(readVol2.space.dim).toEqual([10, 10, 10]);
      expect(readVol2.space.spacing).toEqual([2, 2, 2]);
      expect(readVol2.length).toBe(1000);
      
      // Check some data values
      const readData = readVol2.getData();
      expect(readData[0]).toBe(0);
      expect(readData[100]).toBe(100);
      expect(readData[256]).toBe(0); // Wraps around
    });
    
    it('should write and read compressed volume', async () => {
      const space = new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]);
      const vol = new FloatNeuroVol(space, new Float32Array(125));
      
      const filePath = path.join(tempDir, 'test_compressed.nii.gz');
      tempFiles.push(filePath);
      
      // Write with compression
      await writeVol(vol, filePath, { compress: true });
      
      // File should exist
      const stats = await fs.stat(filePath);
      expect(stats.isFile()).toBe(true);
      
      // Read back
      const readVol2 = await readVol(filePath);
      expect(readVol2.space.dim).toEqual([5, 5, 5]);
    });
    
    it('should handle progress callback', async () => {
      const space = new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]);
      const vol = new FloatNeuroVol(space);
      
      const filePath = path.join(tempDir, 'test_progress.nii');
      tempFiles.push(filePath);
      
      // Track progress
      const writeProgress: number[] = [];
      await writeVol(vol, filePath, {
        onProgress: (p) => writeProgress.push(p)
      });
      
      expect(writeProgress.length).toBeGreaterThan(0);
      expect(writeProgress[writeProgress.length - 1]).toBe(1.0);
      
      // Read with progress
      const readProgress: number[] = [];
      await readVol(filePath, {
        onProgress: (p) => readProgress.push(p)
      });
      
      expect(readProgress.length).toBeGreaterThan(0);
      expect(readProgress[readProgress.length - 1]).toBe(1.0);
    });
    
    it('should convert data types', async () => {
      const space = new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]);
      const data = new Float32Array(125);
      data.fill(1.5);
      const vol = new FloatNeuroVol(space, data);
      
      const filePath = path.join(tempDir, 'test_int16.nii');
      tempFiles.push(filePath);
      
      // Write as INT16
      await writeVol(vol, filePath, { dataType: 'INT16' });
      
      // Read back
      const readVol2 = await readVol(filePath);
      const readData = readVol2.getData();
      
      // Values should be truncated to integers
      expect(readData[0]).toBe(1); // 1.5 truncated to 1
    });
  });
  
  describe('Header I/O', () => {
    it('should read header information', async () => {
      // Create and write a test volume
      const space = new NeuroSpace(
        [10, 12, 14],
        [2, 2.5, 3],
        [100, 120, 140]
      );
      const vol = new FloatNeuroVol(space);
      
      const filePath = path.join(tempDir, 'test_header.nii');
      tempFiles.push(filePath);
      
      await writeVol(vol, filePath);
      
      // Read header
      const header = await readHeader(filePath);
      
      expect(header.dim).toContain(10);
      expect(header.dim).toContain(12);
      expect(header.dim).toContain(14);
      expect(header.spacing).toContain(2);
      expect(header.spacing).toContain(2.5);
      expect(header.spacing).toContain(3);
      expect(header.origin).toEqual([100, 120, 140]);
      expect(header.datatype).toBe('FLOAT32');
      expect(header.bitpix).toBe(32);
      expect(header.affine).toBeDefined();
      expect(header.affine.length).toBe(4);
    });
  });
  
  describe('Multiple Volume I/O', () => {
    it('should read multiple volumes', async () => {
      // Create test volumes
      const fileNames: string[] = [];
      
      for (let i = 0; i < 3; i++) {
        const space = new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]);
        const data = new Float32Array(125);
        data.fill(i);
        const vol = new FloatNeuroVol(space, data);
        
        const filePath = path.join(tempDir, `vol_${i}.nii`);
        fileNames.push(filePath);
        tempFiles.push(filePath);
        
        await writeVol(vol, filePath);
      }
      
      // Read all volumes
      const volumes = await readVolList(fileNames);
      
      expect(volumes.length).toBe(3);
      expect(volumes[0].getData()[0]).toBe(0);
      expect(volumes[1].getData()[0]).toBe(1);
      expect(volumes[2].getData()[0]).toBe(2);
    });
  });
  
  describe('4D Vector I/O', () => {
    it('should write and read 4D data', async () => {
      // Create 4D data
      const shape = [3, 5, 5, 5]; // 3 time points
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(3 * 125);
      
      // Fill with different values for each timepoint
      for (let t = 0; t < 3; t++) {
        for (let i = 0; i < 125; i++) {
          data[t * 125 + i] = t * 100 + i;
        }
      }
      
      const vec = new BigNeuroVec(data, space);
      
      const filePath = path.join(tempDir, 'test_4d.nii');
      tempFiles.push(filePath);
      
      // Write 4D data
      await writeVec(vec, filePath);
      
      // Read back as vector
      const readVec2 = await readVec(filePath);
      
      expect(readVec2.dim).toEqual([3, 5, 5, 5]);
      
      // Check some values
      expect(readVec2.getAt(0, 0, 0, 0)).toBe(0);
      expect(readVec2.getAt(0, 0, 0, 1)).toBe(100);
      expect(readVec2.getAt(0, 0, 0, 2)).toBe(200);
    });
    
    it('should read specific volumes from 4D file', async () => {
      // Create 4D test file
      const shape = [4, 4, 4, 4]; // 4 time points to avoid index error
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(4 * 64);
      
      for (let i = 0; i < data.length; i++) {
        data[i] = i;
      }
      
      const vec = new BigNeuroVec(data, space);
      const filePath = path.join(tempDir, 'test_4d_select.nii');
      tempFiles.push(filePath);
      
      await writeVec(vec, filePath);
      
      // Read only volumes 0, 2, 3
      const readVec2 = await readVec(filePath, { indices: [0, 2, 3] });
      
      expect(readVec2.dim[0]).toBe(3); // Only 3 volumes
      expect(readVec2.getAt(0, 0, 0, 0)).toBe(0);
      expect(readVec2.getAt(0, 0, 0, 1)).toBe(2 * 64); // Volume 2 starts at index 2*64
      expect(readVec2.getAt(0, 0, 0, 2)).toBe(3 * 64); // Volume 3 starts at index 3*64
    });
    
    it('should use BigNeuroVec for large datasets', async () => {
      // Create a marker file to test BigNeuroVec usage
      const shape = [2, 3, 3, 3]; // Small for testing
      const space = new NeuroSpace(shape, [1, 1, 1, 1], [0, 0, 0, 0]);
      const data = new Float32Array(2 * 27);
      const vec = new BigNeuroVec(data, space);
      
      const filePath = path.join(tempDir, 'test_bigvec.nii');
      tempFiles.push(filePath);
      
      await writeVec(vec, filePath);
      
      // Read with BigNeuroVec flag
      const readVec2 = await readVec(filePath, { useBigVec: true });
      
      expect(readVec2).toBeInstanceOf(BigNeuroVec);
    });
  });
  
  describe('Error Handling', () => {
    it('should throw error for non-existent file', async () => {
      const filePath = path.join(tempDir, 'non_existent.nii');
      
      await expect(readVol(filePath)).rejects.toThrow();
    });
    
    it('should throw error for invalid format', async () => {
      const space = new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]);
      const vol = new FloatNeuroVol(space);
      
      const filePath = path.join(tempDir, 'test.unknown');
      
      await expect(
        writeVol(vol, filePath, { format: 'UNKNOWN' })
      ).rejects.toThrow('Unknown file format: UNKNOWN');
    });
    
    it('should throw error for unsupported write format', async () => {
      const space = new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]);
      const vol = new FloatNeuroVol(space);
      
      const filePath = path.join(tempDir, 'test.HEAD');
      
      await expect(
        writeVol(vol, filePath, { format: 'AFNI' })
      ).rejects.toThrow('Format AFNI not yet supported for writing');
    });
  });
});