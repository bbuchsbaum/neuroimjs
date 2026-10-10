import { describe, it, expect } from 'vitest';
import { VolumeAtlas } from 'neuroatlasjs';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol, Int32NeuroVol, Float64NeuroVol } from '../src/volume/DenseNeuroVol';
import { VolumeSet } from '../src/volumeset/VolumeSet';

/**
 * Dogfood check: neuroatlasjs (devDependency, pinned GitHub commit) accepts this repository's own
 * NeuroSpace / NeuroVol classes and reduces a volume-set map per parcel, matching a hand computation.
 */
describe('neuroatlasjs with in-repo neuroimjs volumes', () => {
  // Anisotropic, translated grid like the synthetic demo data.
  const space = new NeuroSpace([4, 3, 2], [3, 2.5, 3.5], [-6, -4, -3]);
  const n = 24;
  // Parcel 5 on the left half (i < 2), parcel 9 on the right; one background voxel.
  const labels = Int32Array.from({ length: n }, (_, g) => (g === 0 ? 0 : g % 4 < 2 ? 5 : 9));
  const atlas = new VolumeAtlas({
    name: 'test parcels',
    volume: new Int32NeuroVol(space, labels),
    regions: [
      { id: 5, label: 'A', hemisphere: 'left' },
      { id: 9, label: 'B', hemisphere: 'right' },
    ],
  });

  it('builds an atlas on a NeuroSpace and answers voxel and world lookups', () => {
    expect(atlas.regionAtVoxel([1, 0, 0])?.id).toBe(5);
    expect(atlas.regionAtVoxel([3, 2, 1])?.id).toBe(9);
    expect(atlas.regionAtVoxel([0, 0, 0])).toBeUndefined();
    const world = space.gridToCoord([3, 1, 1]) as number[];
    expect(atlas.regionAtWorld(world as [number, number, number])?.id).toBe(9);
  });

  it('reduces a masked volume-set map per parcel, ignoring voxels outside the set mask', () => {
    const vals = Float32Array.from({ length: n }, (_, g) => (g % 3 === 0 ? 0 : g + 1));
    const set = VolumeSet.fromVolumes([new FloatNeuroVol(space, vals)], [{ subject: 'a' }]);
    // Expand the masked vector to the grid (NaN outside the set mask), as the demo does.
    const grid = new Float32Array(n).fill(NaN);
    set.maskIndex.forEach((g, m) => (grid[g] = set.members[0].values[m]));
    const sums = atlas.reduce(new FloatNeuroVol(space, grid), { statistic: 'sum', nonFinite: 'omit' });
    // Hand computation over in-mask voxels only.
    let a = 0;
    let b = 0;
    for (const g of set.maskIndex) {
      if (labels[g] === 5) a += vals[g];
      else if (labels[g] === 9) b += vals[g];
    }
    expect(sums.get(5)).toBeCloseTo(a, 6);
    expect(sums.get(9)).toBeCloseTo(b, 6);
    // Projection back to a real neuroimjs volume on the same space.
    const back = atlas.mapValues(sums, Float64NeuroVol);
    expect(back.space).toBe(space);
    expect(back.getData()[1]).toBeCloseTo(a, 6);
  });

  it('gives ROI grid indices that map onto set mask positions', () => {
    const roi = atlas.roi({ label: 'B', hemisphere: 'right' }).indices;
    expect(Array.from(roi).every((g) => labels[g] === 9)).toBe(true);
    expect(roi.length).toBe(labels.filter((l) => l === 9).length);
  });
});
