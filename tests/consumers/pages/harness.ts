/**
 * Shared fixtures for the downstream consumer contract pages and specs.
 *
 * Nothing here imports neuroimjs: the volumes are synthesised and encoded as
 * NIfTI-1 bytes by hand, so the contract pages exercise the packed tarball
 * exactly as a consumer would, with no help from the library under test.
 * The module is DOM-free at import time so the Node-side specs can use it too.
 */

export type Vec3 = [number, number, number];

export interface SyntheticVolume {
  dim: Vec3;
  spacing: Vec3;
  origin: Vec3;
  /** 4x4 voxel-to-world affine, row-major rows (as nifti-reader-js returns). */
  affine: number[][];
  /** i-fastest voxel data. */
  data: Float32Array;
}

export function makeAffine(spacing: Vec3, origin: Vec3): number[][] {
  return [
    [spacing[0], 0, 0, origin[0]],
    [0, spacing[1], 0, origin[1]],
    [0, 0, spacing[2], origin[2]],
    [0, 0, 0, 1],
  ];
}

function fill(
  dim: Vec3,
  spacing: Vec3,
  origin: Vec3,
  valueAt: (x: number, y: number, z: number) => number
): SyntheticVolume {
  const data = new Float32Array(dim[0] * dim[1] * dim[2]);
  for (let k = 0; k < dim[2]; k += 1) {
    for (let j = 0; j < dim[1]; j += 1) {
      for (let i = 0; i < dim[0]; i += 1) {
        const x = origin[0] + i * spacing[0];
        const y = origin[1] + j * spacing[1];
        const z = origin[2] + k * spacing[2];
        data[(k * dim[1] + j) * dim[0] + i] = valueAt(x, y, z);
      }
    }
  }
  return { dim, spacing, origin, affine: makeAffine(spacing, origin), data };
}

/** A 2 mm "head": a bright ellipsoid with a darker core on a zero background. */
export function underlayVolume(): SyntheticVolume {
  return fill([32, 36, 30], [2, 2, 2], [-32, -36, -28], (x, y, z) => {
    const r = Math.hypot(x / 26, y / 30, z / 24);
    if (r > 1) return 0;
    return 400 + 600 * (1 - r) + (r < 0.35 ? -250 : 0);
  });
}

/**
 * A 4 mm signed statistical map (t-map-like): a positive and a negative
 * Gaussian blob. `gain` scales both so two maps share a grid but differ.
 */
export function statVolume(gain = 1): SyntheticVolume {
  const blob = (x: number, y: number, z: number, c: Vec3, sigma: number) =>
    Math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2) / (2 * sigma * sigma));
  return fill([16, 18, 15], [4, 4, 4], [-32, -36, -28], (x, y, z) =>
    gain * (6 * blob(x, y, z, [12, 0, 4], 6) - 5 * blob(x, y, z, [-12, 4, 0], 5))
  );
}

/** Encode a float32 NIfTI-1 single file (.nii) with an sform affine. */
export function encodeNifti1(volume: SyntheticVolume): ArrayBuffer {
  const voxOffset = 352;
  const buffer = new ArrayBuffer(voxOffset + volume.data.byteLength);
  const view = new DataView(buffer);
  const le = true;
  view.setInt32(0, 348, le);
  const dims = [3, volume.dim[0], volume.dim[1], volume.dim[2], 1, 1, 1, 1];
  dims.forEach((value, index) => view.setInt16(40 + 2 * index, value, le));
  view.setInt16(70, 16, le); // datatype FLOAT32
  view.setInt16(72, 32, le); // bitpix
  const pixdim = [1, volume.spacing[0], volume.spacing[1], volume.spacing[2], 1, 1, 1, 1];
  pixdim.forEach((value, index) => view.setFloat32(76 + 4 * index, value, le));
  view.setFloat32(108, voxOffset, le);
  view.setFloat32(112, 1, le); // scl_slope
  view.setFloat32(116, 0, le); // scl_inter
  view.setUint8(123, 2); // xyzt_units: mm
  view.setInt16(252, 0, le); // qform_code
  view.setInt16(254, 2, le); // sform_code: aligned
  [280, 296, 312].forEach((offset, row) => {
    for (let column = 0; column < 4; column += 1) {
      view.setFloat32(offset + 4 * column, volume.affine[row][column], le);
    }
  });
  'n+1\0'.split('').forEach((char, index) => view.setUint8(344 + index, char.charCodeAt(0)));
  new Float32Array(buffer, voxOffset).set(volume.data);
  return buffer;
}

export interface ConsumerReport {
  done: boolean;
  steps: string[];
  results: Record<string, unknown>;
  error: { step: string; message: string; stack?: string } | null;
}

export type ConsumerStep = [name: string, run: () => unknown];

/**
 * Run a consumer's call sequence in order and publish the outcome on
 * `window.__CONSUMER__`. A step's return value (when defined) is recorded
 * under its name; the first failure stops the sequence.
 */
export async function runConsumer(steps: ConsumerStep[]): Promise<ConsumerReport> {
  const report: ConsumerReport = { done: false, steps: [], results: {}, error: null };
  (globalThis as unknown as { __CONSUMER__: ConsumerReport }).__CONSUMER__ = report;
  for (const [name, run] of steps) {
    try {
      const value = await run();
      if (value !== undefined) report.results[name] = value;
      report.steps.push(name);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      report.error = { step: name, message: err.message, stack: err.stack };
      break;
    }
  }
  report.done = true;
  return report;
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
