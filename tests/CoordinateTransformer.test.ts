import { describe, test, expect, vi, beforeEach } from 'vitest';
import { AxisSet3D, NamedAxis } from '../src/geometry/Axis';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { SliceTransform } from '../src/display/SliceTransform';
import { CoordinateTransformer } from '../src/display/CoordinateTransformer';

// Partially mock PIXI.js to include Point class
vi.mock('pixi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pixi.js')>();
  return {
    ...actual,
    // Keep all original exports including Point
  };
});

import * as PIXI from 'pixi.js';

describe('CoordinateTransformer Tests', () => {
  // We'll create a small helper for the "neuroSpace" and "viewAxes".
  // Suppose: dims=[100,80,60], spacing=[1,1,2], origin=[0,0,0],
  // orientation= i=LEFT_RIGHT, j=POST_ANT, k=INF_SUP => pinned k
  let neuroSpace: NeuroSpace;
  let viewAxes: AxisSet3D;
  let sliceTransformSpy: SliceTransform; // We'll partially spy on a real instance

  beforeEach(() => {
    viewAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );

    neuroSpace = new NeuroSpace(
      [100, 80, 60],
      [1, 1, 2],
      [0, 0, 0],
      viewAxes
    );

    // We'll create a real SliceTransform, but mock its methods
    // so we can verify calls and return consistent test data.
    sliceTransformSpy = new SliceTransform(neuroSpace, viewAxes, 0);

    // Spy on each method we plan to test (using pixel-aware helpers)
    vi.spyOn(sliceTransformSpy, 'imageToVolumeCoord');
    vi.spyOn(sliceTransformSpy, 'imageToWorldCoord');
    vi.spyOn(sliceTransformSpy, 'volumeToImageCoord');
  });

  test('Constructor: default sliceIndex=0', () => {
    // If we pass no "initialSliceIndex", it should be 0
    const ct = new CoordinateTransformer(neuroSpace, viewAxes);
    // No direct assertion except that it doesn't crash.
    // Could test we can call methods. We'll do deeper tests below.
    expect(ct).toBeDefined();
  });

  test('setSliceIndex updates the slice index on SliceTransform', () => {
    // We'll create a normal instance, but we want to confirm that
    // setSliceIndex calls "sliceTransform.updateSliceIndex"
    // However, the code snippet doesn't show updateSliceIndex in your snippet
    // So let's assume we do something like:
    const updateSliceIndexMock = vi.fn();
    // We can patch sliceTransform to have that method:
    (sliceTransformSpy as any).updateSliceIndex = updateSliceIndexMock;

    const ct = new CoordinateTransformer(neuroSpace, viewAxes, 5);
    // We'll forcibly replace the real sliceTransform with our spy
    ;(ct as any).sliceTransform = sliceTransformSpy;

    // Now set slice index
    ct.setSliceIndex(12);

    // We expect updateSliceIndex to be called with 12
    expect(updateSliceIndexMock).toHaveBeenCalledWith(12);
  });

  test('screenToImageCoord uses container.toLocal(...)', () => {
    // We'll create a mock container that returns some known local coords
    const mockContainer = {
      toLocal: vi.fn((globalPos: PIXI.Point) => new PIXI.Point(globalPos.x + 10, globalPos.y + 20))
    } as unknown as PIXI.Container; 
    // This container just transforms (x,y) => (x+10,y+20) as a fake local transform

    const ct = new CoordinateTransformer(neuroSpace, viewAxes, 0);
    // Call screenToImageCoord
    const local = ct.screenToImageCoord(100, 200, mockContainer);
    expect(local).toEqual({ x: 110, y: 220 }); 
    // Also check the mock was called with the correct screen coords
    expect(mockContainer.toLocal).toHaveBeenCalledWith(new PIXI.Point(100, 200));
  });

  test('screenToVolumeCoord: container.toLocal then imageToVolumeCoord', () => {
    // Container => e.g. identity transform => return same point
    const mockContainer = {
      toLocal: vi.fn((p: PIXI.Point) => p)
    } as unknown as PIXI.Container;

    // We'll spy on sliceTransform.imageToVolumeCoord, returning a test value
    ;(sliceTransformSpy.imageToVolumeCoord as vi.Mock).mockReturnValue([10, 15, 2]);
    const ct = new CoordinateTransformer(neuroSpace, viewAxes, 0);
    ;(ct as any).sliceTransform = sliceTransformSpy;

    const volCoord = ct.screenToVolumeCoord(50, 100, mockContainer);
    expect(mockContainer.toLocal).toHaveBeenCalledWith(new PIXI.Point(50, 100));
    // Then it calls sliceTransform.imageToVolumeCoord
    expect(sliceTransformSpy.imageToVolumeCoord).toHaveBeenCalledWith({ x: 50, y: 100 });
    expect(volCoord).toEqual([10, 15, 2]);
  });

  test('sliceToVolumeCoord calls sliceTransform.imageToVolumeCoord', () => {
    // We'll return some arbitrary test value
    ;(sliceTransformSpy.imageToVolumeCoord as vi.Mock).mockReturnValue([9, 8, 7]);
    const ct = new CoordinateTransformer(neuroSpace, viewAxes, 0);
    ;(ct as any).sliceTransform = sliceTransformSpy;

    const result = ct.sliceToVolumeCoord({ x: 25, y: 30 });
    expect(sliceTransformSpy.imageToVolumeCoord).toHaveBeenCalledWith({ x: 25, y: 30 });
    expect(result).toEqual([9, 8, 7]);
  });

  test('sliceToWorldCoord calls sliceTransform.imageToWorldCoord', () => {
    ;(sliceTransformSpy.imageToWorldCoord as vi.Mock).mockReturnValue([100, 200, 300]);
    const ct = new CoordinateTransformer(neuroSpace, viewAxes, 0);
    ;(ct as any).sliceTransform = sliceTransformSpy;

    const w = ct.sliceToWorldCoord({ x: 10, y: 20 });
    expect(sliceTransformSpy.imageToWorldCoord).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(w).toEqual([100, 200, 300]);
  });

  test('volumeToLocalSliceCoord calls sliceTransform.volumeToImageCoord', () => {
    ;(sliceTransformSpy.volumeToImageCoord as vi.Mock).mockReturnValue({ x: 999, y: 777 });
    const ct = new CoordinateTransformer(neuroSpace, viewAxes, 0);
    ;(ct as any).sliceTransform = sliceTransformSpy;

    const localPt = ct.volumeToLocalSliceCoord([1, 2, 3]);
    expect(sliceTransformSpy.volumeToImageCoord).toHaveBeenCalledWith([1, 2, 3]);
    expect(localPt).toEqual({ x: 999, y: 777 });
  });

  test('Integration test: screen → local → volume → local → screen round trip (mock container transform)', () => {
    // We'll demonstrate a (partial) round-trip with a container that does some scale or offset
    // In real usage, you might do something more elaborate
    const mockContainer = {
      toLocal: vi.fn((p: PIXI.Point) => new PIXI.Point(p.x * 2, -p.y)), // e.g. scale X by 2, flip Y
      // "We do not have fromLocal or toGlobal in this snippet, so partial test"
    } as unknown as PIXI.Container;

    // imageToVolumeCoord => let's say returns [10,10,5]
    // volumeToImageCoord => let's say returns { x:50, y:50 }
    ;(sliceTransformSpy.imageToVolumeCoord as vi.Mock).mockReturnValue([10, 10, 5]);
    ;(sliceTransformSpy.volumeToImageCoord as vi.Mock).mockReturnValue({ x: 50, y: 50 });

    const ct = new CoordinateTransformer(neuroSpace, viewAxes, 5);
    ;(ct as any).sliceTransform = sliceTransformSpy;

    // 1) screen(100,200) => local => volume => local => screen?
    // We do not have the forward local=>screen transform in the code snippet, so we'll just
    // verify partial: screen=>volume => local
    const volCoord = ct.screenToVolumeCoord(100, 200, mockContainer);
    expect(mockContainer.toLocal).toHaveBeenCalledWith(new PIXI.Point(100, 200));
    expect(volCoord).toEqual([10, 10, 5]);

    // Then volume=> local
    const localPt = ct.volumeToLocalSliceCoord(volCoord);
    expect(localPt).toEqual({ x: 50, y: 50 });
  });
});

import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as PIXI from 'pixi.js';
import { AxisSet3D, NamedAxis } from '../src/geometry/Axis';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { SliceTransform } from '../src/display/SliceTransform';
import { CoordinateTransformer } from '../src/display/CoordinateTransformer';

//
// Example "named" sets of view axes that represent typical orthogonal planes:
//   1) Axial:   i= LEFT_RIGHT, j= POST_ANT, k= INF_SUP
//   2) Coronal: i= LEFT_RIGHT, j= INF_SUP,  k= POST_ANT
//   3) Sagittal: i= POST_ANT, j= INF_SUP,   k= LEFT_RIGHT
//
// You can expand or modify these to match your definitions.
//
const TEST_ORIENTATIONS = [
  {
    label: 'Axial-like (L->R, P->A, pinned I->S)',
    viewAxes: new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    )
  },
  {
    label: 'Coronal-like (L->R, I->S, pinned P->A)',
    viewAxes: new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.INF_SUP,
      NamedAxis.POST_ANT
    )
  },
  {
    label: 'Sagittal-like (P->A, I->S, pinned L->R)',
    viewAxes: new AxisSet3D(
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP,
      NamedAxis.LEFT_RIGHT
    )
  }
];

describe('CoordinateTransformer Tests (multiple orientations)', () => {
  let neuroSpace: NeuroSpace;
  let sliceTransformSpy: SliceTransform;

  beforeEach(() => {
    // We create a "standard" volume space, but the actual orientation
    // inside "NeuroSpace" won't matter much because we are going to rely
    // on the SliceTransform’s param. For a real integration test, you might
    // ensure the volume orientation is standard too. For demonstration:
    neuroSpace = new NeuroSpace(
      [100, 80, 60],  // dims
      [1, 1, 2],      // spacing
      [0, 0, 0],      // origin
      // orientation inside the volume:
      new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      )
    );
  });

  TEST_ORIENTATIONS.forEach(({ label, viewAxes }) => {
    describe(`Testing with ${label}`, () => {
      beforeEach(() => {
        // We build a real SliceTransform but mock some methods (pixel-aware variants)
        sliceTransformSpy = new SliceTransform(neuroSpace, viewAxes, 0);
        vi.spyOn(sliceTransformSpy, 'imageToVolumeCoord');
        vi.spyOn(sliceTransformSpy, 'imageToWorldCoord');
        vi.spyOn(sliceTransformSpy, 'volumeToImageCoord');
      });

      test('Constructor + setSliceIndex => calls updateSliceIndex internally', () => {
        // We'll mock an updateSliceIndex
        const updateSliceIndexMock = vi.fn();
        (sliceTransformSpy as any).updateSliceIndex = updateSliceIndexMock;

        const coordTx = new CoordinateTransformer(neuroSpace, viewAxes, 5);
        // replace sliceTransform with our spy
        (coordTx as any).sliceTransform = sliceTransformSpy;

        coordTx.setSliceIndex(10);
        expect(updateSliceIndexMock).toHaveBeenCalledWith(10);
      });

      test('screenToImageCoord => local => calls container.toLocal', () => {
        // simple container mock
        const mockContainer = {
          toLocal: vi.fn((p: PIXI.Point) => new PIXI.Point(p.x + 10, p.y + 5))
        } as unknown as PIXI.Container;

        const coordTx = new CoordinateTransformer(neuroSpace, viewAxes, 0);
        // no replacement of sliceTransform needed here

        const localPt = coordTx.screenToImageCoord(100, 200, mockContainer);
        expect(localPt).toEqual({ x: 110, y: 205 });
        expect(mockContainer.toLocal).toHaveBeenCalledWith(new PIXI.Point(100, 200));
      });

      test('screenToVolumeCoord => uses container.toLocal => imageToVolumeCoord', () => {
        const mockContainer = {
          toLocal: vi.fn((p: PIXI.Point) => p) // identity
        } as unknown as PIXI.Container;

        (sliceTransformSpy.imageToVolumeCoord as vi.Mock).mockReturnValue([99, 88, 5]);

        const coordTx = new CoordinateTransformer(neuroSpace, viewAxes, 0);
        (coordTx as any).sliceTransform = sliceTransformSpy;

        const volCoord = coordTx.screenToVolumeCoord(50, 40, mockContainer);
        expect(mockContainer.toLocal).toHaveBeenCalledWith(new PIXI.Point(50, 40));
        expect(sliceTransformSpy.imageToVolumeCoord).toHaveBeenCalledWith({ x: 50, y: 40 });
        expect(volCoord).toEqual([99, 88, 5]);
      });

      test('sliceToWorldCoord => calls sliceTransform.imageToWorldCoord', () => {
        (sliceTransformSpy.imageToWorldCoord as vi.Mock).mockReturnValue([10, 20, 30]);
        const coordTx = new CoordinateTransformer(neuroSpace, viewAxes, 0);
        (coordTx as any).sliceTransform = sliceTransformSpy;

        const w = coordTx.sliceToWorldCoord({ x: 5, y: 3 });
        expect(sliceTransformSpy.imageToWorldCoord).toHaveBeenCalledWith({ x: 5, y: 3 });
        expect(w).toEqual([10, 20, 30]);
      });

      test('volumeToLocalSliceCoord => calls sliceTransform.volumeToImageCoord', () => {
        (sliceTransformSpy.volumeToImageCoord as vi.Mock).mockReturnValue({ x: 999, y: 888 });
        const coordTx = new CoordinateTransformer(neuroSpace, viewAxes, 0);
        (coordTx as any).sliceTransform = sliceTransformSpy;

        const local2D = coordTx.volumeToLocalSliceCoord([1, 2, 3]);
        expect(sliceTransformSpy.volumeToImageCoord).toHaveBeenCalledWith([1, 2, 3]);
        expect(local2D).toEqual({ x: 999, y: 888 });
      });

      test('Integration: minimal real geometry for pinned axis check', () => {
        // Instead of mocking, let's create a real coordinate transformer and do a small test:
        const realCoordTx = new CoordinateTransformer(neuroSpace, viewAxes, 10);

        // We'll pretend the container is identity => screen coords == local coords
        const mockContainer = {
          toLocal: (p: PIXI.Point) => p
        } as unknown as PIXI.Container;

        // 1) screen => volume => we confirm pinned axis = 10
        //    Suppose we do x=20, y=30 => slice => volume => ???

        // Because orientation (viewAxes) might be e.g. "Sagittal-like", pinnedAxis is different dimension
        // We'll just check that the pinned dimension in the final [i,j,k] is indeed 10
        const volCoord = realCoordTx.screenToVolumeCoord(20, 30, mockContainer)!;

        // Then check volCoord's pinned dimension. For instance, if it's Axial-like => pinnedDim=2 => volCoord[2]=10
        // If it's Coronal => pinnedDim=2 => volCoord[2]=10
        // If it's Sagittal => pinnedDim=2 => volCoord[2]=10. 
        // But the dimension assignment might vary. We'll figure it out:
        // Let's see which dimension is pinned in the "viewAxes" => .k
        const pinnedAxis = viewAxes.k;  // e.g. NamedAxis.INF_SUP
        const pinnedDim = neuroSpace.whichDim(pinnedAxis);

        expect(volCoord[pinnedDim]).toBeCloseTo(10, 2);
      });
    });
  });
});
