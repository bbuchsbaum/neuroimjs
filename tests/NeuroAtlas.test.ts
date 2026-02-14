import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NeuroAtlas } from '../src/atlas/NeuroAtlas';
import { ClusteredNeuroVol } from '../src/volume/ClusteredNeuroVol';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { ROIVol } from '../src/roi/ROI';

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
