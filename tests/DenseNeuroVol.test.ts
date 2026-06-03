import { describe, it, expect, beforeAll, vi } from 'vitest';
import { NeuroAtlas } from '../src/atlas/NeuroAtlas';
import { AxisSet3D } from '../src/geometry/Axis';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { DenseNeuroVol, FloatNeuroVol } from '../src/volume/DenseNeuroVol';

// Mock the Downloader and Cache to avoid actual network requests
vi.mock('../utils/Downloader', () => ({
  Downloader: {
    downloadBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
    downloadText: vi.fn().mockResolvedValue(`1\t17Networks_LH_VisCent_ExStr_1\t255\t0\t0
2\t17Networks_LH_VisCent_ExStr_2\t255\t0\t0
3\t17Networks_LH_VisCent_ExStr_3\t255\t0\t0
4\t17Networks_LH_VisCent_ExStr_4\t255\t0\t0
5\t17Networks_LH_VisCent_ExStr_5\t255\t0\t0`),
  }
}));

vi.mock('../utils/Cache', () => ({
  Cache: {
    getInstance: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
    }),
  }
}));

// Mock read_vol to return a simple volume
vi.mock('../io/nifti', () => ({
  read_vol: vi.fn().mockImplementation(() => {
    // Create a simple 10x10x10 volume with RPI orientation
    const space = new NeuroSpace(
      [10, 10, 10],
      [2, 2, 2],
      [90, -126, -72], // Origin similar to Schaefer atlas
      AxisSet3D.AXIAL_RPI // RPI orientation
    );
    
    // Create a simple volume with values equal to their index
    const data = new Float32Array(10 * 10 * 10);
    for (let i = 0; i < data.length; i++) {
      data[i] = i;
    }
    
    return new FloatNeuroVol(space, data);
  }),
}));

describe('DenseNeuroVol', () => {
  let atlas: NeuroAtlas;
  
  beforeAll(async () => {
    // Load the Schaefer atlas similar to sliceviewer.js
    atlas = await NeuroAtlas.loadSchaeferAtlas({
      parcels: 400,
      networks: 17,
      resolution: 2
    });
  });
  
  describe('getSlice', () => {
    it('should correctly extract a slice with LPI orientation and have correct space properties', async () => {
      // Get the atlas volume
      const vol = atlas.atlas;
      
      console.log("Original volume space:");
      vol.space.prettyPrint();
      
      // Get the middle slice with LPI orientation
      const sliceIndex = Math.floor(vol.dim[2] / 2);
      console.log(`Extracting slice at index ${sliceIndex} with LPI orientation`);
      
      // Extract the slice with LPI orientation
      const slice = vol.getSlice(sliceIndex, AxisSet3D.AXIAL_LPI);
      
      // Print the slice space
      console.log("Slice space:");
      slice.space.prettyPrint();
      
      // Calculate the expected bounds
      const bounds = slice.space.bounds();
      console.log("Slice bounds:", bounds);
      
      // Verify the slice has the correct dimensions (2D slice from 3D volume)
      expect(slice.space.dim.length).toBe(2);
      expect(slice.space.dim[0]).toBe(vol.dim[0]);
      expect(slice.space.dim[1]).toBe(vol.dim[1]);
      
      // Verify the slice has the correct orientation
      expect(slice.space.axes.axes()[0].name).toBe('LEFT_RIGHT');
      expect(slice.space.axes.axes()[1].name).toBe('POST_ANT');
      
      // Check if the slice origin is as expected
      console.log("Original volume origin:", vol.space.origin);
      console.log("Slice origin:", slice.space.origin);
      
      // For a slice extracted from a reoriented volume:
      // The original volume is RPI with origin [90, -126, -72], dims [91,109,91],
      // spacing 2. The source x-axis runs in the NEGATIVE world-x direction, so
      // flipping R->L puts the new origin at the old far end's world coordinate:
      //   90 + (91-1) * 2 * (-1) = -90   (world-preserving)
      // The y-coordinate is unchanged at -126. (The previous value 270 used the
      // wrong sign and did not preserve world geometry.)
      expect(slice.space.origin[0]).toBe(-90);
      expect(slice.space.origin[1]).toBe(-126);
      
      // Verify the slice spacing is preserved
      expect(slice.space.spacing[0]).toBe(vol.space.spacing[0]);
      expect(slice.space.spacing[1]).toBe(vol.space.spacing[1]);
      
      // Verify the slice data has the correct length
      expect(slice.getData().length).toBe(vol.dim[0] * vol.dim[1]);
    });
  });
});
