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
import { NeuroSpace } from '../src/geometry/NeuroSpace';

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

describe('nearestAnatomy with non-orthogonal (sheared) affines', () => {
  const RAS = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);
  const shearedRas = () => [
    [2, -0.5, 0.3, 10],
    [0.2, 2, -0.4, 20],
    [-0.1, 0.6, 3, 30],
    [0, 0, 0, 1],
  ];

  it('does not modify the input matrix', () => {
    const mat = new Matrix(shearedRas());
    nearestAnatomy(mat);
    expect(mat.to2DArray()).toEqual(shearedRas());
  });

  it('reports RAS for a sheared RAS-like affine whose j column has a negative x component', () => {
    // Before the fix, orthogonalize() scaled the i column in place by
    // dot(i, j) = -0.5, flipping it and reporting LAS.
    const mat = new Matrix([
      [2, -0.5, 0, 0],
      [0, 2, 0, 0],
      [0, 0, 2, 0],
      [0, 0, 0, 1],
    ]);
    expect(nearestAnatomy(mat)).toEqual(RAS);
  });

  it('reports RAS for a generally sheared, anisotropic RAS-like affine', () => {
    expect(nearestAnatomy(new Matrix(shearedRas()))).toEqual(RAS);
  });

  it('gives a NeuroSpace built from a sheared RAS-like affine RAS axes', () => {
    const trans = [
      [2, -0.5, 0, 0],
      [0, 2, 0, 0],
      [0, 0, 2, 0],
      [0, 0, 0, 1],
    ];
    const space = new NeuroSpace([4, 4, 4], undefined, undefined, undefined, trans);
    expect(space.axes).toEqual(RAS);
  });

  it('reports LPS for a sheared LPS-like affine', () => {
    const mat = new Matrix([
      [-2, 0.5, 0, 0],
      [0, -2, 0.3, 0],
      [0, -0.4, 2, 0],
      [0, 0, 0, 1],
    ]);
    expect(nearestAnatomy(mat)).toEqual(
      new AxisSet3D(NamedAxis.RIGHT_LEFT, NamedAxis.ANT_POST, NamedAxis.INF_SUP)
    );
  });

  it('handles a permuted (coronal-stored) sheared affine', () => {
    // i -> +x (R), j -> +z (S), k -> -y (P), with shear.
    const mat = new Matrix([
      [1, -0.3, 0, 0],
      [0, 0, -1, 0],
      [0, 1, 0.2, 0],
      [0, 0, 0, 1],
    ]);
    expect(nearestAnatomy(mat)).toEqual(
      new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.INF_SUP, NamedAxis.ANT_POST)
    );
  });
});

describe('nearestAnatomy degenerate columns', () => {
  it('takes k = i x j (right-handed) when the k column is zero', () => {
    // i -> -x (L), j -> +y (A); i x j = -z, so k -> I.
    const mat = new Matrix([
      [-2, 0, 0, 0],
      [0, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ]);
    expect(nearestAnatomy(mat)).toEqual(
      new AxisSet3D(NamedAxis.RIGHT_LEFT, NamedAxis.POST_ANT, NamedAxis.SUP_INF)
    );
  });

  it('takes k = i x j when the k column lies in the i-j plane', () => {
    const mat = new Matrix([
      [2, 0, 1, 0],
      [0, 2, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ]);
    expect(nearestAnatomy(mat)).toEqual(
      new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
    );
  });

  it.each([
    ['i is zero', [[0, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]]],
    ['j is zero', [[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]]],
    ['j is parallel to i', [[2, -4, 0, 0], [0, 0, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]]],
  ])('throws when %s', (_label, values) => {
    expect(() => nearestAnatomy(new Matrix(values))).toThrow('Invalid matrix input, columns are degenerate');
  });
});
