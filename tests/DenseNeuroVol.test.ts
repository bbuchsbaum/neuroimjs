import { describe, it, expect, beforeAll } from 'vitest';
import { NeuroAtlas } from '../src/atlas/NeuroAtlas';
import { AxisSet3D } from '../src/geometry/Axis';
import { useSyntheticAtlasDownloads } from './helpers/syntheticAtlas';

// The Schaefer loader downloads its files. Serve a synthetic file with the
// published 2 mm geometry (91x109x91, RPI, origin [90, -126, -72]) unless
// NEUROIMJS_NETWORK_TESTS=1. (The vi.mock calls that used to sit here named
// '../utils/...' paths relative to tests/, so they never applied and this test
// silently depended on the network.)
beforeAll(() => useSyntheticAtlasDownloads());

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
