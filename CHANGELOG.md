# Changelog

All notable changes to neuroimjs are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Add an entry under **Unreleased**
in the pull request that makes the change.

## Unreleased

Upgrading: `readVol` now takes `space.spacing` from the affine rather than
from `pixdim`. Callers that need the raw `pixdim[1..3]` should use
`readHeader().spacing`. See Changed. The `TypeError` export is removed; import
`NeuroimTypeError` instead. See Removed.

### Added

- `toInt32Labels()` converts a label volume (or its voxel data) to an
  `Int32Array` by value, for every typed-array datatype. It rejects
  non-finite, non-integer and out-of-range values with an error naming the
  voxel. (#13)
- `createRng(seed)` returns a seeded generator (mulberry32) of numbers in
  [0, 1); `Rng` and `RandomOptions` are exported.
- `randomSearchlight(mask, radius, { seed, rng })` and
  `bootstrapSearchlight(mask, radius, iter, { seed, rng })` take an options
  argument for reproducible centers. Without one, each call still draws a
  fresh seed, so successive calls give different searchlights as before.
- `NeuroAtlas.loadGlasserAtlas({ useCache, seed, rng })` chooses the random
  region colours from a seeded generator. By default it uses
  `GLASSER_DEFAULT_COLOR_SEED`, so colours are now the same on every load;
  `loadGlasserAtlas(useCache)` still works.
- Downstream consumer contract tests (`npm run test:consumers`, part of
  `verify:release` and CI): the call surfaces of neuromosaic, FROIAtlas,
  neuroimjs-vscode and xnat2bids, run against the packed tarball.
- `BigNeuroVec` accepts `storage: 'memory'` (no backing file), `volumeSpace`
  and `shareData` options, and exposes `storage` and `volumeSpace`.
- Typed errors. `NeuroimError` (base class) carries a stable `code` of type
  `NeuroimErrorCode`, which is one of `INVALID_ARGUMENT`, `OUT_OF_RANGE`,
  `GEOMETRY_MISMATCH`, `UNSUPPORTED_FORMAT`, `UNSUPPORTED_DATATYPE`,
  `CORRUPT_FILE`, `NOT_IMPLEMENTED` or `IO_ERROR`. It may also carry a `details`
  object and an ES2022 `cause`. `isNeuroimError(error, code?)` narrows an
  unknown error, including one from a second copy of the library (for example
  the CJS and ESM builds loaded together). `NEUROIM_ERROR_CODES` lists the
  codes. Every throw in `src/io` and `src/geometry` now has a specific code,
  and messages are unchanged. `NeuroimError` and `isNeuroimError` are also
  exported from `neuroimjs/browser`. `ValueError`, `NotImplementedError` and
  `IOError` are now subclasses of `NeuroimError` and keep their `name`s. See
  the Errors section of the I/O guide.

### Changed

- `readVol` sets `space.spacing` to the voxel sizes of the selected transform,
  that is, the column norms of `space.trans`, instead of `pixdim[1..3]`. These
  are the values nibabel returns from `nibabel.affines.voxel_sizes(img.affine)`
  (not `header.get_zooms()`, which returns pixdim). `readNiftiArrayBuffer`
  already used them.
  - **Who is affected:** files whose sform scaling differs from pixdim, such
    as an oblique or rescaled sform.
  - **Before:** `readVol` reported a spacing that contradicted the affine,
    and the two decoders disagreed.
  - **Now:** `readHeader().spacing` still returns the raw `pixdim[1..3]`.
    Callers that want pixdim should read it there.
- `partition(x, k, method, mask, seed)` throws `RangeError` for a NaN or
  infinite `seed`; such seeds were previously coerced to 0.
- The label map of a Glasser or Schaefer `NeuroAtlas` (`atlas.atlas.labelMap`,
  and the labels returned by `getClusterInfo`/`getClusterLabel`) is keyed by
  the hemisphere-qualified names from the label file, e.g. `Right_V1` /
  `Left_V1` and `7Networks_LH_Vis_1`. `loadGlasserAtlas` now sets
  `origLabels` to those names; `labels` still holds the bare region names.
  `getROI({ label })` accepts either form, but a bare name shared by both
  hemispheres (`V1`) now throws an ambiguity error instead of returning the
  left-hemisphere region.
- `bigNeuroVecSeq` returns an in-memory `BigNeuroVec` that keeps the first
  volume's space (including its affine) as `volumeSpace`; it previously wrote
  an untracked `.dat` file to `$TMPDIR` and dropped the affine.
- `BigNeuroVec.subVector` on an in-memory vector stays in memory and keeps
  `volumeSpace`; an empty selection throws a `ValueError`.
- Flushing a file-backed `BigNeuroVec` after `close()` throws instead of
  failing with `EBADF`; a second `close()` is a no-op.
- Releases are published from CI by the `Release` workflow, triggered by a
  GitHub release, using npm Trusted Publishing (OIDC) with a provenance
  attestation; `scripts/verify-published.mjs` checks that the registry
  tarball matches the CI build file for file. See `RELEASING.md`.

### Deprecated

- `ValueError`. Catch library errors with `isNeuroimError(error, code)`.
  Functions that threw `ValueError` still throw instances of it (now with a
  specific `code`, e.g. `CORRUPT_FILE` for a non-NIfTI buffer), so existing
  `instanceof ValueError` checks keep working until 1.0.

### Removed

- The `TypeError` export. `export * from './types'` exposed it, so
  `import * as nij from 'neuroimjs'` and `import { TypeError } from 'neuroimjs'`
  shadowed the global `TypeError`. No library function threw it. Use
  `NeuroimTypeError` (a `NeuroimError` with code `INVALID_ARGUMENT`) or the
  global `TypeError`.

### Fixed

- `readVol` and `readNiftiArrayBuffer` no longer add `scl_inter` when
  `scl_slope` is 0 or non-finite. Such a slope means "no scaling" (NIfTI-1
  spec, nibabel), so voxel values are now returned exactly as stored.
  Previously every voxel was offset by `scl_inter`. A valid slope still yields
  `value * scl_slope + scl_inter`. A non-finite `scl_inter` with a valid
  slope is read as 0, following nifti1_io's `FIXED_FLOAT` rule. nibabel
  instead refuses to load such a file.
- `nearestAnatomy()` reports the correct axis codes for non-orthogonal
  (sheared) affines. Its Gram-Schmidt step scaled the i column in place by
  `dot(i, j)`, so a sheared RAS image could be reported as LAS.
  - **Affected:** `readVol`, `readNiftiArrayBuffer` and any `NeuroSpace` built
    from such an affine got the wrong `axes`, and `reorient()` picked the
    wrong frame.
  - **Now:** it orthonormalises copies of the columns, as NIfTI's
    `nifti_mat44_to_orientation` does. The result agrees with nibabel's
    `aff2axcodes` for near-orthogonal affines but can differ for strongly
    sheared ones.
- `NeuroAtlas.loadSchaeferAtlas`, `loadGlasserAtlas` and `loadAtlas` accept
  label volumes stored as int8, uint8, int16, uint16, int32, float32 or float64.
  Schaefer reinterpreted the bytes of non-float volumes (wrong labels, or a
  `RangeError` for an odd voxel count) and Glasser threw `Unsupported data type`
  for int8, uint8 and int16. Labels made non-integer by `scl_slope`/`scl_inter`
  now raise an error instead of being rounded silently. (#13)
- Right-hemisphere Glasser and Schaefer regions can be looked up by label.
  The label map was keyed by region name, which both hemispheres share, so each
  left-hemisphere entry replaced its right-hemisphere twin.
- `readVol` reads uint16 NIfTI volumes (datatype 512) as `UInt16NeuroVol`; it
  threw `Unsupported TypedArray type: uint16`.
- `loadSchaeferAtlas` no longer writes diagnostics to the console; they go to
  the display logger at DEBUG.
- The browser bundles are built with a relative base, so the ES bundle refers
  to the scatter-field worker chunk relative to itself
  (`new URL('assets/...', import.meta.url)`) instead of the origin root
  (`/assets/...`). Apps that re-bundle `dist/neuroimjs.es.js` or
  `neuroimjs/browser` with Vite failed to build against 0.5.0 because the
  worker entry could not be resolved.
- `buildScatterFieldAsync()` now builds the field on the main thread when the
  worker fails to load or run, returns an unreadable message, or exceeds
  `workerTimeoutMs`; previously these rejected and the synchronous fallback was
  used only when the `Worker` constructor threw. This covers UMD hosts that do
  not serve the bundle's `assets/` directory: the UMD bundle resolves the
  worker URL against the page, not the bundle, so the worker 404s there.
- `readVec` kept only spacing and origin from the file, so `getVolume(t)` and
  `vols()` dropped the rotation of an oblique affine. It also re-read and
  re-decompressed the whole file once per volume, and above 100 volumes (or
  with `useBigVec`) it wrote a `<file>.bigvec.tmp` next to the input that was
  never deleted; otherwise it wrote a `.dat` copy to `$TMPDIR`. `readVec` now
  decodes the file once, keeps the data in memory, writes nothing to disk, and
  carries the file's full 3D space on the result as `volumeSpace`.
  `getVolume(t)` uses that space. The time-first shape (`dim = [T, X, Y, Z]`)
  is unchanged. `useBigVec` no longer changes behaviour, and `mask` is still
  ignored.

## 0.5.0 - 2026-10-03

Upgrading from 0.4.0: Node.js 22 or later is required; `ImageLayer` defaults
to `'world'` alignment; the image-pixel methods of `SliceTransform` and
`CoordinateTransformer` use texel-centre coordinates (+0.5 px); and the display
logger is quiet by default. Each is described below.

### Added

- `setTheme()`, `setBackground()`, `setCrosshairStyle()` and
  `setOrientationLabelStyle()` on the slice viewers restyle the background,
  crosshair and orientation labels in place, without rebuilding the viewer;
  `ViewerTheme` is exported. `SimpleOrthogonalViewer.setBackground()` now
  changes the rendered clear colour. (#4)
- Alignment strategy `'world'`: a layer on a different voxel grid from layer 0
  (voxel size, dimensions or origin) is sliced on its own grid at the plane
  nearest the reference plane and drawn at its world position. It is left out
  where the reference plane falls outside its slab.
  `SimpleOrthogonalViewerOptions.alignmentStrategy` sets it at construction;
  `OrthogonalImageViewer` per-view layers now inherit the strategy. (#6)

### Changed

- Require Node.js 22 or later (`engines.node` was `>=20.19`). pixi.js 8, a
  runtime dependency, reads `navigator` when it loads, so `require('neuroimjs')`
  and `import 'neuroimjs'` already threw `ReferenceError: navigator is not
  defined` on Node 20, which reached end of life in April 2026.
- The display logger starts at WARN instead of DEBUG, so viewers no longer flood
  the host console. Opt in with `NEUROIMJS_LOG_LEVEL` / `NEUROIMJS_DEBUG`
  (global or environment variable) or `setLogLevel()` / `enableDebugLogging()`;
  the logging controls are exported from both entry points. (#5)
- **Behaviour change:** `ImageLayer` defaults to `alignmentStrategy: 'world'`
  (was `'auto'`), also when alignment options omit `strategy`. Overlays on a
  different grid from layer 0 were previously drawn at the reference slice index
  and fitted to the slice bounds, which misregistered them. Same-grid stacks are
  unaffected. Pass `alignmentStrategy: 'auto'` / `{ strategy: 'auto' }` or call
  `setAlignmentStrategy('auto')` for the old behaviour. (#6)

### Fixed

- `readVol` and the other NIfTI readers work when the library runs inside a
  `vm` context without a dynamic-import hook (vitest/vite-node on Node < 26,
  Jest). They failed with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
- Disposing a `SliceView` or `OrthogonalImageViewer` cancels its pending resize
  frames, so a resize just before `dispose()` no longer runs against the
  destroyed PIXI application. `OrthogonalImageViewer.dispose()` is idempotent
  and `SliceView.isDisposed` is new. (#2)
- `OrthogonalImageViewer` handles ArrowLeft/ArrowRight only when focus is on the
  page itself or inside one of its slice panes, so sliders and text fields
  elsewhere on the page keep their arrow keys. (#3)
- A pooled sprite reused as a reference sprite no longer keeps the position and
  pivot of its previous use as an offset overlay (`SpritePool.acquire` resets
  them). (#6)
- Volumes not stored LPI (e.g. RPI, LAI, RAI) are no longer mirrored in the
  coronal and sagittal views: `DenseNeuroVol.getSlice` and
  `SparseNeuroVol.getSlice` use their LPI-only fast paths only for LPI-stored
  sources, and slice indices are taken in the volume's own voxel order. (#10)
- `VolStack` can hold layers stored in a different orientation from the
  reference layer: `FacadeVolLayer` no longer throws a MobX error on
  construction (`VolLayer` uses `makeObservable`), maps world coordinates
  without mirroring, forwards display setters, and keeps the wrapped layer's id.
  (#11, fixes #7)
- The crosshair is drawn through the centre of the voxel it marks, not half a
  voxel off, and a click anywhere inside a texel selects that voxel. **API
  change:** the image-pixel methods of `SliceTransform` and
  `CoordinateTransformer` now use texel-centre coordinates (voxel `c` maps to
  pixel `c + 0.5`); the new `SliceTransform.sliceToImageCoord` /
  `imageToSliceCoord` implement the convention. (#9)
- `CategoryLogger`, the type returned by `Logger.getCategory()`, is exported
  from both entry points, so the API reference builds again.

### Security

- Update axios to 1.20.0 (high-severity advisory affecting 1.0.0–1.19.0).

### Tests and CI

- The unit and browser suites no longer need git-ignored data or the network.
  `scripts/prepare-test-data.mjs` (a vitest and Playwright global setup) copies
  the committed MNI152 template into `tests/data/` after a SHA-256 check. The
  Glasser and Schaefer loader tests run against synthetic files with the
  published geometry, datatypes and label formats; set
  `NEUROIMJS_NETWORK_TESTS=1` to use the real downloads (weekly `network` job).
- Commit Linux baselines for the `overlay.spec.ts` screenshots; the old local
  baselines predated the single application of layer opacity and the viewer
  filling its container.
- CI runs on Node 22 (canonical), 24 and 26, and uploads Playwright results on
  failure.

## 0.4.0 - 2026-09-24

Changes up to this version are described in the commit history up to the
`v0.4.0` tag.
