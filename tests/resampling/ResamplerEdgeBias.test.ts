import { describe, it, expect } from 'vitest';
import { Resampler } from '../../src/resampling/Resampler';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';

/**
 * Build a volume where the value is a linear ramp along x: f(i,j,k) = i.
 * Constant in y and z so only x-interpolation matters.
 */
function makeRampVol(dim: [number, number, number]): FloatNeuroVol {
  const space = new NeuroSpace(dim, [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
  const data = new Float32Array(dim[0] * dim[1] * dim[2]);
  let idx = 0;
  for (let k = 0; k < dim[2]; k++) {
    for (let j = 0; j < dim[1]; j++) {
      for (let i = 0; i < dim[0]; i++) {
        data[idx++] = i;
      }
    }
  }
  return new FloatNeuroVol(space, data);
}

/**
 * Build a 3D linear field: f(i,j,k) = i + 2j + 3k.
 */
function makeLinearVol(dim: [number, number, number]): FloatNeuroVol {
  const space = new NeuroSpace(dim, [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
  const data = new Float32Array(dim[0] * dim[1] * dim[2]);
  let idx = 0;
  for (let k = 0; k < dim[2]; k++) {
    for (let j = 0; j < dim[1]; j++) {
      for (let i = 0; i < dim[0]; i++) {
        data[idx++] = i + 2 * j + 3 * k;
      }
    }
  }
  return new FloatNeuroVol(space, data);
}

function linearValue(x: number, y: number, z: number): number {
  return x + 2 * y + 3 * z;
}

describe('Resampler interpolation edge renormalization', () => {
  // A point at x=0.5 is within one kernel radius of the x=0 edge, so the
  // tap at i=-1 (cubic) / i<=-1 (lanczos) is out of bounds. Before the fix,
  // those taps contributed background (0) to the numerator but their weight
  // to the denominator, biasing the result low. After the fix, out-of-bounds
  // taps are filled by linear extrapolation from the boundary, so a linear ramp
  // interpolates to its exact linear value right up to the edge.

  it('cubic returns the exact linear value next to an edge', () => {
    const vol = makeRampVol([6, 4, 4]);
    const resampler = new Resampler(vol);

    // f(i) = i, so the true value at x=0.5 is exactly 0.5.
    const value = resampler.interpolateAt(0.5, 1, 1, 'cubic');
    expect(value).toBeCloseTo(0.5, 6);
  });

  it('cubic returns the exact linear value next to the far edge', () => {
    const dim: [number, number, number] = [6, 4, 4];
    const vol = makeRampVol(dim);
    const resampler = new Resampler(vol);

    // Near the high-x edge: at x = dim-1.5 = 4.5, true value is 4.5.
    const value = resampler.interpolateAt(4.5, 1, 1, 'cubic');
    expect(value).toBeCloseTo(4.5, 6);
  });

  it('lanczos returns the exact linear value next to an edge', () => {
    const vol = makeRampVol([8, 4, 4]);
    const resampler = new Resampler(vol);

    const value = resampler.interpolateAt(0.5, 1, 1, 'lanczos');
    expect(value).toBeCloseTo(0.5, 6);
  });

  it('lanczos returns the exact linear value next to the far edge', () => {
    const dim: [number, number, number] = [8, 4, 4];
    const vol = makeRampVol(dim);
    const resampler = new Resampler(vol);

    const value = resampler.interpolateAt(6.5, 1, 1, 'lanczos');
    expect(value).toBeCloseTo(6.5, 6);
  });

  it('cubic returns the exact linear value at a low-corner boundary', () => {
    const vol = makeLinearVol([6, 6, 6]);
    const resampler = new Resampler(vol);

    const value = resampler.interpolateAt(0.5, 0.5, 0.5, 'cubic');
    expect(value).toBeCloseTo(linearValue(0.5, 0.5, 0.5), 6);
  });

  it('lanczos returns the exact linear value at a far-corner boundary', () => {
    const vol = makeLinearVol([8, 8, 8]);
    const resampler = new Resampler(vol);

    const value = resampler.interpolateAt(6.5, 6.5, 6.5, 'lanczos');
    expect(value).toBeCloseTo(linearValue(6.5, 6.5, 6.5), 6);
  });

  it('cubic interior value of a linear ramp is exact (no edge effect)', () => {
    const vol = makeRampVol([8, 4, 4]);
    const resampler = new Resampler(vol);

    // Well inside the volume: all taps in bounds, should already be exact.
    const value = resampler.interpolateAt(3.5, 1, 1, 'cubic');
    expect(value).toBeCloseTo(3.5, 6);
  });
});
