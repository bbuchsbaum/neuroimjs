import * as nifti from 'nifti-reader-js';
import * as pako from 'pako';
import { NeuroVol } from '../volume/NeuroVol';
import { NeuroVec } from '../vec/NeuroVec';
import { DenseNeuroVec } from '../vec/NeuroVec';
import { FloatNeuroVol, Int16NeuroVol, UInt8NeuroVol, Float64NeuroVol } from '../volume/DenseNeuroVol';
import { LogicalNeuroVol } from '../volume/LogicalNeuroVol';
import { BigNeuroVec } from '../vector/BigNeuroVec';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { nearestAnatomy } from '../geometry/Axis';
import { Matrix } from 'ml-matrix';
import { createNeuroVol } from '../volume/NeuroIm';
import { ValueError, TypeError as TypeErrorType, SliceTypedArrayType, TypedArray } from '../types';
import { FileFormat, NIFTIFormat, findDescriptor, getFormat } from './formats';

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
  /** Output format (default: "NIFTI") */
  format?: string;
  /** Output data type (e.g., "FLOAT32", "INT16") */
  dataType?: string;
  /** Whether to compress the output */
  compress?: boolean;
  /** Progress callback */
  onProgress?: (progress: number) => void;
}

/**
 * Header information from neuroimaging file.
 */
export interface HeaderInfo {
  dim: number[];
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
    let buffer: ArrayBuffer;
    
    if (typeof input === 'string') {
      // Check file format
      const format = await findDescriptor(input);
      if (!format) {
        throw new ValueError(`Cannot determine file format for: ${input}`);
      }
      
      // Read file asynchronously
      const fs = await import('fs/promises');
      onProgress?.(0.1);
      
      const data = await fs.readFile(input);
      onProgress?.(0.3);
      
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      
      // Handle compression based on format
      if (format.headerEncoding === 'gzip') {
        onProgress?.(0.4);
        try {
          const compressed = new Uint8Array(buffer);
          const decompressed = pako.ungzip(compressed);
          buffer = decompressed.buffer.slice(
            decompressed.byteOffset,
            decompressed.byteOffset + decompressed.byteLength
          );
          onProgress?.(0.5);
        } catch (err) {
          // If pako fails, try nifti-reader decompression
          if (nifti.isCompressed(buffer)) {
            buffer = nifti.decompress(buffer);
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
        buffer = nifti.decompress(buffer);
        onProgress?.(0.5);
      }
    }

    if (!nifti.isNIFTI(buffer)) {
      throw new ValueError('The file is not a valid NIfTI file.');
    }
    
    // Read header
    const header = nifti.readHeader(buffer);
    if (!header) {
      throw new ValueError('NIfTI header is null or undefined');
    }
    onProgress?.(0.6);
    
    // Validate dimensions
    if (!header.dims || header.dims.length < 4) {
      throw new ValueError('Invalid header dimensions');
    }
    
    const numDims = header.dims[0];
    if (numDims < 3 || numDims > 4) {
      throw new ValueError(`Expected 3D or 4D image, found ${numDims}D image`);
    }
    
    // Read image data
    const imageBuffer = nifti.readImage(header, buffer);
    onProgress?.(0.8);
    
    // Handle 4D data
    if (numDims === 4) {
      const numVols = header.dims[4];
      if (index < 0 || index >= numVols) {
        throw new ValueError(`Index ${index} out of range for 4D data with ${numVols} volumes`);
      }
      
      // Extract single volume
      const volSize = header.dims[1] * header.dims[2] * header.dims[3];
      const bytesPerVoxel = header.numBitsPerVoxel / 8;
      const volBytes = volSize * bytesPerVoxel;
      const startByte = index * volBytes;
      
      const volBuffer = imageBuffer.slice(startByte, startByte + volBytes);
      return createVolFromBuffer(volBuffer, header, [header.dims[1], header.dims[2], header.dims[3]]);
    } else {
      // 3D data
      return createVolFromBuffer(imageBuffer, header, [header.dims[1], header.dims[2], header.dims[3]]);
    }
  } finally {
    onProgress?.(1.0);
  }
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
  const { format = 'NIFTI', compress = false, dataType, onProgress } = options;
  
  try {
    onProgress?.(0.1);
    
    // Get format descriptor
    const formatDesc = getFormat(format);
    if (!(formatDesc instanceof NIFTIFormat)) {
      throw new ValueError(`Format ${format} not yet supported for writing`);
    }
    
    // Create NIfTI buffer
    const buffer = await createNiftiBuffer(vol, dataType);
    onProgress?.(0.6);
    
    // Compress if requested
    let outputBuffer = buffer;
    if (compress || formatDesc.headerEncoding === 'gzip') {
      onProgress?.(0.7);
      const compressed = pako.gzip(new Uint8Array(buffer));
      outputBuffer = compressed.buffer.slice(
        compressed.byteOffset,
        compressed.byteOffset + compressed.byteLength
      );
      onProgress?.(0.8);
    }
    
    // Write to file
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, new Uint8Array(outputBuffer));
    onProgress?.(1.0);
    
  } catch (error) {
    throw error;
  }
}

/**
 * Read header information from neuroimaging file.
 */
export async function readHeader(fileName: string): Promise<HeaderInfo> {
  const fs = await import('fs/promises');
  
  // Determine format
  const format = await findDescriptor(fileName);
  if (!format) {
    throw new ValueError(`Cannot determine file format for: ${fileName}`);
  }
  
  // Read file
  let data = await fs.readFile(fileName);
  let buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  
  // Handle compression
  if (format.headerEncoding === 'gzip') {
    const compressed = new Uint8Array(buffer);
    const decompressed = pako.ungzip(compressed);
    buffer = decompressed.buffer;
  }
  
  if (!nifti.isNIFTI(buffer)) {
    throw new ValueError('Not a valid NIfTI file');
  }
  
  const header = nifti.readHeader(buffer);
  if (!header) {
    throw new ValueError('Failed to read NIfTI header');
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
  const { indices, mask, useBigVec = false, onProgress } = options;
  
  // Read header to get dimensions
  const headerInfo = await readHeader(fileName);
  const dims = headerInfo.dim;
  
  if (dims[0] < 3 || dims[0] > 4) {
    throw new ValueError(`Expected 3D or 4D data, got ${dims[0]}D`);
  }
  
  // For 3D data, convert to 4D with single timepoint
  const is3D = dims[0] === 3;
  const spatialDims = is3D ? [dims[1], dims[2], dims[3]] : [dims[1], dims[2], dims[3]];
  const numVols = is3D ? 1 : dims[4];
  
  // Determine which volumes to load
  const volIndices = indices || Array.from({ length: numVols }, (_, i) => i);
  
  // Validate indices
  for (const idx of volIndices) {
    if (idx < 0 || idx >= numVols) {
      throw new ValueError(`Index ${idx} out of range for 4D data with ${numVols} volumes`);
    }
  }
  
  if (useBigVec || numVols > 100) {
    // Use BigNeuroVec for large datasets
    onProgress?.(0.1);
    
    // Create temporary file for memory mapping
    const tempFile = `${fileName}.bigvec.tmp`;
    const shape = [volIndices.length, ...spatialDims];
    
    const bigVec = new BigNeuroVec(tempFile, shape);
    
    // Load volumes one by one
    for (let i = 0; i < volIndices.length; i++) {
      const volIdx = volIndices[i];
      const vol = await readVol(fileName, { 
        index: volIdx,
        onProgress: p => onProgress?.((i + p) / volIndices.length)
      });
      
      // Copy data to BigNeuroVec
      const data = vol.getData();
      for (let j = 0; j < data.length; j++) {
        const [x, y, z] = vol.space.indexToGrid(j);
        bigVec.setAt(x, y, z, i, data[j]);
      }
    }
    
    bigVec.flush();
    return bigVec;
    
  } else {
    // Load all volumes into memory
    const volumes: NeuroVol[] = [];
    
    for (let i = 0; i < volIndices.length; i++) {
      const volIdx = volIndices[i];
      const vol = await readVol(fileName, {
        index: volIdx,
        onProgress: p => onProgress?.((i + p) / volIndices.length)
      });
      volumes.push(vol);
    }
    
    // Create 4D space
    const firstVol = volumes[0];
    const space4d = new NeuroSpace(
      [volumes.length, ...firstVol.space.dim],
      [1, ...firstVol.space.spacing],
      [0, ...firstVol.space.origin]
    );
    
    // Combine into DenseNeuroVec
    const totalSize = volumes.length * firstVol.length;
    const data = new Float32Array(totalSize);
    
    let offset = 0;
    for (const vol of volumes) {
      const volData = vol.getData();
      data.set(volData, offset);
      offset += volData.length;
    }
    
    // TODO: Return proper DenseNeuroVec when implemented
    // For now, return BigNeuroVec
    return new BigNeuroVec(data, space4d);
  }
}

/**
 * Write a NeuroVec to file.
 */
export async function writeVec(
  vec: NeuroVec,
  fileName: string,
  options: WriteVolOptions = {}
): Promise<void> {
  const { format = 'NIFTI', compress = false, dataType, onProgress } = options;
  
  // For now, only support NIfTI format
  const formatDesc = getFormat(format);
  if (!(formatDesc instanceof NIFTIFormat)) {
    throw new ValueError(`Format ${format} not yet supported for writing 4D data`);
  }
  
  // Get data
  const data = vec.getData();
  const shape = vec.dim;
  
  // Create 4D NIfTI header
  const header = create4DNiftiHeader(shape, vec.spacing, vec.origin, dataType);
  onProgress?.(0.3);
  
  // Create buffer
  const headerBuffer = Buffer.alloc(352); // NIfTI-1 header + padding
  writeNiftiHeader(headerBuffer, header);
  
  // Convert data to appropriate type
  const typedData = convertDataType(data, dataType);
  onProgress?.(0.6);
  
  // Combine header and data
  const dataBytes = Buffer.from(typedData.buffer, typedData.byteOffset, typedData.byteLength);
  const totalBuffer = Buffer.concat([
    headerBuffer,
    dataBytes
  ]);
  onProgress?.(0.8);
  
  // Compress if needed
  let outputBuffer = totalBuffer;
  if (compress || formatDesc.headerEncoding === 'gzip') {
    const compressed = pako.gzip(new Uint8Array(totalBuffer));
    outputBuffer = Buffer.from(compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength
    ));
    onProgress?.(0.9);
  }
  
  // Write to file
  const fs = await import('fs/promises');
  await fs.writeFile(fileName, outputBuffer);
  onProgress?.(1.0);
}

// Helper functions

function createVolFromBuffer(
  buffer: ArrayBuffer,
  header: any,
  dim: number[]
): NeuroVol {
  const spacing = Array.from(header.pixDims.slice(1, 4)) as number[];
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
      throw new ValueError(`Unsupported data type: ${header.datatypeCode}`);
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

  // Apply scl_slope / scl_inter intensity scaling. Per the NIfTI-1 spec a
  // scl_slope of 0 means "no scaling". When scaling is active the result is
  // generally non-integer, so we promote to Float32 regardless of the stored
  // datatype.
  const rawSlope = header.scl_slope;
  const rawInter = header.scl_inter;
  const slope = !rawSlope || Number.isNaN(rawSlope) ? 1 : rawSlope;
  const inter = !rawInter || Number.isNaN(rawInter) ? 0 : rawInter;
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
  const dim = space.dim;
  const spacing = space.spacing;
  
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
  headerView.setInt16(40, 3, true); // dims[0] = 3 dimensions
  headerView.setInt16(42, dim[0], true); // dims[1]
  headerView.setInt16(44, dim[1], true); // dims[2]
  headerView.setInt16(46, dim[2], true); // dims[3]
  headerView.setInt16(48, 1, true); // dims[4]
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
  const { datatypeCode, bitpix } = getDataTypeInfo(vol, dataType);
  headerView.setInt16(70, datatypeCode, true);
  headerView.setInt16(72, bitpix, true);
  
  // Set slice_start
  headerView.setInt16(74, 0, true);
  
  // Set pixdim (spacing)
  headerView.setFloat32(76, 0.0, true); // pixdim[0]
  headerView.setFloat32(80, spacing[0], true); // pixdim[1]
  headerView.setFloat32(84, spacing[1], true); // pixdim[2]
  headerView.setFloat32(88, spacing[2], true); // pixdim[3]
  headerView.setFloat32(92, 1.0, true); // pixdim[4]
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
  
  // Set xyzt_units (spatial units = mm, time units = unknown)
  headerView.setUint8(123, 2); // NIFTI_UNITS_MM
  
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
  const affine = space.trans.to2DArray();
  const q = matToQuatern(affine);

  // pixdim[0] carries qfac (handedness), offset 76
  headerView.setFloat32(76, q.qfac, true);

  // Set qform_code = 1 (NIFTI_XFORM_SCANNER_ANAT)
  headerView.setInt16(252, 1, true);

  // Set sform_code = 1
  headerView.setInt16(254, 1, true);

  // Set quatern_b, quatern_c, quatern_d
  headerView.setFloat32(256, q.quatern[0], true);
  headerView.setFloat32(260, q.quatern[1], true);
  headerView.setFloat32(264, q.quatern[2], true);

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
  
  // Get data
  const data = vol.getData();
  const dataBuffer = convertDataType(data, dataType);
  
  // Combine header and data
  const dataBytes = Buffer.from(dataBuffer.buffer, dataBuffer.byteOffset, dataBuffer.byteLength);
  const combined = Buffer.concat([headerBuffer, dataBytes]);
  
  // Return proper ArrayBuffer
  return combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength);
}

function getDataTypeInfo(vol: NeuroVol, requestedType?: string): { datatypeCode: number; bitpix: number } {
  const dataType = requestedType || vol.getDataConstructor().name;
  
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

function create4DNiftiHeader(shape: number[], spacing: number[], origin: number[], dataType?: string): any {
  // Create a header object compatible with NIfTI
  // shape should be [t, x, y, z] but NIfTI wants [x, y, z, t]
  const niftiShape = [shape[1], shape[2], shape[3], shape[0]];
  const niftiSpacing = [spacing[1], spacing[2], spacing[3], spacing[0]];
  
  return {
    dims: [4, ...niftiShape, 1, 1, 1].slice(0, 8), // Ensure exactly 8 elements
    pixDims: [0, ...niftiSpacing, 1, 1, 1, 1].slice(0, 8), // Ensure exactly 8 elements
    affine: [
      [niftiSpacing[0], 0, 0, origin[1] || 0],
      [0, niftiSpacing[1], 0, origin[2] || 0],
      [0, 0, niftiSpacing[2], origin[3] || 0],
      [0, 0, 0, 1]
    ],
    datatypeCode: getDataTypeInfo({ getDataConstructor: () => Float32Array } as any, dataType).datatypeCode,
    numBitsPerVoxel: getDataTypeInfo({ getDataConstructor: () => Float32Array } as any, dataType).bitpix
  };
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

function writeNiftiHeader(buffer: Buffer, header: any): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  
  // sizeof_hdr
  view.setInt32(0, 348, true);
  
  // dim_info
  view.setUint8(39, 0);
  
  // dims
  for (let i = 0; i < 8; i++) {
    view.setInt16(40 + i * 2, header.dims[i] || 1, true);
  }
  
  // datatype and bitpix
  view.setInt16(70, header.datatypeCode, true);
  view.setInt16(72, header.numBitsPerVoxel, true);
  
  // pixdims
  for (let i = 0; i < 8; i++) {
    view.setFloat32(76 + i * 4, header.pixDims[i] || 1.0, true);
  }
  
  // vox_offset
  view.setFloat32(108, 352.0, true);
  
  // scl_slope and scl_inter
  view.setFloat32(112, 1.0, true);
  view.setFloat32(116, 0.0, true);
  
  // units
  view.setUint8(123, 2); // mm
  
  // sform_code
  view.setInt16(254, 1, true);
  
  // sform matrix
  const affine = header.affine;
  for (let i = 0; i < 4; i++) {
    view.setFloat32(280 + i * 4, affine[0][i], true);
    view.setFloat32(296 + i * 4, affine[1][i], true);
    view.setFloat32(312 + i * 4, affine[2][i], true);
  }
  
  // magic
  buffer.write('n+1\0', 344, 4, 'ascii');
}
