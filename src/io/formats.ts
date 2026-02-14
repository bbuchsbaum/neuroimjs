import { ValueError } from '../types';

/**
 * Abstract base class for neuroimaging file formats.
 * 
 * Direct translation of Python's FileFormat class.
 */
export abstract class FileFormat {
  readonly fileFormat: string;
  readonly headerEncoding: string;
  readonly headerExtension: string;
  readonly dataEncoding: string;
  readonly dataExtension: string;

  constructor(
    fileFormat: string,
    headerEncoding: string,
    headerExtension: string,
    dataEncoding: string,
    dataExtension: string
  ) {
    this.fileFormat = fileFormat;
    this.headerEncoding = headerEncoding;
    this.headerExtension = headerExtension;
    this.dataEncoding = dataEncoding;
    this.dataExtension = dataExtension;
  }

  /**
   * Check if a file matches this format and both header/data files exist.
   */
  abstract fileMatches(fileName: string): Promise<boolean>;

  /**
   * Check if file name matches header format.
   */
  headerFileMatches(fileName: string): boolean {
    return fileName.endsWith('.' + this.headerExtension);
  }

  /**
   * Check if file name matches data format.
   */
  dataFileMatches(fileName: string): boolean {
    return fileName.endsWith('.' + this.dataExtension);
  }

  /**
   * Strip extension from filename.
   */
  stripExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  }

  /**
   * Get header filename from base name.
   */
  getHeaderFile(baseName: string): string {
    return baseName + '.' + this.headerExtension;
  }

  /**
   * Get data filename from base name.
   */
  getDataFile(baseName: string): string {
    return baseName + '.' + this.dataExtension;
  }
}

/**
 * NIfTI-1 file format descriptor.
 */
export class NIFTIFormat extends FileFormat {
  constructor(encoding: 'raw' | 'gzip' = 'raw') {
    const extension = encoding === 'gzip' ? 'nii.gz' : 'nii';
    super('NIFTI', encoding, extension, encoding, extension);
  }

  async fileMatches(fileName: string): Promise<boolean> {
    // For NIfTI single file format, just check if file exists
    if (this.headerFileMatches(fileName)) {
      try {
        const fs = await import('fs/promises');
        const stats = await fs.stat(fileName);
        return stats.isFile();
      } catch {
        return false;
      }
    }
    return false;
  }
}

/**
 * NIfTI-1 dual file format descriptor (separate .hdr and .img files).
 */
export class NIFTIDualFormat extends FileFormat {
  constructor(encoding: 'raw' | 'gzip' = 'raw') {
    const hdrExt = encoding === 'gzip' ? 'hdr.gz' : 'hdr';
    const imgExt = encoding === 'gzip' ? 'img.gz' : 'img';
    super('NIFTI_DUAL', encoding, hdrExt, encoding, imgExt);
  }

  async fileMatches(fileName: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      
      if (this.headerFileMatches(fileName)) {
        // Check if corresponding .img file exists
        const dataFile = this.stripExtension(fileName) + '.' + this.dataExtension;
        const stats = await fs.stat(dataFile);
        return stats.isFile();
      } else if (this.dataFileMatches(fileName)) {
        // Check if corresponding .hdr file exists
        const headerFile = this.stripExtension(fileName) + '.' + this.headerExtension;
        const stats = await fs.stat(headerFile);
        return stats.isFile();
      }
      
      return false;
    } catch {
      return false;
    }
  }
}

/**
 * AFNI file format descriptor.
 */
export class AFNIFormat extends FileFormat {
  constructor() {
    super('AFNI', 'raw', 'HEAD', 'raw', 'BRIK');
  }

  async fileMatches(fileName: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      
      if (fileName.endsWith('.HEAD')) {
        // Check if corresponding .BRIK file exists
        const dataFile = fileName.replace('.HEAD', '.BRIK');
        const stats = await fs.stat(dataFile);
        return stats.isFile();
      } else if (fileName.endsWith('.BRIK')) {
        // Check if corresponding .HEAD file exists
        const headerFile = fileName.replace('.BRIK', '.HEAD');
        const stats = await fs.stat(headerFile);
        return stats.isFile();
      }
      
      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Registry of supported file formats.
 */
export const FILE_FORMATS = {
  NIFTI: new NIFTIFormat('raw'),
  NIFTI_GZ: new NIFTIFormat('gzip'),
  NIFTI_DUAL: new NIFTIDualFormat('raw'),
  NIFTI_DUAL_GZ: new NIFTIDualFormat('gzip'),
  AFNI: new AFNIFormat(),
};

/**
 * Find the appropriate file format descriptor for a given filename.
 */
export async function findDescriptor(fileName: string): Promise<FileFormat | null> {
  for (const format of Object.values(FILE_FORMATS)) {
    if (await format.fileMatches(fileName)) {
      return format;
    }
  }
  return null;
}

/**
 * Get file format by name.
 */
export function getFormat(formatName: string): FileFormat {
  const upperName = formatName.toUpperCase();
  if (upperName in FILE_FORMATS) {
    return FILE_FORMATS[upperName as keyof typeof FILE_FORMATS];
  }
  throw new ValueError(`Unknown file format: ${formatName}`);
}