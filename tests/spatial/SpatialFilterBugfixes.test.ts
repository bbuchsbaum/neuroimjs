import { describe, it, expect } from 'vitest';
import { SpatialFilter } from '../../src/spatial/SpatialFilter';
import { Kernel3D } from '../../src/spatial/Kernel3D';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';

/**
 * Regression tests for spatial-filtering correctness bugs.
 *
 * Each test is constructed to FAIL against the buggy implementation and PASS
 * after the fix.
 */
describe('SpatialFilter correctness bug fixes', () => {
  const makeSpace = (dim: [number, number, number]) =>
    new NeuroSpace(dim, [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);

  // ---------------------------------------------------------------------------
  // Bug 1: dilate/erode used Number.MIN_VALUE (~+5e-324) as "most negative".
  //        Dilation of a volume with negative values floored at ~0.
  // ---------------------------------------------------------------------------
  describe('Bug 1: dilation/erosion with negative values', () => {
    it('dilation returns the correct negative maximum, not ~0', () => {
      // 5x5x5 volume entirely filled with -5 (all negative).
      const dim: [number, number, number] = [5, 5, 5];
      const data = new Float32Array(5 * 5 * 5).fill(-5);
      const vol = new FloatNeuroVol(makeSpace(dim), data);
      const filter = new SpatialFilter(vol);

      const dilated = filter.dilate(1);

      // The true max in any neighbourhood is -5. The buggy code (init to
      // Number.MIN_VALUE ~ +5e-324) would return ~0 (a positive value).
      const v = dilated.getAt(2, 2, 2);
      expect(v).toBeCloseTo(-5, 6);
      expect(v).toBeLessThan(0); // must NOT be floored to ~0
    });

    it('dilation picks the largest (least negative) value in a negative volume', () => {
      const dim: [number, number, number] = [5, 5, 5];
      const data = new Float32Array(5 * 5 * 5).fill(-10);
      const vol = new FloatNeuroVol(makeSpace(dim), data);
      // One voxel is -2 (the largest value present).
      vol.setAt(2, 2, 2, -2);
      const filter = new SpatialFilter(vol);

      const dilated = filter.dilate(1);

      // A voxel adjacent to (2,2,2) should now hold -2, the real maximum.
      const neighbor = dilated.getAt(2, 2, 1);
      expect(neighbor).toBeCloseTo(-2, 6);
      expect(neighbor).toBeLessThan(0);
    });

    it('erosion returns the correct minimum in a negative volume', () => {
      const dim: [number, number, number] = [5, 5, 5];
      const data = new Float32Array(5 * 5 * 5).fill(-3);
      const vol = new FloatNeuroVol(makeSpace(dim), data);
      vol.setAt(2, 2, 2, -9);
      const filter = new SpatialFilter(vol);

      const eroded = filter.erode(1);
      const neighbor = eroded.getAt(2, 2, 1);
      expect(neighbor).toBeCloseTo(-9, 6);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 3: spatialFilter normalised signed kernels (Sobel/Laplacian) by
  //        weightSum (~0), triggering a fallback that returned the raw center
  //        voxel and destroying the edge/gradient response.
  // ---------------------------------------------------------------------------
  describe('Bug 3: signed kernels are not normalised by ~0 weight sum', () => {
    it('Sobel kernel on a linear ramp returns the gradient, not the raw voxel', () => {
      // The 'x' Sobel kernel differentiates along the kernel's third index,
      // which spatialFilter maps to the volume k-axis. Build a ramp along k so
      // the kernel produces a non-zero response: value = 10 * k.
      const dim: [number, number, number] = [7, 7, 7];
      const data = new Float32Array(7 * 7 * 7);
      let idx = 0;
      for (let k = 0; k < 7; k++) {
        for (let j = 0; j < 7; j++) {
          for (let i = 0; i < 7; i++) {
            data[idx++] = 10 * k;
          }
        }
      }
      const vol = new FloatNeuroVol(makeSpace(dim), data);
      const filter = new SpatialFilter(vol);

      const sobel = filter.spatialFilter(Kernel3D.sobel('x'));

      // Sobel weights sum to 0. The total positive weight on the +face is
      // 1+2+1+2+4+2+1+2+1 = 16, with equal negative weight on the -face. For a
      // ramp of slope 10/voxel, the difference across +/-1 voxel is 2*10=20, so
      // the interior response is 16 * 20 = 320.
      const center = vol.getAt(3, 3, 3); // = 30
      const response = sobel.getAt(3, 3, 3);

      expect(response).toBeCloseTo(320, 5);
      // Buggy code returned the raw center voxel value (30).
      expect(response).not.toBeCloseTo(center, 1);
    });

    it('Laplacian on a uniform region is ~0, and non-zero at an edge', () => {
      // Step edge along x at i>=4 (value jumps 0 -> 100).
      const dim: [number, number, number] = [8, 8, 8];
      const data = new Float32Array(8 * 8 * 8);
      let idx = 0;
      for (let k = 0; k < 8; k++) {
        for (let j = 0; j < 8; j++) {
          for (let i = 0; i < 8; i++) {
            data[idx++] = i >= 4 ? 100 : 0;
          }
        }
      }
      const vol = new FloatNeuroVol(makeSpace(dim), data);
      const filter = new SpatialFilter(vol);

      const lap = filter.spatialFilter(Kernel3D.laplacian());

      // Deep in the flat low region the Laplacian response is 0 (not the raw
      // voxel value, which the buggy fallback would return).
      expect(lap.getAt(1, 4, 4)).toBeCloseTo(0, 5);
      // Right at the step the response is large and non-zero.
      expect(Math.abs(lap.getAt(3, 4, 4))).toBeGreaterThan(50);
      expect(Math.abs(lap.getAt(4, 4, 4))).toBeGreaterThan(50);
    });
  });
});

// ---------------------------------------------------------------------------
// Bug 2: Gaussian default kernel size formula `Math.ceil(maxSigma*6) | 1`.
// ---------------------------------------------------------------------------
describe('Kernel3D.gaussian default size / normalisation', () => {
  it('default-size Gaussian kernel sums to ~1 after normalisation', () => {
    for (const sigma of [0.5, 0.75, 1.0, 1.3, 2.0]) {
      const kernel = Kernel3D.gaussian(sigma);
      let sum = 0;
      const [sx, sy, sz] = kernel.size;
      for (let i = 0; i < sx; i++) {
        for (let j = 0; j < sy; j++) {
          for (let k = 0; k < sz; k++) {
            sum += kernel.getWeight(i, j, k);
          }
        }
      }
      expect(sum).toBeCloseTo(1.0, 6);
    }
  });

  it('sigma=0.5 kernel is not truncated below 3*sigma half-width', () => {
    const kernel = Kernel3D.gaussian(0.5);
    const radius = Math.floor(kernel.size[0] / 2);
    // 3*sigma half-width = ceil(1.5) = 2. The buggy `ceil(3)|1 = 3` gave
    // size 3 -> radius 1 = only 2*sigma.
    const expectedRadius = Math.ceil(3 * 0.5); // = 2
    expect(radius).toBeGreaterThanOrEqual(expectedRadius);
    expect(kernel.size[0] % 2).toBe(1); // odd
  });

  it('produces an odd kernel size for a range of sigmas', () => {
    for (const sigma of [0.3, 0.5, 1.0, 1.7, 2.4, 3.0]) {
      const kernel = Kernel3D.gaussian(sigma);
      expect(kernel.size[0] % 2).toBe(1);
      expect(kernel.size[0]).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Bug 4: separable Gaussian must match the full 3D convolution.
// ---------------------------------------------------------------------------
describe('Separable Gaussian matches full 3D convolution', () => {
  const makeSpace = (dim: [number, number, number]) =>
    new NeuroSpace(dim, [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);

  it('separable gaussianBlur == full-3D spatialFilter on a delta volume', () => {
    const dim: [number, number, number] = [9, 9, 9];
    const data = new Float32Array(9 * 9 * 9);
    // Delta at the centre.
    data[4 + 4 * 9 + 4 * 81] = 100;
    const vol = new FloatNeuroVol(makeSpace(dim), data);
    const filter = new SpatialFilter(vol);

    const sigma = 1.3;
    const separable = filter.gaussianBlur(sigma).getData();
    const full = filter.spatialFilter(Kernel3D.gaussian(sigma)).getData();

    for (let i = 0; i < separable.length; i++) {
      expect(separable[i]).toBeCloseTo(full[i], 5);
    }
  });

  it('separable matches full-3D on a random volume incl. boundaries', () => {
    const dim: [number, number, number] = [8, 8, 8];
    const data = new Float32Array(8 * 8 * 8);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed % 1000) - 200; // include negative values
    }
    const vol = new FloatNeuroVol(makeSpace(dim), data);
    const filter = new SpatialFilter(vol);

    const sigma = 1.0;
    const separable = filter.gaussianBlur(sigma).getData();
    const full = filter.spatialFilter(Kernel3D.gaussian(sigma)).getData();

    let maxDiff = 0;
    for (let i = 0; i < separable.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(separable[i] - full[i]));
    }
    expect(maxDiff).toBeLessThan(1e-5);
  });

  it('separable matches full-3D for anisotropic sigma', () => {
    const dim: [number, number, number] = [9, 9, 9];
    const data = new Float32Array(9 * 9 * 9);
    data[4 + 4 * 9 + 4 * 81] = 100;
    data[1 + 1 * 9 + 1 * 81] = -50; // off-centre negative spike near boundary
    const vol = new FloatNeuroVol(makeSpace(dim), data);
    const filter = new SpatialFilter(vol);

    const sigma: [number, number, number] = [1.5, 1.0, 0.7];
    const separable = filter.gaussianBlur(sigma).getData();
    const full = filter.spatialFilter(Kernel3D.gaussian(sigma)).getData();

    let maxDiff = 0;
    for (let i = 0; i < separable.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(separable[i] - full[i]));
    }
    expect(maxDiff).toBeLessThan(1e-5);
  });
});
