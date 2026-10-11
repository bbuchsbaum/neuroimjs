/**
 * Deterministic synthetic data for the volume-set demo (`VS_SYNTHETIC=1`).
 *
 * Everything is generated in memory from fixed seeds: no network, no private
 * paths, identical bytes on every run. The grid is deliberately non-cubic,
 * anisotropic and translated so geometry bugs (axis swaps, spacing, origin)
 * show up visually and in tests.
 *
 * Models:
 *   synth     3 contrasts x 17 subjects with planted roles (see SYNTHETIC_DESCRIPTION)
 *   synth50   1 contrast x 50 subjects, 4 interleaved planted groups + noise
 *   synth200  1 contrast x 200 subjects, 4 interleaved planted groups + noise
 *
 * Member files are 4D float32 NIfTI-1 (.nii.gz) with frames [beta, t, p, se]
 * (see STAT_FRAME in data.ts). Values outside the brain mask are 0.
 *
 * Node-side only (uses node:zlib); imported by vs-data-plugin.ts and tests.
 */
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export interface SyntheticGrid {
  dim: [number, number, number];
  spacing: [number, number, number];
  /** World coordinate (mm) of voxel (0,0,0). */
  origin: [number, number, number];
  /** 4x4 voxel -> world affine (axis-aligned, no rotation). */
  affine: number[][];
}

const DIM: [number, number, number] = [36, 44, 30];
const SPACING: [number, number, number] = [3.0, 2.5, 3.5];
// World (0,0,0) sits at grid (17.4, 21.36, 14.6): near the centre
// (17.5, 21.5, 14.5) but deliberately not on a voxel centre.
const ORIGIN: [number, number, number] = [-52.2, -53.4, -51.1];

export function syntheticGrid(): SyntheticGrid {
  const [sx, sy, sz] = SPACING;
  const [ox, oy, oz] = ORIGIN;
  return {
    dim: [...DIM] as [number, number, number],
    spacing: [...SPACING] as [number, number, number],
    origin: [...ORIGIN] as [number, number, number],
    affine: [
      [sx, 0, 0, ox],
      [0, sy, 0, oy],
      [0, 0, sz, oz],
      [0, 0, 0, 1],
    ],
  };
}

const NVOX = DIM[0] * DIM[1] * DIM[2];

/** World coordinate of the grid centre, used as the "brain" centre. */
const CENTRE = [0, 1, 2].map((a) => ORIGIN[a] + ((DIM[a] - 1) / 2) * SPACING[a]);
/** Brain ellipsoid semi-axes in mm (x, y, z). */
const BRAIN_AXES = [46, 50, 42];

/** World coordinates of every voxel (i-fastest), cached. */
let worldCache: Float32Array[] | null = null;
function worldCoords(): Float32Array[] {
  if (worldCache) return worldCache;
  const [nx, ny, nz] = DIM;
  const x = new Float32Array(NVOX);
  const y = new Float32Array(NVOX);
  const z = new Float32Array(NVOX);
  let g = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++, g++) {
        x[g] = ORIGIN[0] + i * SPACING[0];
        y[g] = ORIGIN[1] + j * SPACING[1];
        z[g] = ORIGIN[2] + k * SPACING[2];
      }
  worldCache = [x, y, z];
  return worldCache;
}

/** Normalised ellipsoid radius (1 = brain surface) per voxel. */
function ellipsoidRadius(scale: number[], offset: number[] = [0, 0, 0]): Float32Array {
  const [x, y, z] = worldCoords();
  const out = new Float32Array(NVOX);
  for (let g = 0; g < NVOX; g++) {
    const dx = (x[g] - CENTRE[0] - offset[0]) / scale[0];
    const dy = (y[g] - CENTRE[1] - offset[1]) / scale[1];
    const dz = (z[g] - CENTRE[2] - offset[2]) / scale[2];
    out[g] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return out;
}

let brainCache: Uint8Array | null = null;
/** Brain mask: 1 inside the brain ellipsoid. */
export function brainMask(): Uint8Array {
  if (brainCache) return brainCache;
  const r = ellipsoidRadius(BRAIN_AXES);
  brainCache = new Uint8Array(NVOX);
  for (let g = 0; g < NVOX; g++) brainCache[g] = r[g] <= 1 ? 1 : 0;
  return brainCache;
}

// ---------------------------------------------------------------------------
// Deterministic randomness and smoothing
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit string hash. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 PRNG in [0, 1). */
function rng(seed: number | string): () => number {
  let a = (typeof seed === 'string' ? hash(seed) : seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Separable Gaussian blur (sigma in voxels, clamped edges), in place. */
function blur3(data: Float32Array, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let d = -radius; d <= radius; d++) sum += kernel[d + radius] = Math.exp(-(d * d) / (2 * sigma * sigma));
  for (let d = 0; d < kernel.length; d++) kernel[d] /= sum;
  const [nx, ny, nz] = DIM;
  const strides = [1, nx, nx * ny];
  const tmp = new Float32Array(NVOX);
  for (let axis = 0; axis < 3; axis++) {
    const n = DIM[axis];
    const stride = strides[axis];
    let g = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++, g++) {
          const pos = axis === 0 ? i : axis === 1 ? j : k;
          const base = g - pos * stride;
          let acc = 0;
          for (let d = -radius; d <= radius; d++) {
            const p = Math.min(n - 1, Math.max(0, pos + d));
            acc += kernel[d + radius] * data[base + p * stride];
          }
          tmp[g] = acc;
        }
    data.set(tmp);
  }
  return data;
}

/** Spatially smooth Gaussian noise, scaled to unit SD inside the brain. */
function smoothNoise(seed: string, sigma = 1.2): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(NVOX);
  for (let g = 0; g < NVOX; g++) out[g] = normal(r);
  blur3(out, sigma);
  const brain = brainMask();
  let n = 0;
  let s = 0;
  let ss = 0;
  for (let g = 0; g < NVOX; g++)
    if (brain[g]) {
      n++;
      s += out[g];
      ss += out[g] * out[g];
    }
  const mean = s / n;
  const sd = Math.sqrt(ss / n - mean * mean) || 1;
  for (let g = 0; g < NVOX; g++) out[g] = (out[g] - mean) / sd;
  return out;
}

/** A pattern of Gaussian blobs (mm-space) placed inside the brain. */
function blobPattern(seed: string, count = 6, ampRange: [number, number] = [3, 6]): Float32Array {
  const r = rng(seed);
  const [x, y, z] = worldCoords();
  const out = new Float32Array(NVOX);
  for (let b = 0; b < count; b++) {
    // Rejection-sample a centre within 70% of the brain ellipsoid.
    let c: number[];
    do {
      c = [0, 1, 2].map(() => 2 * r() - 1);
    } while (c[0] * c[0] + c[1] * c[1] + c[2] * c[2] > 0.49);
    const cx = CENTRE[0] + c[0] * BRAIN_AXES[0];
    const cy = CENTRE[1] + c[1] * BRAIN_AXES[1];
    const cz = CENTRE[2] + c[2] * BRAIN_AXES[2];
    const sigma = 8 + 6 * r();
    const amp = (ampRange[0] + (ampRange[1] - ampRange[0]) * r()) * (r() < 0.3 ? -1 : 1);
    const inv = 1 / (2 * sigma * sigma);
    for (let g = 0; g < NVOX; g++) {
      const dx = x[g] - cx;
      const dy = y[g] - cy;
      const dz = z[g] - cz;
      out[g] += amp * Math.exp(-(dx * dx + dy * dy + dz * dz) * inv);
    }
  }
  return out;
}

const patternCache = new Map<string, Float32Array>();
function pattern(name: string): Float32Array {
  let p = patternCache.get(name);
  if (!p) {
    p = blobPattern(`pattern:${name}`);
    patternCache.set(name, p);
  }
  return p;
}

/** Two-sided p from a t value via the normal approximation (erfc, |rel err| < 1.2e-7). */
function twoSidedP(t: number): number {
  const z = Math.abs(t) / Math.SQRT2;
  const u = 1 / (1 + 0.5 * z);
  const erfc =
    u *
    Math.exp(
      -z * z -
        1.26551223 +
        u *
          (1.00002368 +
            u *
              (0.37409196 +
                u *
                  (0.09678418 +
                    u * (-0.18628806 + u * (0.27886807 + u * (-1.13520398 + u * (1.48851587 + u * (-0.82215223 + u * 0.17087277))))))))
    );
  return Math.min(1, erfc);
}

// ---------------------------------------------------------------------------
// NIfTI-1 encoder
// ---------------------------------------------------------------------------

export interface EncodeNiftiOptions {
  dim: readonly number[];
  spacing: readonly number[];
  /** 4x4 voxel -> world affine written to srow_x/y/z (sform_code 1). */
  affine: readonly (readonly number[])[];
  /** One Float32Array per 3D frame; more than one frame produces a 4D file. */
  frames: readonly Float32Array[];
  description?: string;
  /** gzip the result (default true). */
  gzip?: boolean;
}

/**
 * Minimal NIfTI-1 single-file writer: 348-byte header + 4-byte extension flag,
 * vox_offset 352, float32 data (datatype 16), little-endian, sform_code 1,
 * qform_code 0.
 */
export function encodeNifti(opts: EncodeNiftiOptions): Buffer {
  const [nx, ny, nz] = opts.dim;
  const nvox = nx * ny * nz;
  const nt = opts.frames.length;
  if (nt < 1) throw new Error('encodeNifti: at least one frame is required');
  for (const f of opts.frames) {
    if (f.length !== nvox) throw new Error(`encodeNifti: frame has ${f.length} values, expected ${nvox}`);
  }
  const VOX_OFFSET = 352;
  const buf = Buffer.alloc(VOX_OFFSET + nvox * nt * 4);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setInt32(0, 348, true); // sizeof_hdr
  buf[38] = 'r'.charCodeAt(0); // regular (legacy ANALYZE field, harmless)
  const dims = [nt > 1 ? 4 : 3, nx, ny, nz, nt, 1, 1, 1];
  dims.forEach((d, i) => dv.setInt16(40 + 2 * i, d, true));
  dv.setInt16(70, 16, true); // datatype FLOAT32
  dv.setInt16(72, 32, true); // bitpix
  const pixdim = [1, opts.spacing[0], opts.spacing[1], opts.spacing[2], 1, 1, 1, 1];
  pixdim.forEach((p, i) => dv.setFloat32(76 + 4 * i, p, true));
  dv.setFloat32(108, VOX_OFFSET, true); // vox_offset
  dv.setFloat32(112, 1, true); // scl_slope
  dv.setFloat32(116, 0, true); // scl_inter
  buf[123] = 2 | 8; // xyzt_units: mm, s
  const descrip = (opts.description ?? 'neuroimjs synthetic').slice(0, 79);
  buf.write(descrip, 148, 'latin1');
  dv.setInt16(252, 0, true); // qform_code
  dv.setInt16(254, 1, true); // sform_code (scanner anat)
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++) dv.setFloat32(280 + 16 * row + 4 * col, opts.affine[row][col], true);
  buf.write('n+1\0', 344, 'latin1'); // magic
  // bytes 348..351: extension flag = 0 (already zero)
  for (let f = 0; f < nt; f++) {
    const frame = opts.frames[f];
    const base = VOX_OFFSET + f * nvox * 4;
    for (let g = 0; g < nvox; g++) dv.setFloat32(base + 4 * g, frame[g], true);
  }
  return opts.gzip === false ? buf : zlib.gzipSync(buf, { level: 6 });
}

// ---------------------------------------------------------------------------
// Dataset description
// ---------------------------------------------------------------------------

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

const SYNTH_SUBJECTS = range(17).map((i) => `s${pad(i, 2)}`);

/** Which synth subject plays which planted role (t frame, all three contrasts). */
export const SYNTHETIC_DESCRIPTION = {
  grid: { dim: DIM, spacing: SPACING, origin: ORIGIN },
  model: 'synth',
  contrasts: ['cue', 'delayearly', 'delaylate'],
  subjects: SYNTH_SUBJECTS,
  /** Share blob pattern P1 (+ individual jitter and smooth noise). */
  groupA: ['s01', 's02', 's03', 's04', 's05', 's06', 's07'],
  /** Share blob pattern P2. */
  groupB: ['s08', 's09', 's10', 's11', 's12'],
  /** Unrelated pattern P3. */
  outlier: 's13',
  /** -P1 (anticorrelated with group A). */
  signFlip: 's14',
  /** `scaled` = 2 * `source` + 0.5 inside the brain: r = 1, different bytes. */
  identicalPattern: { source: 's01', scaled: 's15' },
  /** P1-based, but NaN (all frames) on a superior slab covering ~40% of brain voxels. */
  lowCoverage: 's16',
  /** t = 0 everywhere inside the brain (beta 0, p 1). */
  constant: 's17',
  /** Performance sets: one contrast `cue`, subject n<i> belongs to group (i - 1) % 4. */
  perf: {
    synth50: { contrast: 'cue', subjects: 50, groups: 4 },
    synth200: { contrast: 'cue', subjects: 200, groups: 4 },
  },
} as const;

type Role = 'A' | 'B' | 'outlier' | 'signFlip' | 'scaled' | 'lowCoverage' | 'constant';

function synthRole(subject: string): Role | null {
  const d = SYNTHETIC_DESCRIPTION;
  if ((d.groupA as readonly string[]).includes(subject)) return 'A';
  if ((d.groupB as readonly string[]).includes(subject)) return 'B';
  if (subject === d.outlier) return 'outlier';
  if (subject === d.signFlip) return 'signFlip';
  if (subject === d.identicalPattern.scaled) return 'scaled';
  if (subject === d.lowCoverage) return 'lowCoverage';
  if (subject === d.constant) return 'constant';
  return null;
}

interface ModelSpec {
  contrasts: string[];
  subjects: string[];
}

const PERF_MODELS: Record<string, number> = { synth50: 50, synth200: 200 };

const MODELS: Record<string, ModelSpec> = {
  synth: { contrasts: [...SYNTHETIC_DESCRIPTION.contrasts], subjects: SYNTH_SUBJECTS },
  synth50: { contrasts: ['cue'], subjects: range(50).map((i) => `n${pad(i, 3)}`) },
  synth200: { contrasts: ['cue'], subjects: range(200).map((i) => `n${pad(i, 3)}`) },
};

export interface SyntheticMember {
  model: string;
  subject: string;
  contrast: string;
  url: string;
}

function memberUrl(model: string, subject: string, contrast: string): string {
  return `/vs/files/${model}/sub-${subject}/sub-${subject}_contrast-${contrast}_stats.nii.gz`;
}

/** Manifest members, ordered by model, subject, contrast (like the on-disk scan). */
export function syntheticManifest(): SyntheticMember[] {
  const out: SyntheticMember[] = [];
  for (const model of Object.keys(MODELS).sort()) {
    const spec = MODELS[model];
    for (const subject of spec.subjects)
      for (const contrast of spec.contrasts) out.push({ model, subject, contrast, url: memberUrl(model, subject, contrast) });
  }
  return out;
}

/**
 * BIDS-style participants.tsv for every synthetic subject (all models). Synthetic covariates chosen so
 * colouring reveals planted structure: age differs between groups A and B, the outlier (s13) has high
 * head motion, and `site` is a two-level factor unrelated to the planted patterns. "n/a" marks missing
 * values (one per covariate) so the missing-value legend is exercised.
 */
export function syntheticParticipantsTsv(): string {
  const rows = ['participant_id\tage\tsite\tmean_fd'];
  const r = rng('participants');
  const d = SYNTHETIC_DESCRIPTION;
  for (const subject of SYNTH_SUBJECTS) {
    const inA = (d.groupA as readonly string[]).includes(subject);
    const inB = (d.groupB as readonly string[]).includes(subject);
    const age = subject === 's09' ? 'n/a' : (inA ? 24 + 6 * r() : inB ? 62 + 8 * r() : 30 + 30 * r()).toFixed(1);
    const site = subject === 's05' ? 'n/a' : r() < 0.5 ? 'north' : 'south';
    const fd = (subject === d.outlier ? 0.62 + 0.1 * r() : 0.08 + 0.12 * r()).toFixed(3);
    rows.push(`sub-${subject}\t${age}\t${site}\t${subject === 's02' ? 'n/a' : fd}`);
  }
  for (const model of ['synth50', 'synth200'] as const) {
    for (const subject of MODELS[model].subjects) {
      const g = (Number(subject.slice(1)) - 1) % 4;
      rows.push(`sub-${subject}\t${(25 + 12 * g + 6 * r()).toFixed(1)}\t${r() < 0.5 ? 'north' : 'south'}\t${(0.08 + 0.12 * r()).toFixed(3)}`);
    }
  }
  return `${rows.join('\n')}\n`;
}

/**
 * Resolve the part of a member URL after `/vs/files/` (already URI-decoded)
 * to a known member, or null.
 */
export function parseSyntheticFile(rel: string): { model: string; subject: string; contrast: string } | null {
  const m = /^([A-Za-z0-9]+)\/sub-([A-Za-z0-9]+)\/sub-([A-Za-z0-9]+)_contrast-([A-Za-z0-9]+)_stats\.nii\.gz$/.exec(rel);
  if (!m || m[2] !== m[3]) return null;
  const [, model, subject, , contrast] = m;
  const spec = MODELS[model];
  if (!spec || !spec.subjects.includes(subject) || !spec.contrasts.includes(contrast)) return null;
  return { model, subject, contrast };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export interface SyntheticTemplate {
  t1: Float32Array;
  mask: Float32Array;
}

let templateCache: SyntheticTemplate | null = null;

/** Grayscale "T1": GM shell, brighter WM ellipsoid, dark ventricle core, mild noise. */
export function syntheticTemplate(): SyntheticTemplate {
  if (templateCache) return templateCache;
  const rBrain = ellipsoidRadius(BRAIN_AXES);
  const rWm = ellipsoidRadius([31, 35, 27], [0, 0, 3]);
  const rVent = ellipsoidRadius([8, 18, 9], [0, 2, 4]);
  const noise = smoothNoise('template:noise', 0.8);
  const sigmoid = (v: number, edge: number, width: number): number => 1 / (1 + Math.exp((v - edge) / width));
  const brain = brainMask();
  const t1 = new Float32Array(NVOX);
  const mask = new Float32Array(NVOX);
  for (let g = 0; g < NVOX; g++) {
    const inBrain = sigmoid(rBrain[g], 1, 0.03);
    const wm = sigmoid(rWm[g], 1, 0.06);
    const vent = sigmoid(rVent[g], 1, 0.12);
    let v = 40 + inBrain * (560 + 340 * wm) - 600 * vent * inBrain;
    v += 18 * noise[g];
    t1[g] = Math.max(0, v);
    mask[g] = brain[g];
  }
  templateCache = { t1, mask };
  return templateCache;
}

const templateFileCache = new Map<string, Buffer>();

/** Gzipped 3D NIfTI for `T1w.nii.gz` or `mask.nii.gz`; null for anything else. */
/**
 * Synthetic cortical parcellation named like Schaefer 2018 (`17Networks_<LH|RH>_<Network>_<n>`): the
 * brain shell (normalised radius 0.55-1) split by hemisphere, anterior/posterior halves, three height
 * bands and an inner/outer shell, giving 24 parcels. The deep core is left unlabelled (0), so
 * "outside the atlas" is exercised the way subcortex is with the real Schaefer atlas.
 */
export function syntheticAtlas(): { labels: Float32Array; tsv: string } {
  const r = ellipsoidRadius(BRAIN_AXES);
  const [x, y, z] = worldCoords();
  const labels = new Float32Array(NVOX);
  const names = new Map<number, string>();
  const networks = ['Vis', 'SomMot', 'DorsAttn'];
  for (let g = 0; g < NVOX; g++) {
    if (r[g] > 1 || r[g] < 0.55) continue;
    const hemi = x[g] - CENTRE[0] < 0 ? 0 : 1;
    const front = y[g] - CENTRE[1] >= 0 ? 1 : 0;
    const dz = (z[g] - CENTRE[2]) / BRAIN_AXES[2];
    const band = dz < -0.3 ? 0 : dz < 0.3 ? 1 : 2;
    const outer = r[g] > 0.8 ? 1 : 0;
    const local = front * 6 + band * 2 + outer; // 0..11 within a hemisphere
    const id = 1 + hemi * 12 + local;
    labels[g] = id;
    if (!names.has(id)) names.set(id, `17Networks_${hemi ? 'RH' : 'LH'}_${networks[band]}${front ? 'A' : 'P'}_${outer + 1}`);
  }
  const ids = [...names.keys()].sort((a, b) => a - b);
  return { labels, tsv: `index\tname\n${ids.map((id) => `${id}\t${names.get(id)}`).join('\n')}\n` };
}

let atlasCache: { labels: Float32Array; tsv: string } | null = null;

export function syntheticTemplateFile(name: string): Buffer | null {
  if (name === 'atlas.tsv') {
    atlasCache ??= syntheticAtlas();
    return Buffer.from(atlasCache.tsv, 'utf8');
  }
  if (name === 'atlas.nii.gz') {
    let buf = templateFileCache.get(name);
    if (!buf) {
      atlasCache ??= syntheticAtlas();
      const grid = syntheticGrid();
      buf = encodeNifti({ dim: grid.dim, spacing: grid.spacing, affine: grid.affine, frames: [atlasCache.labels], description: 'neuroimjs synthetic parcellation' });
      templateFileCache.set(name, buf);
    }
    return buf;
  }
  if (name !== 'T1w.nii.gz' && name !== 'mask.nii.gz') return null;
  let buf = templateFileCache.get(name);
  if (!buf) {
    const tpl = syntheticTemplate();
    const grid = syntheticGrid();
    buf = encodeNifti({
      dim: grid.dim,
      spacing: grid.spacing,
      affine: grid.affine,
      frames: [name === 'T1w.nii.gz' ? tpl.t1 : tpl.mask],
      description: `neuroimjs synthetic ${name}`,
    });
    templateFileCache.set(name, buf);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

let lowCoverageCache: Uint8Array | null = null;
/** 1 on the superior slab of whole axial slices covering ~40% of brain voxels. */
function lowCoverageSlab(): Uint8Array {
  if (lowCoverageCache) return lowCoverageCache;
  const [nx, ny, nz] = DIM;
  const brain = brainMask();
  const perSlice = new Array<number>(nz).fill(0);
  let total = 0;
  for (let g = 0; g < NVOX; g++)
    if (brain[g]) {
      perSlice[Math.floor(g / (nx * ny))]++;
      total++;
    }
  let kCut = nz;
  let acc = 0;
  let best = Infinity;
  for (let k = nz - 1; k >= 0; k--) {
    acc += perSlice[k];
    const err = Math.abs(acc / total - 0.4);
    if (err < best) {
      best = err;
      kCut = k;
    }
  }
  lowCoverageCache = new Uint8Array(NVOX);
  for (let g = 0; g < NVOX; g++) lowCoverageCache[g] = Math.floor(g / (nx * ny)) >= kCut ? 1 : 0;
  return lowCoverageCache;
}

/** Contrast-specific mix: cue is the planted pattern, the delays are variations of it. */
const CONTRAST_MIX: Record<string, { gain: number; shared: number }> = {
  cue: { gain: 1, shared: 0 },
  delayearly: { gain: 0.7, shared: 0.6 },
  delaylate: { gain: 0.4, shared: 1.0 },
};

/** Generic member t map: gain * pattern + jitter + contrast-shared pattern + smooth noise. */
function plantedT(model: string, subject: string, contrast: string, base: Float32Array | null): Float32Array {
  const mix = CONTRAST_MIX[contrast] ?? CONTRAST_MIX.cue;
  const r = rng(`gain:${model}:${subject}`);
  const gain = (0.85 + 0.3 * r()) * mix.gain;
  const jitter = blobPattern(`jitter:${model}:${subject}`, 3, [0.8, 1.6]);
  const shared = mix.shared > 0 ? pattern(`${model}:contrast:${contrast}`) : null;
  const noise = smoothNoise(`noise:${model}:${subject}:${contrast}`);
  const t = new Float32Array(NVOX);
  for (let g = 0; g < NVOX; g++) {
    t[g] = (base ? gain * base[g] : 0) + jitter[g] + (shared ? mix.shared * shared[g] : 0) + noise[g];
  }
  return t;
}

/** t map for one member (full grid, 0 outside the brain, NaN where unobserved). */
export function syntheticT(model: string, subject: string, contrast: string): Float32Array {
  const brain = brainMask();
  let t: Float32Array;
  if (model === 'synth') {
    const role = synthRole(subject);
    if (!role) throw new Error(`unknown synth subject ${subject}`);
    switch (role) {
      case 'A':
      case 'lowCoverage':
        t = plantedT(model, subject, contrast, pattern('P1'));
        break;
      case 'B':
        t = plantedT(model, subject, contrast, pattern('P2'));
        break;
      case 'outlier':
        t = plantedT(model, subject, contrast, pattern('P3'));
        break;
      case 'signFlip': {
        const p1 = pattern('P1');
        const neg = Float32Array.from(p1, (v) => -v);
        t = plantedT(model, subject, contrast, neg);
        break;
      }
      case 'scaled': {
        const src = syntheticT(model, SYNTHETIC_DESCRIPTION.identicalPattern.source, contrast);
        t = new Float32Array(NVOX);
        for (let g = 0; g < NVOX; g++) t[g] = brain[g] ? Math.fround(2 * src[g] + 0.5) : 0;
        return t;
      }
      case 'constant':
        return new Float32Array(NVOX);
    }
    if (role === 'lowCoverage') {
      const slab = lowCoverageSlab();
      for (let g = 0; g < NVOX; g++) if (slab[g] && brain[g]) t[g] = NaN;
    }
  } else if (model in PERF_MODELS) {
    const idx = Number(subject.slice(1));
    t = plantedT(model, subject, contrast, pattern(`${model}:G${(idx - 1) % 4}`));
  } else {
    throw new Error(`unknown synthetic model ${model}`);
  }
  for (let g = 0; g < NVOX; g++) if (!brain[g]) t[g] = 0;
  return t;
}

/** Frames [beta, t, p, se] for one member. */
export function syntheticMemberFrames(model: string, subject: string, contrast: string): Float32Array[] {
  const brain = brainMask();
  const t = syntheticT(model, subject, contrast);
  const seNoise = smoothNoise(`se:${model}:${subject}:${contrast}`, 2.0);
  const beta = new Float32Array(NVOX);
  const p = new Float32Array(NVOX);
  const se = new Float32Array(NVOX);
  for (let g = 0; g < NVOX; g++) {
    if (!brain[g]) continue;
    const s = Math.max(0.15, 0.6 * (1 + 0.25 * seNoise[g]));
    const tv = t[g];
    se[g] = Number.isNaN(tv) ? NaN : s;
    beta[g] = tv * s;
    p[g] = Number.isNaN(tv) ? NaN : twoSidedP(tv);
  }
  return [beta, t, p, se];
}

const MEMBER_CACHE_MAX = 48;
const memberCache = new Map<string, Buffer>();

/** Gzipped 4D NIfTI for one member. Cached in a bounded LRU; regeneration is deterministic. */
export function syntheticMemberFile(model: string, subject: string, contrast: string): Buffer {
  const key = `${model}|${subject}|${contrast}`;
  const hit = memberCache.get(key);
  if (hit) {
    memberCache.delete(key);
    memberCache.set(key, hit);
    return hit;
  }
  const grid = syntheticGrid();
  const buf = encodeNifti({
    dim: grid.dim,
    spacing: grid.spacing,
    affine: grid.affine,
    frames: syntheticMemberFrames(model, subject, contrast),
    description: `synthetic ${model} ${subject} ${contrast} [beta,t,p,se]`,
  });
  memberCache.set(key, buf);
  if (memberCache.size > MEMBER_CACHE_MAX) memberCache.delete(memberCache.keys().next().value as string);
  return buf;
}

/** Drop cached buffers (tests use this to check regeneration is byte-identical). */
export function clearSyntheticCache(): void {
  memberCache.clear();
  templateFileCache.clear();
}
