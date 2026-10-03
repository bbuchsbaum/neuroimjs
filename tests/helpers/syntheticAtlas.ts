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

/** Geometry and storage of a synthetic label volume, mirroring a published file. */
export interface LabelVolumeSpec {
  dims: [number, number, number];
  spacing: [number, number, number];
  /** NIfTI datatype: 16 = float32 (Schaefer), 64 = float64 (Glasser360). */
  datatype: 16 | 64;
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
 * present; the rim is background (0).
 */
export function buildLabelVolume(spec: LabelVolumeSpec, nLabels: number): ArrayBuffer {
  const [nx, ny, nz] = spec.dims;
  const bytes = spec.datatype === 64 ? 8 : 4;
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
        if (bytes === 8) view.setFloat64(offset, label, le);
        else view.setFloat32(offset, label, le);
      }
    }
  }

  const gz = pako.gzip(new Uint8Array(buf));
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
  for (let id = 1; id <= parcels; id++) {
    const hemi = id <= parcels / 2 ? 'LH' : 'RH';
    const net = names[(id - 1) % names.length];
    const rgb = [(id * 37) % 256, (id * 91) % 256, (id * 151) % 256];
    rows.push(`${id}\t${networks}Networks_${hemi}_${net}_${id}\t${rgb.join('\t')}\t0`);
  }
  return rows.join('\n') + '\n';
}

export async function syntheticAtlasBuffer(url: string): Promise<ArrayBuffer> {
  if (GLASSER_VOLUME.test(url)) return buildLabelVolume(GLASSER_SPEC, 360);
  const m = SCHAEFER_VOLUME.exec(url);
  if (m) return buildLabelVolume(schaeferSpec(Number(m[3]) as 1 | 2), Number(m[1]));
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
 */
export function useSyntheticAtlasDownloads(): () => void {
  if (NETWORK_TESTS) return () => undefined;
  const buffer = vi.spyOn(Downloader, 'downloadBuffer').mockImplementation(syntheticAtlasBuffer);
  const text = vi.spyOn(Downloader, 'downloadText').mockImplementation(syntheticAtlasText);
  return () => {
    buffer.mockRestore();
    text.mockRestore();
  };
}
