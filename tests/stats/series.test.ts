import { describe, it, expect } from 'vitest';
import { series, scaleSeries } from '../../src/stats/stats';
import { Float32NeuroVec } from '../../src/vec/NeuroVec';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';

describe('series', () => {
  const dimX = 4, dimY = 4, dimZ = 4, dimT = 10;
  const space = new NeuroSpace([dimX, dimY, dimZ, dimT], [1, 1, 1, 1], [0, 0, 0, 0]);
  const spatialSize = dimX * dimY * dimZ;
  let vec: Float32NeuroVec;

  function makeVec(): Float32NeuroVec {
    const data = new Float32Array(spatialSize * dimT);
    // Each voxel's time-series is just t + voxelIndex * 0.01
    for (let vox = 0; vox < spatialSize; vox++) {
      for (let t = 0; t < dimT; t++) {
        data[vox + t * spatialSize] = t + vox * 0.01;
      }
    }
    return new Float32NeuroVec(space, data);
  }

  it('extracts time-series at single coordinate', () => {
    vec = makeVec();
    const result = series(vec, [[0, 0, 0]]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(dimT);
    for (let t = 0; t < dimT; t++) {
      expect(result[0][t]).toBeCloseTo(t);
    }
  });

  it('extracts time-series at multiple coordinates', () => {
    vec = makeVec();
    const result = series(vec, [[0, 0, 0], [1, 0, 0]]);
    expect(result).toHaveLength(2);
    // vox 0 series: [0, 1, 2, ...]
    expect(result[0][0]).toBeCloseTo(0);
    // vox 1 series: [0.01, 1.01, 2.01, ...]
    expect(result[1][0]).toBeCloseTo(0.01);
  });
});

describe('scaleSeries', () => {
  const dimX = 3, dimY = 3, dimZ = 3, dimT = 20;
  const space = new NeuroSpace([dimX, dimY, dimZ, dimT], [1, 1, 1, 1], [0, 0, 0, 0]);
  const spatialSize = dimX * dimY * dimZ;

  function makeVec(): Float32NeuroVec {
    const data = new Float32Array(spatialSize * dimT);
    for (let vox = 0; vox < spatialSize; vox++) {
      for (let t = 0; t < dimT; t++) {
        data[vox + t * spatialSize] = 100 + (vox + 1) * t;
      }
    }
    return new Float32NeuroVec(space, data);
  }

  it('zscore produces zero mean and unit variance', () => {
    const vec = makeVec();
    const scaled = scaleSeries(vec, 'zscore');

    // Check first voxel
    let sum = 0;
    for (let t = 0; t < dimT; t++) {
      sum += scaled.getAt(0, 0, 0, t);
    }
    expect(sum / dimT).toBeCloseTo(0, 4);

    // Check variance ~ 1
    const mean = sum / dimT;
    let ss = 0;
    for (let t = 0; t < dimT; t++) {
      const v = scaled.getAt(0, 0, 0, t) - mean;
      ss += v * v;
    }
    const sd = Math.sqrt(ss / (dimT - 1));
    expect(sd).toBeCloseTo(1, 2);
  });

  it('mean-center produces zero mean', () => {
    const vec = makeVec();
    const scaled = scaleSeries(vec, 'mean-center');

    let sum = 0;
    for (let t = 0; t < dimT; t++) {
      sum += scaled.getAt(1, 1, 1, t);
    }
    expect(sum / dimT).toBeCloseTo(0, 4);
  });

  it('psc produces percent signal change', () => {
    const vec = makeVec();
    const scaled = scaleSeries(vec, 'psc');

    // Mean of scaled should be ~0 (mean subtracted then /mean *100)
    let sum = 0;
    for (let t = 0; t < dimT; t++) {
      sum += scaled.getAt(0, 0, 0, t);
    }
    expect(sum / dimT).toBeCloseTo(0, 3);
  });

  it('preserves space and dimensions', () => {
    const vec = makeVec();
    const scaled = scaleSeries(vec, 'zscore');
    expect(scaled.dim).toEqual(vec.dim);
    expect(scaled.spacing).toEqual(vec.spacing);
  });
});
