// TemplateFlow.ts

import { promises as fsPromises, createWriteStream, existsSync } from 'fs';
import { dirname, join } from 'path';
import axios from 'axios';
import * as stream from 'stream';
import { promisify } from 'util';
import * as os from 'os';

const pipeline = promisify(stream.pipeline);

// Default constants
const DEFAULT_BASE_URL = 'https://templateflow.s3.amazonaws.com/';
const DEFAULT_CACHE_DIR = join(os.homedir(), '.templateflow');
const MANIFEST_URL = 'https://templateflow.s3.amazonaws.com/templates.json'; // Assumed URL for the manifest
const MANIFEST_CACHE_FILE = 'templates_manifest.json';

export interface TemplateParams {
  cohort?: number;
  resolution?: number;
  density?: string;
  desc?: string;
  suffix?: string;
  atlas?: string;
  hemi?: 'L' | 'R';
  space?: string;
  extension?: string;
}

export class TemplateFlow {
  private baseUrl: string;
  private cacheDir: string;

  /**
   * Creates an instance of TemplateFlow.
   * @param baseUrl - The base URL of the TemplateFlow repository.
   * @param cacheDir - The directory where templates and manifests will be cached.
   */
  constructor(baseUrl: string = DEFAULT_BASE_URL, cacheDir: string = DEFAULT_CACHE_DIR) {
    this.baseUrl = baseUrl;
    this.cacheDir = cacheDir;
  }

  /**
   * Builds the file path based on the template name and search parameters.
   * @param template - The template identifier (e.g., 'MNI152Lin').
   * @param params - Search parameters to filter the template files.
   * @returns The constructed file path relative to the base URL.
   */
  public buildFilePath(template: string, params: TemplateParams): string {
    let path = `tpl-${template}/`;

    if (params.cohort !== undefined) {
      path += `cohort-${params.cohort}/`;
    }

    let filename = `tpl-${template}`;

    if (params.cohort !== undefined) {
      filename += `_cohort-${params.cohort}`;
    }

    if (params.resolution !== undefined) {
      filename += `_res-${params.resolution.toString().padStart(2, '0')}`;
    }

    if (params.density !== undefined) {
      filename += `_den-${params.density}`;
    }

    if (params.space !== undefined) {
      filename += `_space-${params.space}`;
    }

    if (params.hemi !== undefined) {
      filename += `_hemi-${params.hemi}`;
    }

    if (params.desc !== undefined) {
      filename += `_desc-${params.desc}`;
    }

    if (params.atlas !== undefined) {
      filename += `_atlas-${params.atlas}`;
    }

    if (params.suffix !== undefined) {
      filename += `_${params.suffix}`;
    } else {
      // Default suffix if not provided
      filename += `_T1w`;
    }

    if (params.extension !== undefined) {
      const ext = params.extension.startsWith('.') ? params.extension : `.${params.extension}`;
      filename += ext;
    } else {
      // Default extension if not provided
      filename += `.nii.gz`;
    }

    return path + filename;
  }

  /**
   * Downloads the template file based on the template name and search parameters.
   * Utilizes caching to avoid redundant downloads.
   * @param template - The template identifier (e.g., 'MNI152Lin').
   * @param params - Search parameters to filter the template files.
   * @returns The local file path where the template is saved.
   */
  public async downloadTemplate(template: string, params: TemplateParams): Promise<string> {
    const filePath = this.buildFilePath(template, params);
    const url = new URL(filePath, this.baseUrl).toString();

    // Define the local file path within the cache directory
    const localFilePath = join(this.cacheDir, filePath);

    try {
      // Create directories if they don't exist
      await fsPromises.mkdir(dirname(localFilePath), { recursive: true });

      // Check if file already exists in cache to avoid re-downloading
      if (existsSync(localFilePath)) {
        console.log(`File already exists in cache at ${localFilePath}`);
        return localFilePath;
      }

      // Make HTTP GET request to download the file as a stream
      const response = await axios.get(url, { responseType: 'stream' });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Failed to download file. Status code: ${response.status}`);
      }

      // Pipe the response data to the local file
      await pipeline(response.data, createWriteStream(localFilePath));

      console.log(`File downloaded successfully to ${localFilePath}`);
      return localFilePath;
    } catch (error: any) {
      // Clean up partially downloaded file in case of error
      try {
        if (existsSync(localFilePath)) {
          await fsPromises.unlink(localFilePath);
        }
      } catch {
        // Ignore unlink errors
      }
      throw new Error(`Error downloading template: ${error.message}`);
    }
  }

  /**
   * Lists available templates based on the manifest file.
   * Fetches the manifest from the remote URL or uses the cached version.
   * @returns An array of template identifiers.
   */
  public async listTemplates(): Promise<string[]> {
    const manifestPath = join(this.cacheDir, MANIFEST_CACHE_FILE);

    // Check if manifest is already cached
    if (existsSync(manifestPath)) {
      try {
        const data = await fsPromises.readFile(manifestPath, 'utf-8');
        const templates: string[] = JSON.parse(data);
        console.log(`Loaded templates from cache at ${manifestPath}`);
        return templates;
      } catch (error: any) {
        console.warn(`Failed to read cached manifest: ${error.message}. Fetching from remote.`);
        // Proceed to fetch from remote
      }
    }

    // Fetch the manifest from the remote URL
    try {
      const response = await axios.get(MANIFEST_URL, { responseType: 'json' });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Failed to fetch manifest. Status code: ${response.status}`);
      }

      const templates: string[] = response.data.templates; // Adjust based on actual manifest structure

      if (!Array.isArray(templates)) {
        throw new Error('Invalid manifest format: "templates" should be an array.');
      }

      // Ensure the cache directory exists
      await fsPromises.mkdir(this.cacheDir, { recursive: true });

      // Save the manifest to the cache
      await fsPromises.writeFile(manifestPath, JSON.stringify(templates, null, 2), 'utf-8');
      console.log(`Fetched and cached manifest at ${manifestPath}`);

      return templates;
    } catch (error: any) {
      throw new Error(`Error listing templates: ${error.message}`);
    }
  }

  /**
   * Clears the cache by deleting all cached templates and the manifest.
   * @returns void
   */
  public async clearCache(): Promise<void> {
    try {
      await fsPromises.rm(this.cacheDir, { recursive: true, force: true });
      console.log(`Cache directory ${this.cacheDir} has been cleared.`);
    } catch (error: any) {
      throw new Error(`Error clearing cache: ${error.message}`);
    }
  }
}

// Example usage:

(async () => {
  const tf = new TemplateFlow(); // Uses default cache directory (~/.templateflow)

  try {
    // Example 1: List all available templates
    const templates = await tf.listTemplates();
    console.log('Available Templates:', templates);

    // Example 2: Download MNI152Lin with resolution 1 and suffix T1w
    const filePath1 = await tf.downloadTemplate('MNI152Lin', { resolution: 1, suffix: 'T1w' });
    console.log(`Downloaded to: ${filePath1}`);

    // Example 3: Download fsLR with hemisphere 'L', density '32k', and suffix 'sphere'
    const filePath2 = await tf.downloadTemplate('fsLR', {
      hemi: 'L',
      density: '32k',
      suffix: 'sphere',
      extension: 'surf.gii',
    });
    console.log(`Downloaded to: ${filePath2}`);

    // Example 4: Attempt to download the same template again (should use cache)
    const filePath3 = await tf.downloadTemplate('MNI152Lin', { resolution: 1, suffix: 'T1w' });
    console.log(`Downloaded to: ${filePath3}`);

    // Example 5: Clear the cache
    // await tf.clearCache();
  } catch (error: any) {
    console.error(error.message);
  }
})();