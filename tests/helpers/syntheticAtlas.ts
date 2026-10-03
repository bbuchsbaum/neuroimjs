/**
 * Offline stand-ins for the atlas downloads made by NeuroAtlas.loadGlasserAtlas
 * and NeuroAtlas.loadSchaeferAtlas.
 *
 * By default the test suite must not touch the network, so
 * `useSyntheticAtlasDownloads()` routes `Downloader.downloadBuffer` /
 * `downloadText` to synthetic files generated here. They reproduce what the
 * loaders and tests depend on:
 *
 * - the header geometry and datatype of the published files (Schaefer: FSL
 *   MNI152 grid, 182x218x182 at 1 mm or 91x109x91 at 2 mm, float32, sform
 *   diag(-r, r, r) with origin [90, -126, -72], i.e. stored RPI; Glasser360:
 *   97x115x97 at 2 mm, float64, qform only), checked against the real files;
 * - gzip-compressed label volumes whose labels are 1..N;
 * - the label-file formats (Glasser: one `Hemisphere_Region` per line, right
 *   hemisphere first; Schaefer: FreeSurfer LUT rows
 *   `id<TAB>{7|17}Networks_{LH|RH}_<Net>_<k><TAB>R<TAB>G<TAB>B<TAB>0`).
 *
 * Set NEUROIMJS_NETWORK_TESTS=1 to run the same tests against the real files
 * (the optional "network" CI job does this).
 */
import * as pako from 'pako';
import { vi } from 'vitest';
import { Downloader } from '../../src/utils/Downloader';

export const NETWORK_TESTS = process.env.NEUROIMJS_NETWORK_TESTS === '1';

const GLASSER_VOLUME = /glasser360MNI\.nii\.gz$/;
const GLASSER_LABELS = /glasser360NodeNames\.txt$/;
const SCHAEFER_VOLUME =
  /Schaefer2018_(\d+)Parcels_(7|17)Networks_order_FSLMNI152_(1|2)mm\.nii\.gz$/;
const SCHAEFER_LABELS = /Schaefer2018_(\d+)Parcels_(7|17)Networks_order\.txt$/;

/** FSL MNI152 grid at the given isotropic resolution (mm). */
export function fslMni152Grid(resolution: 1 | 2): {
  dims: [number, number, number];
  srow: number[][];
} {
  const dims: [number, number, number] =
    resolution === 1 ? [182, 218, 182] : [91, 109, 91];
  const r = resolution;
  return {
    dims,
    srow: [
      [-r, 0, 0, 90],
      [0, r, 0, -126],
      [0, 0, r, -72],
    ],
  };
}

/**
 * NIfTI datatype codes a synthetic label volume can be stored as:
 * 2 uint8, 4 int16, 8 int32, 16 float32, 64 float64, 256 int8, 512 uint16.
 */
export type NiftiLabelDatatype = 2 | 4 | 8 | 16 | 64 | 256 | 512;

const DATATYPE_BYTES: Record<NiftiLabelDatatype, number> = {
  2: 1, 4: 2, 8: 4, 16: 4, 64: 8, 256: 1, 512: 2,
};

/** Optional storage details for {@link buildLabelVolume}. */
export interface LabelVolumeOptions {
  /** scl_slope written to the header (default 0, i.e. no scaling). */
  sclSlope?: number;
  /** scl_inter written to the header (default 0). */
  sclInter?: number;
  /** Map a label to the raw value stored for it (default: identity). */
  stored?: (label: number) => number;
}

function writeVoxel(
  view: DataView,
  offset: number,
  datatype: NiftiLabelDatatype,
  value: number
): void {
  const le = true;
  switch (datatype) {
    case 2: view.setUint8(offset, value); break;
    case 4: view.setInt16(offset, value, le); break;
    case 8: view.setInt32(offset, value, le); break;
    case 16: view.setFloat32(offset, value, le); break;
    case 64: view.setFloat64(offset, value, le); break;
    case 256: view.setInt8(offset, value); break;
    case 512: view.setUint16(offset, value, le); break;
  }
}

/** Geometry and storage of a synthetic label volume, mirroring a published file. */
export interface LabelVolumeSpec {
  dims: [number, number, number];
  spacing: [number, number, number];
  /** NIfTI datatype: 16 = float32 (Schaefer), 64 = float64 (Glasser360). */
  datatype: NiftiLabelDatatype;
  /** sform rows (sform_code 1, qform_code 1 with the same affine), or ... */
  srow?: number[][];
  /** ... a qform-only header (identity quaternion) with this offset. */
  qoffset?: [number, number, number];
}

/** Glasser360MNI.nii.gz: 97x115x97, 2 mm, float64, qform only, offset (-96.5, -132.5, -78.5). */
export const GLASSER_SPEC: LabelVolumeSpec = {
  dims: [97, 115, 97],
  spacing: [2, 2, 2],
  datatype: 64,
  qoffset: [-96.5, -132.5, -78.5],
};

/** Schaefer2018_*_FSLMNI152_{1,2}mm.nii.gz: FSL MNI152 grid, float32, sform. */
export function schaeferSpec(resolution: 1 | 2): LabelVolumeSpec {
  const { dims, srow } = fslMni152Grid(resolution);
  return { dims, spacing: [resolution, resolution, resolution], datatype: 16, srow };
}

/**
 * Build a gzip-compressed single-file NIfTI-1 label volume. Voxels in the
 * central box get labels cycling through 1..nLabels so every label is
 * present; the rim is background (0). `options` changes how labels are
 * stored (raw values, scl_slope/scl_inter) for datatype tests.
 */
export function buildLabelVolume(
  spec: LabelVolumeSpec,
  nLabels: number,
  options: LabelVolumeOptions = {}
): ArrayBuffer {
  const [nx, ny, nz] = spec.dims;
  const bytes = DATATYPE_BYTES[spec.datatype];
  const voxOffset = 352;
  const n = nx * ny * nz;
  const buf = new ArrayBuffer(voxOffset + n * bytes);
  const view = new DataView(buf);
  const le = true;

  view.setInt32(0, 348, le); // sizeof_hdr
  view.setInt16(40, 3, le);
  view.setInt16(42, nx, le);
  view.setInt16(44, ny, le);
  view.setInt16(46, nz, le);
  for (let d = 4; d <= 7; d++) view.setInt16(40 + d * 2, 1, le);
  view.setInt16(70, spec.datatype, le);
  view.setInt16(72, bytes * 8, le); // bitpix
  view.setFloat32(76, 1, le); // qfac
  for (let a = 0; a < 3; a++) view.setFloat32(80 + a * 4, spec.spacing[a], le);
  view.setFloat32(108, voxOffset, le);
  view.setFloat32(112, options.sclSlope ?? 0, le); // scl_slope
  view.setFloat32(116, options.sclInter ?? 0, le); // scl_inter
  if (spec.srow) {
    view.setInt16(252, 1, le); // qform_code
    view.setInt16(254, 1, le); // sform_code
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) view.setFloat32(280 + r * 16 + c * 4, spec.srow[r][c], le);
    }
    // qform: 180 deg about y flips x (and z); with qfac = -1 z is restored,
    // giving diag(-1, 1, 1) * spacing like the sform.
    view.setFloat32(76, -1, le);
    view.setFloat32(260, 1, le); // quatern_c
    for (let a = 0; a < 3; a++) view.setFloat32(268 + a * 4, spec.srow[a][3], le);
  } else {
    const q = spec.qoffset ?? [0, 0, 0];
    view.setInt16(252, 1, le); // qform_code
    view.setInt16(254, 0, le); // sform_code
    for (let a = 0; a < 3; a++) view.setFloat32(268 + a * 4, q[a], le);
  }
  view.setUint8(344, 0x6e); // 'n'
  view.setUint8(345, 0x2b); // '+'
  view.setUint8(346, 0x31); // '1'

  const lo = spec.dims.map(d => Math.floor(d * 0.2));
  const hi = spec.dims.map(d => Math.ceil(d * 0.8));
  let next = 0;
  for (let z = lo[2]; z < hi[2]; z++) {
    for (let y = lo[1]; y < hi[1]; y++) {
      for (let x = lo[0]; x < hi[0]; x++) {
        const offset = voxOffset + (x + nx * (y + ny * z)) * bytes;
        const label = 1 + (next++ % nLabels);
        writeVoxel(view, offset, spec.datatype, options.stored ? options.stored(label) : label);
      }
    }
  }

  // Fastest compression: the fixtures only need to be valid gzip.
  const gz = pako.gzip(new Uint8Array(buf), { level: 1 });
  return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer;
}

/** Glasser node names: 180 right-hemisphere regions, then the same 180 on the left. */
export function glasserNodeNames(): string {
  const regions = Array.from({ length: 180 }, (_, i) => (i === 0 ? 'V1' : `R${i + 1}`));
  regions[24] = 'PSL'; // a real Glasser region the tests look for
  return [...regions.map(r => `Right_${r}`), ...regions.map(r => `Left_${r}`)].join('\n') + '\n';
}

const NETWORK_NAMES: Record<7 | 17, string[]> = {
  7: ['Vis', 'SomMot', 'DorsAttn', 'SalVentAttn', 'Limbic', 'Cont', 'Default'],
  17: [
    'VisCent', 'VisPeri', 'SomMotA', 'SomMotB', 'DorsAttnA', 'DorsAttnB',
    'SalVentAttnA', 'SalVentAttnB', 'LimbicA', 'LimbicB', 'ContA', 'ContB',
    'ContC', 'DefaultA', 'DefaultB', 'DefaultC', 'TempPar',
  ],
};

/** Schaefer FreeSurfer-style LUT: left hemisphere parcels first, then right. */
export function schaeferLut(parcels: number, networks: 7 | 17): string {
  const names = NETWORK_NAMES[networks];
  const rows: string[] = [];
  // As in the published LUTs, <k> counts parcels within each hemisphere and
  // network, so the same `<Net>_<k>` occurs in both hemispheres.
  const counts = new Map<string, number>();
  for (let id = 1; id <= parcels; id++) {
    const hemi = id <= parcels / 2 ? 'LH' : 'RH';
    const net = names[(id - 1) % names.length];
    const k = (counts.get(`${hemi}_${net}`) ?? 0) + 1;
    counts.set(`${hemi}_${net}`, k);
    const rgb = [(id * 37) % 256, (id * 91) % 256, (id * 151) % 256];
    rows.push(`${id}\t${networks}Networks_${hemi}_${net}_${k}\t${rgb.join('\t')}\t0`);
  }
  return rows.join('\n') + '\n';
}

/**
 * Grid for synthetic atlas volumes: `'published'` mirrors the real files'
 * geometry (~1M voxels for Glasser360, 7.2M for Schaefer 1 mm); `'small'`
 * keeps each file's datatype, spacing and affine but uses a grid of a few
 * thousand voxels (odd voxel count), large enough for 1000 parcels. Use
 * `'small'` where only labels, not geometry, matter.
 */
export type SyntheticGrid = 'published' | 'small';

/** {@link GLASSER_SPEC} on a small 23x27x21 grid (odd voxel count). */
export const SMALL_GLASSER_SPEC: LabelVolumeSpec = { ...GLASSER_SPEC, dims: [23, 27, 21] };

/** {@link schaeferSpec} on a small grid (odd voxel count, room for 1000 parcels). */
export function smallSchaeferSpec(resolution: 1 | 2): LabelVolumeSpec {
  const dims: [number, number, number] = resolution === 1 ? [25, 29, 23] : [21, 25, 19];
  return { ...schaeferSpec(resolution), dims };
}

export async function syntheticAtlasBuffer(
  url: string,
  grid: SyntheticGrid = 'published'
): Promise<ArrayBuffer> {
  const small = grid === 'small';
  if (GLASSER_VOLUME.test(url)) {
    return buildLabelVolume(small ? SMALL_GLASSER_SPEC : GLASSER_SPEC, 360);
  }
  const m = SCHAEFER_VOLUME.exec(url);
  if (m) {
    const res = Number(m[3]) as 1 | 2;
    return buildLabelVolume(small ? smallSchaeferSpec(res) : schaeferSpec(res), Number(m[1]));
  }
  throw new Error(`syntheticAtlasBuffer: no offline fixture for ${url}`);
}

export async function syntheticAtlasText(url: string): Promise<string> {
  if (GLASSER_LABELS.test(url)) return glasserNodeNames();
  const m = SCHAEFER_LABELS.exec(url);
  if (m) return schaeferLut(Number(m[1]), Number(m[2]) as 7 | 17);
  throw new Error(`syntheticAtlasText: no offline fixture for ${url}`);
}

/**
 * Route atlas downloads to the synthetic fixtures unless
 * NEUROIMJS_NETWORK_TESTS=1. Call from a `beforeAll`; the spies are restored
 * by `vi.restoreAllMocks()` or the returned function.
 *
 * @param options.grid - `'published'` (default) or `'small'`; see {@link SyntheticGrid}.
 */
export function useSyntheticAtlasDownloads(
  options: { grid?: SyntheticGrid } = {}
): () => void {
  if (NETWORK_TESTS) return () => undefined;
  const grid = options.grid ?? 'published';
  const buffer = vi
    .spyOn(Downloader, 'downloadBuffer')
    .mockImplementation(url => syntheticAtlasBuffer(url, grid));
  const text = vi.spyOn(Downloader, 'downloadText').mockImplementation(syntheticAtlasText);
  return () => {
    buffer.mockRestore();
    text.mockRestore();
  };
}
