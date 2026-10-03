import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NeuroAtlas } from '../src/atlas/NeuroAtlas';
import { ClusteredNeuroVol } from '../src/volume/ClusteredNeuroVol';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { ROIVol } from '../src/roi/ROI_improved';
import { useSyntheticAtlasDownloads } from './helpers/syntheticAtlas';

// The Glasser/Schaefer loaders download their files. Serve synthetic files with
// the published datatypes, affines and label formats instead, unless
// NEUROIMJS_NETWORK_TESTS=1 asks for the real downloads. These tests check
// labels, ids and colours, not geometry, so the small grid suffices; the
// published grids are exercised in tests/atlas/labelDatatypes.test.ts,
// DenseNeuroVol.test.ts and SliceTransform.test.ts.
beforeAll(() => useSyntheticAtlasDownloads({ grid: 'small' }));

describe('NeuroAtlas', () => {
  let mockAtlasVol: ClusteredNeuroVol;
  let mockMetadata: any;
  let atlas: NeuroAtlas;

  beforeEach(() => {
    const mockSpace = new NeuroSpace([10, 10, 10], [1, 1, 1]);

    // Create a mask for the first 300 voxels (where we have data)
    const maskIndices = [];
    for (let i = 0; i < 300; i++) {
      maskIndices.push(i);
    }
    const mask = new LogicalNeuroVol(mockSpace, undefined, maskIndices);

    // Create cluster assignments for those 300 voxels
    const clusters = new Int32Array(300);
    for (let i = 0; i < 100; i++) clusters[i] = 1;
    for (let i = 100; i < 200; i++) clusters[i] = 2;
    for (let i = 200; i < 300; i++) clusters[i] = 3;

    // Define labelMap mapping labels to cluster IDs
    const labelMap: { [key: string]: number } = {
      'Region1': 1,
      'Region2': 2,
      'Region3': 3,
    };

    // Initialize ClusteredNeuroVol with mask, clusters, and labelMap
    mockAtlasVol = new ClusteredNeuroVol(mask, clusters, labelMap);

    // Define metadata
    mockMetadata = {
      name: 'MockAtlas',
      labels: ['Region1', 'Region2', 'Region3'],
      ids: [1, 2, 3],
      cmap: [
        [255, 0, 0],   // Red for Region1
        [0, 255, 0],   // Green for Region2
        [0, 0, 255],   // Blue for Region3
      ],
    };

    // Initialize NeuroAtlas with the mocked data and metadata
    atlas = new NeuroAtlas(mockAtlasVol, mockMetadata);
  });

  it('should create a NeuroAtlas instance', () => {
    expect(atlas).toBeInstanceOf(NeuroAtlas);
    expect(atlas.name).toBe('MockAtlas');
    expect(atlas.labels).toEqual(['Region1', 'Region2', 'Region3']);
    expect(atlas.ids).toEqual([1, 2, 3]);
  });

  it('should get ROI by label', () => {
    const roi = atlas.getROI({ label: 'Region1' });
    expect(roi).toBeInstanceOf(ROIVol);
    expect(roi?.coords.length).toBe(100);
  });

  it('should get ROI by id', () => {
    const roi = atlas.getROI({ id: 2 });
    expect(roi).toBeInstanceOf(ROIVol);
    expect(roi?.coords.length).toBe(100);
  });

  it('should throw an error when getting ROI with invalid label', () => {
    expect(() => atlas.getROI({ label: 'InvalidRegion' })).toThrow();
  });

  it('should throw an error when getting ROI with invalid id', () => {
    expect(() => atlas.getROI({ id: 999 })).toThrow();
  });

  it('should merge atlases', () => {
    // Create mask for the second atlas (voxels 300-499)
    const otherMaskIndices = [];
    for (let i = 300; i < 500; i++) {
      otherMaskIndices.push(i);
    }
    const otherMask = new LogicalNeuroVol(mockAtlasVol.space, undefined, otherMaskIndices);

    // Create cluster assignments for those 200 voxels
    const otherClusters = new Int32Array(200);
    for (let i = 0; i < 100; i++) otherClusters[i] = 4;
    for (let i = 100; i < 200; i++) otherClusters[i] = 5;

    const otherLabelMap: { [key: string]: number } = {
      'Region4': 4,
      'Region5': 5,
    };

    const otherAtlasVol = new ClusteredNeuroVol(otherMask, otherClusters, otherLabelMap);
    
    const otherAtlasMetadata = {
      name: 'OtherAtlas',
      labels: ['Region4', 'Region5'],
      ids: [4, 5],
      cmap: [
        [128, 128, 0],   // Olive for Region4
        [0, 128, 128],   // Teal for Region5
      ],
    };

    const otherAtlas = new NeuroAtlas(otherAtlasVol, otherAtlasMetadata);

    const mergedAtlas = atlas.mergeAtlases(otherAtlas);
    expect(mergedAtlas.name).toBe('MockAtlas::OtherAtlas');
    expect(mergedAtlas.labels).toHaveLength(5);
    expect(mergedAtlas.ids).toHaveLength(5);
    
    // Optionally, verify merged labels and IDs
    expect(mergedAtlas.labels).toEqual(['Region1', 'Region2', 'Region3', 'Region4', 'Region5']);
    expect(mergedAtlas.ids).toEqual([1, 2, 3, 4, 5]);
  });

  /**
   * New Test: Load the Glasser Atlas and Validate Its Properties
   */
  it('should load the Glasser atlas and validate its properties', async () => {
    // Load the Glasser atlas
    const glasserAtlas = await NeuroAtlas.loadGlasserAtlas();

    // Assertions to verify the loaded atlas
    expect(glasserAtlas).toBeInstanceOf(NeuroAtlas);
    expect(glasserAtlas.name).toBe('Glasser360');

    // Assuming the Glasser atlas has 360 regions
    expect(glasserAtlas.labels).toHaveLength(360);
    expect(glasserAtlas.ids).toHaveLength(360);

    // Verify that IDs are unique and sequential starting from 1
    const uniqueIds = new Set(glasserAtlas.ids);
    expect(uniqueIds.size).toBe(360);
    expect(Math.min(...glasserAtlas.ids)).toBe(1);
    expect(Math.max(...glasserAtlas.ids)).toBe(360);

    // Optionally, check a few sample labels and colors
    expect(glasserAtlas.labels).toContain('PSL'); // Example label
    expect(glasserAtlas.cmap).toHaveLength(360);
    glasserAtlas.cmap.forEach(color => {
      expect(color).toHaveLength(3); // Each color should have RGB components
      color.forEach(component => {
        expect(component).toBeGreaterThanOrEqual(0);
        expect(component).toBeLessThanOrEqual(255);
      });
    });

    // Verify hemisphere information if available
    if (glasserAtlas.hemi) {
      expect(glasserAtlas.hemi.length).toBe(360);
      glasserAtlas.hemi.forEach(hemi => {
        expect(['left', 'right']).toContain(hemi.toLowerCase());
      });
    }

    // Verify network information if available
    if (glasserAtlas.network) {
      expect(glasserAtlas.network.length).toBe(360);
      // Example: Check that network names are non-empty strings
      glasserAtlas.network.forEach(network => {
        expect(typeof network).toBe('string');
        expect(network.length).toBeGreaterThan(0);
      });
    }
  }, 30000); // Increased timeout to handle network latency
});


const networkSizes = [200, 400, 600, 800, 1000];
const resolutions = [1, 2];
const networkNumbers = [7, 17];

describe('NeuroAtlas - Schaefer Atlas', () => {
  describe.each(networkSizes)('Network Size: %i', (networkSize) => {
    describe.each(resolutions)('Resolution: %imm', (resolution) => {
      describe.each(networkNumbers)('Network Number: %i', (networkNum) => {
        it(`should load Schaefer atlas with ${networkSize} networks, ${resolution}mm resolution, ${networkNum} network number`, async () => {
          // Load the Schaefer atlas with the specified parameters
          const schaeferAtlas = await NeuroAtlas.loadSchaeferAtlas({
            parcels: networkSize,
            networks: networkNum as 7 | 17, // Type assertion to match the interface
            resolution: resolution as 1 | 2,  // Type assertion to match the interface
          });

          // Assertions to verify the loaded atlas
          expect(schaeferAtlas).toBeInstanceOf(NeuroAtlas);
          expect(schaeferAtlas.name).toMatch(/Schaefer/);

          // Validate network size
          expect(schaeferAtlas.labels.length).toBe(networkSize);
          expect(schaeferAtlas.ids.length).toBe(networkSize);

          // Validate network numbers if applicable
          if ([7, 17].includes(networkNum)) {
            // Example: Check if network groups are correctly assigned
            // This assumes that the atlas has a property or method to get network groups
            // Adjust accordingly based on your actual implementation
            // const networks = schaeferAtlas.getNetworks(networkNum);
            // expect(networks.length).toBe(networkNum);
            // networks.forEach(network => {
            //   expect(network).toBeDefined();
            //   // Additional validations can be added here
            // });
          }

          // Validate resolution-specific properties
          // Assuming you have a property to store resolution
          // expect(schaeferAtlas.resolution).toBe(resolution);

          // Optionally, verify color maps, hemispheres, networks, etc.
          expect(schaeferAtlas.cmap).toHaveLength(networkSize);
          schaeferAtlas.cmap.forEach(color => {
            expect(color).toHaveLength(3); // Each color should have RGB components
            color.forEach(component => {
              expect(component).toBeGreaterThanOrEqual(0);
              expect(component).toBeLessThanOrEqual(255);
            });
          });

          // Additional validations based on atlas structure
        }, 30000); // Increased timeout if loading involves network operations
      });
    });
  });
});

describe('NeuroAtlas - hemisphere-qualified label maps', () => {
  // Glasser and Schaefer reuse region names across hemispheres; the label map
  // used to be keyed by the bare name, so the left entry overwrote the right.

  it('Glasser: both hemispheres of a region are addressable by label', async () => {
    const atlas = await NeuroAtlas.loadGlasserAtlas({ useCache: false });
    const labelMap = atlas.atlas.getLabelMap();
    expect(Object.keys(labelMap)).toHaveLength(360);
    expect(labelMap['Right_V1']).toBe(1);
    expect(labelMap['Left_V1']).toBe(181);
    expect(atlas.origLabels?.[0]).toBe('Right_V1');
    expect(atlas.origLabels?.[180]).toBe('Left_V1');
    // Region names are unchanged.
    expect(atlas.labels[0]).toBe('V1');
    expect(atlas.labels[180]).toBe('V1');

    const right = atlas.getROI({ label: 'Right_V1' });
    const left = atlas.getROI({ label: 'Left_V1' });
    expect(right?.coords.length).toBeGreaterThan(0);
    expect(left?.coords.length).toBeGreaterThan(0);
    expect(right?.coords.length).toBe(atlas.getROI({ id: 1 })?.coords.length);
    expect(left?.coords.length).toBe(atlas.getROI({ id: 181 })?.coords.length);
    expect(right?.coords[0]).not.toEqual(left?.coords[0]);

    // Reverse lookup names the hemisphere.
    expect(atlas.atlas.getClusterInfo(1)?.label).toBe('Right_V1');
    expect(atlas.atlas.getClusterInfo(181)?.label).toBe('Left_V1');

    // A bare region name present in both hemispheres is ambiguous.
    expect(() => atlas.getROI({ label: 'V1' })).toThrow(/ambiguous.*Right_V1, Left_V1/);
  }, 30000);

  it('Schaefer: both hemispheres of a parcel are addressable by label', async () => {
    const atlas = await NeuroAtlas.loadSchaeferAtlas({
      parcels: 100,
      networks: 7,
      resolution: 2,
      useCache: false,
    });
    const labelMap = atlas.atlas.getLabelMap();
    expect(Object.keys(labelMap)).toHaveLength(100);
    const lhId = labelMap['7Networks_LH_Vis_1'];
    const rhId = labelMap['7Networks_RH_Vis_1'];
    expect(lhId).toBeDefined();
    expect(rhId).toBeDefined();
    expect(lhId).not.toBe(rhId);
    expect(atlas.hemi?.[atlas.ids.indexOf(lhId)]).toBe('LH');
    expect(atlas.hemi?.[atlas.ids.indexOf(rhId)]).toBe('RH');

    expect(atlas.getROI({ label: '7Networks_LH_Vis_1' })?.coords.length).toBe(
      atlas.getROI({ id: lhId })?.coords.length
    );
    expect(atlas.getROI({ label: '7Networks_RH_Vis_1' })?.coords.length).toBe(
      atlas.getROI({ id: rhId })?.coords.length
    );
    expect(() => atlas.getROI({ label: 'Vis_1' })).toThrow(/ambiguous/);
  }, 30000);

  it('a region name that occurs once still resolves', () => {
    const space = new NeuroSpace([4, 4, 4], [1, 1, 1]);
    const mask = new LogicalNeuroVol(space, undefined, [0, 1, 2]);
    const vol = new ClusteredNeuroVol(mask, new Int32Array([1, 1, 2]), { L_A: 1, R_B: 2 });
    const atlas = new NeuroAtlas(vol, {
      name: 'tiny',
      labels: ['A', 'B'],
      ids: [1, 2],
      cmap: [
        [0, 0, 0],
        [1, 1, 1],
      ],
      origLabels: ['L_A', 'R_B'],
    });
    expect(atlas.getROI({ label: 'A' })?.coords.length).toBe(2);
    expect(atlas.getROI({ label: 'R_B' })?.coords.length).toBe(1);
    expect(() => atlas.getROI({ label: 'C' })).toThrow(/not found/);
  });
});
