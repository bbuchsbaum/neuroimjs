# Stability & Roadmap

neuroimjs is at **`0.5.0`** — pre-1.0, so minor releases may still change APIs, and the library is actively hardening toward 1.0. This page is the single source of truth for what you can build on. The statuses below were **verified against the source and a green unit suite as of 0.5.0**, not just an audit snapshot. Several known issues are still open; they are flagged in the tables and listed in the [roadmap](#roadmap).

Legend:

<span class="stability-badge stable">stable</span> — solid, tested, safe to depend on. &nbsp;
<span class="stability-badge experimental">known issue</span> — works in the common case but has a confirmed bug or limitation; verify for your data. &nbsp;
<span class="stability-badge aspirational">unavailable</span> — not implemented yet; don't use.

## Recently fixed ✅

These were correctness bugs in earlier drafts of the library and are **now fixed**, with tests guarding them. If older docs or comments still warn about them, those notes are out of date:

- **NIfTI intensity scaling on read** — `readVol` and `readNiftiArrayBuffer` apply `scl_slope` / `scl_inter`. A slope of 0 or a non-finite slope means no scaling: both fields are ignored, as the NIfTI spec and nibabel require.
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
| `VolLayer` / `VolStack` | <span class="stability-badge stable">stable</span> | Multi-layer compositing; layers on different grids are aligned in world space by default. See [Multi-Layer Alignment](/guide/alignment). |
| `OrthogonalImageViewer` | <span class="stability-badge stable">stable</span> | Lower-level; prefer `SimpleOrthogonalViewer`. |
| `LayerControlPanel` / `OverlayReviewPanel` | <span class="stability-badge stable">stable</span> | Lit web components; covered by unit tests. Exported from `neuroimjs/browser` only. |
| `SubjectOverlayViewer` | <span class="stability-badge stable">stable</span> | Covered by unit tests; `neuroimjs/browser` only. See [Overlay review](/guide/controls#overlay-review-subjectoverlayviewer-overlayreviewpanel). |
| `SimpleOrthogonalViewer.toDataURL()` | <span class="stability-badge stable">stable</span> | Renders the view before reading the canvas back, so exports are no longer blank. |
| `DepthEnhancedLayer` | <span class="stability-badge experimental">known issue</span> | Experimental visual effect with no dedicated tests. It draws above the current slice, and its parallax is inactive because views do not dispatch pointer events to layers; see [DepthEnhancedLayer](/guide/custom-layers#depthenhancedlayer). |
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
| `readVol` / `readVolList` | <span class="stability-badge stable">stable</span> | NIfTI-1 and NIfTI-2, `.nii` and `.nii.gz`. Applies intensity scaling, byte-swaps big-endian data, and takes `space.spacing` from the affine. `readVolList` takes a list of paths. Checked against nibabel-generated fixtures (`npm run test:conformance`). Known discrepancies: unscaled `UINT32` files throw `Unsupported TypedArray type`; unscaled `UINT16` files load as `UInt16NeuroVol`, but slicing one throws, so convert to float before display; the qform wins when `qform_code > sform_code > 0` (nibabel prefers the sform); files with no transform get `diag(pixdim)`, not nibabel's base affine; NIfTI-2 qform-only files throw. See the [conformance notes](https://github.com/bbuchsbaum/neuroimjs/blob/main/tests/conformance/README.md). |
| `readHeader` | <span class="stability-badge stable">stable</span> | Raw header fields; `spacing` is the raw `pixdim[1..3]`. |
| `writeVol` (3D) | <span class="stability-badge stable">stable</span> | NIfTI-1 single file; round-trips covered by tests. Pass `{ compress: true }` (or `format: 'NIFTI_GZ'`) for gzip — a `.gz` name alone writes raw bytes (bug, tracked: mote bd-01M4298YPGHKDWBSV61RAMF2VB). |
| `writeVec` (4D) | <span class="stability-badge experimental">known issue</span> | Assumes time-first `[T,X,Y,Z]` vecs; an `[X,Y,Z,T]` vec gets permuted header dims, and only an axis-aligned sform is written. See [I/O](/guide/io). |
| `readNiftiArrayBuffer` (browser) | <span class="stability-badge stable">stable</span> | NIfTI-1/2, `.nii` and `.nii.gz`, 3D or one frame of 4D. See [Getting Started](/guide/getting-started). Same scaling, byte-order and transform-selection rules as `readVol`, but scaled data are Float64 (not Float32). `UINT16` files load as `UInt16NeuroVol`, but slicing one throws, so convert to float before display. `UINT32` is promoted to `Float64NeuroVol`. |
| NIfTI dual-file (`.hdr`/`.img`) | <span class="stability-badge aspirational">unavailable</span> | A format descriptor exists, but `readVol` cannot read the pair and `writeVol` rejects the format. |
| AFNI (`.HEAD`/`.BRIK`) | <span class="stability-badge aspirational">unavailable</span> | Only a format descriptor (`AFNIFormat`) used for file-name matching. There is no AFNI reader or writer. |

## Volumes & 4D/5D

| Feature | Status | Notes |
|---|---|---|
| `DenseNeuroVol` & typed subclasses | <span class="stability-badge stable">stable</span> | |
| `SparseNeuroVol`, `ClusteredNeuroVol`, `LogicalNeuroVol` | <span class="stability-badge stable">stable</span> | |
| Volume arithmetic (`addVol`, `meanVol`, …) | <span class="stability-badge stable">stable</span> | |
| `getRange()` | <span class="stability-badge stable">stable</span> | ±Infinity init, NaN-safe. |
| `NeuroVec` (4D) + `temporalFilter` / `detrend` | <span class="stability-badge stable">stable</span> | Preprocessing lives on the enhanced vec classes. |
| `BigNeuroVec` / `readVec` | <span class="stability-badge stable">stable</span> | `readVec` decodes the file once and holds it in memory (no temp file). It keeps the legacy time-first shape (`dim = [T, X, Y, Z]`), so `vec.space` does not describe the image grid; the 3D geometry, including the affine, is on `volumeSpace` and on every `getVolume(t)`. `mask` is ignored. See [Time Series](/guide/time-series#bigneurovec-what-readvec-returns). |
| `FileBackedNeuroVec` | <span class="stability-badge experimental">known issue</span> | Loads volumes on demand through a callback you supply, with an LRU cache. It does not open files itself. |
| `MappedNeuroVec` | <span class="stability-badge experimental">known issue</span> | Reads through a `DataView` over an `ArrayBuffer` you supply. It is not a memory-mapped file. |
| `NeuroHyperVec` (5D+) core | <span class="stability-badge experimental">known issue</span> | Container, indexing and concat work. `reduce()` overflows the stack beyond a few thousand outputs; `getSubVolume` with two free named axes silently uses the first, and any spatial key (`x`, `y`, `z`) in the index spec throws. See [Time Series](/guide/time-series). |
| `DenseNeuroHyperVec.glm`, `extractFeatures`, `save` | <span class="stability-badge aspirational">unavailable</span> | Throw "not yet implemented". |

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
| `NeuroAtlas` (`loadGlasserAtlas`, `loadSchaeferAtlas`, `loadAtlas`) | <span class="stability-badge experimental">known issue</span> | Glasser and Schaefer download their files from GitHub at run time. |
| `concat` | <span class="stability-badge experimental">known issue</span> | Drops the input affine (keeps dims, spacing, origin only); use `createReviewVecFromVolumes` when geometry matters. |

## Not yet available

These appear in some older README snippets but **do not exist** — use the alternatives:

| Doesn't exist | Use instead |
|---|---|
| `VolStack.fromNifti(url)` | The loader in [Getting Started](/guide/getting-started) → `new VolStack(layer)` |
| `NeuroVec.fromNifti(url)` | `readVec(fileName)` in Node, or `readNiftiArrayBuffer(buffer, { index })` per frame in the browser |
| `import … from 'neuroimjs/display'` | The viewers come from `neuroimjs/browser` (or `neuroimjs`). The only sub-paths are `neuroimjs/browser` and the viewer-free [`neuroimjs/io`, `neuroimjs/slices` and `neuroimjs/geometry`](/guide/io#viewer-free-imports). |

## Done since earlier drafts

Packaging and test-runner integrity (e2e excluded from the unit run, test files kept out of the published tarball, `TestVolumeFactory` no longer exported, types-first `exports`, lint restored), clustering determinism (k-means now uses a seeded k-means++ initialization), and the separable Gaussian blur are **done**.

## Roadmap

The unit suite is green, but that does not mean only cleanup remains. In priority order:

1. **Fix the flagged known issues** — the user-facing correctness bugs in the tables above: `writeVec` layout and affine, `NeuroHyperVec.reduce()` stack overflow and `getSubVolume` index specs, `edgeDetection('canny')`, searchlight sphere membership, `splitReduce`, `concat` dropping the affine, connected components and `StatFunctions.median` with NaN, morphology with NaN, `UINT16` slicing and unscaled `UINT32` reads, the NIfTI transform-selection discrepancies listed under I/O, and the viewer `onReady` / layer pointer / `showIntensityReadout` gaps.
2. **Missing readers** — dual-file NIfTI and AFNI.
3. **Consolidation** — some duplicate NIfTI / viewer / ROI implementations from earlier accretion still coexist. They work; they'll be merged behind the current APIs. Two merges are breaking and deferred to a major version: unifying the `NeuroVec` and `INeuroVec` interfaces, and coordinating `SimpleOrthogonalViewer` (MobX) and `ViewSynchronizer` (events) the same way. `readVec`'s legacy time-first shape is kept for compatibility.
4. **Hygiene** — dead-code removal.

::: tip Found something off?
If a feature marked <span class="stability-badge stable">stable</span> misbehaves, please [open an issue](https://github.com/bbuchsbaum/neuroimjs/issues) with a minimal repro — that's exactly what moves us to 1.0.
:::
