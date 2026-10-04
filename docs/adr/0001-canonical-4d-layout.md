# ADR-0001: Canonical 4D layout and storage

- **Status:** Proposed
- **Date:** 2026-10-03
- **Scope:** `readVec`, `writeVec`, `BigNeuroVec`, `DenseNeuroVec`, every `NeuroVec` consumer

Line references are to `main` at v0.5.0 unless a branch is named.

## Context

neuroimjs has two 4D conventions, and the I/O entry point uses the minority one.

- **Time-first:** `readVec` always returns a `BigNeuroVec` (`src/io/io.ts:337-436`). Its `dim` is the backing shape `[T, X, Y, Z]` (`src/vector/BigNeuroVec.ts:360-362`). For 100 volumes or fewer, its 4D space is `new NeuroSpace([T, ...dim], [1, ...spacing], [0, ...origin])` (`io.ts:415-419`). For more than 100 volumes, or with `useBigVec`, `readVec` takes another path (`io.ts:371-398`). It creates `BigNeuroVec(tempFile, shape)` with unit spacing and zero origin (`BigNeuroVec.ts:272-276`), so spacing and origin are lost along with the affine. It copies each voxel with `setAt`, and it writes an unowned `${fileName}.bigvec.tmp` next to the input file (`io.ts:376`). `NeuroSpace` treats the first `min(ndim, 3)` axes as spatial (`src/geometry/NeuroSpace.ts:54`). That space therefore describes the axes T, X and Y, and the affine is lost. The nibabel conformance suite records this as `READVEC_AFFINE` (`git show fix/nifti-conformance:tests/conformance/nifti.conformance.test.ts`, lines 56-59 and 138-140). Open PR #15 (`fix/readvec-geometry`) keeps the legacy space and adds a correct 3D `volumeSpace` (`git show fix/readvec-geometry:src/vector/BigNeuroVec.ts`, lines 420-427, and `src/io/io.ts`, lines 392-399). That fixes geometry without fixing the layout.
- **Time-last:** `DenseNeuroVec` and its typed subclasses use `[X, Y, Z, T]` (`src/vec/NeuroVec.ts:141-153`). So do `SparseNeuroVec` (`src/vec/SparseNeuroVec.ts:71,138-148`), `FileBackedNeuroVec` (`src/vec/FileBackedNeuroVec.ts:90`), `MappedNeuroVec` (`src/vec/MappedNeuroVec.ts:122`), `NeuroHyperVec` (`src/hypervec/NeuroHyperVec.ts:285`) and `stats.split` (`src/stats/stats.ts:105`, "Time is the 4th dimension"). `DenseNeuroVec.getVolume` keeps the full affine through `space.withDimensions` (`NeuroVec.ts:109`, `NeuroSpace.ts:511-526`).

**The two layouts store the same bytes in the same order.** `BigNeuroVec` indexes `t*volSize + i + j*nx + k*nx*ny` (`BigNeuroVec.ts:451-456`). `DenseNeuroVec` indexes `i + j*dimX + k*dimX*dimY + t*volumeSize` (`NeuroVec.ts:152`). Both match NIfTI on-disk order, where `i` varies fastest and `dim[4]` is time ([nifti1.h](https://raw.githubusercontent.com/NIFTI-Imaging/nifti_clib/master/niftilib/nifti1.h)). Only the `dim` label differs, so changing the canonical layout needs no transpose.

The split already causes bugs that the type system cannot catch, because both classes satisfy `NeuroVec`:

1. `writeVec` passes `vec.dim` to `create4DNiftiHeader` (`io.ts:456-459`), which assumes time-first and reorders `[t,x,y,z]` to NIfTI order (`io.ts:881-885`). A time-last `Float32NeuroVec` passed to it would be written with dims `[Y, Z, T, X]` over unchanged bytes, with spacing permuted the same way. I found this by reading the code; I did not run it. `writeVec` also writes a diagonal affine (`io.ts:890-895`) and only the sform (`io.ts:1008`).
2. `stats.split` called on a `readVec` result would read `dim[3]`, which is Z, as time.
3. The guide shows `vec.space.dim // [x, y, z]` and `vec.length // number of time points` after `readVec` (`docs/guide/concepts.md:62-63`). On `main` the first array has four elements and starts with T, and `length` is the total voxel count.

**Storage.** `readVec` copies every volume into a `Float32Array` (`io.ts:423`; on the branch, `io.ts:386`), so int16 BOLD takes twice its native memory. `readVol` keeps the native dtype unless scaling is active (`io.ts:563-579`). Scaling is applied eagerly, to Float32 in the Node decoder (`io.ts:572`) and to Float64 in the browser decoder (`src/io/browserNifti.ts:74-86`). The same file therefore decodes to different precisions depending on the entry point. On `main`, `readVec` also re-reads and re-decompresses the file once per volume (`io.ts:382-388`, `:404-411`). PR #15 fixes that. When `BigNeuroVec` is built from data, it spills to a `TMPDIR` file (`BigNeuroVec.ts:317-343`). PR #15 adds `storage: 'memory'`.

**External conventions.** nibabel images are `(X, Y, Z, T)`, and `img.dataobj[..., t]` selects volume t ([images and memory](https://nipy.org/nibabel/images_and_memory.html)). `get_fdata()` returns scaled float64 ([DataobjImage](https://nipy.org/nibabel/reference/nibabel.dataobj_images.html)). The array proxy keeps the raw dtype and applies scaling lazily on access (`ArrayProxy._get_scaled` and `get_unscaled`, [arrayproxy.py](https://github.com/nipy/nibabel/blob/master/nibabel/arrayproxy.py)). neuroim2 4D spaces are `dim=c(x, y, z, t)` (`neuroim2/R/all_class.R:1215`).

## Decision drivers

- Correct geometry without per-class special cases.
- Agreement with NIfTI, nibabel, neuroim2 and the rest of neuroimjs.
- Zero-copy movement between readers, vectors, workers and GPU textures.
- Memory: a 1,000-TR run on the 2 mm MNI grid (91 × 109 × 91) is about 3.6 GB as Float32 and 1.8 GB as int16. On `main` such a run takes the temp-file path.
- `readVec` is labelled stable (`docs/guide/stability.md:47`), so changing `dim` is a breaking change.

## Considered options

**A. Status quo plus `volumeSpace` (PR #15).** This is the cheapest option and is non-breaking. However, both layouts stay behind one interface, and every consumer has to know which class it holds. The `writeVec` and `split` bugs remain possible.

**B. Canonical time-last; `readVec` returns a `DenseNeuroVec`.** Every in-repo consumer and every external reference already uses this layout. Because the memory order is identical, the change only relabels `dim`. The 4D `NeuroSpace` carries the affine through `withDimensions`. The cost is that code reading `dim[0]` as T silently gets X.

**C. Canonical time-first.** This would make every other 4D implementation in the repo wrong. It matches no external convention, and `NeuroSpace` would need a "spatial axes" concept. Rejected.

**D. Layout-agnostic metadata (`timeAxis`, named axes).** This is the most general option. It also adds the most API surface, and it defers the problem rather than resolving it. A named-axis `NeuroSpace` might be worth doing for 5D or later; it is not needed to fix 4D.

For storage:

- **S1.** Always Float32, as today.
- **S2.** Native dtype when unscaled and Float32 when scaled, which is `readVol`'s rule. This halves memory for typical int16 data.
- **S3.** Native dtype plus lazy `scl_slope`/`scl_inter`, applied in accessors, or in a shader as in [ADR-0003](./0003-slice-renderer-substrate.md). This saves the most memory and uploads compactly. The cost is that `getData()` has to say whether it returns raw or scaled values.

## Recommendation

1. Make **B** the canonical layout. Every `NeuroVec` reports `dim = [X, Y, Z, T]`, has a 4D `space` built with `withDimensions` from the volume space, and keeps the existing x-fastest, volume-contiguous memory order. Document this as a contract.
2. Use **S2** now, so that `readVec` and `readVol` agree. Make the two decoders agree on the precision of scaled data; I suggest Float32 by default, with Float64 opt-in. Plan **S3** as an explicit `{ scaling: 'lazy' }` option once the GPU path can use it. Do not make it the default.
3. Fix `writeVec` regardless of the layout decision. It should dispatch on the layout, write the full affine, and write both qform and sform, as `writeVol` already does (`io.ts:723-750`).

## Consequences and migration

- **0.6 (non-breaking):** Merge PR #15. Add `readVec(path, { layout: 'xyzt' })`, which returns a typed `DenseNeuroVec` of the native dtype. Add `timeAxis: 0 | 3` and `volumeSpace` to both classes so that consumers can write layout-safe code. Mark time-first `BigNeuroVec` `@deprecated`. Have `readVec` without `layout` log one deprecation warning through the category logger.
- **Breaking release (1.0, or 0.7 if the maintainer treats 0.x minors as breaking):** `xyzt` becomes the default. `BigNeuroVec` either becomes a time-last file-backed class, overlapping with `FileBackedNeuroVec`, or is removed. `layout: 'txyz'` stays for one release.
- **Consumer impact:** Code that indexes `dim[0]` as T, or that slices `space.spacing`/`origin` from index 1, breaks. Code that uses only `getAt(i, j, k, t)`, `getSeries`, `getVolume` and `getData()` does not, because the argument order and the bytes are unchanged.
- **Tests:** The conformance `readVec` checks and `tests/io.readVec.geometry.test.ts` (on the branch) should assert the time-last `space` once the default flips.

## Open questions

1. Should `readVec` use 0.x semver freedom and flip at 0.7, or wait for 1.0?
2. Is `BigNeuroVec` still worth keeping once `FileBackedNeuroVec` and `MappedNeuroVec` exist, or should it be folded into one of them?
3. Should Float32 or Float64 be the default precision for scaled data in both decoders? nibabel's `get_fdata` returns float64.
