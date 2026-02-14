// src/volume/NeuroSlice.ts

import { NeuroSpace } from '../geometry/NeuroSpace';
import { Matrix } from 'ml-matrix';
import { TypedArray } from '../types';
import { NumericType } from '../types';


/**
 * Abstract base class for representing a 2D slice of neuroimaging data.
 */
export abstract class NeuroSlice {
  /**
   * The 2D geometric space of the slice data.
   */
  protected _space: NeuroSpace;

  /**
   * The raw 2D slice data.
   */
  protected data: TypedArray;

  /**
   * Constructs a NeuroSlice instance.
   * @param space - The 2D geometric space of the slice data.
   * @param data - The raw 2D slice data.
   * @throws {Error} If `space.dim` is not 2-dimensional or `data.length` does not match `space.dim`.
   */
  constructor(space: NeuroSpace, data: TypedArray) {
    if (space.dim.length !== 2) {
      throw new Error('NeuroSpace for NeuroSlice must be 2-dimensional');
    }

    const expectedLength = space.dim[0] * space.dim[1];
    if (data.length !== expectedLength) {
      throw new Error('Data length does not match the dimensions specified in space');
    }

    this._space = space;
    this.data = data;
  }

  /**
   * Get the dimensions of the slice.
   * @returns An array of two numbers representing the dimensions.
   */
  get dim(): number[] {
    return this.space.dim;
  }

  /**
   * Get the NeuroSpace object associated with this slice.
   * @returns The NeuroSpace object representing the geometric space of the slice.
   */
  get space(): NeuroSpace {
    return this._space;
  }

  /**
   * Get the spacing of the slice.
   * @returns An array of two numbers representing the spacing.
   */
  get spacing(): number[] {
    return this.space.spacing;
  }

  /**
   * Get the origin of the slice.
   * @returns An array of two numbers representing the origin.
   */
  get origin(): number[] {
    return this.space.origin;
  }

  get trans(): Matrix {
    return this.space.trans;
  }

  get inverseTrans(): Matrix {
    return this.space.inverseTrans;
  }

  /**
   * Get a pixel value at specified coordinates.
   * @param i - x-coordinate
   * @param j - y-coordinate
   * @returns The pixel value.
   * @throws {RangeError} If coordinates are out of bounds.
   */
  getAt(i: number, j: number): number {
    const [nx, ny] = this.dim;
    if (i < 0 || i >= nx || j < 0 || j >= ny) {
      throw new RangeError('Coordinates out of bounds');
    }
    const index = j * nx + i;
    return this.data[index];
  }

  /**
   * Set a pixel value at specified coordinates.
   * @param i - x-coordinate
   * @param j - y-coordinate
   * @param value - The value to set.
   * @throws {RangeError} If coordinates are out of bounds.
   */
  setAt(i: number, j: number, value: number): void {
    const [nx, ny] = this.dim;
    if (i < 0 || i >= nx || j < 0 || j >= ny) {
      throw new RangeError('Coordinates out of bounds');
    }
    const index = j * nx + i;
    this.data[index] = value as any; // Type assertion since TypedArray elements are numbers
  }

  /**
   * Get a row of the slice.
   * @param j - y-coordinate of the row
   * @returns The row data as the same TypedArray type.
   * @throws {RangeError} If the row index is out of bounds.
   */
  getRow(j: number): TypedArray {
    const [nx, ny] = this.dim;
    if (j < 0 || j >= ny) {
      throw new RangeError('Row index out of bounds');
    }
    return this.data.slice(j * nx, (j + 1) * nx);
  }

  /**
   * Get a column of the slice.
   * @param i - x-coordinate of the column
   * @returns The column data as the same TypedArray type.
   * @throws {RangeError} If the column index is out of bounds.
   */
  getColumn(i: number): TypedArray {
    const [nx, ny] = this.dim;
    if (i < 0 || i >= nx) {
      throw new RangeError('Column index out of bounds');
    }
    const columnData = new (this.data.constructor as { new (length: number): TypedArray })(ny);
    for (let j = 0; j < ny; j++) {
      columnData[j] = this.data[j * nx + i];
    }
    return columnData;
  }


  /**
   * Abstract method to get the type of TypedArray.
   * @returns The type of TypedArray as a string.
   */
  protected abstract getTypedArrayType(): NumericType;

  

  /**
   * Public getter for the underlying data array.
   * @returns The TypedArray containing the slice data.
   */
  public getData(): TypedArray {
    return this.data;
  }
}

/**
 * Concrete NeuroSlice class using Float32Array.
 */
export class Int16NeuroSlice extends NeuroSlice {
  constructor(space: NeuroSpace, data: Int16Array) {
    super(space, data);
  }

  protected getTypedArrayType(): 'int16' {
    return 'int16';
  } 
}

/**
 * Concrete NeuroSlice class using Uint8Array.
 */
export class Uint8NeuroSlice extends NeuroSlice {
  constructor(space: NeuroSpace, data: Uint8Array) {
    super(space, data);
  }

  protected getTypedArrayType(): 'uint8' {
    return 'uint8';
  }

  // Additional Uint8Array-specific methods can be added here
}

/**
 * Concrete NeuroSlice class using Float32Array.
 */
export class FloatNeuroSlice extends NeuroSlice {
  constructor(space: NeuroSpace, data: Float32Array) {
    super(space, data);
  }

  protected getTypedArrayType(): 'float32' {
    return 'float32';
  }

  // Additional Float32Array-specific methods can be added here
}

/**
 * Concrete NeuroSlice class using Float64Array.
 */
export class Float64NeuroSlice extends NeuroSlice {
  constructor(space: NeuroSpace, data: Float64Array) {
    super(space, data);
  }

  protected getTypedArrayType(): 'float64' {
    return 'float64';
  }

  // Additional Float64Array-specific methods can be added here
}

export class Int32NeuroSlice extends NeuroSlice {
  constructor(space: NeuroSpace, data: Int32Array) {
    super(space, data);
  }

  protected getTypedArrayType(): 'int32' {
    return 'int32';
  }
}

export class Int8NeuroSlice extends NeuroSlice {
  constructor(space: NeuroSpace, data: Int8Array) {
    super(space, data);
  }

  protected getTypedArrayType(): 'int8' {
    return 'int8';
  }
}










