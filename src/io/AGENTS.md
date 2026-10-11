<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# io

## Purpose
NIfTI I/O. Reads NIfTI-1 and NIfTI-2 (`.nii`, `.nii.gz`) and writes single-file NIfTI-1. Includes file-format descriptors and a header reader.

## Key Files

| File | Description |
|------|-------------|
| `io.ts` | Node decoder and writer: `readVol`, `writeVol`, `readHeader`, `readVolList`, `readVec`, `writeVec` (Node entry) |
| `browserNifti.ts` | Browser decoder: `readNiftiArrayBuffer` (browser entry only; `nifti-reader-js` is ESM-only) |
| `niftiGeometry.ts` | Helpers shared by both decoders: `niftiScaling` (scl_slope/scl_inter rules) and `affineVoxelSizes`. Internal |
| `nifti.ts` | Legacy aliases `read_vol` / `write_vol` (thin wrappers over `readVol` / `writeVol`) and re-exports |
| `formats.ts` | File-format descriptors by extension (`NIFTIFormat`, `NIFTIDualFormat`, `AFNIFormat`, `findDescriptor`, `getFormat`) |

## For AI Agents

### Working In This Directory
- There are two decoders, `io.ts` and `browserNifti.ts`. Any change to how headers are interpreted (scaling, voxel sizes, orientation) must go in `niftiGeometry.ts` or be made in both, and the conformance suite (`npm run test:conformance`) must keep passing.
- Gzip is detected from the bytes for `ArrayBuffer` input, and from the extension for paths. `writeVol`/`writeVec` gzip a `.nii.gz` path and not a `.nii` path (`resolveGzip`); `compress`/`format` that contradict a NIfTI extension throw `INVALID_ARGUMENT`. For other extensions, `compress` or `format: 'NIFTI_GZ'` decides.
- `readVec` returns a `BigNeuroVec` with the legacy time-first shape (`dim = [T, X, Y, Z]`); the 3D geometry is on `volumeSpace`.
- `writeVec` dispatches on the class (`niftiVecLayout`): `BigNeuroVec` time-first, `DenseNeuroVec`/`SparseNeuroVec` time-last, anything else `INVALID_ARGUMENT`. Never infer the layout from `dim`. Both writers go through `encodeNifti1` (qform + sform, `pixdim` from the affine; `qform_code` 0 for sheared affines, which a qform cannot represent).
- `NIFTIDualFormat` and `AFNIFormat` are descriptors only: there is no reader for `.hdr`/`.img` pairs or AFNI, and `writeVol` rejects them.

### Testing Requirements
- `tests/io.test.ts`, `tests/io.nifti.golden.test.ts`, `tests/io.readVec.geometry.test.ts`, `tests/io.write.compression.test.ts`, `tests/io.writeVec.layout.test.ts`.
- `npm run conformance:writers` (opt-in, needs uv) loads files written by `writeVol`/`writeVec` with nibabel.
- `tests/conformance/` compares both decoders with nibabel-generated fixtures (`npm run conformance:generate` regenerates them).

<!-- MANUAL: -->
