import { NeuroSlice } from './NeuroSlice';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { FloatNeuroSlice } from './NeuroSlice';
import { Uint8NeuroSlice } from './NeuroSlice';
import { Int16NeuroSlice } from './NeuroSlice';
import { Uint16NeuroSlice } from './NeuroSlice';
import { Int16NeuroVol } from './DenseNeuroVol';
import { UInt8NeuroVol } from './DenseNeuroVol';
import { Int32NeuroVol } from './DenseNeuroVol';
import { Int8NeuroVol } from './DenseNeuroVol';
import { UInt16NeuroVol } from './DenseNeuroVol';
import { Float64NeuroVol } from './DenseNeuroVol';
import { FloatNeuroVol } from './DenseNeuroVol';
import { Int32NeuroSlice } from './NeuroSlice';
import { Int8NeuroSlice } from './NeuroSlice';
import { Float64NeuroSlice } from './NeuroSlice';
import { NeuroVol } from './NeuroVol';
import { SliceTypedArrayType } from '../types';
import { TypedArray } from '../types';
import { NeuroimError } from '../errors';

function unsupportedType(type: string, what: string): NeuroimError {
  // The message text is pinned by the nibabel conformance suite's KNOWN table
  // (readVol on uint32 NIfTI); keep it stable.
  return new NeuroimError('UNSUPPORTED_DATATYPE', `Unsupported TypedArray type: ${type}`, {
    details: { type, factory: what },
  });
}

/**
 * Factory function to create specific NeuroSlice instances based on TypedArray type.
 * @param type - The type of TypedArray to use.
 * @param space - The geometric space of the slice data.
 * @param data - The raw 2D slice data.
 * @returns An instance of NeuroSlice.
 * @throws {NeuroimError} `UNSUPPORTED_DATATYPE` for a type with no slice class ('uint32').
 */
export function createNeuroSlice(
  type: SliceTypedArrayType,
  space: NeuroSpace,
  data: TypedArray
): NeuroSlice {
  switch (type) {
    case 'float32':
      return new FloatNeuroSlice(space, data as Float32Array);
    case 'uint8':
      return new Uint8NeuroSlice(space, data as Uint8Array);
    case 'int16':
      return new Int16NeuroSlice(space, data as Int16Array);
    case 'uint16':
      return new Uint16NeuroSlice(space, data as Uint16Array);
    case 'int32':
      return new Int32NeuroSlice(space, data as Int32Array);
    case 'int8':
      return new Int8NeuroSlice(space, data as Int8Array);
    case 'float64':
      return new Float64NeuroSlice(space, data as Float64Array);
    default:
      // 'uint32' has no slice (or volume) class yet.
      throw unsupportedType(type, 'createNeuroSlice');
  }
}

/**
 * Factory function to create specific NeuroVol instances based on TypedArray type.
 * @param type - The type of TypedArray to use.
 * @param space - The geometric space of the volume data.
 * @param data - The raw 3D volume data.
 * @returns An instance of NeuroVol.
 * @throws {NeuroimError} `UNSUPPORTED_DATATYPE` for a type with no volume class ('uint32').
 */
export function createNeuroVol(
  type: SliceTypedArrayType,
  space: NeuroSpace,
  data?: TypedArray
): NeuroVol {
  switch (type) {
    case 'float32':
      return new FloatNeuroVol(space, data as Float32Array);
    case 'uint8':
      return new UInt8NeuroVol(space, data as Uint8Array);
    case 'int16':
      return new Int16NeuroVol(space, data as Int16Array);
    case 'uint16':
      return new UInt16NeuroVol(space, data as Uint16Array);
    case 'int32':
      return new Int32NeuroVol(space, data as Int32Array);
    case 'int8':
      return new Int8NeuroVol(space, data as Int8Array);
    case 'float64':
      return new Float64NeuroVol(space, data as Float64Array);
    default:
      // 'uint32' has no UInt32NeuroVol yet (tracked separately).
      throw unsupportedType(type, 'createNeuroVol');
  }
}




