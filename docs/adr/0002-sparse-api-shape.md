# ADR-0002: Sparse volume and vector representation

- **Status:** Proposed
- **Date:** 2026-10-03
- **Scope:** `SparseNeuroVol` (`src/sparse/`), `SparseNeuroVec` (`src/vec/`), the ROI/cluster `asSparse()` producers, `stats.split`

## Context

Both sparse classes keep their data in a JavaScript `Map`.

- **`SparseNeuroVol`** uses `Map<number, number>` keyed by linear voxel index (`src/sparse/SparseNeuroVol.ts:20`). The constructor already accepts parallel `indices`/`values` arrays and loads them into the map (`:24-47`). It drops every entry equal to `defaultValue` (`:42`, `:88`). Such a voxel still reads back as the default, but it is no longer in the support, so an ROI with explicit zeros loses those voxels from its index set. `getData()` builds a dense array (`:65-74`), and `getSlice` reads voxel by voxel through `getAt` (`:301-309`). It is created by `ROI.asSparse()` (`src/roi/ROI_improved.ts:148-158`, `:225`) and `ClusteredNeuroVol.asSparse()` (`src/volume/ClusteredNeuroVol.ts:350`). The `VolLayer` doc comment lists it as a supported source (`src/display/VolLayer.ts:28`).
- **`SparseNeuroVec`** uses `Map<number, number[]>`, one JavaScript array per voxel (`src/vec/SparseNeuroVec.ts:11-13`). `getData()` returns the map itself (`:47-49`), so it is the only `NeuroVec` whose `getData()` is not a typed array. `getSeries` returns the internal array by reference (`:84-92`), so a caller that mutates the result corrupts the vector. `stats.split` builds one from a `Float32Array` by copying it element by element into `number[]` (`src/stats/stats.ts:137-155`).

**neuroim2** is the R counterpart, and the two packages should interoperate:

- `SparseNeuroVol` is backed by `Matrix::sparseVector(x = data, i = indices, length = prod(dim))` (`neuroim2/R/neurovol.R:109-131`). That is a pair of sorted, 1-based index and value vectors, and `sparseVector` drops explicit zeros.
- `SparseNeuroVec` holds a `LogicalNeuroVol` mask, an `IndexLookupVol` map and a dense `data` matrix (`R/all_class.R:1174-1227`, `:941-947`). `prep_sparsenvec` normalizes the matrix to **time × voxels** (`R/sparse_neurovec.R:46-100`; allocated at `:96` as `matrix(0, nrow = dims[4], ncol = length(mask_idx))`). The voxel order is `which(mask)`, which is ascending column-major linear index (`:162`). Because R matrices are column-major, each voxel's time series is contiguous in memory. The sparse domain is defined by the mask, not by which values are nonzero, so explicit zeros are kept. (The `@slot data` doc at `all_class.R:1187-1189` still says rows are voxels, which no longer matches the code.)

**Measurements.** I ran a Node 26 micro-benchmark on an MNI 2 mm grid (N = 902,629 voxels) with K = 228,000 stored voxels, about one brain mask (script kept outside the repo; numbers are indicative only):

| | `Map<number, number>` | sorted `Int32Array` + `Float32Array` | + `Int32Array(N)` lookup |
|---|---|---|---|
| Memory | 9.4 MB | 1.8 MB | +3.6 MB |
| Iterate all values | 3.0 ms | 1.0 ms | — |
| 10⁶ random `get` | 58 ms | 366 ms (binary search) | 7.7 ms |
| Densify to `Float32Array(N)` | 7.1 ms | 1.5 ms | — |

For `SparseNeuroVec`, `number[]` series cost 8 bytes per sample plus an array header for each voxel, against 4 bytes in a packed `Float32Array`.

**Transport.** `ArrayBuffer` is transferable to workers without copying. `Map` is not, so structured clone copies it ([MDN: Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)). The searchlight worker pool (`src/searchlight/`) and any GPU upload need typed arrays. A map has to be densified or repacked first.

## Decision drivers

- Memory and throughput at whole-brain scale.
- Zero-copy transfer to workers and the GPU, and simple serialization (typed arrays map directly onto `.npy`, Arrow or raw binary).
- Lossless, low-friction round trips with neuroim2.
- Correct `NeuroVec` and `NeuroVol` contracts: typed `getData()`, no aliasing.
- Point edits (`setAt`) still have to work for interactive ROI drawing.

## Considered options

**A. Keep `Map`.** This makes `setAt` O(1) and needs no migration. The costs are 5× the memory, no transfer, slower bulk operations, a non-typed `getData()` on vectors, and no structural match with neuroim2.

**B. COO arrays.** Sorted `Int32Array` indices with a typed `values` array of the declared dtype, for both classes. This is compact and transferable, and densifying is a scatter. It matches `sparseVector` up to the 1-based offset. Random access needs either binary search, which is slow (see the table), or a lookup table built lazily. Insertion is O(K).

**C. neuroim2-style mask model.** A `LogicalNeuroVol` mask (or sorted indices), a lazily built `Int32Array(N)` index lookup, and a dense values block. For a vector the block is `Float32Array(K × T)` laid out voxel-major (offset `k*T + t`), which is exactly the memory order of neuroim2's T × K matrix. Series extraction is a `subarray` view, a volume is a strided gather, and interop with R needs no transpose. The support stays fixed once built.

**D. Hybrid.** Option B for `SparseNeuroVol` and option C for `SparseNeuroVec`. Edits go through a small mutable builder (`Map`-backed) that `freeze()`s to the packed form.

## Recommendation

Adopt **D**:

1. `SparseNeuroVol` stores sorted `indices: Int32Array` and `values: TypedArray` of its `dataType`. It builds the `Int32Array(N)` lookup on the first random access and frees it when asked. The support is the index set, so values equal to `defaultValue` are **kept**. This differs from neuroim2's `SparseNeuroVol`, whose `sparseVector` drops zeros, and matches its mask-based `SparseNeuroVec`. `setAt` on an index already in the support writes in place. A new index goes through `SparseVolBuilder`, or through an amortized rebuild with a documented O(K) cost.
2. `SparseNeuroVec` stores `indices` (equivalently a mask) and a `values` block of `K × T` with voxel-major contiguous series. `getData()` returns the dense `[X, Y, Z, T]` array, consistent with [ADR-0001](./0001-canonical-4d-layout.md). `getSeries` returns a copy, with `seriesView(k)` available for zero-copy access. Add `indices()`, `values()` and `fromMasked(mask, values, T)`.
3. Interop contract with neuroim2: indices are 0-based and column-major (x fastest), so `R index = JS index + 1`, the same order as `which(mask)`. The values block equals `as.vector(sparse_vec@data)`. Going from JS to an R `SparseNeuroVol` loses explicit zeros, because `sparseVector` drops them. Exporters should warn about this, or emit a mask.

## Consequences and migration

- The constructor signatures `(space, dataType, defaultValue, indices, values)` and `(space, voxelData: Map)` still work. The `Map` constructor of `SparseNeuroVec` repacks its input and is marked `@deprecated`.
- **Breaking:** `SparseNeuroVec.getData()` changes from returning a `Map` to returning a typed array. Provide `toMap()` for one release. `stats.split` gets simpler, because it can slice its `Float32Array` straight into the values block.
- **Behaviour change:** explicit default-valued entries are kept. `ROI.asSparse(0)` therefore keeps its support. Note this in the changelog.
- Display: `getSlice` can scatter from packed arrays, and it gets a fast path that iterates only the indices whose k equals the slice level.
- Tests: add round-trip fixtures against neuroim2 (export indices and values from R, compare in Vitest) and property tests that compare sparse and dense `getAt`, `getSlice` and `getVolume`.

## Open questions

1. Should the vector's support be stored as a `LogicalNeuroVol` mask, as neuroim2 does, or as raw indices? Raw indices are cheaper. A mask is richer, and `LogicalNeuroVol` already exists.
2. Should neuroimjs agree on an on-disk sparse format with neuroim2 (for example an HDF5 or Arrow layout of indices, values and the affine), or is NIfTI with a mask enough for now?
3. Do any external consumers depend on `SparseNeuroVec.getData()` returning a `Map`? Nothing in the repo does: `stats.split` constructs one but never calls `getData()`.
