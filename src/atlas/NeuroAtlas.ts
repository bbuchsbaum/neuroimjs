import { ClusteredNeuroVol, LabelMap } from '../volume/ClusteredNeuroVol';
import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { NeuroVol } from '../volume/NeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { ROIVol } from '../roi/ROI_improved';
import { Downloader } from '../utils/Downloader';
import { Cache } from '../utils/Cache';
import { TypedArray } from '../types';
import { read_vol } from '../io/nifti'; // Ensure this import is correct
import { deepEqual } from '../utils/deepEqual';
import { getLogger } from '../display/logging/Logger';
import { toInt32Labels } from './labels';
import { resolveRng, type RandomOptions } from '../utils/rng';

const log = getLogger('atlas');

/**
 * Interface for Atlas Metadata
 */
export interface AtlasMetadata {
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
export interface SchaeferAtlasOptions {
  parcels?: 100 | 200 | 300 | 400 | 500 | 600 | 800 | 1000;
  networks?: 7 | 17;
  resolution?: 1 | 2;
  useCache?: boolean;
}

/**
 * Options for {@link NeuroAtlas.loadGlasserAtlas}.
 *
 * The Glasser label file has no colours, so each region gets a random colour.
 * `seed` or `rng` choose the colours; without either the default seed
 * {@link GLASSER_DEFAULT_COLOR_SEED} is used, so colours are the same on every
 * load.
 */
export interface GlasserAtlasOptions extends RandomOptions {
  /** Use cached downloads when available (default true). */
  useCache?: boolean;
}

/** Seed for the Glasser region colours when no `seed` or `rng` is given. */
export const GLASSER_DEFAULT_COLOR_SEED = 360;

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

    // ROI_improved.ROIVol signature: (data, space, coords)
    return new ROIVol(data, this.atlas.space, coords);
  }

  /**
   * Merges two atlases into a new NeuroAtlas instance.
   * @param otherAtlas The other NeuroAtlas to merge with.
   */
  public mergeAtlases(otherAtlas: NeuroAtlas): NeuroAtlas {
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
   * Build a ClusteredNeuroVol from a full-grid Int32 label array: voxels with
   * a non-zero label form the mask and keep their label as cluster id.
   */
  private static clusteredFromLabels(
    space: NeuroSpace,
    labels: Int32Array,
    labelMap: LabelMap
  ): ClusteredNeuroVol {
    const nonZeroIndices: number[] = [];
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== 0) nonZeroIndices.push(i);
    }
    const mask = new LogicalNeuroVol(space, undefined, nonZeroIndices);
    const clusterValues = new Int32Array(nonZeroIndices.length);
    for (let i = 0; i < nonZeroIndices.length; i++) {
      clusterValues[i] = labels[nonZeroIndices[i]];
    }
    return new ClusteredNeuroVol(mask, clusterValues, labelMap);
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
      atlasData = toInt32Labels(await Downloader.downloadArray(url));
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

    const atlasVol = NeuroAtlas.clusteredFromLabels(space, toInt32Labels(atlasData), labelMap);

    return new NeuroAtlas(atlasVol, metadata);
  }

  /**
   * Static method to load the Glasser atlas.
   *
   * Region colours are drawn from a seeded generator (see
   * {@link GlasserAtlasOptions}); they are reproducible, and identical across
   * loads unless a different `seed` or `rng` is passed.
   *
   * @param options Options, or a boolean for `useCache` (the former signature).
   */
  public static async loadGlasserAtlas(
    options: boolean | GlasserAtlasOptions = {}
  ): Promise<NeuroAtlas> {
    const opts: GlasserAtlasOptions =
      typeof options === 'boolean' ? { useCache: options } : options;
    const useCache = opts.useCache ?? true;
    const rng = resolveRng(opts, GLASSER_DEFAULT_COLOR_SEED);
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
    const cmap = ids.map(() => [rng() * 255, rng() * 255, rng() * 255]); // Random colors
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

    // Convert labels by value; any integer or integral float datatype works.
    const atlasVolInt32 = toInt32Labels(atlasVol);
    const clusteredVol = NeuroAtlas.clusteredFromLabels(atlasVol.space, atlasVolInt32, labelMap);

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
    const fullLabels = labels.map(label => label[1]);

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

    // Convert labels by value; any integer or integral float datatype works.
    const atlasVolInt32 = toInt32Labels(atlasVol);
    const clusteredVol = NeuroAtlas.clusteredFromLabels(atlasVol.space, atlasVolInt32, labelMap);
    log.debug('Loaded Schaefer atlas', {
      parcels,
      networks,
      labels: ids.length,
      datatype: atlasVol.getData().constructor.name,
      range: clusteredVol.getRange(),
    });

    // Return the NeuroAtlas
    return new NeuroAtlas(clusteredVol, metadata);
  }
}
