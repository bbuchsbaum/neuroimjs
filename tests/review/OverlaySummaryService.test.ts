import { describe, expect, it } from 'vitest';
import {
  computeSufficientStats,
  consistencyVolume,
  differenceOfMeansVolume,
  effectVolume,
  meanVolume,
  oneSampleTVolume,
  OverlaySummaryService,
  pairedDifferenceMeanVolume,
  pairedDifferenceTVolume,
  pairedDifferenceVec,
  subtractSubjectFromStats,
  subtractVolumeFromStats,
  welchTVolume,
} from '../../src/review';
import { createReviewVecFromVolumes } from '../../src/review/OverlayReviewDataset';
import { Float64NeuroVol, FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';

describe('OverlaySummaryService', () => {
  const space = new NeuroSpace([2, 2, 1], [1, 1, 1], [0, 0, 0]);

  function vol(values: number[]): FloatNeuroVol {
    return new FloatNeuroVol(space, Float32Array.from(values));
  }

  it('computes per-voxel sufficient stats and derived mean/t/effect maps', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, 2, -1, -2]),
      vol([2, 4, -2, -4]),
      vol([3, 6, -3, -6]),
    ]);
    const stats = computeSufficientStats(vec);

    expect(Array.from(stats.count)).toEqual([3, 3, 3, 3]);
    expect(Array.from(meanVolume(stats).getData())).toEqual([2, 4, -2, -4]);

    const t = oneSampleTVolume(stats).getData();
    expect(t[0]).toBeCloseTo(3.4641, 3);
    expect(t[2]).toBeCloseTo(-3.4641, 3);

    const effect = effectVolume(stats).getData();
    expect(effect[1]).toBeCloseTo(2, 6);
    expect(effect[3]).toBeCloseTo(-2, 6);
  });

  it('computes leave-one-out stats by subtracting a held-out subject volume', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, 10, -1, -10]),
      vol([2, 20, -2, -20]),
      vol([100, 30, -3, -30]),
    ]);
    const stats = computeSufficientStats(vec);
    const loo = subtractVolumeFromStats(stats, vec.getVolume(2));

    expect(Array.from(loo.count)).toEqual([2, 2, 2, 2]);
    const mean = meanVolume(loo).getData();
    [1.5, 15, -1.5, -15].forEach((expected, index) => {
      expect(mean[index]).toBeCloseTo(expected, 12);
    });
  });

  it('updates leave-one-out subject metadata when subtracting by subject index', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, 10, -1, -10]),
      vol([2, 20, -2, -20]),
      vol([100, 30, -3, -30]),
    ]);
    const stats = computeSufficientStats(vec);
    const loo = subtractSubjectFromStats(stats, 2);

    expect(loo.subjectIndices).toEqual([0, 1]);
    expect(loo.n).toBe(2);
    expect(Array.from(loo.count)).toEqual([2, 2, 2, 2]);
    const mean = meanVolume(loo).getData();
    [1.5, 15, -1.5, -15].forEach((expected, index) => {
      expect(mean[index]).toBeCloseTo(expected, 12);
    });
  });

  it('service leave-one-out methods match brute force recomputation', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, 2, 3, 4]),
      vol([2, 4, 6, 8]),
      vol([3, 6, 9, 12]),
    ]);
    const service = new OverlaySummaryService(vec);
    const loo = service.leaveOneOutMean(1).getData();
    const brute = meanVolume(computeSufficientStats(vec, [0, 2])).getData();

    expect(Array.from(loo)).toEqual(Array.from(brute));
  });

  it('service leave-one-out stats drop the held-out subject from metadata', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, 2, 3, 4]),
      vol([2, 4, 6, 8]),
      vol([3, 6, 9, 12]),
    ]);
    const service = new OverlaySummaryService(vec);
    const loo = service.leaveOneOutStats(1);

    expect(loo.subjectIndices).toEqual([0, 2]);
    expect(loo.n).toBe(2);
  });

  it('computes consistency as proportion matching the group sign and cutoff', () => {
    const vec = createReviewVecFromVolumes([
      vol([4, 1, -4, -1]),
      vol([5, 5, -5, 2]),
      vol([-1, 6, -6, -3]),
    ]);

    const consistency = consistencyVolume(vec, { cutoff: 3 }).getData();

    expect(consistency[0]).toBeCloseTo(2 / 3);
    expect(consistency[1]).toBeCloseTo(2 / 3);
    expect(consistency[2]).toBeCloseTo(1);
    expect(consistency[3]).toBeCloseTo(1 / 3);
  });

  it('rejects consistency stats from mismatched sources or subject sets', () => {
    const vec = createReviewVecFromVolumes([
      vol([4, 1, -4, -1]),
      vol([5, 5, -5, 2]),
      vol([-1, 6, -6, -3]),
    ]);
    const other = createReviewVecFromVolumes([
      vol([1, 1, 1, 1]),
      vol([2, 2, 2, 2]),
      vol([3, 3, 3, 3]),
    ]);

    expect(() => {
      consistencyVolume(vec, { cutoff: 3 }, [0, 1, 2], computeSufficientStats(other));
    }).toThrow(/source/);

    expect(() => {
      consistencyVolume(vec, { cutoff: 3 }, [0, 1, 2], computeSufficientStats(vec, [0, 1]));
    }).toThrow(/subject indices/);
  });

  it('computes independent group mean differences and Welch t maps', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, 2, 10, 10]),
      vol([2, 4, 12, 12]),
      vol([5, 8, 4, 4]),
      vol([7, 10, 6, 6]),
    ]);

    const groupA = computeSufficientStats(vec, [0, 1]);
    const groupB = computeSufficientStats(vec, [2, 3]);
    const diff = differenceOfMeansVolume(groupA, groupB).getData();
    const welch = welchTVolume(groupA, groupB).getData();

    expect(Array.from(diff)).toEqual([-4.5, -6, 6, 6]);
    expect(welch[0]).toBeCloseTo(-4.0249, 3);
    expect(welch[2]).toBeCloseTo(4.2426, 3);
  });

  it('computes paired contrast differences and one-sample t maps', () => {
    const contrastA = createReviewVecFromVolumes([
      vol([5, 4, 10, 10]),
      vol([7, 6, 12, 12]),
      vol([9, 10, 14, 16]),
    ]);
    const contrastB = createReviewVecFromVolumes([
      vol([1, 1, 4, 5]),
      vol([2, 2, 6, 7]),
      vol([3, 4, 8, 10]),
    ]);

    const paired = pairedDifferenceVec(contrastA, contrastB);
    expect(Array.from(paired.getVolume(0).getData())).toEqual([4, 3, 6, 5]);
    expect(Array.from(paired.getVolume(2).getData())).toEqual([6, 6, 6, 6]);

    const mean = pairedDifferenceMeanVolume(contrastA, contrastB).getData();
    const t = pairedDifferenceTVolume(contrastA, contrastB).getData();

    expect(mean[0]).toBeCloseTo(5, 6);
    expect(mean[1]).toBeCloseTo(13 / 3, 6);
    expect(t[0]).toBeCloseTo(8.6603, 3);
    expect(t[1]).toBeCloseTo(4.9135, 3);
  });

  it('skips non-finite values in sufficient stats', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, NaN, 3, Infinity]),
      vol([3, 5, NaN, 7]),
    ]);
    const stats = computeSufficientStats(vec);
    const mean = meanVolume(stats).getData();

    expect(Array.from(stats.count)).toEqual([2, 1, 1, 1]);
    expect(mean[0]).toBe(2);
    expect(mean[1]).toBe(5);
    expect(mean[2]).toBe(3);
    expect(mean[3]).toBe(7);
  });

  it('computes stable variance for high-offset low-variance Float64 data', () => {
    const scalarSpace = new NeuroSpace([1, 1, 1]);
    const values = [1e12 + 1, 1e12 + 2, 1e12 + 3, 1e12 + 4];
    const vec = createReviewVecFromVolumes(
      values.map(value => new Float64NeuroVol(scalarSpace, new Float64Array([value])))
    );

    const standardDeviation = new OverlaySummaryService(vec).standardDeviation().getData()[0];
    expect(standardDeviation).toBeCloseTo(Math.sqrt(5 / 3), 10);
  });

  it('keeps standard deviation invariant to a large additive shift', () => {
    const scalarSpace = new NeuroSpace([1, 1, 1]);
    const makeVec = (shift: number) => createReviewVecFromVolumes(
      [1, 2, 4, 8].map(value => (
        new Float64NeuroVol(scalarSpace, new Float64Array([value + shift]))
      ))
    );

    const base = new OverlaySummaryService(makeVec(0)).standardDeviation().getData()[0];
    const shifted = new OverlaySummaryService(makeVec(1e12)).standardDeviation().getData()[0];
    expect(shifted).toBeCloseTo(base, 10);
  });

  it('recomputes by default when the exposed backing array is mutated', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, 1, 1, 1]),
      vol([3, 3, 3, 3]),
    ]);
    const service = new OverlaySummaryService(vec);

    expect(service.mean().getData()[0]).toBe(2);
    vec.getData()[0] = 101;
    expect(service.mean().getData()[0]).toBe(52);
  });

  it('requires explicit immutable-data opt-in before caching stats', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, 1, 1, 1]),
      vol([3, 3, 3, 3]),
    ]);
    const service = new OverlaySummaryService(vec, { cache: 'assume-immutable' });

    const first = service.getStats();
    expect(service.getStats()).toBe(first);
    service.clearCache();
    expect(service.getStats()).not.toBe(first);
  });

  it('rejects paired vectors with different affine geometry', () => {
    const shiftedSpace = new NeuroSpace([2, 2, 1], [1, 1, 1], [10, 0, 0]);
    const a = createReviewVecFromVolumes([vol([1, 2, 3, 4])]);
    const b = createReviewVecFromVolumes([
      new FloatNeuroVol(shiftedSpace, Float32Array.from([1, 2, 3, 4])),
    ]);

    expect(() => pairedDifferenceVec(a, b)).toThrow(/geometry mismatch/);
  });
});
