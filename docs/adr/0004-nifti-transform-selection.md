# ADR-0004: Choosing between the NIfTI qform and sform

- **Status:** Proposed
- **Date:** 2026-10-03
- **Scope:** `readHeader`, `readVol`/`readVec` (`src/io/io.ts`), `readNiftiArrayBuffer` (`src/io/browserNifti.ts`), the NIfTI writers

## Context

neuroimjs does not choose a voxel-to-world transform itself. Both decoders use `header.affine` from nifti-reader-js: see `io.ts:286-296` and `:500-507` for the Node decoder, and `browserNifti.ts:145-151` for the browser decoder. nifti-reader-js 0.8.0 builds that affine as follows (`node_modules/nifti-reader-js/dist/nifti1.js:200-280`; [source](https://github.com/rii-mango/NIFTI-Reader-JS/blob/master/src/nifti1.ts)):

1. If `qform_code < 1` and `sform_code < 1`, use `diag(pixdim)` with zero offset.
2. If `qform_code > 0` and `sform_code < qform_code`, use the qform.
3. Otherwise, if `sform_code > 0`, use the sform.

The nibabel conformance suite on branch `fix/nifti-conformance` (`tests/conformance/README.md`) found two cases where this differs from nibabel. Both are recorded in the `KNOWN` table of `tests/conformance/nifti.conformance.test.ts` (lines 50-55 and 114-137):

- **`xform_both_qform_code_higher`** (`qform_code > sform_code > 0`): nifti-reader-js uses the qform and nibabel uses the sform. The affine, spacing, world↔grid mapping and RAS reorientation all differ.
- **`xform_none`** (both codes 0): nifti-reader-js returns `diag(pixdim)` with origin at voxel (0, 0, 0). nibabel returns the Analyze base affine, which flips x and centres the grid ([analyze.py:636-658](https://github.com/nipy/nibabel/blob/5.3.2/nibabel/analyze.py#L636-L658), `default_x_flip = True` at `:190`).

A third problem is separate: for NIfTI-2, nifti-reader-js reads only `srow_*`. A qform-only NIfTI-2 file therefore gets a singular affine (`NIFTI2_QFORM` in the same table).

**What the spec says.** NIfTI-1 defines Method 2 (qform) as "intended to represent 'scanner-anatomical' coordinates" and Method 3 (sform) as a general affine. It states that "both methods 2 and 3 can be present, and be useful in different contexts (method 2 for displaying the data on its original grid; method 3 for displaying it on a standard grid)" ([nifti1.h](https://raw.githubusercontent.com/NIFTI-Imaging/nifti_clib/master/niftilib/nifti1.h)). The xform codes are labels (1 scanner, 2 aligned, 3 Talairach, 4 MNI, 5 other template). They are not a priority ranking. **The spec sets no precedence rule.** "Higher code wins" relies on a ranking the spec never defines. Under that rule, a sform labelled aligned (2) loses to a qform labelled MNI (4) or generic template (5). Of the tools surveyed below, only nifti-reader-js does this.

**What other software does** (verified against source where a link is given):

| Software | Rule |
|---|---|
| nibabel | sform if `sform_code != 0`, else qform if `qform_code != 0`, else centred base affine with x flipped (`get_best_affine`, [nifti1.py:904-911 @ 5.3.2](https://github.com/nipy/nibabel/blob/5.3.2/nibabel/nifti1.py#L904-L911); [docs](https://nipy.org/nibabel/nifti_images.html)) |
| SPM | `mat`: sform if `sform_code > 0`, else qform; `mat0` is always the qform ([@nifti/subsref.m](https://github.com/spm/spm/blob/main/%40nifti/subsref.m)); without a qform, a centred voxel-size diagonal ([decode_qform0.m](https://github.com/spm/spm/blob/main/%40nifti/private/decode_qform0.m)) |
| AFNI | both codes > 0: sform by default (`form_priority = 'S'`, overridable with `AFNI_NIFTI_PRIORITY=Q`); otherwise whichever code is > 0; neither: warn ([thd_niftiread.c:46,225,271-280](https://github.com/afni/afni/blob/master/src/thd_niftiread.c)) |
| ITK (ANTs, Slicer) | conditional: sform if it is orthonormal *and* (the qform code is unknown, *or* the sform is `SCANNER_ANAT`, *or* sform ≈ qform); otherwise qform; non-orthonormal sforms are rejected unless `SFORM_Permissive` ([itkNiftiImageIO.cxx](https://github.com/InsightSoftwareConsortium/ITK/blob/master/Modules/IO/NIFTI/src/itkNiftiImageIO.cxx), `SetImageIOOrientationFromNIfTI`). [ITK#2674](https://github.com/InsightSoftwareConsortium/ITK/issues/2674) reports that the switch toward the sform in PR #1868 broke downstream users. ANTs is reported to use the qform ([NeuroStars](https://neurostars.org/t/note-on-orientation-qform-and-sform-warning/4379)) |
| neuroim2 | sform if `sform_code > 0`, else qform (`neuroim2/R/meta_info.R:141-159`). When both codes are ≤ 0, both transforms are replaced by a centred, x-flipped voxel-size affine (`R/nifti_io.R:685-688`, `.method1_affine` at `:568-576`), which is nibabel's fallback. neuroim2 calls this "METHOD 1"; nifti1.h's Method 1 is `diag(pixdim)` with no centring or flip |
| FSL | **not verified.** The docs say only that FSL tools "try to keep `qform` and `sform` matrices the same" ([fslutils](https://fsl.fmrib.ox.ac.uk/fsl/docs/utilities/fslutils.html)) |
| nifti-reader-js (Papaya/Mango lineage) | higher code wins; a tie goes to the sform (above) |

The neuroimjs writers set both codes to 1 with the same affine (`io.ts:723-750`), and a tie goes to the sform under every rule above. Files written by neuroimjs therefore read back identically under either rule. The 4D writer sets only the sform (`io.ts:1008`).

## Decision drivers

- Agreement with nibabel, the conformance oracle, and with neuroim2. The same file should get the same coordinates in R and in the browser.
- Agreement with the analysis tools whose outputs users load: SPM and AFNI, and FSL in practice.
- Predictability: displayed coordinates should match those in papers and in other viewers.
- An escape hatch for scanner-space inspection and for ITK-style pipelines.

## Considered options

**A. Keep the nifti-reader-js rule.** No migration is needed. However, it disagrees with nibabel, SPM, AFNI and neuroim2 in the `q > s > 0` case. It also ranks codes in a way the spec does not, and it puts the origin at a corner when neither transform is set.

**B. The nibabel rule, including the base-affine fallback.** This matches the reference suite exactly. It matches SPM and AFNI for every file that has at least one transform, and it matches neuroim2 for every file, including those with no transform. The centred, x-flipped fallback is an SPM/Analyze convention, and it orients unlabelled data as LAS, which surprises some users. It does agree with nibabel and SPM.

**C. sform-first, with spec Method 1 (`diag(pixdim)`) as the fallback.** Literal spec semantics when no transform is set. The `xform_none` mismatch with nibabel remains as a documented, intended difference. It would also break parity with neuroim2, which uses nibabel's fallback.

**D. B by default, plus `transform: 'best' | 'sform' | 'qform' | 'legacy'` on the read functions.**

## Recommendation

Use **D**, with **B** as the default (`'best'`):

1. neuroimjs selects the transform itself instead of relying on `header.affine`. It reads `srow_*` from the raw header (NIfTI-1 bytes 280-327) and builds the qform from the quaternion fields. The qform builder is the inverse of the existing `matToQuatern` (`io.ts:906`). This also fixes the NIfTI-2 qform gap.
2. `'best'` means: sform if `sform_code != 0`, else qform if `qform_code != 0`, else nibabel's base affine. `'legacy'` reproduces nifti-reader-js for one release. `'qform'` and `'sform'` force one transform and fall back to `'best'` when that transform's code is 0.
3. Expose both transforms and both codes on the header returned by `readHeader` (`qform`, `sform`, `qformCode`, `sformCode`), so that callers can detect files where the two disagree.
4. Both decoders share one selection function, and the conformance `KNOWN` entries for `PRECEDENCE` and `NO_XFORM` are removed.

## Consequences and migration

- **Affected files:** only those with `qform_code > sform_code > 0`, or with both codes 0. The common scanner-qform (1) plus registered-sform (2–4) pattern is unaffected, because the sform code is already higher. The first case is rare; an example is a template qform (4 or 5) alongside an aligned sform (2). Files with no transform are mostly legacy Analyze conversions. For these files, displayed world coordinates, spacing (when the qform and sform zooms differ) and the anatomical orientation labels can all change.
- **Release:** this is a bug fix for nibabel conformance, but it changes behaviour. Ship it in a minor release with a changelog entry and a note in the guide's coordinate-systems page. Keep `transform: 'legacy'` for one minor release.
- **Downstream:** saved crosshair coordinates and ROI centres in world mm are reinterpreted only for the affected files. Grid-index-based state is unaffected.

## Open questions

1. Fallback: should neuroimjs use nibabel's base affine (B) or `diag(pixdim)` (C)? This ADR assumes B, because it gives both nibabel conformance and R parity. C is more literal to the spec.
2. Should neuroimjs warn when both codes are nonzero and the two transforms disagree beyond a tolerance, as some tools do?
3. The neuroim2 docstring says its rule matches "FSL, FreeSurfer, and ANTs" (`meta_info.R:143-145`). ANTs and ITK do *not* simply prefer the sform (see the table). The docstring should be corrected. Its use of "METHOD 1" for the centred, flipped affine (`nifti_io.R:561-565`) also conflicts with nifti1.h.
