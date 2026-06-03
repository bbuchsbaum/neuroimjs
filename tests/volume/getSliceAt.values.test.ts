import { describe, it, expect } from 'vitest';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';

/**
 * Value-level coverage for getSliceAt. The pre-existing test only checked that
 * the 2D slice space is non-singular; it never asserted that the sampled values
 * are correct, which is exactly why the identity-transform bug shipped.
 */
describe('DenseNeuroVol.getSliceAt() samples the correct voxels', () => {
  // Encode each voxel's identity so any axis permutation/flip is detectable.
  const nx = 3, ny = 4, nz = 5;
  const space = new NeuroSpace(
    [nx, ny, nz],
    [1, 1, 1],
    [0, 0, 0],
    new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
  );
  const data = new Float32Array(nx * ny * nz);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++)
        data[x + y * nx + z * nx * ny] = x * 100 + y * 10 + z;
  const vol = new FloatNeuroVol(space, data);

  it('returns the correct in-plane values for the native orientation', () => {
    const sameAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );
    // World coordinate on the z = 2 plane.
    const world = space.gridToCoord([0, 0, 2]);
    const slice = vol.getSliceAt(world, sameAxes, 'nearest');
    const sd = slice.getData();
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // Native orientation: pixel (i,j) is source voxel (i, j, 2).
        expect(sd[j * nx + i]).toBe(i * 100 + j * 10 + 2);
      }
    }
  });

  it('applies the axis permutation for a swapped orientation', () => {
    // Swap the POST_ANT and INF_SUP axes: pixel (i,j) must map to source
    // voxel (i, 2, j), NOT (i, j, 2) as the old identity-transform code did.
    const swapped = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.INF_SUP,
      NamedAxis.POST_ANT
    );
    const world: number[] = [1, 2, 3]; // source voxel (1,2,3) world coord
    const slice = vol.getSliceAt(world, swapped, 'nearest');
    const sd = slice.getData();
    const sliceNx = slice.space.dim[0]; // = nx (LEFT_RIGHT)
    const sliceNy = slice.space.dim[1]; // = nz (INF_SUP)
    expect(sliceNx).toBe(nx);
    expect(sliceNy).toBe(nz);
    for (let j = 0; j < sliceNy; j++) {
      for (let i = 0; i < sliceNx; i++) {
        // pinned third axis is POST_ANT (source y) = 2.
        expect(sd[j * sliceNx + i]).toBe(i * 100 + 2 * 10 + j);
      }
    }
  });
});
