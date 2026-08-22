import { describe, it, expect } from 'vitest';
import { Matrix, determinant, inverse } from 'ml-matrix';
import {
  NeuroSpace
} from '../src/geometry/NeuroSpace.ts';
import {
  NamedAxis,
  AxisSet1D,
  AxisSet2D,
  AxisSet3D,
  oppositeAxis,
  findAnatomy2D,
  findAnatomy3D,
  nearestAnatomy,
} from '../src/geometry/Axis.js';

describe('NeuroSpace', () => {
  describe('Initialization', () => {
    it('should initialize with default spacing and origin when not provided', () => {
      const dim = [10, 20, 30];
      const ns = new NeuroSpace(dim);

      expect(ns.dim).toEqual([10, 20, 30]);
      expect(ns.spacing).toEqual([1, 1, 1]);
      expect(ns.origin).toEqual([0, 0, 0]);
      expect(ns.ndim()).toBe(3);
      expect(ns.axes).toBeInstanceOf(AxisSet3D);
    });

    it('should initialize with provided spacing and origin', () => {
      const dim = [10, 20, 30];
      const spacing = [0.5, 0.5, 0.5];
      const origin = [5, 5, 5];
      const ns = new NeuroSpace(dim, spacing, origin);

      expect(ns.spacing).toEqual(spacing);
      expect(ns.origin).toEqual(origin);
    });

    it('preserves non-spatial metadata for higher-dimensional spaces', () => {
      const ns = new NeuroSpace(
        [5, 6, 7, 8],
        [1, 2, 3, 0.8],
        [10, 20, 30, 0]
      );

      expect(ns.spacing).toEqual([1, 2, 3, 0.8]);
      expect(ns.origin).toEqual([10, 20, 30, 0]);
      expect(ns.withDimensions([5, 6, 7]).spacing).toEqual([1, 2, 3]);
    });

    it('should throw an error if origin and spacing lengths do not match', () => {
      const dim = [10, 20];
      const spacing = [1, 1, 1];
      const origin = [0, 0];

      expect(() => new NeuroSpace(dim, spacing, origin)).toThrow();
    });

    it('should throw an error if any spacing is non-positive', () => {
      const dim = [10, 20, 30];
      const spacing = [1, -1, 1];
      const origin = [0, 0, 0];

      expect(() => new NeuroSpace(dim, spacing, origin)).toThrow();
    });

    it('should throw an error if any dimension is non-positive', () => {
      const dim = [10, 0, 30];
      const spacing = [1, 1, 1];
      const origin = [0, 0, 0];

      expect(() => new NeuroSpace(dim, spacing, origin)).toThrow();
    });

    it('rejects non-integer, non-finite, and empty dimensions', () => {
      expect(() => new NeuroSpace([])).toThrow(/at least one dimension/);
      expect(() => new NeuroSpace([2, 2.5, 3])).toThrow(/safe integers/);
      expect(() => new NeuroSpace([2, Number.NaN, 3])).toThrow(/safe integers/);
      expect(() => new NeuroSpace([2, Number.POSITIVE_INFINITY, 3])).toThrow(/safe integers/);
    });

    it('rejects malformed or non-finite affine transforms', () => {
      expect(() => new NeuroSpace([2, 2, 2], undefined, undefined, undefined, [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ])).toThrow(/4x4/);

      expect(() => new NeuroSpace([2, 2, 2], undefined, undefined, undefined, [
        [1, 0, 0, 0],
        [0, Number.NaN, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ])).toThrow(/finite 4x4/);
    });
  });

  describe('Dimension Management', () => {
   

    it('should drop a dimension correctly', () => {
      const dim = [10, 20, 30];
      const spacing = [0.5, 1.0, 1.5];
      const origin = [5, 10, 15];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const ns = new NeuroSpace(dim, spacing, origin, axes);
      const newNs = ns.dropDim(); // Drop the second dimension

      expect(newNs?.dim).toEqual([10, 20]);
      expect(newNs?.spacing).toEqual([0.5, 1.0]);
      expect(newNs?.origin).toEqual([5, 10]);
      expect(newNs?.ndim()).toBe(2);
      expect(newNs?.axes).toBeInstanceOf(AxisSet2D);
    });



   
  });

  describe('Dimension Queries', () => {
   

    it('should return the correct spacing', () => {
      const dim = [10, 20, 30];
      const spacing = [0.5, 1.0, 1.5];
      const ns = new NeuroSpace(dim, spacing);
      expect(ns.spacing).toEqual(spacing);
    });
  });

  describe('Coordinate Transformations', () => {
    it('should convert index to grid correctly', () => {
      const dim = [4, 5, 6];
      const ns = new NeuroSpace(dim);
      
      // Test case 1: index 0
      const index1 = 0;
      const grid1 = ns.indexToGrid(index1);
      expect(grid1).toEqual([0, 0, 0]);

      // Test case 2: index 25
      const index2 = 25;
      const grid2 = ns.indexToGrid(index2);
      expect(grid2).toEqual([1, 1, 1]);
      
      // Test case 3: index 43 (1 + 2*4 + 5*4*5)
      const index3 = 1 + 2*4 + 5*4*5;
      const grid3 = ns.indexToGrid(index3);
      expect(grid3).toEqual([1, 2, 5]);
    });

    it('should convert grid to index correctly', () => {
      const dim = [4, 5, 6];
      const ns = new NeuroSpace(dim);
      
      // Test case 1: [0, 0, 0]
      const grid1 = [0, 0, 0];
      const index1 = ns.gridToIndex(grid1);
      expect(index1).toBe(0);

      // Test case 2: [1, 0, 5]
      const grid2 = [1, 0, 5];
      const index2 = ns.gridToIndex(grid2);
      expect(index2).toBe(1 + 0*4 + 5*4*5);  // 101

      // Test case 3: [3, 4, 2]
      const grid3 = [3, 4, 2];
      const index3 = ns.gridToIndex(grid3);
      expect(index3).toBe(3 + 4*4 + 2*4*5);  // 43
    });

    it('should convert index to coordinates correctly', () => {
      const dim = [10, 10, 10];
      const spacing = [1, 2, 3];
      const origin = [0, 0, 0];
      const ns = new NeuroSpace(dim, spacing, origin);

      const index = 123;
      const coords = ns.indexToCoord(index);
      const grid = ns.indexToGrid(index);
      const expected = grid.map((g, i) => g * spacing[i] + origin[i]);
      expect(coords).toEqual(expected);
    });

    it('should convert coordinates to index correctly', () => {
      const dim = [10, 10, 10];
      const spacing = [1, 2, 3];
      const origin = [0, 0, 0];
      const ns = new NeuroSpace(dim, spacing, origin);

      const coords = [5, 10, 15];
      const index = ns.coordToIndex(coords);
      const expectedGrid = [5, 5, 5]; // (5 - 0)/1, (10 - 0)/2, (15 - 0)/3
      expect(ns.indexToGrid(index)).toEqual(expectedGrid);
    });

    it('should convert grid to coordinates correctly for 3D NeuroSpace', () => {
      const dim = [10, 10, 10];
      const spacing = [1, 2, 3];
      const origin = [0, 0, 0];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const ns = new NeuroSpace(dim, spacing, origin, axes);

      const grid = [5, 5, 5];
      const expectedCoords = [
        grid[0] * spacing[0] + origin[0],                // 5 * 1 + 0 = 5
        grid[1] * spacing[1] * -1 + origin[1],          // 5 * 2 * (-1) + 0 = -10
        grid[2] * spacing[2] + origin[2],               // 5 * 3 + 0 = 15
      ];
      const coords = ns.gridToCoord(grid);

      expect(coords).toEqual(expectedCoords); // [5, -10, 15]
    });

    it('should convert grid to coordinates correctly for 2D NeuroSpace', () => {
      const dim = [10, 10];
      const spacing = [1.5, 2.5];
      const origin = [1, 1];
      const axes = new AxisSet2D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST
      );
      const ns = new NeuroSpace(dim, spacing, origin, axes);

      const grid = [4, 6];
      const expectedCoords = [
        grid[0] * spacing[0] + origin[0],               // 4 * 1.5 + 1 = 7
        grid[1] * spacing[1] * -1 + origin[1],          // 6 * 2.5 * (-1) + 1 = -14
      ];
      const coords = ns.gridToCoord(grid);

      expect(coords).toEqual(expectedCoords); // [7, -14]
    });
  });

  describe('Centroid Calculation', () => {
    it('should calculate the centroid correctly', () => {
      const dim = [10, 20, 30];
      const spacing = [1, 2, 3];
      const origin = [0, 0, 0];
      const ns = new NeuroSpace(dim, spacing, origin);
      const centroid = ns.centroid();

      const expected = [
        ((0 * 1) + ((10 - 1) * 1)) / 2, // (0 + 9)/2 = 4.5
        ((0 * 2) + ((20 - 1) * 2)) / 2, // (0 + 38)/2 = 19
        ((0 * 3) + ((30 - 1) * 3)) / 2, // (0 + 87)/2 = 43.5
      ];

      expect(centroid).toEqual(expected);
    });
  });

  describe('Axis Queries', () => {
    it('should return the correct dimension of a given axis', () => {
      const dim = [10, 20, 30];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const ns = new NeuroSpace(dim, undefined, undefined, axes);

      expect(ns.dimOf(NamedAxis.LEFT_RIGHT)).toBe(10);
      expect(ns.dimOf(NamedAxis.ANT_POST)).toBe(20);
      expect(ns.dimOf(NamedAxis.INF_SUP)).toBe(30);
    });

    it('should identify the correct dimension index for a given axis', () => {
      const dim = [10, 20, 30];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const ns = new NeuroSpace(dim, undefined, undefined, axes);

      expect(ns.whichDim(NamedAxis.LEFT_RIGHT)).toBe(0);
      expect(ns.whichDim(NamedAxis.ANT_POST)).toBe(1);
      expect(ns.whichDim(NamedAxis.INF_SUP)).toBe(2);
    });
  });

  describe('Encapsulation & affine-derived spacing', () => {
    it('copies dimension inputs and does not expose mutable affine state', () => {
      const dims = [4, 5, 6];
      const affine = [
        [1, 0.2, 0, 10],
        [0, 2, 0, 20],
        [0, 0, 3, 30],
        [0, 0, 0, 1],
      ];
      const ns = new NeuroSpace(dims, undefined, undefined, undefined, affine);

      dims[0] = 99;
      affine[0][0] = 99;
      const leakedForward = ns.trans;
      const leakedInverse = ns.inverseTrans;
      leakedForward.set(0, 0, 77);
      leakedInverse.set(0, 0, 77);

      expect(ns.dim).toEqual([4, 5, 6]);
      expect(ns.gridToCoord([1, 0, 0])).toEqual([11, 20, 30]);
      expect(ns.coordToGrid([11, 20, 30])).toEqual([1, 0, 0]);
    });

    it('preserves the complete affine when changing 3D/4D logical dimensions', () => {
      const affine = [
        [1, 0.2, 0, 10],
        [0, 2, 0.1, 20],
        [0, 0, 3, 30],
        [0, 0, 0, 1],
      ];
      const volumeSpace = new NeuroSpace([4, 5, 6], undefined, undefined, undefined, affine);
      const vectorSpace = volumeSpace.withDimensions([4, 5, 6, 8]);
      const recovered = vectorSpace.withDimensions([4, 5, 6]);

      expect(vectorSpace.trans.to2DArray()).toEqual(affine);
      expect(recovered.trans.to2DArray()).toEqual(affine);
      expect(recovered.isSpatiallyCompatibleWith(volumeSpace)).toBe(true);
    });

    it('distinguishes spaces with different origins, scales, or obliquity', () => {
      const reference = new NeuroSpace([4, 5, 6], [1, 1, 1], [0, 0, 0]);
      const shifted = new NeuroSpace([4, 5, 6], [1, 1, 1], [10, 0, 0]);
      const scaled = new NeuroSpace([4, 5, 6], [2, 1, 1], [0, 0, 0]);
      const oblique = new NeuroSpace([4, 5, 6], undefined, undefined, undefined, [
        [1, 0.2, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ]);

      expect(reference.isSpatiallyCompatibleWith(shifted)).toBe(false);
      expect(reference.isSpatiallyCompatibleWith(scaled)).toBe(false);
      expect(reference.isSpatiallyCompatibleWith(oblique)).toBe(false);
    });

    it('does not let callers mutate the space via origin/spacing getters', () => {
      const ns = new NeuroSpace([4, 5, 6], [2, 2.5, 3], [10, 20, 30]);
      // Mutating the returned arrays must not affect the space.
      ns.origin[0] = 999;
      ns.spacing[1] = 999;
      ns.getOrigin()[2] = 999;
      expect(ns.origin).toEqual([10, 20, 30]);
      expect(ns.spacing).toEqual([2, 2.5, 3]);
      expect(ns.getOrigin()).toEqual([10, 20, 30]);
    });

    it('derives spacing from the affine column norms when not provided', () => {
      // Affine with scales [2,3,4] on the diagonal and a translation.
      const affine = [
        [2, 0, 0, 5],
        [0, 3, 0, 6],
        [0, 0, 4, 7],
        [0, 0, 0, 1],
      ];
      const ns = new NeuroSpace(
        [4, 4, 4],
        undefined,
        undefined,
        undefined,
        affine
      );
      expect(ns.spacing[0]).toBeCloseTo(2, 6);
      expect(ns.spacing[1]).toBeCloseTo(3, 6);
      expect(ns.spacing[2]).toBeCloseTo(4, 6);
      expect(ns.origin).toEqual([5, 6, 7]);
    });
  });

  describe('Reorientation', () => {
    it('should reorient the NeuroSpace correctly for 3D', () => {
      const dim = [10, 20, 30];
      const spacing = [1, 2, 3];
      const origin = [0, 0, 0];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const ns = new NeuroSpace(dim, spacing, origin, axes);

      const newOrientation = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.INF_SUP,
        NamedAxis.ANT_POST
      );

      const reorientedNs = ns.reorient(newOrientation);
      console.log('Reoriented axes:', reorientedNs.axes);

      const ax = reorientedNs.axes.axes();
      expect(ax[0]).toEqual(NamedAxis.LEFT_RIGHT);
      expect(ax[1]).toEqual(NamedAxis.INF_SUP);
      expect(ax[2]).toEqual(NamedAxis.ANT_POST);

      // Verify the new spacing and origin
      expect(reorientedNs.spacing).toEqual([1, 3, 2]); // Original spacing reordered
      expect(reorientedNs.origin).toEqual([0, 0, 0]);  // Original origin reordered
    });

    it('should reorient the NeuroSpace correctly from LPI to AIL', () => {
      const dim = [10, 20, 30];
      const spacing = [1, 2, 3];
      const origin = [0, 0, 0];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const ns = new NeuroSpace(dim, spacing, origin, axes);

      const newOrientation = new AxisSet3D(
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP,
        NamedAxis.LEFT_RIGHT
      );

      const reorientedNs = ns.reorient(newOrientation);

      const ax = reorientedNs.axes.axes();
      expect(ax[0]).toEqual(NamedAxis.ANT_POST);
      expect(ax[1]).toEqual(NamedAxis.INF_SUP);
      expect(ax[2]).toEqual(NamedAxis.LEFT_RIGHT);

      // Verify the new spacing and origin
      expect(reorientedNs.spacing).toEqual([2, 3, 1]); // Reordered spacing
      // World-preserving origin: new voxel (0,0,0) corresponds to old voxel
      // (0,19,0), whose world coord is [0, 2*19, 0] = [0, 38, 0]. The flip offset
      // belongs to the WORLD y-axis, not the new frame's x slot.
      expect(reorientedNs.origin[0]).toBeCloseTo(0, 6);
      expect(reorientedNs.origin[1]).toBeCloseTo(38, 6);
      expect(reorientedNs.origin[2]).toBeCloseTo(0, 6);

      // Verify dimensions
      expect(reorientedNs.dim).toEqual([20, 30, 10]); // Reordered dimensions
    });

    it('preserves every voxel world coordinate under reorientation (invariant)', () => {
      // Anisotropic spacing + nonzero origin + an axis flip — the hard case.
      const dim = [10, 20, 30];
      const spacing = [1, 2, 3];
      const origin = [5, 6, 7];
      const ns = new NeuroSpace(
        dim,
        spacing,
        origin,
        new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
      );
      const reoriented = ns.reorient(
        new AxisSet3D(NamedAxis.ANT_POST, NamedAxis.INF_SUP, NamedAxis.LEFT_RIGHT)
      );

      // The multiset of world coordinates over the 8 grid corners must be
      // identical: reorientation relabels axes but cannot move physical points.
      const cornersWorld = (s: NeuroSpace): string[] => {
        const out: string[] = [];
        const d = s.dim;
        for (const i of [0, d[0] - 1])
          for (const j of [0, d[1] - 1])
            for (const k of [0, d[2] - 1]) {
              const w = s.gridToCoord([i, j, k]).map((v) => Math.round(v * 1e6) / 1e6);
              out.push(w.join(','));
            }
        return out.sort();
      };

      expect(cornersWorld(reoriented)).toEqual(cornersWorld(ns));
    });

    it('should throw an error when reorienting to incompatible axes', () => {
      const dim = [10, 20, 30];
      const ns = new NeuroSpace(dim);

      // Create an invalid orientation with an unknown axis
      const invalidAxis = new NamedAxis('UNKNOWN_AXIS', [0, 0, 0]);
      const invalidOrientation = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        invalidAxis
      );

      expect(() => ns.reorient(invalidOrientation)).toThrow();
    });
  });

  describe('Compatibility Check', () => {
    it('should confirm compatibility between NeuroSpaces with same axes', () => {
      const dim1 = [10, 20, 30];
      const dim2 = [40, 50, 60];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const ns1 = new NeuroSpace(dim1, undefined, undefined, axes);
      const ns2 = new NeuroSpace(dim2, undefined, undefined, axes);

      expect(ns1.isCompatibleWith(ns2)).toBe(true);
    });

    it('should confirm compatibility between NeuroSpaces with opposite axes', () => {
      const dim1 = [10, 20, 30];
      const dim2 = [10, 20, 30];
      const axes1 = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const axes2 = new AxisSet3D(
        NamedAxis.RIGHT_LEFT, // Opposite of LEFT_RIGHT
        NamedAxis.POST_ANT,  // Opposite of ANT_POST
        NamedAxis.SUP_INF    // Opposite of INF_SUP
      );
      const ns1 = new NeuroSpace(dim1, undefined, undefined, axes1);
      const ns2 = new NeuroSpace(dim2, undefined, undefined, axes2);

      expect(ns1.isCompatibleWith(ns2)).toBe(true);
    });

  });

  describe('Transformation Matrices', () => {
    it('should compute the correct transformation matrix to another NeuroSpace', () => {
      const dim1 = [10, 20, 30];
      const axes1 = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const ns1 = new NeuroSpace(dim1, undefined, undefined, axes1);

      const dim2 = [30, 20, 10];
      const axes2 = new AxisSet3D(
        NamedAxis.INF_SUP,
        NamedAxis.ANT_POST,
        NamedAxis.LEFT_RIGHT
      );
      const ns2 = new NeuroSpace(dim2, undefined, undefined, axes2);

      const transformationMatrix = ns1.getTransformationMatrixTo(ns2);

      // Expected transformation based on axis permutation: i -> k, j -> j, k -> i
      const expectedMatrix = Matrix.zeros(4, 4); // 3D space + homogeneous coordinate
      expectedMatrix.set(0, 2, 1); // i -> k
      expectedMatrix.set(1, 1, 1); // j -> j
      expectedMatrix.set(2, 0, 1); // k -> i
      expectedMatrix.set(3, 3, 1); // Homogeneous coordinate

      expect(transformationMatrix.to2DArray()).toEqual(expectedMatrix.to2DArray());
    });

    it('should throw an error when computing permutation matrix for incompatible spaces', () => {
      const dim1 = [10, 20, 30];
      const axes1 = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const ns1 = new NeuroSpace(dim1, [1, 1, 1], [0, 0, 0], axes1);

      const dim2 = [10, 20, 30];
      const axes2 = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        new NamedAxis('UNKNOWN_AXIS', [0, 0, 1]) // Valid direction
      );
      const ns2 = new NeuroSpace(dim2, [1, 1, 1], [0, 0, 0], axes2);

      expect(() => ns1.getPermutationMatrixTo(ns2)).toThrow();
    });
  });

  describe('dropDim with Singularity Handling', () => {
    it('should handle normal dimension reduction without singularity', () => {
      // Standard 3D space with axes aligned to X, Y, Z
      const axes3d = AxisSet3D.AXIAL_LPI;
      const ns3d = new NeuroSpace([10, 20, 30], [1, 1, 1], [0, 0, 0], axes3d);
      
      const ns2d = ns3d.dropDim();
      
      expect(ns2d).not.toBeNull();
      expect(ns2d!.ndim()).toBe(2);
      expect(ns2d!.dim).toEqual([10, 20]);
      
      // Check that transformation matrix is valid (non-singular)
      const trans2d = ns2d!.trans;
      const det = determinant(trans2d);
      expect(Math.abs(det)).toBeGreaterThan(1e-10);
    });

    it('should handle singular matrix case with SVD-based reduction', () => {
      // Create a 3D space where one axis points primarily in Z direction
      // This would create a singular 2x2 matrix when naively dropping Z
      const customAxes = new AxisSet3D(
        new NamedAxis('X_AXIS', [1, 0, 0]),
        new NamedAxis('Z_AXIS', [0, 0, 1]), // This axis points in Z
        new NamedAxis('Y_AXIS', [0, 1, 0])
      );
      
      const ns3d = new NeuroSpace([10, 20, 30], [1, 1, 1], [0, 0, 0], customAxes);
      
      const ns2d = ns3d.dropDim();
      
      expect(ns2d).not.toBeNull();
      expect(ns2d!.ndim()).toBe(2);
      
      // The resulting 2D transformation should still be valid
      const trans2d = ns2d!.trans;
      const det = determinant(trans2d);
      expect(Math.abs(det)).toBeGreaterThan(1e-10);
    });

    it('should handle reoriented space that creates singularity', () => {
      // Start with a standard space
      const ns3d = new NeuroSpace([10, 20, 30], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
      
      // Reorient to sagittal view where dropDim might create singularity
      const sagittalAxes = AxisSet3D.SAGITTAL_PIL;
      const reoriented = ns3d.reorient(sagittalAxes);
      
      // Drop dimension should handle any resulting singularity
      const ns2d = reoriented.dropDim();
      
      expect(ns2d).not.toBeNull();
      expect(ns2d!.ndim()).toBe(2);
      
      // Verify the 2D space is valid
      const trans2d = ns2d!.trans;
      expect(() => inverse(trans2d)).not.toThrow();
    });

    it('should preserve approximate scale when using SVD reduction', () => {
      // Create a 3D space with specific scaling
      const customAxes = new AxisSet3D(
        new NamedAxis('X_AXIS', [1, 0, 0]),
        new NamedAxis('Z_AXIS', [0, 0, 1]),
        new NamedAxis('Y_AXIS', [0, 1, 0])
      );
      
      const spacing = [2, 3, 4]; // Different spacing in each dimension
      const ns3d = new NeuroSpace([10, 20, 30], spacing, [0, 0, 0], customAxes);
      
      const ns2d = ns3d.dropDim();
      
      expect(ns2d).not.toBeNull();
      
      // The 2D spacing should preserve some reasonable scale
      const spacing2d = ns2d!.spacing;
      expect(spacing2d[0]).toBeGreaterThan(0);
      expect(spacing2d[1]).toBeGreaterThan(0);
    });

    it('should return null for 1D space', () => {
      const ns1d = new NeuroSpace([10]);
      const result = ns1d.dropDim();
      expect(result).toBeNull();
    });
  });
});
