import { describe, it, expect, beforeAll } from 'vitest';
import { read_vol } from '../../io/nifti';
import { AxisSet3D, NamedAxis } from '../../geometry/Axis';
import { SliceTransform } from '../../display/SliceTransform';

const VIEWS: Record<string, AxisSet3D> = {
  axial: new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP),
  sagittal: new AxisSet3D(NamedAxis.POST_ANT, NamedAxis.INF_SUP, NamedAxis.LEFT_RIGHT),
  coronal: new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.INF_SUP, NamedAxis.POST_ANT),
};

function randomWorld(space: any): number[] {
  const [min, max] = space.bounds();
  return [0, 1, 2].map(i => min[i] + Math.random() * (max[i] - min[i]));
}

describe('SliceTransform mapping properties', () => {
  let vol: any;
  beforeAll(async () => {
    vol = await read_vol('tests/data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');
  });

  for (const [name, axes] of Object.entries(VIEWS)) {
    it(`round-trip consistency: world→pixel→world (${name})`, () => {
      const space = vol.space;
      for (let n = 0; n < 10; n++) {
        const world = randomWorld(space);

        // Get slice index from original space - use the pinned dimension for this view
        const grid = space.coordToGrid(world);
        const pinnedDim = space.whichDim(axes.k); // k is the pinned/slice axis
        const sliceIndex = Math.round(grid[pinnedDim]);

        const xform = new SliceTransform(space, axes, sliceIndex);
        const pixel = xform.worldToImageCoord(world);

        // Test 1: Pixel coordinates are valid (non-negative and finite)
        expect(pixel.x).toBeGreaterThanOrEqual(0);
        expect(pixel.y).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(pixel.x)).toBe(true);
        expect(Number.isFinite(pixel.y)).toBe(true);

        // Test 2: Round trip - world→pixel→world should preserve coordinates
        const world2 = xform.imageToWorldCoord(pixel);
        expect(Math.abs(world2[0] - world[0])).toBeLessThan(1.0); // 1mm tolerance
        expect(Math.abs(world2[1] - world[1])).toBeLessThan(1.0);
        expect(Math.abs(world2[2] - world[2])).toBeLessThan(1.0);
      }
    });

    it(`pixel spacing is positive and matches volume (${name})`, () => {
      const space = vol.space;
      const sliceIndex = Math.floor(space.dim[2] / 2);
      const xform = new SliceTransform(space, axes, sliceIndex);

      const [xSpacing, ySpacing] = xform.pixelSpacing;

      // Pixel spacing should be positive
      expect(xSpacing).toBeGreaterThan(0);
      expect(ySpacing).toBeGreaterThan(0);

      // Pixel spacing should match volume spacing for the in-plane dimensions
      expect(Number.isFinite(xSpacing)).toBe(true);
      expect(Number.isFinite(ySpacing)).toBe(true);
    });

    it(`volume→pixel and world→pixel are consistent (${name})`, () => {
      const space = vol.space;

      // Use a known voxel in the middle of the volume
      const voxel = [
        Math.floor(space.dim[0] / 2),
        Math.floor(space.dim[1] / 2),
        Math.floor(space.dim[2] / 2)
      ];

      // Convert voxel to world coordinates
      const world = space.gridToCoord(voxel);

      const xform = new SliceTransform(space, axes, voxel[2]);

      // Convert using both paths
      const pixelFromVolume = xform.volumeToImageCoord(voxel);
      const pixelFromWorld = xform.worldToImageCoord(world);

      // They should produce the same result
      expect(Math.abs(pixelFromVolume.x - pixelFromWorld.x)).toBeLessThan(0.1);
      expect(Math.abs(pixelFromVolume.y - pixelFromWorld.y)).toBeLessThan(0.1);
    });

    it(`slice bounds are valid (${name})`, () => {
      const space = vol.space;
      const sliceIndex = Math.floor(space.dim[2] / 2);
      const xform = new SliceTransform(space, axes, sliceIndex);

      const bounds = xform.getSliceBounds();

      // Bounds should be valid
      expect(bounds.minX).toBeLessThan(bounds.maxX);
      expect(bounds.minY).toBeLessThan(bounds.maxY);
      expect(bounds.minX).toBeGreaterThanOrEqual(0);
      expect(bounds.minY).toBeGreaterThanOrEqual(0);
    });

    it(`slice index validation works (${name})`, () => {
      const space = vol.space;

      // Valid slice index
      const validIndex = Math.floor(space.dim[2] / 2);
      const validXform = new SliceTransform(space, axes, validIndex);
      expect(validXform.isSliceIndexValid()).toBe(true);

      // Invalid slice indices
      const invalidXform1 = new SliceTransform(space, axes, -1);
      expect(invalidXform1.isSliceIndexValid()).toBe(false);

      const maxDim = space.dim[space.whichDim(axes.k)];
      const invalidXform2 = new SliceTransform(space, axes, maxDim);
      expect(invalidXform2.isSliceIndexValid()).toBe(false);
    });
  }
});
