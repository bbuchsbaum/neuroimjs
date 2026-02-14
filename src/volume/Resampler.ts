import { NeuroVol } from './NeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D } from '../geometry/Axis';
import { TypedArray } from '../types';
import { Matrix, inverse } from 'ml-matrix';
import {
  FloatNeuroVol,
  Int16NeuroVol,
  UInt8NeuroVol,
  Float64NeuroVol,
  Int32NeuroVol,
  Int8NeuroVol,
  UInt16NeuroVol
} from './DenseNeuroVol';
import { computeVoxelMapping } from './VoxelIterator';

/**
 * Utility class for resampling and reorienting NeuroVol volumes.
 */
export class Resampler {
  /**
   * Resamples a source NeuroVol to a target NeuroSpace.
   * @param sourceVol - The source NeuroVol to resample.
   * @param targetSpace - The target NeuroSpace to resample to.
   * @param interpolation - The interpolation method ('nearest' or 'trilinear'). Defaults to 'trilinear'.
   * @returns A new resampled NeuroVol matching the target space.
   */
  public static resample(
    sourceVol: NeuroVol,
    targetSpace: NeuroSpace,
    interpolation: 'nearest' | 'trilinear' = 'trilinear'
  ): NeuroVol {
    const [nx, ny, nz] = targetSpace.dim.slice(0, 3);

    // Determine the data type and create a new data array
    const dataConstructor = sourceVol.getDataConstructor();
    const totalVoxels = nx * ny * nz;
    const data = new dataConstructor(totalVoxels);

    // Precompute the inverse transformation matrix from target to source space
    const sourceToTargetTransform = inverse(sourceVol.space.getTransformationMatrixTo(targetSpace));

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          // Compute the grid coordinate in the target space
          const gridCoordTarget = [i, j, k, 1]; // Homogeneous coordinates

          // Transform target grid coordinate to source grid coordinate
          const gridCoordSourceHomogeneous = sourceToTargetTransform
            .mmul(Matrix.columnVector(gridCoordTarget))
            .getColumn(0);

          const sourceGridCoord = gridCoordSourceHomogeneous.slice(0, 3);

          let value = 0;

          if (interpolation === 'nearest') {
            const xi = Math.round(sourceGridCoord[0]);
            const yj = Math.round(sourceGridCoord[1]);
            const zk = Math.round(sourceGridCoord[2]);

            if (
              xi >= 0 && xi < sourceVol.dim[0] &&
              yj >= 0 && yj < sourceVol.dim[1] &&
              zk >= 0 && zk < sourceVol.dim[2]
            ) {
              value = sourceVol.getAt(xi, yj, zk);
            } else {
              value = 0;
            }
          } else if (interpolation === 'trilinear') {
            const xi = Math.floor(sourceGridCoord[0]);
            const yj = Math.floor(sourceGridCoord[1]);
            const zk = Math.floor(sourceGridCoord[2]);
            const xd = sourceGridCoord[0] - xi;
            const yd = sourceGridCoord[1] - yj;
            const zd = sourceGridCoord[2] - zk;

            if (
              xi >= 0 && xi + 1 < sourceVol.dim[0] &&
              yj >= 0 && yj + 1 < sourceVol.dim[1] &&
              zk >= 0 && zk + 1 < sourceVol.dim[2]
            ) {
              const v000 = sourceVol.getAt(xi, yj, zk);
              const v001 = sourceVol.getAt(xi, yj, zk + 1);
              const v010 = sourceVol.getAt(xi, yj + 1, zk);
              const v011 = sourceVol.getAt(xi, yj + 1, zk + 1);
              const v100 = sourceVol.getAt(xi + 1, yj, zk);
              const v101 = sourceVol.getAt(xi + 1, yj, zk + 1);
              const v110 = sourceVol.getAt(xi + 1, yj + 1, zk);
              const v111 = sourceVol.getAt(xi + 1, yj + 1, zk + 1);

              const c00 = v000 * (1 - xd) + v100 * xd;
              const c01 = v001 * (1 - xd) + v101 * xd;
              const c10 = v010 * (1 - xd) + v110 * xd;
              const c11 = v011 * (1 - xd) + v111 * xd;
              const c0 = c00 * (1 - yd) + c10 * yd;
              const c1 = c01 * (1 - yd) + c11 * yd;
              value = c0 * (1 - zd) + c1 * zd;
            } else {
              value = 0;
            }
          } else {
            throw new Error(`Unknown interpolation method: ${interpolation}`);
          }

          // Store the value in the data array
          const index = i + j * nx + k * nx * ny;
          data[index] = value;
        }
      }
    }

    // Create a new NeuroVol with the data and target space
    const resampledVol = Resampler.createNeuroVol(data, targetSpace);

    return resampledVol;
  }

  /**
   * Reorients a source NeuroVol to align with targetAxes by permuting axes.
   * @param sourceVol - The source NeuroVol to reorient.
   * @param targetAxes - The target AxisSet3D to align with.
   * @returns A new NeuroVol with axes aligned to targetAxes.
   */
  public static reorient(sourceVol: NeuroVol, targetAxes: AxisSet3D): NeuroVol {
    const sourceSpace = sourceVol.space;
    const currentAxes = sourceSpace.axes;

    // If already oriented correctly, return original volume
    if (currentAxes.equals(targetAxes)) {
      return sourceVol;
    }

    // Create target space reoriented to the desired axes
    const targetSpace = sourceSpace.reorient(targetAxes);

    const [nx, ny, nz] = targetSpace.dim;
    const total = nx * ny * nz;
    const DataConstructor = sourceVol.getDataConstructor();
    const data = new DataConstructor(total);

    const mapping = computeVoxelMapping(targetSpace, sourceSpace);

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const { sourceDimIndex, flipSource, sizeSource } = mapping;

          const coord = [i, j, k];
          const mapped = [0, 0, 0];

          for (let axis = 0; axis < 3; axis++) {
            const srcDim = sourceDimIndex[axis];
            const size = sizeSource[srcDim];
            const val = coord[axis];
            mapped[srcDim] = flipSource[axis] ? (size - 1 - val) : val;
          }

          const value = sourceVol.getAt(mapped[0], mapped[1], mapped[2]);
          const index = i + j * nx + k * nx * ny;
          data[index] = value;
        }
      }
    }

    return Resampler.createNeuroVol(data, targetSpace);
  }

  /**
   * Helper function to create a NeuroVol given the data and space.
   * @param data - The data array.
   * @param space - The NeuroSpace defining the space.
   * @returns A NeuroVol instance of appropriate type.
   */
  private static createNeuroVol(data: TypedArray, space: NeuroSpace): NeuroVol {
    if (data instanceof Float32Array) {
      return new FloatNeuroVol(space, data as Float32Array);
    } else if (data instanceof Int16Array) {
      return new Int16NeuroVol(space, data as Int16Array);
    } else if (data instanceof Uint8Array) {
      return new UInt8NeuroVol(space, data as Uint8Array);
    } else if (data instanceof Float64Array) {
      return new Float64NeuroVol(space, data as Float64Array);
    } else if (data instanceof Int32Array) {
      return new Int32NeuroVol(space, data as Int32Array);
    } else if (data instanceof Int8Array) {
      return new Int8NeuroVol(space, data as Int8Array);
    } else if (data instanceof Uint16Array) {
      return new UInt16NeuroVol(space, data as Uint16Array);
    } else {
      throw new Error('Unsupported data type for NeuroVol creation.');
    }
  }
}
