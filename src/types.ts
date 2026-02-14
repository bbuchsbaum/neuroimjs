// Core TypedArray types for neuroimaging data
export type TypedArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Uint8ClampedArray;

// Numeric type strings for array construction
export type NumericType = 
  | 'float32'
  | 'float64'
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32';

// Legacy alias for backward compatibility
export type SliceTypedArrayType = NumericType;

// Common types
export type Range = [number, number];
export type Threshold = [number, number];
export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

// Coordinate types
export type Point3D = [number, number, number];
export type Point4D = [number, number, number, number];
export type VoxelCoord = Point3D;
export type VoxelCoord4D = Point4D;
export type RealCoord = Point3D;
export type RealCoord4D = Point4D;

// Shape and dimension types
export type Shape3D = [number, number, number];
export type Shape4D = [number, number, number, number];
export type Spacing3D = [number, number, number];
export type Spacing4D = [number, number, number, number];
export type Origin3D = [number, number, number];
export type Origin4D = [number, number, number, number];

// Matrix types
export type Matrix3x3 = number[][];
export type Matrix4x4 = number[][];
export type AffineMatrix = Matrix4x4;

// Interpolation methods
export type InterpolationMethod = 'nearest' | 'linear' | 'cubic' | 'trilinear';

// File format types
export type FileFormat = 'nifti' | 'nifti1' | 'nifti2' | 'afni' | 'mgz' | 'mgh';

// ROI types
export type ROIType = 'coords' | 'volume' | 'vector' | 'surface';

// Statistical types
export type StatMethod = 'mean' | 'median' | 'std' | 'var' | 'min' | 'max' | 'sum';

// Error classes following Python pattern
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueError';
  }
}

export class TypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TypeError';
  }
}

export class NotImplementedError extends Error {
  constructor(message: string = 'Method not implemented') {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export class IOError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IOError';
  }
}

// Type guards
export function isTypedArray(value: any): value is TypedArray {
  return value instanceof Float32Array ||
         value instanceof Float64Array ||
         value instanceof Int8Array ||
         value instanceof Uint8Array ||
         value instanceof Int16Array ||
         value instanceof Uint16Array ||
         value instanceof Int32Array ||
         value instanceof Uint32Array ||
         value instanceof Uint8ClampedArray;
}

export function isNumericType(value: string): value is NumericType {
  return ['float32', 'float64', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32'].includes(value);
}

// TypedArray constructor mapping
export function getTypedArrayConstructor(type: NumericType): new (length: number) => TypedArray {
  switch (type) {
    case 'float32':
      return Float32Array;
    case 'float64':
      return Float64Array;
    case 'int32':
      return Int32Array;
    case 'int16':
      return Int16Array;
    case 'uint16':
      return Uint16Array;
    case 'int8':
      return Int8Array;
    case 'uint8':
      return Uint8Array;
    case 'uint32':
      return Uint32Array;
    default:
      throw new ValueError(`Unsupported numeric type: ${type}`);
  }
}

// Get numeric type from TypedArray instance
export function getNumericType(array: TypedArray): NumericType {
  if (array instanceof Float32Array) return 'float32';
  if (array instanceof Float64Array) return 'float64';
  if (array instanceof Int32Array) return 'int32';
  if (array instanceof Int16Array) return 'int16';
  if (array instanceof Uint16Array) return 'uint16';
  if (array instanceof Int8Array) return 'int8';
  if (array instanceof Uint8Array) return 'uint8';
  if (array instanceof Uint32Array) return 'uint32';
  throw new ValueError('Unknown TypedArray type');
}

// Metadata types
export interface MetaInfo {
  dataType: NumericType;
  dimensions: number[];
  spacing?: number[];
  origin?: number[];
  direction?: number[][];
  units?: string[];
  description?: string;
  [key: string]: any; // Allow additional metadata
}

// Sparse data representation
export interface SparseData {
  indices: number[];
  values: number[];
  shape: number[];
  defaultValue?: number;
}

// Memory-mapped file options
export interface MemoryMappedOptions {
  readonly: boolean;
  offset?: number;
  shape?: number[];
  dtype?: NumericType;
}

// Parallel processing options
export interface ParallelOptions {
  numWorkers?: number;
  chunkSize?: number;
  transferable?: boolean;
}

// Export type utilities
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type AsyncResult<T> = Promise<T>;

// Generic constraints
export type NumericArray = TypedArray | number[];
export type DataArray<T extends TypedArray = TypedArray> = T;

// Axis types (matching Python)
export type AxisName = 'i' | 'j' | 'k' | 't' | 'x' | 'y' | 'z';
export type AxisDirection = '+' | '-';
export type AxisSpec = `${AxisDirection}${AxisName}`;