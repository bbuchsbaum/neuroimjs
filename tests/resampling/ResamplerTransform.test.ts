import { describe, it, expect } from 'vitest';
import { Resampler } from '../../src/resampling/Resampler';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';

/**
 * Build a FloatNeuroVol from a generator f(i, j, k) over an NxNxN grid.
 */
function makeVol(
  dim: [number, number, number],
  f: (i: number, j: number, k: number) => number
): FloatNeuroVol {
  const space = new NeuroSpace(dim, [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
  const data = new Float32Array(dim[0] * dim[1] * dim[2]);
  let idx = 0;
  for (let k = 0; k < dim[2]; k++) {
    for (let j = 0; j < dim[1]; j++) {
      for (let i = 0; i < dim[0]; i++) {
        data[idx++] = f(i, j, k);
      }
    }
  }
  return new FloatNeuroVol(space, data);
}

describe('Resampler.transform (affine)', () => {
  describe('identity', () => {
    it('returns (approximately) the input volume for an empty transform', () => {
      const vol = makeVol([6, 6, 6], (i, j, k) => i + 2 * j + 3 * k);
      const resampler = new Resampler(vol);

      const out = resampler.transform({}) as FloatNeuroVol;

      expect(out.dim).toEqual([6, 6, 6]);
      const inData = vol.getData();
      const outData = out.getData();
      for (let n = 0; n < inData.length; n++) {
        expect(outData[n]).toBeCloseTo(inData[n], 6);
      }
    });

    it('returns the input volume for an explicit identity matrix', () => {
      const vol = makeVol([5, 5, 5], (i, j, k) => i + 10 * j + 100 * k);
      const resampler = new Resampler(vol);

      const out = resampler.transform({
        matrix: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1]
        ]
      }) as FloatNeuroVol;

      const inData = vol.getData();
      const outData = out.getData();
      for (let n = 0; n < inData.length; n++) {
        expect(outData[n]).toBeCloseTo(inData[n], 6);
      }
    });
  });

  describe('integer translation', () => {
    it('shifts the data by an integer number of voxels along x', () => {
      // f = i so we can check the shift directly.
      const dim: [number, number, number] = [8, 4, 4];
      const vol = makeVol(dim, (i) => i);
      const resampler = new Resampler(vol);

      // Forward map q = p + 2 means output[q] = input[q - 2].
      const out = resampler.transform(
        { translation: [2, 0, 0] },
        { method: 'nearest', backgroundValue: -1 }
      ) as FloatNeuroVol;

      for (let k = 0; k < dim[2]; k++) {
        for (let j = 0; j < dim[1]; j++) {
          for (let i = 0; i < dim[0]; i++) {
            const expected = i - 2 >= 0 ? i - 2 : -1; // background outside
            expect(out.getAt(i, j, k)).toBeCloseTo(expected, 6);
          }
        }
      }
    });

    it('shifts the data along y', () => {
      const dim: [number, number, number] = [4, 8, 4];
      const vol = makeVol(dim, (_i, j) => j);
      const resampler = new Resampler(vol);

      const out = resampler.transform(
        { translation: [0, 3, 0] },
        { method: 'nearest', backgroundValue: -1 }
      ) as FloatNeuroVol;

      for (let k = 0; k < dim[2]; k++) {
        for (let j = 0; j < dim[1]; j++) {
          for (let i = 0; i < dim[0]; i++) {
            const expected = j - 3 >= 0 ? j - 3 : -1;
            expect(out.getAt(i, j, k)).toBeCloseTo(expected, 6);
          }
        }
      }
    });
  });

  describe('rotation about the volume center', () => {
    it('maps an asymmetric pattern to its 90-degree-rotated position', () => {
      // Use a single in-plane (z fixed) slice replicated through z so that an
      // in-plane rotation about z is easy to reason about.
      const dim: [number, number, number] = [5, 5, 3];

      // Place a distinctive value (7) at a single off-center voxel (i=4, j=2)
      // (the +x extreme, mid y). All other voxels are 0.
      const markI = 4;
      const markJ = 2;
      const vol = makeVol(dim, (i, j) => (i === markI && j === markJ ? 7 : 0));
      const resampler = new Resampler(vol);

      // Rotate +90 degrees about z, about the volume center (2,2,c).
      const center: [number, number, number] = [2, 2, 1];
      const out = resampler.transform(
        { rotation: [0, 0, Math.PI / 2], center },
        { method: 'nearest', backgroundValue: 0 }
      ) as FloatNeuroVol;

      // Forward map of the marked input voxel p=(4,2):
      //   p - center = (2, 0)
      //   Rz(+90): (x,y) -> (-y, x) => (0, 2)
      //   + center => (2, 4)
      // So the value 7 should land at output voxel (2, 4).
      expect(out.getAt(2, 4, 1)).toBeCloseTo(7, 6);

      // And it must have moved away from its original location.
      expect(out.getAt(markI, markJ, 1)).toBeCloseTo(0, 6);

      // Total mass is preserved (only one marked voxel per z-slice).
      const data = out.getData();
      let nonzero = 0;
      for (let n = 0; n < data.length; n++) {
        if (Math.abs(data[n]) > 1e-9) nonzero++;
      }
      expect(nonzero).toBe(dim[2]); // one per z slice
    });
  });
});
