import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { NeuroSpace } from '../geometry/NeuroSpace';

export type ScatterKernelParameters = Readonly<Record<string, number>>;
export type ScatterKernel = (distSq: number, params: ScatterKernelParameters) => number;

export interface ScatterPoint {
  x: number;
  y: number;
  z: number;
  weight?: number;
}

export interface ScatterFieldOptions {
  space: NeuroSpace;
  points: ScatterPoint[];
  kernel?: ScatterKernel;
  kernelParams?: ScatterKernelParameters;
  cutoffMm?: number;                 // radial cutoff in mm
  combine?: 'max' | 'sum';
  reuseBuffer?: Float32Array | null; // optional target buffer to reuse/zero
  /** Maximum worker execution time for buildScatterFieldAsync. Default: 120 seconds. */
  workerTimeoutMs?: number;
}

export interface ScatterFieldResult {
  volume: FloatNeuroVol;
  data: Float32Array;
  maxValue: number;
  nonZeroCount: number;
}

export interface ScatterFieldSpaceMetadata {
  dim: number[];
  spacing: number[];
  origin: number[];
  axisNames: [string, string, string];
  affine: number[][];
}

export interface ScatterFieldWorkerRequest {
  spaceMeta: ScatterFieldSpaceMetadata;
  points: ScatterPoint[];
  kernelParams: ScatterKernelParameters;
  cutoffMm?: number;
  combine?: 'max' | 'sum';
}

export interface ScatterFieldMessage {
  volumeMeta: ScatterFieldSpaceMetadata;
  data: Float32Array;
  maxValue: number;
  nonZeroCount: number;
}

function kernelSigma(params: ScatterKernelParameters): number {
  return typeof params.sigma === 'number' ? params.sigma : 1;
}

const defaultKernel: ScatterKernel = (distSq, params) => {
  const sigma = kernelSigma(params);
  const sigmaSq = sigma * sigma;
  return Math.exp(-distSq / (2 * sigmaSq));
};

/**
 * Build a dense FloatNeuroVol by splatting weighted points with an arbitrary kernel.
 * Geometry must match the provided NeuroSpace (dim/spacing/origin/axes/affine).
 * Optimized for overlays (combine max/sum) and supports buffer reuse to avoid GC.
 */
export function buildScatterField(opts: ScatterFieldOptions): ScatterFieldResult {
  const {
    space,
    points,
    kernel = defaultKernel,
    kernelParams = {},
    cutoffMm = 3 * kernelSigma(kernelParams),
    combine = 'max',
    reuseBuffer = null,
  } = opts;

  const [nx, ny, nz] = space.dim;
  const totalVoxels = nx * ny * nz;

  const data = reuseBuffer && reuseBuffer.length === totalVoxels
    ? (reuseBuffer.fill(0), reuseBuffer)
    : new Float32Array(totalVoxels);

  const cutoffSq = cutoffMm * cutoffMm;

  // Precompute inverse affine to go world->voxel using stored inverse matrix
  const invAffine = space.inverseTrans.to2DArray();
  const affine = space.trans.to2DArray();

  let maxValue = 0;
  let nonZeroCount = 0;

  for (const p of points) {
    const weight = p.weight ?? 1;

    // world -> voxel index (round to nearest)
    const vi = Math.round(
      invAffine[0][0] * p.x + invAffine[0][1] * p.y + invAffine[0][2] * p.z + invAffine[0][3]
    );
    const vj = Math.round(
      invAffine[1][0] * p.x + invAffine[1][1] * p.y + invAffine[1][2] * p.z + invAffine[1][3]
    );
    const vk = Math.round(
      invAffine[2][0] * p.x + invAffine[2][1] * p.y + invAffine[2][2] * p.z + invAffine[2][3]
    );

    // Skip if center is out of bounds
    if (vi < 0 || vi >= nx || vj < 0 || vj >= ny || vk < 0 || vk >= nz) continue;

    // Convert cutoff in mm to voxel radii per axis
    const radiusI = Math.ceil(cutoffMm / Math.abs(space.spacing[0] || 1));
    const radiusJ = Math.ceil(cutoffMm / Math.abs(space.spacing[1] || 1));
    const radiusK = Math.ceil(cutoffMm / Math.abs(space.spacing[2] || 1));

    for (let k = Math.max(0, vk - radiusK); k <= Math.min(nz - 1, vk + radiusK); k++) {
      for (let j = Math.max(0, vj - radiusJ); j <= Math.min(ny - 1, vj + radiusJ); j++) {
        for (let i = Math.max(0, vi - radiusI); i <= Math.min(nx - 1, vi + radiusI); i++) {
          // voxel -> world
          const wx = affine[0][0] * i + affine[0][1] * j + affine[0][2] * k + affine[0][3];
          const wy = affine[1][0] * i + affine[1][1] * j + affine[1][2] * k + affine[1][3];
          const wz = affine[2][0] * i + affine[2][1] * j + affine[2][2] * k + affine[2][3];

          const dx = wx - p.x;
          const dy = wy - p.y;
          const dz = wz - p.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > cutoffSq) continue;

          const contrib = weight * kernel(distSq, kernelParams);
          if (contrib <= 0) continue;

          const idx = i + j * nx + k * nx * ny;
          if (combine === 'max') {
            if (contrib > data[idx]) {
              data[idx] = contrib;
            }
          } else {
            data[idx] += contrib;
          }
        }
      }
    }
  }

  // Compute stats
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v > 0) {
      nonZeroCount++;
      if (v > maxValue) maxValue = v;
    }
  }

  const volume = new FloatNeuroVol(space, data);

  return { volume, data, maxValue, nonZeroCount };
}
