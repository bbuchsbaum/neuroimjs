import { describe, expect, it } from 'vitest';
import { AxisSet3D } from '../../src/geometry/Axis';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import {
  createReviewVecFromVolumes,
  OverlayReviewSession,
  validateOverlayReviewDataset,
} from '../../src/review';
import { Float64NeuroVol, FloatNeuroVol } from '../../src/volume/DenseNeuroVol';

describe('OverlayReviewDataset', () => {
  const space = new NeuroSpace([2, 2, 1], [2, 2, 2], [0, 0, 0], AxisSet3D.AXIAL_LPI);
  const spatialSize = 4;

  function vol(values: number[], volSpace = space): FloatNeuroVol {
    return new FloatNeuroVol(volSpace, Float32Array.from(values));
  }

  it('creates a review vec from volumes while preserving spatial axes', () => {
    const vec = createReviewVecFromVolumes([
      vol([1, 2, 3, 4]),
      vol([5, 6, 7, 8]),
    ]);

    expect(vec.dim).toEqual([2, 2, 1, 2]);
    expect(vec.space.axes.equals(AxisSet3D.AXIAL_LPI)).toBe(true);
    expect(vec.getData()[0]).toBe(1);
    expect(vec.getData()[spatialSize]).toBe(5);
    expect(vec.getVolume(1).space.axes.equals(AxisSet3D.AXIAL_LPI)).toBe(true);
  });

  it('preserves oblique affine geometry through 3D to 4D round trips', () => {
    const affine = [
      [1, 0.2, 0, 10],
      [0, 2, 0.1, 20],
      [0, 0, 3, 30],
      [0, 0, 0, 1],
    ];
    const obliqueSpace = new NeuroSpace(
      [2, 2, 1],
      undefined,
      undefined,
      AxisSet3D.AXIAL_LPI,
      affine
    );
    const vec = createReviewVecFromVolumes([
      vol([1, 2, 3, 4], obliqueSpace),
      vol([5, 6, 7, 8], obliqueSpace),
    ]);

    expect(vec.space.trans.to2DArray()).toEqual(affine);
    expect(vec.getVolume(1).space.trans.to2DArray()).toEqual(affine);
  });

  it('rejects matching dimensions and axes when spacing or origin differs', () => {
    const shifted = new NeuroSpace(
      [2, 2, 1],
      [2, 2, 2],
      [10, 0, 0],
      AxisSet3D.AXIAL_LPI
    );
    const scaled = new NeuroSpace(
      [2, 2, 1],
      [3, 2, 2],
      [0, 0, 0],
      AxisSet3D.AXIAL_LPI
    );

    expect(() => createReviewVecFromVolumes([
      vol([1, 2, 3, 4]),
      vol([5, 6, 7, 8], shifted),
    ])).toThrow(/affine geometry/i);
    expect(() => createReviewVecFromVolumes([
      vol([1, 2, 3, 4]),
      vol([5, 6, 7, 8], scaled),
    ])).toThrow(/affine geometry/i);
  });

  it('retains Float64 source precision', () => {
    const precise = 1 + Number.EPSILON;
    const volume = new Float64NeuroVol(space, new Float64Array([precise, 2, 3, 4]));
    const vec = createReviewVecFromVolumes([volume]);

    expect(vec.getData()).toBeInstanceOf(Float64Array);
    expect(vec.getData()[0]).toBe(precise);
  });

  it('rejects volume axis mismatch during review vec creation', () => {
    const otherSpace = new NeuroSpace([2, 2, 1], [2, 2, 2], [0, 0, 0], AxisSet3D.CORONAL_LIP);

    expect(() => createReviewVecFromVolumes([
      vol([1, 2, 3, 4]),
      vol([5, 6, 7, 8], otherSpace),
    ])).toThrow(/axes/i);
  });

  it('validates datasets and resolves a fixed display range once', () => {
    const template = vol([100, 100, 100, 100]);
    const vec = createReviewVecFromVolumes([
      vol([-1, -2, 3, 4]),
      vol([-10, -20, 30, 40]),
    ]);

    const dataset = validateOverlayReviewDataset({
      template,
      contrasts: [{ id: 'faces', vec }],
    });

    expect(dataset.subjectCount).toBe(2);
    expect(dataset.subjects.map((subject) => subject.id)).toEqual(['subject-1', 'subject-2']);
    expect(dataset.contrasts[0].displayRange).toEqual([-20, 40]);
  });

  it('keeps explicit display range stable across subject swaps', () => {
    const template = vol([100, 100, 100, 100]);
    const vec = createReviewVecFromVolumes([
      vol([-1, -2, 3, 4]),
      vol([-10, -20, 30, 40]),
    ]);

    const session = new OverlayReviewSession({
      template,
      contrasts: [{ id: 'faces', vec, displayRange: [-6, 6] }],
    });

    expect(session.getDisplayRange()).toEqual([-6, 6]);
    expect(session.getSubjectVolume(0).getRange()).toEqual([-2, 4]);
    expect(session.getSubjectVolume(1).getRange()).toEqual([-20, 40]);
    expect(session.getDisplayRange()).toEqual([-6, 6]);
  });

  it('rejects template and contrast geometry mismatch up front', () => {
    const template = vol([100, 100, 100, 100]);
    const otherSpace = new NeuroSpace([2, 2, 1], [2, 2, 2], [0, 0, 0], AxisSet3D.CORONAL_LIP);
    const vec = createReviewVecFromVolumes([
      vol([1, 2, 3, 4], otherSpace),
      vol([5, 6, 7, 8], otherSpace),
    ]);

    expect(() => validateOverlayReviewDataset({
      template,
      contrasts: [{ id: 'faces', vec }],
    })).toThrow(/axes/i);
  });
});
