/**
 * Implementation of high-dimensional neuroimaging data structure
 */

import { NeuroVol } from '../volume/NeuroVol';
import { NeuroVec, DenseNeuroVec } from '../vec/NeuroVec';
import { Float32NeuroVec } from '../vec/NeuroVec';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import {
  INeuroHyperVec,
  DimensionInfo,
  NeuroHyperVecOptions,
  ReductionOptions,
  FeatureExtractionOptions,
  ReductionOp
} from './INeuroHyperVec';

/**
 * Dense implementation of NeuroHyperVec
 */
export class DenseNeuroHyperVec implements INeuroHyperVec {
  spatialDim: [number, number, number];
  space: NeuroSpace;
  dimensions: DimensionInfo[];
  private data: Float32Array;
  private strides: number[];
  private dimMap: Map<string, number>;

  constructor(
    space: NeuroSpace,
    dimensions: DimensionInfo[],
    data?: Float32Array
  ) {
    if (space.ndim() !== 3) {
      throw new Error('NeuroHyperVec requires 3D spatial dimensions');
    }

    this.space = space;
    this.spatialDim = space.dim as [number, number, number];
    this.dimensions = dimensions;
    
    // Create dimension name to index map
    this.dimMap = new Map();
    this.dimMap.set('x', 0);
    this.dimMap.set('y', 1);
    this.dimMap.set('z', 2);
    dimensions.forEach((dim, i) => {
      this.dimMap.set(dim.name, i + 3);
    });

    // Calculate strides for efficient indexing
    this.strides = this.calculateStrides();

    // Initialize data
    const totalSize = this.size;
    this.data = data || new Float32Array(totalSize);
  }

  get ndim(): number {
    return 3 + this.dimensions.length;
  }

  get shape(): number[] {
    return [...this.spatialDim, ...this.dimensions.map(d => d.size)];
  }

  get size(): number {
    return this.shape.reduce((a, b) => a * b, 1);
  }

  /**
   * Calculate strides for multi-dimensional indexing
   */
  private calculateStrides(): number[] {
    const shape = this.shape;
    const strides = new Array(shape.length);
    strides[strides.length - 1] = 1;
    
    for (let i = strides.length - 2; i >= 0; i--) {
      strides[i] = strides[i + 1] * shape[i + 1];
    }
    
    return strides;
  }

  /**
   * Convert multi-dimensional index to linear index
   */
  private indicesToLinear(indices: number[]): number {
    let linear = 0;
    for (let i = 0; i < indices.length; i++) {
      linear += indices[i] * this.strides[i];
    }
    return linear;
  }

  /**
   * Parse dimension specification into indices
   */
  private parseIndices(spec: Record<string, number | number[]>): Map<string, number[]> {
    const result = new Map<string, number[]>();
    
    // Add spatial dimensions if not specified
    if (!spec.x) result.set('x', Array.from({length: this.spatialDim[0]}, (_, i) => i));
    if (!spec.y) result.set('y', Array.from({length: this.spatialDim[1]}, (_, i) => i));
    if (!spec.z) result.set('z', Array.from({length: this.spatialDim[2]}, (_, i) => i));
    
    // Process specified dimensions
    for (const [name, value] of Object.entries(spec)) {
      if (typeof value === 'number') {
        result.set(name, [value]);
      } else {
        result.set(name, value);
      }
    }
    
    // Add unspecified non-spatial dimensions
    for (const dim of this.dimensions) {
      if (!result.has(dim.name)) {
        result.set(dim.name, Array.from({length: dim.size}, (_, i) => i));
      }
    }
    
    return result;
  }

  getSubVolume(indices: Record<string, number | number[]>): NeuroVol | NeuroVec {
    const parsedIndices = this.parseIndices(indices);
    
    // Determine output dimensions
    const spatialSizes = {
      x: parsedIndices.get('x')!.length,
      y: parsedIndices.get('y')!.length,
      z: parsedIndices.get('z')!.length
    };
    
    const isFullSpatial = spatialSizes.x === this.spatialDim[0] &&
                         spatialSizes.y === this.spatialDim[1] &&
                         spatialSizes.z === this.spatialDim[2];
    
    // Check if we're extracting a single volume
    const nonSpatialSingleton = this.dimensions.every(dim => 
      parsedIndices.get(dim.name)!.length === 1
    );
    
    if (isFullSpatial && nonSpatialSingleton) {
      // Extract a single 3D volume
      const volData = new Float32Array(this.spatialDim[0] * this.spatialDim[1] * this.spatialDim[2]);
      let volIdx = 0;
      
      const baseIndices = new Array(this.ndim);
      // Set non-spatial indices
      for (const dim of this.dimensions) {
        const dimIdx = this.dimMap.get(dim.name)!;
        baseIndices[dimIdx] = parsedIndices.get(dim.name)![0];
      }
      
      // Copy spatial data
      for (let z = 0; z < this.spatialDim[2]; z++) {
        baseIndices[2] = z;
        for (let y = 0; y < this.spatialDim[1]; y++) {
          baseIndices[1] = y;
          for (let x = 0; x < this.spatialDim[0]; x++) {
            baseIndices[0] = x;
            volData[volIdx++] = this.data[this.indicesToLinear(baseIndices)];
          }
        }
      }
      
      return new FloatNeuroVol(this.space.withDimensions(this.spatialDim), volData);
    }
    
    // Extract 4D data (NeuroVec)
    const timePoints: NeuroVol[] = [];
    
    // Find the time dimension (first non-singleton non-spatial dimension)
    let timeDim: DimensionInfo | null = null;
    let timeIndices: number[] = [];
    
    for (const dim of this.dimensions) {
      const dimIndices = parsedIndices.get(dim.name)!;
      if (dimIndices.length > 1) {
        timeDim = dim;
        timeIndices = dimIndices;
        break;
      }
    }
    
    if (!timeDim) {
      throw new Error('No time dimension found for NeuroVec extraction');
    }
    
    // Create a 4D space for NeuroVec
    const space4D = this.space.withDimensions([...this.spatialDim, timeIndices.length]);
    
    // Create data array for NeuroVec
    const volumeSize = this.spatialDim[0] * this.spatialDim[1] * this.spatialDim[2];
    const vecData = new Float32Array(volumeSize * timeIndices.length);
    
    // Extract each time point
    for (let i = 0; i < timeIndices.length; i++) {
      const t = timeIndices[i];
      const volIndices = { ...indices };
      volIndices[timeDim.name] = t;
      const vol = this.getSubVolume(volIndices) as FloatNeuroVol;
      
      // Copy volume data into the vec data array
      const volData = vol.getData();
      const offset = i * volumeSize;
      for (let j = 0; j < volumeSize; j++) {
        vecData[offset + j] = volData[j];
      }
    }
    
    return new Float32NeuroVec(space4D, vecData);
  }

  getVoxelSeries(x: number, y: number, z: number, dims?: string[]): number[] {
    const targetDims = dims || this.dimensions.map(d => d.name);
    const series: number[] = [];
    
    // Build base indices
    const baseIndices = new Array(this.ndim).fill(0);
    baseIndices[0] = x;
    baseIndices[1] = y;
    baseIndices[2] = z;
    
    // Recursively extract values
    const extractRecursive = (dimIndex: number, currentIndices: number[]) => {
      if (dimIndex >= targetDims.length) {
        series.push(this.data[this.indicesToLinear(currentIndices)]);
        return;
      }
      
      const dimName = targetDims[dimIndex];
      const dim = this.dimensions.find(d => d.name === dimName);
      if (!dim) return;
      
      const dimIdx = this.dimMap.get(dimName)!;
      
      for (let i = 0; i < dim.size; i++) {
        currentIndices[dimIdx] = i;
        extractRecursive(dimIndex + 1, [...currentIndices]);
      }
    };
    
    extractRecursive(0, baseIndices);
    return series;
  }

  setSubVolume(indices: Record<string, number | number[]>, data: NeuroVol | NeuroVec): void {
    const parsedIndices = this.parseIndices(indices);
    
    if (data instanceof FloatNeuroVol) {
      // Setting a single volume
      const volData = data.getData();
      let volIdx = 0;
      
      const baseIndices = new Array(this.ndim);
      // Set non-spatial indices
      for (const dim of this.dimensions) {
        const dimIdx = this.dimMap.get(dim.name)!;
        const dimIndices = parsedIndices.get(dim.name)!;
        if (dimIndices.length !== 1) {
          throw new Error('Must specify single index for non-spatial dimensions when setting volume');
        }
        baseIndices[dimIdx] = dimIndices[0];
      }
      
      // Copy spatial data
      for (let z = 0; z < this.spatialDim[2]; z++) {
        baseIndices[2] = z;
        for (let y = 0; y < this.spatialDim[1]; y++) {
          baseIndices[1] = y;
          for (let x = 0; x < this.spatialDim[0]; x++) {
            baseIndices[0] = x;
            this.data[this.indicesToLinear(baseIndices)] = volData[volIdx++];
          }
        }
      }
    } else if (data instanceof DenseNeuroVec) {
      // Setting a NeuroVec
      const vecData = data as Float32NeuroVec;
      const numTimePoints = vecData.dim[3];
      
      // Find which dimension corresponds to time
      let timeDim: string | null = null;
      for (const [dimName, dimIndices] of parsedIndices.entries()) {
        if (dimIndices.length === numTimePoints && this.dimensions.find(d => d.name === dimName)) {
          timeDim = dimName;
          break;
        }
      }
      
      if (!timeDim) {
        throw new Error('Cannot determine time dimension for NeuroVec data');
      }
      
      // Set each time point
      const timeIndices = parsedIndices.get(timeDim)!;
      for (let t = 0; t < numTimePoints; t++) {
        const vol = vecData.getVolume(t);
        const volIndices = { ...indices };
        volIndices[timeDim] = timeIndices[t];
        this.setSubVolume(volIndices, vol);
      }
    } else {
      throw new Error('Unsupported data type for setSubVolume');
    }
  }

  reduce(dims: string[], options: ReductionOptions): INeuroHyperVec {
    const op = options.operation;
    const keepDims = options.keepDims || false;
    
    // Calculate new dimensions
    const newDimensions: DimensionInfo[] = [];
    const reduceDimIndices: number[] = [];
    
    for (const dim of this.dimensions) {
      if (dims.includes(dim.name)) {
        reduceDimIndices.push(this.dimMap.get(dim.name)!);
        if (keepDims) {
          newDimensions.push({ ...dim, size: 1 });
        }
      } else {
        newDimensions.push(dim);
      }
    }
    
    // Create result
    const result = new DenseNeuroHyperVec(this.space, newDimensions);
    
    // Perform reduction
    const resultShape = result.shape;
    const resultIndices = new Array(result.ndim).fill(0);
    
    const performReduction = (pos: number): void => {
      if (pos >= result.size) return;
      
      // Convert linear position to indices
      let temp = pos;
      for (let i = result.ndim - 1; i >= 0; i--) {
        resultIndices[i] = temp % resultShape[i];
        temp = Math.floor(temp / resultShape[i]);
      }
      
      // Collect values to reduce
      const values: number[] = [];
      const sourceIndices = new Array(this.ndim).fill(0);
      
      // Map result indices to source
      let resultDimIdx = 0;
      for (let i = 0; i < this.ndim; i++) {
        if (i < 3) {
          // Spatial dimensions
          sourceIndices[i] = resultIndices[i];
        } else if (!reduceDimIndices.includes(i)) {
          // Non-reduced dimension
          sourceIndices[i] = resultIndices[resultDimIdx + 3];
          resultDimIdx++;
        }
      }
      
      // Collect values along reduced dimensions
      const collectValues = (dimIdx: number) => {
        if (dimIdx >= reduceDimIndices.length) {
          values.push(this.data[this.indicesToLinear(sourceIndices)]);
          return;
        }
        
        const dim = reduceDimIndices[dimIdx];
        const dimSize = this.shape[dim];
        
        for (let i = 0; i < dimSize; i++) {
          sourceIndices[dim] = i;
          collectValues(dimIdx + 1);
        }
      };
      
      collectValues(0);
      
      // Apply reduction operation
      let resultValue = 0;
      switch (op) {
        case 'mean':
          resultValue = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'sum':
          resultValue = values.reduce((a, b) => a + b, 0);
          break;
        case 'min':
          resultValue = Math.min(...values);
          break;
        case 'max':
          resultValue = Math.max(...values);
          break;
        case 'std':
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
          resultValue = Math.sqrt(variance);
          break;
        case 'var':
          const m = values.reduce((a, b) => a + b, 0) / values.length;
          resultValue = values.reduce((a, b) => a + Math.pow(b - m, 2), 0) / values.length;
          break;
        case 'median':
          values.sort((a, b) => a - b);
          const mid = Math.floor(values.length / 2);
          resultValue = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
          break;
      }
      
      result.data[pos] = resultValue;
      performReduction(pos + 1);
    };
    
    performReduction(0);
    return result;
  }

  mapAlong(dims: string[], fn: (data: NeuroVol) => NeuroVol): INeuroHyperVec {
    const result = this.clone();
    
    // Get dimensions to iterate over
    const iterDims = this.dimensions.filter(d => dims.includes(d.name));
    const iterIndices: Record<string, number> = {};
    
    const iterate = (dimIdx: number) => {
      if (dimIdx >= iterDims.length) {
        // Extract, apply function, and set back
        const vol = this.getSubVolume(iterIndices) as NeuroVol;
        const transformed = fn(vol);
        result.setSubVolume(iterIndices, transformed);
        return;
      }
      
      const dim = iterDims[dimIdx];
      for (let i = 0; i < dim.size; i++) {
        iterIndices[dim.name] = i;
        iterate(dimIdx + 1);
      }
    };
    
    iterate(0);
    return result;
  }

  concat(other: INeuroHyperVec, dim: string): INeuroHyperVec {
    // Validate compatibility
    if (!this.space.isEqualTo(other.space)) {
      throw new Error('Spatial dimensions must match for concatenation');
    }
    
    const thisDimIdx = this.dimensions.findIndex(d => d.name === dim);
    const otherDimIdx = other.dimensions.findIndex(d => d.name === dim);
    
    if (thisDimIdx === -1 || otherDimIdx === -1) {
      throw new Error(`Dimension ${dim} not found`);
    }
    
    // Check other dimensions match
    for (let i = 0; i < this.dimensions.length; i++) {
      if (i !== thisDimIdx) {
        const thisDim = this.dimensions[i];
        const otherDim = other.dimensions.find(d => d.name === thisDim.name);
        if (!otherDim || otherDim.size !== thisDim.size) {
          throw new Error(`Dimension ${thisDim.name} sizes must match`);
        }
      }
    }
    
    // Create new dimensions
    const newDimensions = this.dimensions.map((d, i) => {
      if (i === thisDimIdx) {
        const otherSize = other.dimensions[otherDimIdx].size;
        return {
          ...d,
          size: d.size + otherSize,
          labels: d.labels && other.dimensions[otherDimIdx].labels
            ? [...d.labels, ...other.dimensions[otherDimIdx].labels]
            : undefined
        };
      }
      return { ...d };
    });
    
    // Create result and copy data
    const result = new DenseNeuroHyperVec(this.space, newDimensions);
    
    // Copy this data directly
    const thisSize = this.dimensions[thisDimIdx].size;
    const otherSize = other.dimensions[otherDimIdx].size;
    
    // Copy data element by element
    const shape = this.shape;
    const resultShape = result.shape;
    const indices = new Array(this.ndim).fill(0);
    const resultIndices = new Array(result.ndim).fill(0);
    
    // Helper to copy all data
    const copyData = (source: DenseNeuroHyperVec, targetOffset: number) => {
      const copyRecursive = (dimIdx: number) => {
        if (dimIdx >= source.ndim) {
          // Copy single value
          const value = source.data[source.indicesToLinear(indices)];
          resultIndices[thisDimIdx + 3] = indices[thisDimIdx + 3] + targetOffset;
          result.data[result.indicesToLinear(resultIndices)] = value;
          return;
        }
        
        const size = dimIdx === thisDimIdx + 3 ? 
          (source === this ? thisSize : otherSize) : 
          shape[dimIdx];
          
        for (let i = 0; i < size; i++) {
          indices[dimIdx] = i;
          resultIndices[dimIdx] = i;
          copyRecursive(dimIdx + 1);
        }
      };
      
      copyRecursive(0);
    };
    
    // Copy data from this
    copyData(this, 0);
    
    // Copy data from other
    copyData(other as DenseNeuroHyperVec, thisSize);
    
    return result;
  }

  split(dim: string, indices: number[]): INeuroHyperVec[] {
    const dimIdx = this.dimensions.findIndex(d => d.name === dim);
    if (dimIdx === -1) {
      throw new Error(`Dimension ${dim} not found`);
    }
    
    const dimInfo = this.dimensions[dimIdx];
    const splits: INeuroHyperVec[] = [];
    
    // Add 0 and size to indices if not present
    const splitPoints = [0, ...indices, dimInfo.size].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    
    for (let i = 0; i < splitPoints.length - 1; i++) {
      const start = splitPoints[i];
      const end = splitPoints[i + 1];
      const size = end - start;
      
      if (size === 0) continue;
      
      // Create new dimension info
      const newDimensions = this.dimensions.map((d, idx) => {
        if (idx === dimIdx) {
          return {
            ...d,
            size: size,
            labels: d.labels ? d.labels.slice(start, end) : undefined
          };
        }
        return { ...d };
      });
      
      // Create split and copy data
      const split = new DenseNeuroHyperVec(this.space, newDimensions);
      
      // Copy data directly
      const indices = new Array(this.ndim).fill(0);
      const splitIndices = new Array(split.ndim).fill(0);
      
      const copyRecursive = (dimPosition: number) => {
        if (dimPosition >= this.ndim) {
          // Copy single value
          const value = this.data[this.indicesToLinear(indices)];
          split.data[split.indicesToLinear(splitIndices)] = value;
          return;
        }
        
        const dimSize = dimPosition === dimIdx + 3 ? size : this.shape[dimPosition];
        
        for (let j = 0; j < dimSize; j++) {
          if (dimPosition === dimIdx + 3) {
            indices[dimPosition] = j + start;
            splitIndices[dimPosition] = j;
          } else {
            indices[dimPosition] = j;
            splitIndices[dimPosition] = j;
          }
          copyRecursive(dimPosition + 1);
        }
      };
      
      copyRecursive(0);
      splits.push(split);
    }
    
    return splits;
  }

  permute(order: string[]): INeuroHyperVec {
    // Validate order
    const expectedNames = ['x', 'y', 'z', ...this.dimensions.map(d => d.name)];
    if (order.length !== expectedNames.length || !order.every(n => expectedNames.includes(n))) {
      throw new Error('Invalid dimension order');
    }
    
    // For now, only support permuting non-spatial dimensions
    if (order[0] !== 'x' || order[1] !== 'y' || order[2] !== 'z') {
      throw new Error('Spatial dimensions must remain first');
    }
    
    // Reorder non-spatial dimensions
    const newDimOrder = order.slice(3);
    const newDimensions = newDimOrder.map(name => 
      this.dimensions.find(d => d.name === name)!
    );
    
    // Create permuted hypervec
    const result = new DenseNeuroHyperVec(this.space, newDimensions);
    
    // Copy data with permutation
    // This is a complex operation - for now, use simple but inefficient approach
    const allIndices = this.getAllIndices();
    for (const indexSet of allIndices) {
      const value = this.getValueAt(indexSet);
      const permutedIndices = this.permuteIndices(indexSet, order);
      result.setValueAt(permutedIndices, value);
    }
    
    return result;
  }

  extractFeatures(options: FeatureExtractionOptions): {
    components: INeuroHyperVec;
    loadings: number[][];
    explainedVariance?: number[];
  } {
    // This would require a full PCA/ICA implementation
    // For now, throw not implemented
    throw new Error('Feature extraction not yet implemented');
  }

  correlateAlong(dim1: string, dim2: string): number[][] {
    const dim1Info = this.dimensions.find(d => d.name === dim1);
    const dim2Info = this.dimensions.find(d => d.name === dim2);
    
    if (!dim1Info || !dim2Info) {
      throw new Error('Dimensions not found');
    }
    
    const size1 = dim1Info.size;
    const size2 = dim2Info.size;
    const result: number[][] = Array(size1).fill(null).map(() => Array(size2).fill(0));
    
    // For each voxel, compute correlation between dim1 and dim2
    const numVoxels = this.spatialDim[0] * this.spatialDim[1] * this.spatialDim[2];
    
    for (let v = 0; v < numVoxels; v++) {
      const z = Math.floor(v / (this.spatialDim[0] * this.spatialDim[1]));
      const y = Math.floor((v % (this.spatialDim[0] * this.spatialDim[1])) / this.spatialDim[0]);
      const x = v % this.spatialDim[0];
      
      // Get series for each dimension value
      const series1: number[][] = [];
      const series2: number[][] = [];
      
      for (let i = 0; i < size1; i++) {
        const s = this.getVoxelSeries(x, y, z, [dim1]);
        series1.push(s);
      }
      
      for (let j = 0; j < size2; j++) {
        const s = this.getVoxelSeries(x, y, z, [dim2]);
        series2.push(s);
      }
      
      // Compute correlations
      for (let i = 0; i < size1; i++) {
        for (let j = 0; j < size2; j++) {
          result[i][j] += this.correlation(series1[i], series2[j]);
        }
      }
    }
    
    // Average over voxels
    for (let i = 0; i < size1; i++) {
      for (let j = 0; j < size2; j++) {
        result[i][j] /= numVoxels;
      }
    }
    
    return result;
  }

  glm(designMatrix: number[][], contrastMatrix: number[][]): {
    beta: INeuroHyperVec;
    tstat: NeuroVol;
    pval: NeuroVol;
  } {
    // This would require a full GLM implementation
    throw new Error('GLM not yet implemented');
  }

  toArray(): Float32Array {
    return new Float32Array(this.data);
  }

  async save(filename: string, format?: string): Promise<void> {
    // Would need to implement HDF5 or custom format writing
    throw new Error('Save not yet implemented');
  }

  view(spec: Record<string, number | number[] | 'all'>): INeuroHyperVec {
    const parsedSpec: Record<string, number | number[]> = {};
    
    for (const [key, value] of Object.entries(spec)) {
      if (value === 'all') {
        if (key === 'x') parsedSpec[key] = Array.from({length: this.spatialDim[0]}, (_, i) => i);
        else if (key === 'y') parsedSpec[key] = Array.from({length: this.spatialDim[1]}, (_, i) => i);
        else if (key === 'z') parsedSpec[key] = Array.from({length: this.spatialDim[2]}, (_, i) => i);
        else {
          const dim = this.dimensions.find(d => d.name === key);
          if (dim) {
            parsedSpec[key] = Array.from({length: dim.size}, (_, i) => i);
          }
        }
      } else {
        parsedSpec[key] = value;
      }
    }
    
    // For now, create a copy with the subset
    // In a production implementation, this would be a lazy view
    const subData = this.getSubVolume(parsedSpec);
    
    // Determine new dimensions
    const newDimensions: DimensionInfo[] = [];
    for (const dim of this.dimensions) {
      const indices = parsedSpec[dim.name];
      if (Array.isArray(indices) && indices.length > 1) {
        newDimensions.push({
          ...dim,
          size: indices.length,
          labels: dim.labels ? indices.map(i => dim.labels![i]) : undefined
        });
      }
    }
    
    throw new Error('View creation not fully implemented');
  }

  clone(): INeuroHyperVec {
    return new DenseNeuroHyperVec(
      this.space,
      this.dimensions.map(d => ({ ...d })),
      new Float32Array(this.data)
    );
  }

  dispose(): void {
    // Clean up resources
    this.data = new Float32Array(0);
  }

  // Helper methods

  private getAllIndices(): number[][] {
    const indices: number[][] = [];
    const shape = this.shape;
    
    const generate = (pos: number, current: number[]) => {
      if (pos >= shape.length) {
        indices.push([...current]);
        return;
      }
      
      for (let i = 0; i < shape[pos]; i++) {
        current[pos] = i;
        generate(pos + 1, current);
      }
    };
    
    generate(0, new Array(shape.length).fill(0));
    return indices;
  }

  private getValueAt(indices: number[]): number {
    return this.data[this.indicesToLinear(indices)];
  }

  private setValueAt(indices: number[], value: number): void {
    this.data[this.indicesToLinear(indices)] = value;
  }

  private permuteIndices(indices: number[], order: string[]): number[] {
    const result = new Array(indices.length);
    
    for (let i = 0; i < order.length; i++) {
      const srcIdx = this.dimMap.get(order[i])!;
      result[i] = indices[srcIdx];
    }
    
    return result;
  }

  private correlation(x: number[], y: number[]): number {
    const n = x.length;
    const mx = x.reduce((a, b) => a + b, 0) / n;
    const my = y.reduce((a, b) => a + b, 0) / n;
    
    let num = 0;
    let dx = 0;
    let dy = 0;
    
    for (let i = 0; i < n; i++) {
      const dxi = x[i] - mx;
      const dyi = y[i] - my;
      num += dxi * dyi;
      dx += dxi * dxi;
      dy += dyi * dyi;
    }
    
    return num / Math.sqrt(dx * dy);
  }
}

/**
 * Factory function for creating NeuroHyperVec
 */
export function createNeuroHyperVec(
  space: NeuroSpace,
  dimensions: DimensionInfo[],
  options?: NeuroHyperVecOptions
): INeuroHyperVec {
  if (options?.sparse) {
    throw new Error('Sparse NeuroHyperVec not yet implemented');
  }
  
  if (options?.lazy) {
    throw new Error('Lazy NeuroHyperVec not yet implemented');
  }
  
  return new DenseNeuroHyperVec(space, dimensions);
}
