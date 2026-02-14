import * as nifti from 'nifti-reader-js';
import { DenseNeuroVol } from '../volume/DenseNeuroVol';
import { NeuroVol } from '../volume/NeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { nearestAnatomy, AxisSet } from '../geometry/Axis';
import { Matrix } from 'ml-matrix';
import { createNeuroVol } from '../volume/NeuroIm';
import { createNeuroSlice } from '../volume/NeuroIm';
import * as fs from 'fs/promises';
import { SliceTypedArrayType } from '../types';

// Re-export enhanced I/O functions
export { readVol as read_vol_async, writeVol as write_vol_async, readHeader, readVolList, readVec, writeVec } from './io';
export { FileFormat, NIFTIFormat, NIFTIDualFormat, AFNIFormat, findDescriptor, getFormat } from './formats';
export type { ReadVolOptions, WriteVolOptions, HeaderInfo } from './io';


/**
 * Read a NIfTI file and return a DenseNeuroVol object.
 * @param {string | ArrayBuffer} input - The path to the NIfTI file or an ArrayBuffer.
 * @returns {Promise<DenseNeuroVol>} A promise that resolves to a DenseNeuroVol object.
 */
export async function read_vol(input: string | ArrayBuffer): Promise<NeuroVol> {
  try {
    let buffer: ArrayBuffer;

    if (typeof input === 'string') {
      console.log('Reading file:', input);
      const data = await fs.readFile(input);
      console.log('File read successfully. Size:', data.length, 'bytes');
      buffer = data.buffer;
    } else {
      console.log('Using provided ArrayBuffer');
      buffer = input;
    }

    if (nifti.isCompressed(buffer)) {
      console.log('File is compressed. Decompressing...');
      buffer = nifti.decompress(buffer);
      console.log('Decompression complete. New size:', buffer.byteLength, 'bytes');
    }

    if (!nifti.isNIFTI(buffer)) {
      throw new Error('The file is not a valid NIfTI file.');
    }

    console.log('Reading NIfTI header...');
    const header = nifti.readHeader(buffer);
    if (!header) {
      throw new Error('NIfTI header is null or undefined');
    }
    console.log('Header read successfully:', header);

    if (!header.dims || header.dims.length < 4) {
      throw new Error('Invalid header dimensions');
    }

    if (header.dims[0] !== 3) {
      throw new Error(`The NIfTI file must contain a 3D image. Found ${header.dims[0]}D image.`);
    }

    console.log('Reading image data...');
    const imageBuffer: ArrayBuffer = nifti.readImage(header, buffer);
    const image: Uint8Array = new Uint8Array(imageBuffer);
    console.log('Image data read successfully. Size:', image.byteLength);

    const dim = Array.from(header.dims.slice(1, 4));
    const spacing = Array.from(header.pixDims.slice(1, 4));
    const origin: [number, number, number] = [header.affine[0][3], header.affine[1][3], header.affine[2][3]];

    console.log('Dimensions:', dim);
    console.log('Spacing:', spacing);
    console.log('Origin:', origin);

    const affine = new Matrix(header.affine);

    console.log('Affine matrix:', affine.to2DArray());

    const orientation = nearestAnatomy(affine);
    console.log('Orientation:', orientation);

    const space = new NeuroSpace(
      dim,
      spacing,
      origin,
      orientation,
      affine.to2DArray()
    );

    console.log('NeuroSpace created successfully');

    // Choose the appropriate TypedArray based on the datatype
    let dataType: 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64';
    let TypedArray: TypedArrayConstructor;
    switch (header.datatypeCode) {
      case nifti.NIFTI1.TYPE_INT8: dataType = 'int8'; TypedArray = Int8Array; break;
      case nifti.NIFTI1.TYPE_UINT8: dataType = 'uint8'; TypedArray = Uint8Array; break;
      case nifti.NIFTI1.TYPE_INT16: dataType = 'int16'; TypedArray = Int16Array; break;
      case nifti.NIFTI1.TYPE_UINT16: dataType = 'uint16'; TypedArray = Uint16Array; break;
      case nifti.NIFTI1.TYPE_INT32: dataType = 'int32'; TypedArray = Int32Array; break;
      case nifti.NIFTI1.TYPE_UINT32: dataType = 'uint32'; TypedArray = Uint32Array; break;
      case nifti.NIFTI1.TYPE_FLOAT32: dataType = 'float32'; TypedArray = Float32Array; break;
      case nifti.NIFTI1.TYPE_FLOAT64: dataType = 'float64'; TypedArray = Float64Array; break;
      default: throw new Error(`Unsupported data type: ${header.datatypeCode}`);
    }

    // Reinterpret the Uint8Array buffer as the desired TypedArray
    const typedImage = new TypedArray(
      image.buffer,
      image.byteOffset,
      image.byteLength / (header.numBitsPerVoxel / 8) // Fixed line
    );

    // Check if the data length matches the expected length
    const expectedLength = space.dim[0] * space.dim[1] * space.dim[2];
    if (typedImage.length !== expectedLength) {
      console.log('Data length:', typedImage.length);
      console.log('Expected length:', expectedLength);
      throw new Error('Data length does not match the expected length');
    }

    const vol = createNeuroVol(
      dataType as SliceTypedArrayType,
      space,
      typedImage
    );

    console.log('NeuroVol created successfully');

    return vol;
  } catch (error) {
    console.error('Error in read_vol:', error);
    throw error;
  }
}

/**
 * Writes a NeuroVol instance to a NIFTI file.
 * @param vol - The NeuroVol instance to write.
 * @param filePath - The file path to save the NIFTI file.
 */
export async function write_vol(vol: NeuroVol, filePath: string): Promise<void> {
  try {
    const space = vol.space;
    const dim = space.dim;
    const spacing = space.spacing;
    const origin = space.origin;

    // Create a buffer for the NIFTI header (348 bytes)
    const headerBuffer = Buffer.alloc(348);

    // Use DataView to set fields at specific offsets
    const headerView = new DataView(headerBuffer.buffer);

    // Set sizeof_hdr (int32), offset 0
    headerView.setInt32(0, 348, true); // true for little-endian

    // data_type (char[10]), offset 4 - unused, can leave as zeros

    // db_name (char[18]), offset 14 - unused

    // extents (int32), offset 32 - unused

    // session_error (int16), offset 36 - unused

    // regular (char), offset 38 - unused

    // dim_info (char), offset 39 - set to 0
    headerView.setUint8(39, 0);

    // Set dim (int16[8]), offset 40
    for (let i = 0; i < 8; i++) {
      let value = 0;
      if (i === 0) {
        value = dim.length;
      } else if (i <= dim.length) {
        value = dim[i - 1];
      } else {
        value = 1;
      }
      headerView.setInt16(40 + i * 2, value, true);
    }

    // intent_p1 (float32), offset 56
    headerView.setFloat32(56, 0.0, true);

    // intent_p2 (float32), offset 60
    headerView.setFloat32(60, 0.0, true);

    // intent_p3 (float32), offset 64
    headerView.setFloat32(64, 0.0, true);

    // intent_code (int16), offset 68
    headerView.setInt16(68, 0, true);

    // Set datatype (int16), offset 70
    let datatypeCode: number;
    let bitpix: number;
    const dataType = vol.getDataConstructor().name;
    switch (dataType) {
      case 'Int8Array':
        datatypeCode = 256; // NIFTI_TYPE_INT8
        bitpix = 8;
        break;
      case 'Uint8Array':
        datatypeCode = 2; // NIFTI_TYPE_UINT8
        bitpix = 8;
        break;
      case 'Int16Array':
        datatypeCode = 4; // NIFTI_TYPE_INT16
        bitpix = 16;
        break;
      case 'Uint16Array':
        datatypeCode = 512; // NIFTI_TYPE_UINT16
        bitpix = 16;
        break;
      case 'Int32Array':
        datatypeCode = 8; // NIFTI_TYPE_INT32
        bitpix = 32;
        break;
      case 'Uint32Array':
        datatypeCode = 768; // NIFTI_TYPE_UINT32
        bitpix = 32;
        break;
      case 'Float32Array':
        datatypeCode = 16; // NIFTI_TYPE_FLOAT32
        bitpix = 32;
        break;
      case 'Float64Array':
        datatypeCode = 64; // NIFTI_TYPE_FLOAT64
        bitpix = 64;
        break;
      default:
        throw new Error(`Unsupported data type: ${dataType}`);
    }
    headerView.setInt16(70, datatypeCode, true);

    // Set bitpix (int16), offset 72
    headerView.setInt16(72, bitpix, true);

    // slice_start (int16), offset 74
    headerView.setInt16(74, 0, true);

    // pixdim (float32[8]), offset 76
    // pixdim[0] is unused
    headerView.setFloat32(76, 0.0, true);
    for (let i = 0; i < 7; i++) {
      let pixdimValue = 1.0;
      if (i < spacing.length) {
        pixdimValue = spacing[i];
      }
      headerView.setFloat32(76 + (i + 1) * 4, pixdimValue, true);
    }

    // vox_offset (float32), offset 108
    headerView.setFloat32(108, 352.0, true); // data starts at byte 352

    // scl_slope (float32), offset 112
    headerView.setFloat32(112, 1.0, true);

    // scl_inter (float32), offset 116
    headerView.setFloat32(116, 0.0, true);

    // slice_end (int16), offset 120
    headerView.setInt16(120, 0, true);

    // slice_code (char), offset 122
    headerView.setUint8(122, 0);

    // xyzt_units (char), offset 123
    // Set to mm for spatial units
    const NIFTI_UNITS_MM = 2;
    headerView.setUint8(123, NIFTI_UNITS_MM);

    // cal_max (float32), offset 124
    headerView.setFloat32(124, 0.0, true);

    // cal_min (float32), offset 128
    headerView.setFloat32(128, 0.0, true);

    // slice_duration (float32), offset 132
    headerView.setFloat32(132, 0.0, true);

    // toffset (float32), offset 136
    headerView.setFloat32(136, 0.0, true);

    // glmax (int32), offset 140
    headerView.setInt32(140, 0, true);

    // glmin (int32), offset 144
    headerView.setInt32(144, 0, true);

    // descrip (char[80]), offset 148
    const description = 'Created by write_vol';
    const descripBytes = Buffer.from(description, 'utf-8');
    headerBuffer.set(descripBytes, 148);

    // aux_file (char[24]), offset 228
    // Leave as zeros

    // qform_code (int16), offset 252
    headerView.setInt16(252, 0, true);

    // sform_code (int16), offset 254
    headerView.setInt16(254, 1, true); // Use sform_code = 1 (NIFTI_XFORM_SCANNER_ANAT)

    // quatern_b, quatern_c, quatern_d (float32), offsets 256, 260, 264
    headerView.setFloat32(256, 0.0, true);
    headerView.setFloat32(260, 0.0, true);
    headerView.setFloat32(264, 0.0, true);

    // qoffset_x, qoffset_y, qoffset_z (float32), offsets 268, 272, 276
    headerView.setFloat32(268, 0.0, true);
    headerView.setFloat32(272, 0.0, true);
    headerView.setFloat32(276, 0.0, true);

    // srow_x (float32[4]), offset 280
    // srow_y (float32[4]), offset 296
    // srow_z (float32[4]), offset 312
    // Set from affine transformation
    const affine = space.trans.to2DArray(); // Should be a 4x4 matrix
    for (let i = 0; i < 4; i++) {
      headerView.setFloat32(280 + i * 4, affine[0][i], true); // srow_x
      headerView.setFloat32(296 + i * 4, affine[1][i], true); // srow_y
      headerView.setFloat32(312 + i * 4, affine[2][i], true); // srow_z
    }

    // intent_name (char[16]), offset 328
    // Leave as zeros

    // magic (char[4]), offset 344
    // Set to 'n+1\0' for NIfTI-1 single file (.nii)
    headerBuffer.write('n+1\0', 344, 4, 'ascii');

    // Now, the header is ready.

    // Get the data from the volume
    const data = vol.getData(); // Should be a TypedArray

    // Calculate data buffer length
    const dataBuffer = Buffer.from(data.buffer);

    // Ensure data offset aligns with 16 bytes as per NIfTI spec
    const vox_offset = 352; // We have no extensions, so data starts at 352
    if (vox_offset % 16 !== 0) {
      throw new Error('vox_offset must be a multiple of 16');
    }

    // The total file size is vox_offset + data length
    // Since header is 348 bytes, we need to add 4 bytes of padding after header before data starts.
    const paddingSize = vox_offset - headerBuffer.length; // Should be 4 bytes
    const paddingBuffer = Buffer.alloc(paddingSize);

    // Concatenate header, padding, and data
    const totalBuffer = Buffer.concat([headerBuffer, paddingBuffer, dataBuffer]);

    // Write the buffer to the output file
    console.log('Writing to file:', filePath);

    await fs.writeFile(filePath, totalBuffer);

    console.log('File written successfully:', filePath);
  } catch (error) {
    console.error('Error in write_vol:', error);
    throw error;
  }
}
// TypedArray constructor type
type TypedArrayConstructor = new (buffer: ArrayBuffer | number, byteOffset?: number, length?: number) => TypedArray;
type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
