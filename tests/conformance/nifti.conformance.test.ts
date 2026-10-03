/**
 * NIfTI conformance: neuroimjs vs nibabel on committed fixtures.
 *
 * Every expected value comes from tests/conformance/fixtures/manifest.json,
 * produced by nibabel re-loading the exact committed bytes (see
 * scripts/conformance/generate_nifti_fixtures.py). Both decoders are checked:
 * the Node path (readHeader / readVol / readVec in src/io/io.ts) and the
 * browser path (readNiftiArrayBuffer in src/io/browserNifti.ts).
 *
 * Transform selection: nibabel uses header.get_best_affine() — sform when
 * sform_code != 0, else qform when qform_code != 0, else a centred, x-flipped
 * "base" affine built from pixdim. neuroimjs delegates to nifti-reader-js,
 * which uses the qform whenever qform_code > 0 AND sform_code < qform_code,
 * otherwise the sform when sform_code > 0, otherwise diag(pixdim) with a zero
 * offset (NIfTI-1 "method 1"). The two rules agree whenever sform_code >=
 * qform_code or only one form is set; the cases where they differ are listed
 * in KNOWN below.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findAnatomy3D } from '../../src/geometry/Axis';
import type { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { readHeader, readVec, readVol } from '../../src/io/io';
import { readNiftiArrayBuffer } from '../../src/io/browserNifti';
import type { NeuroVol } from '../../src/volume/NeuroVol';
import { BigNeuroVec } from '../../src/vector/BigNeuroVec';
import {
  TOL,
  axcodes,
  conformanceIt,
  expectClose,
  expectMatrixClose,
  fixtureBytes,
  fixturePath,
  manifest,
  type ConformanceCase,
  type KnownDiscrepancies,
} from './manifest';

// ---------------------------------------------------------------------------
// Known discrepancies (each is a bug ticket). Keys are the check names below.
// ---------------------------------------------------------------------------
const UINT_READVOL =
  'readVol throws "Unsupported TypedArray type: uint16/uint32" - createVolFromBuffer maps datatype 512/768 ' +
  'but createNeuroVol has no uint16/uint32 branch (readNiftiArrayBuffer decodes these fine)';
const PRECEDENCE =
  'transform precedence: nibabel uses the sform whenever sform_code != 0; nifti-reader-js (both decoders) ' +
  'uses the qform when qform_code > sform_code';
const NO_XFORM =
  'qform_code = sform_code = 0: nibabel returns the Analyze base affine (x flipped, grid centred at 0); ' +
  'neuroimjs returns diag(pixdim) with zero offset (NIfTI-1 "method 1")';
const SPACING_PIXDIM =
  "readVol takes NeuroSpace.spacing from pixdim[1..3] rather than the selected affine's column norms " +
  '(browser decoder uses the column norms), so spacing contradicts space.trans when pixdim describes a different transform';
const SHEAR_AXES =
  'nearestAnatomy(): orthogonalize() calls ml-matrix col1.mul(dotp), which scales col1 IN PLACE; for ' +
  'non-orthogonal (sheared) affines the i axis is negated (RAS reported as LAS) and reorient() picks the wrong frame';
const READVEC_AFFINE =
  'readVec affine loss, fixed on fix/readvec-geometry: readVec builds its [T,X,Y,Z] NeuroSpace from ' +
  'spacing/origin only, dropping rotation/shear and shifting the axes';
const NIFTI2_QFORM =
  'TODO(fmt-nifti-complete): nifti-reader-js reads NIfTI-2 transforms from srow_* only and ignores the qform; ' +
  'with sform_code 0 the srow is all zeros, so both decoders throw on the singular affine';

const READVOL_ALL = [
  'readVol: voxel values (every volume)',
  'readVol: affine and dims (every volume)',
  'readVol: spacing equals affine voxel sizes',
  'readVol: grid <-> world matches nibabel apply_affine',
  'readVol: orientation matches nibabel aff2axcodes',
  'readVol: reorient to RAS matches nibabel as_closest_canonical',
  'readVol: ArrayBuffer input decodes like a path',
  'decoder parity: readVol and readNiftiArrayBuffer agree',
];
const all = (checks: string[], reason: string): Record<string, string> =>
  Object.fromEntries(checks.map(check => [check, reason]));
const shearAxes = {
  'readVol: orientation matches nibabel aff2axcodes': SHEAR_AXES,
  'readVol: reorient to RAS matches nibabel as_closest_canonical': SHEAR_AXES,
  'browser: orientation matches nibabel aff2axcodes': SHEAR_AXES,
};
const spacingPixdim = {
  'readVol: spacing equals affine voxel sizes': SPACING_PIXDIM,
  'decoder parity: readVol and readNiftiArrayBuffer agree': SPACING_PIXDIM,
};

const KNOWN: KnownDiscrepancies = {
  dtype_uint16_le: all(READVOL_ALL, UINT_READVOL),
  dtype_uint16_be: all(READVOL_ALL, UINT_READVOL),
  dtype_uint32_le: all(READVOL_ALL, UINT_READVOL),
  dtype_uint32_be: all(READVOL_ALL, UINT_READVOL),
  xform_both_sform_code_higher: spacingPixdim,
  xform_both_equal_codes: spacingPixdim,
  xform_sform_pixdim_mismatch: spacingPixdim,
  xform_both_qform_code_higher: all(
    [
      'readHeader: affine matches nibabel get_best_affine',
      'readVol: affine and dims (every volume)',
      // The selected qform's zooms equal pixdim, so spacing disagrees with nibabel's sform.
      'readVol: spacing equals affine voxel sizes',
      'readVol: grid <-> world matches nibabel apply_affine',
      'readVol: reorient to RAS matches nibabel as_closest_canonical',
      'browser: affine, spacing, grid <-> world',
    ],
    PRECEDENCE
  ),
  xform_none: all(
    [
      'readHeader: affine matches nibabel get_best_affine',
      'readVol: affine and dims (every volume)',
      'readVol: grid <-> world matches nibabel apply_affine',
      'readVol: orientation matches nibabel aff2axcodes',
      'readVol: reorient to RAS matches nibabel as_closest_canonical',
      'browser: affine, spacing, grid <-> world',
      'browser: orientation matches nibabel aff2axcodes',
    ],
    NO_XFORM
  ),
  xform_sform_only_shear: shearAxes,
  vec4d_int16_be_shear: { ...shearAxes, 'readVec: spatial affine matches nibabel': READVEC_AFFINE },
  nifti2_float32_be_gz: shearAxes,
  vec4d_int16_sform_oblique: { 'readVec: spatial affine matches nibabel': READVEC_AFFINE },
  vec4d_float32_qform_negqfac_gz: { 'readVec: spatial affine matches nibabel': READVEC_AFFINE },
  nifti2_qform_only: {
    ...all(READVOL_ALL, NIFTI2_QFORM),
    'readHeader: affine matches nibabel get_best_affine': NIFTI2_QFORM,
    'browser: voxel values (every volume)': NIFTI2_QFORM,
    'browser: affine, spacing, grid <-> world': NIFTI2_QFORM,
    'browser: orientation matches nibabel aff2axcodes': NIFTI2_QFORM,
  },
};

/**
 * The transform neuroimjs is documented to select for a NIfTI-1 header
 * (nifti-reader-js rule, see the file comment), computed from nibabel's
 * independent qform/sform reconstructions.
 */
function neuroimjsSelectedAffine(c: ConformanceCase): number[][] {
  const { qform_code: q, sform_code: s, pixdim } = c.header;
  if (q > 0 && s < q) return c.qform!;
  if (s > 0) return c.sform!;
  return [
    [pixdim[1], 0, 0, 0],
    [0, pixdim[2], 0, 0],
    [0, 0, pixdim[3], 0],
    [0, 0, 0, 1],
  ];
}

const isInteger = (c: ConformanceCase) => /int/.test(c.header.dtype);
const isScaled = (c: ConformanceCase) => c.scaling.slope !== 1 || c.scaling.inter !== 0;

/** Tolerance for decoded voxel values given the decoder's output precision. */
function valueTolerance(c: ConformanceCase, output: 'float32' | 'native' | 'float64'): number {
  if (output === 'float32') {
    // readVec always stores Float32. Unscaled int8/16 and float32 survive exactly.
    const exact = !isScaled(c) && ['int8', 'uint8', 'int16', 'uint16', 'float32'].includes(c.header.dtype);
    return exact ? 0 : TOL.float32Scaled;
  }
  if (!isScaled(c)) return 0;
  return output === 'float64' ? TOL.float64Scaled : TOL.float32Scaled;
}

function spatialDims(c: ConformanceCase): number[] {
  return c.shape.slice(0, 3);
}

function checkGeometry(space: NeuroSpace, c: ConformanceCase, label: string): void {
  expect(space.dim.slice(0, 3), `${label}: dim`).toEqual(spatialDims(c));
  expectMatrixClose(space.trans.to2DArray(), c.affine, `${label}: affine`);
}

function checkSamples(space: NeuroSpace, c: ConformanceCase, label: string): void {
  for (const { ijk, xyz } of c.samples) {
    expectClose(space.gridToCoord(ijk), xyz, TOL.geometry, `${label}: gridToCoord(${ijk})`);
    expectClose(space.coordToGrid(xyz), ijk, TOL.geometry, `${label}: coordToGrid(${xyz})`);
  }
}

function checkReorient(space: NeuroSpace, c: ConformanceCase, label: string): void {
  // neuroim names axes by their origin side: L->R, P->A, I->S is nibabel's RAS+.
  const ras = space.reorient(findAnatomy3D('L', 'P', 'I'));
  expect(axcodes(ras.axes.axes()), `${label}: canonical axcodes`).toEqual(c.canonical.axcodes);
  expect(ras.dim, `${label}: canonical shape`).toEqual(c.canonical.shape);
  expectMatrixClose(ras.trans.to2DArray(), c.canonical.affine, `${label}: canonical affine`);
}

describe(`nibabel conformance manifest (nibabel ${manifest.generator.nibabel}, numpy ${manifest.generator.numpy})`, () => {
  it('has at least 20 cases with unique ids', () => {
    expect(manifest.cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(manifest.cases.map(c => c.id)).size).toBe(manifest.cases.length);
  });

  it('lists only known-discrepancy ids that exist', () => {
    const ids = new Set(manifest.cases.map(c => c.id));
    for (const id of Object.keys(KNOWN)) expect(ids.has(id), id).toBe(true);
  });
});

for (const c of manifest.cases) {
  describe(`${c.id}: ${c.description}`, () => {
    const nVols = c.volumes.length;

    it('fixture bytes match the manifest sha256', () => {
      const digest = createHash('sha256').update(readFileSync(fixturePath(c))).digest('hex');
      expect(digest).toBe(c.sha256);
    });

    describe('readHeader', () => {
      conformanceIt(KNOWN, c.id, 'readHeader: dims, datatype, codes, scaling fields', async () => {
        const h = await readHeader(fixturePath(c));
        expect(h.dim.slice(0, c.header.dim[0] + 1)).toEqual(c.header.dim.slice(0, c.header.dim[0] + 1));
        expect(h.datatype.toLowerCase()).toBe(c.header.dtype);
        expect(h.bitpix).toBe(c.header.bitpix);
        expect(h.qformCode).toBe(c.header.qform_code);
        expect(h.sformCode).toBe(c.header.sform_code);
        expect(h.voxOffset).toBe(c.header.vox_offset);
        expectClose(h.spacing, c.header.pixdim.slice(1, 4), 0, 'pixdim[1..3]');
        if (c.header.scl_slope === null) expect(Number.isNaN(h.sclSlope)).toBe(true);
        else expect(h.sclSlope).toBe(c.header.scl_slope);
        if (c.header.scl_inter === null) expect(Number.isNaN(h.sclInter)).toBe(true);
        else expect(h.sclInter).toBe(c.header.scl_inter);
      });

      if (c.format === 'nifti1') {
        it('readHeader: affine follows the documented neuroimjs qform/sform rule', async () => {
          const h = await readHeader(fixturePath(c));
          expectMatrixClose(h.affine, neuroimjsSelectedAffine(c), 'readHeader.affine');
        });
      }

      conformanceIt(KNOWN, c.id, 'readHeader: affine matches nibabel get_best_affine', async () => {
        const h = await readHeader(fixturePath(c));
        expectMatrixClose(h.affine, c.affine, 'readHeader.affine');
        expectClose(h.origin, c.affine.slice(0, 3).map(row => row[3]), TOL.geometry, 'readHeader.origin');
      });
    });

    describe('readVol (Node decoder)', () => {
      conformanceIt(KNOWN, c.id, 'readVol: voxel values (every volume)', async () => {
        for (let t = 0; t < nVols; t++) {
          const vol = await readVol(fixturePath(c), { index: t });
          expect(vol.space.dim).toEqual(spatialDims(c));
          expectClose(vol.getData(), c.volumes[t].scaled, valueTolerance(c, 'native'), `volume ${t}`);
        }
      });

      conformanceIt(KNOWN, c.id, 'readVol: affine and dims (every volume)', async () => {
        for (let t = 0; t < nVols; t++) {
          const vol = await readVol(fixturePath(c), { index: t });
          checkGeometry(vol.space, c, `volume ${t}`);
        }
      });

      conformanceIt(KNOWN, c.id, 'readVol: spacing equals affine voxel sizes', async () => {
        const vol = await readVol(fixturePath(c));
        expectClose(vol.space.spacing, c.voxel_sizes, TOL.geometry, 'spacing');
      });

      conformanceIt(KNOWN, c.id, 'readVol: grid <-> world matches nibabel apply_affine', async () => {
        checkSamples((await readVol(fixturePath(c))).space, c, 'readVol');
      });

      conformanceIt(KNOWN, c.id, 'readVol: orientation matches nibabel aff2axcodes', async () => {
        const vol = await readVol(fixturePath(c));
        expect(axcodes(vol.space.axes.axes())).toEqual(c.axcodes);
      });

      conformanceIt(KNOWN, c.id, 'readVol: reorient to RAS matches nibabel as_closest_canonical', async () => {
        checkReorient((await readVol(fixturePath(c))).space, c, 'readVol');
      });

      conformanceIt(KNOWN, c.id, 'readVol: ArrayBuffer input decodes like a path', async () => {
        const fromPath = await readVol(fixturePath(c));
        const fromBytes = await readVol(fixtureBytes(c));
        expectClose(fromBytes.getData(), fromPath.getData(), 0, 'values');
        expectMatrixClose(fromBytes.space.trans.to2DArray(), fromPath.space.trans.to2DArray(), 'affine');
      });
    });

    describe('readNiftiArrayBuffer (browser decoder)', () => {
      conformanceIt(KNOWN, c.id, 'browser: voxel values (every volume)', () => {
        for (let t = 0; t < nVols; t++) {
          const vol = readNiftiArrayBuffer(fixtureBytes(c), { index: t });
          expect(vol.space.dim).toEqual(spatialDims(c));
          expectClose(vol.getData(), c.volumes[t].scaled, valueTolerance(c, 'float64'), `volume ${t}`);
        }
      });

      conformanceIt(KNOWN, c.id, 'browser: affine, spacing, grid <-> world', () => {
        const vol = readNiftiArrayBuffer(fixtureBytes(c));
        checkGeometry(vol.space, c, 'browser');
        expectClose(vol.space.spacing, c.voxel_sizes, TOL.geometry, 'browser spacing');
        checkSamples(vol.space, c, 'browser');
      });

      conformanceIt(KNOWN, c.id, 'browser: orientation matches nibabel aff2axcodes', () => {
        const vol = readNiftiArrayBuffer(fixtureBytes(c));
        expect(axcodes(vol.space.axes.axes())).toEqual(c.axcodes);
      });

      conformanceIt(KNOWN, c.id, 'decoder parity: readVol and readNiftiArrayBuffer agree', async () => {
        for (let t = 0; t < nVols; t++) {
          const node: NeuroVol = await readVol(fixturePath(c), { index: t });
          const browser = readNiftiArrayBuffer(fixtureBytes(c), { index: t });
          // Node keeps scaled data in Float32, browser in Float64.
          const tol = isScaled(c) ? TOL.float32Scaled : 0;
          expectClose(node.getData(), browser.getData(), tol, `volume ${t} values`);
          expect(node.space.dim).toEqual(browser.space.dim);
          expectMatrixClose(node.space.trans.to2DArray(), browser.space.trans.to2DArray(), `volume ${t} affine`);
          expectClose(node.space.spacing, browser.space.spacing, TOL.geometry, `volume ${t} spacing`);
          expectClose(node.space.origin, browser.space.origin, TOL.geometry, `volume ${t} origin`);
          expect(axcodes(node.space.axes.axes())).toEqual(axcodes(browser.space.axes.axes()));
        }
      });
    });

    if (c.shape.length === 4) {
      describe('readVec (4D)', () => {
        conformanceIt(KNOWN, c.id, 'readVec: voxel values via getAt(i, j, k, t)', async () => {
          const vec = await readVec(fixturePath(c));
          try {
            const [nx, ny, nz] = spatialDims(c);
            for (let t = 0; t < nVols; t++) {
              const got = new Float64Array(nx * ny * nz);
              for (let k = 0; k < nz; k++)
                for (let j = 0; j < ny; j++)
                  for (let i = 0; i < nx; i++) got[i + nx * (j + ny * k)] = vec.getAt(i, j, k, t);
              expectClose(got, c.volumes[t].scaled, valueTolerance(c, 'float32'), `readVec volume ${t}`);
            }
          } finally {
            if (vec instanceof BigNeuroVec) vec.cleanup();
          }
        });

        conformanceIt(KNOWN, c.id, 'readVec: spatial affine matches nibabel', async () => {
          const vec = await readVec(fixturePath(c));
          try {
            // The spatial affine must survive regardless of where the time axis sits.
            const trans = vec.space.trans.to2DArray();
            expectMatrixClose(trans, c.affine, 'readVec space affine');
          } finally {
            if (vec instanceof BigNeuroVec) vec.cleanup();
          }
        });
      });
    }

    if (!isInteger(c) && !isScaled(c)) {
      // Float fixtures are unscaled: stored == scaled. Guard the manifest itself.
      it('manifest: unscaled float data equals scaled data', () => {
        for (const v of c.volumes) expectClose(v.unscaled, v.scaled, 0, 'manifest');
      });
    }
  });
}
