import { describe, it, expect } from 'vitest';
import {
  NamedAxis,
  AxisSet1D,
  AxisSet2D,
  AxisSet3D,
  matchAxis,
  findAnatomy2D,
  findAnatomy3D,
  oppositeAxis,
  nearestAnatomy,
} from '../src/geometry/Axis';
import { Matrix } from 'ml-matrix';

describe('NamedAxis', () => {
  it('should create a NamedAxis instance correctly', () => {
    const axis = new NamedAxis('TEST_AXIS', [1, 0, 0]);
    expect(axis.name).toBe('TEST_AXIS');
    expect(axis.direction).toEqual([1, 0, 0]);
    expect(axis.axis).toBe('TEST_AXIS');
  });

  it('should correctly compare two NamedAxis instances', () => {
    const axis1 = new NamedAxis('AXIS', [1, 0, 0]);
    const axis2 = new NamedAxis('AXIS', [1, 0, 0]);
    const axis3 = new NamedAxis('AXIS', [-1, 0, 0]);
    expect(axis1.equals(axis2)).toBe(true);
    expect(axis1.equals(axis3)).toBe(false);
  });

  it('toString should return the correct string representation', () => {
    const axis = new NamedAxis('TEST_AXIS', [1, 2, 3]);
    expect(axis.toString()).toBe('NamedAxis: TEST_AXIS (direction: [1, 2, 3])');
  });
});

describe('AxisSet1D', () => {
  it('should create an AxisSet1D instance correctly', () => {
    const axisSet = new AxisSet1D(NamedAxis.LEFT_RIGHT);
    expect(axisSet.ndim).toBe(1);
    expect(axisSet.i).toBe(NamedAxis.LEFT_RIGHT);
    expect(axisSet.axes()).toEqual([NamedAxis.LEFT_RIGHT]);
  });

  it('should return the correct permutation matrix', () => {
    const axisSet = new AxisSet1D(NamedAxis.ANT_POST);
    const permMat = axisSet.perm_mat();
    expect(permMat).toEqual(new Matrix([axisSet.i.direction]));
  });

  it('dropDim should return null for AxisSet1D', () => {
    const axisSet = new AxisSet1D(NamedAxis.INF_SUP);
    expect(axisSet.dropDim()).toBeNull();
  });

  it('toString should return the correct string representation', () => {
    const axisSet = new AxisSet1D(NamedAxis.SUP_INF);
    expect(axisSet.toString()).toBe('AxisSet1D: SUP_INF');
  });
});

describe('AxisSet2D', () => {
  it('should create an AxisSet2D instance correctly', () => {
    const axisSet = new AxisSet2D(NamedAxis.LEFT_RIGHT, NamedAxis.INF_SUP);
    expect(axisSet.ndim).toBe(2);
    expect(axisSet.i).toBe(NamedAxis.LEFT_RIGHT);
    expect(axisSet.j).toBe(NamedAxis.INF_SUP);
    expect(axisSet.axes()).toEqual([NamedAxis.LEFT_RIGHT, NamedAxis.INF_SUP]);
  });

  it('should return the correct permutation matrix', () => {
    const axisSet = new AxisSet2D(NamedAxis.POST_ANT, NamedAxis.SUP_INF);
    const permMat = axisSet.perm_mat();
    expect(permMat).toEqual(new Matrix([axisSet.i.direction, axisSet.j.direction]));
  });

  it('dropDim should return an AxisSet1D instance', () => {
    const axisSet = new AxisSet2D(NamedAxis.ANT_POST, NamedAxis.POST_ANT);
    const dropped = axisSet.dropDim();
    expect(dropped).toBeInstanceOf(AxisSet1D);
    expect(dropped).toEqual(new AxisSet1D(NamedAxis.ANT_POST));
  });


  it('should correctly match anatomical 2D orientations', () => {
    const matched = findAnatomy2D('L', 'P');
    expect(matched).toBe(AxisSet2D.AXIAL_LP);
  });
});

describe('AxisSet3D', () => {
  it('should create an AxisSet3D instance correctly', () => {
    const axisSet = new AxisSet3D(
      NamedAxis.ANT_POST,
      NamedAxis.INF_SUP,
      NamedAxis.LEFT_RIGHT
    );
    expect(axisSet.ndim).toBe(3);
    expect(axisSet.i).toBe(NamedAxis.ANT_POST);
    expect(axisSet.j).toBe(NamedAxis.INF_SUP);
    expect(axisSet.k).toBe(NamedAxis.LEFT_RIGHT);
    expect(axisSet.axes()).toEqual([
      NamedAxis.ANT_POST,
      NamedAxis.INF_SUP,
      NamedAxis.LEFT_RIGHT,
    ]);
  });

  it('should return the correct permutation matrix', () => {
    const axisSet = new AxisSet3D(
      NamedAxis.POST_ANT,
      NamedAxis.SUP_INF,
      NamedAxis.RIGHT_LEFT
    );
    const permMat = axisSet.perm_mat();
    expect(permMat).toEqual(
      new Matrix([
        axisSet.i.direction,
        axisSet.j.direction,
        axisSet.k.direction,
      ])
    );
  });

  it('dropDim should return an AxisSet2D instance', () => {
    const axisSet = new AxisSet3D(
      NamedAxis.INF_SUP,
      NamedAxis.POST_ANT,
      NamedAxis.RIGHT_LEFT
    );
    const dropped = axisSet.dropDim();
    expect(dropped).toBeInstanceOf(AxisSet2D);
    expect(dropped).toEqual(
      new AxisSet2D(NamedAxis.INF_SUP, NamedAxis.POST_ANT)
    );
  });


  it('should correctly match anatomical 3D orientations', () => {
    const matched = findAnatomy3D('L', 'P', 'I');
    expect(matched).toBe(AxisSet3D.AXIAL_LPI);
  });
});

describe('Utility Functions', () => {
  it('matchAxis should correctly match axis strings to NamedAxis', () => {
    expect(matchAxis('L')).toBe(NamedAxis.LEFT_RIGHT);
    expect(matchAxis('a')).toBe(NamedAxis.ANT_POST);
    expect(() => matchAxis('Unknown')).toThrow('Unknown axis: Unknown');
  });

  it('oppositeAxis should return the correct opposite axis', () => {
    expect(oppositeAxis(NamedAxis.LEFT_RIGHT)).toBe(NamedAxis.RIGHT_LEFT);
    expect(oppositeAxis(NamedAxis.POST_ANT)).toBe(NamedAxis.ANT_POST);
    expect(() => oppositeAxis({} as NamedAxis)).toThrow('Unknown axis: [object Object]');
  });

  it('nearestAnatomy should return the closest AxisSet3D for a given matrix', () => {
    const mat = new Matrix([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);
    
    const nearest = nearestAnatomy(mat);
    expect(nearest).toEqual(
      new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      )
    );
  });
});
