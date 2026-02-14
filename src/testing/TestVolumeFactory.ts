/**
 * TestVolumeFactory - Creates test volumes with consistent characteristics
 * for reliable multi-volume testing
 */

import { NeuroVol } from '../volume/NeuroVol';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D } from '../geometry/Axis';
import { Matrix } from 'ml-matrix';

export interface TestVolumeOptions {
  /** Base dimensions - will be adjusted for each volume in stack */
  baseDimensions?: [number, number, number];
  /** Base spacing - will be adjusted for each volume in stack */
  baseSpacing?: [number, number, number];
  /** Origin for all volumes */
  origin?: [number, number, number];
  /** Number of volumes to create */
  volumeCount?: number;
  /** Scale factor between volumes (e.g., 0.5 for halving resolution) */
  scaleFactor?: number;
  /** Whether to add noise to the data */
  addNoise?: boolean;
  /** Seed for reproducible random data */
  seed?: number;
  /** Pattern to fill volumes with */
  fillPattern?: 'gradient' | 'checkerboard' | 'sphere' | 'random';
}

export class TestVolumeFactory {
  private static seedValue: number = 12345;
  
  /**
   * Creates a stack of test volumes with consistent alignment characteristics
   */
  static createAlignedStack(options: TestVolumeOptions = {}): NeuroVol[] {
    const {
      baseDimensions = [64, 64, 30],
      baseSpacing = [1, 1, 1],
      origin = [0, 0, 0],
      volumeCount = 3,
      scaleFactor = 0.5,
      addNoise = false,
      seed = this.seedValue,
      fillPattern = 'gradient'
    } = options;
    
    this.seedValue = seed;
    const volumes: NeuroVol[] = [];
    
    for (let i = 0; i < volumeCount; i++) {
      const scale = Math.pow(scaleFactor, i);
      
      // Adjust dimensions - ensure they're integers
      const dims: [number, number, number] = [
        Math.max(4, Math.round(baseDimensions[0] * scale)),
        Math.max(4, Math.round(baseDimensions[1] * scale)),
        Math.max(4, Math.round(baseDimensions[2] * scale))
      ];
      
      // Adjust spacing to maintain physical size
      const spacing: [number, number, number] = [
        baseSpacing[0] / scale,
        baseSpacing[1] / scale,
        baseSpacing[2] / scale
      ];
      
      const volume = this.createSingleVolume({
        dimensions: dims,
        spacing,
        origin,
        fillPattern,
        addNoise,
        volumeIndex: i
      });
      
      volumes.push(volume);
    }
    
    return volumes;
  }
  
  /**
   * Creates test volumes with specific orientations
   */
  static createOrientedVolumes(orientations: AxisSet3D[]): NeuroVol[] {
    const volumes: NeuroVol[] = [];
    
    for (const orientation of orientations) {
      const volume = this.createSingleVolume({
        dimensions: [64, 64, 30],
        spacing: [1, 1, 1],
        origin: [0, 0, 0],
        orientation,
        fillPattern: 'gradient'
      });
      
      volumes.push(volume);
    }
    
    return volumes;
  }
  
  /**
   * Create a single test volume
   */
  static createSingleVolume(options: {
    dimensions: [number, number, number];
    spacing?: [number, number, number];
    origin?: [number, number, number];
    orientation?: AxisSet3D;
    fillPattern?: 'gradient' | 'checkerboard' | 'sphere' | 'random';
    addNoise?: boolean;
    volumeIndex?: number;
  }): NeuroVol {
    const {
      dimensions,
      spacing = [1, 1, 1],
      origin = [0, 0, 0],
      orientation = AxisSet3D.AXIAL_LPI,
      fillPattern = 'gradient',
      addNoise = false,
      volumeIndex = 0
    } = options;
    
    // Create NeuroSpace
    const space = new NeuroSpace(dimensions, spacing, origin, orientation);
    
    // Create data array
    const totalSize = dimensions[0] * dimensions[1] * dimensions[2];
    const data = new Float32Array(totalSize);
    
    // Fill with pattern
    this.fillWithPattern(data, dimensions, fillPattern, volumeIndex);
    
    // Add noise if requested
    if (addNoise) {
      this.addNoiseToData(data, 0.1);
    }
    
    // Create volume
    return new FloatNeuroVol(space, data);
  }
  
  /**
   * Get safe test indices for a given axis and volume stack
   */
  static getSafeTestIndices(
    volumes: NeuroVol[],
    axis: AxisSet3D,
    count: number = 3
  ): number[] {
    if (volumes.length === 0) return [];
    
    // Find minimum dimension across all volumes
    let minDim = Infinity;
    const axisIndex = this.getAxisIndex(axis);
    
    for (const volume of volumes) {
      const dim = volume.space.dim[axisIndex];
      minDim = Math.min(minDim, dim);
    }
    
    // Generate evenly spaced indices
    const indices: number[] = [];
    const step = Math.max(1, Math.floor(minDim / (count + 1)));
    
    for (let i = 0; i < count; i++) {
      const index = Math.min(step * (i + 1), minDim - 1);
      indices.push(index);
    }
    
    return indices;
  }
  
  /**
   * Fill data array with a pattern
   */
  private static fillWithPattern(
    data: Float32Array,
    dimensions: [number, number, number],
    pattern: string,
    volumeIndex: number
  ): void {
    const [dx, dy, dz] = dimensions;
    
    for (let z = 0; z < dz; z++) {
      for (let y = 0; y < dy; y++) {
        for (let x = 0; x < dx; x++) {
          const index = x + y * dx + z * dx * dy;
          
          switch (pattern) {
            case 'gradient':
              // Linear gradient with volume-specific offset
              data[index] = ((x / dx + y / dy + z / dz) / 3 + volumeIndex * 0.2) % 1;
              break;
              
            case 'checkerboard':
              // 3D checkerboard pattern
              const checker = ((Math.floor(x / 8) + Math.floor(y / 8) + Math.floor(z / 4)) % 2);
              data[index] = checker * (0.7 + volumeIndex * 0.1);
              break;
              
            case 'sphere':
              // Sphere in center with different radii
              const cx = dx / 2, cy = dy / 2, cz = dz / 2;
              const dist = Math.sqrt(
                Math.pow(x - cx, 2) + 
                Math.pow(y - cy, 2) + 
                Math.pow(z - cz, 2)
              );
              const radius = Math.min(dx, dy, dz) / 3 * (1 - volumeIndex * 0.1);
              data[index] = dist < radius ? 1 : 0;
              break;
              
            case 'random':
              data[index] = this.seededRandom();
              break;
              
            default:
              data[index] = 0.5;
          }
        }
      }
    }
  }
  
  /**
   * Add noise to data
   */
  private static addNoiseToData(data: Float32Array, noiseLevel: number): void {
    for (let i = 0; i < data.length; i++) {
      data[i] += (this.seededRandom() - 0.5) * noiseLevel;
      data[i] = Math.max(0, Math.min(1, data[i])); // Clamp to [0, 1]
    }
  }
  
  /**
   * Seeded random number generator for reproducible tests
   */
  private static seededRandom(): number {
    this.seedValue = (this.seedValue * 9301 + 49297) % 233280;
    return this.seedValue / 233280;
  }
  
  /**
   * Get axis index for slicing
   */
  private static getAxisIndex(axis: AxisSet3D): number {
    const axisStr = axis.toString();
    
    if (axisStr.includes('XYZ') || axisStr.includes('AXIAL')) {
      return 2; // Z axis
    } else if (axisStr.includes('YZX') || axisStr.includes('SAGITTAL')) {
      return 0; // X axis
    } else if (axisStr.includes('XZY') || axisStr.includes('CORONAL')) {
      return 1; // Y axis
    }
    
    return 2; // Default to Z
  }
  
  /**
   * Create volumes with compatible spaces for testing alignment
   */
  static createCompatibleVolumes(count: number = 3): NeuroVol[] {
    const volumes: NeuroVol[] = [];
    const baseSpace = new NeuroSpace([64, 64, 30], [1, 1, 1], [0, 0, 0]);
    
    for (let i = 0; i < count; i++) {
      const data = new Float32Array(64 * 64 * 30);
      this.fillWithPattern(data, [64, 64, 30], 'gradient', i);
      volumes.push(new FloatNeuroVol(baseSpace, data));
    }
    
    return volumes;
  }
}