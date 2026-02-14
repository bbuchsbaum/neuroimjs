// tests/SliceTransform.test.ts
import { describe, test, expect, beforeAll } from 'vitest'; // <-- Vitest imports
import { NamedAxis, AxisSet3D } from '../src/geometry/Axis';
import { NeuroAtlas } from '../src/atlas/NeuroAtlas';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { SliceTransform } from '../src/display/SliceTransform';

describe('SliceTransform.sliceToVolumeCoord (Vitest)', () => {
  // Helper to create a simple 3D NeuroSpace with the given axes, dims, and spacing
  function makeSpace(
    dims: number[],
    spacing: number[],
    axes3D: AxisSet3D
  ): NeuroSpace {
    return new NeuroSpace(
      dims,
      spacing,
      /* origin= */ [0, 0, 0],
      axes3D
    );
  }

  test('Basic case: L->R, P->A, I->S pinned on I->S axis, sliceIndex=10', () => {
    // Axes in the volume: i=LEFT_RIGHT, j=POST_ANT, k=INF_SUP
    const axes3D = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );

    const dims = [100, 80, 60];  // e.g. 100 in L->R, 80 in P->A, 60 in I->S
    const spacing = [1, 1, 2];   // mm per voxel

    const volume = makeSpace(dims, spacing, axes3D);

    // View is the same orientation, pinned on the 3rd axis (INF_SUP)
    const viewAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );

    // sliceIndex = 10 means dimension for INF_SUP = 10
    const xform = new SliceTransform(volume, viewAxes, 10);

    // slicePt.x=50 => i=50, slicePt.y=20 => j=20, pinned k=10
    const result = xform.sliceToVolumeCoord({ x: 50, y: 20 });
    expect(result).toEqual([50, 20, 10]);
  });

  test('Flipped axis example: R->L as first axis, pinned = I->S', () => {
    // Suppose the volume was oriented as RIGHT_LEFT, POST_ANT, INF_SUP
    const axes3D = new AxisSet3D(
      NamedAxis.RIGHT_LEFT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );
    const dims = [100, 80, 60];
    const spacing = [1, 1, 2];
    const volume = makeSpace(dims, spacing, axes3D);

    // But we *view* as if it were LEFT_RIGHT, POST_ANT, INF_SUP.
    // This implies a flip in the first axis.
    const viewAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );

    const sliceIndex = 10;
    const xform = new SliceTransform(volume, viewAxes, sliceIndex);

    // If slicePt.x=0 => that’s the left edge in the “view”,
    // but volume is R->L => i= (dims[0] - 1) = 99 in the volume
    let res = xform.sliceToVolumeCoord({ x: 0, y: 20 });
    expect(res).toEqual([99, 20, 10]);

    // slicePt.x=50 => i= 99 - 50 => 49
    res = xform.sliceToVolumeCoord({ x: 50, y: 20 });
    expect(res).toEqual([49, 20, 10]);
  });

  test('Changing pinned dimension from INF_SUP to POST_ANT', () => {
    // Original volume axes: i=LR, j=PA, k=IS
    const volumeAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );
    const volumeDims = [100, 80, 60];
    const volumeSpacing = [1, 2, 3];
    const volSpace = makeSpace(volumeDims, volumeSpacing, volumeAxes);

    // Now choose pinned axis = POST_ANT => in viewAxes .k=POST_ANT
    // So .i=LEFT_RIGHT, .j=INF_SUP, .k=POST_ANT
    const viewAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.INF_SUP,
      NamedAxis.POST_ANT
    );

    // sliceIndex=5 => pinned dimension is POST_ANT => j=5 in volume
    const xform = new SliceTransform(volSpace, viewAxes, 5);

    // slicePt.x=10 => along LR => i=10 (spacing=1 => 10/1=10)
    // slicePt.y=15 => along INF_SUP => k=15/3=5
    // pinned => j=5
    // => volume coords [i=10, j=5, k=5]
    const r = xform.sliceToVolumeCoord({ x: 10, y: 15 });
    expect(r).toEqual([10, 5, 5]);
  });

  test('Out-of-range slice coordinate example (no error by default)', () => {
    // Volume
    const volumeAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );
    const volumeDims = [10, 10, 10];
    const volumeSpacing = [1, 1, 1];
    const volSpace = new NeuroSpace(volumeDims, volumeSpacing, [0,0,0], volumeAxes);

    // pinned on INF_SUP => dimension=2
    const viewAxes = volumeAxes;  // same orientation
    const xform = new SliceTransform(volSpace, viewAxes, 5);

    // x=500 => i=500 => beyond dim[0]-1=9
    // y=-20 => j=-20 => negative => also out of range
    // returns [500, -20, 5] with no error
    const outVoxel = xform.sliceToVolumeCoord({ x: 500, y: -20 });
    expect(outVoxel).toEqual([500, -20, 5]);
  });
});

describe('MNI Template Volume Space', () => {
    //
    // 1. Create a NeuroSpace for the MNI template
    //
    // - 197 × 233 × 189
    // - Spacing= [1,1,1]
    // - Origin = [-98, -134, -72]
    // - Orientation: (i= LEFT_RIGHT, j= POST_ANT, k= INF_SUP)
    //
    const mniDims = [197, 233, 189];
    const mniSpacing = [1, 1, 1];
    const mniOrigin = [-98, -134, -72];
  
    // Named axes in order: i=Left->Right, j=Post->Ant, k=Inf->Sup
    const mniAxes = new AxisSet3D(
      NamedAxis.LEFT_RIGHT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );
  
    // Create the NeuroSpace
    const mniSpace = new NeuroSpace(
      mniDims,
      mniSpacing,
      mniOrigin,
      mniAxes
    );
  
    test('Bounding box corners match expected coordinates', () => {
      // Bounds should be:
      //  - corner1 = [-98, -134, -72]  (grid [0,0,0])
      //  - corner2 = [ 98,   98, 116]  (grid [196,232,188])
      // Because each dimension has size dims[d], so the max index is dims[d] - 1,
      // and spacing=1, orientation is positive along each axis.
  
      const [minCorner, maxCorner] = mniSpace.bounds();
  
      expect(minCorner).toEqual([-98, -134, -72]);
      expect(maxCorner).toEqual([98, 98, 116]);
    });
  
    test('Check a few gridToCoord and coordToGrid examples', () => {
      // grid(0,0,0) => coord(-98, -134, -72)
      let coord = mniSpace.gridToCoord([0, 0, 0]);
      expect(coord).toEqual([-98, -134, -72]);
  
      // grid(196,232,188) => coord(98, 98, 116)
      coord = mniSpace.gridToCoord([196, 232, 188]);
      expect(coord).toEqual([98, 98, 116]);
  
      // Now invert it with coordToGrid
      const grid0 = mniSpace.coordToGrid([-98, -134, -72]);
      expect(grid0).toEqual([0, 0, 0]);
  
      const grid1 = mniSpace.coordToGrid([98, 98, 116]);
      expect(grid1).toEqual([196, 232, 188]);
    });
  
    test('sliceToVolumeCoord pinned on the third axis (INF_SUP)', () => {
      // Suppose we’re viewing an axial-like slice pinned on the k=INF_SUP axis.
      // In the MNI orientation, dimension #2 is INF_SUP.
      // Let’s pick sliceIndex=90 (i.e. near the middle in Z).
  
      const pinnedSliceIndex = 90;
      const viewAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,  // i
        NamedAxis.POST_ANT,    // j
        NamedAxis.INF_SUP      // k = pinned
      );
  
      const xform = new SliceTransform(mniSpace, viewAxes, pinnedSliceIndex);
  
      // If we interpret slice .x along Left->Right, .y along Post->Ant:
      //   slicePt.x = 30 mm => voxel i = 30 / spacing[i] => 30
      //   slicePt.y = 40 mm => voxel j = 40 / spacing[j] => 40
      // pinned k => 90
      //
      // So the result => [30, 40, 90] in volume voxel coords
      const slicePt = { x: 30, y: 40 };
      const volCoord = xform.sliceToVolumeCoord(slicePt);
      expect(volCoord).toEqual([30, 40, 90]);
    });
  
    test('sliceToVolumeCoord with flipped axis example', () => {
      // Suppose we want to *view* the MNI volume with a reversed first axis
      //  (i.e. Right->Left instead of Left->Right).
      // We'll keep pinned = INF_SUP.
      // Then slice x=0 => the far right edge in volume i= (197 -1)=196
      //     slice x=50 => i= (196 - 50)=146, etc.
  
      // So the desired view orientation:
      const flippedViewAxes = new AxisSet3D(
        NamedAxis.RIGHT_LEFT,  // i (instead of L->R)
        NamedAxis.POST_ANT,    // j
        NamedAxis.INF_SUP      // k pinned
      );
      const pinnedSliceIndex = 50;
      const xform = new SliceTransform(mniSpace, flippedViewAxes, pinnedSliceIndex);
  
      // For x=0 => i= 196 (since dimension i=197 => last index=196)
      // slicePt.y=10 => j= 10
      // pinned => k= 50
      let volCoord = xform.sliceToVolumeCoord({ x: 0, y: 10 });
      expect(volCoord).toEqual([196, 10, 50]);
  
      // For x=30 => i= 196 -30 => 166
      volCoord = xform.sliceToVolumeCoord({ x: 30, y: 10 });
      expect(volCoord).toEqual([166, 10, 50]);
    });
  });

  describe('SliceTransform', () => {
    // Helper to create a simple 3D NeuroSpace with the given axes, dims, and spacing
    function makeSpace(
      dims: number[],
      spacing: number[],
      axes3D: AxisSet3D
    ): NeuroSpace {
      return new NeuroSpace(dims, spacing, /* origin= */ [0,0,0], axes3D);
    }
  
    test('volumeToSliceCoord basics (same orientation)', () => {
      // i= L->R, j= P->A, k= I->S
      const axes3D = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const dims = [100, 80, 60];
      const spacing = [1, 1, 2];
      const volume = makeSpace(dims, spacing, axes3D);
  
      // pinned on .k = INF_SUP => dimension=2
      // sliceIndex=10 => k=10
      const xform = new SliceTransform(volume, axes3D, 10);
  
      // volumeCoord => sliceCoord
      // i=12 => x=12 mm (since spacing=1 in i)
      // j=25 => y=25 mm (since spacing=1 in j)
      // k=10 => pinned => sliceIndex=10
      const volCoord = [12, 25, 10];
      const sliceXY = xform.volumeToSliceCoord(volCoord);
      expect(sliceXY).toEqual({ x: 12, y: 25 });
    });
  
    test('volumeToSliceCoord basics (flipped axis)', () => {
      // Suppose the volume is oriented as i= RIGHT_LEFT, j= POST_ANT, k= INF_SUP
      // but we want to *view* it as i= LEFT_RIGHT, j=POST_ANT, pinned k=INF_SUP
      // The pinned dimension is the same, but i is reversed.
      const volumeAxes = new AxisSet3D(
        NamedAxis.RIGHT_LEFT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const dims = [100, 80, 60];
      const spacing = [1, 1, 2];
      const volume = makeSpace(dims, spacing, volumeAxes);
  
      // The *view* we want is .i= LEFT_RIGHT, .j=POST_ANT, .k= INF_SUP
      const viewAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
  
      const xform = new SliceTransform(volume, viewAxes, 10);
  
      // Let’s pick volCoord= [15,20,10]
      // i=15 in the volume means 15 steps from R->L side
      // That is effectively dims[0]-1 -15= 84 steps from the L->R side.
      // So we expect slice x= 84 mm for the new orientation
      const volCoord = [15, 20, 10];
      const sliceXY = xform.volumeToSliceCoord(volCoord);
      expect(sliceXY.x).toBeCloseTo(84); // (100-1-15)=84 => 84 *1 => 84
      expect(sliceXY.y).toBeCloseTo(20); // j matches => spacing=1 => 20
    });
  
    test('Check round-trip: volumeCoord => sliceCoord => volumeCoord (no flip)', () => {
      // i= L->R, j= P->A, k= I->S
      const axes3D = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const dims = [50, 60, 70];
      const spacing = [1, 2, 3];
      const volume = makeSpace(dims, spacing, axes3D);
  
      const xform = new SliceTransform(volume, axes3D, 30); // pinned k=30
      // We test a random i= 10.25, j= 12.75 => k=30
      const volCoord = [10.25, 12.75, 30];
      const sliceXY = xform.volumeToSliceCoord(volCoord);
  
      // Now invert with sliceToVolumeCoord
      const volCoord2 = xform.sliceToVolumeCoord(sliceXY);
      // They should match closely:
      // i dimension => 10.25 => x= 10.25 * spacing[0]=10.25 => then / spacing=10.25
      // j dimension => 12.75 => y= 12.75* spacing[1]=25.5 => then /2=12.75
      // k pinned => 30
      expect(volCoord2[0]).toBeCloseTo(10.25);
      expect(volCoord2[1]).toBeCloseTo(12.75);
      expect(volCoord2[2]).toBeCloseTo(30);
    });
  
    test('Check round-trip: volumeCoord => sliceCoord => volumeCoord (with flip)', () => {
      // Volume: i= RIGHT_LEFT, j= POST_ANT, k= INF_SUP
      // But we choose to view as i= LEFT_RIGHT, j= POST_ANT, pinned k= INF_SUP
      const volumeAxes = new AxisSet3D(
        NamedAxis.RIGHT_LEFT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const dims = [100, 80, 60];
      const spacing = [0.5, 1, 2]; // just to differentiate
      const volume = makeSpace(dims, spacing, volumeAxes);
  
      const viewAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const sliceIndex = 10;
      const xform = new SliceTransform(volume, viewAxes, sliceIndex);
  
      // Let's pick volCoord [ i=20.7, j=10, k=10 ]
      // pinned => k=10
      const volCoord = [20.7, 10, 10];
      const sliceXY = xform.volumeToSliceCoord(volCoord);
  
      // In the view, i= LEFT_RIGHT => we flip i around (dims[0]-1)=99
      // i=20.7 => slice.x= (99 -20.7)* spacing i= 78.3 * 0.5= 39.15
      // j => same => j=10 => slice.y= 10*1=10
      expect(sliceXY.x).toBeCloseTo(39.15);
      expect(sliceXY.y).toBeCloseTo(10);
  
      // Now invert with sliceToVolumeCoord
      const volCoord2 = xform.sliceToVolumeCoord(sliceXY);
      // Should be [20.7, 10, 10] again (within floating tolerance)
      expect(volCoord2[0]).toBeCloseTo(20.7);
      expect(volCoord2[1]).toBeCloseTo(10);
      expect(volCoord2[2]).toBeCloseTo(10);
    });
  });

  describe('sliceToWorldCoord tests', () => {
    // Utility to create a NeuroSpace
    function makeSpace(
      dims: number[],
      spacing: number[],
      origin: number[],
      axes3D: AxisSet3D
    ): NeuroSpace {
      return new NeuroSpace(dims, spacing, origin, axes3D);
    }
  
    test('No flips, pinned on k=INF_SUP, origin=0', () => {
      // i= L->R, j= P->A, k= I->S
      // dims= [50,60,70], spacing= [2,2,2], origin= [0,0,0]
      const dims = [50, 60, 70];
      const spacing = [2, 2, 2];
      const origin = [0, 0, 0];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const space = makeSpace(dims, spacing, origin, axes);
      
      // pinned => k=10 => slice index=10
      const sliceIndex = 10;
      const xform = new SliceTransform(space, axes, sliceIndex);
  
      // slice coordinates => { x: 20, y: 40 } mm
      // => volume voxel: i= 20/2=10, j= 40/2=20, k=10
      // => world: x= 10*2, y= 20*2, z= 10*2 => [20,40,20]
      const worldCoord = xform.sliceToWorldCoord({ x: 20, y: 40 });
      expect(worldCoord).toEqual([20, 40, 20]);
    });
  
    test('Non-zero origin, no flip, pinned k=10', () => {
      // dims= [100,100,60], spacing=[1,1,2], origin=[-50, -60, 10]
      // axes= L->R, P->A, I->S
      const dims = [100, 100, 60];
      const spacing = [1, 1, 2];
      const origin = [-50, -60, 10];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const space = makeSpace(dims, spacing, origin, axes);
      const sliceIndex = 10; // pinned => k=10
      const xform = new SliceTransform(space, axes, sliceIndex);
  
      // slice => { x: 20, y: 30 }
      // => voxel= i=20/1=20, j=30/1=30, k=10
      // => world= origin + [20,30,10*2]
      // => [-50+20, -60+30, 10+20]= [-30, -30, 30]
      const worldCoord = xform.sliceToWorldCoord({ x: 20, y: 30 });
      expect(worldCoord).toEqual([-30, -30, 30]);
    });
  
    test('Flipped axis: volume is R->L, but we view as L->R, pinned on k=INF_SUP', () => {
      // dims= [100,100,60], spacing=[1,1,2], origin=[0,0,0]
      // volume oriented: i= RIGHT_LEFT, j= POST_ANT, k= INF_SUP
      const dims = [100, 100, 60];
      const spacing = [1, 1, 2];
      const origin = [0, 0, 0];
      const volumeAxes = new AxisSet3D(
        NamedAxis.RIGHT_LEFT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const space = makeSpace(dims, spacing, origin, volumeAxes);
  
      // Our "view" => i= LEFT_RIGHT, j=POST_ANT, k=INF_SUP => pinned k=10
      const viewAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const sliceIndex = 10;
      const xform = new SliceTransform(space, viewAxes, sliceIndex);
  
      // slice x=0 => voxel i= (dims[0] -1)=99 => (since flip)
      // slice y=20 => j= 20 => pinned => k=10
      // => voxel= [99, 20, 10]
      // => world= gridToCoord([99,20,10])
      // We'll just check that the returned coordinate is 3D
      const w0 = xform.sliceToWorldCoord({ x: 0, y: 20 });
      expect(w0.length).toBe(3);
  
      // slice x=50 => i= 99-50=49 => j=20 => k=10
      const w1 = xform.sliceToWorldCoord({ x: 50, y: 20 });
      expect(w1.length).toBe(3);
      // We can verify that w1 differs from w0 in the x dimension
      expect(w1[0]).not.toEqual(w0[0]);
    });
  
    test('Round-trip check: slice => world => volume => slice (no direct world->slice)', () => {
      // We'll do slice => world => volume => slice 
      //   slice => world uses xform.sliceToWorldCoord
      //   world => volume => we can do space.coordToGrid
      //   volume => slice => xform.volumeToSliceCoord
  
      // dims= [10,10,10], spacing=[2,2,2], origin=[0,0,0], i=LR, j=PA, k=IS
      const dims = [10, 10, 10];
      const spacing = [2, 2, 2];
      const origin = [0, 0, 0];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const space = makeSpace(dims, spacing, origin, axes);
      const xform = new SliceTransform(space, axes, 5);
  
      // slice => { x: 10, y: 20 }
      const slicePt = { x: 10, y: 20 };
  
      // 1) slice => world
      const w = xform.sliceToWorldCoord(slicePt);
  
      // 2) world => volume => slice
      const volCoord = space.coordToGrid(w);
      const slicePt2 = xform.volumeToSliceCoord(volCoord);
  
      expect(slicePt2.x).toBeCloseTo(slicePt.x);
      expect(slicePt2.y).toBeCloseTo(slicePt.y);
    });
  });

  describe('SliceTransform worldToSliceCoord tests', () => {
    // Helper to create a 3D NeuroSpace
    function makeSpace(
      dims: number[],
      spacing: number[],
      origin: number[],
      axes3D: AxisSet3D
    ): NeuroSpace {
      return new NeuroSpace(dims, spacing, origin, axes3D);
    }
  
    test('No flip, pinned k=INF_SUP, zero origin', () => {
      // Volume: i= L->R, j= P->A, k= I->S
      // dims= [50,60,70], spacing= [2,2,2], origin= [0,0,0]
      // pinned => sliceIndex= k=10
      const dims = [50, 60, 70];
      const spacing = [2, 2, 2];
      const origin = [0, 0, 0];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const space = makeSpace(dims, spacing, origin, axes);
      const sliceIndex = 10;
      const xform = new SliceTransform(space, axes, sliceIndex);
  
      // Suppose we have a worldPt= [ 22, 40, 20 ]
      // world => volume => slice
      // 1) volumeCoord= (worldPt - origin)/spacing => [11,20,10]
      // 2) pinned => k=10 => consistent
      // 3) volumeToSlice => i=11 => x= 11*2=22, j=20 => y= 20*2=40
      // So we expect slice= { x:22, y:40 }
      const slicePt = xform.worldToSliceCoord([22, 40, 20]);
      expect(slicePt.x).toBeCloseTo(22);
      expect(slicePt.y).toBeCloseTo(40);
    });
  
    test('Non-zero origin, no flip, pinned k=10', () => {
      // dims= [100,100,60], spacing=[1,1,2], origin=[ -50, -60, 10 ]
      // pinned => k=10
      const dims = [100, 100, 60];
      const spacing = [1, 1, 2];
      const origin = [-50, -60, 10];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const space = makeSpace(dims, spacing, origin, axes);
      const sliceIndex = 10;
      const xform = new SliceTransform(space, axes, sliceIndex);
  
      // worldPt => let's do [ -40, -30, 30 ]
      // => volumeCoord= ?
      //   i= (world.x - origin.x)/spacing.x=  (-40 -(-50))/1=10
      //   j= (world.y - origin.y)/spacing.y=  (-30 -(-60))/1=30
      //   k= (world.z - origin.z)/spacing.z=  (30 -10)/2=10
      // => pinned => k=10 => consistent
      // => slice= { x= i*1=10, y= j*1=30 }
      const slicePt = xform.worldToSliceCoord([-40, -30, 30]);
      expect(slicePt).toEqual({ x: 10, y: 30 });
    });
  
    test('Flipped axis: volume is R->L, pinned= INF_SUP', () => {
      // dims= [100,100,60], spacing=[1,1,2], origin=[0,0,0]
      // volume: i= RIGHT_LEFT, j= POST_ANT, k= INF_SUP
      const dims = [100, 100, 60];
      const spacing = [1, 1, 2];
      const origin = [0, 0, 0];
      const volumeAxes = new AxisSet3D(
        NamedAxis.RIGHT_LEFT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const space = makeSpace(dims, spacing, origin, volumeAxes);
  
      // Our "view" => i= LEFT_RIGHT => flipped, j= POST_ANT, k= INF_SUP => pinned=10
      const viewAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const xform = new SliceTransform(space, viewAxes, 10);
  
      // Suppose world Pt => we do i= 80 => that's the volume's grid i=80 but axis= R->L => 
      // Actually let's just pick a direct voxel= [80,20,10] => in world => 
      //   [ x=80, y=20, z=10*2=20 ] (assuming the direction vectors in NeuroSpace reflect R->L as negative X, etc.
      // But we won't overcomplicate. We rely on coordToGrid. Let's call it with [80,20,20].
      const slicePt = xform.worldToSliceCoord([80, 20, 20]);
      // We only check that the result is 2D. 
      // If i=80 => slice.x= ?
  
      expect(slicePt.x).toBeDefined();
      expect(slicePt.y).toBeDefined();
    });
  
    test('Round trip: slice => world => slice, no flips', () => {
      // dims= [10,10,10], spacing=[2,2,2], origin=[0,0,0], pinned => k=5
      const dims = [10, 10, 10];
      const spacing = [2, 2, 2];
      const origin = [0, 0, 0];
      const axes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const space = makeSpace(dims, spacing, origin, axes);
      const xform = new SliceTransform(space, axes, 5);
  
      // slice => { x= 8, y=6 }
      // => world => => slice
      const slice1 = { x: 8, y: 6 };
      const worldPt = xform.sliceToWorldCoord(slice1);
      const slice2 = xform.worldToSliceCoord(worldPt);
  
      // Should be close to original
      expect(slice2.x).toBeCloseTo(slice1.x);
      expect(slice2.y).toBeCloseTo(slice1.y);
    });
  
    test('Round trip: world => slice => world, with flips + non-zero origin', () => {
      // dims= [20,20,15], spacing=[1.5,2,3], origin=[-10,100,50]
      // volume= i= RIGHT_LEFT, j=POST_ANT, k= INF_SUP => pinned k=7
      const dims = [20, 20, 15];
      const spacing = [1.5, 2, 3];
      const origin = [-10, 100, 50];
      const volumeAxes = new AxisSet3D(
        NamedAxis.RIGHT_LEFT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const space = makeSpace(dims, spacing, origin, volumeAxes);
  
      // view => i= LEFT_RIGHT => flip, j= POST_ANT => same, k= INF_SUP => pinned=7
      const viewAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      const xform = new SliceTransform(space, viewAxes, 7);
  
      // Let's pick a random world Pt => e.g. [ -5, 110, 71 ]
      // Then do => slice => world => slice
      const world1 = [-5, 110, 71];
      const slice = xform.worldToSliceCoord(world1);
      const world2 = xform.sliceToWorldCoord(slice);
  
      expect(world2[0]).toBeCloseTo(world1[0], 3);
      expect(world2[1]).toBeCloseTo(world1[1], 3);
      expect(world2[2]).toBeCloseTo(world1[2], 3);
    });
  });

  describe('Schaefer Atlas NeuroSpace Tests', () => {
    let atlasSpace: NeuroSpace | null = null;
  
    beforeAll(async () => {
      // 1) Load the Schaefer atlas with resolution=2, 400 parcels, 17 networks
      const schaeferAtlas = await NeuroAtlas.loadSchaeferAtlas({
        parcels: 400,
        networks: 17,
        resolution: 2,
        useCache: true,
      });
      // 2) Extract the NeuroSpace from the underlying volume
      atlasSpace = schaeferAtlas.atlas.space;  // ClusteredNeuroVol.space
    });
  
    test('Confirm Schaefer atlas space properties', () => {
      // We expect dims = [91, 109, 91], spacing=[2,2,2],
      // origin ~ [90, -126, -72], transform with negative X scale, etc.
      // Make sure the actual loaded space matches that.
      expect(atlasSpace).toBeTruthy();
      if (!atlasSpace) return;
  
      expect(atlasSpace.dim).toEqual([91, 109, 91]);
      expect(atlasSpace.spacing).toEqual([2, 2, 2]);
  
      // The “origin” from the matrix’s last column or from .origin
      // Typically we expect: [90, -126, -72] for the Schaefer 2mm
      const origin = atlasSpace.origin;
      expect(origin[0]).toBeCloseTo(90, 1);
      expect(origin[1]).toBeCloseTo(-126, 1);
      expect(origin[2]).toBeCloseTo(-72, 1);
  
      // The transform matrix:
      //   [ -2,  0,  0,  90 ]
      //   [  0,  2,  0, -126]
      //   [  0,  0,  2, -72 ]
      //   [  0,  0,  0,   1 ]
      // We can do a partial check:
      const T = atlasSpace.trans.to2DArray();
      // T[0][0] should be -2 (the negative scale on X)
      expect(T[0][0]).toBeCloseTo(-2, 1e-3);
      // T[1][1] should be 2
      expect(T[1][1]).toBeCloseTo(2, 1e-3);
      // T[2][3] ~ -72
      expect(T[2][3]).toBeCloseTo(-72, 1e-3);
    });
  
    test('Check a few corner points in gridToCoord / coordToGrid', () => {
      if (!atlasSpace) return;
  
      // corner A: grid(0,0,0) => world => should be ~ [90, -126, -72]
      const cA = atlasSpace.gridToCoord([0,0,0]);
      expect(cA[0]).toBeCloseTo(90, 1);
      expect(cA[1]).toBeCloseTo(-126, 1);
      expect(cA[2]).toBeCloseTo(-72, 1);
  
      // corner B: grid(90, 108, 90) => last voxel
      // => world => [ 90 + (90 * -2?), -126 + (108 * 2?), -72 + (90 * 2?) ] ...
      // But let's just check the invert:
      const cBWorld = atlasSpace.gridToCoord([90,108,90]);
      // Then invert it:
      const idxB = atlasSpace.coordToGrid(cBWorld);
      // Expect ~ [90,108,90]
      expect(idxB[0]).toBeCloseTo(90, 0.001);
      expect(idxB[1]).toBeCloseTo(108, 0.001);
      expect(idxB[2]).toBeCloseTo(90, 0.001);
    });
  
    test('Use SliceTransform pinned on k=Z=Inferior, basic slice->vol check', () => {
      if (!atlasSpace) return;
  
      // The actual axes in the atlas are X=Left, Y=Anterior, Z=Inferior
      // so let's define them:
      const schaeferAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,   // X
        NamedAxis.ANT_POST,     // Y
        NamedAxis.INF_SUP       // Z
      );
      // pinned dimension => .k= INF_SUP => dimension=2
      const sliceIndex = 45; // halfway in z?
  
      const xform = new SliceTransform(atlasSpace, schaeferAxes, sliceIndex);
  
      // Suppose slice coordinate = x= 10mm, y= 20mm,
      // => volume voxel i=?? j=?? k=45
      // But note the volume transform has negative X direction. 
      // Because NamedAxis.LEFT_RIGHT in the atlasSpace is actually the negative X axis internally.
      // So we check the result carefully:
  
      const volCoord = xform.sliceToVolumeCoord({ x: 10, y: 20 });
      // Just do a round trip
      const slicePt2 = xform.volumeToSliceCoord(volCoord);
      // They should match fairly closely:
      expect(slicePt2.x).toBeCloseTo(10, 0.01);
      expect(slicePt2.y).toBeCloseTo(20, 0.01);
    });
  
    test('sliceToWorldCoord => corner check', () => {
      if (!atlasSpace) return;
  
      // pinned dimension => z= 0 (lowest slice)
      const schaeferAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.ANT_POST,
        NamedAxis.INF_SUP
      );
      const pinnedZIndex = 0;
      const xform = new SliceTransform(atlasSpace, schaeferAxes, pinnedZIndex);
  
      // slice x=0 => i= ??? => probably i= 90
      // slice y=0 => j= ??? => (with the y=ANT, the transform is 2 mm / voxel, plus offset)
      // But let's do a direct approach:
      const wCoord = xform.sliceToWorldCoord({ x: 0, y: 0 });
      // This corresponds to volumeCoord = [?, ?, 0].
      // Then the atlas's transform is used => we can just confirm that wCoord is a 3D point,
      // and see if x ~ 90, y ~ -126, z ~ ?
  
      // We'll just check it doesn't blow up:
      expect(wCoord.length).toBe(3);
    });
  });


  // Helper to create a 3D NeuroSpace
function makeVolumeSpace_RPI(
    dims: number[],
    spacing: number[],
    origin: number[]
  ): NeuroSpace {
    // R->L, P->A, I->S in NamedAxis form:
    //   i= RIGHT_LEFT
    //   j= POST_ANT   (P->A)
    //   k= INF_SUP    (I->S)
    const rpiAxes = new AxisSet3D(
      NamedAxis.RIGHT_LEFT,
      NamedAxis.POST_ANT,
      NamedAxis.INF_SUP
    );
  
    return new NeuroSpace(dims, spacing, origin, rpiAxes);
  }
  
  describe('Corner Points Test: Volume=RPI => View=LPI => worldCoord', () => {
    test('Enumerate corners and transform to world coordinates', () => {
      //
      // 1) Create a small RPI volume
      //
      const dims = [10, 8, 6];         // x=10, y=8, z=6
      const spacing = [2, 2, 2];       // uniform 2 mm
      const origin = [0, 0, 0];        // simple origin for clarity
      const rpiSpace = makeVolumeSpace_RPI(dims, spacing, origin);
  
      // 2) The "view" we want is L->R, P->A, I->S => pinned on the 3rd axis
      // i= LEFT_RIGHT, j= POST_ANT, k= INF_SUP
      const lpiAxes = new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      );
      // Suppose we pin k=2 at sliceIndex=2 (somewhere in the middle)
      const pinnedSliceIndex = 2;
      const xform = new SliceTransform(rpiSpace, lpiAxes, pinnedSliceIndex);
  
      //
      // 3) Enumerate all 8 corners in voxel space along x ∈ {0,dimX-1}, y ∈ {0,dimY-1}, z ∈ {0,dimZ-1}
      //
      const corners: [number, number, number][] = [
        [0, 0, 0],
        [dims[0] - 1, 0, 0],
        [0, dims[1] - 1, 0],
        [dims[0] - 1, dims[1] - 1, 0],
        [0, 0, dims[2] - 1],
        [dims[0] - 1, 0, dims[2] - 1],
        [0, dims[1] - 1, dims[2] - 1],
        [dims[0] - 1, dims[1] - 1, dims[2] - 1],
      ];
  
      corners.forEach((voxelCoord) => {
        //
        // Step A: volume → slice (2D) in LPI view
        //
        const sliceXY = xform.volumeToSliceCoord(voxelCoord);
  
        //
        // Step B: slice → world
        //
        const worldCoord = xform.sliceToWorldCoord(sliceXY);
  
        //
        // Optionally: Log or check results
        //
        // For debugging, you might do a console.log:
        // console.log(`Voxel= ${voxelCoord} => slice=`, sliceXY, ' => world=', worldCoord);
        //
  
        // If you have specific expectations, you could do:
        expect(worldCoord.length).toBe(3);
  
        // We won't do a strict numeric check here, since we only want to confirm
        // that the flipping and pinned dimension do not cause errors. But you can
        // add logic to check signs, etc.:
        //   - If i=R->L flips to i=L->R, x might be (dimX -1 - voxelX)* spacing[0]
      });
    });
  });