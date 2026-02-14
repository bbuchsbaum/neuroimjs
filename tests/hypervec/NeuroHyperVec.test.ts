import { describe, it, expect, beforeEach } from 'vitest';
import { DenseNeuroHyperVec, createNeuroHyperVec } from '../../src/hypervec/NeuroHyperVec';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { Float32NeuroVec } from '../../src/vec/NeuroVec';

describe('NeuroHyperVec', () => {
  let space: NeuroSpace;
  let hyperVec: DenseNeuroHyperVec;

  beforeEach(() => {
    // Create a small 3D space
    space = new NeuroSpace([4, 4, 4], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
    
    // Create dimensions for subjects and conditions
    const dimensions = [
      {
        name: 'subject',
        size: 3,
        labels: ['S1', 'S2', 'S3']
      },
      {
        name: 'condition',
        size: 2,
        labels: ['rest', 'task']
      },
      {
        name: 'time',
        size: 5
      }
    ];
    
    hyperVec = new DenseNeuroHyperVec(space, dimensions);
  });

  describe('Construction', () => {
    it('should create a hypervec with correct dimensions', () => {
      expect(hyperVec.spatialDim).toEqual([4, 4, 4]);
      expect(hyperVec.ndim).toBe(6); // 3 spatial + 3 non-spatial
      expect(hyperVec.shape).toEqual([4, 4, 4, 3, 2, 5]);
      expect(hyperVec.size).toBe(4 * 4 * 4 * 3 * 2 * 5); // 1920
    });

    it('should store dimension information', () => {
      expect(hyperVec.dimensions).toHaveLength(3);
      expect(hyperVec.dimensions[0].name).toBe('subject');
      expect(hyperVec.dimensions[0].size).toBe(3);
      expect(hyperVec.dimensions[0].labels).toEqual(['S1', 'S2', 'S3']);
    });

    it('should reject non-3D spatial dimensions', () => {
      const space2D = new NeuroSpace([10, 10], [1, 1], [0, 0]);
      expect(() => new DenseNeuroHyperVec(space2D, [])).toThrow();
    });
  });

  describe('Data Access', () => {
    it('should extract a single volume', () => {
      // Set some test data
      const testData = new Float32Array(64); // 4x4x4
      for (let i = 0; i < 64; i++) {
        testData[i] = i;
      }
      const testVol = new FloatNeuroVol(space, testData);
      
      hyperVec.setSubVolume({
        subject: 0,
        condition: 0,
        time: 0
      }, testVol);
      
      // Extract the same volume
      const extracted = hyperVec.getSubVolume({
        subject: 0,
        condition: 0,
        time: 0
      }) as FloatNeuroVol;
      
      expect(extracted).toBeInstanceOf(FloatNeuroVol);
      expect(extracted.dim).toEqual([4, 4, 4]);
      
      // Check data matches
      const extractedData = extracted.getData();
      for (let i = 0; i < 64; i++) {
        expect(extractedData[i]).toBe(testData[i]);
      }
    });

    it('should extract a time series (NeuroVec)', () => {
      // Set data for multiple time points
      for (let t = 0; t < 5; t++) {
        const testData = new Float32Array(64);
        for (let i = 0; i < 64; i++) {
          testData[i] = t * 100 + i; // Different values for each time point
        }
        const testVol = new FloatNeuroVol(space, testData);
        
        hyperVec.setSubVolume({
          subject: 0,
          condition: 0,
          time: t
        }, testVol);
      }
      
      // Extract time series
      const timeSeries = hyperVec.getSubVolume({
        subject: 0,
        condition: 0
        // time not specified, so all time points
      }) as Float32NeuroVec;
      
      expect(timeSeries).toBeInstanceOf(Float32NeuroVec);
      expect(timeSeries.dim).toEqual([4, 4, 4, 5]);
    });

    it('should get voxel series across dimensions', () => {
      // Set predictable data
      let value = 0;
      for (let s = 0; s < 3; s++) {
        for (let c = 0; c < 2; c++) {
          for (let t = 0; t < 5; t++) {
            const testData = new Float32Array(64);
            testData[0] = value++; // Set value at voxel (0,0,0)
            const testVol = new FloatNeuroVol(space, testData);
            
            hyperVec.setSubVolume({
              subject: s,
              condition: c,
              time: t
            }, testVol);
          }
        }
      }
      
      // Get series at voxel (0,0,0) across all dimensions
      const series = hyperVec.getVoxelSeries(0, 0, 0);
      
      // Should have 3*2*5 = 30 values
      expect(series).toHaveLength(30);
      
      // Check values are sequential
      for (let i = 0; i < 30; i++) {
        expect(series[i]).toBe(i);
      }
    });
  });

  describe('Reduction Operations', () => {
    beforeEach(() => {
      // Set up test data with known pattern
      let value = 0;
      for (let s = 0; s < 3; s++) {
        for (let c = 0; c < 2; c++) {
          for (let t = 0; t < 5; t++) {
            const testData = new Float32Array(64);
            for (let i = 0; i < 64; i++) {
              testData[i] = s + c + t; // Sum of indices
            }
            const testVol = new FloatNeuroVol(space, testData);
            
            hyperVec.setSubVolume({
              subject: s,
              condition: c,
              time: t
            }, testVol);
          }
        }
      }
    });

    it('should reduce along time dimension with mean', () => {
      const reduced = hyperVec.reduce(['time'], {
        operation: 'mean'
      });
      
      expect(reduced.dimensions).toHaveLength(2); // subject and condition remain
      expect(reduced.shape).toEqual([4, 4, 4, 3, 2]); // time dimension removed
      
      // Check a value
      const vol = reduced.getSubVolume({
        subject: 0,
        condition: 0
      }) as FloatNeuroVol;
      
      // Mean across time for s=0, c=0 is mean of [0,1,2,3,4] = 2
      expect(vol.getAt(0, 0, 0)).toBe(2);
    });

    it('should reduce with keepDims option', () => {
      const reduced = hyperVec.reduce(['time'], {
        operation: 'mean',
        keepDims: true
      });
      
      expect(reduced.dimensions).toHaveLength(3); // All dimensions remain
      expect(reduced.shape).toEqual([4, 4, 4, 3, 2, 1]); // time dimension is 1
    });

    it('should compute sum reduction', () => {
      const reduced = hyperVec.reduce(['time'], {
        operation: 'sum'
      });
      
      const vol = reduced.getSubVolume({
        subject: 0,
        condition: 0
      }) as FloatNeuroVol;
      
      // Sum across time for s=0, c=0 is sum of [0,1,2,3,4] = 10
      expect(vol.getAt(0, 0, 0)).toBe(10);
    });

    it('should compute min/max reduction', () => {
      const minReduced = hyperVec.reduce(['time'], {
        operation: 'min'
      });
      
      const maxReduced = hyperVec.reduce(['time'], {
        operation: 'max'
      });
      
      const minVol = minReduced.getSubVolume({
        subject: 0,
        condition: 0
      }) as FloatNeuroVol;
      
      const maxVol = maxReduced.getSubVolume({
        subject: 0,
        condition: 0
      }) as FloatNeuroVol;
      
      expect(minVol.getAt(0, 0, 0)).toBe(0); // Min of [0,1,2,3,4]
      expect(maxVol.getAt(0, 0, 0)).toBe(4); // Max of [0,1,2,3,4]
    });
  });

  describe('Map Operations', () => {
    it('should apply function along dimensions', () => {
      // Set initial data
      for (let s = 0; s < 3; s++) {
        const testData = new Float32Array(64);
        for (let i = 0; i < 64; i++) {
          testData[i] = s + 1; // Subject number
        }
        const testVol = new FloatNeuroVol(space, testData);
        
        hyperVec.setSubVolume({
          subject: s,
          condition: 0,
          time: 0
        }, testVol);
      }
      
      // Double all values
      const doubled = hyperVec.mapAlong(['subject', 'condition', 'time'], (vol) => {
        const data = (vol as FloatNeuroVol).getData();
        const newData = data.map(v => v * 2);
        return new FloatNeuroVol(vol.space, newData);
      });
      
      // Check doubled values
      const vol = doubled.getSubVolume({
        subject: 0,
        condition: 0,
        time: 0
      }) as FloatNeuroVol;
      
      expect(vol.getAt(0, 0, 0)).toBe(2); // 1 * 2
    });
  });

  describe('Concatenation', () => {
    it('should concatenate along subject dimension', () => {
      // Create another hypervec with 2 subjects
      const dimensions2 = [
        {
          name: 'subject',
          size: 2,
          labels: ['S4', 'S5']
        },
        {
          name: 'condition',
          size: 2,
          labels: ['rest', 'task']
        },
        {
          name: 'time',
          size: 5
        }
      ];
      
      const hyperVec2 = new DenseNeuroHyperVec(space, dimensions2);
      
      // Set some data
      const testData = new Float32Array(64);
      testData.fill(99);
      const testVol = new FloatNeuroVol(space, testData);
      hyperVec2.setSubVolume({
        subject: 0,
        condition: 0,
        time: 0
      }, testVol);
      
      // Concatenate
      const concatenated = hyperVec.concat(hyperVec2, 'subject');
      
      expect(concatenated.dimensions[0].size).toBe(5); // 3 + 2 subjects
      expect(concatenated.dimensions[0].labels).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
      expect(concatenated.shape).toEqual([4, 4, 4, 5, 2, 5]);
    });

    it('should throw error for incompatible dimensions', () => {
      const dimensions2 = [
        {
          name: 'subject',
          size: 2
        },
        {
          name: 'condition',
          size: 3 // Different size
        },
        {
          name: 'time',
          size: 5
        }
      ];
      
      const hyperVec2 = new DenseNeuroHyperVec(space, dimensions2);
      
      expect(() => hyperVec.concat(hyperVec2, 'subject')).toThrow();
    });
  });

  describe('Split Operations', () => {
    it('should split along time dimension', () => {
      const splits = hyperVec.split('time', [2, 4]);
      
      expect(splits).toHaveLength(3);
      expect(splits[0].dimensions[2].size).toBe(2); // 0-2
      expect(splits[1].dimensions[2].size).toBe(2); // 2-4
      expect(splits[2].dimensions[2].size).toBe(1); // 4-5
    });
  });

  describe('Clone and Dispose', () => {
    it('should create independent clone', () => {
      const clone = hyperVec.clone();
      
      // Modify original
      const testData = new Float32Array(64);
      testData.fill(42);
      const testVol = new FloatNeuroVol(space, testData);
      hyperVec.setSubVolume({
        subject: 0,
        condition: 0,
        time: 0
      }, testVol);
      
      // Clone should not be affected
      const cloneVol = clone.getSubVolume({
        subject: 0,
        condition: 0,
        time: 0
      }) as FloatNeuroVol;
      
      expect(cloneVol.getAt(0, 0, 0)).toBe(0); // Original value
    });

    it('should dispose resources', () => {
      const data = hyperVec.toArray();
      expect(data.length).toBe(1920);
      
      hyperVec.dispose();
      
      const dataAfterDispose = hyperVec.toArray();
      expect(dataAfterDispose.length).toBe(0);
    });
  });

  describe('Factory Function', () => {
    it('should create dense hypervec by default', () => {
      const hv = createNeuroHyperVec(space, [
        { name: 'time', size: 10 }
      ]);
      
      expect(hv).toBeInstanceOf(DenseNeuroHyperVec);
    });

    it('should throw for unimplemented options', () => {
      expect(() => createNeuroHyperVec(space, [], { sparse: true })).toThrow();
      expect(() => createNeuroHyperVec(space, [], { lazy: true })).toThrow();
    });
  });
});