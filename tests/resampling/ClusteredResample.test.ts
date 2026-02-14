import { describe, it, expect } from 'vitest';
import { Resampler } from '../../src/resampling/Resampler';
import { ClusteredNeuroVol } from '../../src/volume/ClusteredNeuroVol';
import { LogicalNeuroVol } from '../../src/volume/LogicalNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';

describe('resampleClustered', () => {
  function makeClusteredVol(
    dim: [number, number, number],
    spacing: [number, number, number]
  ): ClusteredNeuroVol {
    const space = new NeuroSpace(dim, spacing, [0, 0, 0]);
    const n = dim[0] * dim[1] * dim[2];
    const maskData = new Uint8Array(n);
    const clusterIds: number[] = [];

    // Two clusters: lower half = cluster 1, upper half = cluster 2
    for (let k = 0; k < dim[2]; k++) {
      for (let j = 0; j < dim[1]; j++) {
        for (let i = 0; i < dim[0]; i++) {
          const idx = i + j * dim[0] + k * dim[0] * dim[1];
          if (i < dim[0] / 2) {
            maskData[idx] = 1;
            clusterIds.push(1);
          } else {
            maskData[idx] = 1;
            clusterIds.push(2);
          }
        }
      }
    }

    const mask = new LogicalNeuroVol(space, maskData);
    return new ClusteredNeuroVol(mask, new Int32Array(clusterIds), {
      'Left': 1,
      'Right': 2,
    });
  }

  it('resampling to same space preserves labels', () => {
    const src = makeClusteredVol([8, 8, 8], [1, 1, 1]);
    const result = Resampler.resampleClustered(src, src.space);

    // Every voxel should have the same cluster assignment
    const srcData = src.getData();
    const resData = result.getData();
    for (let i = 0; i < srcData.length; i++) {
      expect(resData[i]).toBe(srcData[i]);
    }
  });

  it('resampling to coarser space preserves two clusters', () => {
    const src = makeClusteredVol([10, 10, 10], [1, 1, 1]);
    const targetSpace = new NeuroSpace([5, 5, 5], [2, 2, 2], [0, 0, 0]);
    const result = Resampler.resampleClustered(src, targetSpace);

    expect(result.numClusters()).toBe(2);
    expect(result.dim).toEqual([5, 5, 5]);
  });

  it('label map is filtered to surviving labels', () => {
    const src = makeClusteredVol([8, 8, 8], [1, 1, 1]);
    const result = Resampler.resampleClustered(src, src.space);

    // Both labels survive
    expect(result.labelMap['Left']).toBe(1);
    expect(result.labelMap['Right']).toBe(2);
  });

  it('preserves integer labels (no interpolation artifacts)', () => {
    const src = makeClusteredVol([8, 8, 8], [1, 1, 1]);
    const targetSpace = new NeuroSpace([16, 16, 16], [0.5, 0.5, 0.5], [0, 0, 0]);
    const result = Resampler.resampleClustered(src, targetSpace);

    const data = result.getData();
    for (let i = 0; i < data.length; i++) {
      // Only 0, 1, or 2 allowed
      expect([0, 1, 2]).toContain(data[i]);
    }
  });
});
