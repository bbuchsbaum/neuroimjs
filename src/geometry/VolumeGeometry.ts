import type { NeuroVol } from '../volume/NeuroVol';

/** Serializable spatial metadata used to validate volumes before display. */
export interface VolumeGeometry {
  dimensions: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  axes: [string, string, string];
  /** Direction of increasing i, j, and k axes, for example RAS or LPI. */
  orientation: string;
  affine: [number[], number[], number[], number[]];
}

const axisCode: Record<string, string> = {
  LEFT_RIGHT: 'R',
  RIGHT_LEFT: 'L',
  POST_ANT: 'A',
  ANT_POST: 'P',
  INF_SUP: 'S',
  SUP_INF: 'I',
};

function tuple3<T>(values: readonly T[]): [T, T, T] {
  return [values[0], values[1], values[2]];
}

/** Return a detached, JSON-safe geometry description for a volume. */
export function getVolumeGeometry(volume: NeuroVol): VolumeGeometry {
  const space = volume.space;
  const axes = tuple3(space.axes.names().slice(0, 3));
  const affine = space.trans.to2DArray().map(row => row.slice()) as VolumeGeometry['affine'];
  return {
    dimensions: tuple3(space.dim),
    spacing: tuple3(space.spacing),
    origin: tuple3(space.origin),
    axes,
    orientation: axes.map(axis => axisCode[axis] ?? '?').join(''),
    affine,
  };
}

function nearlyEqual(left: number, right: number, tolerance: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

/**
 * Fail closed when two volumes do not occupy the same voxel grid.
 *
 * This deliberately compares the full affine in addition to dimensions and
 * derived fields. It does not resample, reorient, or wrap either volume.
 */
export function assertSameVolumeGeometry(
  reference: NeuroVol,
  candidate: NeuroVol,
  tolerance = 1e-6
): void {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('Geometry tolerance must be a finite non-negative number.');
  }
  const expected = getVolumeGeometry(reference);
  const actual = getVolumeGeometry(candidate);
  const mismatch = (field: string, detail: string): never => {
    throw new Error(`Volume geometry mismatch in ${field}: ${detail}`);
  };

  expected.dimensions.forEach((value, index) => {
    if (actual.dimensions[index] !== value) {
      mismatch('dimensions', `expected ${expected.dimensions.join('x')}, got ${actual.dimensions.join('x')}`);
    }
  });
  expected.axes.forEach((value, index) => {
    if (actual.axes[index] !== value) {
      mismatch('axes', `expected ${expected.axes.join(',')}, got ${actual.axes.join(',')}`);
    }
  });
  (['spacing', 'origin'] as const).forEach(field => {
    expected[field].forEach((value, index) => {
      if (!nearlyEqual(value, actual[field][index], tolerance)) {
        mismatch(field, `element ${index} expected ${value}, got ${actual[field][index]}`);
      }
    });
  });
  expected.affine.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (!nearlyEqual(value, actual.affine[rowIndex][columnIndex], tolerance)) {
        mismatch(
          'affine',
          `[${rowIndex},${columnIndex}] expected ${value}, got ${actual.affine[rowIndex][columnIndex]}`
        );
      }
    });
  });
}
