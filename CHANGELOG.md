# Changelog

All notable changes to neuroimjs are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Add an entry under **Unreleased**
in the pull request that makes the change.

## Unreleased

### Fixed

- `readVol` and `readNiftiArrayBuffer` no longer add `scl_inter` when
  `scl_slope` is 0 or non-finite. Such a slope means "no scaling" (NIfTI-1
  spec, nibabel), so voxel values are now returned exactly as stored; before,
  every voxel was offset by `scl_inter`. A valid slope still yields
  `value * scl_slope + scl_inter`.
- `readVol` sets `space.spacing` to the voxel sizes of the selected transform
  (the column norms of `space.trans`) rather than `pixdim[1..3]`, matching
  `readNiftiArrayBuffer` and nibabel. Files whose sform scaling differs from
  pixdim (e.g. an oblique or rescaled sform) previously reported a spacing
  that contradicted the affine, and the two decoders disagreed.
  `readHeader().spacing` still returns the raw `pixdim[1..3]`.
- `nearestAnatomy()` reports the correct axis codes for non-orthogonal
  (sheared) affines. Its Gram-Schmidt step scaled the i column in place by
  `dot(i, j)`, so a sheared RAS image could be reported as LAS, giving
  `readVol`, `readNiftiArrayBuffer` and any `NeuroSpace` built from such an
  affine the wrong `axes`, and making `reorient()` pick the wrong frame. It now
  orthonormalises copies of the columns and matches nibabel's `aff2axcodes`.

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
