/**
 * VolumeSet: a set of aligned 3D maps (e.g. one contrast map per subject) on a
 * shared grid, stored as masked Float32 vectors with per-member metadata.
 *
 * Grid layout follows neuroimjs: i-fastest, idx = i + j*nx + k*nx*ny.
 */
import type { NeuroVol } from '../volume/NeuroVol';
import type { NeuroSpace } from '../geometry/NeuroSpace';
import { assertSameVolumeGeometry } from '../geometry/VolumeGeometry';

export type SetOrientation = 'axial' | 'coronal' | 'sagittal';

/** Free-form facet metadata, e.g. { subject: '1001', contrast: 'cue', model: 'glm4' }. */
export type MemberMeta = Record<string, string | number>;

export interface SetMember {
  meta: MemberMeta;
  /** In-mask values, aligned with VolumeSet.maskIndex. */
  values: Float32Array;
}

export interface SliceGrid {
  width: number;
  height: number;
  /** Row-major display order: row 0 is the top of the screen. NaN outside the mask. */
  data: Float32Array;
}

export class VolumeSet {
  readonly space: NeuroSpace;
  readonly dim: [number, number, number];
  /** Linear grid indices of in-mask voxels. */
  readonly maskIndex: Int32Array;
  /** Grid index -> position in maskIndex, or -1 outside the mask. */
  readonly gridToMask: Int32Array;
  readonly members: SetMember[];

  constructor(space: NeuroSpace, maskIndex: Int32Array, members: SetMember[]) {
    const [nx, ny, nz] = space.dim as number[];
    this.space = space;
    this.dim = [nx, ny, nz];
    this.maskIndex = maskIndex;
    this.gridToMask = new Int32Array(nx * ny * nz).fill(-1);
    for (let m = 0; m < maskIndex.length; m++) this.gridToMask[maskIndex[m]] = m;
    for (const member of members) {
      if (member.values.length !== maskIndex.length) {
        throw new Error('member values do not match the mask size');
      }
    }
    this.members = members;
  }

  /**
   * Build a set from 3D volumes that share one grid. The mask is `mask` (any
   * value > 0.5) when given, intersected with voxels where at least one member
   * is finite and non-zero.
   */
  static fromVolumes(vols: NeuroVol[], metas: MemberMeta[], mask?: NeuroVol): VolumeSet {
    if (vols.length === 0) throw new Error('volume set is empty');
    if (metas.length !== vols.length) throw new Error('one metadata record per volume is required');
    for (const v of vols.slice(1)) assertSameVolumeGeometry(vols[0], v);
    if (mask) assertSameVolumeGeometry(vols[0], mask);
    const raw = vols.map((v) => v.getData() as ArrayLike<number>);
    const n = raw[0].length;
    const maskData = mask ? (mask.getData() as ArrayLike<number>) : null;
    const keep: number[] = [];
    for (let i = 0; i < n; i++) {
      if (maskData && !(maskData[i] > 0.5)) continue;
      let any = false;
      for (const r of raw) {
        const x = r[i];
        if (Number.isFinite(x) && x !== 0) {
          any = true;
          break;
        }
      }
      if (any) keep.push(i);
    }
    const maskIndex = Int32Array.from(keep);
    const members = raw.map((r, m) => {
      const values = new Float32Array(maskIndex.length);
      for (let t = 0; t < maskIndex.length; t++) {
        const x = r[maskIndex[t]];
        values[t] = Number.isFinite(x) ? x : NaN;
      }
      return { meta: metas[m], values };
    });
    return new VolumeSet(vols[0].space, maskIndex, members);
  }

  get size(): number {
    return this.members.length;
  }

  /** Distinct values of a metadata key, in first-seen order. */
  levels(key: string): string[] {
    const seen: string[] = [];
    for (const m of this.members) {
      const v = String(m.meta[key]);
      if (!seen.includes(v)) seen.push(v);
    }
    return seen;
  }

  /** Indices of members whose metadata match every given key/value. */
  where(filter: MemberMeta): number[] {
    const out: number[] = [];
    this.members.forEach((m, i) => {
      if (Object.entries(filter).every(([k, v]) => String(m.meta[k]) === String(v))) out.push(i);
    });
    return out;
  }

  /** Number of slices along an orientation. */
  sliceCount(orientation: SetOrientation): number {
    const [nx, ny, nz] = this.dim;
    return orientation === 'axial' ? nz : orientation === 'coronal' ? ny : nx;
  }

  /** In-mask value at grid coordinate (NaN outside the mask or grid). */
  valueAt(values: Float32Array, ijk: readonly number[]): number {
    const [nx, ny, nz] = this.dim;
    const [i, j, k] = ijk.map(Math.round);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return NaN;
    const m = this.gridToMask[i + j * nx + k * nx * ny];
    return m >= 0 ? values[m] : NaN;
  }

  /** Masked vector -> display slice (NaN outside mask). */
  slice(values: Float32Array, orientation: SetOrientation, index: number): SliceGrid {
    const g2m = this.gridToMask;
    return sliceGrid(this.dim, orientation, index, (g) => {
      const m = g2m[g];
      return m >= 0 ? values[m] : NaN;
    });
  }

  /** In-mask indices (positions in the masked vectors) lying on one slice. */
  sliceMaskPositions(orientation: SetOrientation, index: number): Int32Array {
    const [nx, ny] = this.dim;
    const out: number[] = [];
    for (let m = 0; m < this.maskIndex.length; m++) {
      const g = this.maskIndex[m];
      const i = g % nx;
      const j = Math.floor(g / nx) % ny;
      const k = Math.floor(g / (nx * ny));
      const c = orientation === 'axial' ? k : orientation === 'coronal' ? j : i;
      if (c === index) out.push(m);
    }
    return Int32Array.from(out);
  }

  /** In-mask indices within a sphere (radius in voxels) around a grid point. */
  sphereMaskPositions(center: readonly number[], radiusVox: number): Int32Array {
    const [nx, ny] = this.dim;
    const r2 = radiusVox * radiusVox;
    const out: number[] = [];
    for (let m = 0; m < this.maskIndex.length; m++) {
      const g = this.maskIndex[m];
      const di = (g % nx) - center[0];
      const dj = (Math.floor(g / nx) % ny) - center[1];
      const dk = Math.floor(g / (nx * ny)) - center[2];
      if (di * di + dj * dj + dk * dk <= r2) out.push(m);
    }
    return Int32Array.from(out);
  }
}

/**
 * Extract a display-oriented slice from a full grid accessor.
 * Neurological convention, matching the neuroimjs orthoviewer:
 *   axial    (k fixed): x = i (left -> right), top = anterior
 *   coronal  (j fixed): x = i (left -> right), top = superior
 *   sagittal (i fixed): x = j (anterior -> posterior, i.e. anterior on the left), top = superior
 */
export function sliceGrid(
  dim: readonly [number, number, number] | readonly number[],
  orientation: SetOrientation,
  index: number,
  at: (gridIndex: number) => number
): SliceGrid {
  const [nx, ny, nz] = dim;
  const nxy = nx * ny;
  let width: number;
  let height: number;
  let data: Float32Array;
  if (orientation === 'axial') {
    width = nx;
    height = ny;
    data = new Float32Array(width * height);
    for (let row = 0; row < height; row++) {
      const j = ny - 1 - row;
      for (let i = 0; i < nx; i++) data[row * width + i] = at(i + j * nx + index * nxy);
    }
  } else if (orientation === 'coronal') {
    width = nx;
    height = nz;
    data = new Float32Array(width * height);
    for (let row = 0; row < height; row++) {
      const k = nz - 1 - row;
      for (let i = 0; i < nx; i++) data[row * width + i] = at(i + index * nx + k * nxy);
    }
  } else {
    width = ny;
    height = nz;
    data = new Float32Array(width * height);
    for (let row = 0; row < height; row++) {
      const k = nz - 1 - row;
      for (let col = 0; col < ny; col++) data[row * width + col] = at(index + (ny - 1 - col) * nx + k * nxy);
    }
  }
  return { width, height, data };
}

/** Slice of a full (unmasked) grid array, e.g. the anatomical underlay. */
export function sliceFullGrid(
  dim: readonly number[],
  grid: ArrayLike<number>,
  orientation: SetOrientation,
  index: number
): SliceGrid {
  return sliceGrid(dim, orientation, index, (g) => grid[g]);
}

/** Map a display pixel (column, row) on a slice back to grid ijk. */
export function slicePixelToGrid(
  dim: readonly number[],
  orientation: SetOrientation,
  index: number,
  col: number,
  row: number
): [number, number, number] {
  const [, ny, nz] = dim;
  if (orientation === 'axial') return [col, ny - 1 - row, index];
  if (orientation === 'coronal') return [col, index, nz - 1 - row];
  return [index, ny - 1 - col, nz - 1 - row];
}

/** Grid ijk -> display pixel (column, row) on a slice of the given orientation. */
export function gridToSlicePixel(
  dim: readonly number[],
  orientation: SetOrientation,
  ijk: readonly number[]
): [number, number] {
  const [, ny, nz] = dim;
  if (orientation === 'axial') return [ijk[0], ny - 1 - ijk[1]];
  if (orientation === 'coronal') return [ijk[0], nz - 1 - ijk[2]];
  return [ny - 1 - ijk[1], nz - 1 - ijk[2]];
}
