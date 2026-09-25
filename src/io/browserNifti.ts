import * as nifti from 'nifti-reader-js';
import { Matrix } from 'ml-matrix';
import { nearestAnatomy } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import type { NeuroVol } from '../volume/NeuroVol';
import {
  Float64NeuroVol,
  FloatNeuroVol,
  Int16NeuroVol,
  Int32NeuroVol,
  Int8NeuroVol,
  UInt16NeuroVol,
  UInt8NeuroVol,
} from '../volume/DenseNeuroVol';

export interface BrowserNiftiOptions {
  /** For a 4D file, select this zero-based 3D volume. Defaults to 0. */
  index?: number;
}

type NiftiTypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

type NiftiHeader = NonNullable<ReturnType<typeof nifti.readHeader>>;

function toArrayBuffer(buffer: ArrayBuffer | ArrayBufferLike | ArrayBufferView): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) return buffer;
  if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice().buffer;
  }
  return new Uint8Array(buffer).slice().buffer;
}

function swapBytesInPlace(array: NiftiTypedArray): void {
  const width = array.BYTES_PER_ELEMENT;
  if (width <= 1) return;
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  for (let offset = 0; offset < bytes.length; offset += width) {
    for (let left = 0, right = width - 1; left < right; left++, right--) {
      const value = bytes[offset + left];
      bytes[offset + left] = bytes[offset + right];
      bytes[offset + right] = value;
    }
  }
}

function typedImage(buffer: ArrayBuffer, header: NiftiHeader): NiftiTypedArray {
  const constructors: Record<number, new (buffer: ArrayBuffer) => NiftiTypedArray> = {
    256: Int8Array,
    2: Uint8Array,
    4: Int16Array,
    512: Uint16Array,
    8: Int32Array,
    768: Uint32Array,
    16: Float32Array,
    64: Float64Array,
  };
  const Constructor = constructors[header.datatypeCode];
  if (!Constructor) {
    throw new Error(`Unsupported NIfTI datatype code: ${header.datatypeCode}`);
  }
  const data = new Constructor(buffer);
  if (header.littleEndian === false) swapBytesInPlace(data);
  return data;
}

function scaledImage(data: NiftiTypedArray, header: NiftiHeader): NiftiTypedArray {
  const rawSlope = Number(header.scl_slope);
  const rawIntercept = Number(header.scl_inter);
  const slope = !rawSlope || Number.isNaN(rawSlope) ? 1 : rawSlope;
  const intercept = !rawIntercept || Number.isNaN(rawIntercept) ? 0 : rawIntercept;
  if (slope === 1 && intercept === 0) return data;
  // Float64 avoids silently losing precision when scaling float64 or uint32 data.
  const scaled = new Float64Array(data.length);
  for (let index = 0; index < data.length; index++) {
    scaled[index] = data[index] * slope + intercept;
  }
  return scaled;
}

function createVolume(space: NeuroSpace, data: NiftiTypedArray): NeuroVol {
  if (data instanceof Int8Array) return new Int8NeuroVol(space, data);
  if (data instanceof Uint8Array) return new UInt8NeuroVol(space, data);
  if (data instanceof Int16Array) return new Int16NeuroVol(space, data);
  if (data instanceof Uint16Array) return new UInt16NeuroVol(space, data);
  if (data instanceof Int32Array) return new Int32NeuroVol(space, data);
  if (data instanceof Float32Array) return new FloatNeuroVol(space, data);
  if (data instanceof Float64Array) return new Float64NeuroVol(space, data);
  // DenseNeuroVol has no UInt32 implementation. Promotion is lossless because
  // every uint32 integer is exactly representable in float64.
  return new Float64NeuroVol(space, Float64Array.from(data));
}

/**
 * Decode uncompressed `.nii` or gzip-compressed `.nii.gz` bytes in a browser.
 *
 * The module has no Node `fs`, `path`, `Buffer`, or filename dependency. Fetch
 * a file or data URL yourself, then pass the resulting ArrayBuffer here.
 *
 * Exported from the browser entry only: `nifti-reader-js` is ESM-only, and a
 * static import would break `require('neuroimjs')` in the CommonJS build.
 */
export function readNiftiArrayBuffer(input: ArrayBuffer, options: BrowserNiftiOptions = {}): NeuroVol {
  let buffer: ArrayBuffer = input;
  if (nifti.isCompressed(buffer)) {
    buffer = toArrayBuffer(nifti.decompress(buffer));
  }
  if (!nifti.isNIFTI(buffer)) {
    throw new Error('Input is not a valid NIfTI-1 or NIfTI-2 image.');
  }
  const header = nifti.readHeader(buffer);
  if (!header?.dims || header.dims.length < 4) {
    throw new Error('NIfTI header has invalid dimensions.');
  }
  const rank = Number(header.dims[0]);
  if (rank !== 3 && rank !== 4) {
    throw new Error(`Expected a 3D or 4D NIfTI image, found ${rank}D.`);
  }
  const dimensions = [Number(header.dims[1]), Number(header.dims[2]), Number(header.dims[3])];
  if (dimensions.some(value => !Number.isInteger(value) || value <= 0)) {
    throw new Error(`NIfTI has invalid spatial dimensions: ${dimensions.join('x')}.`);
  }
  const volumeCount = rank === 4 ? Number(header.dims[4]) : 1;
  const index = options.index ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= volumeCount) {
    throw new Error(`Volume index ${index} is outside [0, ${volumeCount - 1}].`);
  }

  const completeImage = toArrayBuffer(nifti.readImage(header, buffer));
  const bytesPerVoxel = Number(header.numBitsPerVoxel) / 8;
  const bytesPerVolume = dimensions[0] * dimensions[1] * dimensions[2] * bytesPerVoxel;
  const start = index * bytesPerVolume;
  const image = completeImage.slice(start, start + bytesPerVolume);
  if (image.byteLength !== bytesPerVolume) {
    throw new Error('NIfTI image data is truncated.');
  }

  const affineValues = header.affine.map(row => Array.from(row, Number));
  const affine = new Matrix(affineValues);
  const spacing = [0, 1, 2].map(column =>
    Math.hypot(affine.get(0, column), affine.get(1, column), affine.get(2, column))
  );
  const origin = [affine.get(0, 3), affine.get(1, 3), affine.get(2, 3)];
  const space = new NeuroSpace(dimensions, spacing, origin, nearestAnatomy(affine), affineValues);
  return createVolume(space, scaledImage(typedImage(image, header), header));
}
