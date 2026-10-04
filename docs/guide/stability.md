# Stability & Roadmap

neuroimjs is at **`0.5.0`** — pre-1.0, so minor releases may still change APIs, and the library is actively hardening toward 1.0. This page is the single source of truth for what you can build on. The statuses below were **verified against the source and a green unit suite as of 0.5.0**, not just an audit snapshot. Several known issues are still open; they are flagged in the tables and listed in the [roadmap](#roadmap).

Legend:

<span class="stability-badge stable">stable</span> — solid, tested, safe to depend on. &nbsp;
<span class="stability-badge experimental">known issue</span> — works in the common case but has a confirmed bug or limitation; verify for your data. &nbsp;
<span class="stability-badge aspirational">unavailable</span> — not implemented yet; don't use.

## Recently fixed ✅

These were correctness bugs in earlier drafts of the library and are **now fixed**, with tests guarding them. If older docs or comments still warn about them, those notes are out of date:

- **NIfTI intensity scaling on read** — `readVol` now applies `scl_slope` / `scl_inter`. A slope of 0 (or NaN) is treated as 1. A non-zero `scl_inter` is still added in that case, although the NIfTI spec says to ignore both fields when the slope is 0.
- **NIfTI big-endian data** — big-endian image data is byte-swapped on read.
- **`NeuroSpace.reorient()`** — preserves world coordinates (the reoriented affine is composed correctly).
- **`getSliceAt()` / live crosshair** — samples through the reoriented grid; no more identity-transform slices.
- **Colormap NaN handling** — non-finite voxels render transparent, not opaque black.
- **`getRange` / `dilate` / `erode`** — use ±Infinity instead of the old `Number.MIN_VALUE` min/max bug. `getRange` also skips NaN. `dilate` / `erode` do not: a NaN voxel turns its whole neighbourhood into NaN.
- **`Resampler.transform()`** — implemented (builds the transform matrix and resamples); no longer a no-op.
- **Cubic/Lanczos resampling at volume boundaries** — boundary taps are linearly extrapolated, fixing the old outer-voxel bias.
- **`temporalFilter()`** — performs real per-voxel temporal filtering; no longer a silent no-op.
- **`sphericalROI` / searchlight radius** — radius is interpreted in **mm** and is spacing-aware per axis (anisotropy-correct).

## Visualization

| Feature | Status | Notes |
|---|---|---|
| `SimpleOrthogonalViewer` | <span class="stability-badge stable">stable</span> | Headline 3-view viewer. |
| `SingleSliceViewer` + `ViewSynchronizer` | <span class="stability-badge stable">stable</span> | Composable views for custom layouts. |
| `ColorMap` / `ColorMapFactory` | <span class="stability-badge stable">stable</span> | Presets + custom gradients; non-finite → transparent. |
| `VolLayer` / `VolStack` | <span class="stability-badge stable">stable</span> | Multi-layer compositing. |
| `LayerControlPanel` / `OverlayReviewPanel` | <span class="stability-badge stable">stable</span> | Lit web components; covered by unit tests. |
| `SimpleOrthogonalViewer.toDataURL()` | <span class="stability-badge stable">stable</span> | Renders the view before reading the canvas back, so exports are no longer blank. |
| `DepthEnhancedLayer` | <span class="stability-badge experimental">known issue</span> | Experimental visual effect with no dedicated tests. |
| `showIntensityReadout` option | <span class="stability-badge experimental">known issue</span> | On `SimpleOrthogonalViewer` the option is accepted but ignored. On `SingleSliceViewer` it adds the readout layer, but nothing updates it, so it stays blank. Build a readout from `onCoordChange` + `getValue`. |
| `SliceLayer` pointer handlers | <span class="stability-badge experimental">known issue</span> | `onPointerMove` / `onPointerDown` on a custom layer are never called; nothing dispatches pointer events to layers yet. Use `SingleSliceViewer.onPointerMove` / `onPointerDown` instead. |
| `onReady()` / `'ready'` event | <span class="stability-badge experimental">known issue</span> | Emitted inside `create()` before it returns, so a handler registered on the returned viewer never fires. Treat the resolved `create()` promise as "ready". |

## Geometry & coordinates

| Feature | Status | Notes |
|---|---|---|
| `NeuroSpace` grid ↔ world transforms | <span class="stability-badge stable">stable</span> | |
| `NeuroSpace.reorient()` | <span class="stability-badge stable">stable</span> | Preserves world coordinates. |
| `getSliceAt` / crosshair slicing | <span class="stability-badge stable">stable</span> | Reoriented sampling. |

## I/O (NIfTI)

| Feature | Status | Notes |
|---|---|---|
| `readVol` / `readVolList` | <span class="stability-badge stable">stable</span> | Applies intensity scaling; handles endianness. Unscaled `UINT16` and `UINT32` files throw `Unsupported TypedArray type`. |
| `writeVol` (3D) | <span class="stability-badge stable">stable</span> | Round-trips covered by tests. Pass `{ compress: true }` (or `format: 'NIFTI_GZ'`) for gzip — a `.gz` name alone writes raw bytes. |
| `writeVec` (4D) | <span class="stability-badge experimental">known issue</span> | Assumes time-first `[T,X,Y,Z]` vecs; an `[X,Y,Z,T]` vec gets permuted header dims, and only an axis-aligned sform is written. See [I/O](/guide/io). |
| `readNiftiArrayBuffer` (browser) | <span class="stability-badge stable">stable</span> | NIfTI-1/2, `.nii` and `.nii.gz`, 3D or one frame of 4D. See [Getting Started](/guide/getting-started). `UINT16` files load as `UInt16NeuroVol`, but slicing one throws, so convert to float before display. `UINT32` is promoted to `Float64NeuroVol`. |
| AFNI (`.HEAD`/`.BRIK`) | <span class="stability-badge experimental">known issue</span> | Limited / experimental; NIfTI is the supported path. |

## Volumes & 4D/5D

| Feature | Status | Notes |
|---|---|---|
| `DenseNeuroVol` & typed subclasses | <span class="stability-badge stable">stable</span> | |
| `SparseNeuroVol`, `ClusteredNeuroVol`, `LogicalNeuroVol` | <span class="stability-badge stable">stable</span> | |
| Volume arithmetic (`addVol`, `meanVol`, …) | <span class="stability-badge stable">stable</span> | |
| `getRange()` | <span class="stability-badge stable">stable</span> | ±Infinity init, NaN-safe. |
| `NeuroVec` (4D) + `temporalFilter` / `detrend` | <span class="stability-badge stable">stable</span> | Preprocessing lives on the enhanced vec classes. |
| `BigNeuroVec` / `readVec` | <span class="stability-badge experimental">known issue</span> | Correct values, but held fully in memory (not memory-mapped), and `readVec` re-decodes the file once per frame. Geometry is lost: up to 100 frames, the 4D space keeps spacing and origin but drops the affine; above 100 frames (or with `useBigVec: true`), spacing becomes `[1, 1, 1, 1]` and origin `[0, 0, 0, 0]`. See [Time Series](/guide/time-series#bigneurovec-what-readvec-returns). |
| `NeuroHyperVec` (5D+) core | <span class="stability-badge experimental">known issue</span> | Container, indexing and concat work. `reduce()` overflows the stack beyond a few thousand outputs; `getSubVolume` with two free named axes silently uses the first, and any spatial key (`x`, `y`, `z`) in the index spec throws. See [Time Series](/guide/time-series). |
| `NeuroHyperVec` advanced ops (GLM, etc.) | <span class="stability-badge experimental">known issue</span> | Advanced/experimental — verify before relying on them. |

## Processing & analysis

| Feature | Status | Notes |
|---|---|---|
| Bilateral / guided filtering | <span class="stability-badge stable">stable</span> | He et al.; numerically faithful. |
| Gaussian blur | <span class="stability-badge stable">stable</span> | Separable (three 1-D passes). Sigma is in voxels, not mm. |
| Median / morphology / anisotropic diffusion | <span class="stability-badge stable">stable</span> | Radii in voxels. `dilate` / `erode` propagate NaN to every neighbour. |
| `edgeDetection('canny')` | <span class="stability-badge experimental">known issue</span> | Not implemented: warns and returns the Sobel magnitude. |
| `Resampler` (nearest/linear) | <span class="stability-badge stable">stable</span> | |
| `Resampler.transform()` | <span class="stability-badge stable">stable</span> | Implemented. |
| `Resampler` cubic/Lanczos at volume boundaries | <span class="stability-badge stable">stable</span> | Boundary taps are linearly extrapolated; edge-bias regression tests cover low/high edges and corners. |
| Connected components / `clusterTable` / `localMaxima` | <span class="stability-badge experimental">known issue</span> | One-sided (`>= threshold`); mask voxels must equal `1`; labels and sizes stored as `Int16`. In-mask `NaN` voxels seed clusters (and pull in suprathreshold neighbours, with `maxValue` `NaN`); remove them from the mask first. |
| `StatFunctions` (mean/sum/min/max/std/median) | <span class="stability-badge stable">stable</span> | `mean`/`min`/`max`/`std` skip NaN (`std` uses n − 1). `sum` returns NaN; `median` returns an arbitrary value, not NaN, because NaN breaks the sort. |
| Group statistics (`computeSufficientStats`, t / Welch / paired / consistency maps, `OverlaySummaryService`) | <span class="stability-badge stable">stable</span> | Compensated two-pass sums; non-finite values skipped per voxel. See [Group Statistics](/guide/group-stats). |
| `OverlayReviewSession` / `createReviewVecFromVolumes` | <span class="stability-badge stable">stable</span> | Validates geometry across subjects and contrasts. |
| `sphericalROI` / searchlight radius | <span class="stability-badge stable">stable</span> | mm-based, spacing-aware (anisotropy-correct). |
| Searchlight sphere membership | <span class="stability-badge experimental">known issue</span> | Spheres are not clipped to the mask (`nonzero` restricts centres only); filter `indices()` yourself. Window `.data` is all `1`s. |
| `splitReduce` | <span class="stability-badge experimental">known issue</span> | Returns one volume: the mean of the per-level reductions, not one map per level. The output space keeps dims, spacing and origin only, dropping axes and affine. |
| `concat` | <span class="stability-badge experimental">known issue</span> | Drops the input affine (keeps dims, spacing, origin only); use `createReviewVecFromVolumes` when geometry matters. |

## Not yet available

These appear in some older README snippets but **do not exist** — use the alternatives:

| Doesn't exist | Use instead |
|---|---|
| `VolStack.fromNifti(url)` | The loader in [Getting Started](/guide/getting-started) → `new VolStack(layer)` |
| `NeuroVec.fromNifti(url)` | `readVec(fileName)` in Node, or `readNiftiArrayBuffer(buffer, { index })` per frame in the browser |

## Done since earlier drafts

Packaging and test-runner integrity (e2e excluded from the unit run, test files kept out of the published tarball, `TestVolumeFactory` no longer exported, types-first `exports`, lint restored), clustering determinism (k-means now uses a seeded k-means++ initialization), and the separable Gaussian blur are **done**.

## Roadmap

The unit suite is green, but that does not mean only cleanup remains. In priority order:

1. **Fix the flagged known issues** — the user-facing correctness bugs in the tables above: `writeVec` layout and affine, `readVec` geometry, `NeuroHyperVec.reduce()` stack overflow and `getSubVolume` index specs, `edgeDetection('canny')`, searchlight sphere membership, `splitReduce`, `concat` dropping the affine, connected components and `StatFunctions.median` with NaN, morphology with NaN, unscaled `UINT16`/`UINT32` reads, and the viewer `onReady` / layer pointer / `showIntensityReadout` gaps.
2. **Consolidation** — some duplicate NIfTI / viewer / ROI implementations from earlier accretion still coexist. They work; they'll be merged behind the current APIs.
3. **Hygiene** — dead-code removal.

::: tip Found something off?
If a feature marked <span class="stability-badge stable">stable</span> misbehaves, please [open an issue](https://github.com/bbuchsbaum/neuroimjs/issues) with a minimal repro — that's exactly what moves us to 1.0.
:::
