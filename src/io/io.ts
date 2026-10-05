import * as pako from 'pako';
import { NeuroVol } from '../volume/NeuroVol';
import { NeuroVec } from '../vec/NeuroVec';
import { DenseNeuroVec } from '../vec/NeuroVec';
import { FloatNeuroVol, Int16NeuroVol, UInt8NeuroVol, Float64NeuroVol } from '../volume/DenseNeuroVol';
import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { BigNeuroVec } from '../vector/BigNeuroVec';
import { SparseNeuroVec } from '../vec/SparseNeuroVec';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { nearestAnatomy } from '../geometry/Axis';
import { Matrix } from 'ml-matrix';
import { createNeuroVol } from '../volume/NeuroIm';
import { ValueError, SliceTypedArrayType, TypedArray } from '../types';
import { FileFormat, NIFTIFormat, findDescriptor, getFormat } from './formats';
import { affineVoxelSizes, niftiScaling } from './niftiGeometry';

type NiftiReaderModule = typeof import('nifti-reader-js');

// Keep the ESM-only nifti-reader-js dependency lazy so the CommonJS package
// entry can still be loaded. `new Function` intentionally preserves native
// dynamic import when this source is compiled with TypeScript's CommonJS mode.
const importEsm = new Function(
  'specifier',
  'return import(specifier)'
) as (specifier: string) => Promise<NiftiReaderModule>;
let niftiReaderPromise: Promise<NiftiReaderModule> | undefined;

function loadNiftiReader(): Promise<NiftiReaderModule> {
  niftiReaderPromise ??= importEsm('nifti-reader-js').catch((error: unknown) => {
    // Code evaluated through `vm` without an `importModuleDynamically` hook
    // (vitest/vite-node on Node < 26, Jest, some sandboxes) cannot run an
    // `import()` created by `new Function`. Those hosts do resolve a literal
    // `import()` in this module, so retry with one. Plain Node never reaches
    // this branch, so the CommonJS build keeps its native dynamic import.
    if ((error as { code?: string } | null)?.code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING') {
      return import('nifti-reader-js');
    }
    throw error;
  });
  return niftiReaderPromise;
}

/** Return an exact, standalone ArrayBuffer for a possibly shared Uint8Array view. */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.buffer instanceof ArrayBuffer) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

/**
 * Options for reading volumes.
 */
export interface ReadVolOptions {
  /** For 4D files, which 3D volume to extract (0-based). Default is 0. */
  index?: number;
  /** Whether to use memory mapping for large files */
  memoryMap?: boolean;
  /** Progress callback */
  onProgress?: (progress: number) => void;
}

/**
 * Options for writing volumes.
 */
export interface WriteVolOptions {
  /**
   * Output format: `'NIFTI'` (default) or `'NIFTI_GZ'`. `'NIFTI'` names the
   * single-file NIfTI-1 container and leaves compression to the extension (or
   * `compress`); `'NIFTI_GZ'` requests gzip.
   */
  format?: string;
  /** Output data type (e.g., "FLOAT32", "INT16") */
  dataType?: string;
  /**
   * Whether to gzip the output. By default this follows the path: `.nii.gz`
   * is gzipped and `.nii` is not. A value that contradicts a `.nii` or
   * `.nii.gz` extension throws a `NeuroimError` with code `INVALID_ARGUMENT`.
   * For any other extension it defaults to `false`.
   */
  compress?: boolean;
  /** Progress callback */
  onProgress?: (progress: number) => void;
}

/**
 * Header information from neuroimaging file.
 *
 * Fields are raw header values, not the interpreted geometry or intensities
 * that `readVol` produces.
 */
export interface HeaderInfo {
  dim: number[];
  /**
   * Raw `pixdim[1..3]` from the header. This can differ from the voxel sizes
   * of `affine` (for example when the sform's scaling disagrees with pixdim);
   * `readVol` sets `space.spacing` from the affine's column norms instead.
   */
  spacing: number[];
  origin: number[];
  datatype: string;
  bitpix: number;
  affine: number[][];
  description: string;
  qformCode: number;
  sformCode: number;
  voxOffset: number;
  sclSlope: number;
  sclInter: number;
}

/**
 * Read a NIfTI file and return a NeuroVol object.
 * 
 * Enhanced version with async operations and progress callback.
 */
export async function readVol(
  input: string | ArrayBuffer,
  options: ReadVolOptions = {}
): Promise<NeuroVol> {
  const { index = 0, onProgress } = options;
  try {
    const { header, imageBuffer } = await decodeNifti(input, onProgress);
    onProgress?.(0.8);
    return volumeFromImage(header, imageBuffer, index);
  } finally {
    onProgress?.(1.0);
  }
}

/**
 * Read, decompress and parse a NIfTI file or buffer once, returning the header
 * and the raw image bytes for all volumes.
 */
async function decodeNifti(
  input: string | ArrayBuffer,
  onProgress?: (progress: number) => void
): Promise<{ header: any; imageBuffer: ArrayBuffer }> {
  const nifti = await loadNiftiReader();
  let buffer: ArrayBuffer;

  if (typeof input === 'string') {
    // Check file format
    const format = await findDescriptor(input);
    if (!format) {
      throw new ValueError(`Cannot determine file format for: ${input}`, {
        code: 'UNSUPPORTED_FORMAT',
        details: { path: input },
      });
    }
    
    // Read file asynchronously
    const fs = await import('fs/promises');
    onProgress?.(0.1);
    
    const data = await fs.readFile(input);
    onProgress?.(0.3);
    
    buffer = toArrayBuffer(data);
    
    // Handle compression based on format
    if (format.headerEncoding === 'gzip') {
      onProgress?.(0.4);
      try {
        const compressed = new Uint8Array(buffer);
        const decompressed = pako.ungzip(compressed);
        buffer = toArrayBuffer(decompressed);
        onProgress?.(0.5);
      } catch (err) {
        // If pako fails, try nifti-reader decompression
        if (nifti.isCompressed(buffer)) {
          buffer = toArrayBuffer(new Uint8Array(nifti.decompress(buffer)));
          onProgress?.(0.5);
        } else {
          throw err;
        }
      }
    }
  } else {
    buffer = input;
    onProgress?.(0.3);
    // An ArrayBuffer passed directly may still be gzip-compressed (e.g. raw
    // bytes of a .nii.gz downloaded over the network). Decompress if needed.
    if (nifti.isCompressed(buffer)) {
      buffer = toArrayBuffer(new Uint8Array(nifti.decompress(buffer)));
      onProgress?.(0.5);
    }
  }

  if (!nifti.isNIFTI(buffer)) {
    throw new ValueError('The file is not a valid NIfTI file.', { code: 'CORRUPT_FILE' });
  }
  
  // Read header
  const header = nifti.readHeader(buffer);
  if (!header) {
    throw new ValueError('NIfTI header is null or undefined', { code: 'CORRUPT_FILE' });
  }
  onProgress?.(0.6);
  
  // Validate dimensions
  if (!header.dims || header.dims.length < 4) {
    throw new ValueError('Invalid header dimensions', { code: 'CORRUPT_FILE' });
  }
  
  const numDims = header.dims[0];
  if (numDims < 3 || numDims > 4) {
    throw new ValueError(`Expected 3D or 4D image, found ${numDims}D image`, {
      code: 'UNSUPPORTED_FORMAT',
      details: { rank: numDims },
    });
  }
  
  const imageBuffer = nifti.readImage(header, buffer);
  return { header, imageBuffer };
}

/** Number of volumes in a decoded 3D (1) or 4D NIfTI image. */
function volumeCount(header: any): number {
  return header.dims[0] === 4 ? header.dims[4] : 1;
}

/** Build the 3D volume at `index` from already-decoded image bytes. */
function volumeFromImage(header: any, imageBuffer: ArrayBuffer, index: number): NeuroVol {
  const dim = [header.dims[1], header.dims[2], header.dims[3]];
  if (header.dims[0] !== 4) {
    return createVolFromBuffer(imageBuffer, header, dim);
  }

  const numVols = volumeCount(header);
  if (index < 0 || index >= numVols) {
    throw new ValueError(`Index ${index} out of range for 4D data with ${numVols} volumes`, {
      code: 'OUT_OF_RANGE',
      details: { index, volumeCount: numVols },
    });
  }
  const volBytes = dim[0] * dim[1] * dim[2] * (header.numBitsPerVoxel / 8);
  const startByte = index * volBytes;
  return createVolFromBuffer(imageBuffer.slice(startByte, startByte + volBytes), header, dim);
}

/**
 * Decide whether a writer gzips its output.
 *
 * The extension decides for NIfTI paths: `.nii.gz` is gzipped and `.nii` is
 * not, so the file can be read back (the readers gunzip by extension). Options
 * may confirm that choice but not contradict it; a contradiction throws
 * `INVALID_ARGUMENT` rather than writing a file that no reader opens. For other
 * extensions, `compress` decides, then `format: 'NIFTI_GZ'`, else no gzip.
 * `format: 'NIFTI'` is encoding-neutral.
 */
function resolveGzip(filePath: string, formatDesc: FileFormat, options: WriteVolOptions): boolean {
  const lower = filePath.toLowerCase();
  const fromExtension = lower.endsWith('.nii.gz') ? true : lower.endsWith('.nii') ? false : undefined;
  const fromFormat = formatDesc.headerEncoding === 'gzip' ? true : undefined;
  const { compress } = options;

  if (compress !== undefined && fromFormat !== undefined && compress !== fromFormat) {
    throw new ValueError(`compress: ${compress} contradicts format '${options.format}'`, {
      code: 'INVALID_ARGUMENT',
      details: { path: filePath, format: options.format, compress },
    });
  }
  const requested = compress ?? fromFormat;
  if (fromExtension !== undefined && requested !== undefined && requested !== fromExtension) {
    const wanted = requested ? 'gzip' : 'uncompressed';
    const fix = requested ? 'end the path in .nii.gz' : 'end the path in .nii';
    throw new ValueError(
      `Cannot write ${wanted} NIfTI to ${filePath}: the extension implies ` +
        `${fromExtension ? 'gzip' : 'no compression'}. Drop the option or ${fix}.`,
      { code: 'INVALID_ARGUMENT', details: { path: filePath, format: options.format, compress } }
    );
  }
  return fromExtension ?? requested ?? false;
}

/**
 * Get the NIfTI format descriptor for a writer, rejecting non-NIfTI formats.
 */
function niftiWriteFormat(format: string, what: string): FileFormat {
  const formatDesc = getFormat(format);
  if (!(formatDesc instanceof NIFTIFormat)) {
    throw new ValueError(`Format ${format} not yet supported for writing${what}`, {
      code: 'UNSUPPORTED_FORMAT',
      details: { format },
    });
  }
  return formatDesc;
}

/**
 * Write a NeuroVol to file.
 * 
 * Enhanced version with async operations, compression, and progress callback.
 */
export async function writeVol(
  vol: NeuroVol,
  filePath: string,
  options: WriteVolOptions = {}
): Promise<void> {
  const { format = 'NIFTI', dataType, onProgress } = options;

  onProgress?.(0.1);
  const formatDesc = niftiWriteFormat(format, '');
  const gzip = resolveGzip(filePath, formatDesc, options);

  // Create NIfTI buffer
  const buffer = await createNiftiBuffer(vol, dataType);
  onProgress?.(0.6);

  let outputBuffer: ArrayBuffer = buffer;
  if (gzip) {
    onProgress?.(0.7);
    const compressed = pako.gzip(new Uint8Array(buffer));
    outputBuffer = compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength
    ) as ArrayBuffer;
    onProgress?.(0.8);
  }

  const fs = await import('fs/promises');
  await fs.writeFile(filePath, new Uint8Array(outputBuffer));
  onProgress?.(1.0);
}

/**
 * Read header information from neuroimaging file.
 */
export async function readHeader(fileName: string): Promise<HeaderInfo> {
  const nifti = await loadNiftiReader();
  const fs = await import('fs/promises');
  
  // Determine format
  const format = await findDescriptor(fileName);
  if (!format) {
    throw new ValueError(`Cannot determine file format for: ${fileName}`, {
      code: 'UNSUPPORTED_FORMAT',
      details: { path: fileName },
    });
  }
  
  // Read file
  let data = await fs.readFile(fileName);
  let buffer = toArrayBuffer(data);
  
  // Handle compression
  if (format.headerEncoding === 'gzip') {
    const compressed = new Uint8Array(buffer);
    const decompressed = pako.ungzip(compressed);
    buffer = toArrayBuffer(decompressed);
  }
  
  if (!nifti.isNIFTI(buffer)) {
    throw new ValueError('Not a valid NIfTI file', { code: 'CORRUPT_FILE' });
  }
  
  const header = nifti.readHeader(buffer);
  if (!header) {
    throw new ValueError('Failed to read NIfTI header', { code: 'CORRUPT_FILE' });
  }
  
  // Extract header info
  const affine = [
    [header.affine[0][0], header.affine[0][1], header.affine[0][2], header.affine[0][3]],
    [header.affine[1][0], header.affine[1][1], header.affine[1][2], header.affine[1][3]],
    [header.affine[2][0], header.affine[2][1], header.affine[2][2], header.affine[2][3]],
    [header.affine[3][0], header.affine[3][1], header.affine[3][2], header.affine[3][3]]
  ];
  
  return {
    dim: Array.from(header.dims),
    spacing: Array.from(header.pixDims.slice(1, 4)),
    origin: [header.affine[0][3], header.affine[1][3], header.affine[2][3]],
    datatype: getDatatypeName(header.datatypeCode),
    bitpix: header.numBitsPerVoxel,
    affine: affine,
    description: header.description || '',
    qformCode: header.qform_code,
    sformCode: header.sform_code,
    voxOffset: header.vox_offset,
    sclSlope: header.scl_slope,
    sclInter: header.scl_inter
  };
}

/**
 * Read multiple volumes from a list of files.
 */
export async function readVolList(
  fileNames: string[],
  options: ReadVolOptions = {}
): Promise<NeuroVol[]> {
  const volumes: NeuroVol[] = [];
  const totalFiles = fileNames.length;
  
  for (let i = 0; i < totalFiles; i++) {
    const fileName = fileNames[i];
    
    // Create progress callback that accounts for overall progress
    const fileProgress = options.onProgress
      ? (p: number) => options.onProgress!((i + p) / totalFiles)
      : undefined;
    
    const vol = await readVol(fileName, { ...options, onProgress: fileProgress });
    volumes.push(vol);
  }
  
  return volumes;
}

/**
 * Read a 4D neuroimaging vector from file.
 *
 * The file is read and decompressed once and held in memory; nothing is
 * written to disk. The result keeps the legacy time-first shape
 * (`dim = [T, X, Y, Z]`, `getAt(i, j, k, t)`); its spatial geometry, including
 * the full affine, is available as `volumeSpace` and on every `getVolume(t)`.
 *
 * The time axis of `space` gets `pixdim[4]` (the TR) as its spacing when the
 * header has a finite positive value, else 1.
 *
 * `useBigVec` is accepted for compatibility and no longer changes behaviour.
 * `mask` is currently ignored.
 */
export async function readVec(
  fileName: string,
  options: {
    indices?: number[];
    mask?: LogicalNeuroVol;
    useBigVec?: boolean;
    onProgress?: (progress: number) => void;
  } = {}
): Promise<NeuroVec> {
  const { indices, onProgress } = options;

  const { header, imageBuffer } = await decodeNifti(fileName, p => onProgress?.(p * 0.5));
  const numVols = volumeCount(header);
  const volIndices = indices ?? Array.from({ length: numVols }, (_, i) => i);
  if (volIndices.length === 0) {
    throw new ValueError('indices must select at least one volume', { code: 'INVALID_ARGUMENT' });
  }
  for (const idx of volIndices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= numVols) {
      throw new ValueError(`Index ${idx} out of range for 4D data with ${numVols} volumes`, {
        code: 'OUT_OF_RANGE',
        details: { index: idx, volumeCount: numVols },
      });
    }
  }

  let volumeSpace: NeuroSpace | undefined;
  let data: Float32Array | undefined;
  for (let i = 0; i < volIndices.length; i++) {
    const vol = volumeFromImage(header, imageBuffer, volIndices[i]);
    if (!volumeSpace || !data) {
      volumeSpace = vol.space;
      data = new Float32Array(volIndices.length * vol.length);
    }
    data.set(vol.getData(), i * vol.length);
    onProgress?.(0.5 + (0.5 * (i + 1)) / volIndices.length);
  }

  // Legacy time-first 4D space: NeuroSpace treats the leading three dims as
  // spatial, so this space does not describe world geometry. volumeSpace does.
  // The time axis gets pixdim[4] (the TR) when the header has a usable one.
  const tr = Number(header.pixDims?.[4]);
  const space4d = new NeuroSpace(
    [volIndices.length, ...volumeSpace!.dim],
    [Number.isFinite(tr) && tr > 0 ? tr : 1, ...volumeSpace!.spacing],
    [0, ...volumeSpace!.origin]
  );
  return new BigNeuroVec(data!, space4d, { storage: 'memory', volumeSpace, shareData: true });
}

/**
 * Write a NeuroVec to a 4D NIfTI-1 file.
 *
 * The layout is taken from the class, not guessed from the dimensions:
 * `BigNeuroVec` (what `readVec` returns) is time-first, `dim = [T, X, Y, Z]`,
 * with its geometry on `volumeSpace`; `DenseNeuroVec` and its subclasses
 * (`Float32NeuroVec`, `Int16NeuroVec`, ...) and `SparseNeuroVec` are
 * time-last, `dim = [X, Y, Z, T]`, with the affine on their 4D `space`. All
 * are written as NIfTI `[X, Y, Z, T]`. Any other `NeuroVec` implementation
 * throws `INVALID_ARGUMENT`.
 *
 * The header carries the full spatial affine as both qform and sform (codes
 * 1), as {@link writeVol} does; a sheared affine is written as sform only.
 * When the vec's space has a time spacing (`spacing[3]` time-last,
 * `spacing[0]` time-first) it becomes `pixdim[4]` and the units are mm and
 * seconds; otherwise `pixdim[4]` is 1 and the units are mm only. The datatype
 * follows the data (`SparseNeuroVec` writes FLOAT32) unless `dataType` is
 * given. Compression follows the extension, as for {@link writeVol}.
 */
export async function writeVec(
  vec: NeuroVec,
  fileName: string,
  options: WriteVolOptions = {}
): Promise<void> {
  const { format = 'NIFTI', dataType, onProgress } = options;

  const formatDesc = niftiWriteFormat(format, ' 4D data');
  const gzip = resolveGzip(fileName, formatDesc, options);

  const { dims, affine, data, timeStep } = niftiVecLayout(vec);
  onProgress?.(0.3);

  const buffer = encodeNifti1(dims, affine, data, dataType, timeStep);
  onProgress?.(0.8);

  let outputBuffer = new Uint8Array(buffer);
  if (gzip) {
    outputBuffer = pako.gzip(outputBuffer);
    onProgress?.(0.9);
  }

  const fs = await import('fs/promises');
  await fs.writeFile(fileName, outputBuffer);
  onProgress?.(1.0);
}

/**
 * Map a NeuroVec to NIfTI order: `[X, Y, Z, T]` dims, the spatial affine, the
 * voxel data (x fastest, one volume after another) and the time step. Both
 * layouts already store voxels in NIfTI order; only the `dim` labels differ.
 */
function niftiVecLayout(vec: NeuroVec): {
  dims: number[];
  affine: number[][];
  data: TypedArray;
  timeStep: number | undefined;
} {
  if (vec instanceof BigNeuroVec) {
    const [nt, nx, ny, nz] = vec.dim;
    const spacing = vec.space.spacing;
    return {
      dims: [nx, ny, nz, nt],
      affine: vec.volumeSpace.trans.to2DArray(),
      data: vec.getData(),
      timeStep: spacing.length === 4 ? spacing[0] : undefined,
    };
  }
  if (vec instanceof DenseNeuroVec || vec instanceof SparseNeuroVec) {
    const [nx, ny, nz, nt] = vec.dim;
    const spacing = vec.space.spacing;
    let data: TypedArray;
    if (vec instanceof DenseNeuroVec) {
      data = vec.getData();
    } else {
      const volumeLength = nx * ny * nz;
      const dense = new Float32Array(volumeLength * nt);
      for (let t = 0; t < nt; t++) dense.set(vec.getVolume(t).getData(), t * volumeLength);
      data = dense;
    }
    return {
      dims: [nx, ny, nz, nt],
      affine: vec.space.trans.to2DArray(),
      data,
      timeStep: spacing.length === 4 ? spacing[3] : undefined,
    };
  }
  throw new ValueError(
    'writeVec cannot tell the layout of this NeuroVec: expected a BigNeuroVec (time-first), ' +
      'a DenseNeuroVec subclass or a SparseNeuroVec (time-last)',
    { code: 'INVALID_ARGUMENT', details: { className: (vec as object)?.constructor?.name } }
  );
}

// Helper functions

function createVolFromBuffer(
  buffer: ArrayBuffer,
  header: any,
  dim: number[]
): NeuroVol {
  // Voxel sizes come from the selected affine (as in readNiftiArrayBuffer and
  // nibabel), not pixdim[1..3]: pixdim describes the qform and can disagree
  // with an sform, which would make space.spacing contradict space.trans.
  const spacing = affineVoxelSizes(header.affine);
  const origin = [header.affine[0][3], header.affine[1][3], header.affine[2][3]] as number[];
  const affine = new Matrix(header.affine);
  const orientation = nearestAnatomy(affine);

  const space = new NeuroSpace(dim, spacing, origin, orientation, affine.to2DArray());
  
  // Choose appropriate TypedArray
  let dataType: SliceTypedArrayType;
  let TypedArrayConstructor: any;
  
  switch (header.datatypeCode) {
    case 256: // TYPE_INT8
      dataType = 'int8';
      TypedArrayConstructor = Int8Array;
      break;
    case 2: // TYPE_UINT8
      dataType = 'uint8';
      TypedArrayConstructor = Uint8Array;
      break;
    case 4: // TYPE_INT16
      dataType = 'int16';
      TypedArrayConstructor = Int16Array;
      break;
    case 512: // TYPE_UINT16
      dataType = 'uint16';
      TypedArrayConstructor = Uint16Array;
      break;
    case 8: // TYPE_INT32
      dataType = 'int32';
      TypedArrayConstructor = Int32Array;
      break;
    case 768: // TYPE_UINT32
      dataType = 'uint32';
      TypedArrayConstructor = Uint32Array;
      break;
    case 16: // TYPE_FLOAT32
      dataType = 'float32';
      TypedArrayConstructor = Float32Array;
      break;
    case 64: // TYPE_FLOAT64
      dataType = 'float64';
      TypedArrayConstructor = Float64Array;
      break;
    default:
      throw new ValueError(`Unsupported data type: ${header.datatypeCode}`, {
        code: 'UNSUPPORTED_DATATYPE',
        details: { datatypeCode: header.datatypeCode },
      });
  }
  
  let typedArray: TypedArray = new TypedArrayConstructor(
    buffer,
    0,
    buffer.byteLength / (header.numBitsPerVoxel / 8)
  );

  // NIfTI image data is stored in the file's endianness. nifti-reader-js'
  // readImage() returns the raw bytes without swapping, so big-endian files
  // must be byte-swapped before they are reinterpreted as native TypedArrays.
  if (header.littleEndian === false && typedArray.BYTES_PER_ELEMENT > 1) {
    byteSwapInPlace(typedArray);
  }

  // Apply scl_slope / scl_inter intensity scaling. Per the NIfTI-1 spec (and
  // nibabel), a scl_slope of 0 or a non-finite slope means "no scaling": the
  // stored values are used as-is and scl_inter is ignored too. When scaling
  // is active the result is generally non-integer, so we promote to Float32
  // regardless of the stored datatype.
  const { slope, inter } = niftiScaling(header.scl_slope, header.scl_inter);
  if (slope !== 1 || inter !== 0) {
    const scaled = new Float32Array(typedArray.length);
    for (let i = 0; i < typedArray.length; i++) {
      scaled[i] = typedArray[i] * slope + inter;
    }
    return createNeuroVol('float32', space, scaled);
  }

  return createNeuroVol(dataType, space, typedArray);
}

/**
 * Swap the byte order of every element of a TypedArray in place.
 * Used to convert big-endian NIfTI image data to the host (little-endian)
 * representation expected by JS TypedArrays.
 */
function byteSwapInPlace(arr: TypedArray): void {
  const bpe = arr.BYTES_PER_ELEMENT;
  if (bpe <= 1) return;
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const half = bpe >> 1;
  for (let i = 0; i < u8.length; i += bpe) {
    for (let j = 0; j < half; j++) {
      const a = i + j;
      const b = i + bpe - 1 - j;
      const tmp = u8[a];
      u8[a] = u8[b];
      u8[b] = tmp;
    }
  }
}

async function createNiftiBuffer(vol: NeuroVol, dataType?: string): Promise<ArrayBuffer> {
  const space = vol.space;
  return encodeNifti1(space.dim, space.trans.to2DArray(), vol.getData(), dataType);
}

/**
 * Encode a 3D or 4D image as a single-file NIfTI-1 (`n+1`) buffer.
 *
 * `dims` is `[X, Y, Z]` or `[X, Y, Z, T]` and `data` is in NIfTI order
 * (x fastest). `affine` is the 4x4 voxel-to-world matrix; it is stored as both
 * qform and sform, and `pixdim[1..3]` are its column norms so the qform
 * reproduces it; if the affine has shear, which a qform cannot represent, the
 * qform is omitted (`qform_code` 0) and only the exact sform is written.
 * `timeStep`, when known (finite and positive), becomes `pixdim[4]` of a 4D
 * image and sets the time unit to seconds; otherwise `pixdim[4]` is 1 and the
 * time unit is left unspecified. The datatype
 * follows `data` unless `dataType` is given; either way the header and the
 * bytes agree.
 */
function encodeNifti1(
  dims: readonly number[],
  affine: number[][],
  data: TypedArray,
  dataType?: string,
  timeStep?: number
): ArrayBuffer {
  if (dims.length !== 3 && dims.length !== 4) {
    throw new ValueError(`Cannot write a ${dims.length}D image as NIfTI; expected 3D or 4D`, {
      code: 'INVALID_ARGUMENT',
      details: { dim: [...dims] },
    });
  }
  if (dims.some((d) => !Number.isInteger(d) || d < 1 || d > 32767)) {
    throw new ValueError(`NIfTI-1 dimensions must be integers in 1..32767, got [${dims.join(', ')}]`, {
      code: 'INVALID_ARGUMENT',
      details: { dim: [...dims] },
    });
  }
  const q = matToQuatern(affine);
  // A qform is a rotation times per-axis scales, so it cannot express shear.
  // Rather than writing an approximate qform (as a non-polar quaternion fit
  // would), omit it and let readers use the exact sform.
  const writeQform = isRotationTimesScale(affine);
  const timeKnown = dims.length === 4 && timeStep !== undefined && Number.isFinite(timeStep) && timeStep > 0;
  const { datatypeCode, bitpix } = getDataTypeInfo(dataType ?? data.constructor.name);
  // Convert to the exact type named in the header (also covers inputs such as
  // Uint8ClampedArray that have no NIfTI code and default to FLOAT32).
  const typedData = convertDataType(data, getDatatypeName(datatypeCode));
  
  // Create header buffer. Buffer.alloc() may return a view into a shared pool,
  // so the DataView must respect byteOffset/byteLength rather than assuming the
  // backing ArrayBuffer starts at this header.
  const headerBuffer = Buffer.alloc(352); // 348 byte header + 4 byte padding
  const headerView = new DataView(headerBuffer.buffer, headerBuffer.byteOffset, headerBuffer.byteLength);
  
  // Initialize buffer with zeros
  headerBuffer.fill(0);
  
  // Set header fields
  headerView.setInt32(0, 348, true); // sizeof_hdr
  
  // Set data_type - 10 bytes
  for (let i = 0; i < 10; i++) {
    headerView.setUint8(4 + i, 0);
  }
  
  // Set db_name - 18 bytes
  for (let i = 0; i < 18; i++) {
    headerView.setUint8(14 + i, 0);
  }
  
  // Set extents
  headerView.setInt32(32, 0, true);
  
  // Set session_error
  headerView.setInt16(36, 0, true);
  
  // Set regular - 'r' character to indicate regular file
  headerView.setUint8(38, 114); // 'r'
  
  // Set dim_info
  headerView.setUint8(39, 0);
  
  // Set dimensions
  headerView.setInt16(40, dims.length, true); // dims[0] = rank
  headerView.setInt16(42, dims[0], true); // dims[1]
  headerView.setInt16(44, dims[1], true); // dims[2]
  headerView.setInt16(46, dims[2], true); // dims[3]
  headerView.setInt16(48, dims.length === 4 ? dims[3] : 1, true); // dims[4]
  headerView.setInt16(50, 1, true); // dims[5]
  headerView.setInt16(52, 1, true); // dims[6]
  headerView.setInt16(54, 1, true); // dims[7]
  
  // Set intent_p1, intent_p2, intent_p3
  headerView.setFloat32(56, 0.0, true);
  headerView.setFloat32(60, 0.0, true);
  headerView.setFloat32(64, 0.0, true);
  
  // Set intent_code
  headerView.setInt16(68, 0, true);
  
  // Set datatype and bitpix
  headerView.setInt16(70, datatypeCode, true);
  headerView.setInt16(72, bitpix, true);
  
  // Set slice_start
  headerView.setInt16(74, 0, true);
  
  // Set pixdim: qfac (handedness), the voxel sizes implied by the affine,
  // then the time step.
  const pixdim4 = timeKnown ? (timeStep as number) : 1;
  headerView.setFloat32(76, q.qfac, true); // pixdim[0]
  headerView.setFloat32(80, q.pixdim[0], true); // pixdim[1]
  headerView.setFloat32(84, q.pixdim[1], true); // pixdim[2]
  headerView.setFloat32(88, q.pixdim[2], true); // pixdim[3]
  headerView.setFloat32(92, pixdim4, true); // pixdim[4]
  headerView.setFloat32(96, 1.0, true); // pixdim[5]
  headerView.setFloat32(100, 1.0, true); // pixdim[6]
  headerView.setFloat32(104, 1.0, true); // pixdim[7]
  
  // Set vox_offset
  headerView.setFloat32(108, 352.0, true);
  
  // Set scaling
  headerView.setFloat32(112, 1.0, true); // scl_slope
  headerView.setFloat32(116, 0.0, true); // scl_inter
  
  // Set slice_end
  headerView.setInt16(120, 0, true);
  
  // Set slice_code
  headerView.setUint8(122, 0);
  
  // Set xyzt_units: NIFTI_UNITS_MM (2), plus NIFTI_UNITS_SEC (8) when the
  // time step is known.
  headerView.setUint8(123, timeKnown ? 2 | 8 : 2);
  
  // Set cal_max and cal_min
  headerView.setFloat32(124, 0.0, true);
  headerView.setFloat32(128, 0.0, true);
  
  // Set slice_duration
  headerView.setFloat32(132, 0.0, true);
  
  // Set toffset
  headerView.setFloat32(136, 0.0, true);
  
  // Set glmax and glmin (not used in NIfTI-1)
  headerView.setInt32(140, 0, true);
  headerView.setInt32(144, 0, true);
  
  // Set descrip - 80 bytes
  const descrip = "neuroimjs generated";
  for (let i = 0; i < 80; i++) {
    if (i < descrip.length) {
      headerView.setUint8(148 + i, descrip.charCodeAt(i));
    } else {
      headerView.setUint8(148 + i, 0);
    }
  }
  
  // Set aux_file - 24 bytes
  for (let i = 0; i < 24; i++) {
    headerView.setUint8(228 + i, 0);
  }
  
  // Derive a quaternion (qform) from the affine so the file carries BOTH the
  // qform and sform transforms. Many tools (e.g. FSL/SPM) prefer qform; writing
  // only sform — as the previous implementation did — loses the orientation for
  // those readers.

  // Set qform_code = 1 (NIFTI_XFORM_SCANNER_ANAT), or 0 for a sheared affine
  headerView.setInt16(252, writeQform ? 1 : 0, true);

  // Set sform_code = 1
  headerView.setInt16(254, 1, true);

  // Set quatern_b, quatern_c, quatern_d (zero when the qform is omitted)
  headerView.setFloat32(256, writeQform ? q.quatern[0] : 0, true);
  headerView.setFloat32(260, writeQform ? q.quatern[1] : 0, true);
  headerView.setFloat32(264, writeQform ? q.quatern[2] : 0, true);

  // Set qoffset_x, qoffset_y, qoffset_z
  headerView.setFloat32(268, q.qoffset[0], true);
  headerView.setFloat32(272, q.qoffset[1], true);
  headerView.setFloat32(276, q.qoffset[2], true);

  // Set srow_x, srow_y, srow_z
  headerView.setFloat32(280, affine[0][0], true);
  headerView.setFloat32(284, affine[0][1], true);
  headerView.setFloat32(288, affine[0][2], true);
  headerView.setFloat32(292, affine[0][3], true);
  
  headerView.setFloat32(296, affine[1][0], true);
  headerView.setFloat32(300, affine[1][1], true);
  headerView.setFloat32(304, affine[1][2], true);
  headerView.setFloat32(308, affine[1][3], true);
  
  headerView.setFloat32(312, affine[2][0], true);
  headerView.setFloat32(316, affine[2][1], true);
  headerView.setFloat32(320, affine[2][2], true);
  headerView.setFloat32(324, affine[2][3], true);
  
  // Set intent_name - 16 bytes
  for (let i = 0; i < 16; i++) {
    headerView.setUint8(328 + i, 0);
  }
  
  // Set magic string
  headerBuffer.write('n+1\0', 344, 4, 'ascii');
  
  // Combine header and data
  const dataBytes = Buffer.from(typedData.buffer, typedData.byteOffset, typedData.byteLength);
  const combined = Buffer.concat([headerBuffer, dataBytes]);
  
  // Return proper ArrayBuffer
  return combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength);
}

/** NIfTI datatype code and bitpix for a type name or TypedArray class name. */
function getDataTypeInfo(dataType: string): { datatypeCode: number; bitpix: number } {
  
  switch (dataType.toUpperCase()) {
    case 'INT8ARRAY':
    case 'INT8':
      return { datatypeCode: 256, bitpix: 8 };
    case 'UINT8ARRAY':
    case 'UINT8':
      return { datatypeCode: 2, bitpix: 8 };
    case 'INT16ARRAY':
    case 'INT16':
      return { datatypeCode: 4, bitpix: 16 };
    case 'UINT16ARRAY':
    case 'UINT16':
      return { datatypeCode: 512, bitpix: 16 };
    case 'INT32ARRAY':
    case 'INT32':
      return { datatypeCode: 8, bitpix: 32 };
    case 'UINT32ARRAY':
    case 'UINT32':
      return { datatypeCode: 768, bitpix: 32 };
    case 'FLOAT32ARRAY':
    case 'FLOAT32':
      return { datatypeCode: 16, bitpix: 32 };
    case 'FLOAT64ARRAY':
    case 'FLOAT64':
      return { datatypeCode: 64, bitpix: 64 };
    default:
      return { datatypeCode: 16, bitpix: 32 }; // Default to float32
  }
}

function getDatatypeName(datatypeCode: number): string {
  switch (datatypeCode) {
    case 2: return 'UINT8';
    case 4: return 'INT16';
    case 8: return 'INT32';
    case 16: return 'FLOAT32';
    case 64: return 'FLOAT64';
    case 256: return 'INT8';
    case 512: return 'UINT16';
    case 768: return 'UINT32';
    default: return 'UNKNOWN';
  }
}

function convertDataType(data: TypedArray, dataType?: string): TypedArray {
  if (!dataType) return data;

  const upperType = dataType.toUpperCase();

  switch (upperType) {
    case 'FLOAT32':
      return data instanceof Float32Array ? data : new Float32Array(data);
    case 'FLOAT64':
      return data instanceof Float64Array ? data : new Float64Array(data);
    case 'INT16':
      return data instanceof Int16Array ? data : roundClampToInt(data, Int16Array, -32768, 32767);
    case 'INT32':
      return data instanceof Int32Array ? data : roundClampToInt(data, Int32Array, -2147483648, 2147483647);
    case 'UINT8':
      return data instanceof Uint8Array ? data : roundClampToInt(data, Uint8Array, 0, 255);
    case 'UINT16':
      return data instanceof Uint16Array ? data : roundClampToInt(data, Uint16Array, 0, 65535);
    case 'INT8':
      return data instanceof Int8Array ? data : roundClampToInt(data, Int8Array, -128, 127);
    case 'UINT32':
      return data instanceof Uint32Array ? data : roundClampToInt(data, Uint32Array, 0, 4294967295);
    default:
      return data;
  }
}

/**
 * Convert floating-point (or wider integer) data to an integer TypedArray by
 * rounding to nearest and clamping to the target type's range. This avoids the
 * silent truncation-toward-zero and modulo-wraparound that a plain
 * `new Int16Array(floatData)` would produce.
 */
function roundClampToInt<T extends TypedArray>(
  data: TypedArray,
  Ctor: new (len: number) => T,
  min: number,
  max: number
): T {
  const out = new Ctor(data.length);
  for (let i = 0; i < data.length; i++) {
    let v = Math.round(data[i]);
    if (v < min) v = min;
    else if (v > max) v = max;
    out[i] = v;
  }
  return out;
}

/**
 * True when the affine's 3x3 part is a rotation (possibly improper) times
 * per-axis scales, i.e. its column-normalised matrix R satisfies RᵀR = I
 * within 1e-4. Only such affines can be stored exactly as a qform.
 */
function isRotationTimesScale(affine: number[][]): boolean {
  const cols = [0, 1, 2].map((c) => [affine[0][c], affine[1][c], affine[2][c]]);
  const unit = cols.map((col) => {
    const n = Math.hypot(col[0], col[1], col[2]);
    return n > 0 ? col.map((v) => v / n) : null;
  });
  if (unit.some((u) => u === null)) return false;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const dot = unit[i]![0] * unit[j]![0] + unit[i]![1] * unit[j]![1] + unit[i]![2] * unit[j]![2];
      if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-4) return false;
    }
  }
  return true;
}

/**
 * Convert a 4x4 affine (srow form) into NIfTI quaternion parameters
 * (quatern_b/c/d, qoffset, pixdim scales, and qfac handedness), following the
 * standard nifti_mat44_to_quatern algorithm.
 */
function matToQuatern(affine: number[][]): {
  quatern: [number, number, number];
  qoffset: [number, number, number];
  pixdim: [number, number, number];
  qfac: number;
} {
  let r11 = affine[0][0], r12 = affine[0][1], r13 = affine[0][2];
  let r21 = affine[1][0], r22 = affine[1][1], r23 = affine[1][2];
  let r31 = affine[2][0], r32 = affine[2][1], r33 = affine[2][2];
  const qoffset: [number, number, number] = [affine[0][3], affine[1][3], affine[2][3]];

  // Column norms are the voxel sizes (pixdim).
  let xd = Math.sqrt(r11 * r11 + r21 * r21 + r31 * r31);
  let yd = Math.sqrt(r12 * r12 + r22 * r22 + r32 * r32);
  let zd = Math.sqrt(r13 * r13 + r23 * r23 + r33 * r33);

  if (xd === 0) { r11 = 1; r21 = 0; r31 = 0; xd = 1; }
  if (yd === 0) { r12 = 0; r22 = 1; r32 = 0; yd = 1; }
  if (zd === 0) { r13 = 0; r23 = 0; r33 = 1; zd = 1; }

  // Normalize the columns to obtain a pure rotation matrix.
  r11 /= xd; r21 /= xd; r31 /= xd;
  r12 /= yd; r22 /= yd; r32 /= yd;
  r13 /= zd; r23 /= zd; r33 /= zd;

  // If the determinant is negative the coordinate system is left-handed; record
  // that in qfac and flip the third column so the remaining matrix is a proper
  // rotation.
  const det =
    r11 * (r22 * r33 - r32 * r23) -
    r12 * (r21 * r33 - r31 * r23) +
    r13 * (r21 * r32 - r31 * r22);
  let qfac = 1;
  if (det < 0) { r13 = -r13; r23 = -r23; r33 = -r33; qfac = -1; }

  // Rotation matrix -> quaternion.
  const trace = r11 + r22 + r33 + 1;
  let a: number, b: number, c: number, d: number;
  if (trace > 0.5) {
    a = 0.5 * Math.sqrt(trace);
    b = 0.25 * (r32 - r23) / a;
    c = 0.25 * (r13 - r31) / a;
    d = 0.25 * (r21 - r12) / a;
  } else {
    const xa = 1 + r11 - (r22 + r33);
    const ya = 1 + r22 - (r11 + r33);
    const za = 1 + r33 - (r11 + r22);
    if (xa > 1) {
      b = 0.5 * Math.sqrt(xa);
      c = 0.25 * (r12 + r21) / b;
      d = 0.25 * (r13 + r31) / b;
      a = 0.25 * (r32 - r23) / b;
    } else if (ya > 1) {
      c = 0.5 * Math.sqrt(ya);
      b = 0.25 * (r12 + r21) / c;
      d = 0.25 * (r23 + r32) / c;
      a = 0.25 * (r13 - r31) / c;
    } else {
      d = 0.5 * Math.sqrt(za);
      b = 0.25 * (r13 + r31) / d;
      c = 0.25 * (r23 + r32) / d;
      a = 0.25 * (r21 - r12) / d;
    }
    if (a < 0) { b = -b; c = -c; d = -d; }
  }

  return { quatern: [b, c, d], qoffset, pixdim: [xd, yd, zd], qfac };
}
