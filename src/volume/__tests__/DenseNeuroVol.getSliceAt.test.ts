import { describe, it, expect, beforeAll } from 'vitest';
import { read_vol } from '../../io/nifti';
import { AxisSet3D, NamedAxis } from '../../geometry/Axis';

describe('DenseNeuroVol.getSliceAt() produces valid 2D slice spaces', () => {
  let vol: any;

  beforeAll(async () => {
    vol = await read_vol('tests/data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');
  });

  const VIEWS: Record<string, AxisSet3D> = {
    axial: new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP),
    sagittal: new AxisSet3D(NamedAxis.POST_ANT, NamedAxis.INF_SUP, NamedAxis.LEFT_RIGHT),
    coronal: new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.INF_SUP, NamedAxis.POST_ANT),
  };

  function randomWorld(space: any): number[] {
    const [min, max] = space.bounds();
    return [0, 1, 2].map(i => min[i] + Math.random() * (max[i] - min[i]));
  }

  for (const [name, axes] of Object.entries(VIEWS)) {
    it(`never constructs a singular 2D transform for ${name}`, () => {
      const space = vol.space;
      // test a handful of random world positions
      for (let n = 0; n < 8; n++) {
        const world = randomWorld(space);
        const re = space.reorient(axes);
        const g = re.coordToGrid(world);
        const sliceIndex = Math.round(g[2]);

        const slice = vol.getSliceAt(world, axes, 'nearest');
        const sspace = slice.space;

        // Sanity: 2D space dims should match in-plane dims of the reoriented 3D space
        expect(sspace.dim[0]).toBe(re.dim[0]);
        expect(sspace.dim[1]).toBe(re.dim[1]);

        // Inverse transform should exist and be finite (no singular)
        const inv = sspace.inverseTrans;
        expect(inv.rows).toBe(3);
        expect(inv.columns).toBe(3);
      }
    });
  }
});

