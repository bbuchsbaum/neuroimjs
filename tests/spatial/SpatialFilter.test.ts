import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialFilter } from '../../src/spatial/SpatialFilter';
import { Kernel3D } from '../../src/spatial/Kernel3D';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';

describe('SpatialFilter', () => {
  let volume: FloatNeuroVol;
  let space: NeuroSpace;
  let filter: SpatialFilter;

  beforeEach(() => {
    // Create a 10x10x10 test volume
    space = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
    const data = new Float32Array(1000);
    
    // Initialize with a simple pattern
    let idx = 0;
    for (let k = 0; k < 10; k++) {
      for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 10; i++) {
          // Create a sphere pattern
          const cx = 5, cy = 5, cz = 5;
          const dist = Math.sqrt((i-cx)*(i-cx) + (j-cy)*(j-cy) + (k-cz)*(k-cz));
          data[idx++] = dist <= 2.5 ? 100 : 0;
        }
      }
    }
    
    volume = new FloatNeuroVol(space, data);
    filter = new SpatialFilter(volume);
  });

  describe('Kernel3D', () => {
    it('should create a Gaussian kernel', () => {
      const kernel = Kernel3D.gaussian(1.0, 5);
      expect(kernel.size).toEqual([5, 5, 5]);
      
      // Check center has highest weight
      const center = Math.floor(5 / 2);
      const centerWeight = kernel.getWeight(center, center, center);
      
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          for (let k = 0; k < 5; k++) {
            if (i !== center || j !== center || k !== center) {
              expect(kernel.getWeight(i, j, k)).toBeLessThan(centerWeight);
            }
          }
        }
      }
    });

    it('should normalize kernel weights', () => {
      const kernel = Kernel3D.box(3);
      
      // Sum should be 1 after normalization
      let sum = 0;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          for (let k = 0; k < 3; k++) {
            sum += kernel.getWeight(i, j, k);
          }
        }
      }
      expect(sum).toBeCloseTo(1, 5);
    });

    it('should create spherical kernel', () => {
      const kernel = Kernel3D.sphere(2);
      expect(kernel.size).toEqual([5, 5, 5]);
      
      // Check that corners are zero
      expect(kernel.getWeight(0, 0, 0)).toBe(0);
      expect(kernel.getWeight(4, 4, 4)).toBe(0);
      
      // Center should be non-zero
      expect(kernel.getWeight(2, 2, 2)).toBeGreaterThan(0);
    });
  });

  describe('Gaussian Blur', () => {
    it('should apply Gaussian blur', () => {
      const blurred = filter.gaussianBlur(1.0);
      
      // Check that values are smoothed
      const original = volume.getAt(5, 5, 5);
      const blurredValue = blurred.getAt(5, 5, 5);
      
      // Center value should be reduced due to averaging with zeros
      expect(blurredValue).toBeLessThan(original);
      expect(blurredValue).toBeGreaterThan(0);
    });

    it('should support anisotropic blur', () => {
      const blurred = filter.gaussianBlur([2.0, 1.0, 0.5]);
      expect(blurred.dim).toEqual([10, 10, 10]);
    });
  });

  describe('Median Filter', () => {
    it('should remove impulse noise', () => {
      // Add some noise
      volume.setAt(5, 5, 5, 200); // Impulse noise
      
      const filtered = filter.medianFilter(1);
      const value = filtered.getAt(5, 5, 5);
      
      // Median should remove the impulse
      expect(value).toBeLessThan(150);
    });
  });

  describe('Morphological Operations', () => {
    it('should erode volume', () => {
      const eroded = filter.erode(1);
      
      // Erosion should shrink the sphere
      let originalCount = 0;
      let erodedCount = 0;
      
      for (let k = 0; k < 10; k++) {
        for (let j = 0; j < 10; j++) {
          for (let i = 0; i < 10; i++) {
            if (volume.getAt(i, j, k) > 50) originalCount++;
            if (eroded.getAt(i, j, k) > 50) erodedCount++;
          }
        }
      }
      
      expect(erodedCount).toBeLessThan(originalCount);
    });

    it('should dilate volume', () => {
      const dilated = filter.dilate(1);
      
      // Dilation should expand the sphere
      let originalCount = 0;
      let dilatedCount = 0;
      
      for (let k = 0; k < 10; k++) {
        for (let j = 0; j < 10; j++) {
          for (let i = 0; i < 10; i++) {
            if (volume.getAt(i, j, k) > 50) originalCount++;
            if (dilated.getAt(i, j, k) > 50) dilatedCount++;
          }
        }
      }
      
      expect(dilatedCount).toBeGreaterThan(originalCount);
    });

    it('should perform opening operation', () => {
      // Add small noise
      volume.setAt(0, 0, 0, 100);
      
      const opened = filter.open(1);
      
      // Opening should remove small isolated pixels
      expect(opened.getAt(0, 0, 0)).toBeLessThan(50);
    });

    it('should perform closing operation', () => {
      // Create a gap in the sphere
      volume.setAt(5, 5, 5, 0);
      
      const closed = filter.close(1);
      
      // Closing should fill small gaps
      expect(closed.getAt(5, 5, 5)).toBeGreaterThan(50);
    });
  });

  describe('Bilateral Filter', () => {
    it('should preserve edges while smoothing', () => {
      const options = {
        spatialSigma: 2.0,
        intensitySigma: 50.0,
        windowSize: 5
      };
      
      const filtered = filter.bilateralFilter(options);
      
      // Check edge preservation
      const edge = volume.getAt(3, 5, 5); // Near edge
      const filteredEdge = filtered.getAt(3, 5, 5);
      
      // Should maintain sharp transition
      expect(Math.abs(filteredEdge - edge)).toBeLessThan(20);
    });
  });

  describe('Anisotropic Diffusion', () => {
    it('should apply anisotropic diffusion', () => {
      const filtered = filter.anisotropicDiffusion(5, 10, 0.1);
      
      // Should smooth while preserving edges
      const center = filtered.getAt(5, 5, 5);
      const edge = filtered.getAt(2, 5, 5); // More outside edge
      
      expect(center).toBeGreaterThan(50);
      expect(edge).toBeLessThan(20); // Should be smoothed toward 0
    });

    it('should validate lambda parameter', () => {
      expect(() => filter.anisotropicDiffusion(5, 10, 0.5)).toThrow();
    });
  });

  describe('Edge Detection', () => {
    it('should detect edges with Sobel filter', () => {
      const edges = filter.edgeDetection('sobel');
      
      // Should have high values at sphere boundary
      // The sphere has radius ~2.5 centered at (5,5,5)
      const boundary1 = edges.getAt(3, 5, 5); // Just outside sphere
      const boundary2 = edges.getAt(7, 5, 5); // Other side
      const farOutside = edges.getAt(0, 0, 0); // Far from sphere
      
      // Boundaries should have high gradient magnitude
      expect(boundary1).toBeGreaterThan(20);
      expect(boundary2).toBeGreaterThan(20);
      // Far outside should have low gradient
      expect(farOutside).toBeLessThan(10);
    });

    it('should detect edges with Laplacian filter', () => {
      const edges = filter.edgeDetection('laplacian');
      
      // Laplacian should highlight rapid intensity changes
      const boundary = Math.abs(edges.getAt(3, 5, 5));
      expect(boundary).toBeGreaterThan(0);
    });
  });

  describe('Custom Kernel', () => {
    it('should apply custom kernel', () => {
      // Create a simple averaging kernel
      const kernelData = [
        [[0.125, 0.125], [0.125, 0.125]],
        [[0.125, 0.125], [0.125, 0.125]]
      ];
      const kernel = new Kernel3D(kernelData);
      
      const filtered = filter.spatialFilter(kernel);
      expect(filtered.dim).toEqual([10, 10, 10]);
    });
  });
});