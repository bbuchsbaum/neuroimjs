import { ClusteredNeuroVol, LabelMap } from '../volume/ClusteredNeuroVol';
import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { NeuroVol } from '../volume/NeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { ROIVol } from '../roi/ROI';
import { Downloader } from '../utils/Downloader';
import { Cache } from '../utils/Cache';
import { TypedArray } from '../types';
import { read_vol } from '../io/nifti'; // Ensure this import is correct
import _ from 'lodash';

/**
 * Interface for Atlas Metadata
 */
interface AtlasMetadata {
  name: string;
  labels: string[];
  ids: number[];
  cmap: number[][];
  hemi?: string[];
  network?: string[];
  origLabels?: string[];
  dimensions?: number[];
  spacing?: number[];
}

 // Define an interface for the options
 interface SchaeferAtlasOptions {
  parcels?: 100 | 200 | 300 | 400 | 500 | 600 | 800 | 1000;
  networks?: 7 | 17;
  resolution?: 1 | 2;
  useCache?: boolean;
}


/**
 * NeuroAtlas Class
 */
export class NeuroAtlas {
  public readonly name: string;
  public readonly atlas: ClusteredNeuroVol;
  public readonly labels: string[];
  public readonly ids: number[];
  public readonly cmap: number[][];
  public readonly hemi?: string[];
  public readonly network?: string[];
  public readonly origLabels?: string[];

  constructor(atlasVol: ClusteredNeuroVol, metadata: AtlasMetadata) {
    this.atlas = atlasVol;
    this.name = metadata.name;
    this.labels = metadata.labels;
    this.ids = metadata.ids;
    this.cmap = metadata.cmap;
    this.hemi = metadata.hemi;
    this.network = metadata.network;
    this.origLabels = metadata.origLabels;
  }

  /**
   * Retrieves an ROI by label or id.
   * @param params Object containing either 'label' or 'id'.
   */
  public getROI(params: { label?: string; id?: number }): ROIVol | null {
    if (params.label && params.id !== undefined) {
      throw new Error("Please provide either 'label' or 'id', not both.");
    }

    let targetId: number | undefined;
    if (params.label) {
      // Use labelMap to get ID from label
      targetId = this.atlas.labelMap[params.label];
      if (targetId === undefined) {
        throw new Error(`Label '${params.label}' not found in atlas.`);
      }
    } else if (params.id !== undefined) {
      targetId = params.id;
      // Check if the ID exists in the cluster map
      const info = this.atlas.getClusterInfo(targetId);
      if (!info) {
        throw new Error(`ID '${targetId}' not found in atlas.`);
      }
    } else {
      throw new Error("Please provide either 'label' or 'id'.");
    }

    const coords = this.atlas.getClusterCoords(targetId);
    
    if (!coords || coords.length === 0) {
      return null; // No voxels found for the given label/id
    }

    const data = new Float32Array(coords.length).fill(targetId);

    return new ROIVol(this.atlas.space, coords, data);
  }

  /**
   * Merges two atlases into a new NeuroAtlas instance.
   * @param otherAtlas The other NeuroAtlas to merge with.
   */
  public mergeAtlases(otherAtlas: NeuroAtlas): NeuroAtlas {
    if (!_.isEqual(this.atlas.space, otherAtlas.atlas.space)) {
      throw new Error('Atlases have different spatial dimensions.');
    }
    if (!this.atlas.space.isEqualTo(otherAtlas.atlas.space)) {
      throw new Error('Atlases have different spatial dimensions.');
    }

    const newAtlasData = this.atlas.getData().slice();
    const otherData = otherAtlas.atlas.getData();
    
    const thisMaxId = Math.max(...this.ids);
    const otherMinId = Math.min(...otherAtlas.ids);

    // Determine if there's an overlap
    const hasOverlap = thisMaxId >= otherMinId;

    // Apply offset only if there's an overlap
    const offset = hasOverlap ? thisMaxId + 1 : 0;

    const mergedIds = hasOverlap 
      ? this.ids.concat(otherAtlas.ids.map(id => id + offset))
      : this.ids.concat(otherAtlas.ids);

    const mergedLabels = this.labels.concat(otherAtlas.labels);

    // Update atlas data with or without offset
    for (let i = 0; i < newAtlasData.length; i++) {
      if (otherData[i] !== 0) {
        newAtlasData[i] = offset ? (otherData[i] as number) + offset : (otherData[i] as number);
      }
    }

    // Merge label maps - LabelMap maps labels (strings) to IDs (numbers)
    const mergedLabelMap: LabelMap = {
      ...this.atlas.getLabelMap(),
    };

    // Add other atlas labels with potentially offset IDs
    otherAtlas.ids.forEach((id, index) => {
      const newId = offset ? id + offset : id;
      const label = otherAtlas.labels[index];
      mergedLabelMap[label] = newId;
    });

    // Create a mask from non-zero values in the merged atlas
    const nonZeroIndices: number[] = [];
    const mergedData = new Int32Array(newAtlasData as Int32Array);
    for (let i = 0; i < mergedData.length; i++) {
      if (mergedData[i] !== 0) {
        nonZeroIndices.push(i);
      }
    }
    
    // Create the mask as a LogicalNeuroVol
    const mask = new LogicalNeuroVol(this.atlas.space, undefined, nonZeroIndices);
    
    // Extract the cluster values for non-zero voxels
    const clusterValues = new Int32Array(nonZeroIndices.length);
    for (let i = 0; i < nonZeroIndices.length; i++) {
      clusterValues[i] = mergedData[nonZeroIndices[i]];
    }
    
    const mergedAtlasVol = new ClusteredNeuroVol(mask, clusterValues, mergedLabelMap);

    const mergedMetadata: AtlasMetadata = {
      name: `${this.name}::${otherAtlas.name}`,
      labels: mergedLabels,
      ids: mergedIds,
      cmap: [...this.cmap, ...otherAtlas.cmap],
      hemi: this.hemi && otherAtlas.hemi ? [...this.hemi, ...otherAtlas.hemi] : undefined,
      network: this.network && otherAtlas.network ? [...this.network, ...otherAtlas.network] : undefined,
      origLabels: this.origLabels && otherAtlas.origLabels ? [...this.origLabels, ...otherAtlas.origLabels] : undefined,
      dimensions: this.atlas.space.dim,
      spacing: this.atlas.space.spacing,
    };

    return new NeuroAtlas(mergedAtlasVol, mergedMetadata);
  }

  /**
   * Helper method to extract labelMap from another NeuroAtlas instance.
   * @param otherAtlas The other NeuroAtlas instance.
   * @returns A labelMap object mapping cluster labels to IDs.
   */
  private extractLabelMapFromAtlas(otherAtlas: NeuroAtlas): LabelMap {
    const labelMap: LabelMap = {};
    otherAtlas.ids.forEach((id, index) => {
      labelMap[otherAtlas.labels[index]] = id;
    });
    return labelMap;
  }

  /**
   * Displays information about the NeuroAtlas instance.
   */
  public show(): void {
    console.log(`NeuroAtlas: ${this.name}`);
    console.log(`  Dimensions    : ${this.atlas.space.dim.join(' x ')}`);
    console.log(`  Spacing       : ${this.atlas.space.spacing.join(' x ')}`);
    console.log(`  Number of ROIs: ${this.ids.length}`);
    console.log(`  Labels        : ${this.labels.join(', ')}`);
  }

  /**
   * Static method to load an atlas from a URL or local cache.
   * @param url URL to download the atlas data.
   * @param metadataUrl URL to download the atlas metadata.
   * @param useCache Whether to use cached data if available.
   */
  public static async loadAtlas(
    url: string,
    metadataUrl: string,
    useCache = true
  ): Promise<NeuroAtlas> {
    const cache = Cache.getInstance();
    let atlasData: TypedArray | null = null;
    let metadata: AtlasMetadata | null = null;

    if (useCache) {
      atlasData = cache.get<TypedArray>(url);
      metadata = cache.get<AtlasMetadata>(metadataUrl);
    }

    if (!atlasData) {
      const downloadedData = await Downloader.downloadArray(url);
      atlasData = new Int32Array(downloadedData); // Ensure it's Int32Array
      cache.set(url, atlasData);
    }

    if (!metadata) {
      metadata = await Downloader.downloadJSON<AtlasMetadata>(metadataUrl);
      cache.set(metadataUrl, metadata);
    }

    if (!atlasData) {
      throw new Error("Could not load atlas from " + url);
    }

    if (!metadata) {
      throw new Error("Could not load metadata from " + metadataUrl);
    }

    // Get dimensions and spacing from the volume if needed
    const dimensions = metadata.dimensions || (atlasData.length > 0 ? [atlasData.length] : [1]);
    const spacing = metadata.spacing || [1];

    const space = new NeuroSpace(dimensions, spacing);

    // Create labelMap from metadata.ids and metadata.labels
    // LabelMap maps labels (strings) to IDs (numbers)
    const labelMap: LabelMap = {};
    metadata.ids.forEach((id, index) => {
      labelMap[metadata.labels[index]] = id;
    });

    // Create a mask from non-zero values in the atlas
    const nonZeroIndices: number[] = [];
    const atlasDataInt32 = atlasData as Int32Array;
    for (let i = 0; i < atlasDataInt32.length; i++) {
      if (atlasDataInt32[i] !== 0) {
        nonZeroIndices.push(i);
      }
    }
    
    // Create the mask as a LogicalNeuroVol
    const mask = new LogicalNeuroVol(space, undefined, nonZeroIndices);
    
    // Extract the cluster values for non-zero voxels
    const clusterValues = new Int32Array(nonZeroIndices.length);
    for (let i = 0; i < nonZeroIndices.length; i++) {
      clusterValues[i] = atlasDataInt32[nonZeroIndices[i]];
    }
    
    const atlasVol = new ClusteredNeuroVol(mask, clusterValues, labelMap);

    return new NeuroAtlas(atlasVol, metadata);
  }

  /**
   * Static method to load the Glasser atlas.
   * @param useCache Whether to use cached data if available.
   */
  public static async loadGlasserAtlas(useCache = true): Promise<NeuroAtlas> {
    const atlasUrl = 'https://github.com/PennBBL/xcpEngine/raw/master/atlas/glasser360/glasser360MNI.nii.gz';
    const labelsUrl = 'https://github.com/PennBBL/xcpEngine/raw/master/atlas/glasser360/glasser360NodeNames.txt';

    const cache = Cache.getInstance();
    let atlasVol: NeuroVol | null = null;
    let labelsData: string | null = null;

    // Check cache
    if (useCache) {
      atlasVol = cache.get<NeuroVol>(atlasUrl);
      labelsData = cache.get<string>(labelsUrl);
    }

    // Download and read atlas volume
    if (!atlasVol) {
      const atlasArrayBuffer = await Downloader.downloadBuffer(atlasUrl);
      atlasVol = await read_vol(atlasArrayBuffer);
      cache.set(atlasUrl, atlasVol);
    }

    // Download and parse labels
    if (!labelsData) {
      labelsData = await Downloader.downloadText(labelsUrl);
      cache.set(labelsUrl, labelsData);
    }

    const labels = labelsData.trim().split('\n').map(line => line.trim());
    const ids = labels.map((_, index) => index + 1);
    const cmap = ids.map(() => [Math.random() * 255, Math.random() * 255, Math.random() * 255]); // Random colors
    const hemi = labels.map(label => label.split('_')[0].toLowerCase());
    const region = labels.map(label => label.split('_')[1]);

    const metadata: AtlasMetadata = {
      name: 'Glasser360',
      labels: region,
      ids,
      cmap,
      hemi,
    };

    // Create labelMap from metadata.ids and metadata.labels
    // LabelMap maps labels (strings) to IDs (numbers)
    const labelMap: LabelMap = {};
    metadata.ids.forEach((id, index) => {
      labelMap[metadata.labels[index]] = id;
    });

    // Safely convert to Int32Array if necessary
    let atlasVolInt32: Int32Array;

    const data = atlasVol.getData();
    if (data instanceof Int32Array) {
      atlasVolInt32 = data;
    } else if (data instanceof Float32Array) {
      // Convert Float32Array to Int32Array safely
      atlasVolInt32 = new Int32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        atlasVolInt32[i] = Math.round(data[i]);
      }
    } else if (data instanceof Float64Array) {
      // Convert Float64Array to Int32Array safely
      atlasVolInt32 = new Int32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        atlasVolInt32[i] = Math.round(data[i]);
      }
    } else if (data instanceof Uint16Array) {
      // Convert Uint16Array to Int32Array safely
      atlasVolInt32 = new Int32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        atlasVolInt32[i] = data[i];
      }
    } else {
      throw new Error(`Unsupported data type: ${data.constructor.name}`);
    }

    // Create a mask from non-zero values in the atlas
    const nonZeroIndices: number[] = [];
    for (let i = 0; i < atlasVolInt32.length; i++) {
      if (atlasVolInt32[i] !== 0) {
        nonZeroIndices.push(i);
      }
    }
    
    // Create the mask as a LogicalNeuroVol
    const mask = new LogicalNeuroVol(atlasVol.space, undefined, nonZeroIndices);
    
    // Extract the cluster values for non-zero voxels
    const clusterValues = new Int32Array(nonZeroIndices.length);
    for (let i = 0; i < nonZeroIndices.length; i++) {
      clusterValues[i] = atlasVolInt32[nonZeroIndices[i]];
    }
    
    const clusteredVol = new ClusteredNeuroVol(mask, clusterValues, labelMap);

    return new NeuroAtlas(clusteredVol, metadata);
  }

 

  /**
   * Static method to load the Schaefer atlas.
   * @param options Configuration options for loading the atlas.
   */
  public static async loadSchaeferAtlas(
    options: SchaeferAtlasOptions = {}
  ): Promise<NeuroAtlas> {
    const {
      parcels = 100,
      networks = 7,
      resolution = 1,
      useCache = true,
    } = options;

    // Convert numbers to strings for URL construction
    const parcelsStr = parcels.toString();
    const networksStr = networks.toString();
    const resolutionStr = resolution.toString();

    const baseAtlasUrl =
      'https://raw.githubusercontent.com/ThomasYeoLab/CBIG/master/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal/Parcellations/MNI';
    const atlasFilename = `Schaefer2018_${parcelsStr}Parcels_${networksStr}Networks_order_FSLMNI152_${resolutionStr}mm.nii.gz`;
    const atlasUrl = `${baseAtlasUrl}/${atlasFilename}`;

    const labelsFilename = `Schaefer2018_${parcelsStr}Parcels_${networksStr}Networks_order.txt`;
    const labelsUrl = `${baseAtlasUrl}/freeview_lut/${labelsFilename}`;

    const cache = Cache.getInstance();
    let atlasVol: NeuroVol | null = null;
    let labelsData: string | null = null;

    // Check cache
    if (useCache) {
      atlasVol = cache.get<NeuroVol>(atlasUrl);
      labelsData = cache.get<string>(labelsUrl);
    }

    // Download and read atlas volume
    if (!atlasVol) {
      const atlasArrayBuffer = await Downloader.downloadBuffer(atlasUrl);
      atlasVol = await read_vol(atlasArrayBuffer);
      cache.set(atlasUrl, atlasVol);
    }

    // Download and parse labels
    if (!labelsData) {
      labelsData = await Downloader.downloadText(labelsUrl);
      cache.set(labelsUrl, labelsData);
    }

    const labels = labelsData.trim().split('\n').map(line => line.trim().split('\t'));
    const ids = labels.map(label => parseInt(label[0], 10));
    
    console.log("Schaefer atlas - Number of labels:", labels.length);
    console.log("Schaefer atlas - ID range:", Math.min(...ids), "to", Math.max(...ids));
    console.log("Schaefer atlas - IDs:", ids.length > 20 ? 
               ids.slice(0, 5).join(', ') + '...' + ids.slice(-5).join(', ') : 
               ids.join(', '));
    
    const fullLabels = labels.map(label => label[1]);
    
    // Check the raw volume data
    console.log("Schaefer atlas - Volume data type:", atlasVol.getData().constructor.name);
    
    // Sample the volume to see what IDs are actually present
    const volumeData = atlasVol.getData();
    const nonZeroValues = new Set();
    for (let i = 0; i < Math.min(volumeData.length, 1000000); i++) {
      const value = volumeData[i];
      if (value !== 0) nonZeroValues.add(value);
    }
    
    console.log("Schaefer atlas - Sample of non-zero values in volume:", 
               Array.from(nonZeroValues).sort((a: any, b: any) => a - b).slice(0, 20));
    
    const cmap = labels.map(label => [
      parseInt(label[2], 10),
      parseInt(label[3], 10),
      parseInt(label[4], 10),
    ]);
    const hemi = fullLabels.map(label => label.split('_')[1]);
    const network = fullLabels.map(label => label.split('_')[2]);
    const origLabels = fullLabels;
    const regionNames = fullLabels.map(label => {
      const parts = label.split('_');
      return parts.slice(parts.length - 2).join('_');
    });

    const metadata: AtlasMetadata = {
      name: `Schaefer${parcels}Parcels_${networks}Networks`,
      labels: regionNames,
      ids,
      cmap,
      hemi,
      network,
      origLabels,
      dimensions: atlasVol.space.dim,
      spacing: atlasVol.space.spacing,
    };

    // Create labelMap from metadata.ids and metadata.labels
    // LabelMap maps labels (strings) to IDs (numbers)
    const labelMap: LabelMap = {};
    metadata.ids.forEach((id, index) => {
      labelMap[metadata.labels[index]] = id;
    });

    // Explicitly log the number of parcels being used, which should match the atlas data
    console.log(`Creating Schaefer atlas with ${parcels} parcels, metadata has ${ids.length} labels`);

    // Check the data type of the atlas volume
    const atlasData = atlasVol.getData();
    console.log(`Atlas data type: ${atlasData.constructor.name}`);
    
    // Proper conversion from Float32Array to Int32Array if needed
    let atlasVolInt32: Int32Array;
    
    if (atlasData instanceof Int32Array) {
      console.log("Atlas data is already Int32Array, using directly");
      atlasVolInt32 = atlasData;
    } else if (atlasData instanceof Float32Array) {
      console.log("Atlas data is Float32Array, properly converting values to Int32Array");
      // Convert Float32Array to Int32Array by value, not by reinterpreting the buffer
      atlasVolInt32 = new Int32Array(atlasData.length);
      
      // Sample some values before conversion
      const nonZeroFloat = Array.from(atlasData).filter(v => v > 0).slice(0, 5);
      console.log("Sample Float32 values before conversion:", nonZeroFloat);
      
      // Convert the values properly
      for (let i = 0; i < atlasData.length; i++) {
        atlasVolInt32[i] = Math.round(atlasData[i]);
      }
      
      // Sample after conversion
      const nonZeroIndices: number[] = [];
      for (let i = 0; i < 1000 && nonZeroIndices.length < 5; i++) {
        if (atlasVolInt32[i] > 0) nonZeroIndices.push(i);
      }
      
      console.log("Sample Int32 values after conversion:", 
                 nonZeroIndices.map(i => `index ${i}: ${atlasVolInt32[i]}`));
    } else {
      console.warn(`Unexpected data type: ${atlasData.constructor.name}, attempting direct buffer reinterpretation`);
      atlasVolInt32 = new Int32Array(atlasData.buffer);
    }

    // Create a mask from non-zero values in the atlas
    const nonZeroIndices: number[] = [];
    for (let i = 0; i < atlasVolInt32.length; i++) {
      if (atlasVolInt32[i] !== 0) {
        nonZeroIndices.push(i);
      }
    }
    
    // Create the mask as a LogicalNeuroVol
    const mask = new LogicalNeuroVol(atlasVol.space, undefined, nonZeroIndices);
    
    // Extract the cluster values for non-zero voxels
    const clusterValues = new Int32Array(nonZeroIndices.length);
    for (let i = 0; i < nonZeroIndices.length; i++) {
      clusterValues[i] = atlasVolInt32[nonZeroIndices[i]];
    }
    
    const clusteredVol = new ClusteredNeuroVol(mask, clusterValues, labelMap);
    
    // Check the range after proper conversion
    const actualRange = clusteredVol.getRange();
    console.log(`Schaefer atlas original range: [${actualRange[0]}, ${actualRange[1]}]`);
    
    // Return the NeuroAtlas
    return new NeuroAtlas(clusteredVol, metadata);
  }
}
