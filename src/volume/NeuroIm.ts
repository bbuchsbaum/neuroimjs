import { NeuroSlice } from './NeuroSlice';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { FloatNeuroSlice } from './NeuroSlice';
import { Uint8NeuroSlice } from './NeuroSlice';
import { Int16NeuroSlice } from './NeuroSlice';
import { Int16NeuroVol } from './DenseNeuroVol';
import { UInt8NeuroVol } from './DenseNeuroVol';
import { Int32NeuroVol } from './DenseNeuroVol';
import { Int8NeuroVol } from './DenseNeuroVol';
import { Float64NeuroVol } from './DenseNeuroVol';
import { FloatNeuroVol } from './DenseNeuroVol';
import { Int32NeuroSlice } from './NeuroSlice';
import { Int8NeuroSlice } from './NeuroSlice';
import { Float64NeuroSlice } from './NeuroSlice';
import { NeuroVol } from './NeuroVol';
import { SliceTypedArrayType } from '../types';
import { TypedArray } from '../types'

/**
 * Factory function to create specific NeuroSlice instances based on TypedArray type.
 * @param type - The type of TypedArray to use.
 * @param space - The geometric space of the slice data.
 * @param data - The raw 2D slice data.
 * @returns An instance of NeuroSlice.
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
    case 'int32':
      return new Int32NeuroSlice(space, data as Int32Array);
    case 'int8':
      return new Int8NeuroSlice(space, data as Int8Array);
    case 'float64':
      return new Float64NeuroSlice(space, data as Float64Array);
    default:
      throw new Error(`Unsupported TypedArray type: ${type}`);
  }
}

/**
 * Factory function to create specific NeuroVol instances based on TypedArray type.
 * @param type - The type of TypedArray to use.
 * @param space - The geometric space of the volume data.
 * @param data - The raw 3D volume data.
 * @returns An instance of NeuroVol.
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
    case 'int32':
      return new Int32NeuroVol(space, data as Int32Array);
    case 'int8':
      return new Int8NeuroVol(space, data as Int8Array);
    case 'float64':
      return new Float64NeuroVol(space, data as Float64Array);
    default:
      throw new Error(`Unsupported TypedArray type: ${type}`);
  }
}




