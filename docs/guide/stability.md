# Stability & Roadmap

neuroimjs is **`0.1.0`** — pre-1.0, and actively hardening toward 1.0. This page is the single source of truth for what you can build on. Unlike a static changelog, the statuses below were **verified against the current source and a fully green test suite** (962 passing at the time of writing), not just an audit snapshot.

Legend:

<span class="stability-badge stable">stable</span> — solid, tested, safe to depend on. &nbsp;
<span class="stability-badge experimental">known issue</span> — works in the common case but has a confirmed bug or limitation; verify for your data. &nbsp;
<span class="stability-badge aspirational">unavailable</span> — not implemented yet; don't use.

## Recently fixed ✅

These were correctness bugs in earlier drafts of the library and are **now fixed**, with tests guarding them. If older docs or comments still warn about them, those notes are out of date:

- **NIfTI intensity scaling on read** — `readVol` now applies `scl_slope` / `scl_inter` (spec-correct, including the "slope 0 = no scaling" rule).
- **NIfTI big-endian data** — big-endian image data is byte-swapped on read.
- **`NeuroSpace.reorient()`** — preserves world coordinates (the reoriented affine is composed correctly).
- **`getSliceAt()` / live crosshair** — samples through the reoriented grid; no more identity-transform slices.
- **Colormap NaN handling** — non-finite voxels render transparent, not opaque black.
- **`getRange` / `dilate` / `erode`** — use ±Infinity (and skip NaN) instead of the old `Number.MIN_VALUE` min/max bug.
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

## Geometry & coordinates

| Feature | Status | Notes |
|---|---|---|
| `NeuroSpace` grid ↔ world transforms | <span class="stability-badge stable">stable</span> | |
| `NeuroSpace.reorient()` | <span class="stability-badge stable">stable</span> | Preserves world coordinates. |
| `getSliceAt` / crosshair slicing | <span class="stability-badge stable">stable</span> | Reoriented sampling. |

## I/O (NIfTI)

| Feature | Status | Notes |
|---|---|---|
| `readVol` / `readVolList` / `readVec` | <span class="stability-badge stable">stable</span> | Applies intensity scaling; handles endianness. |
| `writeVol` / `writeVec` | <span class="stability-badge stable">stable</span> | Round-trips covered by tests. |
| Client-side parsing via `nifti-reader-js` | <span class="stability-badge stable">stable</span> | The loader pattern in [Getting Started](/guide/getting-started). |
| AFNI (`.HEAD`/`.BRIK`) | <span class="stability-badge experimental">known issue</span> | Limited / experimental; NIfTI is the supported path. |

## Volumes & 4D/5D

| Feature | Status | Notes |
|---|---|---|
| `DenseNeuroVol` & typed subclasses | <span class="stability-badge stable">stable</span> | |
| `SparseNeuroVol`, `ClusteredNeuroVol`, `LogicalNeuroVol` | <span class="stability-badge stable">stable</span> | |
| Volume arithmetic (`addVol`, `meanVol`, …) | <span class="stability-badge stable">stable</span> | |
| `getRange()` | <span class="stability-badge stable">stable</span> | ±Infinity init, NaN-safe. |
| `NeuroVec` (4D) + `temporalFilter` / `detrend` | <span class="stability-badge stable">stable</span> | Preprocessing lives on the enhanced vec classes. |
| `BigNeuroVec` | <span class="stability-badge stable">stable</span> | Non-cubic transpose fixed. |
| `NeuroHyperVec` (5D+) core | <span class="stability-badge stable">stable</span> | Container, indexing, sub-volume extraction, concat. |
| `NeuroHyperVec` advanced ops (GLM, etc.) | <span class="stability-badge experimental">known issue</span> | Advanced/experimental — verify before relying on them. |

## Processing & analysis

| Feature | Status | Notes |
|---|---|---|
| Bilateral / guided filtering | <span class="stability-badge stable">stable</span> | He et al.; numerically faithful. |
| Gaussian blur | <span class="stability-badge stable">stable</span> | Correct; a separable performance optimization is planned. |
| `Resampler` (nearest/linear) | <span class="stability-badge stable">stable</span> | |
| `Resampler.transform()` | <span class="stability-badge stable">stable</span> | Implemented. |
| `Resampler` cubic/Lanczos at volume boundaries | <span class="stability-badge stable">stable</span> | Boundary taps are linearly extrapolated; edge-bias regression tests cover low/high edges and corners. |
| Connected components / `clusterTable` | <span class="stability-badge stable">stable</span> | |
| `StatFunctions` (mean/std/correlation/t) | <span class="stability-badge stable">stable</span> | Two-pass variance, Bessel correction. |
| `sphericalROI` / searchlight radius | <span class="stability-badge stable">stable</span> | mm-based, spacing-aware (anisotropy-correct). |

## Not yet available

These appear in some older README snippets but **do not exist** — use the alternatives:

| Doesn't exist | Use instead |
|---|---|
| `VolStack.fromNifti(url)` | The loader in [Getting Started](/guide/getting-started) → `new VolStack(layer)` |
| `NeuroVec.fromNifti(url)` | `readVec(path \| ArrayBuffer)` |

## Polish in progress (not user-facing correctness)

The unit suite is **fully green (962 passing)**. What remains is structural cleanup, not behavioural correctness:

- **Consolidation** — some duplicate NIfTI / viewer / ROI implementations from earlier accretion still coexist. They work; they'll be merged behind the current APIs.
- **Perf & hygiene** — a separable Gaussian optimization and dead-code removal are planned.

Packaging and test-runner integrity (e2e excluded from the unit run, test files kept out of the published tarball, `TestVolumeFactory` no longer exported, types-first `exports`, lint restored) and clustering determinism (k-means now uses a seeded k-means++ initialization) are **done**.

## Roadmap

In priority order:

1. **Consolidation** — merge the duplicate NIfTI / viewer / ROI implementations.
2. **Hygiene & perf** — separable Gaussian, dead-code removal.

::: tip Found something off?
If a feature marked <span class="stability-badge stable">stable</span> misbehaves, please [open an issue](https://github.com/bbuchsbaum/neuroimjs/issues) with a minimal repro — that's exactly what moves us to 1.0.
:::
