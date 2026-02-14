import { NeuroVec } from '../vec/NeuroVec';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { NeuroVol } from '../volume/NeuroVol';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { ValueError, TypeError, TypedArray } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';

/**
 * TypeScript implementation of memory-mapped arrays similar to numpy's memmap.
 * Uses Node.js fs and Buffer for file-based array storage.
 */
class MemoryMappedArray {
  private fd: number;
  private buffer: Buffer;
  private _shape: number[];
  private _dtype: string;
  private itemSize: number;
  private totalSize: number;
  
  constructor(
    filename: string,
    dtype: string = 'float32',
    mode: string = 'r+',
    shape?: number[],
    order: string = 'C'
  ) {
    this._dtype = dtype;
    this._shape = shape || [];
    
    // Determine item size based on dtype
    switch (dtype) {
      case 'float32':
        this.itemSize = 4;
        break;
      case 'float64':
        this.itemSize = 8;
        break;
      case 'int32':
        this.itemSize = 4;
        break;
      case 'uint8':
        this.itemSize = 1;
        break;
      default:
        throw new ValueError(`Unsupported dtype: ${dtype}`);
    }
    
    // Calculate total size
    this.totalSize = shape ? shape.reduce((a, b) => a * b, 1) * this.itemSize : 0;
    
    // Ensure directory exists
    const dir = path.dirname(filename);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Open or create file
    if (mode === 'w+' || !fs.existsSync(filename)) {
      // Create new file
      this.fd = fs.openSync(filename, 'w+');
      if (this.totalSize > 0) {
        // Allocate space
        fs.ftruncateSync(this.fd, this.totalSize);
      }
    } else {
      // Open existing file
      const flags = mode === 'r' ? 'r' : 'r+';
      this.fd = fs.openSync(filename, flags);
      
      // Get file size if shape not provided
      if (!shape) {
        const stats = fs.fstatSync(this.fd);
        this.totalSize = stats.size;
      }
    }
    
    // Create buffer view
    this.buffer = Buffer.alloc(this.totalSize);
    if (fs.existsSync(filename) && this.totalSize > 0) {
      fs.readSync(this.fd, this.buffer, 0, this.totalSize, 0);
    }
  }
  
  get shape(): number[] {
    return this._shape;
  }
  
  get dtype(): string {
    return this._dtype;
  }
  
  /**
   * Get value at linear index
   */
  get(index: number): number {
    const offset = index * this.itemSize;
    switch (this._dtype) {
      case 'float32':
        return this.buffer.readFloatLE(offset);
      case 'float64':
        return this.buffer.readDoubleLE(offset);
      case 'int32':
        return this.buffer.readInt32LE(offset);
      case 'uint8':
        return this.buffer.readUInt8(offset);
      default:
        throw new ValueError(`Unsupported dtype: ${this._dtype}`);
    }
  }
  
  /**
   * Set value at linear index
   */
  set(index: number, value: number): void {
    const offset = index * this.itemSize;
    switch (this._dtype) {
      case 'float32':
        this.buffer.writeFloatLE(value, offset);
        break;
      case 'float64':
        this.buffer.writeDoubleLE(value, offset);
        break;
      case 'int32':
        this.buffer.writeInt32LE(value, offset);
        break;
      case 'uint8':
        this.buffer.writeUInt8(value, offset);
        break;
      default:
        throw new ValueError(`Unsupported dtype: ${this._dtype}`);
    }
  }
  
  /**
   * Get value at multi-dimensional index
   */
  getAt(...indices: number[]): number {
    const linearIndex = this.indicesToLinear(indices);
    return this.get(linearIndex);
  }
  
  /**
   * Set value at multi-dimensional index
   */
  setAt(...args: number[]): void {
    const value = args[args.length - 1];
    const indices = args.slice(0, -1);
    const linearIndex = this.indicesToLinear(indices);
    this.set(linearIndex, value);
  }
  
  /**
   * Convert multi-dimensional indices to linear index
   */
  private indicesToLinear(indices: number[]): number {
    if (indices.length !== this._shape.length) {
      throw new ValueError('Invalid number of indices');
    }
    
    let linearIndex = 0;
    let stride = 1;
    
    // C-order (row-major)
    for (let i = this._shape.length - 1; i >= 0; i--) {
      linearIndex += indices[i] * stride;
      stride *= this._shape[i];
    }
    
    return linearIndex;
  }
  
  /**
   * Extract a slice of data
   */
  slice(start: number, end: number): TypedArray {
    const length = end - start;
    const result = this.createTypedArray(length);
    
    for (let i = 0; i < length; i++) {
      result[i] = this.get(start + i);
    }
    
    return result;
  }
  
  /**
   * Create typed array of appropriate type
   */
  private createTypedArray(length: number): TypedArray {
    switch (this._dtype) {
      case 'float32':
        return new Float32Array(length);
      case 'float64':
        return new Float64Array(length);
      case 'int32':
        return new Int32Array(length);
      case 'uint8':
        return new Uint8Array(length);
      default:
        throw new ValueError(`Unsupported dtype: ${this._dtype}`);
    }
  }
  
  /**
   * Flush changes to disk
   */
  flush(): void {
    fs.writeSync(this.fd, this.buffer, 0, this.totalSize, 0);
    fs.fsyncSync(this.fd);
  }
  
  /**
   * Close the file
   */
  close(): void {
    this.flush();
    fs.closeSync(this.fd);
  }
  
  /**
   * Get a view of the data as typed array (loads into memory)
   */
  toArray(): TypedArray {
    return this.slice(0, this._shape.reduce((a, b) => a * b, 1));
  }
}

/**
 * BigNeuroVec - Memory-mapped neuroimaging vector data.
 * 
 * This class provides efficient handling of large 4D neuroimaging data
 * by using memory-mapped arrays that remain on disk.
 * 
 * Direct translation of Python's BigNeuroVec class.
 */
export class BigNeuroVec implements NeuroVec {
  private _data: MemoryMappedArray;
  private _tempFile?: string;
  private _ownsFile: boolean;
  readonly filename: string;
  readonly mode: string;
  readonly space: NeuroSpace;
  
  /**
   * Creates a BigNeuroVec instance.
   * 
   * Can be initialized in two ways:
   * 1. With data and space (creates new memory-mapped file)
   * 2. With filename and shape (opens or creates file)
   */
  constructor(
    dataOrFilename: TypedArray | string,
    spaceOrShape?: NeuroSpace | number[],
    options?: {
      filename?: string;
      mode?: string;
      dtype?: string;
    }
  ) {
    // Determine initialization mode
    if (typeof dataOrFilename === 'string') {
      // Initialize from filename
      const filename = dataOrFilename;
      const shape = spaceOrShape as number[];
      
      if (!shape || shape.length !== 4) {
        throw new ValueError('BigNeuroVec requires 4D shape');
      }
      
      // Create NeuroSpace from shape
      const space = new NeuroSpace(
        shape,
        [1.0, 1.0, 1.0, 1.0],
        [0.0, 0.0, 0.0, 0.0]
      );
      
      this.space = space;
      
      this.filename = filename;
      this.mode = options?.mode || 'r+';
      this._ownsFile = false;
      
      // Create memory-mapped array
      this._data = new MemoryMappedArray(
        filename,
        options?.dtype || 'float32',
        this.mode,
        shape
      );
      
    } else {
      // Initialize from data
      const data = dataOrFilename as TypedArray;
      const space = spaceOrShape as NeuroSpace;
      
      if (!space) {
        throw new ValueError('Space is required when initializing with data');
      }
      
      this.space = space;
      
      // Validate data shape
      const expectedSize = space.dim.reduce((a, b) => a * b, 1);
      if (data.length !== expectedSize) {
        throw new ValueError(`Data length ${data.length} does not match space size ${expectedSize}`);
      }
      
      // Handle filename
      if (options?.filename) {
        this.filename = options.filename;
        this._ownsFile = false;
      } else {
        // Create temporary file
        const tmpDir = process.env.TMPDIR || '/tmp';
        this._tempFile = path.join(tmpDir, `bigneuro_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.dat`);
        this.filename = this._tempFile;
        this._ownsFile = true;
      }
      
      this.mode = options?.mode || 'r+';
      
      // Determine dtype from TypedArray type
      let dtype = 'float32';
      if (data instanceof Float64Array) dtype = 'float64';
      else if (data instanceof Int32Array) dtype = 'int32';
      else if (data instanceof Uint8Array) dtype = 'uint8';
      
      // Create memory-mapped array and fill with data
      this._data = new MemoryMappedArray(
        this.filename,
        dtype,
        'w+',
        space.dim
      );
      
      // Copy data
      for (let i = 0; i < data.length; i++) {
        this._data.set(i, data[i]);
      }
      
      this._data.flush();
    }
  }
  
  get data(): TypedArray {
    // Return a view of the data (loads into memory)
    return this._data.toArray();
  }
  
  get values(): TypedArray {
    return this.data;
  }
  
  get length(): number {
    return this._data.shape.reduce((a, b) => a * b, 1);
  }
  
  get dim(): number[] {
    return this._data.shape;
  }
  
  get shape(): number[] {
    return this._data.shape;
  }
  
  get spacing(): number[] {
    return this.space.spacing;
  }
  
  get origin(): number[] {
    return this.space.origin;
  }
  
  /**
   * Get volume at time point t
   */
  getVolume(t: number): NeuroVol {
    if (t < 0 || t >= this.shape[0]) {
      throw new ValueError(`Time index ${t} out of bounds`);
    }
    
    const volSpace = new NeuroSpace(
      this.shape.slice(1),
      this.space.spacing.slice(1),
      this.space.origin.slice(1)
    );
    
    const volData = new Float32Array(this.shape[1] * this.shape[2] * this.shape[3]);
    let idx = 0;
    
    for (let i = 0; i < this.shape[1]; i++) {
      for (let j = 0; j < this.shape[2]; j++) {
        for (let k = 0; k < this.shape[3]; k++) {
          volData[idx++] = this.getAt(i, j, k, t);
        }
      }
    }
    
    return new FloatNeuroVol(volSpace, volData);
  }
  
  /**
   * Get time series at voxel (i, j, k)
   */
  getSeries(i: number, j: number, k: number): number[] {
    const series: number[] = [];
    for (let t = 0; t < this.shape[0]; t++) {
      series.push(this.getAt(i, j, k, t));
    }
    return series;
  }
  
  /**
   * Get all data (loads into memory)
   */
  getData(): TypedArray {
    return this._data.toArray();
  }
  
  /**
   * Get data range [min, max]
   */
  getRange(): [number, number] {
    // This is inefficient for large data, but necessary for interface compliance
    // In practice, this could be cached or computed in chunks
    let min = Infinity;
    let max = -Infinity;
    
    const totalSize = this.length;
    for (let i = 0; i < totalSize; i++) {
      const val = this._data.get(i);
      if (val < min) min = val;
      if (val > max) max = val;
    }
    
    return [min, max];
  }
  
  /**
   * Get value at 4D index (interface uses i,j,k,t order)
   */
  getAt(i: number, j: number, k: number, t: number): number {
    return this._data.getAt(t, i, j, k);
  }
  
  /**
   * Set value at 4D index (interface uses i,j,k,t order)
   */
  setAt(i: number, j: number, k: number, t: number, value: number): void {
    if (this.mode === 'r') {
      throw new ValueError('Cannot modify read-only BigNeuroVec');
    }
    this._data.setAt(t, i, j, k, value);
  }
  
  series(x: number | number[][], y?: number, z?: number): TypedArray {
    if (typeof x === 'number' && y !== undefined && z !== undefined) {
      // Single voxel time series
      const result = new Float32Array(this.shape[0]);
      for (let t = 0; t < this.shape[0]; t++) {
        result[t] = this.getAt(x, y, z, t);
      }
      return result;
    } else if (Array.isArray(x)) {
      // Multiple voxels
      const coords = x as number[][];
      const result = new Float32Array(this.shape[0] * coords.length);
      
      for (let i = 0; i < coords.length; i++) {
        const [xi, yi, zi] = coords[i];
        for (let t = 0; t < this.shape[0]; t++) {
          if (xi >= 0 && xi < this.shape[1] &&
              yi >= 0 && yi < this.shape[2] &&
              zi >= 0 && zi < this.shape[3]) {
            result[t * coords.length + i] = this.getAt(xi, yi, zi, t);
          }
        }
      }
      
      return result;
    } else {
      throw new ValueError('Invalid arguments for series extraction');
    }
  }
  
  subVector(indices: number[] | number): BigNeuroVec {
    const idxArray = Array.isArray(indices) ? indices : [indices];
    
    // Create new shape
    const newShape = [idxArray.length, ...this.shape.slice(1)];
    
    // Create new BigNeuroVec
    const result = new BigNeuroVec(
      `${this.filename}_subset_${Date.now()}.dat`,
      newShape
    );
    
    // Copy data
    for (let newT = 0; newT < idxArray.length; newT++) {
      const oldT = idxArray[newT];
      for (let i = 0; i < this.shape[1]; i++) {
        for (let j = 0; j < this.shape[2]; j++) {
          for (let k = 0; k < this.shape[3]; k++) {
            const value = this.getAt(i, j, k, oldT);
            result.setAt(i, j, k, newT, value);
          }
        }
      }
    }
    
    result.flush();
    return result;
  }
  
  vols(indices?: number[]): NeuroVol[] {
    const idxArray = indices || Array.from({ length: this.shape[0] }, (_, i) => i);
    
    const volSpace = new NeuroSpace(
      this.shape.slice(1),
      this.space.spacing.slice(1),
      this.space.origin.slice(1)
    );
    
    const volumes: NeuroVol[] = [];
    
    for (const t of idxArray) {
      const volData = new Float32Array(this.shape[1] * this.shape[2] * this.shape[3]);
      let idx = 0;
      
      for (let i = 0; i < this.shape[1]; i++) {
        for (let j = 0; j < this.shape[2]; j++) {
          for (let k = 0; k < this.shape[3]; k++) {
            volData[idx++] = this.getAt(i, j, k, t);
          }
        }
      }
      
      volumes.push(new FloatNeuroVol(volSpace, volData));
    }
    
    return volumes;
  }
  
  /**
   * Process data in chunks to avoid loading entire dataset into memory
   */
  processChunks<T>(
    func: (chunk: TypedArray) => T,
    chunkSize: number = 100,
    axis: number = 0
  ): T[] {
    if (axis !== 0) {
      throw new ValueError('Only time axis (0) chunking is currently supported');
    }
    
    const results: T[] = [];
    const nChunks = Math.ceil(this.shape[0] / chunkSize);
    
    for (let i = 0; i < nChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min((i + 1) * chunkSize, this.shape[0]);
      const chunkLength = (end - start) * this.shape[1] * this.shape[2] * this.shape[3];
      
      // Extract chunk data
      const chunk = new Float32Array(chunkLength);
      let idx = 0;
      
      for (let t = start; t < end; t++) {
        for (let x = 0; x < this.shape[1]; x++) {
          for (let y = 0; y < this.shape[2]; y++) {
            for (let z = 0; z < this.shape[3]; z++) {
              chunk[idx++] = this.getAt(x, y, z, t);
            }
          }
        }
      }
      
      results.push(func(chunk));
    }
    
    return results;
  }
  
  /**
   * Flush memory-mapped data to disk
   */
  flush(): void {
    this._data.flush();
  }
  
  /**
   * Close the memory-mapped file
   */
  close(): void {
    this._data.close();
  }
  
  /**
   * Clean up temporary files
   */
  cleanup(): void {
    this.close();
    if (this._ownsFile && this._tempFile && fs.existsSync(this._tempFile)) {
      fs.unlinkSync(this._tempFile);
    }
  }
  
  toString(): string {
    return `BigNeuroVec
  Type      : BigNeuroVec (memory-mapped)
  Dimension : ${this.shape.join(' X ')}
  Spacing   : ${this.space.spacing.join(' X ')}
  Origin    : ${this.space.origin.join(', ')}
  Filename  : ${this.filename}
  Mode      : ${this.mode}`;
  }
}

/**
 * Create BigNeuroVec from a sequence of volumes
 */
export function bigNeuroVecSeq(vols: NeuroVol[]): BigNeuroVec {
  if (vols.length === 0) {
    throw new ValueError('vols array cannot be empty');
  }
  
  // Get dimensions from first volume
  const firstVol = vols[0];
  const volShape = firstVol.space.dim;
  const nVols = vols.length;
  
  // Create 4D space
  const space4d = new NeuroSpace(
    [nVols, ...volShape],
    [1, ...firstVol.space.spacing],
    [0, ...firstVol.space.origin]
  );
  
  // Create data array
  const totalSize = nVols * volShape.reduce((a, b) => a * b, 1);
  const data = new Float32Array(totalSize);
  
  // Fill with volume data
  let offset = 0;
  const volSize = volShape.reduce((a, b) => a * b, 1);
  
  for (let i = 0; i < nVols; i++) {
    const vol = vols[i];
    if (!vol.space.dim.every((dim, idx) => dim === volShape[idx])) {
      throw new ValueError(`Volume ${i} has inconsistent shape`);
    }
    
    // Copy volume data
    const volData = vol.getData();
    data.set(volData, offset);
    offset += volSize;
  }
  
  return new BigNeuroVec(data, space4d);
}