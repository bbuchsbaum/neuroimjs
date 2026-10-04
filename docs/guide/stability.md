# Stability & Roadmap

neuroimjs is pre-1.0; the current release is in the 0.5 series. Minor releases may still change the API, and every change is recorded in the [changelog](https://github.com/bbuchsbaum/neuroimjs/blob/main/CHANGELOG.md). This page gives the status of each module as of that release, checked against the source.

Legend:

<span class="stability-badge stable">stable</span> — implemented and tested; safe to depend on. &nbsp;
<span class="stability-badge experimental">experimental</span> — works, but partial, lightly tested, or likely to change; check it on your data. &nbsp;
<span class="stability-badge aspirational">unavailable</span> — not implemented; a descriptor or stub exists but does not do the job.

## I/O

| Feature | Status | Notes |
|---|---|---|
| `readVol` (Node: path or `ArrayBuffer`) | <span class="stability-badge stable">stable</span> | NIfTI-1 and NIfTI-2, `.nii` and `.nii.gz`. Applies `scl_slope`/`scl_inter` (a zero or non-finite slope means no scaling), byte-swaps big-endian data, and takes `space.spacing` from the affine. Checked against nibabel-generated fixtures (`npm run test:conformance`). |
| `readNiftiArrayBuffer` (browser) | <span class="stability-badge stable">stable</span> | The browser loader; same scaling, byte-order and geometry rules as `readVol`. See [Loading data in the browser](/guide/io#loading-data-in-the-browser). |
| `readHeader` | <span class="stability-badge stable">stable</span> | Raw header fields; `spacing` is the raw `pixdim[1..3]`. |
| `readVolList` | <span class="stability-badge stable">stable</span> | Reads a list of files, one `readVol` each. |
| `readVec` | <span class="stability-badge stable">stable</span> | 4D in memory. Keeps the legacy time-first shape (`dim = [T, X, Y, Z]`); the 3D geometry is on `volumeSpace`. `mask` is ignored. |
| `writeVol` / `writeVec` | <span class="stability-badge stable">stable</span> | NIfTI-1 single file. Gzip only when you pass `{ compress: true }`; a `.gz` extension alone does not compress. |
| NIfTI dual-file (`.hdr`/`.img`) | <span class="stability-badge aspirational">unavailable</span> | A format descriptor exists, but `readVol` cannot read the pair and `writeVol` rejects the format. |
| AFNI (`.HEAD`/`.BRIK`) | <span class="stability-badge aspirational">unavailable</span> | Only a format descriptor (`AFNIFormat`) used for file-name matching. There is no AFNI reader or writer. |

## Volumes and 4D/5D data

| Feature | Status | Notes |
|---|---|---|
| `NeuroSpace`, grid ↔ world transforms, `reorient()` | <span class="stability-badge stable">stable</span> | `reorient()` preserves world coordinates. |
| `DenseNeuroVol` and typed subclasses | <span class="stability-badge stable">stable</span> | |
| `SparseNeuroVol`, `ClusteredNeuroVol`, `LogicalNeuroVol` | <span class="stability-badge stable">stable</span> | |
| Volume arithmetic (`addVol`, `greaterThan`, `mapVol`, …) | <span class="stability-badge stable">stable</span> | |
| `getVolumeGeometry`, `assertSameVolumeGeometry` | <span class="stability-badge stable">stable</span> | JSON-safe geometry and a strict same-grid check. |
| `extractOrthogonalSlices` and the per-plane extractors | <span class="stability-badge stable">stable</span> | |
| `NeuroVec`, `DenseNeuroVec`, typed variants | <span class="stability-badge stable">stable</span> | |
| `EnhancedDenseNeuroVec` (`detrend`, `temporalFilter`) | <span class="stability-badge stable">stable</span> | Real per-voxel temporal filtering. |
| `BigNeuroVec` | <span class="stability-badge stable">stable</span> | In memory (`storage: 'memory'`) or backed by a file. |
| `FileBackedNeuroVec` | <span class="stability-badge experimental">experimental</span> | Loads volumes on demand through a callback you supply, with an LRU cache. It does not open files itself. |
| `MappedNeuroVec` | <span class="stability-badge experimental">experimental</span> | Reads through a `DataView` over an `ArrayBuffer` you supply. It is not a memory-mapped file. |
| `DenseNeuroHyperVec` (5D+) core | <span class="stability-badge experimental">experimental</span> | Construction, indexing, `getSubVolume`, `reduce`, `concat`, `split`, `permute`, `view`. |
| `DenseNeuroHyperVec.glm`, `extractFeatures`, `save` | <span class="stability-badge aspirational">unavailable</span> | Throw "not yet implemented". |

## Processing and analysis

| Feature | Status | Notes |
|---|---|---|
| `SpatialFilter`: Gaussian, bilateral, guided, median, morphology | <span class="stability-badge stable">stable</span> | Gaussian blur is separable (three 1D passes). |
| `SpatialFilter.edgeDetection('canny')` | <span class="stability-badge experimental">experimental</span> | Falls back to Sobel with a console warning. |
| `Resampler` (nearest, linear, cubic, Lanczos), `transform()` | <span class="stability-badge stable">stable</span> | Cubic/Lanczos extrapolate linearly at the volume boundary. |
| Searchlights (`searchlightIterator`, `randomSearchlight`, …) | <span class="stability-badge stable">stable</span> | Radius in mm, spacing-aware. Random variants take `{ seed }` or `{ rng }`. |
| ROIs (`sphericalROI`, `cuboidROI`, `roiFromMask`, …) | <span class="stability-badge stable">stable</span> | |
| `ConnectedComponents`, `clusterTable`, `localMaxima` | <span class="stability-badge stable">stable</span> | |
| `StatFunctions`, `partition`, `splitClusters`, `centroids` | <span class="stability-badge stable">stable</span> | `partition` k-means uses a seeded k-means++ start. |
| `NeuroAtlas` (`loadGlasserAtlas`, `loadSchaeferAtlas`, `loadAtlas`) | <span class="stability-badge experimental">experimental</span> | Glasser and Schaefer download their files from GitHub at run time. |

## Visualization

| Feature | Status | Notes |
|---|---|---|
| `SimpleOrthogonalViewer` | <span class="stability-badge stable">stable</span> | The recommended 3-view viewer. |
| `SingleSliceViewer` + `ViewSynchronizer` | <span class="stability-badge stable">stable</span> | Composable views for custom layouts. |
| `ColorMap` / `ColorMapFactory` | <span class="stability-badge stable">stable</span> | Non-finite voxels render transparent. |
| `VolLayer` / `VolStack`, `'world'` alignment | <span class="stability-badge stable">stable</span> | See [Multi-Layer Alignment](/guide/alignment). |
| `OrthogonalImageViewer` | <span class="stability-badge stable">stable</span> | Lower-level; prefer `SimpleOrthogonalViewer`. |
| Overlay review (`SubjectOverlayViewer`, `OverlayReviewPanel`, summary statistics) | <span class="stability-badge experimental">experimental</span> | New; browser entry only for the viewer and panel. See [Group Overlay Review](/guide/overlay-review). |
| `DepthEnhancedLayer` | <span class="stability-badge experimental">experimental</span> | Visual effect; see [depth cues](/guide/composable-views#depth-cues). |

## APIs that do not exist

Older snippets elsewhere on the web may use these. They were never part of the library:

| Doesn't exist | Use instead |
|---|---|
| `VolStack.fromNifti(url)` | `readNiftiArrayBuffer` (browser) or `readVol` (Node), then `new VolStack(new VolLayer(…))` |
| `NeuroVec.fromNifti(url)` | `readVec(path)` (Node) |
| `import … from 'neuroimjs/display'` and other sub-paths | `neuroimjs` (Node) or `neuroimjs/browser` |

## Roadmap

Known structural work before 1.0, none of which changes results today:

1. **Interfaces** — `NeuroVec` and `INeuroVec` are separate interfaces; unifying them is a breaking change, deferred to a major version.
2. **Viewer coordination** — `SimpleOrthogonalViewer` coordinates its views through MobX, `ViewSynchronizer` through events. Merging them is also deferred to a major version.
3. **`readVec` shape** — `readVec` returns the legacy time-first shape for compatibility; `volumeSpace` carries the spatial geometry.
4. **Missing readers** — dual-file NIfTI and AFNI.

::: tip Found something off?
If a feature marked <span class="stability-badge stable">stable</span> misbehaves, please [open an issue](https://github.com/bbuchsbaum/neuroimjs/issues) with a minimal repro.
:::
