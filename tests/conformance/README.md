# nibabel conformance tests

These specs check that neuroimjs reads NIfTI files the way
[nibabel](https://nipy.org/nibabel/) does. They cover voxel values, scaling,
byte order, qform/sform selection, grid-to-world mapping, orientation, and
reorientation. Each committed fixture in `fixtures/nifti/` has an entry in
`fixtures/manifest.json`. Every expected value in that entry comes from
nibabel re-loading the exact committed bytes.

Running the tests needs no Python:

```bash
npm run test:conformance          # or: npx vitest --run tests/conformance
```

## What is checked

For every case, `nifti.conformance.test.ts` exercises both NIfTI decoders:

- **Node:** `readHeader`, `readVol` (every volume of a 4D file, from a path
  and from an `ArrayBuffer`) and `readVec` (4D cases).
- **Browser:** `readNiftiArrayBuffer` (`src/io/browserNifti.ts`).
- **Decoder parity:** a direct comparison of the two decoders, so any drift
  between them shows up even where nibabel itself has no opinion.

Geometry checks cover the affine, spacing, `gridToCoord` and `coordToGrid`
against `nibabel.affines.apply_affine`, axis codes against `aff2axcodes`, and
`NeuroSpace.reorient` to RAS+ against `as_closest_canonical`.

### Transform selection

nibabel's `get_best_affine` selects the transform as follows:

1. Use the sform if `sform_code != 0`.
2. Otherwise, use the qform if `qform_code != 0`.
3. Otherwise, use a centred base affine with x flipped.

neuroimjs gets its transform from nifti-reader-js, which applies a different
rule:

1. Use the qform if `qform_code > 0` and `sform_code < qform_code`.
2. Otherwise, use the sform if `sform_code > 0`.
3. Otherwise, use `diag(pixdim)` with a zero offset.

The two rules agree unless `qform_code > sform_code > 0`, or neither transform
is set. The test `readHeader: affine follows the documented neuroimjs
qform/sform rule` pins the neuroimjs behaviour for NIfTI-1. Where the result
differs from nibabel, the case is listed as a known discrepancy.

### Tolerances

| Quantity | Tolerance |
| --- | --- |
| Integer data, unscaled float data | exact |
| Scaled data decoded to Float32 (`readVol`, `readVec`) | 1e-6 × max(1, \|expected\|) |
| Scaled data decoded to Float64 (`readNiftiArrayBuffer`) | 1e-12 × max(1, \|expected\|) |
| Affines and world/grid coordinates | 1e-6 × max(1, \|expected\|) |

NIfTI-1 stores its transforms as float32. Both libraries evaluate the same
float32 parameters in double precision, so a real bug produces errors many
orders of magnitude larger than the 1e-6 tolerance.

### Known discrepancies

Mismatches with nibabel are recorded in the `KNOWN` table in
`nifti.conformance.test.ts`. Each entry gives a precise reason, and its check
runs as `it.fails`. When a fix lands, the `it.fails` test starts passing, which
vitest reports as a failure. That failure means the entry must be removed.
**Do not loosen a tolerance to make a mismatch pass.**

## Regenerating the fixtures

```bash
npm run conformance:generate
```

This command runs `scripts/conformance/generate.mjs`, which calls
`scripts/conformance/generate_nifti_fixtures.py` through `uv run` in a
throwaway environment. The pinned versions are Python 3.12, nibabel 5.3.2 and
numpy 2.1.3. Nothing is installed globally.

- **Finding uv:** the script looks for `uv` on `PATH`, then in
  `~/.local/bin/uv`. Set `UV=/path/to/uv` to use another copy.
- **Determinism:** gzip streams use `mtime=0`, and data comes from fixed
  seeds. Running the generator without changes reproduces the committed bytes
  exactly.
- **Recorded metadata:** the manifest stores the generator's SHA-256, the
  exact command, and the Python, nibabel and numpy versions.
- **Integrity check:** each case's fixture SHA-256 is checked by the tests.

To add a case, add an `add(...)` entry in `cases()` in the generator,
regenerate, and review the diff of `manifest.json`. Keep fixtures tiny. The
whole directory is currently about 250 KB, and the budget is 1.5 MB.

Out of scope for now:

- `int64`, complex and RGB datatypes, which neuroimjs does not decode.
- Analyze `.hdr`/`.img` pairs.
- Header extensions.
