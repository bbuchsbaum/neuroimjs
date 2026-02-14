<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# io

## Purpose
File I/O for neuroimaging formats. Primary support for NIfTI-1/NIfTI-2 with gzip compression. Includes format detection and a higher-level API for reading volumes, vectors, and headers.

## Key Files

| File | Description |
|------|-------------|
| `nifti.ts` | Low-level NIfTI read/write: `read_vol`, `write_vol` with pako gzip support |
| `io.ts` | High-level API: `readVol`, `writeVol`, `readHeader`, `readVolList`, `readVec`, `writeVec` |
| `formats.ts` | Format detection (`findDescriptor`, `getFormat`) and format adapters (`NIFTIFormat`, `AFNIFormat`) |

## For AI Agents

### Working In This Directory
- `nifti.ts` uses `nifti-reader-js` for parsing and `pako` for gzip compression/decompression.
- `io.ts` wraps `nifti.ts` with a friendlier API and adds support for multiple formats via `formats.ts`.
- NIfTI files can be `.nii` (uncompressed) or `.nii.gz` (gzip). Both are handled transparently.
- In browser context, file reading uses `fetch` + `ArrayBuffer`. In Node, uses `fs.readFileSync`.
- AFNI format support is partial — NIfTI is the primary target.

### Testing Requirements
- Tests in `tests/io.test.ts` — round-trip read/write with the MNI152 template.
- Test both compressed and uncompressed NIfTI files.

<!-- MANUAL: -->
